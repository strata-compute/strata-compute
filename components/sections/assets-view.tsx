"use client";

import * as React from "react";
import { LayoutGrid, Rows3, SearchX } from "lucide-react";
import type { Asset } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, EmptyState } from "@/components/ui/primitives";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { AssetCard } from "@/components/data/asset-card";
import { AssetTable } from "@/components/data/score-table";

type FilterId = "stock" | "crypto" | "onchain" | "movers" | "trending";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "stock", label: "Stocks" },
  { id: "crypto", label: "Crypto" },
  { id: "onchain", label: "Onchain" },
  { id: "movers", label: "Top Movers" },
  { id: "trending", label: "Trending" },
];

function matchesFilters(asset: Asset, filters: Set<FilterId>) {
  if (filters.size === 0) return true;

  const classFilters = (["stock", "crypto", "onchain"] as FilterId[]).filter((f) =>
    filters.has(f),
  );
  const classOk =
    classFilters.length === 0 || classFilters.includes(asset.assetClass as FilterId);

  const behaviourFilters = (["movers", "trending"] as FilterId[]).filter((f) =>
    filters.has(f),
  );
  const behaviourOk =
    behaviourFilters.length === 0 ||
    behaviourFilters.some((filter) =>
      filter === "movers"
        ? Math.abs(asset.change24h) >= 3
        : asset.scoreDelta24h >= 2 && (asset.breakdown.activity ?? 0) >= 60,
    );

  return classOk && behaviourOk;
}

export function AssetsView({ assets }: { assets: Asset[] }) {
  const [query, setQuery] = React.useState("");
  const [filters, setFilters] = React.useState<Set<FilterId>>(new Set());
  const [layout, setLayout] = React.useState<"grid" | "table">("grid");

  const toggle = (id: FilterId) => {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((asset) => matchesFilters(asset, filters))
      .filter(
        (asset) =>
          !q ||
          asset.symbol.toLowerCase().includes(q) ||
          asset.name.toLowerCase().includes(q) ||
          asset.sector.toLowerCase().includes(q) ||
          asset.tags.some((tag) => tag.toLowerCase().includes(q)),
      )
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [assets, filters, query]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          autoFocusKey="s"
          className="lg:w-80"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((filter) => {
            const active = filters.has(filter.id);
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => toggle(filter.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors duration-150",
                  active
                    ? "border-green-ink/35 bg-green-ink/8 text-green-ink"
                    : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
                )}
              >
                {filter.label}
              </button>
            );
          })}
          {filters.size > 0 ? (
            <button
              type="button"
              onClick={() => setFilters(new Set())}
              className="px-2 text-[12px] text-faint transition-colors hover:text-text"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <span className="font-mono text-[11.5px] text-faint">
            {results.length} / {assets.length}
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
            {(
              [
                { id: "grid" as const, icon: LayoutGrid, label: "Grid view" },
                { id: "table" as const, icon: Rows3, label: "Table view" },
              ]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLayout(option.id)}
                aria-label={option.label}
                aria-pressed={layout === option.id}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[5px] transition-colors",
                  layout === option.id
                    ? "bg-elevated text-text"
                    : "text-faint hover:text-muted",
                )}
              >
                <option.icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {results.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SearchX />}
            title="No markets match this view"
            description="Nothing in the current compute set matches that search and filter combination. Try a different ticker or clear the filters."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setFilters(new Set());
                }}
              >
                Reset view
              </Button>
            }
          />
        </Card>
      ) : layout === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {results.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <AssetTable
            assets={results}
            columns={["asset", "type", "price", "change", "trend", "volume", "score", "status"]}
          />
        </Card>
      )}
    </div>
  );
}
