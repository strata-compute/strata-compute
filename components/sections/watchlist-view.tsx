"use client";

import * as React from "react";
import Link from "next/link";
import { Star, X } from "lucide-react";
import { routes } from "@/lib/routes";
import { cn, formatCompact, formatPrice } from "@/lib/utils";
import {
  onWatchlistChange,
  readWatchlist,
  removeFromWatchlist,
} from "@/lib/watchlist";
import { AssetLogo } from "@/components/data/asset-logo";
import { Delta } from "@/components/data/delta";
import { ScoreValue } from "@/components/data/score";
import { Card, CardBody, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge } from "@/components/data/intelligence";
import { useStream } from "@/components/realtime/stream-provider";

/**
 * THE WATCHLIST
 *
 * Rows are fetched for the symbols held in this browser and refreshed when
 * the live stream reports a change touching one of them. It does not poll:
 * an event says which asset moved, and only then is anything refetched.
 *
 * A symbol the backend cannot resolve is shown as unavailable with its name
 * intact rather than dropped. Silently removing it would hide the fact that
 * something the reader chose to track is no longer covered.
 */

interface WatchRow {
  symbol: string;
  available: boolean;
  reason?: string;
  data?: {
    asset: { symbol: string; name: string; logoUrl: string | null; assetType: string };
    price: number | null;
    priceChange24h: number | null;
    score: number | null;
    scoreStatus: "OK" | "INSUFFICIENT_DATA" | null;
    confidence: {
      value: number;
      band: "HIGH" | "MEDIUM" | "LOW";
      completeness: number;
      freshness: number;
      historicalDepth: number;
      componentsAvailable: number;
      componentsTotal: number;
    } | null;
    rank: number | null;
    engines: {
      trend: { state: string | null };
      momentum: { score: number | null; direction: string | null };
    } | null;
    signals: { signalType: string; severity: string; summary: unknown }[];
    updatedAt: string | null;
  };
}

const TREND_LABEL: Record<string, string> = {
  STRONG_UPTREND: "Strong uptrend",
  UPTREND: "Uptrend",
  NEUTRAL: "Neutral",
  DOWNTREND: "Downtrend",
  STRONG_DOWNTREND: "Strong downtrend",
};

export function WatchlistView() {
  const [symbols, setSymbols] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<WatchRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(false);
  const { events, state } = useStream();

  React.useEffect(() => {
    setSymbols(readWatchlist());
    setReady(true);
    return onWatchlistChange(setSymbols);
  }, []);

  const load = React.useCallback(async (list: string[]) => {
    if (list.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/strata/watch?symbols=${encodeURIComponent(list.join(","))}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as { rows: WatchRow[] };
      setRows(body.rows ?? []);
    } catch {
      // the connection failed; the rows that were showing stay, and the
      // stream indicator reports the loss rather than the table inventing one
      setRows((current) => current);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    void load(symbols);
  }, [ready, symbols, load]);

  // Refresh only when an event actually touches a watched symbol. Polling
  // would ask the same question sixty times a minute to learn nothing.
  const watched = React.useMemo(() => new Set(symbols), [symbols]);
  const relevantCount = React.useMemo(
    () => events.filter((event) => event.symbol && watched.has(event.symbol)).length,
    [events, watched],
  );

  React.useEffect(() => {
    if (!ready || relevantCount === 0 || symbols.length === 0) return;
    void load(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantCount]);

  if (!ready) {
    return (
      <Card>
        <CardBody>
          <p className="py-6 text-center text-[12.5px] text-muted">Loading watchlist…</p>
        </CardBody>
      </Card>
    );
  }

  if (symbols.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Star />}
          title="Nothing on your watchlist yet"
          description="Open any market and use Watch to track its score, rank and signals here. The list is stored in this browser."
          action={
            <Button asChild variant="primary" size="sm">
              <Link href={routes.assets}>Browse markets</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          {symbols.length} market{symbols.length === 1 ? "" : "s"} tracked
          {state === "live" ? " · updating live" : ""}
        </p>
        {loading ? (
          <span className="font-mono text-[11px] text-faint">refreshing…</span>
        ) : null}
      </div>

      <div className="grid gap-3">
        {rows.map((row) => {
          if (!row.available || !row.data) {
            return (
              <Card key={row.symbol}>
                <CardBody className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <AssetLogo asset={{ symbol: row.symbol }} size="sm" />
                    <div>
                      <p className="text-[13.5px] font-medium text-text">{row.symbol}</p>
                      <p className="text-[12px] text-faint">
                        {row.reason ?? "not available"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromWatchlist(row.symbol)}
                    className="flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:text-text"
                    aria-label={`Remove ${row.symbol} from watchlist`}
                  >
                    <X className="size-3.5" />
                  </button>
                </CardBody>
              </Card>
            );
          }

          const d = row.data;
          const trend = d.engines?.trend.state ?? null;
          const signal = d.signals[0];

          return (
            <Card key={row.symbol}>
              <CardBody className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto] sm:items-center">
                <Link
                  href={routes.asset(d.asset.symbol)}
                  className="flex min-w-0 items-center gap-3"
                >
                  <AssetLogo asset={d.asset} size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13.5px] font-medium text-text">
                      {d.asset.symbol}
                    </span>
                    <span className="truncate text-[12px] text-muted">{d.asset.name}</span>
                  </span>
                </Link>

                <div>
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                    Price
                  </p>
                  <p className="mt-1 font-mono text-[13px] tabular-nums text-text">
                    {d.price === null ? "—" : formatPrice(d.price)}
                  </p>
                  {d.priceChange24h !== null ? (
                    <Delta value={d.priceChange24h} className="mt-0.5 text-[11.5px]" />
                  ) : null}
                </div>

                <div>
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                    Strata Score
                  </p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <ScoreValue score={d.score} />
                    {d.rank !== null ? (
                      <span className="font-mono text-[11.5px] text-faint">#{d.rank}</span>
                    ) : null}
                  </div>
                  {d.confidence ? (
                    <ConfidenceBadge confidence={d.confidence} className="mt-1" />
                  ) : null}
                </div>

                <div className="min-w-0">
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                    State
                  </p>
                  <p className="mt-1 text-[12.5px] text-text">
                    {trend ? TREND_LABEL[trend] : "—"}
                  </p>
                  {signal ? (
                    <p className="mt-0.5 truncate text-[11.5px] text-muted">
                      {String(signal.summary ?? signal.signalType.replace(/_/g, " ").toLowerCase())}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => removeFromWatchlist(row.symbol)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-faint",
                    "transition-colors hover:text-text",
                  )}
                  aria-label={`Remove ${row.symbol} from watchlist`}
                >
                  <X className="size-3.5" />
                </button>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
