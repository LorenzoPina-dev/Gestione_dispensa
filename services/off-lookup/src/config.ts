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

function listEnv(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) return [...fallback];
  const items = raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length > 0 ? items : [...fallback];
}

function oneOfEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim();
  return raw !== undefined && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export const config = {
  port: numEnv("OFF_LOOKUP_PORT", 3200),
  internalToken: strEnv("OFF_LOOKUP_INTERNAL_TOKEN", "dispensa-internal-dev"),

  // --- Local-first lookup policy ------------------------------------------------------------
  lookup: {
    // When is the live OFF API allowed to enrich a product that exists in the local dump?
    //  - "missing": only if a field listed in requiredLocalFields is still missing AFTER local
    //               derivation (default: the dump is the source of truth, the API is a fallback);
    //  - "always":  legacy behaviour, one refresh pass for every product not yet enriched;
    //  - "never":   the API is only used when the barcode is not in the local dump at all.
    remoteEnrichment: oneOfEnv("OFF_LOOKUP_REMOTE_ENRICHMENT", ["missing", "always", "never"] as const, "missing"),
    // Comma separated. Known names: name, image, quantity, nutriments, ingredients.
    requiredLocalFields: listEnv("OFF_LOOKUP_REQUIRED_LOCAL_FIELDS", ["name"]),
  },

  // --- Derivation of API-only fields from the persisted dump (see off-derived.ts) ----------
  derived: {
    imagesBaseUrl: strEnv("OFF_IMAGES_BASE_URL", "https://images.openfoodfacts.org/images/products"),
    // Language priority; it-IT is the product language of this project.
    languages: listEnv("OFF_LOOKUP_LANGUAGES", ["it", "en"]),
    imagePolicy: oneOfEnv("OFF_LOOKUP_DERIVED_IMAGE_POLICY", ["fill", "prefer"] as const, "fill"),
    uploadFallback: oneOfEnv("OFF_LOOKUP_IMAGE_UPLOAD_FALLBACK", ["none", "newest"] as const, "none"),
  },

  // --- MongoDB (local Open Food Facts dump + read-through cache) ---------------------------
  mongo: {
    // Empty on purpose: an unset URL means "no local database", and the service must keep
    // working by talking only to the live API (see ProductLookupService).
    url: strEnv("OFF_LOOKUP_MONGO_URL", ""),
    dbName: strEnv("OFF_LOOKUP_MONGO_DB", "off"),
    collectionName: strEnv("OFF_LOOKUP_MONGO_COLLECTION", "products"),
    connectTimeoutMs: numEnv("OFF_LOOKUP_MONGO_CONNECT_TIMEOUT_MS", 3000),
    operationTimeoutMs: numEnv("OFF_LOOKUP_MONGO_OPERATION_TIMEOUT_MS", 1200),
    sourceOperationTimeoutMs: numEnv("OFF_LOOKUP_MONGO_SOURCE_TIMEOUT_MS", 10000),
    maxConsecutiveFailures: numEnv("OFF_LOOKUP_MONGO_MAX_CONSECUTIVE_FAILURES", 3),
    cooldownMs: numEnv("OFF_LOOKUP_MONGO_COOLDOWN_MS", 30_000),
  },

  // --- Open Food Facts remote API (v3), used as fallback when the barcode is not cached -----
  searchIndexer: {
    baseUrl: strEnv("OFF_LOOKUP_SEARCH_INDEXER_BASE_URL", "http://search-indexer:3210"),
    token: strEnv("OFF_LOOKUP_SEARCH_INDEXER_TOKEN", "dispensa-internal-dev"),
    searchTimeoutMs: numEnv("OFF_LOOKUP_SEARCH_INDEXER_TIMEOUT_MS", 700),
    writeTimeoutMs: numEnv("OFF_LOOKUP_SEARCH_INDEXER_WRITE_TIMEOUT_MS", 1200),
  },

  offApi: {
    baseUrl: strEnv("OFF_LOOKUP_API_BASE_URL", "https://world.openfoodfacts.org"),
    searchBaseUrl: strEnv("OFF_LOOKUP_SEARCH_BASE_URL", "https://search.openfoodfacts.org"),
    legacySearchBaseUrl: strEnv("OFF_LOOKUP_LEGACY_SEARCH_BASE_URL", "https://world.openfoodfacts.org"),
    userAgent: strEnv(
      "OFF_LOOKUP_API_USER_AGENT",
      "GestioneDispensa-OffLookup/0.1 (+https://github.com/, family-local)",
    ),
    timeoutMs: numEnv("OFF_LOOKUP_API_TIMEOUT_MS", 4000),
    searchTimeoutMs: numEnv("OFF_LOOKUP_SEARCH_TIMEOUT_MS", 8000),
    legacySearchTimeoutMs: numEnv("OFF_LOOKUP_LEGACY_SEARCH_TIMEOUT_MS", 6000),
    searchCacheMs: numEnv("OFF_LOOKUP_SEARCH_CACHE_MS", 30_000),
    // A failed refresh must not hammer Open Food Facts on every scan/F5. The previous cache
    // remains authoritative for fallback purposes until this cooldown expires.
    refreshCooldownMs: numEnv("OFF_LOOKUP_API_REFRESH_COOLDOWN_MS", 10 * 60 * 1000),
    maxConsecutiveFailures: numEnv("OFF_LOOKUP_API_MAX_CONSECUTIVE_FAILURES", 5),
    cooldownMs: numEnv("OFF_LOOKUP_API_COOLDOWN_MS", 30_000),
  },
} as const;
