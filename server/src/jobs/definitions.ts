import { backfillHistory } from "../ingestion/backfill.ts";
import { ensureActiveRound } from "../arena/service.ts";
import { env } from "../config/env.ts";
import {
  ingestCryptoMarkets,
  ingestOnchainIndex,
  ingestRobinhoodChain,
  ingestRobinhoodStockTokens,
  ingestSecurityData,
  ingestStocks,
} from "../ingestion/jobs.ts";
import { runPipeline } from "../pipeline.ts";

import { logger } from "../utils/logger.ts";
import { scheduler } from "./scheduler.ts";
import type { Job } from "./types.ts";

/**
 * Job definitions.
 *
 * In mock mode a single pass covers everything. In live mode each provider
 * gets its own job at its own configured cadence, because the providers have
 * wildly different limits — CoinGecko tolerates a two-minute loop, Alpha
 * Vantage allows 25 calls a *day*. A shared interval would either waste the
 * fast providers or exhaust the slow one.
 *
 * Every interval comes from configuration. Nothing here polls on a hardcoded
 * timer, and jobs are disabled unless JOBS_ENABLED=true.
 */

const seconds = (n: number) => n * 1000;

export const ingestStockTokensJob: Job = {
  name: "ingest-robinhood-stock-tokens",
  description: "Robinhood official Stock Token API → normalized stock markets.",
  intervalMs: seconds(env.MARKET_REFRESH_INTERVAL_SECONDS),
  runOnStart: true,
  async run() {
    await ingestRobinhoodStockTokens();
  },
};

export const ingestCryptoJob: Job = {
  name: "ingest-crypto-markets",
  description: "CoinGecko → normalized crypto and onchain-token markets.",
  intervalMs: seconds(env.MARKET_REFRESH_INTERVAL_SECONDS),
  runOnStart: true,
  async run() {
    await ingestCryptoMarkets();
  },
};

export const ingestStocksJob: Job = {
  name: "ingest-stocks",
  description: "Alpha Vantage → equity quotes for a rotating slice of the universe.",
  intervalMs: seconds(env.STOCK_REFRESH_INTERVAL_SECONDS),
  // deliberately not runOnStart: the daily budget is 25 calls
  async run() {
    await ingestStocks();
  },
};

export const ingestChainJob: Job = {
  name: "ingest-robinhood-chain",
  description: "Alchemy → Robinhood Chain block height and transfer activity.",
  intervalMs: seconds(env.ONCHAIN_REFRESH_INTERVAL_SECONDS),
  runOnStart: true,
  async run() {
    await ingestRobinhoodChain();
  },
};

export const ingestOnchainIndexJob: Job = {
  name: "ingest-onchain-index",
  description: "Blockscout → indexed activity for onchain assets it covers.",
  intervalMs: seconds(env.ONCHAIN_REFRESH_INTERVAL_SECONDS),
  async run() {
    await ingestOnchainIndex();
  },
};

export const ingestSecurityJob: Job = {
  name: "ingest-security-data",
  description: "GoPlus → token security flags for supported chains.",
  intervalMs: seconds(env.SECURITY_REFRESH_INTERVAL_SECONDS),
  async run() {
    await ingestSecurityData();
  },
};

/**
 * Compute runs after ingestion rather than fetching anything itself: it reads
 * whatever the ingestion jobs have already stored. This is what keeps a
 * provider outage from stopping scoring for the domains that are still
 * healthy.
 */
export const computeJob: Job = {
  name: "compute-metrics",
  description: "Score whatever the ingestion jobs have stored, then rank and detect signals.",
  intervalMs: env.JOB_COMPUTE_INTERVAL_MS,
  async run() {
    await runPipeline({ skipIngestion: true });
  },
};

/**
 * Runs early and rarely.
 *
 * The intelligence layer is close to useless without history, so this job is
 * `runOnStart` — a cold start pulls a week of real hourly observations from
 * the provider before the first scoring pass, instead of reporting
 * INSUFFICIENT_DATA for days while depth accumulates. It then repeats slowly,
 * because it skips assets that already have depth and exists mainly to cover
 * newly-listed assets.
 */
export const backfillHistoryJob: Job = {
  name: "backfill-history",
  description: "Provider historical series → stored observations, for assets lacking depth.",
  intervalMs: 6 * 60 * 60 * 1000,
  runOnStart: true,
  async run() {
    await backfillHistory();
  },
};

export const arenaRoundJob: Job = {
  name: "arena-round",
  description: "Opens a new arena round when the current one has elapsed.",
  intervalMs: env.JOB_ARENA_INTERVAL_MS,
  async run() {
    await ensureActiveRound();
  },
};

export function registerJobs(): void {
  scheduler.register(ingestStockTokensJob);
  scheduler.register(ingestCryptoJob);
  scheduler.register(ingestStocksJob);
  scheduler.register(ingestChainJob);
  scheduler.register(ingestOnchainIndexJob);
  scheduler.register(ingestSecurityJob);
  scheduler.register(backfillHistoryJob);
  scheduler.register(computeJob);
  scheduler.register(arenaRoundJob);
}

export async function startJobs(): Promise<void> {
  if (!env.JOBS_ENABLED) {
    logger.info("background jobs disabled", {
      job: "scheduler",
      hint: "set JOBS_ENABLED=true",
    });
    return;
  }
  await scheduler.start();
}
