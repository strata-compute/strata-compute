import { getStore } from "../database/index.ts";
import { normalizeSnapshots } from "../normalization/normalize.ts";
import type {
  Asset,
  AssetPrice,
  NormalizedMarketData,
  RawMarketSnapshot,
} from "../types/domain.ts";
import { logger } from "../utils/logger.ts";

/**
 * The shared tail of every ingestion job:
 *
 *   normalize → validate → dedupe → store
 *
 * Every provider funnels through here, so persistence rules are defined once
 * and no provider can write straight to the database.
 */

/**
 * Duplicate suppression. Providers republish the same observation between
 * polls — CoinGecko's `last_updated` and Robinhood's `generatedAt` only move
 * when something changed. Storing those again inflates the tables without
 * adding information, so a record identical to the last one for that asset is
 * skipped.
 */
const lastSeen = new Map<string, string>();

function fingerprint(record: NormalizedMarketData): string {
  return [
    record.timestamp,
    record.price,
    record.volume24h ?? "",
    record.priceChange24h ?? "",
  ].join("|");
}

function isDuplicate(record: NormalizedMarketData): boolean {
  const key = `${record.source}:${record.assetType}:${record.symbol}`;
  const next = fingerprint(record);
  if (lastSeen.get(key) === next) return true;
  lastSeen.set(key, next);
  return false;
}

export function resetDedupeCache() {
  lastSeen.clear();
}

/** Rejects records that survived normalization but cannot be trusted. */
function validate(record: NormalizedMarketData): string | null {
  if (!Number.isFinite(record.price) || record.price <= 0) return "non-positive price";
  if (record.volume24h !== null && record.volume24h < 0) return "negative volume";
  if (record.marketCap !== null && record.marketCap < 0) return "negative market cap";
  // a timestamp far in the future signals a provider clock problem
  if (new Date(record.timestamp).getTime() > Date.now() + 3_600_000) {
    return "timestamp more than an hour in the future";
  }
  return null;
}

export interface PersistResult {
  fetched: number;
  normalized: NormalizedMarketData[];
  stored: number;
  duplicates: number;
  rejected: { symbol: string; reason: string }[];
  assets: Asset[];
  assetIdBySymbol: Map<string, string>;
}

export async function persistSnapshots(
  source: string,
  raws: RawMarketSnapshot[],
): Promise<PersistResult> {
  const store = getStore();
  const { normalized, rejected } = normalizeSnapshots(raws);

  const valid: NormalizedMarketData[] = [];
  for (const record of normalized) {
    const problem = validate(record);
    if (problem) {
      rejected.push({ symbol: record.symbol, reason: problem });
      continue;
    }
    valid.push(record);
  }

  // assets are upserted even for duplicate observations: metadata may change
  // when a price has not
  const assets = await store.upsertAssets(
    valid.map((record) => ({
      symbol: record.symbol,
      name: record.name,
      assetType: record.assetType,
      chain: record.chain,
      contractAddress: record.contractAddress,
      logoUrl: record.logoUrl,
    })),
  );

  const assetIdBySymbol = new Map(assets.map((asset) => [asset.symbol, asset.id]));

  const prices: AssetPrice[] = [];
  const snapshots: { assetId: string; data: NormalizedMarketData }[] = [];
  let duplicates = 0;

  for (const record of valid) {
    const assetId = assetIdBySymbol.get(record.symbol);
    if (!assetId) continue;

    if (isDuplicate(record)) {
      duplicates += 1;
      continue;
    }

    prices.push({
      assetId,
      price: record.price,
      priceChange1h: record.priceChange1h,
      priceChange24h: record.priceChange24h,
      volume24h: record.volume24h,
      marketCap: record.marketCap,
      timestamp: record.timestamp,
    });
    snapshots.push({ assetId, data: record });
  }

  await store.insertPrices(prices);
  await store.insertSnapshots(snapshots);

  if (rejected.length > 0) {
    logger.warn("records rejected during ingestion", {
      provider: source,
      count: rejected.length,
      reasons: [...new Set(rejected.map((r) => r.reason))].slice(0, 5),
    });
  }

  return {
    fetched: raws.length,
    normalized: valid,
    stored: snapshots.length,
    duplicates,
    rejected,
    assets,
    assetIdBySymbol,
  };
}
