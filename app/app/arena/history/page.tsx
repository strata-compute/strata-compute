import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Crown } from "lucide-react";
import { loadArenaHistory } from "@/lib/data";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/layout/page-header";
import { AssetLogo } from "@/components/data/asset-logo";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { DataUnavailable } from "@/components/data/data-state";

export const metadata: Metadata = {
  title: "Arena history",
  description: "Settled rounds, winners and final standings.",
};

export const dynamic = "force-dynamic";

export default async function ArenaHistoryPage() {
  const history = await loadArenaHistory(40);

  const back = (
    <Link
      href={routes.arena}
      className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-text"
    >
      <ArrowLeft className="size-3.5" />
      Current round
    </Link>
  );

  if (!history.data) {
    return (
      <div className="space-y-6">
        {back}
        <PageHeader
          eyebrow="Arena"
          title="Hall of Fame"
          subtitle="Every settled round, with the winner and final state as recorded."
        />
        <DataUnavailable
          title="No round has settled yet"
          reason={
            history.reason ??
            "History appears once the first round closes. Results are permanent once written."
          }
          status={history.status}
        />
      </div>
    );
  }

  const rounds = history.data;
  const withWinner = rounds.filter((round) => round.winnerSymbol !== null);

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow="Arena"
        title="Hall of Fame"
        subtitle="Every settled round, with the winner and final state as recorded. A settled result is never recomputed."
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Settled rounds</CardTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {rounds.length} recorded
          </span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {["Season", "Round", "Winner", "Final score", "Final HP", "Settled"].map(
                  (heading, i) => (
                    <th
                      key={heading}
                      className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.14em] text-faint ${
                        i >= 3 ? "text-right" : "text-left"
                      }`}
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => (
                <tr key={round.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono text-[12px] text-muted">
                    S{round.season}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={routes.arenaRound(round.roundNumber)}
                      className="font-mono text-[12.5px] text-text transition-colors hover:text-green-ink"
                    >
                      R{round.roundNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {round.winnerSymbol ? (
                      <Link
                        href={routes.asset(round.winnerSymbol)}
                        className="flex items-center gap-2.5"
                      >
                        <Crown className="size-3.5 shrink-0 text-green-ink" />
                        <AssetLogo asset={{ symbol: round.winnerSymbol }} size="xs" />
                        <span className="text-[13px] font-medium text-text">
                          {round.winnerSymbol}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-[12.5px] text-faint">
                        no winner recorded
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums text-text">
                    {round.winnerScore === null ? "—" : round.winnerScore.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums text-text">
                    {round.winnerHp === null ? "—" : round.winnerHp.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[11.5px] text-faint">
                    {round.settledAt
                      ? new Date(round.settledAt).toISOString().slice(0, 16).replace("T", " ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {withWinner.length === 0 ? (
        <p className="text-[12.5px] text-muted">
          No round has produced a winner yet. A winner is read off the final
          state rather than selected.
        </p>
      ) : null}
    </div>
  );
}
