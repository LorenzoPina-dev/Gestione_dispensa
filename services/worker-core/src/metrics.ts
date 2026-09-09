export interface QueueMetrics {
  readonly backlog: number;
  readonly retryTotal: number;
  readonly dlqSize: number;
  readonly oldestAgeMs: number;
}

export interface MetricsSink {
  observe(metrics: QueueMetrics): void;
}

export class InMemoryMetrics implements MetricsSink {
  public latest: QueueMetrics = { backlog: 0, retryTotal: 0, dlqSize: 0, oldestAgeMs: 0 };

  public observe(metrics: QueueMetrics): void {
    this.latest = metrics;
  }
}
