import type { Asset, AssetClass } from "@/lib/types";

/**
 * ASSET LOGO RESOLUTION — the single place that decides what artwork an
 * asset gets.
 *
 * Components call `resolveAssetLogo` and render the result. They never test a
 * symbol, never hold a URL, and never know which upstream published the
 * image. That keeps two properties true:
 *
 *   1. There is exactly one rule to audit. No `if (symbol === "AAPL")` can
 *      hide in a table cell.
 *   2. Artwork is real or it is absent. The only URL that reaches an <img>
 *      is one a provider published for that asset and that normalization
 *      accepted as an absolute http(s) URL. Nothing is synthesised, guessed
 *      from a ticker, or fetched from an unvetted logo service.
 *
 * When no provider published artwork the asset gets a monogram, which is
 * deliberately drawn as a typographic mark rather than a brand-like badge:
 * it must not read as an official logo.
 */

export interface ResolvedAssetLogo {
  /** Provider-published artwork, or null when none exists. */
  src: string | null;
  /** Letters to draw when there is no image. */
  monogram: string;
  /** Alt text for real artwork. Empty when the monogram is used. */
  alt: string;
  /** Label describing the monogram to assistive technology. */
  fallbackLabel: string;
}

/** The subset of an asset the resolver needs; keeps callers unconstrained. */
export interface LogoSubject {
  symbol: string;
  name?: string | null;
  assetClass?: AssetClass | null;
  logoUrl?: string | null;
}

/**
 * Monogram text. Three characters is the most that stays legible at the
 * small sizes, and long onchain tickers read better truncated than squeezed.
 */
function monogramFor(symbol: string): string {
  const clean = symbol.replace(/^\$/, "").toUpperCase();
  if (clean.length === 0) return "?";
  return clean.length > 4 ? clean.slice(0, 3) : clean;
}

/**
 * Guard at the render boundary. Normalization already rejects anything that
 * is not absolute http(s), but this module is also called with data shaped
 * by hand in tests and by future callers, so the check is repeated where it
 * actually matters.
 */
function usableSrc(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^https:\/\//i.test(trimmed) || /^http:\/\//i.test(trimmed)
    ? trimmed
    : null;
}

export function resolveAssetLogo(asset: LogoSubject): ResolvedAssetLogo {
  const symbol = asset.symbol ?? "";
  const display = asset.name?.trim() || symbol;
  const src = usableSrc(asset.logoUrl);

  return {
    src,
    monogram: monogramFor(symbol),
    // only claimed for artwork that really is the asset's own logo
    alt: src ? `${display} logo` : "",
    // never the word "logo": this mark is ours, not the issuer's
    fallbackLabel: `${symbol.toUpperCase()} asset icon`,
  };
}

/** Convenience for callers holding a full Asset. */
export function getAssetLogo(asset: Asset): ResolvedAssetLogo {
  return resolveAssetLogo(asset);
}
