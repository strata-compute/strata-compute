import { Router } from "express";
import { z } from "zod";
import {
  getRoundView,
  listRoundEvents,
  listRounds,
  listWinners,
} from "../../arena/service.ts";
import { arenaConfig } from "../../config/arena.ts";
import { getStore } from "../../database/index.ts";
import { AppError } from "../../utils/errors.ts";
import { params, query, validateParams, validateQuery } from "../middleware/validate.ts";
import { assetIndex, toAssetDto, withAssetIdentity } from "../dto.ts";
import { ok, okList, unavailable } from "../respond.ts";

/**
 * WATCHLIST, COMPARE AND ARENA HISTORY
 *
 * The watchlist itself lives in the browser — it is a per-reader preference,
 * and this build has no accounts to attach it to. What the backend owns is the
 * part that must not be guessable: an asset only enters a watchlist if the
 * server can resolve it, so a hand-edited localStorage entry produces a 404
 * rather than a row of invented figures.
 *
 * Comparison is served in one request rather than N. Fetching each column
 * separately would let the columns come from different computation passes,
 * and a comparison of numbers taken at different moments is not a comparison.
 */

export const phase6Router: Router = Router();

const storeKind = () =>
  getStore().kind === "postgres" ? ("database" as const) : ("memory" as const);

async function resolveAsset(idOrSymbol: string) {
  const store = getStore();
  const byId = await store.getAssetById(idOrSymbol).catch(() => null);
  if (byId) return byId;
  return store.getAssetBySymbol(idOrSymbol.toUpperCase());
}

/* ----------------------------------------------------------- watchlist --- */

const watchParam = z.object({ id: z.string().min(1).max(64) });

/**
 * Everything a watchlist row needs for one asset, in one request: the market
 * row, the score with its confidence, the engine readings, and any active
 * signal. All of it from the same stored pass.
 */
phase6Router.get(
  "/watchlist/assets/:id",
  validateParams(watchParam),
  async (_req, res) => {
    const { id } = params<z.infer<typeof watchParam>>(res);
    const store = getStore();

    const asset = await resolveAsset(id);
    if (!asset) throw AppError.notFound("Asset", id);

    const [row, intelligence, signals] = await Promise.all([
      store.getLatestMarketRow(asset.id),
      store.getLatestIntelligence(asset.id),
      store.listSignals({ assetId: asset.id, limit: 5 }),
    ]);

    const now = Date.now();
    const active = signals.filter((s) => new Date(s.expiresAt).getTime() > now);

    // rank is read from the stored ranking rather than recomputed, so the
    // watchlist and the rankings page cannot disagree
    const ranks = await store.getPreviousRanks("score", "all");

    return ok(
      res,
      {
        asset: toAssetDto(asset),
        price: row?.price?.price ?? null,
        priceChange24h: row?.price?.priceChange24h ?? null,
        volume24h: row?.price?.volume24h ?? null,
        score: intelligence?.score.score ?? null,
        scoreStatus: intelligence?.score.status ?? null,
        confidence: intelligence?.score.confidence ?? null,
        components: intelligence?.score.components ?? null,
        engines: intelligence?.engines ?? null,
        rank: ranks.get(asset.id) ?? null,
        signals: active.map((signal) => ({
          signalType: signal.signalType,
          severity: signal.severity,
          value: signal.value,
          summary: signal.metadata?.summary ?? null,
          timestamp: signal.timestamp,
        })),
        updatedAt: intelligence?.timestamp ?? row?.snapshot?.retrievedAt ?? null,
      },
      { store: storeKind(), retrievedAt: intelligence?.timestamp ?? null },
    );
  },
);

/* ------------------------------------------------------------- compare --- */

const compareQuery = z.object({
  assets: z.string().min(1).max(200),
});

phase6Router.get("/compare", validateQuery(compareQuery), async (_req, res) => {
  const q = query<z.infer<typeof compareQuery>>(res);
  const store = getStore();

  const requested = [
    ...new Set(
      q.assets
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 4);

  if (requested.length < 2) {
    return unavailable(res, "A comparison needs at least two assets", {
      store: storeKind(),
    });
  }

  const columns = [];
  const missing: string[] = [];

  for (const symbol of requested) {
    const asset = await resolveAsset(symbol);
    if (!asset) {
      // an unknown symbol is named rather than silently dropped: the reader
      // asked for it and deserves to know it is not covered
      missing.push(symbol);
      continue;
    }

    const [row, intelligence] = await Promise.all([
      store.getLatestMarketRow(asset.id),
      store.getLatestIntelligence(asset.id),
    ]);

    columns.push({
      asset: toAssetDto(asset),
      price: row?.price?.price ?? null,
      priceChange24h: row?.price?.priceChange24h ?? null,
      volume24h: row?.price?.volume24h ?? null,
      marketCap: row?.price?.marketCap ?? null,
      score: intelligence?.score.score ?? null,
      scoreStatus: intelligence?.score.status ?? null,
      confidence: intelligence?.score.confidence ?? null,
      components: intelligence?.score.components ?? {},
      engines: intelligence?.engines ?? null,
      updatedAt: intelligence?.timestamp ?? null,
    });
  }

  if (columns.length < 2) {
    return unavailable(
      res,
      `Not enough covered assets to compare${missing.length > 0 ? ` (unknown: ${missing.join(", ")})` : ""}`,
      { store: storeKind() },
    );
  }

  return ok(
    res,
    { columns, missing },
    { status: "live", count: columns.length, store: storeKind() },
  );
});

/* --------------------------------------------------------------- arena --- */

phase6Router.get("/arena/current", async (_req, res) => {
  const store = getStore();
  const current = await store.getCurrentArenaRound();

  if (!current) {
    const config = arenaConfig();
    return unavailable(
      res,
      `No Arena round is open. A round needs ${config.minimumField} scored assets.`,
      { store: storeKind() },
    );
  }

  const view = await getRoundView(current.roundNumber);
  const identities = assetIndex(await store.listAssets());

  return ok(
    res,
    {
      round: view.round,
      entries: withAssetIdentity(view.entries, identities),
      config: {
        version: arenaConfig().version,
        fieldSize: arenaConfig().fieldSize,
        startingHp: arenaConfig().startingHp,
        maximumHp: arenaConfig().maximumHp,
        atRiskHp: arenaConfig().atRiskHp,
        eliminationHp: arenaConfig().eliminationHp,
      },
    },
    { status: "live", count: view.entries.length, store: storeKind() },
  );
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

phase6Router.get("/arena/history", validateQuery(historyQuery), async (_req, res) => {
  const q = query<z.infer<typeof historyQuery>>(res);
  const rounds = await listRounds(q.limit);
  const settled = rounds.filter((round) => round.status === "settled");

  if (settled.length === 0) {
    return unavailable(
      res,
      "No Arena round has settled yet. History appears once the first round closes.",
      { store: storeKind() },
    );
  }

  return okList(res, settled, { count: settled.length, store: storeKind() });
});

phase6Router.get("/arena/winners", validateQuery(historyQuery), async (_req, res) => {
  const q = query<z.infer<typeof historyQuery>>(res);
  const winners = await listWinners(q.limit);

  if (winners.length === 0) {
    return unavailable(res, "No Arena round has produced a winner yet", {
      store: storeKind(),
    });
  }

  return okList(res, winners, { count: winners.length, store: storeKind() });
});

const roundParam = z.object({ roundId: z.coerce.number().int().min(1) });

phase6Router.get(
  "/arena/round/:roundId/events",
  validateParams(roundParam),
  async (_req, res) => {
    const { roundId } = params<z.infer<typeof roundParam>>(res);
    const events = await listRoundEvents(roundId, 100);

    if (events.length === 0) {
      return unavailable(res, `No events recorded for round ${roundId}`, {
        store: storeKind(),
      });
    }

    return okList(res, events, { count: events.length, store: storeKind() });
  },
);
