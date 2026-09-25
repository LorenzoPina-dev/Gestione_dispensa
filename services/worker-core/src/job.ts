export const JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEGRADED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type ErrorClass = "TRANSIENT" | "PERMANENT";

export interface JobRecord {
  readonly id: string;
  readonly familyId?: string;
  readonly capability: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  status: JobStatus;
  currentAttempt: number;
  readonly maxAttempts: number;
  nextAttemptAt: number;
  result?: Readonly<Record<string, unknown>>;
  lastErrorCode?: string;
  lastErrorClass?: ErrorClass;
  readonly traceId?: string;
  readonly createdAt: number;
  updatedAt: number;
}

export interface JobAttempt {
  readonly id: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly startedAt: number;
  finishedAt?: number | undefined;
  status: JobStatus;
  errorCode?: string | undefined;
  errorClass?: ErrorClass | undefined;
  durationMs?: number | undefined;
}

export interface DeadLetter {
  readonly id: string;
  readonly jobId: string;
  readonly queue: string;
  readonly reason: string;
  readonly errorCode?: string | undefined;
  readonly errorClass?: ErrorClass | undefined;
  readonly attempts: number;
  readonly replayCount: number;
  readonly failedAt: number;
  readonly originalCreatedAt: number;
}

export interface JobHandlerContext {
  readonly job: Readonly<JobRecord>;
  readonly attempt: Readonly<JobAttempt>;
}

export type JobHandler = (
  context: JobHandlerContext,
) => Promise<Readonly<Record<string, unknown>> | void>;

export class JobError extends Error {
  public readonly code: string;
  public readonly classification: ErrorClass;

  public constructor(code: string, classification: ErrorClass, message: string) {
    super(message);
    this.name = "JobError";
    this.code = code;
    this.classification = classification;
  }
}

export function classifyError(error: unknown): { code: string; classification: ErrorClass } {
  if (error instanceof JobError) {
    return { code: error.code, classification: error.classification };
  }

  return { code: "UNCLASSIFIED_FAILURE", classification: "PERMANENT" };
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  const transitions: Record<JobStatus, readonly JobStatus[]> = {
    PENDING: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["PENDING", "COMPLETED", "FAILED", "CANCELLED", "DEGRADED"],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
    DEGRADED: ["PENDING", "CANCELLED"],
  };

  return transitions[from].includes(to);
}
