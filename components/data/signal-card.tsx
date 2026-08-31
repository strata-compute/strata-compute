import * as React from "react";
import Link from "next/link";
import type { Signal, SignalTone } from "@/lib/types";
import { SIGNAL_META } from "@/lib/signal-meta";
import { cn, formatRelative } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { AssetClassTag } from "@/components/data/asset-identity";
import { AssetLogo } from "@/components/data/asset-logo";
import { PointsDelta } from "@/components/data/delta";

const toneStyles: Record<SignalTone, { tile: string; text: string; rail: string }> = {
  positive: {
    tile: "border-green-ink/25 bg-green-ink/8 text-green-ink",
    text: "text-green-ink",
    rail: "bg-green-ink",
  },
  caution: {
    tile: "border-amber/25 bg-amber/8 text-amber",
    text: "text-amber",
    rail: "bg-amber",
  },
  negative: {
    tile: "border-red/25 bg-red/8 text-red",
    text: "text-red",
    rail: "bg-red",
  },
  info: {
    tile: "border-blue/25 bg-blue/8 text-blue",
    text: "text-blue",
    rail: "bg-blue",
  },
};

export function SignalCard({
  signal,
  className,
}: {
  signal: Signal;
  className?: string;
}) {
  const meta = SIGNAL_META[signal.kind];
  const tone = toneStyles[meta.tone];

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-200 hover:border-border-strong",
        className,
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-px opacity-60", tone.rail)}
        aria-hidden
      />
      <div className="flex gap-4 p-4 pl-5">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border font-mono text-[12px]",
            tone.tile,
          )}
          aria-hidden
        >
          {meta.glyph}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Link
              href={routes.asset(signal.symbol)}
              className="flex items-center gap-1.5 text-[13.5px] font-medium text-text transition-colors hover:text-green-ink"
            >
              <AssetLogo asset={signal} size="xs" />
              {signal.symbol}
            </Link>
            <span className={cn("text-[12.5px]", tone.text)}>{meta.label}</span>
            <AssetClassTag assetClass={signal.assetClass} />
          </div>

          <p className="mt-1.5 text-[13px] leading-relaxed text-text/90">
            {signal.summary}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            {signal.detail}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-faint">
            <span className="font-mono">
              magnitude <span className="text-muted">{signal.magnitude.toFixed(1)}σ</span>
            </span>
            <span className="flex items-center gap-1.5 font-mono">
              score impact <PointsDelta value={signal.scoreImpact} suffix="" />
            </span>
            <span className="ml-auto font-mono">{formatRelative(signal.minutesAgo)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Condensed one-line variant for dashboards and side panels. */
export function SignalRow({
  signal,
  className,
}: {
  signal: Signal;
  className?: string;
}) {
  const meta = SIGNAL_META[signal.kind];
  const tone = toneStyles[meta.tone];

  return (
    <Link
      href={routes.asset(signal.symbol)}
      className={cn(
        "flex items-center gap-3 border-b border-border/70 px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2/60",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-[4px] border font-mono text-[10.5px]",
          tone.tile,
        )}
        aria-hidden
      >
        {meta.glyph}
      </span>
      <span className="w-14 shrink-0 text-[12.5px] font-medium text-text">
        {signal.symbol}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
        {signal.summary}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-faint">
        {formatRelative(signal.minutesAgo)}
      </span>
    </Link>
  );
}
