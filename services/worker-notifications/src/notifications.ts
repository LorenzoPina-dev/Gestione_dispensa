export interface NotificationJobContext {
  readonly job: { readonly payload: Readonly<Record<string, unknown>> };
  readonly attempt?: Readonly<Record<string, unknown>>;
}

export type NotificationJobHandler = (
  context: NotificationJobContext,
) => Promise<Readonly<Record<string, unknown>>>;

export class NotificationJobError extends Error {
  public readonly classification: "TRANSIENT" | "PERMANENT";
  public readonly code: string;

  public constructor(code: string, classification: "TRANSIENT" | "PERMANENT", message: string) {
    super(message);
    this.name = "NotificationJobError";
    this.code = code;
    this.classification = classification;
  }
}

export type NotificationChannel = "IN_APP" | "EMAIL" | "PUSH";

export interface NotificationEvent {
  readonly eventId: string;
  readonly familyId?: string;
  readonly recipientUserId: string;
  readonly channel: NotificationChannel;
  readonly category: "REORDER" | "INVITE" | "SYSTEM";
  readonly title: string;
  readonly body: string;
  readonly traceId: string;
}

export interface NotificationPreference {
  readonly enabled: boolean;
  readonly quietHours?: { readonly startHourUtc: number; readonly endHourUtc: number };
}

export interface NotificationRepository {
  getPreference(
    userId: string,
    category: NotificationEvent["category"],
    channel: NotificationChannel,
  ): Promise<NotificationPreference>;
  beginDelivery(eventId: string, userId: string): Promise<boolean>;
  completeDelivery(
    eventId: string,
    userId: string,
    status: "SENT" | "DEFERRED" | "FAILED",
  ): Promise<void>;
  unsubscribe(userId: string, channel: NotificationChannel): Promise<void>;
}

export interface NotificationProvider {
  send(input: {
    readonly userId: string;
    readonly channel: NotificationChannel;
    readonly title: string;
    readonly body: string;
  }): Promise<void>;
}

export interface NotificationClock {
  now(): Date;
}

export function notificationHandler(
  repository: NotificationRepository,
  provider: NotificationProvider,
  clock: NotificationClock,
): NotificationJobHandler {
  return async ({ job }) => {
    const event = parseEvent(job.payload);
    const preference = await repository.getPreference(
      event.recipientUserId,
      event.category,
      event.channel,
    );
    if (!preference.enabled) return { status: "DISABLED", eventId: event.eventId };
    if (isQuietHours(preference.quietHours, clock.now())) {
      await repository.completeDelivery(event.eventId, event.recipientUserId, "DEFERRED");
      return { status: "DEFERRED", eventId: event.eventId };
    }
    if (!(await repository.beginDelivery(event.eventId, event.recipientUserId))) {
      return { status: "DUPLICATE", eventId: event.eventId };
    }
    try {
      await provider.send({
        userId: event.recipientUserId,
        channel: event.channel,
        title: event.title,
        body: redactBody(event.body),
      });
      await repository.completeDelivery(event.eventId, event.recipientUserId, "SENT");
      return { status: "SENT", eventId: event.eventId };
    } catch (error: unknown) {
      await repository.completeDelivery(event.eventId, event.recipientUserId, "FAILED");
      throw new NotificationJobError(
        "NOTIFICATION_PROVIDER_FAILURE",
        "TRANSIENT",
        error instanceof Error ? error.message : "Notification provider failed",
      );
    }
  };
}

export function isQuietHours(quietHours: NotificationPreference["quietHours"], now: Date): boolean {
  if (quietHours === undefined) return false;
  const hour = now.getUTCHours();
  if (quietHours.startHourUtc <= quietHours.endHourUtc) {
    return hour >= quietHours.startHourUtc && hour < quietHours.endHourUtc;
  }
  return hour >= quietHours.startHourUtc || hour < quietHours.endHourUtc;
}

export function redactBody(body: string): string {
  return body.replace(/\b(?:token|secret|password|invite)[=:]\S+/gi, "[redacted]");
}

function parseEvent(payload: Readonly<Record<string, unknown>>): NotificationEvent {
  const event = payload as Partial<NotificationEvent>;
  if (
    typeof event.eventId !== "string" ||
    typeof event.recipientUserId !== "string" ||
    typeof event.channel !== "string" ||
    !["IN_APP", "EMAIL", "PUSH"].includes(event.channel) ||
    typeof event.category !== "string" ||
    !["REORDER", "INVITE", "SYSTEM"].includes(event.category) ||
    typeof event.title !== "string" ||
    typeof event.body !== "string" ||
    typeof event.traceId !== "string"
  ) {
    throw new NotificationJobError(
      "INVALID_NOTIFICATION_EVENT",
      "PERMANENT",
      "Notification event is invalid",
    );
  }
  return event as NotificationEvent;
}
