import { randomUUID } from "node:crypto";
import type { DeadLetter, JobAttempt, JobRecord, JobStatus } from "./job.js";

export interface JobRepository {
  create(input: {
    readonly familyId?: string;
    readonly capability: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
    readonly maxAttempts: number;
    readonly traceId?: string;
    readonly now: number;
  }): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | undefined>;
  claim(id: string, now: number): Promise<JobRecord | undefined>;
  cancel(id: string, now: number): Promise<JobRecord>;
  transition(
    id: string,
    status: JobStatus,
    now: number,
    details?: {
      readonly result?: Readonly<Record<string, unknown>>;
      readonly errorCode?: string;
      readonly errorClass?: "TRANSIENT" | "PERMANENT";
      readonly nextAttemptAt?: number;
    },
  ): Promise<JobRecord>;
  addAttempt(attempt: JobAttempt): Promise<void>;
  updateAttempt(
    id: string,
    update: Partial<
      Pick<JobAttempt, "finishedAt" | "status" | "errorCode" | "errorClass" | "durationMs">
    >,
  ): Promise<void>;
  addDeadLetter(deadLetter: DeadLetter): Promise<void>;
  listDeadLetters(): Promise<readonly DeadLetter[]>;
}

export interface InboxRepository {
  begin(consumerName: string, eventId: string, now: number): Promise<boolean>;
  complete(consumerName: string, eventId: string, now: number): Promise<void>;
}

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly attempts = new Map<string, JobAttempt>();
  private readonly deadLetters: DeadLetter[] = [];

  public async create(input: Parameters<JobRepository["create"]>[0]): Promise<JobRecord> {
    const existing = [...this.jobs.values()].find(
      (job) => job.idempotencyKey === input.idempotencyKey && job.capability === input.capability,
    );
    if (existing) return existing;

    const job: JobRecord = {
      id: randomUUID(),
      ...(input.familyId === undefined ? {} : { familyId: input.familyId }),
      capability: input.capability,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      status: "PENDING",
      currentAttempt: 0,
      maxAttempts: input.maxAttempts,
      nextAttemptAt: input.now,
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  public async get(id: string): Promise<JobRecord | undefined> {
    return this.jobs.get(id);
  }

  public async claim(id: string, now: number): Promise<JobRecord | undefined> {
    const job = this.jobs.get(id);
    if (!job || job.status === "CANCELLED" || job.status === "COMPLETED" || job.status === "FAILED")
      return undefined;
    if (job.nextAttemptAt > now) return undefined;
    job.status = "PROCESSING";
    job.currentAttempt += 1;
    job.updatedAt = now;
    return job;
  }

  public async cancel(id: string, now: number): Promise<JobRecord> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (job.status === "PENDING" || job.status === "DEGRADED") {
      job.status = "CANCELLED";
      job.updatedAt = now;
    }
    return job;
  }

  public async transition(
    id: string,
    status: JobStatus,
    now: number,
    details: Parameters<JobRepository["transition"]>[3] = {},
  ): Promise<JobRecord> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    job.status = status;
    job.updatedAt = now;
    if (details.result !== undefined) job.result = details.result;
    if (details.errorCode !== undefined) job.lastErrorCode = details.errorCode;
    if (details.errorClass !== undefined) job.lastErrorClass = details.errorClass;
    if (details.nextAttemptAt !== undefined) job.nextAttemptAt = details.nextAttemptAt;
    return job;
  }

  public async addAttempt(attempt: JobAttempt): Promise<void> {
    this.attempts.set(attempt.id, attempt);
  }

  public async updateAttempt(
    id: string,
    update: Parameters<JobRepository["updateAttempt"]>[1],
  ): Promise<void> {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error(`Attempt ${id} not found`);
    Object.assign(attempt, update);
  }

  public async addDeadLetter(deadLetter: DeadLetter): Promise<void> {
    this.deadLetters.push(deadLetter);
  }

  public async listDeadLetters(): Promise<readonly DeadLetter[]> {
    return [...this.deadLetters];
  }
}

export class InMemoryInboxRepository implements InboxRepository {
  private readonly entries = new Map<string, boolean>();

  public async begin(consumerName: string, eventId: string, now: number): Promise<boolean> {
    void now;
    const key = `${consumerName}:${eventId}`;
    if (this.entries.get(key) === true) return false;
    this.entries.set(key, false);
    return true;
  }

  public async complete(consumerName: string, eventId: string, now: number): Promise<void> {
    void now;
    const key = `${consumerName}:${eventId}`;
    if (!this.entries.has(key)) throw new Error(`Inbox entry ${key} was not started`);
    this.entries.set(key, true);
  }
}
