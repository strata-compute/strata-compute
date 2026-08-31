import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SCORE_FACTOR_LABELS } from "@/lib/landing-data";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";
import { DataUnavailable, FreshnessBadge } from "@/components/data/data-state";
import type { DataStatus } from "@/lib/data";

/**
 * Strata Score preview.
 *
 * The five ranked rows were previously hardcoded (NVDA 94.2, BTC 91.8, ...).
 * They now come from the ranking the backend computed; when fewer than two
 * markets have been scored the section says a ranking cannot be calculated
 * rather than showing one.
 */

export interface ScorePreviewRow {
  rank: number;
  symbol: string;
  market: string;
  score: number;
}

export function ScorePreview({
  rows,
  status,
  ageSeconds,
  reason,
}: {
  rows: ScorePreviewRow[];
  status: DataStatus;
  ageSeconds: number | null;
  reason: string | null;
}) {
  const header = (
    <SectionHeader
      eyebrow="The Strata Score"
      title={
        <>
          One standard for
          <br />
          different markets.
        </>
      }
      description="Strata combines multiple market variables into a standardized measure of market strength. An 88 on an onchain pool and an 88 on a large-cap equity describe the same relative standing."
      action={
        <Button asChild variant="secondary" className="h-11 px-5 text-[14px]">
          <Link href={routes.rankings}>
            Explore Rankings
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    />
  );

  if (rows.length < 2) {
    return (
      <SectionShell id="score">
        {header}
        <div className="mt-16">
          <DataUnavailable
            title="Insufficient live data to calculate rankings"
            reason={reason}
            status={status}
          />
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell id="score">
      {header}

      <Reveal className="mt-16 border border-border bg-surface/20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            Market
          </span>
          <FreshnessBadge status={status} ageSeconds={ageSeconds} />
        </div>

        <ul>
          {rows.map((row) => (
            <li
              key={row.symbol}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border/70 px-5 py-4 last:border-b-0 sm:gap-8"
            >
              <span className="flex items-center gap-4">
                <span className="font-mono text-[12px] tabular-nums text-faint">
                  {String(row.rank).padStart(2, "0")}
                </span>
                <span className="flex w-24 flex-col">
                  <span className="text-[14.5px] font-medium tracking-tight text-text">
                    {row.symbol}
                  </span>
                  <span className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint">
                    {row.market}
                  </span>
                </span>
              </span>

              <span className="ml-auto hidden h-1 w-full max-w-[360px] overflow-hidden bg-elevated sm:block">
                <span
                  className={cn(
                    "block h-full",
                    row.rank === 1 ? "bg-green-ink/80" : "bg-muted/45",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
                />
              </span>

              <span
                className={cn(
                  "w-16 text-right font-mono text-[17px] tabular-nums",
                  row.rank === 1 ? "text-green-ink" : "text-text",
                )}
              >
                {row.score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-border px-5 py-5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            Composed from
          </span>
          <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {SCORE_FACTOR_LABELS.map((factor) => (
              <div key={factor.key}>
                <div className="h-px w-full bg-border">
                  <div
                    className="grow-bar h-px bg-muted/60"
                    style={{ ["--bar-w" as string]: "100%" }}
                  />
                </div>
                <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
                  {factor.label}
                </p>
                <p className="mt-1 text-[12px] text-faint">{factor.descriptor}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}
