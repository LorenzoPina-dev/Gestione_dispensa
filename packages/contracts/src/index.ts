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

export interface JsonSchemaDocument {
  type?: string | readonly string[];
  required?: readonly string[];
  properties?: Record<string, JsonSchemaDocument>;
  additionalProperties?: boolean;
  enum?: readonly unknown[];
  const?: unknown;
  minLength?: number;
  minItems?: number;
  uniqueItems?: boolean;
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

export function validateJobEnvelope(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return invalid("$", "Job must be an object.");
  }

  const requiredFields = [
    "jobId",
    "capability",
    "status",
    "attempt",
    "traceId",
    "createdAt",
    "updatedAt",
  ];
  const issues = requiredFields
    .filter((field) => !(field in value))
    .map((field) => ({ path: `$.${field}`, message: "Required field is missing." }));

  if (typeof value.capability !== "string" || value.capability.length === 0) {
    issues.push({ path: "$.capability", message: "Capability is required." });
  }
  if (
    typeof value.status !== "string" ||
    ![
      "PENDING",
      "PROCESSING",
      "PENDING_REVIEW",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "DEGRADED",
    ].includes(value.status)
  ) {
    issues.push({ path: "$.status", message: "Job status is invalid." });
  }
  if (typeof value.attempt !== "number" || !Number.isInteger(value.attempt) || value.attempt < 0) {
    issues.push({ path: "$.attempt", message: "Attempt must be a non-negative integer." });
  }
  if (typeof value.traceId !== "string" || value.traceId.length < 16) {
    issues.push({ path: "$.traceId", message: "Trace ID is required." });
  }

  return { valid: issues.length === 0, issues };
}

export function validateJsonSchema(value: unknown, schema: JsonSchemaDocument): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateSchemaValue(value, schema, "$", issues);
  return { valid: issues.length === 0, issues };
}

function validateSchemaValue(
  value: unknown,
  schema: JsonSchemaDocument,
  path: string,
  issues: ValidationIssue[],
): void {
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    issues.push({ path, message: "Value does not match const." });
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push({ path, message: "Value is not in enum." });
  }

  if (schema.type && !matchesType(value, schema.type)) {
    issues.push({ path, message: "Value has an invalid type." });
    return;
  }
  if (
    typeof value === "string" &&
    schema.minLength !== undefined &&
    value.length < schema.minLength
  ) {
    issues.push({ path, message: "String is shorter than minLength." });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({ path, message: "Array is shorter than minItems." });
    }
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    ) {
      issues.push({ path, message: "Array items must be unique." });
    }
  }
  if (isRecord(value) && schema.properties) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        issues.push({ path: `${path}.${required}`, message: "Required field is missing." });
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          issues.push({ path: `${path}.${key}`, message: "Unknown field is not allowed." });
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateSchemaValue(value[key], propertySchema, `${path}.${key}`, issues);
      }
    }
  }
}

function matchesType(value: unknown, type: string | readonly string[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    if (candidate === "null") return value === null;
    if (candidate === "object") return isRecord(value);
    if (candidate === "array") return Array.isArray(value);
    if (candidate === "integer") return typeof value === "number" && Number.isInteger(value);
    if (candidate === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === candidate;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, message: string): ValidationResult {
  return { valid: false, issues: [{ path, message }] };
}
