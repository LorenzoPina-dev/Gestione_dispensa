import {
  Scheduler,
  type ScheduleRun,
  type SchedulerTask,
  type SchedulerOptions,
  type ScheduleDefinition,
  type SchedulerRepository,
  type TaskType,
} from "./scheduler.js";

export interface SchedulerProcessOptions extends SchedulerOptions {
  readonly schedules: ScheduleDefinition[];
  readonly tasks: Readonly<Partial<Record<TaskType, SchedulerTask>>>;
  readonly pollIntervalMs: number;
  readonly onRuns?: (runs: readonly ScheduleRun[]) => void;
}

export interface SchedulerProcess {
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
  scheduler: Scheduler;
}

export function createSchedulerProcess(options: SchedulerProcessOptions): SchedulerProcess {
  if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs <= 0)
    throw new Error("Scheduler poll interval must be a positive integer.");

  const scheduler = new Scheduler(options.schedules, options.tasks, options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let tickPromise: Promise<void> | undefined;

  const scheduleNext = (): void => {
    if (!running) return;
    timer = setTimeout(() => {
      tickPromise = scheduler
        .tick()
        .then((runs) => options.onRuns?.(runs))
        .finally(() => {
          tickPromise = undefined;
          scheduleNext();
        });
    }, options.pollIntervalMs);
  };

  return {
    scheduler,
    start(): void {
      if (running) return;
      running = true;
      scheduleNext();
    },
    async stop(): Promise<void> {
      running = false;
      scheduler.stop();
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await tickPromise;
    },
    isRunning(): boolean {
      return running;
    },
  };
}

export function createSchedulerProcessFromEnvironment(
  repository: SchedulerRepository,
  schedules: ScheduleDefinition[],
  tasks: Readonly<Partial<Record<TaskType, SchedulerTask>>>,
): SchedulerProcess {
  const pollIntervalMs = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 1_000);
  const ownerId = process.env.SCHEDULER_OWNER_ID ?? `scheduler-${process.pid}`;
  return createSchedulerProcess({
    ownerId,
    repository,
    schedules,
    tasks,
    leaseMs: Number(process.env.SCHEDULER_LEASE_MS ?? 30_000),
    pollIntervalMs,
  });
}
