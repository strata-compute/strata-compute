import * as React from "react";
import { cn } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";

/**
 * Continuous market strip.
 *
 * This previously scrolled a hardcoded list of tickers and percentages. Those
 * were invented, so they are gone: the strip now renders only quotes the
 * backend returned, and says it is waiting when there are none.
 */

export interface TickerQuote {
  symbol: string;
  name?: string | null;
  logoUrl?: string | null;
  change: number | null;
}

function TickerRow({ quotes, copy }: { quotes: TickerQuote[]; copy: number }) {
  return (
    <div className="flex items-center" aria-hidden={copy === 1}>
      {quotes.map((quote) => (
        <span
          key={`${copy}-${quote.symbol}`}
          className="flex shrink-0 items-center gap-2.5 px-5"
        >
          <AssetLogo asset={quote} size="xs" />
          <span className="font-mono text-[13px] tracking-tight text-text">
            {quote.symbol}
          </span>
          {quote.change === null ? (
            <span className="font-mono text-[13px] text-faint">—</span>
          ) : (
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums",
                quote.change >= 0 ? "text-green-ink" : "text-red",
              )}
            >
              {quote.change > 0 ? "+" : ""}
              {quote.change.toFixed(2)}%
            </span>
          )}
          <span className="h-3 w-px bg-border" aria-hidden />
        </span>
      ))}
    </div>
  );
}

export function MarketTicker({
  quotes,
  status,
}: {
  quotes: TickerQuote[];
  status: "live" | "delayed" | "stale" | "unavailable" | "error";
}) {
  const hasData = quotes.length > 0 && status !== "unavailable" && status !== "error";

  if (!hasData) {
    return (
      <div className="border-y border-border bg-surface/40">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3 px-5 py-3.5 sm:px-8">
          <span className="size-1.5 rounded-full bg-faint" aria-hidden />
          <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-faint">
            Awaiting live market data
          </span>
        </div>
      </div>
    );
  }

  const label = status === "live" ? "Live" : status === "delayed" ? "Delayed" : "Stale";
  const tone = status === "live" ? "text-green-ink" : "text-amber";

  return (
    <div className="group relative overflow-hidden border-y border-border bg-surface/40">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center gap-2 bg-bg pl-5 pr-6 sm:pl-8">
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "live" ? "animate-live-pulse bg-green-ink" : "bg-amber",
          )}
          aria-hidden
        />
        <span
          className={cn("font-mono text-[10px] uppercase tracking-[0.22em]", tone)}
        >
          {label}
        </span>
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 left-[92px] z-10 w-16 bg-gradient-to-r from-bg to-transparent sm:left-[124px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg to-transparent"
        aria-hidden
      />

      <div className="flex w-max animate-ticker-fast items-center py-3.5 group-hover:[animation-play-state:paused]">
        <TickerRow quotes={quotes} copy={0} />
        <TickerRow quotes={quotes} copy={1} />
      </div>
    </div>
  );
}
