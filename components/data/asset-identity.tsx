import * as React from "react";
import Link from "next/link";
import type { Asset, AssetClass } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AssetLogo, type AssetLogoSize } from "@/components/data/asset-logo";

/**
 * `AssetGlyph` is gone. Asset artwork is now resolved centrally and rendered
 * by `AssetLogo`, which falls back to a monogram when no provider published
 * an image. Import that instead.
 */

export const CLASS_LABEL: Record<AssetClass, string> = {
  stock: "Stock",
  crypto: "Crypto",
  onchain: "Onchain",
};

/** Renders nothing when the asset has no classification, rather than guessing one. */
export function AssetClassTag({
  assetClass,
  className,
}: {
  assetClass: AssetClass | null;
  className?: string;
}) {
  if (!assetClass) return null;
  return (
    <span
      className={cn(
        "text-[10.5px] uppercase tracking-[0.12em] text-faint",
        className,
      )}
    >
      {CLASS_LABEL[assetClass]}
    </span>
  );
}

export function AssetIdentity({
  asset,
  size = "md",
  href,
  showName = true,
  className,
}: {
  asset: Pick<Asset, "symbol" | "name" | "logoUrl">;
  size?: AssetLogoSize;
  href?: string;
  showName?: boolean;
  className?: string;
}) {
  const body = (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <AssetLogo asset={asset} size={size} />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "truncate font-medium tracking-tight text-text",
            size === "sm" ? "text-[13px]" : "text-[13.5px]",
          )}
        >
          {asset.symbol}
        </span>
        {showName ? (
          <span className="truncate text-[12px] text-muted">{asset.name}</span>
        ) : null}
      </span>
    </span>
  );

  if (!href) return body;
  return (
    <Link
      href={href}
      className="group/identity inline-flex min-w-0 rounded-sm outline-none"
    >
      {body}
    </Link>
  );
}
