import { Router } from "express";
import { z } from "zod";
import { getRoundView, listRounds } from "../../arena/service.ts";
import { getComputeStatus } from "../../compute/status.ts";
import { getComputeVersion, listComputeVersions } from "../../compute/registry.ts";
import { getStore } from "../../database/index.ts";
import { checkDatabaseHealth } from "../../database/pool.ts";
import { getCache } from "../../cache/index.ts";
import { env } from "../../config/env.ts";
import { scheduler } from "../../jobs/scheduler.ts";
import {
  checkProviderHealth,
  SOURCE_PRIORITY,
} from "../../providers/registry.ts";
import { getProviderStates, failingProviders } from "../../ingestion/provider-stats.ts";
import { getLastChainObservation, listSecuritySnapshots } from "../../ingestion/jobs.ts";
import { rankAssets } from "../../rankings/service.ts";
import type { RankableAsset } from "../../rankings/service.ts";
import { listDetectors } from "../../signals/engine.ts";
import { ASSET_TYPES } from "../../types/domain.ts";
import { RANKING_METRICS } from "../../types/rankings.ts";
import { SIGNAL_TYPES } from "../../types/signals.ts";
import { AppError } from "../../utils/errors.ts";
import { getLastIngestionAt } from "../../ingestion/service.ts";
import {
  anyMock,
  assetIndex,
  sourcesOf,
  toAssetDto,
  toMarketDto,
  withAssetIdentity,
} from "../dto.ts";
import { aggregateStatus } from "../freshness.ts";
import { params, query, validateParams, validateQuery } from "../middleware/validate.ts";
import { ok, okList, unavailable } from "../respond.ts";

/**
 * All read endpoints. Every handler validates its input, reads through the
 * store interface, and answers in the `{ data, meta }` envelope with the
 * provenance of what it returned.
 */

export const router: Router = Router();

const CACHE_TTL = env.CACHE_TTL_SECONDS;

// ---------------------------------------------------------------- health --

router.get("/health", async (_req, res) => {
  const [database, providers] = await Promise.all([
    checkDatabaseHealth(),
    checkProviderHealth(),
  ]);
  const store = getStore();

  // one entry per provider, keyed by name, so a client can read it directly
  const providerMap: Record<string, { status: string; detail?: string; latencyMs: number | null }> =
    {};
  for (const p of providers) {
    providerMap[p.provider] = {
      status: p.healthy ? "healthy" : "unhealthy",
      ...(p.detail === undefined ? {} : { detail: p.detail }),
      latencyMs: p.latencyMs,
    };
  }

  const healthyCount = providers.filter((p) => p.healthy).length;
  const allProvidersDown = providers.length > 0 && healthyCount === 0;
  const someProvidersDown = healthyCount < providers.length;

  // A single provider outage is degradation, not an outage: the other domains
  // keep ingesting. Only a total provider failure is unhealthy.
  const status = allProvidersDown
    ? "unhealthy"
    : someProvidersDown || !database.connected
      ? "degraded"
      : "healthy";

  res.status(status === "unhealthy" ? 503 : 200);

  const [stats, intelligenceCounts] = await Promise.all([
    store.getPersistedStats(),
    store.countIntelligenceEvents().catch(() => null),
  ]);

  /**
   * What every caller gets.
   *
   * The per-source status map stays in production: /status renders it, mapped
   * through `lib/subsystems` to capability labels rather than vendor names.
   *
   * What does not stay is the prose. `detail` is a provider's own error text —
   * the string that was found quoting our API key back at us — and the
   * priority list and failure history are operator diagnostics that read as
   * reconnaissance on an unauthenticated endpoint. Status and latency answer
   * "is this source working", which is all a public health check needs.
   */
  const publicHealth = {
    status,
    uptimeSeconds: Math.round(process.uptime()),
    version: env.COMPUTE_VERSION,
    environment: env.NODE_ENV,
    mode: "live" as const,
    store: store.kind,
    database: {
      status: database.connected ? "healthy" : database.configured ? "unhealthy" : "not_configured",
      connected: database.connected,
      latencyMs: database.latencyMs,
      ...(database.detail === undefined ? {} : { detail: database.detail }),
    },
    dataSources: {
      total: providers.length,
      healthy: healthyCount,
      degraded: providers.length - healthyCount,
    },
    providers: env.isProduction
      ? Object.fromEntries(
          Object.entries(providerMap).map(([name, p]) => [
            name,
            { status: p.status, latencyMs: p.latencyMs },
          ]),
        )
      : providerMap,
    cache: { driver: getCache().driver, ttlSeconds: CACHE_TTL },
    jobs: { enabled: env.JOBS_ENABLED, running: scheduler.isStarted },
    // From stored snapshots, not a module-level counter. The counter reset on
    // every restart and was only written on the mock path, so a live pipeline
    // reported `null` here indefinitely.
    lastIngestionAt: stats.lastIngestionAt,
    lastComputationAt: stats.lastComputationAt,
    intelligence: intelligenceCounts
      ? { openEvents: intelligenceCounts.open, totalEvents: intelligenceCounts.total }
      : null,
  };

  if (env.isProduction) return ok(res, publicHealth);

  return ok(res, {
    ...publicHealth,
    providerDetail: providers,
    failingProviders: failingProviders(),
    sourcePriority: SOURCE_PRIORITY,
  });
});

/**
 * Readiness, for a deployment platform's probe.
 *
 * Distinct from health on purpose. Health describes how the service is doing
 * and stays 200 while a provider is down, because a degraded service is still
 * worth serving traffic. Readiness answers one narrower question — can this
 * process answer a request correctly right now — and the database is the only
 * hard dependency of that. It is deliberately cheap: no provider is probed,
 * because a probe that makes six outbound calls will eventually time out and
 * take a healthy instance out of rotation.
 */
router.get("/ready", async (_req, res) => {
  const database = await checkDatabaseHealth();
  const ready = database.connected;

  res.status(ready ? 200 : 503);
  return ok(res, {
    ready,
    reason: ready ? null : "the database is not reachable",
    checks: {
      database: database.connected,
      store: getStore().kind,
    },
  });
});

// ---------------------------------------------------------------- assets --

const assetListQuery = z.object({
  type: z.enum(ASSET_TYPES).optional(),
  search: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/assets", validateQuery(assetListQuery), async (_req, res) => {
  const q = query<z.infer<typeof assetListQuery>>(res);
  const store = getStore();

  const filter = {
    ...(q.type ? { assetType: q.type } : {}),
    ...(q.search ? { search: q.search } : {}),
    limit: q.limit,
    offset: q.offset,
  };

  const [assets, total] = await Promise.all([
    store.listAssets(filter),
    store.countAssets({ ...(q.type ? { assetType: q.type } : {}), ...(q.search ? { search: q.search } : {}) }),
  ]);

  return okList(res, assets.map(toAssetDto), {
    source: store.kind === "postgres" ? "database" : "memory",
    total,
    limit: q.limit,
    offset: q.offset,
  });
});

const idParam = z.object({ id: z.string().min(1).max(64) });

router.get("/assets/:id", validateParams(idParam), async (_req, res) => {
  const { id } = params<z.infer<typeof idParam>>(res);
  const store = getStore();

  // accepts an id or a symbol, so links can be human-readable
  const asset =
    (await store.getAssetById(id).catch(() => null)) ??
    (await store.getAssetBySymbol(id));
  if (!asset) throw AppError.notFound("Asset", id);

  const row = await store.getLatestMarketRow(asset.id);
  return ok(
    res,
    { ...toAssetDto(asset), market: row ? toMarketDto(row) : null },
    {
      source: store.kind === "postgres" ? "database" : "memory",
      mock: row?.snapshot?.isMock ?? false,
    },
  );
});

// --------------------------------------------------------------- markets --

const marketListQuery = z.object({
  type: z.enum(ASSET_TYPES).optional(),
  search: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/markets", validateQuery(marketListQuery), async (_req, res) => {
  const q = query<z.infer<typeof marketListQuery>>(res);
  const store = getStore();
  const cache = getCache();

  const key = `markets:${q.type ?? "all"}:${q.search ?? ""}:${q.limit}`;
  const rows = await cache.wrap(key, CACHE_TTL, async () =>
    store.getLatestMarketRows({
      ...(q.type ? { assetType: q.type } : {}),
      ...(q.search ? { search: q.search } : {}),
      limit: q.limit,
    }),
  );

  const data = rows.map(toMarketDto);

  if (data.length === 0) {
    return unavailable(res, "No market data has been ingested yet", {
      store: store.kind === "postgres" ? "database" : "memory",
    });
  }

  return okList(res, data, {
    status: aggregateStatus(data.map((d) => d.status)),
    sources: sourcesOf(data),
    retrievedAt: data.map((d) => d.retrievedAt).sort().at(-1) ?? null,
    store: store.kind === "postgres" ? "database" : "memory",
    source: store.kind === "postgres" ? "database" : "memory",
    mock: anyMock(data),
  });
});

/* ----------------------------------------------------------------- stats --
 * Real coverage aggregates. These replace the invented figures the landing
 * page used to hardcode: every number here is counted from stored data, and
 * the endpoint reports `unavailable` rather than zeroes when nothing has been
 * ingested.
 */

router.get("/stats", async (_req, res) => {
  const store = getStore();
  const rows = await store.getLatestMarketRows({ limit: 1000 });
  const data = rows.map(toMarketDto);

  if (data.length === 0) {
    return unavailable(res, "No market data has been ingested yet", {
      store: store.kind === "postgres" ? "database" : "memory",
    });
  }

  const priced = data.filter((d) => d.price !== null);
  const withVolume = data.filter((d) => d.volume24h !== null);
  const scored = data.filter((d) => d.score !== null);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  return ok(
    res,
    {
      assetsTracked: await store.countAssets(),
      marketsPriced: priced.length,
      marketsScored: scored.length,
      // summed only over rows that actually reported volume; null when none did
      volume24h:
        withVolume.length > 0
          ? withVolume.reduce((sum, d) => sum + (d.volume24h ?? 0), 0)
          : null,
      volumeCoverage: withVolume.length,
      computeEvents24h: await store.countComputeEventsSince(since),
      byClass: {
        stock: data.filter((d) => d.asset.assetType === "stock").length,
        crypto: data.filter((d) => d.asset.assetType === "crypto").length,
        onchain: data.filter((d) => d.asset.assetType === "onchain").length,
      },
      computationVersion: getComputeVersion().version,
    },
    {
      status: aggregateStatus(data.map((d) => d.status)),
      sources: sourcesOf(data),
      retrievedAt: data.map((d) => d.retrievedAt).sort().at(-1) ?? null,
      store: store.kind === "postgres" ? "database" : "memory",
      mock: anyMock(data),
    },
  );
});

router.get("/markets/:id", validateParams(idParam), async (_req, res) => {
  const { id } = params<z.infer<typeof idParam>>(res);
  const store = getStore();

  const asset =
    (await store.getAssetById(id).catch(() => null)) ??
    (await store.getAssetBySymbol(id));
  if (!asset) throw AppError.notFound("Market", id);

  const row = await store.getLatestMarketRow(asset.id);
  if (!row) throw AppError.notFound("Market", id);

  const [metricsHistory, scoreHistory] = await Promise.all([
    store.getMetricsHistory(asset.id, 50),
    store.getScoreHistory(asset.id, 50),
  ]);

  const data = toMarketDto(row);
  return ok(
    res,
    { ...data, history: { metrics: metricsHistory, scores: scoreHistory } },
    {
      status: data.status,
      sources: data.source ? [data.source] : [],
      retrievedAt: data.retrievedAt,
      ageSeconds: data.ageSeconds,
      store: store.kind === "postgres" ? "database" : "memory",
      source: store.kind === "postgres" ? "database" : "memory",
      mock: data.isMock,
    },
  );
});

// -------------------------------------------------------------- rankings --

const rankingQuery = z.object({
  metric: z.enum(RANKING_METRICS).default("score"),
  type: z.enum(ASSET_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/rankings", validateQuery(rankingQuery), async (_req, res) => {
  const q = query<z.infer<typeof rankingQuery>>(res);
  const store = getStore();
  const assetType = q.type ?? "all";

  /**
   * The two reads behind a ranking, cached together for a few seconds.
   *
   * `/markets` has always done this; `/rankings` did not, and it showed: the
   * uncached path measured between 2.4s and 6.6s under a running computation
   * pass, against a frontend that gives up at eight. The rankings page was one
   * slow moment away from rendering as unavailable.
   *
   * Caching the store reads, not the response, keeps every timestamp in the
   * payload the real one. A cached ranking is a few seconds old and says so
   * through the same `retrievedAt` it always carried — it is not presented as
   * fresher than it is.
   */
  const cache = getCache();
  const cacheKey = `rankings:${q.metric}:${assetType}:${q.limit}`;

  const { rows, intelligence } = await cache.wrap(cacheKey, CACHE_TTL, async () => {
    const [marketRows, records] = await Promise.all([
      store.getLatestMarketRows(q.type ? { assetType: q.type } : {}),
      // Read from the stored intelligence pass rather than recomputed here:
      // the API serves what the background pipeline already computed, so two
      // readers at the same instant cannot see two orderings.
      store.listLatestIntelligence(q.type ? { assetType: q.type } : {}),
    ]);
    return { rows: marketRows, intelligence: records };
  });
  const byAssetId = new Map(intelligence.map((record) => [record.assetId, record]));

  // an asset that reported INSUFFICIENT_DATA is absent from the ranking, not
  // ranked last
  const rankable: RankableAsset[] = [];
  for (const row of rows) {
    const record = byAssetId.get(row.asset.id);
    if (!record || record.score.status !== "OK") continue;
    rankable.push({ asset: row.asset, intelligence: record });
  }

  // a ranking of one asset is not a ranking; say so rather than showing it
  if (rankable.length < 2) {
    return unavailable(
      res,
      `Insufficient live data to calculate rankings (${rankable.length} scored market${rankable.length === 1 ? "" : "s"})`,
      { store: store.kind === "postgres" ? "database" : "memory" },
    );
  }

  const previousRanks = await store.getPreviousRanks(q.metric, assetType);
  const snapshot = rankAssets(rankable, {
    metric: q.metric,
    assetType,
    limit: q.limit,
    previousRanks,
  });

  const dtos = rows.map(toMarketDto);
  // attach artwork the compute layer has no reason to carry
  const identities = assetIndex(rows.map((row) => row.asset));
  const ranked = {
    ...snapshot,
    entries: withAssetIdentity(snapshot.entries, identities),
  };
  return ok(res, ranked, {
    status: aggregateStatus(dtos.map((d) => d.status)),
    sources: sourcesOf(dtos),
    retrievedAt: dtos.map((d) => d.retrievedAt).sort().at(-1) ?? null,
    store: store.kind === "postgres" ? "database" : "memory",
    source: store.kind === "postgres" ? "database" : "memory",
    count: snapshot.entries.length,
    mock: anyMock(dtos),
  });
});

// --------------------------------------------------------------- signals --

const signalQuery = z.object({
  type: z.enum(SIGNAL_TYPES).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  assetId: z.string().max(64).optional(),
  sinceMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/signals", validateQuery(signalQuery), async (_req, res) => {
  const q = query<z.infer<typeof signalQuery>>(res);
  const store = getStore();

  const signals = await store.listSignals({
    ...(q.type ? { signalType: q.type } : {}),
    ...(q.assetType ? { assetType: q.assetType } : {}),
    ...(q.assetId ? { assetId: q.assetId } : {}),
    ...(q.sinceMinutes
      ? { since: new Date(Date.now() - q.sinceMinutes * 60_000).toISOString() }
      : {}),
    limit: q.limit,
  });

  // expired signals are dropped, not flagged: a feed showing a two-hour-old
  // spike as current is worse than one showing nothing
  const now = Date.now();
  const active = signals.filter((s) => new Date(s.expiresAt).getTime() > now);

  if (active.length === 0) {
    return unavailable(res, "No signals detected in the requested window", {
      store: store.kind === "postgres" ? "database" : "memory",
      detectors: listDetectors(),
    });
  }

  const newest = active.map((s) => s.timestamp).sort().at(-1) ?? null;
  const identities = assetIndex(await store.listAssets());
  return okList(res, withAssetIdentity(active, identities), {
    status: "live",
    sources: [...new Set(signals.map((s) => String(s.metadata?.source ?? "strata")))],
    retrievedAt: newest,
    store: store.kind === "postgres" ? "database" : "memory",
    source: store.kind === "postgres" ? "database" : "memory",
    detectors: listDetectors(),
  });
});

/**
 * Signals for one asset. Expired signals are filtered out rather than
 * returned with a flag: a feed that shows a two-hour-old volume spike as
 * though it were current is worse than one that shows nothing.
 */
router.get("/signals/:assetId", validateParams(z.object({ assetId: z.string().min(1).max(64) })), async (_req, res) => {
  const { assetId } = params<{ assetId: string }>(res);
  const store = getStore();

  const asset =
    (await store.getAssetById(assetId).catch(() => null)) ??
    (await store.getAssetBySymbol(assetId.toUpperCase()));
  if (!asset) throw AppError.notFound("Asset", assetId);

  const all = await store.listSignals({ assetId: asset.id, limit: 100 });
  const now = Date.now();
  const active = all.filter((signal) => new Date(signal.expiresAt).getTime() > now);

  if (active.length === 0) {
    return unavailable(res, `No active signals for ${asset.symbol}`, {
      store: store.kind === "postgres" ? "database" : "memory",
    });
  }

  return okList(res, active, {
    status: "live",
    count: active.length,
    retrievedAt: active[0]?.timestamp ?? null,
    store: store.kind === "postgres" ? "database" : "memory",
  });
});

// ----------------------------------------------------------------- arena --

router.get("/arena", async (_req, res) => {
  const store = getStore();
  const current = await store.getCurrentArenaRound();
  if (!current) {
    return unavailable(res, "Arena is waiting for sufficient market data", {
      store: store.kind === "postgres" ? "database" : "memory",
    });
  }

  const [view, history] = await Promise.all([getRoundView(), listRounds(10)]);
  const identities = assetIndex(await store.listAssets());
  return ok(
    res,
    {
      round: view.round,
      entries: withAssetIdentity(view.entries, identities),
      history,
    },
    { source: store.kind === "postgres" ? "database" : "memory", count: view.entries.length },
  );
});

const roundParam = z.object({ round: z.coerce.number().int().min(1) });

router.get("/arena/:round", validateParams(roundParam), async (_req, res) => {
  const { round } = params<z.infer<typeof roundParam>>(res);
  const view = await getRoundView(round);
  const store = getStore();
  const identities = assetIndex(await store.listAssets());
  return ok(res, { ...view, entries: withAssetIdentity(view.entries, identities) }, {
    source: store.kind === "postgres" ? "database" : "memory",
    count: view.entries.length,
  });
});

// --------------------------------------------------------------- compute --

router.get("/compute/status", async (_req, res) => {
  const status = getComputeStatus();
  const store = getStore();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const eventsLast24h = await store.countComputeEventsSince(since);
  const version = getComputeVersion();

  const providerStates = getProviderStates();

  // Read from the database, not from process memory. The in-memory counters
  // reset on restart and, in live mode, were never written at all — which is
  // why lastIngestionAt used to read as null on a pipeline that was plainly
  // running. Anything an operator uses to judge liveness must outlive the
  // process it describes.
  const persisted = await store.getPersistedStats();
  const database = await checkDatabaseHealth();

  return ok(res, {
    ...status,
    mode: "live" as const,
    processingTimeMs: status.lastRunDurationMs,
    lastIngestionAt: persisted.lastIngestionAt,
    lastComputationAt: persisted.lastComputationAt,
    assetsTracked: persisted.assetsTracked,
    scoresComputed: persisted.scoresComputed,
    signalsGenerated: persisted.signalsGenerated,
    computeEventsStored: persisted.computeEvents,
    marketSnapshotsStored: persisted.marketSnapshots,
    database: {
      status: database.connected ? "healthy" : database.configured ? "unhealthy" : "not_configured",
      store: store.kind,
      latencyMs: database.latencyMs,
    },
    eventsLast24h,
    weights: version.weights,
    versions: listComputeVersions().map((v) => ({
      version: v.version,
      description: v.description,
    })),
    // Per-source sync state: when each last succeeded and what it produced.
    // The counts and timestamps are the point; `lastError` is a provider's own
    // message and stays out of production responses for the same reason it
    // does on /api/health — it is prose we did not author, on an endpoint
    // nobody has to authenticate to read.
    providers: Object.fromEntries(
      providerStates.map((p) => [
        p.provider,
        {
          lastAttemptAt: p.lastAttemptAt,
          lastSuccessAt: p.lastSuccessAt,
          lastDurationMs: p.lastDurationMs,
          recordsFetched: p.recordsFetched,
          recordsStored: p.recordsStored,
          recordsRejected: p.recordsRejected,
          consecutiveFailures: p.consecutiveFailures,
          ...(env.isProduction
            ? {}
            : { lastError: p.lastError, lastErrorAt: p.lastErrorAt }),
        },
      ]),
    ),
    ...(env.isProduction
      ? {}
      : {
          providerErrors: providerStates
            .filter((p) => p.lastError !== null)
            .map((p) => ({ provider: p.provider, error: p.lastError, at: p.lastErrorAt })),
        }),
    chain: getLastChainObservation(),
    securityChecked: listSecuritySnapshots().length,
    jobs: scheduler.getStates(),
    ...(env.isProduction ? {} : { sourcePriority: SOURCE_PRIORITY }),
  });
});

/**
 * `/compute/metrics/:assetId` used to live here and returned raw metric rows.
 * It is now served by the intelligence router, which returns the engine
 * outputs with their reasons. Two handlers for one path is a shadowing bug
 * waiting to happen — Express takes whichever mounted first — so the older
 * one is gone rather than renamed.
 */

