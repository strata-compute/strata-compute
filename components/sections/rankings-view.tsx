"use client";
import { RankMovementBadge } from "@/components/sections/live-rankings";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import type { Asset, AssetClass } from "@/lib/types";
import { cn, formatCompact } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { AssetTable, type ScoreColumnKey } from "@/components/data/score-table";

type ClassTab = AssetClass | "all";
type SortKey = "score" | "momentum" | "volume24h" | "activity" | "change24h";

const CLASS_TABS: { value: ClassTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stock", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
  { value: "onchain", label: "Onchain" },
];

const FILTERS: { value: SortKey; label: string; hint: string }[] = [
  { value: "score", label: "Score", hint: "Composite Strata Score, all five factors weighted." },
  { value: "momentum", label: "Momentum", hint: "Multi-window rate-of-change, volatility-normalised." },
  { value: "volume24h", label: "Volume", hint: "24h traded notional, venue-quality weighted." },
  { value: "activity", label: "Activity", hint: "Participant breadth, order count and unique wallets." },
  { value: "change24h", label: "24H Change", hint: "Raw price change over the last 24 hours." },
];

/**
 * Sort key for one asset.
 *
 * An uncomputed component sorts last rather than as zero: -1 is outside the
 * 0-100 range every component occupies, so it can never collide with a real
 * reading and be mistaken for one.
 */
function readValue(asset: Asset, key: SortKey | string): number | string {
  switch (key) {
    case "momentum":
      return asset.breakdown.momentum ?? -1;
    case "activity":
      return asset.breakdown.activity ?? -1;
    case "volume24h":
      return asset.volume24h;
    case "change24h":
      return asset.change24h;
    case "price":
      return asset.price;
    case "symbol":
      return asset.symbol;
    case "assetClass":
      return asset.assetClass;
    case "status":
      return asset.status;
    default:
      return asset.score ?? -1;
  }
}

export function RankingsView({ assets }: { assets: Asset[] }) {
  const [tab, setTab] = React.useState<ClassTab>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("score");
  const [direction, setDirection] = React.useState<"asc" | "desc">("desc");

  const counts = React.useMemo(
    () =>
      CLASS_TABS.map((option) => ({
        ...option,
        count:
          option.value === "all"
            ? assets.length
            : assets.filter((a) => a.assetClass === option.value).length,
      })),
    [assets],
  );

  const rows = React.useMemo(() => {
    const scoped =
      tab === "all" ? assets : assets.filter((a) => a.assetClass === tab);
    return [...scoped].sort((a, b) => {
      const av = readValue(a, sortKey);
      const bv = readValue(b, sortKey);
      const result =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return direction === "asc" ? result : -result;
    });
  }, [assets, tab, sortKey, direction]);

  const summary = React.useMemo(() => {
    if (!rows.length) return null;
    // only scored markets contribute to a median; an unscored one is not a
    // low score to be averaged in
    const scores = rows
      .map((r) => r.score)
      .filter((score): score is number => score !== null)
      .sort((a, b) => a - b);
    const median = scores.length > 0 ? scores[Math.floor(scores.length / 2)] : null;
    const advancing = rows.filter((r) => r.change24h > 0).length;
    const volume = rows.reduce((sum, r) => sum + r.volume24h, 0);
    return { median, advancing, volume, total: rows.length };
  }, [rows]);

  const onHeaderClick = (key: string) => {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    if (FILTERS.some((f) => f.value === key)) setSortKey(key as SortKey);
    setDirection("desc");
  };

  const columns: ScoreColumnKey[] = [
    "rank",
    "asset",
    "price",
    "change",
    "volume",
    sortKey === "activity" ? "activity" : "momentum",
    "score",
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          ariaLabel="Asset class"
          options={counts}
          value={tab}
          onValueChange={(value) => setTab(value as ClassTab)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-faint">
            <SlidersHorizontal className="size-3.5" />
            Rank by
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((filter) => {
              const active = filter.value === sortKey;
              return (
                <Tooltip key={filter.value} content={filter.hint}>
                  <button
                    type="button"
                    onClick={() => {
                      setSortKey(filter.value);
                      setDirection("desc");
                    }}
                    aria-pressed={active}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[12px] transition-colors duration-150",
                      active
                        ? "border-green-ink/35 bg-green-ink/8 text-green-ink"
                        : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
                    )}
                  >
                    {filter.label}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>

      {/* The score is a percentile within an asset's own class, so a combined
          ranking places three different measurements side by side. Saying so
          is the difference between a comparison and an implied equivalence. */}
      <p className="text-[11.5px] leading-relaxed text-faint">
        Scores are computed within each asset class — a stock against stocks,
        crypto against crypto. Ranking them together compares standing, not
        absolute strength, and a market measured on fewer components carries
        lower confidence.
      </p>

      {summary ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          {[
            { label: "Markets", value: summary.total.toString() },
            {
              label: "Median score",
              value: summary.median === null ? "—" : summary.median.toFixed(1),
            },
            {
              label: "Advancing",
              value: `${summary.advancing}/${summary.total}`,
            },
            { label: "Volume", value: formatCompact(summary.volume, "$") },
          ].map((item) => (
            <div key={item.label} className="bg-surface px-4 py-3">
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                {item.label}
              </p>
              <p className="mt-1 font-mono text-[15px] tabular-nums text-text">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {rows.length ? (
          <AssetTable
            assets={rows}
            columns={columns}
            onHeaderClick={onHeaderClick}
            sortState={{ key: sortKey, direction }}
          />
        ) : (
          <EmptyState
            title="No markets in this class"
            description="Nothing has cleared the coverage floor for this asset class yet."
          />
        )}
      </Card>
    </div>
  );
}
