import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Asset } from "@/lib/types";
import { cn, formatCompact } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { AssetClassTag } from "@/components/data/asset-identity";
import { AssetLogo } from "@/components/data/asset-logo";
import { Delta } from "@/components/data/delta";
import { Quote } from "@/components/data/quote";
import { NoValue } from "@/components/data/data-state";
import { ScoreValue, StatusPill } from "@/components/data/score";

export function AssetCard({
  asset,
  className,
}: {
  asset: Asset;
  className?: string;
}) {
  return (
    <Link
      href={routes.asset(asset.symbol)}
      className={cn(
        "group relative flex flex-col rounded-lg border border-border bg-surface p-4 transition-colors duration-200 hover:border-border-strong hover:bg-surface-2",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AssetLogo asset={asset} size="md" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium tracking-tight text-text">
              {asset.symbol}
            </p>
            <p className="truncate text-[12px] text-muted">{asset.name}</p>
          </div>
        </div>
        <ArrowUpRight className="size-3.5 shrink-0 text-border-strong transition-colors group-hover:text-green-ink" />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <Quote price={asset.price || null} className="text-[17px]" />
          <div className="mt-1">
            {asset.change24h === null || asset.change24h === undefined ? (
              <NoValue hint="No 24h change reported by the provider" />
            ) : (
              <Delta value={asset.change24h} />
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
            Score
          </span>
          <ScoreValue score={asset.score} />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11.5px] text-faint sm:block">
            {formatCompact(asset.volume24h, "$")}
          </span>
          <AssetClassTag assetClass={asset.assetClass} />
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <StatusPill status={asset.status} />
        <span className="h-1 w-16 overflow-hidden rounded-full bg-elevated">
          <span
            className="block h-full rounded-full bg-muted/55"
            style={{ width: `${asset.score}%` }}
          />
        </span>
      </div>
    </Link>
  );
}

export function AssetCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <div className="size-9 animate-shimmer rounded-md bg-surface-2" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 w-16 animate-shimmer rounded-[3px] bg-surface-2" />
          <div className="h-2 w-28 animate-shimmer rounded-[3px] bg-surface-2/70" />
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-3.5 w-24 animate-shimmer rounded-[3px] bg-surface-2" />
          <div className="h-2.5 w-14 animate-shimmer rounded-[3px] bg-surface-2/70" />
        </div>
        <div className="h-8 w-24 animate-shimmer rounded-[3px] bg-surface-2/60" />
      </div>
      <div className="mt-5 h-2.5 w-full animate-shimmer rounded-[3px] bg-surface-2/50" />
    </div>
  );
}
