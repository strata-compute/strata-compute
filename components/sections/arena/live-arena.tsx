"use client";

import * as React from "react";
import Link from "next/link";
import { Crown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ApiArenaConfig, ApiArenaEntryFull, ApiArenaRoundFull } from "@/lib/api";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ConnectionStatus } from "@/components/realtime/live-feed";
import { useEvents } from "@/components/realtime/stream-provider";

/**
 * THE LIVE ARENA
 *
 * Standings that move as computation runs. The server-rendered round is the
 * starting state; arena events on the stream update HP, rank and status in
 * place without a refetch.
 *
 * The animation discipline is the point. This is a competition drawn over
 * real market data, and it must not start feeling like a game: a rank change
 * moves a row and briefly marks it, HP counts to its new value, and
 * elimination dims a row rather than exploding it. Nothing flashes, nothing
 * celebrates, and no motion happens that does not correspond to a computed
 * value having changed.
 */

const STATUS_TONE: Record<string, { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  active: { label: "ACTIVE", tone: "neutral" },
  at_risk: { label: "AT RISK", tone: "amber" },
  eliminated: { label: "ELIMINATED", tone: "red" },
  winner: { label: "WINNER", tone: "green" },
};

interface LiveEntry extends ApiArenaEntryFull {
  /** Set briefly after an event touches this row, to drive the highlight. */
  movement: "up" | "down" | null;
}

function timeRemaining(endsAt: string, now: number): string {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return "settling";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m remaining`;
  return `${minutes}m remaining`;
}

export function LiveArena({
  round,
  entries: initial,
  config,
}: {
  round: ApiArenaRoundFull;
  entries: ApiArenaEntryFull[];
  config: ApiArenaConfig;
}) {
  const [entries, setEntries] = React.useState<LiveEntry[]>(() =>
    initial.map((entry) => ({ ...entry, movement: null })),
  );
  const arenaEvents = useEvents("arena");
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // the server-rendered round is authoritative on navigation
  React.useEffect(() => {
    setEntries(initial.map((entry) => ({ ...entry, movement: null })));
  }, [initial]);

  const appliedRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const fresh = arenaEvents.filter((event) => !appliedRef.current.has(event.id));
    if (fresh.length === 0) return;
    for (const event of fresh) appliedRef.current.add(event.id);

    setEntries((current) => {
      let changed = false;
      const next = current.map((entry) => {
        // events carry the values that produced them, so the row is updated
        // from the event rather than from a refetch
        const relevant = fresh.filter((event) => event.symbol === entry.symbol);
        if (relevant.length === 0) return entry;

        changed = true;
        let hp = entry.currentHp;
        let status = entry.status;
        let movement: LiveEntry["movement"] = null;

        for (const event of relevant) {
          if (event.eventType === "ARENA_ELIMINATION") {
            status = "eliminated";
            hp = 0;
            movement = "down";
          } else if (event.eventType === "ARENA_WINNER") {
            status = "winner";
            movement = "up";
          } else if (typeof event.newValue === "number") {
            const previous = hp;
            hp = event.newValue;
            movement = hp > previous ? "up" : hp < previous ? "down" : null;
          }
        }

        return { ...entry, currentHp: hp, status, movement };
      });

      if (!changed) return current;

      // reorder by HP, then score — the same deterministic ordering the
      // backend settles on, so the live view and a refresh agree
      return [...next]
        .sort(
          (a, b) =>
            b.currentHp - a.currentHp ||
            b.currentScore - a.currentScore ||
            a.symbol.localeCompare(b.symbol),
        )
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
    });

    const timer = window.setTimeout(() => {
      setEntries((current) => current.map((entry) => ({ ...entry, movement: null })));
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [arenaEvents]);

  const active = entries.filter((entry) => entry.status !== "eliminated");
  const eliminated = entries.filter((entry) => entry.status === "eliminated");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            Season {round.season} · Round {round.roundNumber}
          </CardTitle>
          <ConnectionStatus />
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">Status</p>
              <p className="mt-1 font-mono text-[13px] text-text">
                {round.status.toUpperCase()}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                Time
              </p>
              <p className="mt-1 font-mono text-[13px] text-text">
                {round.status === "settled"
                  ? "settled"
                  : timeRemaining(round.endsAt, now)}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">Field</p>
              <p className="mt-1 font-mono text-[13px] text-text">
                {active.length} of {entries.length}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">Rules</p>
              <p className="mt-1 font-mono text-[13px] text-text">{config.version}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Standings</CardTitle>
          <span className="font-mono text-[10.5px] text-faint">
            HP from computed strength
          </span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {["#", "Asset", "HP", "Power", "Score", "Status"].map((heading, i) => (
                  <th
                    key={heading}
                    className={cn(
                      "px-4 py-2.5 text-[10.5px] uppercase tracking-[0.14em] text-faint",
                      i <= 1 ? "text-left" : "text-right",
                      heading === "Status" && "text-right",
                    )}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const meta = STATUS_TONE[entry.status] ?? STATUS_TONE.active!;
                // Scaled against the ceiling, not the starting value.
                // Against `startingHp` every entrant above 100 pins the bar
                // full and the column stops distinguishing anything.
                const hpPct = Math.max(
                  0,
                  Math.min(100, (entry.currentHp / config.maximumHp) * 100),
                );
                const MovementIcon =
                  entry.movement === "up"
                    ? TrendingUp
                    : entry.movement === "down"
                      ? TrendingDown
                      : Minus;

                return (
                  <tr
                    key={entry.assetId}
                    className={cn(
                      "border-b border-border transition-colors duration-500 last:border-b-0",
                      entry.movement === "up" && "bg-green-ink/6",
                      entry.movement === "down" && "bg-red/6",
                      entry.status === "eliminated" && "opacity-45",
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] tabular-nums text-faint">
                          {entry.status === "winner" ? (
                            <Crown className="size-3.5 text-green-ink" />
                          ) : (
                            entry.rank.toString().padStart(2, "0")
                          )}
                        </span>
                        {entry.movement ? (
                          <MovementIcon
                            className={cn(
                              "size-3",
                              entry.movement === "up" ? "text-green-ink" : "text-red",
                            )}
                          />
                        ) : null}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <Link
                        href={routes.asset(entry.symbol)}
                        className="flex min-w-0 items-center gap-2.5"
                      >
                        <AssetLogo asset={entry} size="xs" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px] font-medium text-text">
                            {entry.symbol}
                          </span>
                          {entry.name ? (
                            <span className="truncate text-[11.5px] text-muted">
                              {entry.name}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </td>

                    <td className="px-4 py-3">
                      <span className="flex items-center justify-end gap-2.5">
                        <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-surface-2 sm:block">
                          <span
                            className={cn(
                              "block h-full rounded-full transition-[width] duration-700",
                              entry.currentHp < config.atRiskHp
                                ? "bg-amber"
                                : "bg-green-ink",
                            )}
                            style={{ width: `${hpPct}%` }}
                          />
                        </span>
                        <span className="w-12 text-right font-mono text-[12.5px] tabular-nums text-text">
                          {entry.currentHp.toFixed(1)}
                        </span>
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums">
                      {entry.power === null ? (
                        <span className="text-faint" title="Coverage too thin to judge">
                          —
                        </span>
                      ) : (
                        <span className="text-muted">{entry.power.toFixed(1)}</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums text-text">
                      {entry.currentScore.toFixed(1)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {eliminated.length > 0 ? (
        <p className="text-[12px] text-faint">
          {eliminated.length} eliminated this round. Eliminations follow the
          published HP rule and are recorded permanently.
        </p>
      ) : null}
    </div>
  );
}
