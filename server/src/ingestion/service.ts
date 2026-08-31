import { getStore } from "../database/index.ts";
import { normalizeSnapshots } from "../normalization/normalize.ts";
import { getMarketProvider } from "../providers/registry.ts";
import type { MarketDataProvider, ProviderAssetRef } from "../providers/types.ts";
import type {
  Asset,
  AssetPrice,
  NormalizedMarketData,
  RawMarketSnapshot,
} from "../types/domain.ts";
import { AppError } from "../utils/errors.ts";
import { describeError, logger } from "../utils/logger.ts";
import { nowIso } from "../utils/time.ts";

/**
 * The ingestion pass: provider → normalization → persistence.
 *
 * It knows nothing about scoring and nothing about which provider it is
 * talking to. Its contract is that everything downstream reads normalized
 * records with a resolved asset id.
 */

export interface IngestionResult {
  provider: string;
  usingMockData: boolean;
  fetched: number;
  normalized: NormalizedMarketData[];
  rejected: { symbol: string; reason: string }[];
  assets: Asset[];
  assetIdBySymbol: Map<string, string>;
  durationMs: number;
}

async function fetchSnapshots(
  provider: MarketDataProvider,
  refs: ProviderAssetRef[],
): Promise<RawMarketSnapshot[]> {
  // prefer the batch path when a provider offers one
  if (provider.getMarketSnapshots) {
    return provider.getMarketSnapshots(refs);
  }

  const results = await Promise.allSettled(
    refs.map((ref) => provider.getMarketSnapshot(ref)),
  );

  const snapshots: RawMarketSnapshot[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      snapshots.push(result.value);
    } else {
      // one bad symbol must not fail the pass
      logger.warn("snapshot fetch failed", {
        provider: provider.name,
        asset: refs[index]?.symbol,
        ...describeError(result.reason),
      });
    }
  }
  return snapshots;
}

export async function runIngestion(): Promise<IngestionResult> {
  const started = performance.now();
  const provider = getMarketProvider();
  const store = getStore();
  const log = logger.child({ job: "ingestion", provider: provider.name });

  let refs: ProviderAssetRef[];
  try {
    refs = await provider.getAssets();
  } catch (error) {
    log.error("provider asset listing failed", describeError(error));
    throw AppError.providerUnavailable(provider.name, error);
  }

  const raw = await fetchSnapshots(provider, refs);
  const { normalized, rejected } = normalizeSnapshots(raw);

  if (rejected.length > 0) {
    log.warn("records rejected during normalization", {
      count: rejected.length,
      symbols: rejected.map((r) => r.symbol).slice(0, 10),
    });
  }

  // assets first: everything else is keyed by the id they receive
  const assets = await store.upsertAssets(
    normalized.map((record) => ({
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

  for (const record of normalized) {
    const assetId = assetIdBySymbol.get(record.symbol);
    if (!assetId) continue;
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

  const durationMs = Number((performance.now() - started).toFixed(2));
  log.info("ingestion pass complete", {
    count: normalized.length,
    rejected: rejected.length,
    durationMs,
    mock: provider.isMock,
  });

  return {
    provider: provider.name,
    usingMockData: provider.isMock,
    fetched: raw.length,
    normalized,
    rejected,
    assets,
    assetIdBySymbol,
    durationMs,
  };
}

/** Timestamp of the most recent successful pass, for status reporting. */
let lastIngestionAt: string | null = null;

export function markIngestion() {
  lastIngestionAt = nowIso();
}

export function getLastIngestionAt(): string | null {
  return lastIngestionAt;
}
