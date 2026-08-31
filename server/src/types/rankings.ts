import type { IsoTimestamp } from "../utils/time.ts";
import type { AssetType } from "./domain.ts";

export const RANKING_METRICS = [
  "score",
  "momentum",
  "volume",
  "activity",
  "relativeStrength",
  "trend",
] as const;

export type RankingMetric = (typeof RANKING_METRICS)[number];

export interface RankingEntry {
  rank: number;
  assetId: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  /** Value of the metric this ranking was ordered by. */
  value: number;
  score: number;
  /** Confidence in the inputs behind this entry's score, 0-1. */
  confidence: number;
  /** Rank delta against the previous snapshot; null when unknown. */
  change: number | null;
  timestamp: IsoTimestamp;
}

export interface RankingSnapshot {
  metric: RankingMetric;
  assetType: AssetType | "all";
  entries: RankingEntry[];
  timestamp: IsoTimestamp;
}
