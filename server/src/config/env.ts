import { z } from "zod";

/**
 * Environment is read once, validated once, and exported as a frozen object.
 * Nothing else in the service reads `process.env` directly — that keeps the
 * full configuration surface visible in one file.
 */

/**
 * Local configuration, in precedence order: real environment, then
 * `.env.local`, then `.env`.
 *
 * The load order below looks backwards and is not. `process.loadEnvFile`
 * never overwrites a variable that is already set, so whichever source is
 * read FIRST wins. Reading `.env.local` first is therefore what makes it
 * take precedence, and reading nothing before either is what lets a real
 * shell variable beat both.
 *
 * This was previously `[".env", ".env.local"]` with a comment claiming the
 * latter won. It did not: `.env` shipped an empty `DATABASE_URL=`, which
 * loaded first and made every override in `.env.local` inert — including the
 * database connection. Do not "fix" this order.
 */
for (const file of [".env.local", ".env"]) {
  try {
    const path = new URL(`../../${file}`, import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
    process.loadEnvFile(decodeURIComponent(path));
  } catch {
    // absent file — rely on the real environment
  }
}

const bool = z
  .string()
  .transform((v) => v.toLowerCase() === "true" || v === "1")
  .pipe(z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Postgres connection string. The service starts without it, degraded. */
  /**
   * Empty is treated as absent. A bare `DATABASE_URL=` in a committed `.env`
   * is a placeholder, not a configured value, and letting an empty string
   * through means the failure surfaces as a confusing driver error rather
   * than a clear "not configured".
   */
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value : undefined)),

  /**
   * Which store backs the service. Postgres is the default and the only
   * production-legal value; memory must be asked for by name.
   *
   * The previous behaviour — fall back to memory whenever Postgres was
   * unreachable — is what let a deployment look healthy while persisting
   * nothing. An outage now fails loudly instead of silently becoming a
   * different, forgetful application.
   */
  DATA_STORE: z.enum(["postgres", "memory"]).default("postgres"),

  /** PEM path. When set, TLS verifies the server certificate against it. */
  DATABASE_CA_CERT: z.string().optional(),

  /**
   * Retention. Zero means keep everything, which is the default: market
   * history is the input to every historical computation, and deleting it
   * silently would degrade scores in ways nobody could trace.
   */
  MARKET_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  RETENTION_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .pipe(z.boolean())
    .default(false),
  /**
   * Connections held against Postgres.
   *
   * Ten was too tight. A computation pass issues hundreds of short queries,
   * and at roughly 150ms per round trip to a managed database that saturates
   * ten slots for seconds at a time — long enough for a concurrent API
   * request to wait out its acquisition timeout and fail. Twenty leaves room
   * for the pass and the API to coexist while staying well inside what a
   * managed pooler allocates per client.
   *
   * The ceiling is not ours to choose. Supabase's session pooler allows 15
   * clients in total, and a pool of 20 does not fail at startup — it fails
   * later, as `EMAXCONNSESSION` on whichever request happens to be unlucky,
   * which reads like an application bug rather than a capacity limit. Twenty
   * was set here during a local audit without checking that number, and
   * production found it within minutes.
   *
   * Twelve leaves headroom for migrations and a manual session. Raise it only
   * after raising the database plan's own limit, never before.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(12),
  DATABASE_SSL: bool.default(false),

  /**
   * The data contract for the whole service.
   *
   *   live  real providers only. If a credential is missing the capability is
   *         disabled and reported — it is never replaced with synthetic data.
   *   mock  the synthetic development provider. Must be asked for explicitly,
   *         is refused under NODE_ENV=production, and marks every record it
   *         produces `isMock: true` all the way to the API response.
   *
   * Default is `live`: a misconfigured service must fail loudly, not quietly
   * serve invented numbers.
   */
  DATA_MODE: z.enum(["live", "mock"]).default("live"),
  /** Deprecated alias, kept so an existing .env keeps working. */
  MARKET_PROVIDER: z.enum(["mock", "live"]).optional(),

  /**
   * Provider credentials. Declared so configuration is validated and typed in
   * one place; nothing reads them yet. Phase 3 provider implementations are
   * the only code that ever will — business logic never sees a key.
   */
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  /** Free tier is 25/day; the limiter enforces it locally. */
  ALPHA_VANTAGE_DAILY_LIMIT: z.coerce.number().int().positive().default(25),
  COINGECKO_API_KEY: z.string().optional(),
  BLOCKSCOUT_API_KEY: z.string().optional(),
  GOPLUS_API_KEY: z.string().optional(),
  GOPLUS_APP_KEY: z.string().optional(),
  GOPLUS_APP_SECRET: z.string().optional(),
  ALCHEMY_API_KEY: z.string().optional(),
  ALCHEMY_RPC_URL: z.string().optional(),

  /** Robinhood Chain. Chain id is fixed at 4663 for mainnet. */
  ROBINHOOD_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  ROBINHOOD_RPC_URL: z.string().optional(),
  ROBINHOOD_WS_URL: z.string().optional(),
  ROBINHOOD_API_URL: z.string().default("https://api.robinhood.com"),

  /**
   * Per-domain refresh cadence. Every ingestion job reads its interval from
   * here — nothing polls on a hardcoded timer.
   */
  MARKET_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  ONCHAIN_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  STOCK_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
  SECURITY_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(21600),

  /** Cache TTLs by data class, in seconds. */
  CACHE_TTL_MARKET_SECONDS: z.coerce.number().int().nonnegative().default(30),
  CACHE_TTL_METADATA_SECONDS: z.coerce.number().int().nonnegative().default(86400),
  CACHE_TTL_SECURITY_SECONDS: z.coerce.number().int().nonnegative().default(21600),
  CACHE_TTL_RANKINGS_SECONDS: z.coerce.number().int().nonnegative().default(30),

  /** Cache backend. `memory` needs no infrastructure. */
  CACHE_DRIVER: z.enum(["memory", "none"]).default("memory"),
  CACHE_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(15),

  /** Background jobs are opt-in and slow by default. */
  JOBS_ENABLED: bool.default(false),
  JOB_INGESTION_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  JOB_COMPUTE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  JOB_SIGNALS_INTERVAL_MS: z.coerce.number().int().positive().default(120_000),
  JOB_RANKINGS_INTERVAL_MS: z.coerce.number().int().positive().default(120_000),
  JOB_ARENA_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),

  /** Comma-separated allowlist. `*` permits any origin. */
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  /**
   * Per-IP request budget.
   *
   * Sized against how the system is actually deployed. The browser never
   * calls this API — the frontend renders on the server and proxies — so in
   * practice one IP is *every* user, and a page render costs four to five
   * backend requests. At the old default of 240 the whole site throttled at
   * roughly fifty page views a minute.
   *
   * 1200 leaves headroom for a few hundred renders a minute while still
   * stopping a single client from hammering the API if it is ever exposed
   * directly. Deployments behind a proxy should set TRUST_PROXY so the limit
   * applies per real client instead.
   */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1_200),

  /**
   * Probes get their own budget.
   *
   * A throttled health check reads as an outage and takes a healthy instance
   * out of rotation, so /health and /ready are counted separately and
   * generously rather than sharing the general allowance.
   */
  RATE_LIMIT_PROBE_MAX: z.coerce.number().int().positive().default(600),

  /**
   * Whether to believe X-Forwarded-For.
   *
   * Only meaningful behind a proxy that sets it. Enabling it without one lets
   * any caller choose their own rate-limit bucket by sending the header.
   */
  TRUST_PROXY: bool.default(false),

  /** Active scoring version. See src/compute/registry.ts. */
  COMPUTE_VERSION: z.string().default("v1"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const raw = parsed.data;

/**
 * DATA_MODE wins; MARKET_PROVIDER is honoured only as a legacy alias so an
 * older .env does not silently change behaviour.
 */
const dataMode = raw.DATA_MODE ?? raw.MARKET_PROVIDER ?? "live";

export const env = Object.freeze({
  ...raw,
  DATA_MODE: process.env.DATA_MODE ? raw.DATA_MODE : (raw.MARKET_PROVIDER ?? raw.DATA_MODE),
  dataMode,
  // the spec names this GOPLUS_API_KEY; the API itself calls it an app key
  GOPLUS_APP_KEY: raw.GOPLUS_APP_KEY ?? raw.GOPLUS_API_KEY,
  corsOrigins: raw.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: raw.NODE_ENV === "production",
});

export type Env = typeof env;
