import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const version = process.env.APP_VERSION ?? "0.1.0-local";
const startedAt = new Date().toISOString();

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function requestId(request: IncomingMessage): string {
  return request.headers["x-request-id"]?.toString() ?? crypto.randomUUID();
}

const server = createServer((request, response) => {
  const id = requestId(request);
  response.setHeader("x-request-id", id);

  if (request.method !== "GET") {
    writeJson(response, 405, { error: "method_not_allowed", requestId: id });
    return;
  }

  if (request.url === "/health/live") {
    writeJson(response, 200, { status: "ok", service: "api", version });
    return;
  }

  if (request.url === "/health/ready") {
    writeJson(response, 200, {
      status: "ready",
      service: "api",
      version,
      dependencies: { postgres: "not-configured", redis: "not-configured" },
    });
    return;
  }

  if (request.url === "/api/v1/meta") {
    writeJson(response, 200, {
      name: "gestione-dispensa-api",
      version,
      contract: "api/v1",
      profile: process.env.APP_ENV ?? "local",
      startedAt,
    });
    return;
  }

  writeJson(response, 404, { error: "not_found", requestId: id });
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "api_started", port, version }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ event: "api_shutdown", signal }));
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
