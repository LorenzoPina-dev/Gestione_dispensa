export const CONFIG_PROFILES = [
  "local",
  "family-local",
  "home-small",
  "home-plus",
  "test",
  "staging",
  "production",
] as const;

export type ConfigProfile = (typeof CONFIG_PROFILES)[number];

export interface AppConfig {
  appEnv: ConfigProfile;
  appVersion: string;
  publicBaseUrl: URL;
  apiBaseUrl: URL;
  logLevel: "debug" | "info" | "warn" | "error";
  timezoneDefault: string;
  localeDefault: string;
  featureProfileVersion: string;
  oidcIssuerUrl: URL;
  oidcClientId: string;
  oidcClientSecretRef: string;
  oidcAudience: string;
  sessionSecretRef: string;
  cookieSecure: boolean;
  corsAllowedOrigins: readonly URL[];
  rateLimitInvitePerMinute: number;
  qrInviteMaxTtlSeconds: number;
  qrFallbackMaxAttempts: number;
  databaseUrlRef: string;
  databasePoolMax: number;
  databaseStatementTimeoutMs: number;
  redisUrlRef: string;
  redisAofEnabled: boolean;
  queuePrefix: string;
  queueDefaultMaxAttempts: number;
  objectStorageEndpoint: URL;
  objectStorageBucketRef: string;
  objectStorageCredentialRef: string;
  mediaMaxBytes: number;
  ocrProvider: "disabled" | string;
  aiProvider: "disabled" | string;
  aiBudgetDailyMinor: number;
  otelExporterOtlpEndpoint: URL;
  otelServiceName: string;
  prometheusRetention: string;
  lokiEnabled: boolean;
  tempoEnabled: boolean;
  alertmanagerUrl: URL;
}

export interface ConfigLoadResult {
  config: AppConfig;
  fingerprint: string;
}

export class ConfigValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Configuration is invalid: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigLoadResult {
  const profile = readEnum(env.APP_ENV ?? "local", CONFIG_PROFILES, "APP_ENV");
  const issues: string[] = [];
  const read = (key: string, fallback?: string): string => {
    const value = env[key] ?? fallback;
    if (value === undefined || value.length === 0) {
      issues.push(`${key} is required`);
      return "";
    }
    return value;
  };
  const url = (key: string, fallback?: string): URL => {
    const value = read(key, fallback);
    try {
      return new URL(value);
    } catch {
      issues.push(`${key} must be a valid URL`);
      return new URL("http://invalid.local");
    }
  };
  const integer = (key: string, fallback: number, min: number): number => {
    const raw = env[key] ?? String(fallback);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      issues.push(`${key} must be an integer >= ${min}`);
      return fallback;
    }
    return value;
  };
  const boolean = (key: string, fallback: boolean): boolean => {
    const raw = env[key] ?? String(fallback);
    if (raw !== "true" && raw !== "false") {
      issues.push(`${key} must be true or false`);
      return fallback;
    }
    return raw === "true";
  };
  const secretRef = (key: string): string => {
    const value = read(key);
    if (value && !value.startsWith("secret://")) {
      issues.push(`${key} must be a secret:// reference`);
    }
    return value;
  };

  const config: AppConfig = {
    appEnv: profile,
    appVersion: read("APP_VERSION", "0.1.0-local"),
    publicBaseUrl: url("PUBLIC_BASE_URL", "http://localhost:3000"),
    apiBaseUrl: url("API_BASE_URL", "http://localhost:3000/api/v1"),
    logLevel: readEnum(env.LOG_LEVEL ?? "info", ["debug", "info", "warn", "error"], "LOG_LEVEL"),
    timezoneDefault: read("TIMEZONE_DEFAULT", "UTC"),
    localeDefault: read("LOCALE_DEFAULT", "it-IT"),
    featureProfileVersion: read("FEATURE_PROFILE_VERSION", "1.0"),
    oidcIssuerUrl: url("OIDC_ISSUER_URL", "http://localhost:8080/realms/dispensa"),
    oidcClientId: read("OIDC_CLIENT_ID", "dispensa-web"),
    oidcClientSecretRef: secretRef("OIDC_CLIENT_SECRET_REF"),
    oidcAudience: read("OIDC_AUDIENCE", "dispensa-api"),
    sessionSecretRef: secretRef("SESSION_SECRET_REF"),
    cookieSecure: boolean("COOKIE_SECURE", profile !== "local" && profile !== "family-local"),
    corsAllowedOrigins: read("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
      .split(",")
      .filter(Boolean)
      .map((origin) => new URL(origin.trim())),
    rateLimitInvitePerMinute: integer("RATE_LIMIT_INVITE_PER_MINUTE", 10, 1),
    qrInviteMaxTtlSeconds: integer("QR_INVITE_MAX_TTL_SECONDS", 600, 60),
    qrFallbackMaxAttempts: integer("QR_FALLBACK_MAX_ATTEMPTS", 5, 1),
    databaseUrlRef: secretRef("DATABASE_URL_REF"),
    databasePoolMax: integer("DATABASE_POOL_MAX", 10, 1),
    databaseStatementTimeoutMs: integer("DATABASE_STATEMENT_TIMEOUT_MS", 5000, 1),
    redisUrlRef: secretRef("REDIS_URL_REF"),
    redisAofEnabled: boolean("REDIS_AOF_ENABLED", true),
    queuePrefix: read("QUEUE_PREFIX", profile),
    queueDefaultMaxAttempts: integer("QUEUE_DEFAULT_MAX_ATTEMPTS", 5, 1),
    objectStorageEndpoint: url("OBJECT_STORAGE_ENDPOINT", "http://localhost:9000"),
    objectStorageBucketRef: read("OBJECT_STORAGE_BUCKET_REF", "dispensa-media"),
    objectStorageCredentialRef: secretRef("OBJECT_STORAGE_CREDENTIAL_REF"),
    mediaMaxBytes: integer("MEDIA_MAX_BYTES", 10_485_760, 1),
    ocrProvider: read("OCR_PROVIDER", "disabled"),
    aiProvider: read("AI_PROVIDER", "disabled"),
    aiBudgetDailyMinor: integer("AI_BUDGET_DAILY_MINOR", 0, 0),
    otelExporterOtlpEndpoint: url("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
    otelServiceName: read("OTEL_SERVICE_NAME", "gestione-dispensa"),
    prometheusRetention: read("PROMETHEUS_RETENTION", "14d"),
    lokiEnabled: boolean("LOKI_ENABLED", profile === "family-local"),
    tempoEnabled: boolean("TEMPO_ENABLED", profile === "family-local"),
    alertmanagerUrl: url("ALERTMANAGER_URL", "http://localhost:9093"),
  };

  if (config.aiProvider !== "disabled" && config.aiBudgetDailyMinor === 0) {
    issues.push("AI_BUDGET_DAILY_MINOR must be positive when AI_PROVIDER is enabled");
  }
  if (
    profile === "production" &&
    config.corsAllowedOrigins.some((origin) => origin.hostname === "localhost")
  ) {
    issues.push("CORS_ALLOWED_ORIGINS cannot use localhost in production");
  }
  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return { config, fingerprint: createConfigFingerprint(config) };
}

export function createConfigFingerprint(config: AppConfig): string {
  const safeConfig = Object.entries(config)
    .filter(
      ([key]) => !key.toLowerCase().includes("secret") && !key.toLowerCase().includes("credential"),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return Buffer.from(JSON.stringify(safeConfig)).toString("base64url").slice(0, 32);
}

function readEnum<T extends string>(value: string, allowed: readonly T[], key: string): T {
  if (!allowed.includes(value as T)) {
    throw new ConfigValidationError([`${key} must be one of: ${allowed.join(", ")}`]);
  }
  return value as T;
}
