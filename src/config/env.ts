type AppConfig = {
  host: string;
  port: number;
  logLevel: string;
  redisUrl: string;
  cacheTtlSeconds: number;
  staleTtlSeconds: number;
  emptyCacheTtlSeconds: number;
  httpTimeoutMs: number;
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  providerOrder: string[];
  authEnabled: boolean;
  jwtSecret: string | undefined;
};

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw !== "false" && raw !== "0";
}

export const config: AppConfig = {
  host: process.env.HOST ?? "0.0.0.0",
  port: readInt("PORT", 3000),
  logLevel: process.env.LOG_LEVEL ?? "info",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0",
  cacheTtlSeconds: readInt("CACHE_TTL_SECONDS", 60 * 60 * 6),
  staleTtlSeconds: readInt("STALE_TTL_SECONDS", 60 * 60 * 24 * 7),
  emptyCacheTtlSeconds: readNonNegativeInt("EMPTY_CACHE_TTL_SECONDS", 60),
  httpTimeoutMs: readInt("HTTP_TIMEOUT_MS", 5000),
  corsOrigins: readList("CORS_ORIGINS", ["*"]),
  rateLimitMax: readInt("RATE_LIMIT_MAX", 60),
  rateLimitWindowMs: readInt("RATE_LIMIT_WINDOW_MS", 60_000),
  providerOrder: readList("PROVIDER_ORDER", ["google-translate", "google-dictionary-extension"]),
  authEnabled: readBoolean("AUTH_ENABLED", true),
  jwtSecret: process.env.JWT_SECRET
};

if (config.authEnabled && !config.jwtSecret) {
  throw new Error(
    "JWT_SECRET env variable is required when AUTH_ENABLED=true. Set AUTH_ENABLED=false to disable authentication."
  );
}

if (config.providerOrder.length === 0) {
  throw new Error(
    "PROVIDER_ORDER must contain at least one provider name (e.g. google-translate)."
  );
}
