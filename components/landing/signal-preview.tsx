import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import { Button } from "@/components/ui/button";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";
import { DataUnavailable, formatAge } from "@/components/data/data-state";
import type { DataStatus } from "@/lib/data";

/**
 * Signal preview.
 *
 * The four example signals shown here were fabricated events attributed to
 * real tickers ("NVDA momentum spike +18.4%"). They are gone: this section
 * renders only signals the backend detectors actually emitted.
 */

export interface SignalPreviewRow {
  kind: string;
  symbol: string;
  logoUrl: string | null;
  value: number;
  ageSeconds: number | null;
}

const RAIL: Record<string, string> = {
  MOMENTUM_SPIKE: "bg-green-ink",
  VOLUME_ACCELERATION: "bg-green-ink",
  PRICE_BREAKOUT: "bg-green-ink",
  UNUSUAL_ACTIVITY: "bg-amber",
  LIQUIDITY_SHIFT: "bg-red",
  RANK_CHANGE: "bg-blue",
};

const LABEL: Record<string, string> = {
  MOMENTUM_SPIKE: "text-green-ink",
  VOLUME_ACCELERATION: "text-green-ink",
  PRICE_BREAKOUT: "text-green-ink",
  UNUSUAL_ACTIVITY: "text-amber",
  LIQUIDITY_SHIFT: "text-red",
  RANK_CHANGE: "text-blue",
};

export function SignalPreview({
  signals,
  status,
  reason,
}: {
  signals: SignalPreviewRow[];
  status: DataStatus;
  reason: string | null;
}) {
  const header = (
    <SectionHeader
      eyebrow="Signals"
      title={
        <>
          When the market moves,
          <br />
          Strata notices.
        </>
      }
      description="A signal is emitted the moment a computed factor breaks its own baseline â never on a fixed price threshold."
      action={
        <Button asChild variant="secondary" className="h-11 px-5 text-[14px]">
          <Link href={routes.signals}>
            Explore Signals
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    />
  );

  if (signals.length === 0) {
    return (
      <SectionShell id="signals">
        {header}
        <div className="mt-16">
          <DataUnavailable
            title="No active signals detected"
            reason={reason}
            status={status}
          />
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell id="signals">
      {header}
      <div className="mt-16 grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {signals.map((signal, i) => (
          <Reveal
            key={`${signal.symbol}-${signal.kind}-${i}`}
            delay={i * 80}
            className="relative bg-bg p-5"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-px opacity-70",
                RAIL[signal.kind] ?? "bg-muted",
              )}
              aria-hidden
            />
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.16em]",
                  LABEL[signal.kind] ?? "text-muted",
                )}
              >
                {signal.kind.replace(/_/g, " ")}
              </span>
              <span className="font-mono text-[10.5px] text-faint">
                {formatAge(signal.ageSeconds) ?? "â"}
              </span>
            </div>

            <div className="mt-6 flex items-center gap-2.5">
              <AssetLogo
                asset={{ symbol: signal.symbol, logoUrl: signal.logoUrl }}
                size="sm"
              />
              <p className="text-[20px] font-medium tracking-tight text-text">
                {signal.symbol}
              </p>
            </div>
            <p className="mt-1 font-mono text-[15px] tabular-nums text-muted">
              {signal.value.toFixed(2)}
            </p>
            <p className="mt-6 border-t border-border pt-4 font-mono text-[11px] text-faint">
              Detected by Strata
            </p>
          </Reveal>
        ))}
      </div>
    </SectionShell>
  );
}
