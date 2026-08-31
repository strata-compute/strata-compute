import "server-only";

import {
  ApiError,
  getArena,
  getArenaRound,
  getAssets,
  getComputeStatus,
  getMarket,
  getMarkets,
  getRankings,
  getSignals,
  apiRequest,
  toUiAssets,
  type ApiArenaView,
  type ApiComputeStatus,
  type ApiMarket,
  type ApiMeta,
  type ApiRankingSnapshot,
  type ApiSignal,
  type ApiComputeScore,
  type ApiComputeMetrics,
  type ApiComputeExplanation,
  type ApiComputeHistory,
  type ApiComputeEvent,
  type ApiMarketRegime,
  type ApiMarketBreadth,
  type ApiEarlyMover,
  getComputeScore,
  getComputeEngines,
  getComputeExplanation,
  getComputeHistory,
  getComputeEvents,
  getMarketRegime,
  getMarketBreadth,
  getEarlyMovers,
  getAssetSignals,
  getComputeVersionInfo,
  getArenaCurrent,
  getArenaHistory,
  getArenaWinners,
  getArenaRoundEvents,
  type ApiComputeVersionInfo,
  type ApiArenaCurrent,
  type ApiArenaEvent,
  type ApiArenaRoundFull,
  getIntelligenceEvents,
  getAssetIntelligenceEvents,
  getMarketIntelligence,
  type ApiAssetIntelligence,
  type ApiAssetType,
  type ApiIntelligenceEvent,
  type ApiIntelligenceSeverity,
  type ApiMarketIntelligence,
} from "@/lib/api";
import type { Asset } from "@/lib/types";

/**
 * The only way a page obtains market data.
 *
 * There is no second source. If the Strata API cannot answer, these resolvers
 * return `status: "unavailable"` with `data: null` — they never substitute a
 * fixture, a cached constant or a generated value, because presenting an
 * invented number as a market figure is the one failure mode this layer
 * exists to prevent.
 *
 * `server-only` keeps every call on the server: the browser never talks to a
 * provider and no credential is reachable from a client bundle.
 */

export type DataStatus = "live" | "delayed" | "stale" | "unavailable" | "error";

export interface Resolved<T> {
  status: DataStatus;
  data: T | null;
  /** Providers behind the payload. Empty when there is none. */
  sources: string[];
  retrievedAt: string | null;
  ageSeconds: number | null;
  /** Present when the request failed or the backend reported no data. */
  reason: string | null;
  /**
   * True only when the backend positively reported that the resource does
   * not exist (HTTP 404) — as distinct from existing but having no data yet.
   * Pages turn this into a real 404 instead of an empty panel, so a wrong
   * address is never presented as a temporary gap in coverage.
   */
  missing: boolean;
}

function unavailable<T>(reason: string, missing = false): Resolved<T> {
  return {
    status: "unavailable",
    data: null,
    sources: [],
    retrievedAt: null,
    ageSeconds: null,
    reason,
    missing,
  };
}

function failed<T>(error: unknown): Resolved<T> {
  const reason =
    error instanceof ApiError
      ? error.code === "NETWORK_ERROR" || error.code === "TIMEOUT"
        ? "The Strata API did not respond."
        : error.message
      : "The Strata API did not respond.";
  return {
    status: "error",
    data: null,
    sources: [],
    retrievedAt: null,
    ageSeconds: null,
    reason,
    missing: false,
  };
}

function resolved<T>(data: T, meta: ApiMeta): Resolved<T> {
  const status = (meta.status as DataStatus | undefined) ?? "live";
  return {
    status,
    data,
    missing: false,
    sources: (meta.sources as string[] | undefined) ?? [],
    retrievedAt: (meta.retrievedAt as string | null | undefined) ?? null,
    ageSeconds: (meta.ageSeconds as number | null | undefined) ?? null,
    reason: null,
  };
}

/** The backend answers an empty result with `data: null` and a reason. */
function isEmptyEnvelope(data: unknown): boolean {
  return data === null || data === undefined;
}

const REVALIDATE = 15;

/* ------------------------------------------------------------- markets --- */

export async function loadMarkets(
  params: { limit?: number; type?: "stock" | "crypto" | "onchain" } = {},
): Promise<Resolved<Asset[]>> {
  try {
    const { data, meta } = await getMarkets(
      { limit: params.limit ?? 200, ...(params.type ? { type: params.type } : {}) },
      { revalidate: REVALIDATE },
    );

    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? "No market data available"));
    }

    // only rows that carry a real price are renderable as markets
    const priced = (data as ApiMarket[]).filter((m) => m.price !== null);
    if (priced.length === 0) {
      return unavailable("No market data available");
    }

    return resolved(toUiAssets(priced), meta);
  } catch (error) {
    return failed(error);
  }
}

export type MarketDetail = ApiMarket & {
  history?: unknown;
  /** Convenience: lifted off the nested asset for the detail view. */
  contractAddress: string | null;
};

export async function loadMarket(symbol: string): Promise<Resolved<MarketDetail>> {
  try {
    const { data, meta } = await getMarket(symbol, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) return unavailable(`No market data for ${symbol}`);
    return resolved(
      { ...data, contractAddress: data.asset.contractAddress },
      meta,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // the backend is reachable and says this symbol does not exist
      return unavailable(`${symbol.toUpperCase()} is not in the compute set`, true);
    }
    return failed(error);
  }
}

/* ------------------------------------------------------------ rankings --- */

export async function loadRankings(
  params: {
    metric?: "score" | "momentum" | "volume" | "activity";
    type?: "stock" | "crypto" | "onchain";
    limit?: number;
  } = {},
): Promise<Resolved<ApiRankingSnapshot>> {
  try {
    const { data, meta } = await getRankings(params, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(
        String(meta.reason ?? "Insufficient live data to calculate rankings"),
      );
    }
    return resolved(data as ApiRankingSnapshot, meta);
  } catch (error) {
    return failed(error);
  }
}

/* ------------------------------------------------------------- signals --- */

export async function loadSignals(
  params: { limit?: number } = {},
): Promise<Resolved<ApiSignal[]>> {
  try {
    const { data, meta } = await getSignals(
      { limit: params.limit ?? 50 },
      { revalidate: REVALIDATE },
    );
    if (isEmptyEnvelope(data) || (data as ApiSignal[]).length === 0) {
      return unavailable(String(meta.reason ?? "No active signals detected"));
    }
    return resolved(data as ApiSignal[], meta);
  } catch (error) {
    return failed(error);
  }
}

/* --------------------------------------------------------------- arena --- */

export async function loadArena(): Promise<Resolved<ApiArenaView>> {
  try {
    const { data, meta } = await getArena({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(
        String(meta.reason ?? "Arena is waiting for sufficient market data"),
      );
    }
    return resolved(data as ApiArenaView, meta);
  } catch (error) {
    return failed(error);
  }
}

/* ------------------------------------------------------------- compute --- */

export async function loadComputeStatus(): Promise<Resolved<ApiComputeStatus>> {
  try {
    const { data, meta } = await getComputeStatus({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) return unavailable("Compute status unavailable");
    return resolved(data as ApiComputeStatus, meta);
  } catch (error) {
    return failed(error);
  }
}

/* --------------------------------------------------------------- stats --- */

export interface PlatformStats {
  assetsTracked: number;
  marketsPriced: number;
  marketsScored: number;
  volume24h: number | null;
  volumeCoverage: number;
  computeEvents24h: number;
  byClass: { stock: number; crypto: number; onchain: number };
  computationVersion: string;
}

export async function loadStats(): Promise<Resolved<PlatformStats>> {
  try {
    const { data, meta } = await apiRequest<PlatformStats>("/api/stats", {
      revalidate: REVALIDATE,
    });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? "No coverage data available"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

/* -------------------------------------------------------------- assets --- */

export async function loadAssetList(
  params: { limit?: number } = {},
): Promise<Resolved<Asset[]>> {
  // the asset list is the market list: an asset with no price is not
  // something the UI can present as a market
  return loadMarkets({ limit: params.limit ?? 300 });
}

/**
 * A single arena round. A round number the backend does not know is a wrong
 * address, not a data gap, so it is reported as missing and the route
 * answers 404.
 */
export async function loadArenaRound(
  round: number,
): Promise<Resolved<ApiArenaView>> {
  try {
    const { data, meta } = await getArenaRound(round, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(`Round ${round} has no recorded standings`, true);
    }
    return resolved(data, meta);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return unavailable(`Round ${round} does not exist`, true);
    }
    return failed(error);
  }
}

export { getAssets as loadRawAssets };

/* ==================================================================== */
/*  PHASE 5 — INTELLIGENCE LOADERS                                      */
/*                                                                      */
/*  Same contract as everything above: the backend computed it, or the  */
/*  page renders an unavailable state. None of these fall back.         */
/* ==================================================================== */

export async function loadScore(
  symbol: string,
): Promise<Resolved<ApiComputeScore>> {
  try {
    const { data, meta } = await getComputeScore(symbol, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? `No computation for ${symbol} yet`));
    }
    return resolved(data, meta);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return unavailable(`${symbol.toUpperCase()} is not in the compute set`, true);
    }
    return failed(error);
  }
}

export async function loadEngines(
  symbol: string,
): Promise<Resolved<ApiComputeMetrics>> {
  try {
    const { data, meta } = await getComputeEngines(symbol, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? `No computation for ${symbol} yet`));
    }
    return resolved(data, meta);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return unavailable(`${symbol.toUpperCase()} is not in the compute set`, true);
    }
    return failed(error);
  }
}

export async function loadExplanation(
  symbol: string,
): Promise<Resolved<ApiComputeExplanation>> {
  try {
    const { data, meta } = await getComputeExplanation(symbol, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? `No explanation available for ${symbol}`));
    }
    return resolved(data, meta);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return unavailable(`${symbol.toUpperCase()} is not in the compute set`, true);
    }
    return failed(error);
  }
}

export async function loadScoreHistory(
  symbol: string,
  limit = 120,
): Promise<Resolved<ApiComputeHistory>> {
  try {
    const { data, meta } = await getComputeHistory(symbol, { limit }, { revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? "No computation history stored yet"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadAssetSignals(
  symbol: string,
): Promise<Resolved<ApiSignal[]>> {
  try {
    const { data, meta } = await getAssetSignals(symbol, { revalidate: REVALIDATE });
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(String(meta.reason ?? `No active signals for ${symbol}`));
    }
    return resolved(data, meta);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return unavailable(`${symbol.toUpperCase()} is not in the compute set`, true);
    }
    return failed(error);
  }
}

export async function loadRegime(): Promise<Resolved<ApiMarketRegime>> {
  try {
    const { data, meta } = await getMarketRegime({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? "No market regime computed yet"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadBreadth(): Promise<Resolved<ApiMarketBreadth>> {
  try {
    const { data, meta } = await getMarketBreadth({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? "No market breadth computed yet"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadEarlyMovers(
  limit = 12,
): Promise<Resolved<ApiEarlyMover[]>> {
  try {
    const { data, meta } = await getEarlyMovers({ limit }, { revalidate: REVALIDATE });
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(String(meta.reason ?? "No early acceleration detected"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadComputeEvents(
  limit = 40,
): Promise<Resolved<ApiComputeEvent[]>> {
  try {
    const { data, meta } = await getComputeEvents({ limit }, { revalidate: REVALIDATE });
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(String(meta.reason ?? "No compute events recorded yet"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

/**
 * The published weights behind the current scoring version.
 *
 * Read from the backend rather than duplicated here. A second copy of the
 * weights in the frontend is a copy that will eventually disagree with the
 * engine, and the interface would then explain a score using numbers that did
 * not produce it.
 */
export async function loadScoringVersion(): Promise<Resolved<ApiComputeVersionInfo>> {
  try {
    const { data, meta } = await getComputeVersionInfo({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) return unavailable("Scoring version unavailable");
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

/* ==================================================================== */
/*  PHASE 6 — ARENA LOADERS                                             */
/* ==================================================================== */

export async function loadArenaCurrent(): Promise<Resolved<ApiArenaCurrent>> {
  try {
    const { data, meta } = await getArenaCurrent({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? "No Arena round is open"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadArenaHistory(
  limit = 40,
): Promise<Resolved<ApiArenaRoundFull[]>> {
  try {
    const { data, meta } = await getArenaHistory({ limit }, { revalidate: REVALIDATE });
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(String(meta.reason ?? "No Arena round has settled yet"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadArenaWinners(
  limit = 20,
): Promise<Resolved<ApiArenaRoundFull[]>> {
  try {
    const { data, meta } = await getArenaWinners({ limit }, { revalidate: REVALIDATE });
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(String(meta.reason ?? "No Arena round has produced a winner yet"));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadArenaRoundEvents(
  roundNumber: number,
): Promise<Resolved<ApiArenaEvent[]>> {
  try {
    const { data, meta } = await getArenaRoundEvents(roundNumber, {
      revalidate: REVALIDATE,
    });
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(String(meta.reason ?? `No events recorded for round ${roundNumber}`));
    }
    return resolved(data, meta);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return unavailable(`Round ${roundNumber} does not exist`, true);
    }
    return failed(error);
  }
}

/* ------------------------------------------------------- intelligence --- */

/**
 * Detected intelligence, newest and most significant first.
 *
 * Defaults to conditions that are currently holding rather than the archive:
 * a feed of resolved events reads like a market that is still moving when it
 * has already stopped.
 */
export async function loadIntelligenceEvents(
  params: {
    limit?: number;
    type?: string;
    assetType?: ApiAssetType;
    severity?: ApiIntelligenceSeverity;
    status?: string;
  } = {},
): Promise<Resolved<ApiIntelligenceEvent[]>> {
  try {
    const { data, meta } = await getIntelligenceEvents(
      { limit: 60, ...params },
      { revalidate: REVALIDATE },
    );
    if (!Array.isArray(data) || data.length === 0) {
      return unavailable(
        String(meta.reason ?? "No intelligence events are currently active"),
      );
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadAssetIntelligenceEvents(
  symbol: string,
): Promise<Resolved<ApiAssetIntelligence>> {
  try {
    const { data, meta } = await getAssetIntelligenceEvents(symbol, {
      revalidate: REVALIDATE,
    });
    if (isEmptyEnvelope(data)) {
      return unavailable(String(meta.reason ?? `No intelligence recorded for ${symbol}`));
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}

export async function loadMarketIntelligence(): Promise<Resolved<ApiMarketIntelligence>> {
  try {
    const { data, meta } = await getMarketIntelligence({ revalidate: REVALIDATE });
    if (isEmptyEnvelope(data)) {
      return unavailable(
        String(meta.reason ?? "No market intelligence computed yet"),
      );
    }
    return resolved(data, meta);
  } catch (error) {
    return failed(error);
  }
}
