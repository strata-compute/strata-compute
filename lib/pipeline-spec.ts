import type { PipelineStage, ScoreFactorMeta } from '@/lib/types';

/**
 * METHODOLOGY, NOT MARKET DATA.
 *
 * These are the documented stages, modules and factor weights of the Strata
 * computation pipeline. They describe how the score is produced; they contain
 * no prices, volumes, scores or any other market figure.
 *
 * They also contain no operational measurements. Throughput, latency and
 * subsystem health used to live here as constants, which made a methodology
 * file into a source of numbers that looked measured and were not. Anything
 * countable now comes from /api/compute/status and /api/health at request
 * time.
 */

export const SCORE_FACTORS: ScoreFactorMeta[] = [
  {
    key: "momentum",
    label: "Momentum",
    weight: 0.28,
    description:
      "Rate-of-change across 1h / 24h / 7d windows, normalised against the venue volatility band.",
  },
  {
    key: "volume",
    label: "Volume",
    weight: 0.22,
    description:
      "Traded notional versus the 30-day rolling median, weighted by venue quality.",
  },
  {
    key: "activity",
    label: "Activity",
    weight: 0.18,
    description:
      "Distinct participants, order count and — for onchain markets — unique wallets settling in the window.",
  },
  {
    key: "relativeStrength",
    label: "Relative strength",
    weight: 0.14,
    description:
      "Return against the median move of the asset's own class, so an equity is never measured against a crypto benchmark.",
  },
  {
    key: "liquidity",
    label: "Liquidity",
    weight: 0.18,
    description:
      "Depth within 50bps of mid, spread stability and slippage on a standardised clip size.",
  },
];

export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "sources",
    label: "Data Sources",
    kind: "source",
    description:
      "Market, stock, crypto and onchain feeds are ingested continuously and stamped at the venue clock.",
    detail: [
      "Market Data — reference prices, corporate actions, venue calendars",
      "Stock Data — consolidated tape, auction prints, extended hours",
      "Crypto Data — spot and perpetual books across covered exchanges",
      "Onchain Data — pool state, settlement events, wallet-level activity",
    ],
  },
  {
    id: "normalization",
    label: "Normalization",
    kind: "process",
    description:
      "Heterogeneous feeds are resolved onto one symbology, one clock and one unit system before any maths runs.",
    detail: [
      "Symbol resolution and cross-venue identity mapping",
      "Timestamp alignment to a single monotonic compute clock",
      "Currency, decimal and lot-size normalisation",
      "Outlier quarantine and gap interpolation",
    ],
  },
  {
    id: "computation",
    label: "Computation",
    kind: "process",
    description:
      "Seven independent components score every market on the same normalised inputs. Components never read each other.",
    detail: [
      "Momentum — multi-window rate-of-change against volatility bands",
      "Volume — notional versus rolling median, venue-quality weighted",
      "Activity — participants, order count, unique settling wallets",
      "Liquidity — depth at 50bps, spread stability, standardised slippage",
      "Market Strength — cross-sectional standing within the asset class",
    ],
  },
  {
    id: "score",
    label: "Strata Score",
    kind: "output",
    description:
      "Module outputs are weighted into a single composite that is comparable across stocks, crypto and onchain markets.",
    detail: [
      "Weighted composite with published factor weights",
      "Cross-class normalisation so a 90 means the same everywhere",
      "Full factor attribution retained for every computation",
    ],
  },
  {
    id: "rankings",
    label: "Rankings",
    kind: "output",
    description:
      "Scores resolve into ordered views — rankings, arena rounds and the signal feed.",
    detail: [
      "Global and per-class leaderboards",
      "Arena round standings and eliminations",
      "Threshold crossings emitted as signals",
    ],
  },
];

export const COMPUTE_MODULES = [
  {
    id: "momentum",
    factor: "momentum" as const,
    label: "Momentum",
    weight: 0.28,
    windows: ["1h", "24h", "7d"],
    inputs: ["Trade prints", "Reference price", "Realised volatility"],
    output: "0–100 directional strength",
    description:
      "Rate-of-change across three windows, each normalised by the market's own realised volatility so a 2% move in a quiet market outranks a 2% move in a violent one.",
  },
  {
    id: "volume",
    factor: "volume" as const,
    label: "Volume",
    weight: 0.22,
    windows: ["24h", "30d median"],
    inputs: ["Traded notional", "Venue quality", "Concentration"],
    output: "0–100 participation strength",
    description:
      "Traded notional measured against a 30-day rolling median, then down-weighted when volume concentrates on a single venue.",
  },
  {
    id: "activity",
    factor: "activity" as const,
    label: "Activity",
    weight: 0.18,
    windows: ["6h", "24h"],
    inputs: ["Order count", "Distinct participants", "Unique wallets"],
    output: "0–100 breadth reading",
    description:
      "Breadth of participation rather than size of participation. Dispersion across many accounts scores higher than the same notional from few.",
  },
  {
    id: "liquidity",
    factor: "liquidity" as const,
    label: "Liquidity",
    weight: 0.18,
    windows: ["Continuous"],
    inputs: ["Book depth", "Quoted spread", "Standardised slippage"],
    output: "0–100 depth quality",
    description:
      "Depth within 50bps of mid, spread stability over the window, and modelled slippage on a standardised clip size.",
  },
  {
    id: "market-strength",
    factor: "sentiment" as const,
    label: "Market Strength",
    weight: 0.14,
    windows: ["24h cross-section"],
    inputs: ["Peer scores", "Class percentile", "Flow imbalance"],
    output: "0–100 relative standing",
    surfacedAs: "Sentiment",
    description:
      "Cross-sectional standing against the asset's own class, which is what makes a crypto 90 and an equity 90 mean the same thing.",
  },
] as const;

/**
 * PLATFORM_STATUS was removed.
 *
 * It hardcoded subsystem health — "41/41 venues connected", "5/5 modules
 * healthy", and an onchain indexer specifically "running 2 blocks behind" —
 * none of it measured. Real pipeline health is served by /api/health and
 * rendered on /status, which reports what the providers actually said.
 */
