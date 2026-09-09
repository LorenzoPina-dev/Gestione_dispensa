export interface RequestContext {
  requestId: string;
  traceId: string;
  spanId?: string;
  actorId?: string;
  householdId?: string;
  serviceName: string;
}

export interface LogRecord {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context: RequestContext;
  attributes: Readonly<Record<string, unknown>>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|cookie|authorization|prompt|image|food|email|phone)/i;

export class RedactingLogger {
  private readonly context: RequestContext;
  private readonly sink: LogSink;

  public constructor(context: RequestContext, sink: LogSink) {
    this.context = context;
    this.sink = sink;
  }

  public info(message: string, attributes: Record<string, unknown> = {}): void {
    this.write("info", message, attributes);
  }

  public warn(message: string, attributes: Record<string, unknown> = {}): void {
    this.write("warn", message, attributes);
  }

  public error(message: string, attributes: Record<string, unknown> = {}): void {
    this.write("error", message, attributes);
  }

  private write(
    level: LogRecord["level"],
    message: string,
    attributes: Record<string, unknown>,
  ): void {
    this.sink.write({
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      attributes: redact(attributes) as Readonly<Record<string, unknown>>,
    });
  }
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(item),
    ]),
  );
}

export class InMemoryLogSink implements LogSink {
  public readonly records: LogRecord[] = [];

  public write(record: LogRecord): void {
    this.records.push(record);
  }
}

export interface MetricSample {
  name: string;
  value: number;
  labels: Readonly<Record<string, string>>;
}

export class InMemoryMetrics {
  private readonly samples: MetricSample[] = [];

  public increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    this.assertMetric(name, value);
    this.samples.push({ name, value, labels: { ...labels } });
  }

  public observe(name: string, value: number, labels: Record<string, string> = {}): void {
    this.assertMetric(name, value);
    this.samples.push({ name, value, labels: { ...labels } });
  }

  public snapshot(): readonly MetricSample[] {
    return this.samples.map((sample) => ({ ...sample, labels: { ...sample.labels } }));
  }

  public toPrometheus(): string {
    return this.samples
      .map((sample) => `${sample.name}${formatLabels(sample.labels)} ${sample.value}`)
      .join("\n");
  }

  private assertMetric(name: string, value: number): void {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error("Metric names must use lowercase snake_case.");
    }
    if (!Number.isFinite(value)) {
      throw new Error("Metric values must be finite.");
    }
  }
}

export interface TraceHeaders {
  traceparent?: string;
}

export function parseTraceparent(
  headers: TraceHeaders,
  fallbackTraceId: string,
): Pick<RequestContext, "traceId" | "spanId"> {
  const traceparent = headers.traceparent;
  if (traceparent === undefined) {
    return { traceId: fallbackTraceId };
  }

  const match =
    /^(?<version>[0-9a-f]{2})-(?<traceId>[0-9a-f]{32})-(?<spanId>[0-9a-f]{16})-(?<flags>[0-9a-f]{2})$/i.exec(
      traceparent,
    );
  if (
    match?.groups === undefined ||
    match.groups.traceId === undefined ||
    match.groups.spanId === undefined
  ) {
    return { traceId: fallbackTraceId };
  }

  return { traceId: match.groups.traceId, spanId: match.groups.spanId };
}

export interface HealthCheck {
  name: string;
  check(): Promise<"up" | "down">;
}

export async function readiness(
  checks: readonly HealthCheck[],
): Promise<{ status: "ready" | "not_ready"; checks: Record<string, "up" | "down"> }> {
  const results = await Promise.all(
    checks.map(async (check) => [check.name, await check.check()] as const),
  );
  const statuses = Object.fromEntries(results);
  return {
    status: Object.values(statuses).every((status) => status === "up") ? "ready" : "not_ready",
    checks: statuses,
  };
}

function formatLabels(labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${value.replaceAll('"', '\\"')}"`).join(",")}}`;
}
