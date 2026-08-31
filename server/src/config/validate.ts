import { env } from "./env.ts";
import { logger } from "../utils/logger.ts";

/**
 * Startup contract enforcement.
 *
 * Rules, all fatal, all checked before anything binds a port:
 *
 *  1. Production may never run on synthetic data. `NODE_ENV=production` with
 *     `DATA_MODE` anything but `live` is a configuration error, not a warning.
 *  2. Live mode requires at least one real market source. A service with no
 *     provider would come up healthy-looking and serve nothing — worse than
 *     refusing to start, because it looks fine.
 *  3. Production may not run with an open CORS allowlist, and may not fall
 *     back to the development origin. Both are configuration left unfinished,
 *     and neither announces itself once the service is up.
 *  4. Production requires a database. The store layer enforces this too; it
 *     is repeated here so the failure arrives as a configuration message
 *     rather than a connection error.
 *
 * Missing credentials for *some* providers is not fatal: that capability is
 * disabled and reported. Missing credentials for *all* of them is.
 */

export interface CapabilityReport {
  capability: string;
  provider: string;
  configured: boolean;
  requires: string[];
}

export class ConfigurationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

export function describeCapabilities(): CapabilityReport[] {
  return [
    {
      capability: "stock_tokens",
      provider: "robinhood_stock_tokens",
      // the official Stock Token API needs no credential
      configured: true,
      requires: [],
    },
    {
      capability: "crypto_markets",
      provider: "coingecko",
      configured: Boolean(env.COINGECKO_API_KEY),
      requires: ["COINGECKO_API_KEY"],
    },
    {
      capability: "chain_data",
      provider: "alchemy",
      configured: Boolean(env.ROBINHOOD_RPC_URL || env.ALCHEMY_RPC_URL),
      requires: ["ROBINHOOD_RPC_URL", "ALCHEMY_RPC_URL"],
    },
    {
      capability: "onchain_index",
      provider: "blockscout",
      configured: Boolean(env.BLOCKSCOUT_API_KEY),
      requires: ["BLOCKSCOUT_API_KEY"],
    },
    {
      capability: "equities",
      provider: "alpha_vantage",
      configured: Boolean(env.ALPHA_VANTAGE_API_KEY),
      requires: ["ALPHA_VANTAGE_API_KEY"],
    },
    {
      capability: "token_security",
      provider: "goplus",
      configured: Boolean(env.GOPLUS_APP_KEY && env.GOPLUS_APP_SECRET),
      requires: ["GOPLUS_APP_KEY", "GOPLUS_APP_SECRET"],
    },
  ];
}

/** Throws ConfigurationError rather than returning, so startup cannot proceed. */
export function validateStartupConfiguration(): CapabilityReport[] {
  const problems: string[] = [];

  if (env.isProduction && env.dataMode !== "live") {
    problems.push(
      `NODE_ENV=production requires DATA_MODE=live (got '${env.dataMode}'). ` +
        "Synthetic market data must never reach production.",
    );
  }

  if (env.isProduction) {
    if (env.corsOrigins.includes("*")) {
      problems.push(
        "CORS_ORIGINS may not contain '*' in production. " +
          "List the Strata frontend origin explicitly.",
      );
    }
    if (env.corsOrigins.length === 0) {
      problems.push("CORS_ORIGINS is empty; production requires an explicit origin allowlist.");
    }
    // The distinction that matters is *unconfigured*, not *localhost*. The
    // default exists so a local checkout works with no setup; reaching
    // production still holding it means nobody set the allowlist, and the
    // deployed frontend will be refused by a rule naming a developer's laptop.
    //
    // An operator who deliberately sets a localhost origin under
    // NODE_ENV=production is running a production simulation, which is a
    // thing worth being able to do. That gets a warning, not a refusal.
    if (process.env.CORS_ORIGINS === undefined) {
      problems.push(
        "CORS_ORIGINS is not set. Production requires an explicit origin " +
          "allowlist; the development default would refuse the deployed frontend.",
      );
    } else if (env.corsOrigins.every((origin) => origin.startsWith("http://localhost"))) {
      logger.warn(
        "CORS_ORIGINS allows only localhost under NODE_ENV=production — correct for a " +
          "local production simulation, wrong for a deployment",
        { origins: env.corsOrigins.join(",") },
      );
    }
    if (!env.DATABASE_URL && env.DATA_STORE === "postgres") {
      problems.push("DATABASE_URL is required in production; there is no in-memory fallback.");
    }
  }

  const capabilities = describeCapabilities();

  if (env.dataMode === "live") {
    // a market source is the minimum: without one there is nothing to serve
    const marketSources = capabilities.filter(
      (c) => c.capability === "crypto_markets" || c.capability === "stock_tokens",
    );
    if (!marketSources.some((c) => c.configured)) {
      problems.push(
        "DATA_MODE=live but no market data source is configured. " +
          "Set COINGECKO_API_KEY, or rely on the Robinhood Stock Token API (no key required).",
      );
    }

    const missing = capabilities.filter((c) => !c.configured);
    for (const capability of missing) {
      logger.warn("capability disabled — credentials not configured", {
        capability: capability.capability,
        provider: capability.provider,
        requires: capability.requires,
      });
    }
  }

  if (env.dataMode === "mock") {
    logger.warn(
      "DATA_MODE=mock — every record is synthetic and flagged isMock; never use this outside development",
      { mode: "mock" },
    );
  }

  if (problems.length > 0) throw new ConfigurationError(problems);

  logger.info("configuration validated", {
    mode: env.dataMode,
    capabilities: capabilities.filter((c) => c.configured).map((c) => c.capability),
    disabled: capabilities.filter((c) => !c.configured).map((c) => c.capability),
  });

  return capabilities;
}
