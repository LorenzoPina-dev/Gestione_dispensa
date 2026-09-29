import { authorize } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";

export interface JobSnapshot {
  readonly id: string;
  readonly familyId?: string;
  readonly capability: string;
  readonly status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" | "DEGRADED";
  readonly currentAttempt: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: number;
  readonly lastErrorCode?: string;
  readonly lastErrorClass?: "TRANSIENT" | "PERMANENT";
  readonly traceId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DeadLetterSnapshot {
  readonly id: string;
  readonly jobId: string;
  readonly queue: string;
  readonly reason: string;
  readonly errorCode?: string;
  readonly errorClass?: "TRANSIENT" | "PERMANENT";
  readonly attempts: number;
  readonly replayCount: number;
  readonly failedAt: number;
  readonly originalCreatedAt: number;
}

export interface JobAdminRepository {
  getJob(id: string): Promise<JobSnapshot | undefined>;
  getDeadLetter(id: string): Promise<DeadLetterSnapshot | undefined>;
  recordReplay(input: {
    readonly deadLetterId: string;
    readonly replayId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly approvalId: string;
    readonly replayedAt: number;
  }): Promise<void>;
}

export interface JobReplayPublisher {
  publish(input: {
    readonly replayId: string;
    readonly jobId: string;
    readonly queue: string;
    readonly traceId?: string;
  }): Promise<void>;
}

export interface SecurityAuditWriter {
  append(input: {
    readonly actorId: string;
    readonly action: "job.read" | "dlq.replay";
    readonly resourceId: string;
    readonly outcome: "SUCCESS" | "DENIED" | "FAILED";
    readonly reason?: string;
    readonly traceId: string;
  }): Promise<void>;
}

export class JobAdminError extends Error {
  public readonly code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND_OR_NOT_VISIBLE"
    | "APPROVAL_REQUIRED"
    | "REPLAY_FAILED";

  public constructor(code: JobAdminError["code"], message: string) {
    super(message);
    this.name = "JobAdminError";
    this.code = code;
  }
}

export class JobAdministrationService {
  private readonly repository: JobAdminRepository;
  private readonly publisher: JobReplayPublisher;
  private readonly audit: SecurityAuditWriter;
  private readonly ids: () => string;
  private readonly now: () => number;

  public constructor(
    repository: JobAdminRepository,
    publisher: JobReplayPublisher,
    audit: SecurityAuditWriter,
    ids: () => string,
    now: () => number,
  ) {
    this.repository = repository;
    this.publisher = publisher;
    this.audit = audit;
    this.ids = ids;
    this.now = now;
  }

  public async inspect(
    principal: Principal | undefined,
    jobId: string,
    traceId: string,
  ): Promise<JobSnapshot> {
    const actor = await this.assertOperator(principal, "job.read", jobId, traceId);
    const job = await this.repository.getJob(jobId);
    if (job === undefined) {
      await this.audit.append({
        actorId: actor.subject,
        action: "job.read",
        resourceId: jobId,
        outcome: "DENIED",
        reason: "NOT_FOUND_OR_NOT_VISIBLE",
        traceId,
      });
      throw new JobAdminError("NOT_FOUND_OR_NOT_VISIBLE", "Job is not visible.");
    }
    await this.audit.append({
      actorId: actor.subject,
      action: "job.read",
      resourceId: jobId,
      outcome: "SUCCESS",
      traceId,
    });
    return job;
  }

  public async replay(
    principal: Principal | undefined,
    deadLetterId: string,
    input: { readonly reason: string; readonly approvalId: string; readonly traceId: string },
  ): Promise<{ replayId: string; jobId: string }> {
    const actor = await this.assertOperator(principal, "dlq.replay", deadLetterId, input.traceId);
    if (!input.reason.trim() || !input.approvalId.trim()) {
      throw new JobAdminError("APPROVAL_REQUIRED", "Replay reason and approval are required.");
    }
    const deadLetter = await this.repository.getDeadLetter(deadLetterId);
    if (deadLetter === undefined)
      throw new JobAdminError("NOT_FOUND_OR_NOT_VISIBLE", "Dead letter is not visible.");
    const replayId = this.ids();
    try {
      await this.repository.recordReplay({
        deadLetterId,
        replayId,
        actorId: actor.subject,
        reason: input.reason.trim(),
        approvalId: input.approvalId.trim(),
        replayedAt: this.now(),
      });
      await this.publisher.publish({
        replayId,
        jobId: deadLetter.jobId,
        queue: deadLetter.queue,
      });
      await this.audit.append({
        actorId: actor.subject,
        action: "dlq.replay",
        resourceId: deadLetterId,
        outcome: "SUCCESS",
        reason: input.reason.trim(),
        traceId: input.traceId,
      });
      return { replayId, jobId: deadLetter.jobId };
    } catch (error) {
      await this.audit.append({
        actorId: actor.subject,
        action: "dlq.replay",
        resourceId: deadLetterId,
        outcome: "FAILED",
        reason: error instanceof Error ? error.message : "REPLAY_FAILED",
        traceId: input.traceId,
      });
      throw new JobAdminError("REPLAY_FAILED", "The dead letter could not be replayed.");
    }
  }

  private async assertOperator(
    principal: Principal | undefined,
    action: "job.read" | "dlq.replay",
    resourceId: string,
    traceId: string,
  ): Promise<Principal> {
    const decision = authorize({ principal, action: "operator" });
    if (decision.allowed && principal !== undefined) return principal;
    await this.audit.append({
      actorId: principal?.subject ?? "anonymous",
      action,
      resourceId,
      outcome: "DENIED",
      reason: decision.code,
      traceId,
    });
    throw new JobAdminError(
      decision.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
      "Operator authorization is required.",
    );
  }
}
