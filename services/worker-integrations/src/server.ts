import express, { type Request, type Response } from "express";

/**
 * Operational integration worker.
 *
 * Domain capabilities are owned by their dedicated microservices. This process only exposes
 * health endpoints and hosts asynchronous provider adapters that have not yet been promoted to
 * a dedicated domain service. It must not contain catalog/inventory/domain persistence logic.
 */

const PORT = Number(process.env.WORKER_INTEGRATIONS_PORT ?? 3100);

function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level, event, service: "worker-integrations", ts: new Date().toISOString(), ...fields })}\n`,
  );
}

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/ready", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  log("info", "worker_integrations_started", { port: PORT });
});

// Last-resort safety nets. This service is intentionally disposable: on a truly unexpected
// error we log and exit, and Docker's `restart: unless-stopped` policy brings it back up. We
// never try to "limp along" after an uncaught exception, since that risks serving corrupted state.
process.on("uncaughtException", (error) => {
  log("error", "uncaught_exception", { error: error.message, stack: error.stack });
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
});
process.on("unhandledRejection", (reason) => {
  log("error", "unhandled_rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

function shutdown(signal: string): void {
  log("info", "worker_integrations_shutdown", { signal });
  server.close(() => process.exit(0));
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
