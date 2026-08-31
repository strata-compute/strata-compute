import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";
import { DataUnavailable, FreshnessBadge } from "@/components/data/data-state";
import type { DataStatus } from "@/lib/data";

/**
 * Arena preview.
 *
 * The previous version rotated positions on a timer and rewrote scores to
 * justify each swap — invented market movement dressed as a live leaderboard.
 * It now renders the standings the backend actually holds, in the order it
 * returned them, with no animation touching a value.
 */

export interface ArenaPreviewEntry {
  rank: number;
  symbol: string;
  score: number;
}

export function ArenaPreview({
  entries,
  roundNumber,
  status,
  ageSeconds,
  reason,
}: {
  entries: ArenaPreviewEntry[];
  roundNumber: number | null;
  status: DataStatus;
  ageSeconds: number | null;
  reason: string | null;
}) {
  const header = (
    <SectionHeader
      eyebrow="The arena"
      title="Let performance decide."
      description="Assets compete through the same computation layer. Performance changes the ranking."
      action={
        <Button asChild variant="secondary" className="h-11 px-5 text-[14px]">
          <Link href={routes.arena}>
            Enter Arena
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    />
  );

  if (entries.length === 0) {
    return (
      <SectionShell id="arena">
        {header}
        <div className="mt-16">
          <DataUnavailable
            title="Arena is waiting for sufficient market data"
            reason={reason}
            status={status}
          />
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell id="arena">
      {header}

      <Reveal className="mt-16 border border-border bg-bg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            {roundNumber === null ? "Current round" : `Round ${roundNumber}`}
          </span>
          <FreshnessBadge status={status} ageSeconds={ageSeconds} />
        </div>

        <ul>
          {entries.map((entry) => (
            <li
              key={entry.symbol}
              className="flex items-center gap-4 border-b border-border/70 px-5 py-4 last:border-b-0"
            >
              <span className="w-8 font-mono text-[12px] tabular-nums text-faint">
                {String(entry.rank).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 text-[14px] font-medium tracking-tight text-text">
                {entry.symbol}
              </span>
              <span className="hidden h-1 w-28 overflow-hidden bg-elevated md:block">
                <span
                  className={cn(
                    "block h-full",
                    entry.rank === 1 ? "bg-green-ink" : "bg-muted/50",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, entry.score))}%` }}
                />
              </span>
              <span
                className={cn(
                  "w-16 text-right font-mono text-[15px] tabular-nums",
                  entry.rank === 1 ? "text-green-ink" : "text-text",
                )}
              >
                {entry.score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </Reveal>
    </SectionShell>
  );
}
