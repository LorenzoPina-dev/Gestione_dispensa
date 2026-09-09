import { createApiServer } from "./http.js";
import { JsonLogSink, RuntimeObservability } from "@gestione-dispensa/observability";

const port = Number(process.env.PORT ?? 3000);
const version = process.env.APP_VERSION ?? "0.1.0-local";
const server = createApiServer({
  version,
  profile: process.env.APP_ENV ?? "local",
});
const observability = new RuntimeObservability(
  "api",
  new JsonLogSink({ write: (line) => process.stdout.write(line) }),
);

server.listen(port, "0.0.0.0", () => {
  observability.logger({ requestId: "system", traceId: "startup" }).info("api_started", {
    port,
    version,
  });
});

function shutdown(signal: string): void {
  observability.logger({ requestId: "system", traceId: "shutdown" }).info("api_shutdown", {
    signal,
  });
  server.close((error) => {
    if (error) {
      observability
        .logger({ requestId: "system", traceId: "shutdown" })
        .error("api_shutdown_failed", { error: error.message });
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
