import { createApiServer } from "./http.js";

const port = Number(process.env.PORT ?? 3000);
const version = process.env.APP_VERSION ?? "0.1.0-local";
const server = createApiServer({
  version,
  profile: process.env.APP_ENV ?? "local",
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "api_started", port, version }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ event: "api_shutdown", signal }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ event: "api_shutdown_failed", error: error.message }));
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
