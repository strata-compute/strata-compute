import * as React from "react";
import type { ComputeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/primitives";

/**
 * Score colour policy — green is reserved for genuinely strong readings so
 * the accent stays meaningful across a dense table.
 */
export function scoreTone(score: number) {
  if (score >= 85) return "high" as const;
  if (score >= 70) return "mid" as const;
  if (score >= 50) return "low" as const;
  return "weak" as const;
}

const scoreTextClass = {
  high: "text-green-ink",
  mid: "text-text",
  low: "text-muted",
  weak: "text-faint",
};

/**
 * Rails and bars stay neutral by default. Green is reserved for the very top
 * of the distribution so the accent keeps meaning in a dense table.
 */
const scoreFillClass = {
  high: "bg-muted/70",
  mid: "bg-muted/55",
  low: "bg-muted/40",
  weak: "bg-faint/40",
};

/**
 * A null score is rendered as an em dash, not as zero.
 *
 * Zero is a position on the scale; absence is not on the scale at all. Drawing
 * one as the other is the single most misleading thing this component could
 * do, so the null case is handled before anything else.
 */
export function ScoreValue({
  score,
  size = "md",
  className,
}: {
  score: number | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  if (score === null) {
    return (
      <span
        className={cn(
          "font-mono tabular-nums text-faint",
          size === "sm" && "text-[12.5px]",
          size === "md" && "text-[14px]",
          size === "lg" && "text-[20px]",
          size === "xl" && "text-[44px] tracking-[-0.03em] leading-none font-semibold",
          className,
        )}
        title="Not computed"
      >
        —
      </span>
    );
  }

  const tone = scoreTone(score);
  return (
    <span
      className={cn(
        "font-mono font-medium tabular-nums",
        scoreTextClass[tone],
        size === "sm" && "text-[12.5px]",
        size === "md" && "text-[14px]",
        size === "lg" && "text-[20px]",
        size === "xl" && "text-[44px] tracking-[-0.03em] leading-none font-semibold",
        className,
      )}
    >
      {score.toFixed(1)}
    </span>
  );
}

/** Compact score + rail, used inside dense tables. */
export function ScoreCell({
  score,
  width = 44,
  className,
}: {
  score: number | null;
  width?: number;
  className?: string;
}) {
  // an uncomputed score gets no rail: there is no position to draw
  if (score === null) {
    return (
      <span className={cn("flex items-center justify-end gap-2.5", className)}>
        <ScoreValue score={null} />
      </span>
    );
  }

  const tone = scoreTone(score);
  const leading = score >= 90;
  return (
    <span className={cn("flex items-center justify-end gap-2.5", className)}>
      <span
        className="hidden h-1 overflow-hidden rounded-full bg-elevated sm:block"
        style={{ width }}
      >
        <span
          className={cn(
            "block h-full rounded-full",
            leading ? "bg-green-ink" : scoreFillClass[tone],
          )}
          style={{ width: `${score}%` }}
        />
      </span>
      <ScoreValue score={score} />
    </span>
  );
}

/** Labelled factor bar used on the asset detail panel. */
export function ScoreBar({
  label,
  value,
  weight,
  className,
}: {
  label: string;
  value: number | null;
  weight?: number;
  className?: string;
}) {
  // A component the engine could not compute is drawn as absent, not as a
  // zero-length bar — an empty bar asserts a measured zero.
  if (value === null) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <span className="w-32 shrink-0 text-[12.5px] text-faint">{label}</span>
        <span className="min-w-0 flex-1 text-[11.5px] text-faint">Not computed</span>
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-faint">—</span>
      </div>
    );
  }

  const tone = scoreTone(value);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-muted">{label}</span>
        <span className="flex items-baseline gap-2">
          {weight !== undefined ? (
            <span className="font-mono text-[10.5px] text-faint">
              {(weight * 100).toFixed(0)}%
            </span>
          ) : null}
          <span
            className={cn(
              "font-mono text-[12.5px] tabular-nums",
              scoreTextClass[tone],
            )}
          >
            {value.toFixed(1)}
          </span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-elevated">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            scoreFillClass[tone],
          )}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ status pill */

const STATUS_META: Record<
  ComputeStatus,
  { label: string; tone: "green" | "amber" | "blue" | "muted" | "red"; text: string }
> = {
  live: { label: "Live", tone: "green", text: "text-green-ink" },
  computing: { label: "Computing", tone: "blue", text: "text-blue" },
  elevated: { label: "Elevated", tone: "amber", text: "text-amber" },
  cooling: { label: "Cooling", tone: "muted", text: "text-muted" },
  stale: { label: "Stale", tone: "muted", text: "text-faint" },
};

export function StatusPill({
  status,
  className,
}: {
  status: ComputeStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11.5px] tracking-tight",
        meta.text,
        className,
      )}
    >
      <StatusDot tone={meta.tone} pulse={status === "live" || status === "computing"} />
      {meta.label}
    </span>
  );
}
