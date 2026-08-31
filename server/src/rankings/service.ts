import type { Asset, AssetIntelligence, AssetType } from "../types/domain.ts";
import type {
  RankingEntry,
  RankingMetric,
  RankingSnapshot,
} from "../types/rankings.ts";
import { nowIso } from "../utils/time.ts";

/**
 * Ranking is a pure projection over the latest intelligence pass. The Arena
 * consumes the same function, so standings and rankings can never disagree.
 *
 * Only assets whose score computed successfully reach this function; an asset
 * reporting INSUFFICIENT_DATA is excluded upstream rather than ranked last,
 * because a rank of 58 reads as "measured and came last", which is a
 * different and much stronger claim than "could not be measured".
 *
 * Within that set a metric can still be absent for an individual asset — an
 * equity with no onchain activity, say — so `valueFor` returns null and those
 * assets drop out of that particular ranking while remaining in others.
 */

export interface RankableAsset {
  asset: Asset;
  intelligence: AssetIntelligence;
}

function valueFor(record: AssetIntelligence, metric: RankingMetric): number | null {
  const { engines, score } = record;
  switch (metric) {
    case "momentum":
      return engines.momentum.score;
    case "volume":
      return engines.volume.score;
    case "activity":
      return engines.activity.score;
    case "relativeStrength":
      return engines.relativeStrength.score;
    case "trend":
      return engines.trend.score;
    case "score":
    default:
      return score.score;
  }
}

export interface RankOptions {
  metric?: RankingMetric;
  assetType?: AssetType | "all";
  limit?: number;
  /** Previous ranks by asset id, used to fill `change`. */
  previousRanks?: Map<string, number>;
}

export function rankAssets(
  input: RankableAsset[],
  options: RankOptions = {},
): RankingSnapshot {
  const metric = options.metric ?? "score";
  const assetType = options.assetType ?? "all";
  const timestamp = nowIso();

  const scoped =
    assetType === "all"
      ? input
      : input.filter((row) => row.asset.assetType === assetType);

  // an asset with no value for this metric is not comparable on it
  const comparable = scoped.filter((row) => valueFor(row.intelligence, metric) !== null);

  const ordered = [...comparable].sort((a, b) => {
    const delta =
      (valueFor(b.intelligence, metric) as number) -
      (valueFor(a.intelligence, metric) as number);
    // stable, deterministic tie-break so equal values never reorder randomly
    return delta !== 0 ? delta : a.asset.symbol.localeCompare(b.asset.symbol);
  });

  const limited = options.limit ? ordered.slice(0, options.limit) : ordered;

  const entries: RankingEntry[] = limited.map((row, index) => {
    const rank = index + 1;
    const previous = options.previousRanks?.get(row.asset.id);
    return {
      rank,
      assetId: row.asset.id,
      symbol: row.asset.symbol,
      name: row.asset.name,
      assetType: row.asset.assetType,
      value: valueFor(row.intelligence, metric) as number,
      // Only OK-status records reach this function, so the score is present.
      // Asserted rather than defaulted: a `?? 0` here would silently publish a
      // zero score if that upstream guarantee ever broke.
      score: row.intelligence.score.score as number,
      confidence: row.intelligence.score.confidence.value,
      change: previous === undefined ? null : previous - rank,
      timestamp,
    };
  });

  return { metric, assetType, entries, timestamp };
}

/** Rank lookup by asset id — the shape the signal detectors expect. */
export function toRankMap(snapshot: RankingSnapshot): Map<string, number> {
  return new Map(snapshot.entries.map((entry) => [entry.assetId, entry.rank]));
}
