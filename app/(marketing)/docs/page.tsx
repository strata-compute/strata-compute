import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SCORE_FACTORS } from "@/lib/pipeline-spec";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "How Strata Compute normalises tokenised equities, crypto and onchain markets into one comparable measure of strength.",
};

/**
 * Documentation.
 *
 * Written against the system as it exists. The previous version documented a
 * `/v1` API that was never built, a scoring version that was never released,
 * and a coverage policy nothing implemented — so this page now states only
 * what can be checked against the running service.
 *
 * The Methodology section is preserved: same meaning, same mathematics, and
 * kept where a reader looks for it.
 */

const API_BASE = "https://api.stratacompute.app";

interface Section {
  id: string;
  title: string;
  body: string[];
}

const CONCEPTS: Section[] = [
  {
    id: "computation-layer",
    title: "Computation layer",
    body: [
      "Strata is not a data feed with a chart on top. Providers are read on their own cadence, normalised, and computed by a backend engine on a fixed schedule; the Terminal renders what that engine already decided.",
      "The distinction matters in one specific way: two people opening the same page in the same second see the same number, because neither of their browsers computed it.",
    ],
  },
  {
    id: "normalized-data",
    title: "Normalized market data",
    body: [
      "A tokenised equity, a crypto major and an onchain token report different shapes of data on different clocks. Before anything is scored they are resolved onto one symbology, one timestamp basis, and one set of metric definitions.",
      "Observations that cannot be trusted are quarantined rather than smoothed. A single impossible print is dropped by a median-based filter; a series with no real variation is marked unmeasurable instead of being reported as calm.",
    ],
  },
  {
    id: "strata-score",
    title: "Strata Score",
    body: [
      "A 0–100 composite of seven independently computed components. Each component is normalised to its asset's peer group before the weights are applied, which is what allows a score to mean the same thing for a tokenised equity and for an onchain token.",
      "A score is never a recommendation. It measures computed strength relative to peers over a defined window, and nothing else.",
    ],
  },
  {
    id: "confidence",
    title: "Confidence",
    body: [
      "Reported separately from the score, and deliberately so. Confidence describes how much of the model was actually measurable for that asset: how many components computed, how fresh the inputs are, how deep the history is, and how large the peer group was.",
      "A high score with low confidence is a real and useful state. Collapsing the two into one number would hide it.",
    ],
  },
  {
    id: "signals",
    title: "Signals",
    body: [
      "A signal is a threshold crossing at an instant: a computed factor broke its own baseline. It is an observation, not a guarantee, not a prediction, and not financial advice.",
      "Signals are emitted against an asset's own history rather than a fixed level, so the same rule applies to a mega-cap equity and a thin onchain token without favouring either.",
    ],
  },
  {
    id: "intelligence",
    title: "Intelligence",
    body: [
      "Where a signal fires and expires, an intelligence event is a condition that persists. It records when something started, that it is still true, and how far it has come.",
      "The same condition seen across fifteen computation passes produces one event that evolves — never fifteen events that repeat.",
    ],
  },
  {
    id: "persistence",
    title: "Persistence",
    body: [
      "Every observation, score, ranking, signal and intelligence event is written to PostgreSQL before it is served. History is the input to most of what the engine does: baselines, percentile ranks and deviation are all measured against an asset's own past.",
      "A restart changes nothing a reader can see. The engine reads its previous state back from the database and continues.",
    ],
  },
];

const MARKETS: { label: string; detail: string }[] = [
  {
    label: "Tokenised equities",
    detail:
      "Robinhood Stock Tokens, read from Robinhood Chain and from the official Stock Token API. Priced and scored as their own peer group, because a tokenised equity does not trade like the underlying listing.",
  },
  {
    label: "Crypto",
    detail:
      "Major crypto markets with continuous pricing and deep venue coverage. Their own peer group, with the same seven components and the same weights.",
  },
  {
    label: "Onchain",
    detail:
      "Tokens observed directly on Robinhood Chain — transfers, participants and contract state — alongside indexed chain data and token security checks.",
  },
];

const ENGINE: Section[] = [
  {
    id: "compute-engine",
    title: "Compute engine",
    body: [
      "Each component is a pure function of a market's normalised history: momentum over multiple windows, volume against its own rolling median, participation, liquidity, relative strength within the peer group, fitted trend, and volatility.",
      "A component that cannot be computed from the available history is reported as null and its weight is redistributed across the components that did compute. It is never filled with a neutral value — a substituted 50 is indistinguishable from a measured 50, and only one of them is true.",
    ],
  },
  {
    id: "calibration",
    title: "Normalisation and calibration",
    body: [
      "Component readings are converted to percentile ranks within the asset's peer group, then combined and anchored so the resulting distribution is stable across passes. Robust statistics are used throughout: medians and median absolute deviation rather than means and standard deviations, because the values worth detecting are exactly the ones that distort a mean.",
      "Scores are recorded with the version of the formula that produced them. When the formula changes the version increments, and prior scores stay queryable under the version they were computed with.",
    ],
  },
  {
    id: "intelligence-engine",
    title: "Intelligence engine",
    body: [
      "Detection compares a market's current computed state against its own recent history across 15m, 1h and 4h windows. A window that cannot meet both an observation count and an elapsed-time span reports insufficient history rather than producing a weaker comparison.",
      "Significance is the product of four readings — magnitude, persistence, historical deviation and data confidence. A product rather than an average, so any one reading near zero collapses the result: a large move, seen once, on data we do not trust is not a finding.",
      "Events have a lifecycle. A condition that stops holding is resolved; one that stops being observed is expired. Those are different statements, and conflating them would let a pipeline outage read as a market change.",
    ],
  },
];

const SURFACES: { title: string; body: string; href: string }[] = [
  {
    title: "Rankings",
    body: "Every covered market ordered by computed strength. Because scores are normalised within each peer group before ranking, a combined table compares standing rather than raw magnitude — a stock at 90 and a token at 90 are each strong within their own class.",
    href: routes.rankings,
  },
  {
    title: "Compare",
    body: "Two to four markets side by side, component by component, with the differences stated rather than implied. The comparison is computed, not written: there is no language model anywhere in this product.",
    href: routes.compare,
  },
  {
    title: "Arena",
    body: "Computed strength resolved into rounds. Entries carry health that moves with their score across a round, and a round settles on what was measured — it is a view onto the same computation, not a separate game with its own numbers.",
    href: routes.arena,
  },
];

const METHODOLOGY: Section[] = [
  {
    id: "methodology",
    title: "Methodology",
    body: [
      "Every covered market is scored on seven independently computed components. Component readings are cross-normalised within an asset class, then combined using published weights. No component reads another component's output, so a failure in one degrades that component only.",
      "Weights are renormalised over whatever actually computed. A market missing a component is scored on the rest at proportionally higher weight, and its confidence falls accordingly.",
    ],
  },
  {
    id: "coverage",
    title: "Coverage",
    body: [
      "A market enters the compute set when a provider reports it and enough history accumulates to compute against. Markets whose data goes stale are marked stale rather than removed, so their history stays intact and their absence is visible.",
      "Scoring a peer group requires a minimum number of members. Below that threshold a percentile rank would describe the sample rather than the market, so the score is withheld instead.",
    ],
  },
  {
    id: "versioning",
    title: "Scoring versions",
    body: [
      "Weights are fixed for the life of a scoring version. When they change, the version increments and prior scores remain queryable under the version that produced them.",
      "The active version and its published weights are served by the API, so the interface explains a score using the numbers that actually produced it rather than a copy that can drift.",
    ],
  },
  {
    id: "determinism",
    title: "Determinism",
    body: [
      "Given the same normalised inputs and the same scoring version, a computation reproduces exactly. No stage reads a clock or a random source during scoring; the pass supplies a single instant.",
      "Every published score retains its full component attribution and the identifier of the computation that produced it, which is what makes a score reconstructable from the observations behind it.",
    ],
  },
];

const INTEGRITY: string[] = [
  "Every figure Strata publishes is computed from data a provider actually returned. There is no synthetic data path in this system — not disabled, not defaulted off: the generator was removed and the service has no third behaviour to configure.",
  "When a provider is unavailable, the capability it feeds is reported as unavailable. Pages render a degraded or empty state rather than a substituted number, because an invented figure presented as a market observation is the one failure this product exists to avoid.",
  "Timestamps are stored and served in UTC, and every payload carries the time it was retrieved. A reader can always tell how old a number is.",
  "A quiet market is a result. When nothing crosses a significance threshold, the intelligence feed says so instead of filling itself.",
];

const ENDPOINTS: { method: string; path: string; detail: string }[] = [
  { method: "GET", path: "/api/health", detail: "Service, database and data-source status" },
  { method: "GET", path: "/api/ready", detail: "Readiness probe — database reachability only" },
  { method: "GET", path: "/api/assets", detail: "Covered markets; filter by type or search" },
  { method: "GET", path: "/api/markets", detail: "Latest price, components and score per market" },
  { method: "GET", path: "/api/markets/:symbol", detail: "One market with component and score history" },
  { method: "GET", path: "/api/rankings", detail: "Ordered standings; metric and class filters" },
  { method: "GET", path: "/api/signals", detail: "Signal feed; type, class and window filters" },
  { method: "GET", path: "/api/intelligence", detail: "Open intelligence events, highest priority first" },
  { method: "GET", path: "/api/intelligence/market", detail: "Breadth, regime and events grouped by kind" },
  { method: "GET", path: "/api/arena/current", detail: "Active round, standings and configuration" },
  { method: "GET", path: "/api/compute/status", detail: "Engine state, cadence, weights and job health" },
  { method: "GET", path: "/api/events/stream", detail: "Server-sent events; replays on reconnect" },
];

function Prose({ section }: { section: Section }) {
  return (
    <Card id={section.id}>
      <CardHeader>
        <CardTitle>{section.title}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {section.body.map((paragraph, i) => (
          <p key={i} className="text-[13px] leading-relaxed text-muted">
            {paragraph}
          </p>
        ))}
      </CardBody>
    </Card>
  );
}

export default function DocumentationPage() {
  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-6 px-5 pb-24 pt-28 sm:px-8 lg:pt-32">
      <PageHeader
        eyebrow="Documentation"
        title="Strata Compute"
        subtitle="A computation and intelligence layer for tokenised equities, crypto and onchain markets. Built on Robinhood Chain. This page describes the system as it runs today."
      />

      <Card>
        <CardHeader>
          <CardTitle>What Strata is</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-[13px] leading-relaxed text-muted">
            Strata reads three kinds of market that are not natively
            comparable, normalises them onto one schema and one clock, and
            computes a single measure of strength that means the same thing in
            each. On top of that sit signals, rankings, comparison and a
            persistent record of what changed and when.
          </p>
          <p className="text-[13px] leading-relaxed text-muted">
            The tokenised equities Strata covers are Robinhood Stock Tokens,
            read from Robinhood Chain directly and from the official Stock
            Token API. Strata is an independent project: it is not affiliated
            with, endorsed by, or operated by Robinhood.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {CONCEPTS.map((section) => (
          <Prose key={section.id} section={section} />
        ))}
      </div>

      <Card id="markets">
        <CardHeader>
          <CardTitle>Markets</CardTitle>
          <span className="font-mono text-[10.5px] text-faint">three peer groups</span>
        </CardHeader>
        <ul>
          {MARKETS.map((market) => (
            <li
              key={market.label}
              className="flex flex-col gap-1.5 border-b border-border/70 px-5 py-4 last:border-b-0 sm:flex-row sm:gap-6"
            >
              <p className="w-44 shrink-0 text-[13px] font-medium text-text">
                {market.label}
              </p>
              <p className="text-[12.5px] leading-relaxed text-muted">{market.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {ENGINE.map((section) => (
          <Prose key={section.id} section={section} />
        ))}
      </div>

      <Card id="components">
        <CardHeader>
          <CardTitle>Component definitions</CardTitle>
          <span className="font-mono text-[10.5px] text-faint">
            published weights
          </span>
        </CardHeader>
        <ul>
          {SCORE_FACTORS.map((factor) => (
            <li
              key={factor.key}
              className="flex flex-col gap-1.5 border-b border-border/70 px-5 py-4 last:border-b-0 sm:flex-row sm:gap-6"
            >
              <div className="flex w-40 shrink-0 items-baseline justify-between gap-3 sm:block">
                <p className="text-[13px] font-medium text-text">{factor.label}</p>
                <p className="mt-0.5 font-mono text-[11px] text-faint">
                  weight {(factor.weight * 100).toFixed(0)}%
                </p>
              </div>
              <p className="text-[12.5px] leading-relaxed text-muted">
                {factor.description}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {SURFACES.map((surface) => (
          <Card key={surface.title}>
            <CardHeader>
              <CardTitle>{surface.title}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-muted">{surface.body}</p>
              <Link
                href={surface.href}
                className="group inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-green-ink"
              >
                Open in Terminal
                <ArrowUpRight className="size-3.5 text-border-strong transition-colors group-hover:text-green-ink" />
              </Link>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card id="data-integrity">
        <CardHeader>
          <CardTitle>Data integrity</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {INTEGRITY.map((paragraph, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-muted">
              {paragraph}
            </p>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {METHODOLOGY.map((section) => (
          <Prose key={section.id} section={section} />
        ))}
      </div>

      <Card id="api">
        <CardHeader>
          <CardTitle>API surface</CardTitle>
          <code className="font-mono text-[10.5px] text-faint">{API_BASE}</code>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-muted">
            The interface the Terminal and this site read. Every response is{" "}
            <code className="font-mono text-[12px] text-text">{"{ data, meta }"}</code>
            ; every error is{" "}
            <code className="font-mono text-[12px] text-text">{"{ error, meta }"}</code>
            . <code className="font-mono text-[12px] text-text">meta</code> carries
            the retrieval time and the store the payload came from, so freshness
            is always answerable. There is no second data path.
          </p>
          <div className="overflow-x-auto">
            <ul className="min-w-[520px] divide-y divide-border/70 overflow-hidden rounded-md border border-border">
              {ENDPOINTS.map((endpoint) => (
                <li
                  key={endpoint.path}
                  className="flex flex-wrap items-center gap-3 bg-surface-2/40 px-4 py-2.5"
                >
                  <span className="w-10 shrink-0 font-mono text-[11px] text-green-ink">
                    {endpoint.method}
                  </span>
                  <code className="font-mono text-[12.5px] text-text">
                    {endpoint.path}
                  </code>
                  <span className="ml-auto text-[12px] text-muted">
                    {endpoint.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where to go next</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-3">
          {[
            { href: routes.compute, label: "The computation pipeline" },
            { href: routes.rankings, label: "Live rankings" },
            { href: routes.status, label: "Pipeline status" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center justify-between rounded-md border border-border px-3.5 py-3 text-[12.5px] text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {link.label}
              <ArrowUpRight className="size-3.5 text-border-strong transition-colors group-hover:text-green-ink" />
            </Link>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
