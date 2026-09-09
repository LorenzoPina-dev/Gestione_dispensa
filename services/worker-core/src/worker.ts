import { randomUUID } from "node:crypto";
import type { JobHandler, JobRecord } from "./job.js";
import { classifyError } from "./job.js";
import type { JobRepository } from "./repository.js";
import type { QueueAdapter, QueueMessage } from "./queue.js";
import type { MetricsSink } from "./metrics.js";

export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export interface WorkerOptions {
  readonly queueName: string;
  readonly consumerName: string;
  readonly repository: JobRepository;
  readonly inbox: {
    begin(consumerName: string, eventId: string, now: number): Promise<boolean>;
    complete(consumerName: string, eventId: string, now: number): Promise<void>;
  };
  readonly queue: QueueAdapter<{ jobId: string }>;
  readonly metrics: MetricsSink;
  readonly retryPolicy: RetryPolicy;
  readonly now?: () => number;
  readonly random?: () => number;
}

export class JobWorker {
  private stopping = false;
  private retries = 0;

  public constructor(private readonly options: WorkerOptions) {}

  public async processNext(handler: JobHandler): Promise<boolean> {
    if (this.stopping) return false;
    const message = await this.options.queue.receive();
    if (!message) {
      await this.emitMetrics();
      return false;
    }

    const now = this.clock();
    const shouldProcess = await this.options.inbox.begin(
      this.options.consumerName,
      message.id,
      now,
    );
    if (!shouldProcess) {
      await this.options.queue.ack(message.id);
      await this.emitMetrics();
      return true;
    }

    const job = await this.options.repository.claim(message.payload.jobId, now);
    if (!job) {
      await this.options.inbox.complete(this.options.consumerName, message.id, now);
      await this.options.queue.ack(message.id);
      await this.emitMetrics();
      return true;
    }

    const attemptId = randomUUID();
    await this.options.repository.addAttempt({
      id: attemptId,
      jobId: job.id,
      attempt: job.currentAttempt,
      startedAt: now,
      status: "PROCESSING",
    });

    try {
      const result = await handler({
        job,
        attempt: {
          id: attemptId,
          jobId: job.id,
          attempt: job.currentAttempt,
          startedAt: now,
          status: "PROCESSING",
        },
      });
      const finishedAt = this.clock();
      await this.options.repository.updateAttempt(attemptId, {
        finishedAt,
        status: "COMPLETED",
        durationMs: finishedAt - now,
      });
      const completion = result === undefined ? {} : { result };
      await this.options.repository.transition(job.id, "COMPLETED", finishedAt, completion);
      await this.options.inbox.complete(this.options.consumerName, message.id, finishedAt);
      await this.options.queue.ack(message.id);
    } catch (error: unknown) {
      const failure = classifyError(error);
      const finishedAt = this.clock();
      const retry = failure.classification === "TRANSIENT" && job.currentAttempt < job.maxAttempts;
      await this.options.repository.updateAttempt(attemptId, {
        finishedAt,
        status: retry ? "PENDING" : "FAILED",
        errorCode: failure.code,
        errorClass: failure.classification,
        durationMs: finishedAt - now,
      });
      if (retry) {
        this.retries += 1;
        const nextAttemptAt = finishedAt + this.backoff(job.currentAttempt);
        await this.options.repository.transition(job.id, "PENDING", finishedAt, {
          errorCode: failure.code,
          errorClass: failure.classification,
          nextAttemptAt,
        });
        await this.options.queue.nack(message.id);
      } else {
        await this.options.repository.transition(job.id, "FAILED", finishedAt, {
          errorCode: failure.code,
          errorClass: failure.classification,
        });
        await this.options.repository.addDeadLetter({
          id: randomUUID(),
          jobId: job.id,
          queue: this.options.queueName,
          reason: "JOB_ATTEMPTS_EXHAUSTED",
          errorCode: failure.code,
          errorClass: failure.classification,
          attempts: job.currentAttempt,
          replayCount: 0,
          failedAt: finishedAt,
          originalCreatedAt: job.createdAt,
        });
        await this.options.inbox.complete(this.options.consumerName, message.id, finishedAt);
        await this.options.queue.ack(message.id);
      }
    }
    await this.emitMetrics();
    return true;
  }

  public stop(): void {
    this.stopping = true;
  }

  public isStopping(): boolean {
    return this.stopping;
  }

  public async cancel(jobId: string): Promise<void> {
    await this.options.repository.cancel(jobId, this.clock());
  }

  private backoff(attempt: number): number {
    const { baseDelayMs, maxDelayMs, jitterRatio } = this.options.retryPolicy;
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
    const jitter = exponential * jitterRatio * (this.random() * 2 - 1);
    return Math.max(0, Math.round(exponential + jitter));
  }

  private async emitMetrics(): Promise<void> {
    const deadLetters = await this.options.repository.listDeadLetters();
    const [backlog, oldestEnqueuedAt] = await Promise.all([
      this.options.queue.size(),
      this.options.queue.oldestEnqueuedAt(),
    ]);
    this.options.metrics.observe({
      backlog,
      retryTotal: this.retries,
      dlqSize: deadLetters.length,
      oldestAgeMs:
        oldestEnqueuedAt === undefined ? 0 : Math.max(0, this.clock() - oldestEnqueuedAt),
    });
  }

  private clock(): number {
    return this.options.now?.() ?? Date.now();
  }

  private random(): number {
    return this.options.random?.() ?? Math.random();
  }
}

export function jobMessage(job: JobRecord, queue: string): QueueMessage<{ jobId: string }> {
  return { id: job.id, queue, payload: { jobId: job.id }, enqueuedAt: job.createdAt };
}
