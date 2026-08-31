/**
 * Landing page copy and structure.
 *
 * NO MARKET DATA LIVES HERE. Every quote, score, ranking and signal that this
 * file once held has been removed: those were invented figures presented as
 * market observations. Anything numeric the landing page shows now comes from
 * the Strata API at request time, and renders an unavailable state when the
 * backend has nothing.
 *
 * What remains is navigation, section copy, factor names and the pipeline
 * description — none of which is a market figure.
 */
import { routes } from "@/lib/routes";

/* ------------------------------------------------------------------ nav */

/**
 * Marketing navigation. Deliberately short: the site explains the product,
 * the console holds the tools.
 */
export const LANDING_NAV = [
  { label: "About", href: routes.about },
  { label: "Platform", href: routes.platform },
  { label: "Docs", href: routes.documentation },
] as const;

/* --------------------------------------------------------------- quotes */

/* -------------------------------------------------------------- compute */

export const HERO_MODULES = [
  "MOMENTUM",
  "VOLUME",
  "ACTIVITY",
  "LIQUIDITY",
] as const;

export interface PipelineStage {
  id: string;
  label: string;
  caption: string;
  /** Rendered underneath the node as its constituent parts. */
  items?: string[];
}

export const PIPELINE: PipelineStage[] = [
  {
    id: "data",
    label: "DATA",
    caption: "Four domains in",
    items: ["STOCKS", "CRYPTO", "ONCHAIN", "MARKET DATA"],
  },
  {
    id: "normalize",
    label: "NORMALIZE",
    caption: "One clock, one symbology",
    items: ["SYMBOLOGY", "TIMESTAMPS", "UNITS", "OUTLIERS"],
  },
  {
    id: "compute",
    label: "COMPUTE",
    caption: "Seven independent components",
    items: ["MOMENTUM", "VOLUME", "ACTIVITY", "LIQUIDITY", "STRENGTH"],
  },
  {
    id: "score",
    label: "SCORE",
    caption: "0 – 100 composite",
  },
  {
    id: "signals",
    label: "SIGNALS",
    caption: "Computed events out",
    items: ["RANKINGS", "ARENA", "ALERTS", "API"],
  },
];

/** Throughput annotations on the connectors between pipeline stages. */
export const PIPELINE_LINKS = [
  "41 venues",
  "2.4M rec/min",
  "5 modules",
  "1s cadence",
] as const;

/* ---------------------------------------------------------------- score */

export const SCORE_FACTOR_LABELS = [
  { key: "momentum", label: "MOMENTUM", descriptor: "Rate of change" },
  { key: "volume", label: "VOLUME", descriptor: "Traded notional" },
  { key: "activity", label: "ACTIVITY", descriptor: "Participant breadth" },
  { key: "liquidity", label: "LIQUIDITY", descriptor: "Depth and spread" },
] as const;

/* ---------------------------------------------------------------- arena */

/* -------------------------------------------------------------- signals */

/* ----------------------------------------------------------- categories */

export const MARKET_CATEGORIES = [
  {
    id: "stocks",
    label: "STOCKS",
    description: "Traditional equities.",
    detail: "Consolidated tape, auction prints and extended-hours activity.",
  },
  {
    id: "crypto",
    label: "CRYPTO",
    description: "Digital assets.",
    detail: "Spot and perpetual books across every covered venue.",
  },
  {
    id: "onchain",
    label: "ONCHAIN",
    description: "Blockchain activity.",
    detail: "Pool state, settlement events and wallet-level activity.",
  },
  {
    id: "signals",
    label: "MARKET SIGNALS",
    description: "Computed events.",
    detail: "Emitted the moment a factor breaks its own baseline.",
  },
] as const;

/* ------------------------------------------------------- infrastructure */

export interface InfraNode {
  id: string;
  label: string;
  detail: string;
  kind: "edge" | "core" | "surface";
}

export const INFRASTRUCTURE: InfraNode[] = [
  {
    id: "sources",
    label: "DATA SOURCES",
    detail: "Market, equity, crypto and onchain feeds arrive continuously.",
    kind: "edge",
  },
  {
    id: "ingestion",
    label: "INGESTION",
    detail: "Records are stamped at the venue clock and queued for processing.",
    kind: "core",
  },
  {
    id: "normalization",
    label: "NORMALIZATION",
    detail: "Different data structures resolve onto one schema.",
    kind: "core",
  },
  {
    id: "computation",
    label: "COMPUTATION",
    detail: "Five modules score every market on identical normalised inputs.",
    kind: "core",
  },
  {
    id: "api",
    label: "STRATA API",
    detail: "Structured intelligence is served over REST and a live stream.",
    kind: "core",
  },
  {
    id: "application",
    label: "APPLICATION",
    detail: "Rankings, arena rounds and signals render from one source.",
    kind: "surface",
  },
];

/* --------------------------------------------------------------- footer */

/** Footer keeps the two halves of the product visibly separate. */
export const FOOTER_GROUPS = [
  {
    title: "Company",
    links: [
      { label: "About", href: routes.about },
      { label: "Platform", href: routes.platform },
      { label: "Docs", href: routes.documentation },
      { label: "Status", href: routes.status },
    ],
  },
  {
    title: "Application",
    links: [
      { label: "Overview", href: routes.overview },
      { label: "Rankings", href: routes.rankings },
      { label: "Arena", href: routes.arena },
      { label: "Signals", href: routes.signals },
      { label: "Compute", href: routes.compute },
    ],
  },
] as const;
