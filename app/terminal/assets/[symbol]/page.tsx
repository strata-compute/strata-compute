import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Swords } from "lucide-react";
import {
  loadAssetIntelligenceEvents,
  loadAssetSignals,
  loadEngines,
  loadExplanation,
  loadMarket,
  loadScore,
  loadScoreHistory,
} from "@/lib/data";
import { routes } from "@/lib/routes";
import { formatCompact, formatPrice } from "@/lib/utils";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AssetLogo } from "@/components/data/asset-logo";
import { WatchButton } from "@/components/data/watch-button";
import { LiveScore } from "@/components/data/live-score";
import { subsystemLabels } from "@/lib/subsystems";
import { Delta } from "@/components/data/delta";
import { ScoreBar, ScoreValue } from "@/components/data/score";
import {
  AwaitingComputation,
  DataUnavailable,
  FreshnessBadge,
  NoValue,
  StaleNotice,
} from "@/components/data/data-state";
import {
  ComponentBreakdown,
  ConfidenceBadge,
  ConfidenceBreakdown,
  EngineReadings,
  ScoreDelta,
  ScoreBucket,
  ScoreExplanation,
  SeverityBadge,
} from "@/components/data/intelligence";
import { INTELLIGENCE_META, heldForLabel, magnitudeLabel } from "@/lib/intelligence-meta";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


/**
 * Memoised for the request so `generateMetadata` and the page body share one
 * backend call. React's cache() dedupes within a single render pass; the
 * fetch itself is still `no-store`, so nothing is reused across requests.
 */
const marketFor = cache(loadMarket);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  // The existence check happens here, before the response starts streaming.
  // The console layout is async, so by the time the page body runs, headers
  // have already been flushed as 200 and notFound() can only swap the body.
  // Resolving it during metadata is what makes the status a real 404.
  const { missing } = await marketFor(symbol);
  if (missing) notFound();
  return { title: symbol.toUpperCase() };
}

/**
 * Asset detail, rendered strictly from what the backend holds.
 *
 * The previous version filled this page from generated fixtures — a factor
 * breakdown, venue coverage, a performance table and an activity log that no
 * provider had supplied. Those sections are gone. What remains is the market
 * record and the computed factors; anything the pipeline does not yet produce
 * says so.
 */
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const { data, status, ageSeconds, reason, missing } = await marketFor(symbol);

  // The computation layer is queried alongside the market row. Each piece
  // resolves independently: a missing explanation must not blank the price,
  // and an unscored asset must still render everything that did compute.
  const [
    scoreResult,
    enginesResult,
    explanationResult,
    historyResult,
    signalsResult,
    intelligenceResult,
  ] = await Promise.all([
    loadScore(symbol),
    loadEngines(symbol),
    loadExplanation(symbol),
    loadScoreHistory(symbol, 120),
    loadAssetSignals(symbol),
    loadAssetIntelligenceEvents(symbol),
  ]);

  const computed = scoreResult.data;
  const engines = enginesResult.data;
  const explanation = explanationResult.data;
  const history = historyResult.data;
  const signals = signalsResult.data ?? [];
  // Conditions currently holding on this asset. Resolved ones are deliberately
  // excluded from the panel: "this is happening" and "this happened earlier"
  // are different statements, and only the first belongs beside a live score.
  const activeIntelligence = intelligenceResult.data?.active ?? [];

  // a symbol the backend does not know is a wrong address, not a coverage
  // gap: answer 404 rather than showing an empty panel that implies the
  // asset exists and is merely waiting for data
  if (missing) notFound();

  const back = (
    <Link
      href={routes.assets}
      className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-text"
    >
      <ArrowLeft className="size-3.5" />
      All assets
    </Link>
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {back}
        <DataUnavailable
          title={`No market data for ${symbol.toUpperCase()}`}
          reason={reason}
          status={status}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}

      <header className="flex flex-col gap-6 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-4">
          <AssetLogo asset={{ symbol: data.asset.symbol, name: data.asset.name, logoUrl: data.asset.logoUrl }} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[30px] font-semibold leading-none tracking-[-0.025em] text-text">
                {data.asset.symbol}
              </h1>
              {data.asset.chain ? <Badge tone="outline">{data.asset.chain}</Badge> : null}
              <Badge tone="outline">{data.asset.assetType}</Badge>
            </div>
            <p className="mt-2 text-[14px] text-muted">{data.asset.name}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-8">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">Price</p>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="font-mono text-[26px] font-medium leading-none tracking-[-0.02em] text-text">
                {data.price === null ? "—" : formatPrice(data.price)}
              </span>
              {data.priceChange24h === null ? (
                <NoValue hint="No 24h change reported by the provider" />
              ) : (
                <Delta value={data.priceChange24h} size="lg" />
              )}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
              Strata Score
            </p>
            <div className="mt-1.5">
              {data.score === null ? (
                <AwaitingComputation />
              ) : (
                <span className="flex items-baseline gap-2">
                  <ScoreValue score={data.score} size="lg" />
                  <span className="font-mono text-[11px] text-faint">
                    {data.scoreVersion}
                  </span>
                </span>
              )}
            </div>
          </div>

          <Button asChild variant="secondary" size="sm">
            <Link href={routes.arena}>
              <Swords className="size-3.5" />
              View in Arena
            </Link>
          </Button>
            <WatchButton symbol={data.asset.symbol} />
        </div>
      </header>

      <FreshnessBadge status={status} ageSeconds={ageSeconds} />
      <StaleNotice status={status} ageSeconds={ageSeconds} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Market record</CardTitle>
              <span className="font-mono text-[10.5px] text-faint">
                {data.retrievedAt ? "Observed" : "Not yet observed"}
              </span>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
                {[
                  {
                    label: "Price",
                    value: data.price === null ? null : formatPrice(data.price),
                  },
                  {
                    label: "24h change",
                    value:
                      data.priceChange24h === null
                        ? null
                        : `${data.priceChange24h > 0 ? "+" : ""}${data.priceChange24h.toFixed(2)}%`,
                  },
                  {
                    label: "1h change",
                    value:
                      data.priceChange1h === null
                        ? null
                        : `${data.priceChange1h > 0 ? "+" : ""}${data.priceChange1h.toFixed(2)}%`,
                  },
                  {
                    label: "24h volume",
                    value:
                      data.volume24h === null ? null : formatCompact(data.volume24h, "$"),
                  },
                  {
                    label: "Market cap",
                    value:
                      data.marketCap === null ? null : formatCompact(data.marketCap, "$"),
                  },
                  {
                    label: "Liquidity",
                    value:
                      data.liquidity === null ? null : formatCompact(data.liquidity, "$"),
                  },
                ].map((row) => (
                  <div key={row.label}>
                    <dt className="text-[10.5px] uppercase tracking-[0.13em] text-faint">
                      {row.label}
                    </dt>
                    <dd className="mt-1.5 font-mono text-[14px] tabular-nums text-text">
                      {row.value ?? (
                        <NoValue hint="Not reported by the provider for this market" />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>

              {data.contractAddress ? (
                <div className="mt-6 border-t border-border pt-5">
                  <p className="text-[10.5px] uppercase tracking-[0.13em] text-faint">
                    Contract
                  </p>
                  <p className="mt-1.5 break-all font-mono text-[12px] text-muted">
                    {data.contractAddress}
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Why it moved</CardTitle>
              {explanation ? (
                <span className="font-mono text-[10.5px] text-faint">
                  {explanation.drivers.length} driver
                  {explanation.drivers.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </CardHeader>
            <CardBody>
              {explanation && explanation.status === "OK" ? (
                <>
                  <ScoreExplanation explanation={explanation} />
                  {explanation.observations.length > 0 ? (
                    <div className="mt-6 space-y-2.5 border-t border-border pt-5">
                      <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                        Active observations
                      </p>
                      {explanation.observations.map((observation) => (
                        <div
                          key={`${observation.type}-${observation.detectedAt}`}
                          className="flex items-start gap-2.5"
                        >
                          <SeverityBadge severity={observation.severity} />
                          <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted">
                            {observation.detail ??
                              observation.type.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">
                  {explanation?.insufficientReason ??
                    explanationResult.reason ??
                    "No explanation is available until this market has been scored."}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Engine readings</CardTitle>
              {engines ? (
                <span className="font-mono text-[10.5px] text-faint">
                  {engines.historyPoints} observation
                  {engines.historyPoints === 1 ? "" : "s"}
                </span>
              ) : null}
            </CardHeader>
            <CardBody>
              {engines ? (
                <EngineReadings engines={engines.engines} />
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">
                  {enginesResult.reason ??
                    "No engine readings have been computed for this market yet."}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Score history</CardTitle>
              {history ? <ScoreDelta change={history.change} /> : null}
            </CardHeader>
            <CardBody>
              {history && history.points.length > 1 ? (
                <>
                  <p className="text-[13px] text-muted">
                    {history.points.filter((p) => p.score !== null).length} scored
                    pass{history.points.length === 1 ? "" : "es"} stored over{" "}
                    {history.spanSeconds < 3600
                      ? `${Math.round(history.spanSeconds / 60)}m`
                      : `${(history.spanSeconds / 3600).toFixed(1)}h`}
                    {history.change !== null
                      ? `, net ${history.change >= 0 ? "+" : ""}${history.change.toFixed(1)} points`
                      : ""}
                    .
                  </p>
                  <ul className="mt-4 divide-y divide-border">
                    {history.points.slice(0, 8).map((point) => (
                      <li
                        key={point.timestamp}
                        className="flex items-center justify-between gap-4 py-2"
                      >
                        <span className="font-mono text-[11.5px] text-faint">
                          {new Date(point.timestamp).toISOString().slice(11, 19)}Z
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="font-mono text-[11px] text-faint">
                            conf {(point.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="w-12 text-right font-mono text-[12.5px] tabular-nums text-text">
                            {point.score === null ? "—" : point.score.toFixed(1)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">
                  {historyResult.reason ??
                    "A score history appears once more than one computation pass has been stored for this market."}
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Strata Score</CardTitle>
              {data.scoreVersion ? (
                <span className="font-mono text-[10.5px] text-faint">
                  {data.scoreVersion}
                </span>
              ) : null}
            </CardHeader>
            <CardBody className="space-y-6">
              {computed && computed.status === "OK" && computed.score !== null ? (
                <>
                  <div className="flex flex-col gap-2.5">
                    <LiveScore
                      assetId={data.asset.id}
                      initialScore={computed.score}
                      size="xl"
                    />
                    {/* Confidence sits beside the score, never inside it: a
                        strong reading from thin data stays strong and says so. */}
                    <ScoreBucket
                      bucket={computed.bucket}
                      universeLabel={computed.universeLabel ?? undefined}
                    />
                    <ConfidenceBadge confidence={computed.confidence} />
                  </div>

                  <div className="border-t border-border pt-5">
                    <p className="mb-3.5 text-[10.5px] uppercase tracking-[0.14em] text-faint">
                      Components
                    </p>
                    <ComponentBreakdown
                      components={computed.components}
                      missing={computed.missing}
                    />
                  </div>

                  <div className="border-t border-border pt-5">
                    <p className="mb-3.5 text-[10.5px] uppercase tracking-[0.14em] text-faint">
                      Confidence inputs
                    </p>
                    <ConfidenceBreakdown confidence={computed.confidence} />
                  </div>

                  <div className="space-y-2 border-t border-border pt-5">
                    <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                      Computed from
                    </p>
                    <p className="font-mono text-[11.5px] text-muted">
                      {data.scoreSources.length > 0
                        ? subsystemLabels(data.scoreSources).join(" · ")
                        : "not recorded"}
                    </p>
                    <p className="font-mono text-[11px] text-faint">
                      {computed.scoreVersion ?? computed.version} ·{" "}
                      {new Date(computed.calculatedAt).toISOString()}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AwaitingComputation
                    label={
                      computed?.status === "INSUFFICIENT_DATA"
                        ? "Insufficient data"
                        : "Awaiting computation"
                    }
                  />
                  <p className="text-[12.5px] leading-relaxed text-muted">
                    {computed?.insufficientReason ??
                      scoreResult.reason ??
                      "This market has not been scored yet."}
                  </p>
                  {computed && computed.missing.length > 0 ? (
                    <div className="border-t border-border pt-5">
                      <p className="mb-3.5 text-[10.5px] uppercase tracking-[0.14em] text-faint">
                        What is missing
                      </p>
                      <ComponentBreakdown
                        components={computed.components}
                        missing={computed.missing}
                      />
                    </div>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>

          {activeIntelligence.length > 0 ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Active intelligence</CardTitle>
                <span className="font-mono text-[10.5px] text-faint">
                  {activeIntelligence.length}
                </span>
              </CardHeader>
              <CardBody className="space-y-4">
                {activeIntelligence.slice(0, 5).map((event, i) => (
                  <div key={event.id ?? `${event.eventType}-${i}`} className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <SeverityBadge severity={event.severity} />
                      <span className="text-[12px] text-muted">
                        {INTELLIGENCE_META[event.eventType]?.label ?? event.eventType}
                      </span>
                      <span className="ml-auto font-mono text-[10.5px] text-faint">
                        held {heldForLabel(event)}
                      </span>
                    </div>
                    <p className="font-mono text-[12px] text-text">
                      {magnitudeLabel(event)}
                    </p>
                    {event.drivers.slice(0, 2).map((driver, d) => (
                      <p
                        key={`${driver.metric}-${d}`}
                        className="font-mono text-[11.5px] leading-relaxed text-muted"
                      >
                        {driver.metric.replace(/_/g, " ")}{" "}
                        {driver.observed !== null && driver.baseline !== null
                          ? `${driver.observed.toFixed(2)} vs ${driver.baseline.toFixed(2)} baseline`
                          : driver.evidence.replace(/_/g, " ")}
                      </p>
                    ))}
                    {event.driverAgreement < 0 ? (
                      <p className="text-[11.5px] text-amber">
                        Components disagree — mixed evidence.
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          {signals.length > 0 ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Active signals</CardTitle>
                <span className="font-mono text-[10.5px] text-faint">
                  {signals.length}
                </span>
              </CardHeader>
              <CardBody className="space-y-3">
                {signals.slice(0, 6).map((signal) => (
                  <div key={`${signal.signalType}-${signal.timestamp}`} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={signal.severity} />
                      <span className="text-[12px] text-muted">
                        {signal.signalType.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-text">
                      {String(signal.metadata?.summary ?? "")}
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
