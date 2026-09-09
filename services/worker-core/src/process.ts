import { JobError, type JobHandler } from "./job.js";
import { JobWorker } from "./worker.js";

export interface WorkerSignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
}

export interface WorkerProcessOptions {
  readonly worker: JobWorker;
  readonly handlers: ReadonlyMap<string, JobHandler>;
  readonly pollIntervalMs: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly signals?: WorkerSignalSource;
}

export class WorkerProcess {
  private readonly worker: JobWorker;
  private readonly handlers: ReadonlyMap<string, JobHandler>;
  private readonly pollIntervalMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly signals: WorkerSignalSource | undefined;
  private stopping = false;
  private running: Promise<void> | undefined;
  private readonly stopListener = (): void => {
    this.stop();
  };

  public constructor(options: WorkerProcessOptions) {
    if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs < 0)
      throw new Error("Worker poll interval must be a non-negative integer.");
    this.worker = options.worker;
    this.handlers = options.handlers;
    this.pollIntervalMs = options.pollIntervalMs;
    this.sleep = options.sleep ?? delay;
    this.signals = options.signals;
  }

  public async run(): Promise<void> {
    if (this.running !== undefined) return this.running;
    this.stopping = false;
    this.signals?.on("SIGINT", this.stopListener);
    this.signals?.on("SIGTERM", this.stopListener);
    this.running = this.loop().finally(() => {
      this.signals?.off("SIGINT", this.stopListener);
      this.signals?.off("SIGTERM", this.stopListener);
      this.running = undefined;
    });
    return this.running;
  }

  public stop(): void {
    this.stopping = true;
    this.worker.stop();
  }

  public isStopping(): boolean {
    return this.stopping;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      const processed = await this.processNext();
      if (!processed && !this.stopping) await this.sleep(this.pollIntervalMs);
    }
  }

  private async processNext(): Promise<boolean> {
    return this.worker.processNextWithResolver((job) => {
      return this.handlers.get(job.capability) ?? unsupportedHandler(job.capability);
    });
  }
}

function unsupportedHandler(capability: string): JobHandler {
  return async () => {
    throw new JobError(
      "UNSUPPORTED_CAPABILITY",
      "PERMANENT",
      `No worker handler is registered for capability ${capability}.`,
    );
  };
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
