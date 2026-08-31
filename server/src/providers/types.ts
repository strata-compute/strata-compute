import type {
  AssetType,
  RawMarketSnapshot,
} from "../types/domain.ts";
import type { IsoTimestamp } from "../utils/time.ts";

/**
 * The provider contract.
 *
 * Everything above this layer — normalization, compute, signals, rankings,
 * arena, API — is written against these interfaces and must never import a
 * concrete provider. Swapping MockMarketProvider for a real one is a change
 * in `registry.ts` and nowhere else.
 */

export type HistoricalRange = "1h" | "24h" | "7d" | "30d" | "1y";

/** Minimal descriptor a provider can return without a full snapshot. */
export interface ProviderAssetRef {
  symbol: string;
  name: string;
  assetType: AssetType;
  chain?: string | null;
  contractAddress?: string | null;
}

export interface ProviderPrice {
  symbol: string;
  price: number | null;
  priceChange1h?: number | null;
  priceChange24h?: number | null;
  timestamp: IsoTimestamp;
}

export interface ProviderVolume {
  symbol: string;
  volume24h: number | null;
  tradeCount24h?: number | null;
  timestamp: IsoTimestamp;
}

export interface ProviderLiquidity {
  symbol: string;
  liquidity: number | null;
  timestamp: IsoTimestamp;
}

export interface HistoricalPoint {
  timestamp: IsoTimestamp;
  price: number;
  volume: number | null;
}

export interface ProviderHealth {
  provider: string;
  healthy: boolean;
  /** Round-trip time of the health probe. */
  latencyMs: number | null;
  checkedAt: IsoTimestamp;
  detail?: string;
}

export interface MarketDataProvider {
  /** Stable identifier used in logs, attribution and `source` fields. */
  readonly name: string;
  /** True when this provider does not represent real markets. */
  readonly isMock: boolean;
  /** Asset classes this provider can answer for. */
  readonly supports: readonly AssetType[];

  getAssets(): Promise<ProviderAssetRef[]>;
  getPrice(asset: ProviderAssetRef): Promise<ProviderPrice>;
  /** The full picture for one asset, still in provider shape. */
  getMarketSnapshot(asset: ProviderAssetRef): Promise<RawMarketSnapshot>;
  getHistoricalData(
    asset: ProviderAssetRef,
    range: HistoricalRange,
  ): Promise<HistoricalPoint[]>;
  getVolume(asset: ProviderAssetRef): Promise<ProviderVolume>;
  getLiquidity(asset: ProviderAssetRef): Promise<ProviderLiquidity>;
  healthCheck(): Promise<ProviderHealth>;

  /**
   * Optional batch path. Providers that can answer for many assets in one
   * call implement this; the ingestion service falls back to per-asset
   * snapshots when they cannot.
   */
  getMarketSnapshots?(assets: ProviderAssetRef[]): Promise<RawMarketSnapshot[]>;
}

/**
 * Asset-class specialisations. They add no members today — the point is that
 * a Phase 3 equities provider and a Phase 3 onchain provider are separate,
 * independently swappable implementations behind the same shape.
 */
export interface StockDataProvider extends MarketDataProvider {
  readonly supports: readonly ["stock"];
}

export interface CryptoDataProvider extends MarketDataProvider {
  readonly supports: readonly ["crypto"];
}

export interface OnchainDataProvider extends MarketDataProvider {
  readonly supports: readonly ["onchain"];
}

/* ---------------------------------------------------------------------------
 * Phase 3 capability interfaces.
 *
 * A provider implements only what it can actually answer for. The registry
 * resolves per capability, so a chain with no indexer simply has no
 * OnchainDataProvider rather than a stubbed one returning invented data.
 * ------------------------------------------------------------------------- */

export interface ProviderCapabilities {
  readonly name: string;
  readonly isMock: boolean;
  healthCheck(): Promise<ProviderHealth>;
}

/** Raw chain access: JSON-RPC plus whatever enhanced methods are confirmed. */
export interface ChainDataProvider extends ProviderCapabilities {
  readonly chainId: number;
  getLatestBlock(): Promise<import("../types/providers.ts").ChainBlock>;
  getBlock(blockNumber: number | "latest"): Promise<import("../types/providers.ts").ChainBlock | null>;
  getTransaction(hash: string): Promise<import("../types/providers.ts").ChainTransaction | null>;
  getTransactionReceipt(
    hash: string,
  ): Promise<import("../types/providers.ts").ChainTransactionReceipt | null>;
  getLogs(filter: import("../types/providers.ts").LogFilter): Promise<import("../types/providers.ts").ChainLog[]>;
  getTokenTransfers(
    query: import("../types/providers.ts").TokenTransferQuery,
  ): Promise<import("../types/providers.ts").NormalizedTransfer[]>;
  /** True when the provider's enhanced (non-standard) methods are confirmed live. */
  supportsEnhancedApi(): Promise<boolean>;
}

/** Indexed onchain data: activity, holders, contract metadata. */
export interface OnchainIndexProvider extends ProviderCapabilities {
  /** Chain ids this indexer actually serves. */
  readonly chains: readonly number[];
  supportsChain(chainId: number): boolean;
  getAddressActivity(
    chainId: number,
    address: string,
  ): Promise<import("../types/providers.ts").NormalizedOnchainData | null>;
  getTokenTransfers(
    chainId: number,
    address: string,
    limit?: number,
  ): Promise<import("../types/providers.ts").NormalizedTransfer[]>;
  getTokenHolders(
    chainId: number,
    token: string,
    limit?: number,
  ): Promise<{ address: string; balance: string; percent: number | null }[]>;
  getContract(
    chainId: number,
    address: string,
  ): Promise<import("../types/providers.ts").NormalizedAsset | null>;
}

/** Token security signals. */
export interface SecurityDataProvider extends ProviderCapabilities {
  readonly chains: readonly number[];
  supportsChain(chainId: number): boolean;
  getTokenSecurity(
    chainId: number,
    tokenAddress: string,
  ): Promise<import("../types/providers.ts").NormalizedSecurityData | null>;
}

/** Stock tokens issued onchain — metadata, quotes and corporate actions. */
export interface StockTokenProvider extends ProviderCapabilities {
  getStockTokens(): Promise<import("../types/providers.ts").NormalizedAsset[]>;
  getStockToken(symbol: string): Promise<import("../types/providers.ts").NormalizedAsset | null>;
  getStockTokenPrice(symbol: string): Promise<import("../types/domain.ts").RawMarketSnapshot | null>;
  getCorporateActions(): Promise<CorporateAction[]>;
}

export interface CorporateAction {
  id: string;
  type: string;
  status: string;
  symbol: string;
  processDate: string | null;
  contractAddress: string | null;
  chainId: number | null;
  details: Record<string, unknown>;
  source: string;
}
