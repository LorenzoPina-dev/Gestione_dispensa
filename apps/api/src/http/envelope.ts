import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { FamilyHttpMeta } from "../family/controller.js";

/** The envelope's `meta` shape is shared by every domain controller (see FamilyHttpMeta). */
export type HttpMeta = FamilyHttpMeta;

export interface HttpErrorBody {
  error: { code: string; message: string; retryable: boolean; details?: unknown[] };
  meta: HttpMeta;
}

/** Builds the `meta` block for a request from its correlation headers, generating new ids when absent. */
export function buildMeta(req: Request): HttpMeta {
  return {
    requestId: readRequestId(req),
    traceId: readTraceId(req),
    schemaVersion: "1.0",
  };
}

function readRequestId(req: Request): string {
  const candidate = req.header("x-request-id")?.trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

function readTraceId(req: Request): string {
  const candidate = req.header("x-trace-id")?.trim();
  return candidate && /^[0-9a-f]{16,128}$/i.test(candidate) ? candidate : randomUUID().replaceAll("-", "");
}

/** Sets the correlation-id response headers every route (including 404s) must carry. */
export function applyCorrelationHeaders(res: Response, meta: HttpMeta): void {
  res.setHeader("x-request-id", meta.requestId);
  res.setHeader("traceparent", `00-${meta.traceId}-0000000000000001-01`);
}

export function failure(code: string, message: string, meta: HttpMeta): HttpErrorBody {
  return { error: { code, message, retryable: false, details: [] }, meta };
}

export function sendFailure(res: Response, status: number, code: string, message: string, meta: HttpMeta): void {
  res.status(status).json(failure(code, message, meta));
}

export function sendSuccess<T>(res: Response, status: number, data: T, meta: HttpMeta): void {
  res.status(status).json({ data, meta });
}

/**
 * Awaits a controller/service call and writes its result as a 200 success envelope, or maps a
 * thrown domain error to its HTTP status/body via `toHttpError`. Every domain route follows this
 * same await-then-respond shape, so it is centralized here instead of repeated per route.
 */
export async function respond<T>(
  res: Response,
  meta: HttpMeta,
  work: Promise<{ data: T; meta: HttpMeta }>,
  toHttpError: (error: unknown, meta: HttpMeta) => { status: number; body: HttpErrorBody },
): Promise<void> {
  try {
    const result = await work;
    sendSuccess(res, 200, result.data, result.meta);
  } catch (error) {
    const { status, body } = toHttpError(error, meta);
    res.status(status).json(body);
  }
}
