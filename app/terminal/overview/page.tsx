import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
  loadBreadth,
  loadEarlyMovers,
  loadMarkets,
  loadRegime,
  loadSignals,
  loadStats,
} from "@/lib/data";
import { LiveFeed } from "@/components/realtime/live-feed";
import {
  EarlyMoversPanel,
  MarketBreadthPanel,
  MarketRegimePanel,
} from "@/components/sections/market-intelligence";
import { routes } from "@/lib/routes";
import { formatCompact, formatInteger } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, SectionHeading } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page-header";
import { AssetTable } from "@/components/data/score-table";
import {
  DataUnavailable,
  FreshnessBadge,
  StaleNotice,
  formatAge,
} from "@/components/data/data-state";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


/**
 * Every figure on this page is counted from ingested data. The metric cards
 * previously showed invented platform statistics; they now read `/api/stats`,
 * and each one renders an em dash rather than a number when the underlying
 * data is absent.
 */
export default async function OverviewPage() {
  const [markets, stats, signals, regime, breadth, earlyMovers] = await Promise.all([
    loadMarkets({ limit: 12 }),
    loadStats(),
    loadSignals({ limit: 6 }),
    loadRegime(),
    loadBreadth(),
    loadEarlyMovers(6),
  ]);

  // "Highest computed strength" must actually be ordered by computed
  // strength. Unscored markets are excluded rather than sorted last: an asset
  // that could not be scored has no place in a ranking of scores at all.
  const leaderboard = (markets.data ?? [])
    .filter((asset) => asset.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, 8);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Overview"
        title="The computation layer for modern markets"
        subtitle="Strata ingests market, stock, crypto and onchain data, normalises it onto a single clock and symbology, and computes it into one comparable measure of strength."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href={routes.arena}>
                Explore Arena
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={routes.rankings}>View Rankings</Link>
            </Button>
          </div>
        }
        meta={
          <div className="border-t border-border pt-4">
            <FreshnessBadge
              status={markets.status}
              ageSeconds={markets.ageSeconds}
            />
          </div>
        }
      />

      <StaleNotice
        status={markets.status}
        ageSeconds={markets.ageSeconds}
      />

      {/* ------------------------------------------------- coverage ----- */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Market compute"
          title="Coverage"
          description="Counted from what Strata has actually ingested and scored — not a projection."
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href={routes.compute}>
                How it works
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          }
        />

        {stats.data ? (
          <div className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Assets tracked",
                value: formatInteger(stats.data.assetsTracked),
                note: null as string | null,
              },
              {
                label: "Markets scored",
                value: formatInteger(stats.data.marketsScored),
                note: null,
              },
              {
                label: "24h volume",
                value:
                  stats.data.volume24h === null
                    ? "—"
                    : formatCompact(stats.data.volume24h, "$"),
                note:
                  stats.data.volume24h === null
                    ? "No provider reported volume"
                    : `${stats.data.volumeCoverage} of ${stats.data.marketsPriced} markets reporting`,
              },
              {
                label: "Compute events 24h",
                value: formatInteger(stats.data.computeEvents24h),
                note: `Scoring version ${stats.data.computationVersion}`,
              },
            ].map((metric) => (
              <div key={metric.label} className="bg-bg px-5 py-4">
                <p className="text-[10.5px] uppercase tracking-[0.16em] text-faint">
                  {metric.label}
                </p>
                <p className="mt-2 font-mono text-[24px] leading-none tabular-nums text-text">
                  {metric.value}
                </p>
                {metric.note ? (
                  <p className="mt-2 text-[11.5px] text-faint">{metric.note}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <DataUnavailable
            title="Coverage unavailable"
            reason={stats.reason}
            status={stats.status}
          />
        )}
      </section>

      {/* ------------------------------------- market intelligence ----- */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Market state"
          title="What the covered set is doing"
          description="Computed from the markets Strata scores — a reading of this set, not a claim about markets it does not cover."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <MarketRegimePanel regime={regime.data} reason={regime.reason} />
          <MarketBreadthPanel breadth={breadth.data} reason={breadth.reason} />
          <EarlyMoversPanel movers={earlyMovers.data} reason={earlyMovers.reason} />
        </div>
      </section>

      {/* ------------------------------------------- live activity ----- */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Live"
          title="What just changed"
          description="Emitted by the computation layer as values cross the thresholds worth reporting. Nothing here is generated to fill the panel."
        />
        <LiveFeed limit={12} />
      </section>

      {/* --------------------------------------------- strata score ----- */}
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Strata score"
          title="Highest computed strength"
          description="Scored on identical inputs regardless of asset class."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={routes.rankings}>
                Full rankings
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        />
        {leaderboard.length > 0 ? (
          <Card className="overflow-hidden">
            <AssetTable
              assets={leaderboard}
              columns={["asset", "type", "price", "change", "score", "status"]}
            />
          </Card>
        ) : (
          <DataUnavailable
            title="No scored markets yet"
            reason={markets.reason}
            status={markets.status}
          />
        )}
      </section>

      {/* ---------------------------------------------------- signals --- */}
      <section className="space-y-5">
        <SectionHeading eyebrow="Signals" title="Latest computed events" />
        {signals.data && signals.data.length > 0 ? (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Latest signals</CardTitle>
              <Link
                href={routes.signals}
                className="text-[12px] text-muted transition-colors hover:text-text"
              >
                View all
              </Link>
            </CardHeader>
            <ul className="divide-y divide-border/70">
              {signals.data.map((signal) => (
                <li
                  key={signal.id ?? `${signal.assetId}-${signal.timestamp}`}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <span className="w-16 shrink-0 text-[12.5px] font-medium text-text">
                    {signal.symbol}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] uppercase tracking-[0.12em] text-muted">
                    {signal.signalType.replace(/_/g, " ")}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-faint">
                    {signal.value.toFixed(2)}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-faint">
                    {formatAge(
                      Math.round(
                        (Date.now() - new Date(signal.timestamp).getTime()) / 1000,
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-4 py-2.5">
              <span className="font-mono text-[10.5px] text-faint">
                Detected by Strata from live market data
              </span>
            </div>
          </Card>
        ) : (
          <DataUnavailable
            title="No active signals detected"
            reason={signals.reason}
            status={signals.status}
          />
        )}
      </section>
    </div>
  );
}
