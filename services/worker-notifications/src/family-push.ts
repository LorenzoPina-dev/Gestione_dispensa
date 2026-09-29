import { NotificationJobError, redactBody, type NotificationJobHandler } from "./notifications.js";

/**
 * Payload shape enqueued by the former core service's NotificationService (see services/server.ts's
 * pushDispatcher and services/notifications/service.ts's PushNotificationDispatcher):
 * ONE job per already-persisted in-app notification, addressed to a FAMILY rather than a single
 * user -- fan-out to individual recipients (and per-recipient push-token delivery) happens here,
 * at consume time, using each family member's own opt-in (user_notification_settings, see
 * migration 0017_pantry-optimization-and-new-features.sql) rather than in the producer.
 */
export interface FamilyNotificationEvent {
  readonly notificationId: string;
  readonly familyId: string;
  readonly category: "REORDER" | "INVITE" | "SYSTEM" | "EXPIRY";
  readonly title: string;
  readonly body: string;
}

export interface PushRecipient {
  readonly userId: string;
  readonly pushTokens: readonly string[];
}

export interface FamilyPushRepository {
  /**
   * Active family members who opted into push for this notification category (see
   * user_notification_settings.push_enabled/reorder_enabled/offers_enabled and
   * expiry_days_before), each with their registered push tokens.
   */
  listRecipients(
    familyId: string,
    category: FamilyNotificationEvent["category"],
  ): Promise<readonly PushRecipient[]>;
}

export interface PushProvider {
  send(input: {
    readonly userId: string;
    readonly pushTokens: readonly string[];
    readonly title: string;
    readonly body: string;
  }): Promise<void>;
}

/**
 * Best-effort fan-out: one recipient's delivery failure does not fail the whole job (and
 * therefore does not retry-and-resend to recipients who already received it) -- it's recorded in
 * the job's result instead. Only a repository/lookup failure (can't even determine who the
 * recipients are) is treated as retryable, since in that case NO ONE has been notified yet.
 */
export function familyPushHandler(
  repository: FamilyPushRepository,
  provider: PushProvider,
): NotificationJobHandler {
  return async ({ job }) => {
    const event = parseFamilyEvent(job.payload);
    let recipients: readonly PushRecipient[];
    try {
      recipients = await repository.listRecipients(event.familyId, event.category);
    } catch (error) {
      throw new NotificationJobError(
        "FAMILY_PUSH_RECIPIENTS_LOOKUP_FAILED",
        "TRANSIENT",
        error instanceof Error ? error.message : "Could not resolve push recipients.",
      );
    }

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      if (recipient.pushTokens.length === 0) continue;
      try {
        await provider.send({
          userId: recipient.userId,
          pushTokens: recipient.pushTokens,
          title: event.title,
          body: redactBody(event.body),
        });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      notificationId: event.notificationId,
      familyId: event.familyId,
      recipients: recipients.length,
      sent,
      failed,
    };
  };
}

/**
 * Development/offline fallback provider: logs instead of calling a real push gateway (APNs/FCM/
 * Web Push). Wiring a real provider is a follow-up (this refactor's scope was the async
 * decoupling via notifications-queue, not a specific push vendor integration) -- swap this out in
 * run.ts once credentials for a provider are available.
 */
export class LoggingPushProvider implements PushProvider {
  public constructor(private readonly log: (line: string, fields: Record<string, unknown>) => void) {}

  public async send(input: {
    userId: string;
    pushTokens: readonly string[];
    title: string;
    body: string;
  }): Promise<void> {
    this.log("push_notification_logged", {
      userId: input.userId,
      tokenCount: input.pushTokens.length,
      title: input.title,
    });
  }
}

function parseFamilyEvent(payload: Readonly<Record<string, unknown>>): FamilyNotificationEvent {
  const event = payload as Partial<FamilyNotificationEvent>;
  if (
    typeof event.notificationId !== "string" ||
    typeof event.familyId !== "string" ||
    typeof event.category !== "string" ||
    !["REORDER", "INVITE", "SYSTEM", "EXPIRY"].includes(event.category) ||
    typeof event.title !== "string" ||
    typeof event.body !== "string"
  ) {
    throw new NotificationJobError(
      "INVALID_FAMILY_NOTIFICATION_EVENT",
      "PERMANENT",
      "Family notification event is invalid",
    );
  }
  return event as FamilyNotificationEvent;
}
