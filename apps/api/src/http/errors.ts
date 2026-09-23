/**
 * HTTP-error mappers for the domains whose service layer doesn't already ship its own
 * `toXxxHttpError` (family/inventory/catalog/shopping/notifications/nutrition/recipes each
 * export their own next to their controller — see the imports in each route module).
 */
import { JobAdminError } from "../jobs/admin.js";
import { PrivacyErasureError } from "../privacy/erasure.js";
import { PrivacyExportError } from "../privacy/export.js";
import { RegistrationError } from "../identity/register.js";
import type { HttpErrorBody, HttpMeta } from "./envelope.js";

export function toRegistrationHttpError(error: unknown, meta: HttpMeta): { status: number; body: HttpErrorBody } {
  if (error instanceof RegistrationError) {
    const status = error.code === "USER_ALREADY_EXISTS" ? 409 : error.code === "AUTH_SERVICE_UNAVAILABLE" ? 503 : 400;
    return {
      status,
      body: { error: { code: error.code, message: error.message, retryable: error.code === "AUTH_SERVICE_UNAVAILABLE" }, meta },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}

export function toJobAdminHttpError(error: unknown, meta: HttpMeta): { status: number; body: HttpErrorBody } {
  if (error instanceof JobAdminError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND_OR_NOT_VISIBLE"
            ? 404
            : error.code === "APPROVAL_REQUIRED"
              ? 422
              : 500;
    return { status, body: { error: { code: error.code, message: error.message, retryable: false }, meta } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}

export function toPrivacyErasureHttpError(error: unknown, meta: HttpMeta): { status: number; body: HttpErrorBody } {
  if (error instanceof PrivacyErasureError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND_OR_NOT_VISIBLE"
            ? 404
            : error.code === "CONFIRMATION_REQUIRED" || error.code === "INVALID_CONSENT"
              ? 422
              : 500;
    return { status, body: { error: { code: error.code, message: error.message, retryable: false }, meta } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}

export function toPrivacyExportHttpError(error: unknown, meta: HttpMeta): { status: number; body: HttpErrorBody } {
  if (error instanceof PrivacyExportError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND_OR_NOT_VISIBLE"
            ? 404
            : error.code === "EXPORT_EXPIRED"
              ? 410
              : 500;
    return { status, body: { error: { code: error.code, message: error.message, retryable: false }, meta } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}
