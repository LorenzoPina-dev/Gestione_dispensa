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

export interface StoredNotification {
  readonly id: string;
  readonly eventId: string;
  readonly userId: string;
  readonly familyId?: string;
  readonly category: NotificationEvent["category"];
  readonly title: string;
  readonly body: string;
  readonly createdAt: number;
  readonly readAt?: number;
}

export interface NotificationPreferencesRepository extends NotificationRepository {
  upsertPreference(
    userId: string,
    category: NotificationEvent["category"],
    channel: NotificationChannel,
    preference: NotificationPreference,
  ): Promise<NotificationPreference>;
  listNotifications(userId: string): Promise<readonly StoredNotification[]>;
  markNotificationRead(userId: string, notificationId: string, now: number): Promise<void>;
  storeInApp(event: NotificationEvent, now: number): Promise<void>;
}

export class NotificationValidationError extends Error {
  public readonly code = "INVALID_NOTIFICATION_PREFERENCE";

  public constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

export class NotificationApplicationService {
  private readonly repository: NotificationPreferencesRepository;

  public constructor(repository: NotificationPreferencesRepository) {
    this.repository = repository;
  }

  public async updatePreference(
    userId: string,
    category: NotificationEvent["category"],
    channel: NotificationChannel,
    preference: NotificationPreference,
  ): Promise<NotificationPreference> {
    validatePreference(preference);
    return this.repository.upsertPreference(userId, category, channel, preference);
  }

  public listNotifications(userId: string): Promise<readonly StoredNotification[]> {
    return this.repository.listNotifications(userId);
  }

  public markNotificationRead(userId: string, notificationId: string, now: number): Promise<void> {
    if (!userId.trim() || !notificationId.trim()) {
      throw new NotificationValidationError("Notification identity is required.");
    }
    return this.repository.markNotificationRead(userId, notificationId, now);
  }

  public unsubscribe(userId: string, channel: NotificationChannel): Promise<void> {
    return this.repository.unsubscribe(userId, channel);
  }
}

export class InMemoryNotificationRepository implements NotificationPreferencesRepository {
  private readonly preferences = new Map<string, NotificationPreference>();
  private readonly deliveries = new Map<string, "SENT" | "DEFERRED" | "FAILED">();
  private readonly notifications = new Map<string, StoredNotification>();
  private sequence = 0;

  public async getPreference(
    userId: string,
    category: NotificationEvent["category"],
    channel: NotificationChannel,
  ): Promise<NotificationPreference> {
    return this.preferences.get(preferenceKey(userId, category, channel)) ?? { enabled: false };
  }

  public async beginDelivery(eventId: string, userId: string): Promise<boolean> {
    const key = deliveryKey(eventId, userId);
    if (this.deliveries.has(key)) return false;
    this.deliveries.set(key, "DEFERRED");
    return true;
  }

  public async completeDelivery(
    eventId: string,
    userId: string,
    status: "SENT" | "DEFERRED" | "FAILED",
  ): Promise<void> {
    const key = deliveryKey(eventId, userId);
    if (!this.deliveries.has(key)) throw new Error(`Delivery ${key} was not started.`);
    this.deliveries.set(key, status);
  }

  public async unsubscribe(userId: string, channel: NotificationChannel): Promise<void> {
    for (const key of this.preferences.keys()) {
      if (key.startsWith(`${userId}:`) && key.endsWith(`:${channel}`)) {
        this.preferences.set(key, { enabled: false });
      }
    }
  }

  public async upsertPreference(
    userId: string,
    category: NotificationEvent["category"],
    channel: NotificationChannel,
    preference: NotificationPreference,
  ): Promise<NotificationPreference> {
    const key = preferenceKey(userId, category, channel);
    this.preferences.set(key, preference);
    return preference;
  }

  public async listNotifications(userId: string): Promise<readonly StoredNotification[]> {
    return [...this.notifications.values()]
      .filter((notification) => notification.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  public async markNotificationRead(
    userId: string,
    notificationId: string,
    now: number,
  ): Promise<void> {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error("Notification is not visible.");
    }
    this.notifications.set(notificationId, { ...notification, readAt: now });
  }

  public async storeInApp(event: NotificationEvent, now: number): Promise<void> {
    const id = `notification-${++this.sequence}`;
    this.notifications.set(id, {
      id,
      eventId: event.eventId,
      userId: event.recipientUserId,
      ...(event.familyId === undefined ? {} : { familyId: event.familyId }),
      category: event.category,
      title: event.title,
      body: redactBody(event.body),
      createdAt: now,
    });
  }
}

export class InAppNotificationProvider implements NotificationProvider {
  private readonly repository: Pick<NotificationPreferencesRepository, "storeInApp">;
  private readonly clock: NotificationClock;

  public constructor(
    repository: Pick<NotificationPreferencesRepository, "storeInApp">,
    clock: NotificationClock,
  ) {
    this.repository = repository;
    this.clock = clock;
  }

  public send(input: {
    readonly userId: string;
    readonly channel: NotificationChannel;
    readonly title: string;
    readonly body: string;
  }): Promise<void> {
    if (input.channel !== "IN_APP") return Promise.resolve();
    return this.repository.storeInApp(
      {
        eventId: `provider-${input.userId}-${input.title}`,
        recipientUserId: input.userId,
        channel: input.channel,
        category: "SYSTEM",
        title: input.title,
        body: input.body,
        traceId: "provider",
      },
      this.clock.now().getTime(),
    );
  }
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

function preferenceKey(
  userId: string,
  category: NotificationEvent["category"],
  channel: NotificationChannel,
): string {
  return `${userId}:${category}:${channel}`;
}

function deliveryKey(eventId: string, userId: string): string {
  return `${eventId}:${userId}`;
}

function validatePreference(preference: NotificationPreference): void {
  if (typeof preference.enabled !== "boolean") {
    throw new NotificationValidationError("Preference enabled must be boolean.");
  }
  const quietHours = preference.quietHours;
  if (
    quietHours !== undefined &&
    (!Number.isInteger(quietHours.startHourUtc) ||
      !Number.isInteger(quietHours.endHourUtc) ||
      quietHours.startHourUtc < 0 ||
      quietHours.startHourUtc > 23 ||
      quietHours.endHourUtc < 0 ||
      quietHours.endHourUtc > 23)
  ) {
    throw new NotificationValidationError("Quiet hours must use UTC hours from 0 to 23.");
  }
}
