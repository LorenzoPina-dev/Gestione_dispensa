import { randomUUID } from "node:crypto";

export const TASK_TYPES = ["EXPIRY_SCAN", "RECONCILIATION", "RETENTION", "BACKUP_TRIGGER"] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type RunStatus = "PROCESSING" | "COMPLETED" | "FAILED" | "DEGRADED";

export interface ScheduleDefinition {
  readonly id: string;
  readonly task: TaskType;
  readonly intervalMs: number;
  nextRunAt: number;
  enabled: boolean;
}

export interface ScheduleRun {
  readonly id: string;
  readonly scheduleId: string;
  readonly task: TaskType;
  readonly scheduledAt: number;
  readonly startedAt: number;
  readonly traceId: string;
  status: RunStatus;
  finishedAt?: number;
  durationMs?: number;
  errorCode?: string;
}

export interface SchedulerRepository {
  acquireLock(scheduleId: string, ownerId: string, now: number, leaseMs: number): Promise<boolean>;
  releaseLock(scheduleId: string, ownerId: string): Promise<void>;
  recordRun(run: ScheduleRun): Promise<void>;
  finishRun(
    runId: string,
    update: Pick<ScheduleRun, "status"> &
      Partial<Pick<ScheduleRun, "finishedAt" | "durationMs" | "errorCode">>,
  ): Promise<void>;
}

export interface SchedulerTaskContext {
  readonly schedule: Readonly<ScheduleDefinition>;
  readonly run: Readonly<ScheduleRun>;
}

export type SchedulerTask = (context: SchedulerTaskContext) => Promise<void>;

export interface SchedulerOptions {
  readonly ownerId: string;
  readonly repository: SchedulerRepository;
  readonly leaseMs: number;
  readonly now?: () => number;
  readonly traceId?: () => string;
}

export class Scheduler {
  private stopped = false;

  public constructor(
    private readonly schedules: ScheduleDefinition[],
    private readonly tasks: Readonly<Partial<Record<TaskType, SchedulerTask>>>,
    private readonly options: SchedulerOptions,
  ) {}

  public async tick(now = this.clock()): Promise<readonly ScheduleRun[]> {
    if (this.stopped) return [];
    const runs: ScheduleRun[] = [];
    for (const schedule of this.schedules) {
      if (!schedule.enabled || schedule.nextRunAt > now) continue;
      const run = await this.runSchedule(schedule, now);
      if (run !== undefined) runs.push(run);
    }
    return runs;
  }

  public stop(): void {
    this.stopped = true;
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  private async runSchedule(
    schedule: ScheduleDefinition,
    now: number,
  ): Promise<ScheduleRun | undefined> {
    const locked = await this.options.repository.acquireLock(
      schedule.id,
      this.options.ownerId,
      now,
      this.options.leaseMs,
    );
    if (!locked) return undefined;

    const scheduledAt = schedule.nextRunAt;
    schedule.nextRunAt = now + schedule.intervalMs;
    const run: ScheduleRun = {
      id: randomUUID(),
      scheduleId: schedule.id,
      task: schedule.task,
      scheduledAt,
      startedAt: now,
      traceId: this.options.traceId?.() ?? randomUUID(),
      status: "PROCESSING",
    };
    await this.options.repository.recordRun(run);
    const task = this.tasks[schedule.task];
    try {
      if (task === undefined) {
        await this.options.repository.finishRun(run.id, {
          status: "DEGRADED",
          finishedAt: this.clock(),
          durationMs: this.clock() - run.startedAt,
          errorCode: "TASK_NOT_CONFIGURED",
        });
        return { ...run, status: "DEGRADED", errorCode: "TASK_NOT_CONFIGURED" };
      }
      await task({ schedule, run });
      const finishedAt = this.clock();
      await this.options.repository.finishRun(run.id, {
        status: "COMPLETED",
        finishedAt,
        durationMs: finishedAt - run.startedAt,
      });
      return { ...run, status: "COMPLETED", finishedAt, durationMs: finishedAt - run.startedAt };
    } catch (error: unknown) {
      const finishedAt = this.clock();
      const errorCode = error instanceof Error ? error.name : "SCHEDULER_TASK_FAILED";
      await this.options.repository.finishRun(run.id, {
        status: "FAILED",
        finishedAt,
        durationMs: finishedAt - run.startedAt,
        errorCode,
      });
      return {
        ...run,
        status: "FAILED",
        finishedAt,
        durationMs: finishedAt - run.startedAt,
        errorCode,
      };
    } finally {
      await this.options.repository.releaseLock(schedule.id, this.options.ownerId);
    }
  }

  private clock(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export class InMemorySchedulerRepository implements SchedulerRepository {
  private readonly locks = new Map<string, { ownerId: string; expiresAt: number }>();
  public readonly runs = new Map<string, ScheduleRun>();
  public readonly audit: { runId: string; status: RunStatus; traceId: string }[] = [];
  public now = 0;

  public async acquireLock(
    scheduleId: string,
    ownerId: string,
    now: number,
    leaseMs: number,
  ): Promise<boolean> {
    const existing = this.locks.get(scheduleId);
    if (existing !== undefined && existing.expiresAt > now && existing.ownerId !== ownerId)
      return false;
    this.locks.set(scheduleId, { ownerId, expiresAt: now + leaseMs });
    return true;
  }

  public async releaseLock(scheduleId: string, ownerId: string): Promise<void> {
    if (this.locks.get(scheduleId)?.ownerId === ownerId) this.locks.delete(scheduleId);
  }

  public async recordRun(run: ScheduleRun): Promise<void> {
    this.runs.set(run.id, { ...run });
    this.audit.push({ runId: run.id, status: run.status, traceId: run.traceId });
  }

  public async finishRun(
    runId: string,
    update: Pick<ScheduleRun, "status"> &
      Partial<Pick<ScheduleRun, "finishedAt" | "durationMs" | "errorCode">>,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) throw new Error(`Run ${runId} not found`);
    Object.assign(run, update);
    this.audit.push({ runId, status: run.status, traceId: run.traceId });
  }
}
