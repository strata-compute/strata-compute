import { env } from "./config/env.ts";
import { ConfigurationError, validateStartupConfiguration } from "./config/validate.ts";
import { initStore } from "./database/index.ts";
import { closePool } from "./database/pool.ts";
import { registerJobs, startJobs } from "./jobs/definitions.ts";
import { scheduler } from "./jobs/scheduler.ts";
import { runPipeline } from "./pipeline.ts";
import { getMarketProvider, isMockMode } from "./providers/registry.ts";
import {
  ingestCryptoMarkets,
  ingestRobinhoodChain,
  ingestRobinhoodStockTokens,
} from "./ingestion/jobs.ts";
import { createApp } from "./api/app.ts";
import { closeEventStreams } from "./api/routes/stream.ts";
import { describeError, logger } from "./utils/logger.ts";

/** Last resort if something refuses to finish. */
const SHUTDOWN_TIMEOUT_MS = 20_000;
/** How long a running job may take to finish before it is abandoned. */
const DRAIN_TIMEOUT_MS = 12_000;

/**
 * Startup order:
 *   1. resolve the store (Postgres if reachable, memory otherwise)
 *   2. resolve the provider
 *   3. listen, and install the signal handlers
 *   4. warm up: ingest from the fast providers and run one pipeline pass
 *   5. register jobs and start them if enabled
 *
 * The handlers go on before the warm-up, not after it. A pass takes tens of
 * seconds, and a platform that decides to roll back during those seconds
 * sends a SIGTERM to a process with no handler for it — the shutdown path,
 * carefully written, would simply not run.
 *
 * The port opens before the warm-up rather than after it. Once data is
 * persisted the API has something real to serve the moment it starts — the
 * warm-up refreshes that, it does not create it — and a pass that reads
 * history for every asset now takes minutes. Binding after it would mean
 * minutes of refused connections on every restart, which is a far worse
 * failure than briefly serving data a few minutes old.
 *
 * Endpoints already answer honestly when the store is empty, so the memory
 * fallback loses nothing either: it reports no data rather than inventing it.
 */

async function main() {
  // configuration is checked before anything binds a port or opens a socket:
  // a service that cannot serve real data must not start pretending it can
  validateStartupConfiguration();

  const store = await initStore();
  const provider = getMarketProvider();

  logger.info("starting strata compute api", {
    environment: env.NODE_ENV,
    store: store.kind,
    provider: provider.name,
    mock: provider.isMock,
    computation: env.COMPUTE_VERSION,
  });

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info("api listening", { port: env.PORT });
  });

  /**
   * Shutdown, in the order that makes each step meaningful.
   *
   *   1. stop scheduling  — no new pipeline pass starts
   *   2. stop listening   — no new request is accepted
   *   3. end the streams  — SSE sockets never close on their own, and
   *                         `server.close()` waits for every one of them.
   *                         Without this step a deployment always ran to the
   *                         force-exit timer and was killed mid-write.
   *   4. drain            — in-flight requests and a running pass finish
   *   5. close the pool   — after the work that uses it, not before
   *
   * The timer is a last resort, not the mechanism. If it fires, something
   * refused to finish and the exit code says so.
   */
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    // a second SIGTERM during a drain must not restart the sequence
    if (shuttingDown) {
      logger.warn("shutdown already in progress", { signal });
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });

    const forced = setTimeout(() => {
      logger.error("shutdown timed out — forcing exit", { signal });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    try {
      scheduler.stop();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        const ended = closeEventStreams();
        if (ended > 0) logger.info("closed event streams", { streams: ended });
      });

      // A pass writes scores, events and arena state. Cutting it mid-write
      // rolls back its transaction, which is safe but throws away real work;
      // waiting a bounded moment usually keeps it.
      await scheduler.drain(DRAIN_TIMEOUT_MS);

      await closePool();
      logger.info("shutdown complete", { signal });
      clearTimeout(forced);
      process.exit(0);
    } catch (error) {
      logger.error("shutdown failed", { signal, ...describeError(error) });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Refresh the read model. Every step is independently failable — a provider
  // outage at boot must not stop the service from serving what it already has.
  if (isMockMode()) {
    const first = await runPipeline();
    if (!first.ok) {
      logger.warn("initial pipeline pass failed — API will serve empty results", {
        job: "startup",
      });
    }
  } else {
    // fast providers only: Alpha Vantage has a 25/day budget and is left to
    // its own scheduled job rather than being spent at every restart
    const results = await Promise.allSettled([
      ingestRobinhoodStockTokens(),
      ingestCryptoMarkets(),
      ingestRobinhoodChain(),
    ]);

    const failed = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
    ).length;
    if (failed > 0) {
      logger.warn("some providers failed during startup ingestion", {
        job: "startup",
        failed,
        total: results.length,
      });
    }

    const first = await runPipeline({ skipIngestion: true });
    if (!first.ok) {
      logger.warn("initial compute pass failed", { job: "startup" });
    }
  }

  registerJobs();
  await startJobs();
}

// Registered at module scope, not inside main(): a rejection thrown while
// main() is still awaiting its warm-up would otherwise have no handler.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", describeError(reason));
});

main().catch((error) => {
  if (error instanceof ConfigurationError) {
    // a configuration problem is an operator error, not a crash — print it
    // plainly rather than burying it in a stack trace
    process.stderr.write(`
${error.message}

`);
    logger.error("startup refused: invalid configuration", {
      problems: error.problems,
    });
    process.exit(78); // EX_CONFIG
  }
  logger.error("fatal startup error", describeError(error));
  process.exit(1);
});
