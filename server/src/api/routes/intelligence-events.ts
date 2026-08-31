import { Router } from "express";
import { z } from "zod";
import { getStore } from "../../database/index.ts";
import { getLatestRegime } from "../../pipeline.ts";
import {
  INTELLIGENCE_EVENT_TYPES,
  INTELLIGENCE_SEVERITIES,
  INTELLIGENCE_EVENT_STATUSES,
} from "../../types/intelligence-events.ts";
import { ASSET_TYPES } from "../../types/domain.ts";
import { AppError } from "../../utils/errors.ts";
import { params, query, validateParams, validateQuery } from "../middleware/validate.ts";
import { ok, okList, unavailable } from "../respond.ts";

/**
 * THE INTELLIGENCE API
 *
 * Serves what the detection pass already computed and stored. Nothing is
 * detected on the request path: two readers asking the same question in the
 * same second must get the same answer, and they cannot if each request runs
 * its own detection.
 *
 * When nothing significant is happening these endpoints return an empty
 * state. A quiet market is a real finding and is reported as one — no
 * placeholder events are ever manufactured to fill a feed.
 */

export const intelligenceEventsRouter: Router = Router();

const storeKind = () =>
  getStore().kind === "postgres" ? ("database" as const) : ("memory" as const);

const listQuery = z.object({
  type: z.string().max(400).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  severity: z.enum(INTELLIGENCE_SEVERITIES).optional(),
  status: z.string().max(120).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function parseTypes(raw: string | undefined) {
  if (!raw) return undefined;
  const requested = raw
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v): v is (typeof INTELLIGENCE_EVENT_TYPES)[number] =>
      (INTELLIGENCE_EVENT_TYPES as readonly string[]).includes(v),
    );
  return requested.length > 0 ? requested : undefined;
}

function parseStatuses(raw: string | undefined) {
  if (!raw) return undefined;
  const requested = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is (typeof INTELLIGENCE_EVENT_STATUSES)[number] =>
      (INTELLIGENCE_EVENT_STATUSES as readonly string[]).includes(v),
    );
  return requested.length > 0 ? requested : undefined;
}

/* ------------------------------------------------------------- listing --- */

intelligenceEventsRouter.get("/intelligence", validateQuery(listQuery), async (_req, res) => {
  const q = query<z.infer<typeof listQuery>>(res);
  const store = getStore();

  const events = await store.listIntelligenceEvents({
    limit: q.limit,
    ...(parseTypes(q.type) ? { types: parseTypes(q.type) } : {}),
    ...(q.assetType ? { assetType: q.assetType } : {}),
    ...(q.severity ? { severity: q.severity } : {}),
    // default to what is currently happening rather than the whole archive
    status: parseStatuses(q.status) ?? ["detected", "active"],
    ...(q.since ? { since: q.since } : {}),
  });

  if (events.length === 0) {
    return unavailable(
      res,
      "No intelligence events match. Events appear when computed evidence crosses a significance threshold.",
      { store: storeKind() },
    );
  }

  return okList(res, events, {
    status: "live",
    count: events.length,
    retrievedAt: events[0]?.latestAt ?? null,
    store: storeKind(),
  });
});

/**
 * Event ids are UUIDs, and the shape is validated here rather than in SQL.
 *
 * Without this a malformed id reaches Postgres, which rejects it as a cast
 * failure — surfacing as a 500 carrying the database's own error text. An id
 * that cannot exist is a 404, and the client learns nothing about the storage
 * engine from asking.
 */
const idParam = z.object({ id: z.uuid() });

intelligenceEventsRouter.get(
  "/intelligence/event/:id",
  validateParams(idParam),
  async (_req, res) => {
    const { id } = params<z.infer<typeof idParam>>(res);
    const event = await getStore().getIntelligenceEvent(id);
    if (!event) throw AppError.notFound("Intelligence event", id);
    return ok(res, event, { store: storeKind() });
  },
);

/* -------------------------------------------------------- by asset ------ */

const assetParam = z.object({ assetId: z.string().min(1).max(64) });

intelligenceEventsRouter.get(
  "/intelligence/assets/:assetId",
  validateParams(assetParam),
  async (_req, res) => {
    const { assetId } = params<z.infer<typeof assetParam>>(res);
    const store = getStore();

    const asset =
      (await store.getAssetById(assetId).catch(() => null)) ??
      (await store.getAssetBySymbol(assetId.toUpperCase()));
    if (!asset) throw AppError.notFound("Asset", assetId);

    const [active, recent] = await Promise.all([
      store.listIntelligenceEvents({
        assetId: asset.id,
        status: ["detected", "active"],
        limit: 20,
      }),
      store.listIntelligenceEvents({ assetId: asset.id, limit: 40 }),
    ]);

    if (active.length === 0 && recent.length === 0) {
      return unavailable(res, `No intelligence recorded for ${asset.symbol}`, {
        store: storeKind(),
      });
    }

    return ok(
      res,
      { symbol: asset.symbol, active, recent },
      { status: "live", count: active.length, store: storeKind() },
    );
  },
);

/* ------------------------------------------------------------- market --- */

/**
 * Aggregate market intelligence.
 *
 * Every section is drawn from stored events; a section with nothing in it is
 * returned empty rather than filled. An honest empty market view is more
 * useful than a populated one that invented its contents.
 */
intelligenceEventsRouter.get("/intelligence/market", async (_req, res) => {
  const store = getStore();

  const open = await store.listOpenIntelligenceEvents();
  const regime = getLatestRegime();

  const byType = (types: string[]) =>
    open
      .filter((e) => types.includes(e.eventType))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10);

  const payload = {
    breadth: regime?.breadth ?? null,
    regime:
      regime && regime.status === "OK"
        ? {
            state: regime.state,
            confidence: regime.confidence,
            drivers: regime.drivers,
            calculatedAt: regime.calculatedAt,
          }
        : null,
    strongestAccelerations: byType(["STRENGTH_ACCELERATION"]),
    largestDeteriorations: byType(["STRENGTH_DETERIORATION"]),
    volumeAnomalies: byType(["VOLUME_EXPANSION", "VOLUME_CONTRACTION", "ANOMALY"]),
    rankMovers: byType(["RANK_ACCELERATION", "RANK_DETERIORATION"]),
    regimeShifts: byType(["REGIME_SHIFT"]),
    rotation: byType(["CROSS_MARKET_ROTATION"]),
    openEventCount: open.length,
  };

  const hasAnything =
    open.length > 0 || payload.regime !== null || payload.breadth !== null;

  if (!hasAnything) {
    return unavailable(
      res,
      "No market intelligence yet. Detection needs several computation passes of history.",
      { store: storeKind() },
    );
  }

  return ok(res, payload, {
    status: "live",
    count: open.length,
    store: storeKind(),
  });
});
