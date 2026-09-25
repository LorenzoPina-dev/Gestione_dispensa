export type LogLevel = "info" | "error";

/**
 * Plain structured JSON lines on stdout: no extra logging dependency, easy to pick up from
 * `docker logs` or ship to Loki, consistent with every other service in this stack.
 */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level, event, service: "off-lookup", ts: new Date().toISOString(), ...fields })}\n`,
  );
}
