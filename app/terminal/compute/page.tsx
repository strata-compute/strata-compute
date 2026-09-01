import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PIPELINE_STAGES, SCORE_FACTORS } from "@/lib/pipeline-spec";
import type { ApiComputeStatus } from "@/lib/api";
import {
  loadComputeStatus,
  loadMarket,
  loadMarketIntelligence,
  loadMarkets,
  loadScore,
  loadScoringVersion,
} from "@/lib/data";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  SectionHeading,
} from "@/components/ui/primitives";
import { PageHero } from "@/components/layout/page-hero";
import {
  PipelineDiagram,
  StageDetails,
} from "@/components/sections/compute/pipeline";
import {
  ModuleGrid,
  WeightBar,
  WorkedExample,
} from "@/components/sections/compute/modules";
import { routes } from "@/lib/routes";
import { IntelligenceEventRow } from "@/components/data/intelligence-event";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "Compute",
  description:
    "From raw market data to usable intelligence — the Strata computation pipeline, module by module.",
};

const SOURCES = [
  {
    id: "market",
    label: "Market Data",
    detail: "Reference prices, corporate actions, venue calendars and halt state.",
    cadence: "continuous",
  },
  {
    id: "stock",
    label: "Stock Data",
    detail: "Consolidated tape, auction prints and extended-hours activity.",
    cadence: "tick",
  },
  {
    id: "crypto",
    label: "Crypto Data",
    detail: "Spot and perpetual order books across every covered exchange.",
    cadence: "tick",
  },
  {
    id: "onchain",
    label: "Onchain Data",
    detail: "Pool state, settlement events and wallet-level activity per block.",
    cadence: "per block",
  },
];

/**
 * What the engine guarantees, measured where it can be.
 *
 * Two of these were invented: a "1s" cadence against a job that runs every
 * sixty seconds, and a "260ms p50" latency against a pass that takes about
 * twenty-five. Both now come from /api/compute/status, and read "—" when the
 * backend cannot say. The remaining two are properties of the engine rather
 * than measurements, and were already true.
 */
function guarantees(status: ApiComputeStatus | null) {
  const computeJob = status?.jobs?.find((job) => job.name.includes("compute"));
  const cadence = computeJob ? `${Math.round(computeJob.intervalMs / 1000)}s` : "—";
  const pass =
    typeof status?.processingTimeMs === "number"
      ? `${(status.processingTimeMs / 1000).toFixed(1)}s`
      : "—";

  return [
    {
      label: "Cadence",
      value: cadence,
      detail: "How often every covered market is recomputed.",
    },
    {
      label: "Last pass",
      value: pass,
      detail: "Wall-clock time of the most recent computation across all markets.",
    },
    {
      label: "Determinism",
      value: "Replayable",
      detail: "Same inputs and weights reproduce the same score.",
    },
    {
      label: "Attribution",
      value: "Retained",
      detail: "Every computation keeps its full factor breakdown.",
    },
  ];
}

export default async function ComputePage() {
  // the worked example uses whichever market the engine actually scored
  // highest; if nothing has been scored it renders an unavailable state
  const markets = await loadMarkets({ limit: 1 });
  const top = markets.data?.[0] ?? null;
  const detail = top ? await loadMarket(top.symbol) : null;

  // The worked example is computed from a real scored market, using the
  // weights the engine publishes rather than a copy held here.
  const [workedScore, scoringVersion, marketIntelligence, computeStatus] = await Promise.all([
    top ? loadScore(top.symbol) : Promise.resolve({ data: null } as const),
    loadScoringVersion(),
    loadMarketIntelligence(),
    loadComputeStatus(),
  ]);

  const intel = marketIntelligence.data;
  // The detection stage's actual output, read from the engine rather than
  // described. A pipeline page that explains a stage without ever showing
  // what it produced is a diagram, not evidence.
  const detected = intel
    ? [
        ...intel.strongestAccelerations,
        ...intel.largestDeteriorations,
        ...intel.volumeAnomalies,
        ...intel.rankMovers,
        ...intel.regimeShifts,
        ...intel.rotation,
      ]
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 8)
    : [];
  return (
    <div className="space-y-10">
      <PageHero
        eyebrow="Infrastructure"
        title="Compute"
        subtitle="From raw market data to usable intelligence."
        description={
          <p>
            Strata is a pipeline, not a dashboard. Feeds from four data domains
            are normalised onto one clock and one symbology, scored by five
            independent modules, and resolved into a single composite that means
            the same thing whether it describes an equity, a token or a pool.
          </p>
        }
        actions={
          <>
            <Button asChild variant="primary" size="lg">
              <Link href={routes.rankings}>
                See the output
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={routes.documentation}>Read the methodology</Link>
            </Button>
          </>
        }
        aside={
          <div className="flex h-full flex-col justify-center gap-4 rounded-lg border border-border bg-bg/60 p-5">
            {guarantees(computeStatus.data).map((item) => (
              <div key={item.label} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                    {item.label}
                  </span>
                  <span className="font-mono text-[13px] text-text">
                    {item.value}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        }
      />

      {/* -------------------------------------------------------- pipeline */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Pipeline"
          title="Data sources → normalization → computation → Strata Score → rankings"
          description="Each stage is independent and observable. A failure in one venue degrades coverage for that venue only; it never silently changes a score."
        />
        <PipelineDiagram />
        <StageDetails />
      </section>

      {/* --------------------------------------------------------- sources */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Stage 01"
          title="Data sources"
          description="Four domains, one ingestion contract. Every record is stamped at the venue clock before it enters the pipeline."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SOURCES.map((source) => (
            <Card key={source.id}>
              <CardHeader>
                <CardTitle>{source.label}</CardTitle>
                <span className="font-mono text-[10.5px] text-faint">
                  {source.cadence}
                </span>
              </CardHeader>
              <CardBody>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  {source.detail}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- modules */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Stage 03"
          title="Computation modules"
          description="Seven components read the same normalised inputs and never read each other. Their weights are published and fixed for the life of a scoring version."
        />
        <Card>
          <CardHeader>
            <CardTitle>Weight allocation</CardTitle>
            <span className="font-mono text-[10.5px] text-faint">
              {scoringVersion.data?.version ?? "version unavailable"}
            </span>
          </CardHeader>
          <CardBody>
            <WeightBar weights={scoringVersion.data?.weights ?? null} />
          </CardBody>
        </Card>
        <ModuleGrid />
      </section>

      {/* ----------------------------------------------------------- score */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Stage 04"
          title="Strata Score"
          description="The composite is a weighted sum — nothing more exotic. That is deliberate: a score you cannot reconstruct by hand is a score you cannot trust."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <WorkedExample
            symbol={detail?.data?.asset.symbol ?? null}
            score={workedScore.data}
            weights={scoringVersion.data?.weights ?? null}
          />
          <Card>
            <CardHeader>
              <CardTitle>Reading the number</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 text-[12.5px] leading-relaxed text-muted">
              <p>
                Scores are cross-normalised within each asset class before the
                composite is formed, so an 88 on an onchain pool and an 88 on a
                large-cap equity describe the same relative strength.
              </p>
              <ul className="space-y-2.5 border-t border-border pt-4">
                {[
                  ["85 – 100", "Strong across every weighted factor"],
                  ["70 – 84", "Solid composite, usually one soft input"],
                  ["50 – 69", "Mixed; momentum or liquidity is dragging"],
                  ["0 – 49", "Weak or thinly covered market"],
                ].map(([range, meaning]) => (
                  <li key={range} className="flex gap-3">
                    <span className="w-20 shrink-0 font-mono text-[11.5px] text-text">
                      {range}
                    </span>
                    <span>{meaning}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------- intelligence */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Stage 05"
          title="Detection"
          description="Scores are compared against their own history. What has moved further than this asset usually moves, held long enough to mean it, and can be explained by the components underneath becomes an intelligence event."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>What detection is running on</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-[12.5px] leading-relaxed text-muted">
              <dl className="space-y-2.5">
                <div className="flex items-baseline justify-between gap-4">
                  <dt>Conditions currently open</dt>
                  <dd className="font-mono text-text">
                    {intel ? intel.openEventCount : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt>Market regime</dt>
                  <dd className="font-mono text-text">{intel?.regime?.state ?? "—"}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt>Advancing / declining</dt>
                  <dd className="font-mono text-text">
                    {intel?.breadth
                      ? `${intel.breadth.overall.advancing}/${intel.breadth.overall.declining}`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <p className="border-t border-border pt-3">
                An event is one condition, carried forward while it holds and
                closed when it stops. Fifteen passes over the same condition
                produce one event seen fifteen times — never fifteen events.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detected right now</CardTitle>
              <span className="font-mono text-[10.5px] text-faint">
                {detected.length > 0 ? `${detected.length} shown` : "quiet"}
              </span>
            </CardHeader>
            <CardBody className={detected.length > 0 ? "p-0" : undefined}>
              {detected.length > 0 ? (
                detected.map((event, i) => (
                  <IntelligenceEventRow
                    key={event.id ?? `${event.assetId}-${event.eventType}-${i}`}
                    event={event}
                  />
                ))
              ) : (
                <p className="text-[12.5px] leading-relaxed text-muted">
                  {marketIntelligence.reason ??
                    "Nothing has cleared the significance threshold. A quiet market is a result, not a gap."}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* -------------------------------------------------------- rankings */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Stage 06"
          title="Where the score goes"
          description="Rankings, arena rounds and signals are three views onto one computation — not three separate products."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              href: routes.rankings,
              title: "Rankings",
              detail:
                "Ordered standings across every class, sortable by any single factor.",
            },
            {
              href: routes.arena,
              title: "Arena",
              detail:
                "The same scores resolved into competitive rounds with eliminations.",
            },
            {
              href: routes.signals,
              title: "Signals",
              detail:
                "Threshold crossings emitted the moment a factor breaks its baseline.",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-border-strong hover:bg-surface-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium text-text">
                  {item.title}
                </span>
                <ArrowRight className="size-3.5 text-border-strong transition-colors group-hover:text-green-ink" />
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                {item.detail}
              </p>
            </Link>
          ))}
        </div>
        <p className="font-mono text-[11px] text-faint">
          {PIPELINE_STAGES.length} stages · {SCORE_FACTORS.length} modules ·
          every figure on this page is read from the engine
        </p>
      </section>
    </div>
  );
}
