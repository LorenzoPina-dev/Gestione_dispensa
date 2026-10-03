export type NotificationStatus = "SENT" | "DUPLICATE" | "DISABLED";

export interface NotificationPreference {
  readonly enabled: boolean;
  readonly quietHours?: {
    readonly startHourUtc: number;
    readonly endHourUtc: number;
  };
}

export interface NotificationDeliveryRepository {
  getPreference(userId: string, category: string, channel?: string): Promise<{ enabled: boolean }>;
  beginDelivery(eventId: string, userId: string): Promise<boolean>;
  completeDelivery(eventId: string, userId: string, status: string): Promise<void>;
  unsubscribe(userId: string, channel: string): Promise<void>;
  storeInApp(input: {
    eventId: string;
    recipientUserId: string;
    channel: string;
    category: string;
    title: string;
    body: string;
    traceId?: string;
  }, ttlSeconds: number): Promise<void>;
  getPreference(userId: string, category: string, channel?: string): Promise<{ enabled: boolean }>;
}

export interface NotificationProvider {
  send(input: {
    title: string;
    body: string;
    recipientUserId?: string;
    channel?: string;
  }): Promise<void>;
}

export interface NotificationJob {
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface NotificationAttempt {
  readonly id?: string;
  readonly jobId?: string;
  readonly attempt?: number;
  readonly startedAt?: number;
  readonly status?: "PROCESSING" | "COMPLETED" | "FAILED";
}

export class NotificationJobError extends Error {
  public constructor(
    message: string,
    public readonly classification: "TRANSIENT" | "PERMANENT",
  ) {
    super(message);
    this.name = "NotificationJobError";
  }
}

export class NotificationValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

export function isQuietHours(
  hours: { startHourUtc: number; endHourUtc: number },
  now: Date,
): boolean {
  validateHour(hours.startHourUtc);
  validateHour(hours.endHourUtc);

  const hour = now.getUTCHours();
  if (hours.startHourUtc === hours.endHourUtc) return false;
  if (hours.startHourUtc < hours.endHourUtc) {
    return hour >= hours.startHourUtc && hour < hours.endHourUtc;
  }
  return hour >= hours.startHourUtc || hour < hours.endHourUtc;
}

export function notificationHandler(
  repository: NotificationDeliveryRepository,
  provider: NotificationProvider,
  options: { now?: () => Date } = {},
): (input: { job: NotificationJob; attempt?: NotificationAttempt }) => Promise<{ status: NotificationStatus; eventId: string }> {
  const now = options.now ?? (() => new Date());

  return async ({ job }: { job: NotificationJob; attempt?: NotificationAttempt }) => {
    const payload = job.payload;
    const eventId = stringValue(payload.eventId);
    const userId = stringValue(payload.recipientUserId);
    const channel = stringValue(payload.channel) ?? "IN_APP";
    const category = stringValue(payload.category) ?? "SYSTEM";
    const title = stringValue(payload.title) ?? "Notifica";
    const body = redact(stringValue(payload.body) ?? "");

    if (!eventId || !userId) {
      throw new NotificationJobError("Notification event is malformed.", "PERMANENT");
    }

    const preference = await repository.getPreference(userId, category, channel);
    if (!preference.enabled) return { status: "DISABLED", eventId };

    if (preference.quietHours && isQuietHours(preference.quietHours, now())) {
      throw new NotificationJobError("Notification deferred by quiet hours.", "TRANSIENT");
    }

    const acquired = await repository.beginDelivery(eventId, userId);
    if (!acquired) return { status: "DUPLICATE", eventId };

    try {
      await provider.send({
        title,
        body,
        recipientUserId: userId,
        channel,
      });
      await repository.completeDelivery(eventId, userId, "SENT");
      return { status: "SENT", eventId };
    } catch (error) {
      await repository.completeDelivery(eventId, userId, "FAILED").catch(() => undefined);
      throw new NotificationJobError(
        error instanceof Error ? error.message : "Notification provider failed.",
        "TRANSIENT",
      );
    }
  };
}

export class InMemoryNotificationRepository implements NotificationDeliveryRepository {
  private readonly preferences = new Map<string, NotificationPreference>();
  private readonly deliveries = new Set<string>();
  private readonly notifications: Array<Record<string, unknown>> = [];

  public async getPreference(userId: string, category: string, _channel = "IN_APP"): Promise<{ enabled: boolean }> {
    return { enabled: this.preferences.get(key(userId, category))?.enabled ?? true };
  }

  public async beginDelivery(eventId: string, userId: string): Promise<boolean> {
    const deliveryKey = `${eventId}:${userId}`;
    if (this.deliveries.has(deliveryKey)) return false;
    this.deliveries.add(deliveryKey);
    return true;
  }

  public async completeDelivery(_eventId: string, _userId: string, _status: string): Promise<void> {}

  public async unsubscribe(userId: string, channel: string): Promise<void> {
    for (const category of ["REORDER", "EXPIRATION", "FAMILY", "SYSTEM"]) {
      this.preferences.set(key(userId, category), { enabled: false });
    }
    void channel;
  }

  public async storeInApp(
    input: {
      eventId: string;
      recipientUserId: string;
      channel: string;
      category: string;
      title: string;
      body: string;
      traceId?: string;
    },
    _ttlSeconds: number,
  ): Promise<void> {
    this.notifications.push({ ...input });
  }

  public async getPreferenceForCategory(userId: string, category: string, _channel = "IN_APP"): Promise<NotificationPreference> {
    return this.preferences.get(key(userId, category)) ?? { enabled: true };
  }

  public async setPreference(
    userId: string,
    category: string,
    value: NotificationPreference,
  ): Promise<void> {
    this.preferences.set(key(userId, category), value);
  }

  public async listInApp(userId: string): Promise<readonly Record<string, unknown>[]> {
    return this.notifications.filter((item) => item.recipientUserId === userId);
  }
}

export class NotificationApplicationService {
  public constructor(private readonly repository: InMemoryNotificationRepository) {}

  public async updatePreference(
    userId: string,
    category: string,
    channel: string,
    input: NotificationPreference,
  ): Promise<void> {
    if (input.quietHours) {
      validateHour(input.quietHours.startHourUtc);
      validateHour(input.quietHours.endHourUtc);
    }
    await this.repository.setPreference(userId, category, {
      enabled: Boolean(input.enabled),
      ...(input.quietHours ? { quietHours: input.quietHours } : {}),
    });
    void channel;
  }

  public async unsubscribe(userId: string, channel: string): Promise<void> {
    await this.repository.unsubscribe(userId, channel);
  }

  public async listNotifications(userId: string): Promise<readonly Record<string, unknown>[]> {
    return this.repository.listInApp(userId);
  }
}

function key(userId: string, category: string): string {
  return `${userId}:${category}`.toUpperCase();
}

function validateHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new NotificationValidationError("quiet-hours hour must be between 0 and 23");
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function redact(value: string): string {
  return value
    .replace(/token=[^\s]+/gi, "[redacted]")
    .replace(/authorization\s*:\s*[^\s]+/gi, "authorization: [redacted]");
}
