"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvents } from "@/components/realtime/stream-provider";

/**
 * LIVE RANKING MOVEMENT
 *
 * A thin overlay on the existing rankings table rather than a replacement for
 * it. The table stays exactly as it was; this reports, beside a row, that its
 * position changed and by how much.
 *
 * Deliberately not a re-sort. Reordering rows under a reader's cursor while
 * they are reading is hostile, and a table that rearranges itself every
 * minute cannot be scanned. The movement is announced, the new position is
 * shown, and the order settles on the next navigation — which is also when
 * the server-rendered order is authoritative again.
 */

export interface RankMovement {
  symbol: string;
  from: number;
  to: number;
  change: number;
}

/** Rank movements observed since the page was rendered, newest per symbol. */
export function useRankMovements(): Map<string, RankMovement> {
  const events = useEvents("market");

  return React.useMemo(() => {
    const movements = new Map<string, RankMovement>();
    // events arrive newest first, so the first entry per symbol wins
    for (const event of events) {
      if (event.eventType !== "RANK_CHANGED" || !event.symbol) continue;
      if (movements.has(event.symbol)) continue;
      if (typeof event.previousValue !== "number" || typeof event.newValue !== "number") {
        continue;
      }
      movements.set(event.symbol, {
        symbol: event.symbol,
        from: event.previousValue,
        to: event.newValue,
        change: event.change ?? event.previousValue - event.newValue,
      });
    }
    return movements;
  }, [events]);
}

export function RankMovementBadge({
  symbol,
  className,
}: {
  symbol: string;
  className?: string;
}) {
  const movements = useRankMovements();
  const movement = movements.get(symbol);
  if (!movement || movement.change === 0) return null;

  const up = movement.change > 0;
  const Icon = up ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[10.5px] tabular-nums animate-rise",
        up ? "text-green-ink" : "text-red",
        className,
      )}
      title={`#${movement.from} → #${movement.to}`}
    >
      <Icon className="size-2.5" />
      {Math.abs(movement.change)}
    </span>
  );
}

/**
 * A banner summarising movement since the page loaded, with the option to
 * take the new order. Refreshing is the reader's choice, not something that
 * happens under them mid-scan.
 */
export function RankingsLiveBanner({
  onRefresh,
  className,
}: {
  onRefresh?: () => void;
  className?: string;
}) {
  const movements = useRankMovements();
  const count = movements.size;
  if (count === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface px-4 py-2.5",
        className,
      )}
    >
      <span className="size-1.5 animate-live-pulse rounded-full bg-green-ink" aria-hidden />
      <span className="text-[12.5px] text-text">
        {count} market{count === 1 ? "" : "s"} changed position since this page
        loaded
      </span>
      <span className="flex flex-wrap gap-x-2.5 gap-y-1">
        {[...movements.values()].slice(0, 6).map((movement) => (
          <span
            key={movement.symbol}
            className="font-mono text-[11.5px] text-muted"
            title={`#${movement.from} → #${movement.to}`}
          >
            {movement.symbol}{" "}
            <span className={movement.change > 0 ? "text-green-ink" : "text-red"}>
              {movement.change > 0 ? "↑" : "↓"}
              {Math.abs(movement.change)}
            </span>
          </span>
        ))}
      </span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto font-mono text-[11.5px] text-muted underline-offset-2 transition-colors hover:text-text hover:underline"
        >
          Take new order
        </button>
      ) : null}
    </div>
  );
}
