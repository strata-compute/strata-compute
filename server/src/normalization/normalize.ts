import type {
  NormalizedMarketData,
  RawMarketSnapshot,
} from "../types/domain.ts";
import { toNumber, toPositiveNumber } from "../utils/number.ts";
import { nowIso, toIso } from "../utils/time.ts";

/**
 * The boundary between "whatever the provider sent" and the domain.
 *
 * Rules:
 *  - numbers are coerced through one helper, so strings and NaN never leak;
 *  - timestamps become UTC ISO-8601 regardless of the input encoding;
 *  - missing values stay null instead of being invented, and every omission
 *    is recorded in `missingFields` so the compute engine can degrade a
 *    factor rather than silently score on a guess.
 */

export interface NormalizationResult {
  data: NormalizedMarketData | null;
  /** Present when the record could not be normalized at all. */
  rejectedReason?: string;
}

/**
 * Providers occasionally return relative paths, empty strings or placeholder
 * markers for images. Only an absolute http(s) URL is usable, so everything
 * else becomes null rather than a broken <img>.
 */
function normalizeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeSnapshot(raw: RawMarketSnapshot): NormalizationResult {
  const symbol = cleanString(raw.symbol)?.toUpperCase();
  if (!symbol) {
    return { data: null, rejectedReason: "missing symbol" };
  }

  // Price is the one field with no sensible default: a record without a
  // usable price cannot be scored and is rejected rather than patched.
  const price = toNumber(raw.price);
  if (price === null || price <= 0) {
    return { data: null, rejectedReason: `missing or invalid price for ${symbol}` };
  }

  const missingFields: string[] = [];
  const optional = <T>(field: string, value: T | null): T | null => {
    if (value === null) missingFields.push(field);
    return value;
  };

  const priceChange1h = optional("priceChange1h", toNumber(raw.priceChange1h));
  const priceChange24h = optional("priceChange24h", toNumber(raw.priceChange24h));
  const volume24h = optional("volume24h", toPositiveNumber(raw.volume24h));
  const marketCap = optional("marketCap", toPositiveNumber(raw.marketCap));
  const liquidity = optional("liquidity", toPositiveNumber(raw.liquidity));
  const tradeCount24h = optional("tradeCount24h", toPositiveNumber(raw.tradeCount24h));
  const uniqueParticipants24h = optional(
    "uniqueParticipants24h",
    toPositiveNumber(raw.uniqueParticipants24h),
  );

  // A provider timestamp we cannot parse is replaced by ingestion time and
  // flagged, rather than dropping an otherwise usable record.
  const parsedTimestamp = toIso(raw.timestamp);
  if (parsedTimestamp === null) missingFields.push("timestamp");

  // Retrieval time is ours and is always known; the provider's own timestamp
  // is preserved separately so staleness can be measured against the source
  // rather than against when we happened to poll.
  const retrievedAt = nowIso();
  const sourceTimestamp =
    raw.timestamp === undefined || raw.timestamp === null ? null : String(raw.timestamp);

  return {
    data: {
      symbol,
      assetType: raw.assetType,
      name: cleanString(raw.name) ?? symbol,
      chain: cleanString(raw.chain),
      contractAddress: cleanString(raw.contractAddress)?.toLowerCase() ?? null,
      // only accept a URL we could actually render; anything else is null
      logoUrl: normalizeLogoUrl(raw.logoUrl),
      price,
      priceChange1h,
      priceChange24h,
      volume24h,
      marketCap,
      liquidity,
      tradeCount24h,
      uniqueParticipants24h,
      timestamp: parsedTimestamp ?? retrievedAt,
      retrievedAt,
      sourceTimestamp,
      source: raw.source,
      isMock: raw.isMock === true,
      missingFields,
    },
  };
}

export interface BatchNormalizationResult {
  normalized: NormalizedMarketData[];
  rejected: { symbol: string; reason: string }[];
}

export function normalizeSnapshots(
  raws: RawMarketSnapshot[],
): BatchNormalizationResult {
  const normalized: NormalizedMarketData[] = [];
  const rejected: { symbol: string; reason: string }[] = [];

  for (const raw of raws) {
    const result = normalizeSnapshot(raw);
    if (result.data) normalized.push(result.data);
    else {
      rejected.push({
        symbol: String(raw.symbol ?? "unknown"),
        reason: result.rejectedReason ?? "unknown",
      });
    }
  }

  return { normalized, rejected };
}
