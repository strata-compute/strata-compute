"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { isWatched, onWatchlistChange, toggleWatchlist } from "@/lib/watchlist";

/**
 * Add or remove an asset from the watchlist.
 *
 * Renders the unwatched state on the server and reconciles after mount, so
 * the markup is identical for every reader and hydration never mismatches on
 * a value that only exists in one browser.
 */
export function WatchButton({
  symbol,
  size = "md",
  className,
}: {
  symbol: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [watching, setWatching] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setWatching(isWatched(symbol));
    setReady(true);
    return onWatchlistChange((symbols) => setWatching(symbols.includes(symbol.toUpperCase())));
  }, [symbol]);

  return (
    <button
      type="button"
      onClick={() => setWatching(toggleWatchlist(symbol).includes(symbol.toUpperCase()))}
      aria-pressed={watching}
      aria-label={watching ? `Stop watching ${symbol}` : `Add ${symbol} to watchlist`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-green/50",
        size === "sm" ? "h-7 px-2 text-[11.5px]" : "h-8 px-3 text-[12.5px]",
        watching
          ? "border-green-ink/40 bg-green-ink/8 text-green-ink"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
        !ready && "opacity-90",
        className,
      )}
    >
      <Star className={cn("size-3.5", watching && "fill-current")} />
      {watching ? "Watching" : "Watch"}
    </button>
  );
}
