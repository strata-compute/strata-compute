import { Router } from "express";
import { z } from "zod";
import { getStore } from "../../database/index.ts";
import { getComputeVersion, listComputeVersions } from "../../compute/registry.ts";
import { computeBreadth } from "../../intelligence/market.ts";
import { getLatestEarlyMovers, getLatestRegime } from "../../pipeline.ts";
import { AppError } from "../../utils/errors.ts";
import { params, query, validateParams, validateQuery } from "../middleware/validate.ts";
import { ok, okList, unavailable } from "../respond.ts";

/**
 * THE INTELLIGENCE API
 *
 * Every route here serves what the background pipeline already computed. None
 * of them compute on the request path — two readers hitting /rankings and
 * /compute/score in the same second must see the same numbers, and they
 * cannot if each request runs its own pass.
 *
 * The response contract mirrors the engine's: a value that could not be
 * computed is null and the reason travels with it, so a client never has to
 * guess whether a missing number means zero, pending, or unsupported.
 */

export const intelligenceRouter: Router = Router();

const storeKind = () =>
  getStore().kind === "postgres" ? ("database" as const) : ("memory" as const);

/** Resolves an id or a symbol, so URLs stay usable by hand. */
async function resolveAssetId(idOrSymbol: string): Promise<string | null> {
  const store = getStore();
  const byId = await store.getAssetById(idOrSymbol).catch(() => null);
  if (byId) return byId.id;
  const bySymbol = await store.getAssetBySymbol(idOrSymbol.toUpperCase());
  return bySymbol?.id ?? null;
}

const assetParam = z.object({ assetId: z.string().min(1).max(64) });

/* ------------------------------------------------------ compute/score --- */

intelligenceRouter.get(
  "/compute/score/:assetId",
  validateParams(assetParam),
  async (_req, res) => {
    const { assetId } = params<z.infer<typeof assetParam>>(res);
    const resolved = await resolveAssetId(assetId);
    if (!resolved) throw AppError.notFound("Asset", assetId);

    const record = await getStore().getLatestIntelligence(resolved);
    if (!record) {
      return unavailable(res, `No computation has run for ${assetId} yet`, {
        store: storeKind(),
      });
    }

    return ok(
      res,
      {
        assetId: record.assetId,
        symbol: record.symbol,
        status: record.score.status,
        score: record.score.score,
        version: record.score.version,
        // the scoring method and the population it ranked against; a score is
        // not interpretable without both
        scoreVersion: (record.score as { scoreVersion?: string }).scoreVersion ?? null,
        scoreUniverse: (record.score as { scoreUniverse?: string }).scoreUniverse ?? null,
        universeLabel: (record.score as { universeLabel?: string }).universeLabel ?? null,
        universeFellBack:
          (record.score as { universeFellBack?: boolean }).universeFellBack ?? false,
        bucket: (record.score as { bucket?: string | null }).bucket ?? null,
        composite: (record.score as { composite?: number | null }).composite ?? null,
        anchored: (record.score as { anchored?: boolean }).anchored ?? false,
        confidence: record.score.confidence,
        components: record.score.components,
        missing: record.score.missing,
        insufficientReason: record.score.insufficientReason,
        calculatedAt: record.score.calculatedAt,
      },
      {
        status: record.score.status === "OK" ? "live" : "unavailable",
        retrievedAt: record.timestamp,
        store: storeKind(),
      },
    );
  },
);

/* ---------------------------------------------------- compute/metrics --- */

intelligenceRouter.get(
  "/compute/metrics/:assetId",
  validateParams(assetParam),
  async (_req, res) => {
    const { assetId } = params<z.infer<typeof assetParam>>(res);
    const resolved = await resolveAssetId(assetId);
    if (!resolved) throw AppError.notFound("Asset", assetId);

    const record = await getStore().getLatestIntelligence(resolved);
    if (!record) {
      return unavailable(res, `No computation has run for ${assetId} yet`, {
        store: storeKind(),
      });
    }

    return ok(
      res,
      {
        assetId: record.assetId,
        symbol: record.symbol,
        engines: record.engines,
        historyPoints: record.historyPoints,
        ageSeconds: record.ageSeconds,
        computationVersion: record.score.version,
      },
      { retrievedAt: record.timestamp, store: storeKind() },
    );
  },
);

/* ------------------------------------------------ compute/explanation --- */

intelligenceRouter.get(
  "/compute/explanation/:assetId",
  validateParams(assetParam),
  async (_req, res) => {
    const { assetId } = params<z.infer<typeof assetParam>>(res);
    const resolved = await resolveAssetId(assetId);
    if (!resolved) throw AppError.notFound("Asset", assetId);

    const store = getStore();
    const record = await store.getLatestIntelligence(resolved);
    if (!record) {
      return unavailable(res, `No computation has run for ${assetId} yet`, {
        store: storeKind(),
      });
    }

    // "why it moved" is assembled from measured facts only: the drivers that
    // built the score, plus any signal this asset actually fired
    const signals = await store.listSignals({ assetId: resolved, limit: 8 });
    const now = Date.now();
    const active = signals.filter((s) => new Date(s.expiresAt).getTime() > now);

    return ok(
      res,
      {
        assetId: record.assetId,
        symbol: record.symbol,
        status: record.score.status,
        score: record.score.score,
        confidence: record.score.confidence,
        drivers: record.score.drivers,
        missing: record.score.missing,
        insufficientReason: record.score.insufficientReason,
        observations: active.map((signal) => ({
          type: signal.signalType,
          severity: signal.severity,
          value: signal.value,
          detail: signal.metadata?.summary ?? null,
          detectedAt: signal.timestamp,
        })),
        calculatedAt: record.score.calculatedAt,
      },
      { retrievedAt: record.timestamp, store: storeKind() },
    );
  },
);

/* --------------------------------------------------- compute/history --- */

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

intelligenceRouter.get(
  "/compute/history/:assetId",
  validateParams(assetParam),
  validateQuery(historyQuery),
  async (_req, res) => {
    const { assetId } = params<z.infer<typeof assetParam>>(res);
    const q = query<z.infer<typeof historyQuery>>(res);
    const resolved = await resolveAssetId(assetId);
    if (!resolved) throw AppError.notFound("Asset", assetId);

    const records = await getStore().getIntelligenceHistory(resolved, q.limit);
    if (records.length === 0) {
      return unavailable(res, `No computation history stored for ${assetId} yet`, {
        store: storeKind(),
      });
    }

    // newest first from the store; the change is stated against the oldest
    // point actually held, never against an assumed starting value
    const points = records.map((record) => ({
      timestamp: record.timestamp,
      score: record.score.score,
      status: record.score.status,
      confidence: record.score.confidence.value,
      momentum: record.engines.momentum.score,
      version: record.score.version,
    }));

    const scored = points.filter((p) => p.score !== null);
    const newest = scored[0]?.score ?? null;
    const oldest = scored.at(-1)?.score ?? null;

    return ok(
      res,
      {
        assetId: resolved,
        symbol: records[0]?.symbol ?? null,
        points,
        change:
          newest !== null && oldest !== null
            ? Number((newest - oldest).toFixed(2))
            : null,
        spanSeconds:
          records.length > 1
            ? Math.round(
                (new Date(records[0]!.timestamp).getTime() -
                  new Date(records.at(-1)!.timestamp).getTime()) /
                  1000,
              )
            : 0,
      },
      { count: points.length, store: storeKind() },
    );
  },
);

/* ---------------------------------------------------- compute/events --- */

const eventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  assetId: z.string().min(1).max(64).optional(),
});

intelligenceRouter.get("/compute/events", validateQuery(eventsQuery), async (_req, res) => {
  const q = query<z.infer<typeof eventsQuery>>(res);
  const store = getStore();

  const resolved = q.assetId ? await resolveAssetId(q.assetId) : undefined;
  if (q.assetId && !resolved) {
    throw AppError.notFound("Asset", q.assetId);
  }

  const events = await store.listComputeEvents(q.limit, resolved ?? undefined);
  if (events.length === 0) {
    return unavailable(res, "No compute events recorded yet", { store: storeKind() });
  }

  const assets = await store.listAssets({});
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));

  return okList(
    res,
    events.map((event) => {
      const input = (event.inputData ?? {}) as Record<string, unknown>;
      const output = (event.outputData ?? {}) as Record<string, unknown>;
      return {
        id: event.id ?? null,
        assetId: event.assetId,
        symbol: event.assetId ? (symbolById.get(event.assetId) ?? null) : null,
        eventType: event.eventType,
        previousValue: input.previousValue ?? null,
        newValue: output.newValue ?? null,
        change: output.change ?? null,
        metadata: { ...input, ...output },
        computationVersion: event.computationVersion,
        timestamp: event.createdAt,
      };
    }),
    { count: events.length, store: storeKind() },
  );
});

/* -------------------------------------------------- compute/versions --- */

intelligenceRouter.get("/compute/versions", async (_req, res) => {
  return okList(res, listComputeVersions(), { count: listComputeVersions().length });
});

intelligenceRouter.get("/compute/version", async (_req, res) => {
  return ok(res, getComputeVersion());
});

/* ------------------------------------------------------ market/regime --- */

intelligenceRouter.get("/market/regime", async (_req, res) => {
  const regime = getLatestRegime();
  if (!regime) {
    return unavailable(res, "No computation pass has run yet", { store: storeKind() });
  }
  if (regime.status === "INSUFFICIENT_DATA") {
    return unavailable(res, regime.insufficientReason ?? "insufficient data for a regime", {
      store: storeKind(),
    });
  }

  return ok(
    res,
    {
      state: regime.state,
      confidence: regime.confidence,
      drivers: regime.drivers,
      breadth: regime.breadth,
      calculatedAt: regime.calculatedAt,
    },
    { status: "live", retrievedAt: regime.calculatedAt, store: storeKind() },
  );
});

/* ----------------------------------------------------- market/breadth --- */

intelligenceRouter.get("/market/breadth", async (_req, res) => {
  const store = getStore();
  const rows = await store.getLatestMarketRows({ limit: 500 });

  const records = rows
    .filter((row) => row.snapshot !== null)
    .map((row) => ({
      assetType: row.asset.assetType,
      priceChange24h: row.snapshot!.priceChange24h,
    }));

  if (records.length === 0) {
    return unavailable(res, "No market observations stored yet", { store: storeKind() });
  }

  const breadth = computeBreadth(records);
  return ok(res, breadth, {
    status: "live",
    retrievedAt: breadth.calculatedAt,
    count: breadth.overall.total,
    store: storeKind(),
  });
});

/* ------------------------------------------------ market/early-movers --- */

const earlyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  stage: z.enum(["EARLY", "WATCH", "CONFIRMED"]).optional(),
});

intelligenceRouter.get("/market/early-movers", validateQuery(earlyQuery), async (_req, res) => {
  const q = query<z.infer<typeof earlyQuery>>(res);
  const movers = getLatestEarlyMovers();

  if (movers.length === 0) {
    return unavailable(
      res,
      "No assets are currently showing early acceleration, or history is too thin to detect it",
      { store: storeKind() },
    );
  }

  const filtered = q.stage ? movers.filter((m) => m.stage === q.stage) : movers;
  if (filtered.length === 0) {
    return unavailable(res, `No assets are currently at stage ${q.stage}`, {
      store: storeKind(),
    });
  }

  return okList(res, filtered.slice(0, q.limit), {
    status: "live",
    count: filtered.length,
    store: storeKind(),
  });
});
