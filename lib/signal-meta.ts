import type { SignalKind, SignalTone } from "@/lib/types";

/**
 * Presentation metadata for signal types — labels, glyphs and the sentence
 * describing what triggers each one.
 *
 * This is UI copy, not market data: it contains no asset, no value and no
 * timestamp. The signals themselves come from the backend detectors.
 */
export const SIGNAL_META: Record<
  SignalKind,
  { label: string; tone: SignalTone; glyph: string; blurb: string }
> = {
  "momentum-spike": {
    label: "Momentum spike",
    tone: "positive",
    glyph: "▲",
    blurb: "Rate-of-change broke its rolling volatility band to the upside.",
  },
  "volume-acceleration": {
    label: "Volume acceleration",
    tone: "positive",
    glyph: "≡",
    blurb: "Traded notional running materially above the 30-day median.",
  },
  "unusual-activity": {
    label: "Unusual activity",
    tone: "caution",
    glyph: "◆",
    blurb: "Participant or order-count distribution diverged from baseline.",
  },
  "liquidity-drop": {
    label: "Liquidity drop",
    tone: "negative",
    glyph: "▼",
    blurb: "Depth within 50bps of mid thinned; slippage on a standard clip rose.",
  },
  "new-market": {
    label: "New market detected",
    tone: "info",
    glyph: "＋",
    blurb: "A venue or pair crossed the coverage threshold and entered compute.",
  },
};

export const SIGNAL_KINDS = Object.keys(SIGNAL_META) as SignalKind[];
