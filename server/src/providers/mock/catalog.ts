import type { AssetType } from "../../types/domain.ts";

/**
 * SYNTHETIC ASSET UNIVERSE — DEVELOPMENT ONLY.
 *
 * These are real ticker strings so the shape of the data is realistic, but
 * every numeric baseline below is invented. Nothing here is market data and
 * it must never be presented as such: every record produced from this
 * catalogue is stamped `isMock: true`.
 */

export interface CatalogEntry {
  symbol: string;
  name: string;
  assetType: AssetType;
  chain: string | null;
  contractAddress: string | null;
  /** Invented reference price the generator oscillates around. */
  basePrice: number;
  baseVolume24h: number;
  baseMarketCap: number;
  baseLiquidity: number;
  /** Rough daily volatility, as a fraction. Drives the synthetic walk. */
  volatility: number;
}

export const MOCK_CATALOG: CatalogEntry[] = [
  // ---- stocks -----------------------------------------------------------
  { symbol: "NVDA", name: "NVIDIA Corporation", assetType: "stock", chain: null, contractAddress: null, basePrice: 184.62, baseVolume24h: 41_200_000_000, baseMarketCap: 4_510_000_000_000, baseLiquidity: 8_400_000_000, volatility: 0.032 },
  { symbol: "AAPL", name: "Apple Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 243.18, baseVolume24h: 12_800_000_000, baseMarketCap: 3_680_000_000_000, baseLiquidity: 6_900_000_000, volatility: 0.014 },
  { symbol: "MSFT", name: "Microsoft Corporation", assetType: "stock", chain: null, contractAddress: null, basePrice: 508.31, baseVolume24h: 9_600_000_000, baseMarketCap: 3_780_000_000_000, baseLiquidity: 6_100_000_000, volatility: 0.013 },
  { symbol: "TSLA", name: "Tesla, Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 412.55, baseVolume24h: 28_400_000_000, baseMarketCap: 1_320_000_000_000, baseLiquidity: 4_200_000_000, volatility: 0.038 },
  { symbol: "AMD", name: "Advanced Micro Devices", assetType: "stock", chain: null, contractAddress: null, basePrice: 168.94, baseVolume24h: 8_100_000_000, baseMarketCap: 274_000_000_000, baseLiquidity: 1_900_000_000, volatility: 0.034 },
  { symbol: "GOOGL", name: "Alphabet Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 214.86, baseVolume24h: 6_900_000_000, baseMarketCap: 2_610_000_000_000, baseLiquidity: 4_400_000_000, volatility: 0.016 },
  { symbol: "META", name: "Meta Platforms, Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 621.07, baseVolume24h: 7_300_000_000, baseMarketCap: 1_570_000_000_000, baseLiquidity: 3_100_000_000, volatility: 0.021 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 238.42, baseVolume24h: 8_700_000_000, baseMarketCap: 2_540_000_000_000, baseLiquidity: 4_000_000_000, volatility: 0.018 },
  { symbol: "AVGO", name: "Broadcom Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 372.19, baseVolume24h: 5_400_000_000, baseMarketCap: 1_740_000_000_000, baseLiquidity: 2_400_000_000, volatility: 0.024 },
  { symbol: "PLTR", name: "Palantir Technologies", assetType: "stock", chain: null, contractAddress: null, basePrice: 96.28, baseVolume24h: 6_200_000_000, baseMarketCap: 228_000_000_000, baseLiquidity: 1_400_000_000, volatility: 0.041 },
  { symbol: "COIN", name: "Coinbase Global, Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 284.73, baseVolume24h: 3_100_000_000, baseMarketCap: 72_400_000_000, baseLiquidity: 780_000_000, volatility: 0.046 },
  { symbol: "NFLX", name: "Netflix, Inc.", assetType: "stock", chain: null, contractAddress: null, basePrice: 1_048.6, baseVolume24h: 2_800_000_000, baseMarketCap: 447_000_000_000, baseLiquidity: 1_100_000_000, volatility: 0.022 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", assetType: "stock", chain: null, contractAddress: null, basePrice: 287.14, baseVolume24h: 3_600_000_000, baseMarketCap: 802_000_000_000, baseLiquidity: 2_000_000_000, volatility: 0.012 },

  // ---- crypto -----------------------------------------------------------
  { symbol: "BTC", name: "Bitcoin", assetType: "crypto", chain: null, contractAddress: null, basePrice: 93_482.1, baseVolume24h: 52_600_000_000, baseMarketCap: 1_852_000_000_000, baseLiquidity: 12_000_000_000, volatility: 0.026 },
  { symbol: "ETH", name: "Ethereum", assetType: "crypto", chain: null, contractAddress: null, basePrice: 3_284.66, baseVolume24h: 28_900_000_000, baseMarketCap: 396_000_000_000, baseLiquidity: 7_200_000_000, volatility: 0.031 },
  { symbol: "SOL", name: "Solana", assetType: "crypto", chain: null, contractAddress: null, basePrice: 214.38, baseVolume24h: 9_400_000_000, baseMarketCap: 116_000_000_000, baseLiquidity: 2_600_000_000, volatility: 0.045 },
  { symbol: "LINK", name: "Chainlink", assetType: "crypto", chain: null, contractAddress: null, basePrice: 24.86, baseVolume24h: 1_240_000_000, baseMarketCap: 16_800_000_000, baseLiquidity: 420_000_000, volatility: 0.038 },
  { symbol: "AVAX", name: "Avalanche", assetType: "crypto", chain: null, contractAddress: null, basePrice: 38.72, baseVolume24h: 842_000_000, baseMarketCap: 15_900_000_000, baseLiquidity: 310_000_000, volatility: 0.042 },
  { symbol: "XRP", name: "XRP", assetType: "crypto", chain: null, contractAddress: null, basePrice: 2.41, baseVolume24h: 3_800_000_000, baseMarketCap: 138_000_000_000, baseLiquidity: 900_000_000, volatility: 0.036 },
  { symbol: "DOGE", name: "Dogecoin", assetType: "crypto", chain: null, contractAddress: null, basePrice: 0.3164, baseVolume24h: 2_100_000_000, baseMarketCap: 46_700_000_000, baseLiquidity: 480_000_000, volatility: 0.055 },
  { symbol: "TON", name: "Toncoin", assetType: "crypto", chain: null, contractAddress: null, basePrice: 5.68, baseVolume24h: 428_000_000, baseMarketCap: 14_200_000_000, baseLiquidity: 190_000_000, volatility: 0.04 },
  { symbol: "SUI", name: "Sui", assetType: "crypto", chain: null, contractAddress: null, basePrice: 4.12, baseVolume24h: 1_680_000_000, baseMarketCap: 13_400_000_000, baseLiquidity: 340_000_000, volatility: 0.052 },
  { symbol: "ARB", name: "Arbitrum", assetType: "crypto", chain: null, contractAddress: null, basePrice: 0.8214, baseVolume24h: 386_000_000, baseMarketCap: 4_100_000_000, baseLiquidity: 120_000_000, volatility: 0.048 },

  // ---- onchain ----------------------------------------------------------
  { symbol: "HYPE", name: "Hyperliquid", assetType: "onchain", chain: "hyperliquid", contractAddress: "0x0d01dc56dcaaca66ad901c959b4011ec", basePrice: 41.28, baseVolume24h: 1_920_000_000, baseMarketCap: 13_800_000_000, baseLiquidity: 260_000_000, volatility: 0.058 },
  { symbol: "ENA", name: "Ethena", assetType: "onchain", chain: "ethereum", contractAddress: "0x57e114b691db790c35207b2e685d4a43181e6061", basePrice: 0.7412, baseVolume24h: 612_000_000, baseMarketCap: 4_600_000_000, baseLiquidity: 96_000_000, volatility: 0.051 },
  { symbol: "PENDLE", name: "Pendle", assetType: "onchain", chain: "ethereum", contractAddress: "0x808507121b80c02388fad14726482e061b8da827", basePrice: 6.34, baseVolume24h: 184_000_000, baseMarketCap: 1_040_000_000, baseLiquidity: 42_000_000, volatility: 0.047 },
  { symbol: "AERO", name: "Aerodrome", assetType: "onchain", chain: "base", contractAddress: "0x940181a94a35a4569e4529a3cdfb74e38fd98631", basePrice: 1.284, baseVolume24h: 96_400_000, baseMarketCap: 1_180_000_000, baseLiquidity: 28_000_000, volatility: 0.05 },
  { symbol: "ONDO", name: "Ondo Finance", assetType: "onchain", chain: "ethereum", contractAddress: "0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3", basePrice: 1.462, baseVolume24h: 248_000_000, baseMarketCap: 4_800_000_000, baseLiquidity: 61_000_000, volatility: 0.043 },
  { symbol: "JUP", name: "Jupiter", assetType: "onchain", chain: "solana", contractAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", basePrice: 0.9184, baseVolume24h: 214_000_000, baseMarketCap: 2_760_000_000, baseLiquidity: 54_000_000, volatility: 0.046 },
  { symbol: "EIGEN", name: "EigenLayer", assetType: "onchain", chain: "ethereum", contractAddress: "0xec53bf9167f50cdeb3ae105f56099aaab9061f83", basePrice: 2.184, baseVolume24h: 78_200_000, baseMarketCap: 1_920_000_000, baseLiquidity: 19_000_000, volatility: 0.049 },
  { symbol: "MORPHO", name: "Morpho", assetType: "onchain", chain: "ethereum", contractAddress: "0x9994e35db50125e0df82e4c2dde62496ce330999", basePrice: 3.062, baseVolume24h: 42_800_000, baseMarketCap: 1_140_000_000, baseLiquidity: 14_000_000, volatility: 0.044 },
];

export function findCatalogEntry(symbol: string): CatalogEntry | undefined {
  const upper = symbol.toUpperCase();
  return MOCK_CATALOG.find((entry) => entry.symbol === upper);
}
