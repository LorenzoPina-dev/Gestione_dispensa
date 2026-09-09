import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface ApiServerOptions {
  version: string;
  profile: string;
  startedAt?: string;
}

export function createApiServer(options: ApiServerOptions) {
  const startedAt = options.startedAt ?? new Date().toISOString();

  return createServer((request, response) => {
    const requestId = readRequestId(request);
    const traceId = readTraceId(request);
    const meta = { requestId, traceId, schemaVersion: "1.0" as const };
    response.setHeader("x-request-id", requestId);
    response.setHeader("traceparent", `00-${traceId}-0000000000000001-01`);

    const path = new URL(request.url ?? "/", "http://api.local").pathname;
    if (request.method !== "GET") {
      writeJson(
        response,
        405,
        failure("METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", meta),
      );
      return;
    }

    if (path === "/health/live") {
      writeJson(response, 200, {
        data: { status: "ok", service: "api", version: options.version },
        meta,
      });
      return;
    }

    if (path === "/health/ready") {
      writeJson(response, 200, {
        data: {
          status: "ready",
          service: "api",
          version: options.version,
          dependencies: { postgres: "not-configured", redis: "not-configured" },
        },
        meta,
      });
      return;
    }

    if (path === "/api/v1/meta") {
      writeJson(response, 200, {
        data: {
          name: "gestione-dispensa-api",
          version: options.version,
          contract: "api/v1",
          profile: options.profile,
          startedAt,
        },
        meta,
      });
      return;
    }

    writeJson(
      response,
      404,
      failure("NOT_FOUND_OR_NOT_VISIBLE", "The resource is not available.", meta),
    );
  });
}

function readRequestId(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"]?.toString().trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

function readTraceId(request: IncomingMessage): string {
  const candidate = request.headers["x-trace-id"]?.toString().trim();
  return candidate && /^[0-9a-f]{16,128}$/i.test(candidate)
    ? candidate
    : randomUUID().replaceAll("-", "");
}

function failure(
  code: string,
  message: string,
  meta: { requestId: string; traceId: string; schemaVersion: "1.0" },
) {
  return { error: { code, message, retryable: false, details: [] }, meta };
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
