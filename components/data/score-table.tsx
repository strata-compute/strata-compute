import * as React from "react";
import Link from "next/link";
import type { Asset } from "@/lib/types";
import { cn, formatCompact } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { Column, DataTable } from "@/components/data/data-table";
import { AssetClassTag, AssetIdentity } from "@/components/data/asset-identity";
import { RankMovementBadge } from "@/components/sections/live-rankings";
import { Delta } from "@/components/data/delta";
import { Quote } from "@/components/data/quote";
import { NoValue } from "@/components/data/data-state";
import { ScoreCell, StatusPill } from "@/components/data/score";
import { Sparkline } from "@/components/charts/sparkline";

export type ScoreColumnKey =
  | "rank"
  | "asset"
  | "type"
  | "price"
  | "change"
  | "trend"
  | "volume"
  | "momentum"
  | "activity"
  | "score"
  | "status";

/** Column library — pages pick the set they need instead of redefining cells. */
export function buildAssetColumns(keys: ScoreColumnKey[]): Column<Asset>[] {
  const library: Record<ScoreColumnKey, Column<Asset>> = {
    rank: {
      key: "rank",
      header: "#",
      width: "w-12",
      sortKey: "rank",
      cell: (asset, index) => (
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] tabular-nums text-faint">
            {(index + 1).toString().padStart(2, "0")}
          </span>
          {/* reports movement since the page loaded; the order itself is not
              re-sorted under the reader mid-scan */}
          <RankMovementBadge symbol={asset.symbol} />
        </span>
      ),
    },
    asset: {
      key: "asset",
      header: "Asset",
      sortKey: "symbol",
      cell: (asset) => (
        <Link
          href={routes.asset(asset.symbol)}
          className="flex min-w-0 items-center rounded-sm after:absolute after:inset-0 after:content-['']"
        >
          <AssetIdentity asset={asset} />
        </Link>
      ),
    },
    type: {
      key: "type",
      header: "Type",
      width: "w-24",
      hideBelow: "md",
      sortKey: "assetClass",
      cell: (asset) => <AssetClassTag assetClass={asset.assetClass} />,
    },
    price: {
      key: "price",
      header: "Price",
      align: "right",
      width: "w-28",
      sortKey: "price",
      cell: (asset) => <Quote price={asset.price || null} className="text-[13px]" />,
    },
    change: {
      key: "change",
      header: "24H",
      align: "right",
      width: "w-28",
      sortKey: "change24h",
      cell: (asset) =>
        asset.change24h === null || asset.change24h === undefined ? (
          <span className="flex justify-end">
            <NoValue hint="No 24h change reported by the provider" />
          </span>
        ) : (
          <span className="flex justify-end">
            <Delta value={asset.change24h} />
          </span>
        ),
    },
    /**
     * The trend column previously drew a generated price walk. Intraday
     * history is not yet served by the API, so it renders nothing rather
     * than a shape that looks like price action but is not.
     */
    trend: {
      key: "trend",
      header: "Trend",
      align: "right",
      width: "w-28",
      hideBelow: "lg",
      cell: () => (
        <span className="flex justify-end">
          <NoValue hint="Intraday history is not available yet" />
        </span>
      ),
    },
    volume: {
      key: "volume",
      header: "Volume",
      align: "right",
      width: "w-28",
      hideBelow: "lg",
      sortKey: "volume24h",
      cell: (asset) => (
        <span className="font-mono text-[12.5px] tabular-nums text-muted">
          {formatCompact(asset.volume24h, "$")}
        </span>
      ),
    },
    momentum: {
      key: "momentum",
      header: "Momentum",
      align: "right",
      width: "w-28",
      hideBelow: "xl",
      sortKey: "momentum",
      cell: (asset) => (
        <span className="flex items-center justify-end gap-2">
          <span className="h-1 w-10 overflow-hidden rounded-full bg-elevated">
            <span
              className={cn(
                "block h-full rounded-full",
                asset.momentum !== null && asset.momentum >= 70
                  ? "bg-muted"
                  : "bg-faint/70",
              )}
              style={{ width: `${asset.momentum ?? 0}%` }}
            />
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-muted">
            {asset.momentum === null ? "—" : asset.momentum.toFixed(0)}
          </span>
        </span>
      ),
    },
    activity: {
      key: "activity",
      header: "Activity",
      align: "right",
      width: "w-28",
      hideBelow: "xl",
      sortKey: "activity",
      cell: (asset) => (
        <span className="flex items-center justify-end gap-2">
          <span className="h-1 w-10 overflow-hidden rounded-full bg-elevated">
            <span
              className={cn(
                "block h-full rounded-full",
                asset.breakdown.activity !== null && asset.breakdown.activity >= 70
                  ? "bg-muted"
                  : "bg-faint/70",
              )}
              style={{ width: `${asset.breakdown.activity ?? 0}%` }}
            />
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-muted">
            {asset.breakdown.activity === null ? "—" : asset.breakdown.activity.toFixed(0)}
          </span>
        </span>
      ),
    },
    score: {
      key: "score",
      header: "Strata Score",
      align: "right",
      width: "w-36",
      sortKey: "score",
      cell: (asset) => <ScoreCell score={asset.score} />,
    },
    status: {
      key: "status",
      header: "Status",
      width: "w-28",
      hideBelow: "sm",
      sortKey: "status",
      cell: (asset) => (
        <span className="flex justify-start">
          <StatusPill status={asset.status} />
        </span>
      ),
    },
  };

  return keys.map((key) => library[key]);
}

export function AssetTable({
  assets,
  columns = ["asset", "type", "price", "change", "score", "status"],
  dense,
  className,
  onHeaderClick,
  sortState,
}: {
  assets: Asset[];
  columns?: ScoreColumnKey[];
  dense?: boolean;
  className?: string;
  onHeaderClick?: (sortKey: string) => void;
  sortState?: { key: string; direction: "asc" | "desc" };
}) {
  return (
    <DataTable
      columns={buildAssetColumns(columns)}
      rows={assets}
      getRowKey={(asset) => asset.id}
      dense={dense}
      className={className}
      onHeaderClick={onHeaderClick}
      sortState={sortState}
    />
  );
}
