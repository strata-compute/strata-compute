import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Minus } from "lucide-react";
import type { ArenaEntrant, ArenaState } from "@/lib/types";
import { cn, formatCompact } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { Badge } from "@/components/ui/primitives";
import { AssetClassTag } from "@/components/data/asset-identity";
import { AssetLogo } from "@/components/data/asset-logo";
import { PointsDelta } from "@/components/data/delta";
import { NoValue } from "@/components/data/data-state";
import { ScoreValue } from "@/components/data/score";

export const STATE_META: Record<
  ArenaState,
  { label: string; tone: "green" | "amber" | "red" | "neutral"; rail: string }
> = {
  advancing: { label: "Advancing", tone: "green", rail: "bg-green-ink" },
  holding: { label: "Holding", tone: "neutral", rail: "bg-border-strong" },
  "at-risk": { label: "At risk", tone: "amber", rail: "bg-amber" },
  eliminated: { label: "Eliminated", tone: "red", rail: "bg-red/60" },
};

function RankShift({ entrant }: { entrant: ArenaEntrant }) {
  const shift = entrant.previousRank - entrant.rank;
  if (shift === 0)
    return (
      <span className="flex items-center gap-0.5 font-mono text-[11px] text-faint">
        <Minus className="size-3" />0
      </span>
    );
  const up = shift > 0;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 font-mono text-[11px]",
        up ? "text-green-ink" : "text-red",
      )}
    >
      {up ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      {Math.abs(shift)}
    </span>
  );
}

export function ArenaCard({
  entrant,
  className,
}: {
  entrant: ArenaEntrant;
  className?: string;
}) {
  const meta = STATE_META[entrant.state];
  const eliminated = entrant.state === "eliminated";

  return (
    <Link
      href={routes.asset(entrant.symbol)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface p-4 transition-colors duration-200 hover:border-border-strong hover:bg-surface-2",
        eliminated && "opacity-55 hover:opacity-80",
        className,
      )}
    >
      <span
        className={cn("absolute inset-x-0 top-0 h-px opacity-70", meta.rail)}
        aria-hidden
      />

      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-faint">
            #{entrant.rank.toString().padStart(2, "0")}
          </span>
          <RankShift entrant={entrant} />
        </span>
        <Badge tone={meta.tone === "neutral" ? "neutral" : meta.tone}>
          {meta.label}
        </Badge>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <AssetLogo asset={entrant} size="md" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-medium tracking-tight text-text">
            {entrant.symbol}
          </span>
          <span className="truncate text-[12px] text-muted">{entrant.name}</span>
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <span className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
            Current score
          </span>
          <span className="flex items-baseline gap-2">
            <ScoreValue score={entrant.score} size="lg" />
            {entrant.roundDelta === null ? null : (
              <PointsDelta value={entrant.roundDelta} />
            )}
          </span>
        </span>
        <AssetClassTag assetClass={entrant.assetClass} />
      </div>

      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="text-faint">Momentum</span>
          {entrant.momentum === null ? (
            <NoValue />
          ) : (
            <span className="font-mono tabular-nums text-muted">
              {entrant.momentum.toFixed(1)}
            </span>
          )}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-muted/60 transition-[width] duration-700"
            style={{ width: `${entrant.momentum ?? 0}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="text-faint">Volume</span>
          {entrant.volume24h === null ? (
            <NoValue />
          ) : (
            <span className="font-mono tabular-nums text-muted">
              {formatCompact(entrant.volume24h, "$")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
