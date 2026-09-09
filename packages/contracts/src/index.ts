export interface ApiMeta {
  requestId: string;
  traceId: string;
  schemaVersion: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details: readonly Record<string, unknown>[];
  retryable: boolean;
}

export interface ApiErrorResponse {
  error: ApiError;
  meta: ApiMeta;
}

export interface ApiJobReference {
  jobId: string;
  status:
    "PENDING" | "PROCESSING" | "PENDING_REVIEW" | "COMPLETED" | "FAILED" | "CANCELLED" | "DEGRADED";
  statusUrl: string;
}

export interface IdempotencyHeaders {
  "Idempotency-Key": string;
}

export interface VersionHeaders {
  "If-Match": string;
}

export interface HttpContractRoute {
  operationId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  scope: string;
  idempotent: boolean;
  familyIsolated: boolean;
}

export const API_SCHEMA_VERSION = "1.0" as const;

export interface EventEnvelope {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  publishedAt: string | null;
  aggregateType: string;
  aggregateId: string;
  householdId: string;
  actorType: "USER" | "SERVICE" | "SYSTEM";
  actorId: string | null;
  traceId: string;
  schemaRef: string;
  payload: Record<string, unknown>;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly ValidationIssue[];
}

export function validateEventEnvelope(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return invalid("$", "Event envelope must be an object.");
  }

  const requiredFields = [
    "eventId",
    "eventType",
    "eventVersion",
    "occurredAt",
    "aggregateType",
    "aggregateId",
    "householdId",
    "actorType",
    "traceId",
    "schemaRef",
    "payload",
  ];
  const missing = requiredFields
    .filter((field) => !(field in value))
    .map((field) => ({ path: `$.${field}`, message: "Required field is missing." }));

  if (missing.length > 0) {
    return { valid: false, issues: missing };
  }

  const issues: ValidationIssue[] = [];
  if (typeof value.eventType !== "string" || !/^[a-z0-9.-]+$/.test(value.eventType)) {
    issues.push({ path: "$.eventType", message: "Event type must use the canonical format." });
  }
  if (
    typeof value.eventVersion !== "number" ||
    !Number.isInteger(value.eventVersion) ||
    value.eventVersion < 1
  ) {
    issues.push({ path: "$.eventVersion", message: "Event version must be a positive integer." });
  }
  if (typeof value.householdId !== "string" || value.householdId.length === 0) {
    issues.push({ path: "$.householdId", message: "Household scope is required." });
  }
  if (!isRecord(value.payload)) {
    issues.push({ path: "$.payload", message: "Payload must be an object." });
  }

  return { valid: issues.length === 0, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, message: string): ValidationResult {
  return { valid: false, issues: [{ path, message }] };
}
