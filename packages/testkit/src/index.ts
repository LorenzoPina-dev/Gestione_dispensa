export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface TestContext {
  clock: Clock;
  ids: IdGenerator;
}

export class FixedClock implements Clock {
  private currentTime: number;

  public constructor(initialTime: Date | string | number) {
    const timestamp = new Date(initialTime).getTime();
    if (!Number.isFinite(timestamp)) {
      throw new Error("FixedClock requires a valid initial time.");
    }

    this.currentTime = timestamp;
  }

  public now(): Date {
    return new Date(this.currentTime);
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds)) {
      throw new Error("Clock advancement must be finite.");
    }

    this.currentTime += milliseconds;
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private readonly values: readonly string[];
  private currentIndex = 0;

  public constructor(values: readonly string[]) {
    if (values.length === 0) {
      throw new Error("SequenceIdGenerator requires at least one value.");
    }

    if (values.some((value) => value.length === 0)) {
      throw new Error("SequenceIdGenerator values cannot be empty.");
    }

    this.values = [...values];
  }

  public next(): string {
    const value = this.values[this.currentIndex % this.values.length];
    this.currentIndex += 1;

    if (value === undefined) {
      throw new Error("SequenceIdGenerator reached an invalid state.");
    }

    return value;
  }
}

export function createTestContext(
  initialTime: Date | string | number,
  ids: readonly string[],
): TestContext {
  return {
    clock: new FixedClock(initialTime),
    ids: new SequenceIdGenerator(ids),
  };
}

export interface FixtureFactory<T> {
  create(overrides?: Partial<T>): T;
}

export function createFixtureFactory<T extends object>(defaults: T): FixtureFactory<T> {
  return {
    create(overrides: Partial<T> = {}): T {
      return { ...defaults, ...overrides };
    },
  };
}

export interface TestHttpRequest {
  method: string;
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
}

export interface TestHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
}

export type TestHttpHandler = (
  request: TestHttpRequest,
) => TestHttpResponse | Promise<TestHttpResponse>;

export class InMemoryHttpClient {
  private readonly handler: TestHttpHandler;

  public constructor(handler: TestHttpHandler) {
    this.handler = handler;
  }

  public request(request: TestHttpRequest): Promise<TestHttpResponse> {
    return Promise.resolve(this.handler(request));
  }
}

export interface DatabaseTestTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface DatabaseTestAdapter {
  reset(): Promise<void>;
  begin(): Promise<DatabaseTestTransaction>;
}

export interface TestQueueMessage<T> {
  id: string;
  payload: T;
  attempts: number;
}

export interface QueueTestAdapter<T> {
  publish(payload: T): Promise<TestQueueMessage<T>>;
  receive(): Promise<TestQueueMessage<T> | undefined>;
  acknowledge(messageId: string): Promise<void>;
  reject(messageId: string, retryable: boolean): Promise<void>;
}
