export interface QueueMessage<T> {
  readonly id: string;
  readonly queue: string;
  readonly payload: T;
  readonly enqueuedAt: number;
}

export interface QueueAdapter<T> {
  publish(message: QueueMessage<T>): Promise<void>;
  receive(): Promise<QueueMessage<T> | undefined>;
  ack(messageId: string): Promise<void>;
  nack(messageId: string): Promise<void>;
  size(): number;
  oldestEnqueuedAt(): number | undefined;
}

export class FakeQueue<T> implements QueueAdapter<T> {
  private readonly messages: QueueMessage<T>[] = [];
  private readonly inFlight = new Map<string, QueueMessage<T>>();
  private readonly acknowledged = new Set<string>();

  public async publish(message: QueueMessage<T>): Promise<void> {
    this.messages.push(message);
  }

  public async receive(): Promise<QueueMessage<T> | undefined> {
    const message = this.messages.shift();
    if (message) this.inFlight.set(message.id, message);
    return message;
  }

  public async ack(messageId: string): Promise<void> {
    if (!this.inFlight.delete(messageId))
      throw new Error(`Cannot ack unknown message ${messageId}`);
    this.acknowledged.add(messageId);
  }

  public async nack(messageId: string): Promise<void> {
    const message = this.inFlight.get(messageId);
    if (!message) throw new Error(`Cannot nack unknown message ${messageId}`);
    this.inFlight.delete(messageId);
    this.messages.unshift(message);
  }

  public size(): number {
    return this.messages.length;
  }

  public oldestEnqueuedAt(): number | undefined {
    return this.messages[0]?.enqueuedAt;
  }

  public wasAcknowledged(messageId: string): boolean {
    return this.acknowledged.has(messageId);
  }
}
