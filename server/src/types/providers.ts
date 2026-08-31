import type { IsoTimestamp } from "../utils/time.ts";
import type { AssetType } from "./domain.ts";

/**
 * Normalized shapes that Phase 3 providers map into.
 *
 * `NormalizedMarketData` already exists in `domain.ts` and stays the contract
 * for the compute engine. These add the non-market shapes — onchain activity,
 * token security, historical series — so provider-specific payloads never
 * leak past the provider module that produced them.
 *
 * Every shape carries `source` and `fetchedAt`: a normalized record must
 * always be attributable to the provider that supplied it.
 */

export interface NormalizedAsset {
  symbol: string;
  name: string;
  assetType: AssetType;
  chain: string | null;
  chainId: number | null;
  contractAddress: string | null;
  decimals: number | null;
  logoUrl: string | null;
  source: string;
  fetchedAt: IsoTimestamp;
}

/** One point in a historical series, provider-agnostic. */
export interface NormalizedHistoricalPoint {
  timestamp: IsoTimestamp;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface NormalizedHistoricalData {
  symbol: string;
  assetType: AssetType;
  range: string;
  points: NormalizedHistoricalPoint[];
  source: string;
  fetchedAt: IsoTimestamp;
}

/** Chain-level activity for an address or token. */
export interface NormalizedOnchainData {
  chainId: number;
  chain: string;
  address: string;
  /** Native or token transfer count over the observed window. */
  transferCount: number | null;
  transactionCount: number | null;
  uniqueCounterparties: number | null;
  holderCount: number | null;
  totalSupply: string | null;
  decimals: number | null;
  /** Most recent block observed while collecting this record. */
  blockNumber: number | null;
  source: string;
  fetchedAt: IsoTimestamp;
  /** Fields the provider could not supply for this chain. */
  missingFields: string[];
}

export interface NormalizedTransfer {
  chainId: number;
  hash: string;
  from: string;
  to: string | null;
  /** Decimal string — token amounts exceed Number safely. */
  value: string;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  blockNumber: number | null;
  timestamp: IsoTimestamp | null;
  source: string;
}

/**
 * Token security. Deliberately field-preserving: GoPlus does not publish a
 * single score, so Strata stores the individual signals and leaves any
 * composite to the compute engine.
 */
export interface NormalizedSecurityData {
  chainId: number;
  tokenAddress: string;
  /** Null unless the provider actually publishes a score. Never invented. */
  securityScore: number | null;
  isHoneypot: boolean | null;
  isOpenSource: boolean | null;
  isProxy: boolean | null;
  isMintable: boolean | null;
  canTakeBackOwnership: boolean | null;
  ownerAddress: string | null;
  ownerPercent: number | null;
  creatorPercent: number | null;
  buyTax: number | null;
  sellTax: number | null;
  isBlacklisted: boolean | null;
  transferPausable: boolean | null;
  holderCount: number | null;
  lpHolderCount: number | null;
  /** Every raw flag the provider returned, preserved verbatim for later use. */
  flags: Record<string, string | number | boolean | null>;
  source: string;
  fetchedAt: IsoTimestamp;
  missingFields: string[];
}

export interface ChainBlock {
  chainId: number;
  number: number;
  hash: string;
  parentHash: string;
  timestamp: IsoTimestamp;
  transactionCount: number;
  gasUsed: string | null;
  gasLimit: string | null;
  source: string;
}

export interface ChainTransaction {
  chainId: number;
  hash: string;
  from: string;
  to: string | null;
  value: string;
  blockNumber: number | null;
  gas: string | null;
  gasPrice: string | null;
  input: string | null;
  source: string;
}

export interface ChainTransactionReceipt {
  chainId: number;
  hash: string;
  status: "success" | "reverted" | "unknown";
  blockNumber: number | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  contractAddress: string | null;
  logCount: number;
  source: string;
}

export interface ChainLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number | null;
  transactionHash: string | null;
  logIndex: number | null;
}

export interface LogFilter {
  address?: string | string[];
  topics?: (string | null)[];
  fromBlock?: string | number;
  toBlock?: string | number;
}

export interface TokenTransferQuery {
  address?: string;
  contractAddress?: string;
  fromBlock?: string | number;
  toBlock?: string | number;
  limit?: number;
}
