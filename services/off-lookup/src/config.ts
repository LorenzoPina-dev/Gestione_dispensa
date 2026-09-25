/**
 * Centralized, defensive environment configuration. Every value has a safe default so the
 * process ALWAYS starts even with a bare-minimum (or empty) environment -- misconfiguration
 * degrades behaviour (e.g. cache disabled), it never crashes startup.
 */

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw.trim().length > 0 ? raw : fallback;
}

export const config = {
  port: numEnv("OFF_LOOKUP_PORT", 3200),

  // --- MongoDB (local Open Food Facts dump + read-through cache) ---------------------------
  mongo: {
    // Empty on purpose: an unset URL means "no local database", and the service must keep
    // working by talking only to the live API (see ProductLookupService).
    url: strEnv("OFF_LOOKUP_MONGO_URL", ""),
    dbName: strEnv("OFF_LOOKUP_MONGO_DB", "off"),
    collectionName: strEnv("OFF_LOOKUP_MONGO_COLLECTION", "products"),
    connectTimeoutMs: numEnv("OFF_LOOKUP_MONGO_CONNECT_TIMEOUT_MS", 3000),
    operationTimeoutMs: numEnv("OFF_LOOKUP_MONGO_OPERATION_TIMEOUT_MS", 800),
    maxConsecutiveFailures: numEnv("OFF_LOOKUP_MONGO_MAX_CONSECUTIVE_FAILURES", 3),
    cooldownMs: numEnv("OFF_LOOKUP_MONGO_COOLDOWN_MS", 30_000),
  },

  // --- Open Food Facts remote API (v3), used as fallback when the barcode is not cached -----
  offApi: {
    baseUrl: strEnv("OFF_LOOKUP_API_BASE_URL", "https://world.openfoodfacts.org"),
    userAgent: strEnv(
      "OFF_LOOKUP_API_USER_AGENT",
      "GestioneDispensa-OffLookup/0.1 (+https://github.com/, family-local)",
    ),
    timeoutMs: numEnv("OFF_LOOKUP_API_TIMEOUT_MS", 4000),
    maxConsecutiveFailures: numEnv("OFF_LOOKUP_API_MAX_CONSECUTIVE_FAILURES", 5),
    cooldownMs: numEnv("OFF_LOOKUP_API_COOLDOWN_MS", 30_000),
  },
} as const;
