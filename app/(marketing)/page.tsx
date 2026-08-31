import type { Metadata } from "next";
import {
  loadArena,
  loadMarkets,
  loadRankings,
  loadSignals,
  loadStats,
} from "@/lib/data";
import { formatCompact, formatInteger } from "@/lib/utils";
import { Hero } from "@/components/landing/hero";
import { MarketTicker } from "@/components/landing/market-ticker";
import { ProblemSection } from "@/components/landing/problem-section";
import { ComputePipeline } from "@/components/landing/compute-pipeline";
import { ScorePreview } from "@/components/landing/score-preview";
import { ArenaPreview } from "@/components/landing/arena-preview";
import { SignalPreview } from "@/components/landing/signal-preview";
import { MarketCategories } from "@/components/landing/market-categories";
import { InfrastructureSection } from "@/components/landing/infrastructure-section";
import { FinalCTA } from "@/components/landing/final-cta";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: {
    absolute: "Strata Compute — One computation layer. Every market.",
  },
  description:
    "Strata Compute turns fragmented market, stock, crypto and onchain data into one comparable intelligence layer: Strata Scores, rankings, signals and competitive arena data.",
};

/**
 * The landing page reads the same backend the console does.
 *
 * Every figure it displays — the ticker, the hero engine, the score preview,
 * the arena standings, the signal cards — is fetched at request time. Where
 * the backend has nothing, each section renders its own unavailable state.
 * No section falls back to an example.
 */
export default async function LandingPage() {
  const [markets, stats, rankings, arena, signals] = await Promise.all([
    loadMarkets({ limit: 24 }),
    loadStats(),
    loadRankings({ limit: 5 }),
    loadArena(),
    loadSignals({ limit: 4 }),
  ]);

  const tickerQuotes = (markets.data ?? [])
    .slice(0, 16)
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      logoUrl: asset.logoUrl,
      change: asset.change24h ?? null,
    }));

  // the engine graphic shows the first few real inputs and the top real score
  const engineInputs = (markets.data ?? [])
    .slice(0, 5)
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      logoUrl: asset.logoUrl,
      change: asset.change24h ?? null,
    }));
  const engineScore = rankings.data?.entries[0]?.score ?? null;

  const specs = stats.data
    ? [
        { label: "Markets", value: formatInteger(stats.data.marketsPriced) },
        { label: "Scored", value: formatInteger(stats.data.marketsScored) },
        {
          label: "24h volume",
          value:
            stats.data.volume24h === null
              ? "—"
              : formatCompact(stats.data.volume24h, "$"),
        },
        { label: "Classes", value: String(Object.keys(stats.data.byClass).length) },
      ]
    : [
        { label: "Markets", value: "—" },
        { label: "Scored", value: "—" },
        { label: "24h volume", value: "—" },
        { label: "Classes", value: "—" },
      ];

  const scoreRows =
    rankings.data?.entries.slice(0, 5).map((entry) => ({
      rank: entry.rank,
      symbol: entry.symbol,
      market: entry.assetType.toUpperCase(),
      score: entry.score,
    })) ?? [];

  const arenaEntries =
    arena.data?.entries.slice(0, 5).map((entry) => ({
      rank: entry.rank,
      symbol: entry.symbol,
      score: entry.currentScore,
    })) ?? [];

  const now = Date.now();
  const signalRows =
    signals.data?.slice(0, 4).map((signal) => ({
      kind: signal.signalType,
      symbol: signal.symbol,
      value: signal.value,
      ageSeconds: Math.round((now - new Date(signal.timestamp).getTime()) / 1000),
    })) ?? [];

  return (
    <>
      <Hero
        specs={specs}
        engineInputs={engineInputs}
        engineScore={engineScore}
        status={markets.status}
      />
      <MarketTicker quotes={tickerQuotes} status={markets.status} />
      <ProblemSection />
      <ComputePipeline />
      <ScorePreview
        rows={scoreRows}
        status={rankings.status}
        ageSeconds={rankings.ageSeconds}
        reason={rankings.reason}
      />
      <ArenaPreview
        entries={arenaEntries}
        roundNumber={arena.data?.round?.roundNumber ?? null}
        status={arena.status}
        ageSeconds={arena.ageSeconds}
        reason={arena.reason}
      />
      <SignalPreview
        signals={signalRows}
        status={signals.status}
        reason={signals.reason}
      />
      <MarketCategories />
      <InfrastructureSection />
      <FinalCTA />
    </>
  );
}
