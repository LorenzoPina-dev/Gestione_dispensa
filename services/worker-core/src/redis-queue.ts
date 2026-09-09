import type { QueueAdapter, QueueMessage } from "./queue.js";

export interface RedisQueueClient {
  lPush(key: string, value: string): Promise<number>;
  brPopLPush(source: string, destination: string, timeoutSeconds: number): Promise<string | null>;
  lRem(key: string, count: number, value: string): Promise<number>;
  lLen(key: string): Promise<number>;
  lIndex(key: string, index: number): Promise<string | null>;
  lRange(key: string, start: number, stop: number): Promise<readonly string[]>;
}

export class RedisQueueAdapter<T> implements QueueAdapter<T> {
  private readonly pendingKey: string;
  private readonly processingKey: string;

  public constructor(
    private readonly client: RedisQueueClient,
    queueName: string,
    private readonly receiveTimeoutSeconds = 1,
  ) {
    if (!queueName.trim()) throw new Error("Redis queue name is required.");
    if (!Number.isInteger(receiveTimeoutSeconds) || receiveTimeoutSeconds < 0)
      throw new Error("Redis receive timeout must be a non-negative integer.");
    this.pendingKey = `gestione-dispensa:queue:${queueName}:pending`;
    this.processingKey = `gestione-dispensa:queue:${queueName}:processing`;
  }

  public async publish(message: QueueMessage<T>): Promise<void> {
    this.validate(message);
    await this.client.lPush(this.pendingKey, JSON.stringify(message));
  }

  public async receive(): Promise<QueueMessage<T> | undefined> {
    const raw = await this.client.brPopLPush(
      this.pendingKey,
      this.processingKey,
      this.receiveTimeoutSeconds,
    );
    return raw === null ? undefined : this.parse(raw);
  }

  public async ack(messageId: string): Promise<void> {
    await this.removeInFlight(messageId);
  }

  public async nack(messageId: string): Promise<void> {
    const raw = await this.findInFlight(messageId);
    await this.removeInFlight(messageId);
    await this.client.lPush(this.pendingKey, raw);
  }

  public async size(): Promise<number> {
    return this.client.lLen(this.pendingKey);
  }

  public async oldestEnqueuedAt(): Promise<number | undefined> {
    const entries = await this.client.lRange(this.pendingKey, 0, -1);
    return entries.reduce<number | undefined>(
      (oldest, raw) => Math.min(oldest ?? this.parse(raw).enqueuedAt, this.parse(raw).enqueuedAt),
      undefined,
    );
  }

  private async findInFlight(messageId: string): Promise<string> {
    const entries = await this.client.lRange(this.processingKey, 0, -1);
    for (const raw of entries) {
      if (this.parse(raw).id === messageId) return raw;
    }
    throw new Error(`Redis queue message ${messageId} is not available for acknowledgement.`);
  }

  private async removeInFlight(messageId: string): Promise<void> {
    const raw = await this.findInFlight(messageId);
    const removed = await this.client.lRem(this.processingKey, 1, raw);
    if (removed !== 1) throw new Error(`Redis queue message ${messageId} was not acknowledged.`);
  }

  private parse(raw: string): QueueMessage<T> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      throw new Error("Redis queue contained invalid JSON.");
    }
    if (
      typeof message !== "object" ||
      message === null ||
      typeof (message as { id?: unknown }).id !== "string" ||
      typeof (message as { queue?: unknown }).queue !== "string" ||
      typeof (message as { enqueuedAt?: unknown }).enqueuedAt !== "number" ||
      !("payload" in message)
    ) {
      throw new Error("Redis queue contained an invalid message.");
    }
    return message as QueueMessage<T>;
  }

  private validate(message: QueueMessage<T>): void {
    if (!message.id || !message.queue || !Number.isFinite(message.enqueuedAt))
      throw new Error("Redis queue message metadata is invalid.");
  }
}
