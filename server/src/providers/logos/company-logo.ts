import { getCache } from "../../cache/index.ts";
import { logger } from "../../utils/logger.ts";

/**
 * COMPANY LOGO RESOLUTION
 *
 * Robinhood publishes a `logoUrl` for every tokenised stock, but it is the
 * same Robinhood token badge for all of them (verified: 20 of 20 sampled
 * tokens returned byte-identical artwork from 20 different URLs). It
 * identifies the issuer, not the company, so it cannot be captioned
 * "<company> logo".
 *
 * This module supplies the missing piece from a public logo CDN, keyed by
 * ticker. It is deliberately NOT a market data provider — it contributes no
 * price, volume or score, and nothing it returns can influence a computation.
 * It exists purely so an equity row can carry the company's own mark.
 *
 * THE URL IS NEVER GUESSED INTO THE DATABASE.
 *
 * The CDN answers 404 for tickers it does not know, so every candidate is
 * verified with a HEAD request before it is stored. A symbol the CDN has no
 * artwork for resolves to null and falls back to the monogram, exactly as
 * before. That keeps the same guarantee the rest of the pipeline runs on: a
 * value is real and checked, or it is absent.
 *
 * Results are cached in both directions — a hit and a miss are equally worth
 * remembering — so a full ingestion pass costs one probe per new symbol
 * rather than one per pass.
 */

const LOGO_CDN = "https://assets.parqet.com/logos/symbol";

/** Long: company artwork changes on the order of a rebrand, not a session. */
const CACHE_TTL_SECONDS = 86_400;

const PROBE_TIMEOUT_MS = 6_000;

/** Cached as a string because the cache layer round-trips JSON. */
const MISS = "";

function urlFor(symbol: string): string {
  return `${LOGO_CDN}/${encodeURIComponent(symbol.toUpperCase())}`;
}

/**
 * Confirms the CDN actually holds artwork for this ticker.
 *
 * A HEAD is enough — the CDN returns 404 with no body for unknown symbols —
 * and it keeps the probe cheap enough to run across the whole equity
 * universe. Any transport failure is treated as "no logo" rather than
 * retried: a missing logo is a cosmetic gap, never worth delaying ingestion.
 */
async function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return false;
    // guard against a CDN that answers 200 with an error page
    const type = response.headers.get("content-type") ?? "";
    return type.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The company logo for one ticker, or null when the CDN has none.
 * Only ever called for equities; crypto and onchain assets already carry
 * artwork published by the upstream that priced them.
 */
export async function resolveCompanyLogo(symbol: string): Promise<string | null> {
  const ticker = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return null;

  const cache = getCache();
  const key = `company-logo:${ticker}`;

  const cached = await cache.wrap(key, CACHE_TTL_SECONDS, async () => {
    const url = urlFor(ticker);
    const found = await probe(url);
    return found ? url : MISS;
  });

  return cached === MISS ? null : cached;
}

/**
 * Resolves a batch, bounded so a large equity universe cannot open one socket
 * per symbol. Order is irrelevant to the caller, which indexes by symbol.
 */
export async function resolveCompanyLogos(
  symbols: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()))];
  const found = new Map<string, string>();
  const CONCURRENCY = 6;

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (symbol) => [symbol, await resolveCompanyLogo(symbol)] as const),
    );
    for (const [symbol, url] of results) {
      if (url) found.set(symbol, url);
    }
  }

  logger.debug("company logos resolved", {
    requested: unique.length,
    resolved: found.size,
  });

  return found;
}
