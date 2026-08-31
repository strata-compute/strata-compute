import * as React from "react";
import { HERO_MODULES } from "@/lib/landing-data";
import { cn } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import type { DataStatus } from "@/lib/data";

/**
 * The computation engine, drawn as a schematic.
 *
 * The diagram itself is conceptual — it shows the shape of the pipeline. The
 * *values* in it are not: the input rows and the composite are whatever the
 * backend returned. When there is nothing to show it renders em dashes and
 * says it is awaiting data, rather than animating an invented score as the
 * previous version did.
 */

export interface EngineInput {
  symbol: string;
  name?: string | null;
  logoUrl?: string | null;
  change: number | null;
}

function StageLabel({ label, meta }: { label: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 pb-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-faint">
        {label}
      </span>
      {meta ? (
        <span className="font-mono text-[10px] tracking-[0.12em] text-faint">{meta}</span>
      ) : null}
    </div>
  );
}

function Conduit({ lanes = 3 }: { lanes?: number }) {
  return (
    <div className="flex items-stretch justify-center gap-8 py-0.5" aria-hidden>
      {Array.from({ length: lanes }).map((_, i) => (
        <span key={i} className="relative block h-7 w-px overflow-hidden bg-border">
          <span
            className="absolute inset-0 animate-flow"
            style={{
              ["--flow-x" as string]: "0%",
              ["--flow-y" as string]: "100%",
              animationDelay: `${i * 0.42}s`,
            }}
          >
            <span className="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-green-ink" />
          </span>
        </span>
      ))}
    </div>
  );
}

export function HeroEngine({
  inputs,
  score,
  status,
  className,
}: {
  inputs: EngineInput[];
  /** Highest computed score, or null when nothing has been scored. */
  score: number | null;
  status: DataStatus;
  className?: string;
}) {
  const hasInputs = inputs.length > 0;
  const live = status === "live";

  return (
    <div className={cn("relative", className)}>
      <div
        className="pointer-events-none absolute -inset-x-6 -inset-y-8 grid-lines opacity-40"
        aria-hidden
      />
      <div className="relative">
        {/* ---------------------------------------------------- input */}
        <div className="border-y border-border py-3.5">
          <StageLabel
            label="Market input"
            meta={hasInputs ? `${inputs.length} feeds` : "awaiting data"}
          />
          {hasInputs ? (
            <ul className="space-y-px">
              {inputs.map((quote) => (
                <li
                  key={quote.symbol}
                  className="flex items-center justify-between gap-4 px-2 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <AssetLogo asset={quote} size="xs" />
                    <span className="font-mono text-[13px] tracking-tight text-text">
                      {quote.symbol}
                    </span>
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
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 font-mono text-[12px] text-faint">
              No live market data
            </p>
          )}
        </div>

        <Conduit />

        {/* ------------------------------------------------ computing */}
        <div className="border-y border-border py-3.5">
          <StageLabel
            label="Computing"
            meta={
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1 rounded-full",
                    live ? "animate-live-pulse bg-green-ink" : "bg-faint",
                  )}
                />
                {live ? "running" : "idle"}
              </span>
            }
          />
          <ul className="space-y-2.5 pt-0.5">
            {HERO_MODULES.map((module, i) => (
              <li key={module} className="flex items-center gap-3 px-2">
                <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  {module}
                </span>
                <span className="relative h-px flex-1 bg-border">
                  {live ? (
                    <span
                      className="absolute inset-y-0 left-0 w-full origin-left animate-scan bg-green-ink/70"
                      style={{ animationDelay: `${i * 0.35}s` }}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Conduit lanes={1} />

        {/* -------------------------------------------------- output */}
        <div className="border-y border-border py-3.5">
          <StageLabel label="Strata score" meta="0 – 100" />
          <div className="flex items-end justify-between gap-6 px-2">
            {score === null ? (
              <span className="flex flex-col gap-1">
                <span className="font-mono text-[52px] font-semibold leading-none text-faint">
                  —
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                  Awaiting computation
                </span>
              </span>
            ) : (
              <span className="font-mono text-[52px] font-semibold leading-none tracking-[-0.04em] text-green-ink">
                {score.toFixed(1)}
              </span>
            )}
            <span className="pb-1.5 text-right">
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                composite
              </span>
              <span className="mt-1 block font-mono text-[11.5px] text-muted">
                Strata Compute
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
