import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { loadArenaRound } from "@/lib/data";
import { toAssetClassOrNull } from "@/lib/api/adapters";
import { routes } from "@/lib/routes";
import type { ArenaEntrant, ArenaState } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { ArenaLeaderboard } from "@/components/sections/arena/leaderboard";
import { DataUnavailable, FreshnessBadge } from "@/components/data/data-state";

/**
 * A settled or in-flight arena round, addressed by its number.
 *
 * Rendered per request. A round the backend does not know answers 404 rather
 * than rendering an empty bracket, which would imply the round exists and is
 * merely waiting for data.
 */
export const dynamic = "force-dynamic";

const STATE_MAP: Record<string, ArenaState> = {
  active: "advancing",
  at_risk: "at-risk",
  eliminated: "eliminated",
};

function parseRound(value: string): number | null {
  // a round is a positive integer; "abc", "1.5" and "-3" are wrong addresses
  if (!/^\d+$/.test(value)) return null;
  const round = Number(value);
  return Number.isSafeInteger(round) && round > 0 ? round : null;
}

/** Memoised so the metadata check and the page body share one backend call. */
const roundFor = cache(loadArenaRound);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ round: string }>;
}): Promise<Metadata> {
  const { round } = await params;
  const parsed = parseRound(round);
  // resolved before the response streams, so an unknown round is a real 404
  if (parsed === null) notFound();
  const { missing } = await roundFor(parsed);
  if (missing) notFound();
  return { title: `Arena · Round ${parsed}` };
}

export default async function ArenaRoundPage({
  params,
}: {
  params: Promise<{ round: string }>;
}) {
  const { round } = await params;
  const parsed = parseRound(round);
  if (parsed === null) notFound();

  const { data, status, ageSeconds, reason, missing } = await roundFor(parsed);
  if (missing) notFound();

  const back = (
    <Link
      href={routes.arena}
      className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-text"
    >
      <ArrowLeft className="size-3.5" />
      Current round
    </Link>
  );

  if (!data?.round || data.entries.length === 0) {
    return (
      <div className="space-y-6">
        {back}
        <DataUnavailable
          title={`Round ${parsed} standings unavailable`}
          reason={reason}
          status={status}
        />
      </div>
    );
  }

  const entrants: ArenaEntrant[] = data.entries.map((entry) => ({
    symbol: entry.symbol,
    name: entry.name ?? entry.symbol,
    assetClass: toAssetClassOrNull(entry.assetType),
    logoUrl: entry.logoUrl,
    rank: entry.rank,
    // per-round rank movement is not persisted yet
    previousRank: entry.startingRank,
    score: entry.currentScore,
    roundDelta: null,
    momentum: null,
    volume24h: null,
    state: STATE_MAP[entry.status] ?? "holding",
    control: null,
  }));

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={`Round ${data.round.roundNumber}`}
        subtitle="Standings as recorded for this round."
        actions={<FreshnessBadge status={status} ageSeconds={ageSeconds} />}
      />
      <ArenaLeaderboard entrants={entrants} />
    </div>
  );
}
