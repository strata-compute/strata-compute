import { apiRequest, type ApiResult, type RequestOptions } from "./client";
import type {
  ApiArenaConfig,
  ApiArenaCurrent,
  ApiArenaEvent,
  ApiArenaEntryFull,
  ApiArenaRoundFull,
  ApiArenaView,
  ApiAsset,
  ApiAssetType,
  ApiComputeEvent,
  ApiComputeExplanation,
  ApiComputeHistory,
  ApiComputeMetrics,
  ApiComputeScore,
  ApiComputeStatus,
  ApiComputeVersionInfo,
  ApiAssetIntelligence,
  ApiEarlyMover,
  ApiHealth,
  ApiIntelligenceEvent,
  ApiIntelligenceSeverity,
  ApiMarketIntelligence,
  ApiMarketBreadth,
  ApiMarketRegime,
  ApiMarket,
  ApiRankingSnapshot,
  ApiSignal,
  ApiSignalType,
} from "./types";

/**
 * One function per endpoint. Nothing here formats or renders — callers get
 * the wire shape plus the response metadata, which carries `mock` and
 * `source` so the UI can be honest about provenance.
 */

export function getHealth(options?: RequestOptions): Promise<ApiResult<ApiHealth>> {
  return apiRequest<ApiHealth>("/api/health", options);
}

export function getAssets(
  params: { type?: ApiAssetType; search?: string; limit?: number; offset?: number } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiAsset[]>> {
  return apiRequest<ApiAsset[]>("/api/assets", { ...options, params });
}

export function getAsset(
  idOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiAsset & { market: ApiMarket | null }>> {
  return apiRequest(`/api/assets/${encodeURIComponent(idOrSymbol)}`, options);
}

export function getMarkets(
  params: { type?: ApiAssetType; search?: string; limit?: number } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiMarket[]>> {
  return apiRequest<ApiMarket[]>("/api/markets", { ...options, params });
}

export function getMarket(
  idOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiMarket & { history: unknown }>> {
  return apiRequest(`/api/markets/${encodeURIComponent(idOrSymbol)}`, options);
}

export function getRankings(
  params: {
    metric?: "score" | "momentum" | "volume" | "activity";
    type?: ApiAssetType;
    limit?: number;
  } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiRankingSnapshot>> {
  return apiRequest<ApiRankingSnapshot>("/api/rankings", { ...options, params });
}

export function getSignals(
  params: {
    type?: ApiSignalType;
    assetType?: ApiAssetType;
    assetId?: string;
    sinceMinutes?: number;
    limit?: number;
  } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiSignal[]>> {
  return apiRequest<ApiSignal[]>("/api/signals", { ...options, params });
}

export function getArena(options?: RequestOptions): Promise<ApiResult<ApiArenaView>> {
  return apiRequest<ApiArenaView>("/api/arena", options);
}

export function getArenaRound(
  round: number,
  options?: RequestOptions,
): Promise<ApiResult<ApiArenaView>> {
  return apiRequest<ApiArenaView>(`/api/arena/${round}`, options);
}

export function getComputeStatus(
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeStatus>> {
  return apiRequest<ApiComputeStatus>("/api/compute/status", options);
}

export function getComputeMetrics(
  assetIdOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<unknown>> {
  return apiRequest(`/api/compute/metrics/${encodeURIComponent(assetIdOrSymbol)}`, options);
}

/* ------------------------------------------------- phase 5 intelligence -- */

export function getComputeScore(
  assetIdOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeScore>> {
  return apiRequest<ApiComputeScore>(
    `/api/compute/score/${encodeURIComponent(assetIdOrSymbol)}`,
    options,
  );
}

export function getComputeEngines(
  assetIdOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeMetrics>> {
  return apiRequest<ApiComputeMetrics>(
    `/api/compute/metrics/${encodeURIComponent(assetIdOrSymbol)}`,
    options,
  );
}

export function getComputeExplanation(
  assetIdOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeExplanation>> {
  return apiRequest<ApiComputeExplanation>(
    `/api/compute/explanation/${encodeURIComponent(assetIdOrSymbol)}`,
    options,
  );
}

export function getComputeHistory(
  assetIdOrSymbol: string,
  params: { limit?: number } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeHistory>> {
  return apiRequest<ApiComputeHistory>(
    `/api/compute/history/${encodeURIComponent(assetIdOrSymbol)}`,
    { ...options, params },
  );
}

export function getComputeEvents(
  params: { limit?: number; assetId?: string } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeEvent[]>> {
  return apiRequest<ApiComputeEvent[]>("/api/compute/events", { ...options, params });
}

export function getMarketRegime(
  options?: RequestOptions,
): Promise<ApiResult<ApiMarketRegime>> {
  return apiRequest<ApiMarketRegime>("/api/market/regime", options);
}

export function getMarketBreadth(
  options?: RequestOptions,
): Promise<ApiResult<ApiMarketBreadth>> {
  return apiRequest<ApiMarketBreadth>("/api/market/breadth", options);
}

export function getEarlyMovers(
  params: { limit?: number; stage?: string } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiEarlyMover[]>> {
  return apiRequest<ApiEarlyMover[]>("/api/market/early-movers", { ...options, params });
}

export function getAssetSignals(
  assetIdOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiSignal[]>> {
  return apiRequest<ApiSignal[]>(
    `/api/signals/${encodeURIComponent(assetIdOrSymbol)}`,
    options,
  );
}

export function getComputeVersionInfo(
  options?: RequestOptions,
): Promise<ApiResult<ApiComputeVersionInfo>> {
  return apiRequest<ApiComputeVersionInfo>("/api/compute/version", options);
}

export function getArenaCurrent(
  options?: RequestOptions,
): Promise<ApiResult<ApiArenaCurrent>> {
  return apiRequest<ApiArenaCurrent>("/api/arena/current", options);
}

export function getArenaHistory(
  params: { limit?: number } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiArenaRoundFull[]>> {
  return apiRequest<ApiArenaRoundFull[]>("/api/arena/history", { ...options, params });
}

export function getArenaWinners(
  params: { limit?: number } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiArenaRoundFull[]>> {
  return apiRequest<ApiArenaRoundFull[]>("/api/arena/winners", { ...options, params });
}

export function getArenaRoundEvents(
  roundNumber: number,
  options?: RequestOptions,
): Promise<ApiResult<ApiArenaEvent[]>> {
  return apiRequest<ApiArenaEvent[]>(`/api/arena/round/${roundNumber}/events`, options);
}

/* ------------------------------------------------------- intelligence --- */

export function getIntelligenceEvents(
  params: {
    type?: string;
    assetType?: ApiAssetType;
    severity?: ApiIntelligenceSeverity;
    status?: string;
    since?: string;
    limit?: number;
  } = {},
  options?: RequestOptions,
): Promise<ApiResult<ApiIntelligenceEvent[]>> {
  return apiRequest<ApiIntelligenceEvent[]>("/api/intelligence", { ...options, params });
}

export function getIntelligenceEvent(
  id: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiIntelligenceEvent>> {
  return apiRequest<ApiIntelligenceEvent>(
    `/api/intelligence/event/${encodeURIComponent(id)}`,
    options,
  );
}

export function getAssetIntelligenceEvents(
  assetIdOrSymbol: string,
  options?: RequestOptions,
): Promise<ApiResult<ApiAssetIntelligence>> {
  return apiRequest<ApiAssetIntelligence>(
    `/api/intelligence/assets/${encodeURIComponent(assetIdOrSymbol)}`,
    options,
  );
}

export function getMarketIntelligence(
  options?: RequestOptions,
): Promise<ApiResult<ApiMarketIntelligence>> {
  return apiRequest<ApiMarketIntelligence>("/api/intelligence/market", options);
}
