import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type {
  ApiComputeExplanation,
  ApiConfidenceBand,
  ApiEngineOutputs,
  ApiScoreConfidence,
  ApiScoreComponent,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

/**
 * THE INTELLIGENCE VOCABULARY
 *
 * The presentation half of the computation contract. Two rules run through
 * every component here.
 *
 * A value the engine could not compute is rendered as absent, with the
 * engine's own reason attached — never as a zero-length bar, an empty ring or
 * a dash that could be mistaken for a measured nothing. The distinction the
 * backend works to preserve is worth nothing if the interface flattens it.
 *
 * And confidence is drawn beside the score, never blended into it. A high
 * score computed from thin data stays high and says so; discounting it into a
 * mediocre number would hide both facts at once.
 */

/* ---------------------------------------------------------- confidence --- */

const BAND_STYLES: Record<ApiConfidenceBand, { text: string; dot: string }> = {
  HIGH: { text: "text-green-ink", dot: "bg-green-ink" },
  MEDIUM: { text: "text-amber", dot: "bg-amber" },
  LOW: { text: "text-muted", dot: "bg-faint" },
};

/**
 * The semantic band beside the number.
 *
 * A score of 74 means little on its own; "Positive" says where 74 sits in the
 * scale without implying anything about what happens next. Every label
 * describes present measured standing.
 */
export function ScoreBucket({
  bucket,
  universeLabel,
  className,
}: {
  bucket: string | null | undefined;
  universeLabel?: string | undefined;
  className?: string;
}) {
  if (!bucket) return null;
  return (
    <span className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text">
        {bucket}
      </span>
      {universeLabel ? (
        <span className="text-[11px] text-faint">among {universeLabel.toLowerCase()}</span>
      ) : null}
    </span>
  );
}

export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: ApiScoreConfidence;
  className?: string;
}) {
  const style = BAND_STYLES[confidence.band];
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
        Confidence
      </span>
      <span className={cn("font-mono text-[11.5px]", style.text)}>
        {confidence.band}
      </span>
      <span className="font-mono text-[11px] text-faint">
        {(confidence.value * 100).toFixed(0)}%
      </span>
    </span>
  );
}

/** The four readings behind a confidence figure, so it can be checked. */
export function ConfidenceBreakdown({
  confidence,
  className,
}: {
  confidence: ApiScoreConfidence;
  className?: string;
}) {
  const rows = [
    { label: "Data completeness", value: confidence.completeness },
    { label: "Observation freshness", value: confidence.freshness },
    { label: "Historical depth", value: confidence.historicalDepth },
    {
      label: "Components available",
      value: confidence.componentsAvailable / confidence.componentsTotal,
      detail: `${confidence.componentsAvailable}/${confidence.componentsTotal}`,
    },
  ];

  return (
    <dl className={cn("space-y-2.5", className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <dt className="w-40 shrink-0 text-[12px] text-muted">{row.label}</dt>
          <dd className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-border-strong"
                style={{ width: `${Math.round(row.value * 100)}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[11.5px] text-text">
              {row.detail ?? `${Math.round(row.value * 100)}%`}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------------------------------------- components --- */

export const COMPONENT_LABELS: Record<ApiScoreComponent, string> = {
  momentum: "Momentum",
  volume: "Volume",
  activity: "Activity",
  liquidity: "Liquidity",
  relativeStrength: "Relative strength",
  trend: "Trend",
  volatility: "Volatility",
};

/**
 * The component breakdown.
 *
 * Components the engine could not compute are listed too, greyed and carrying
 * their reason. Omitting them would leave the reader to assume the score used
 * everything it names, which is exactly the impression the whole design is
 * trying to avoid.
 */
export function ComponentBreakdown({
  components,
  missing,
  className,
}: {
  components: Partial<Record<ApiScoreComponent, number>>;
  missing: { component: ApiScoreComponent; reason: string }[];
  className?: string;
}) {
  const present = Object.entries(components) as [ApiScoreComponent, number][];

  return (
    <div className={cn("space-y-3", className)}>
      {present.map(([component, value]) => (
        <div key={component} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-[12.5px] text-muted">
            {COMPONENT_LABELS[component]}
          </span>
          <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span
              className={cn(
                "block h-full rounded-full",
                value >= 66 ? "bg-green-ink" : "bg-border-strong",
              )}
              style={{ width: `${Math.round(value)}%` }}
            />
          </span>
          <span className="w-11 shrink-0 text-right font-mono text-[12px] tabular-nums text-text">
            {value.toFixed(1)}
          </span>
        </div>
      ))}

      {missing.map((item) => (
        <div key={item.component} className="flex items-start gap-3">
          <span className="w-32 shrink-0 text-[12.5px] text-faint">
            {COMPONENT_LABELS[item.component]}
          </span>
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-faint">
            Not computed — {item.reason}
          </span>
          <span className="w-11 shrink-0 text-right font-mono text-[12px] text-faint">
            —
          </span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- explanation --- */

/**
 * "Why is this score what it is."
 *
 * Every line is a computed contribution with the measured fact behind it, in
 * the order the arithmetic ranked them. Nothing is written by a model, and
 * nothing is rephrased for tone.
 */
export function ScoreExplanation({
  explanation,
  className,
}: {
  explanation: ApiComputeExplanation;
  className?: string;
}) {
  if (explanation.drivers.length === 0) {
    return (
      <p className={cn("text-[13px] text-muted", className)}>
        No component moved the score materially away from neutral.
      </p>
    );
  }

  return (
    <ul className={cn("space-y-2.5", className)}>
      {explanation.drivers.map((driver) => (
        <li key={driver.component} className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 font-mono text-[13px] leading-none",
              driver.direction === "positive" ? "text-green-ink" : "text-red",
            )}
            aria-hidden
          >
            {driver.direction === "positive" ? "+" : "−"}
          </span>
          <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-text">
            {driver.detail}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-[11.5px] tabular-nums",
              driver.direction === "positive" ? "text-green-ink" : "text-red",
            )}
          >
            {driver.contribution >= 0 ? "+" : ""}
            {driver.contribution.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- engines --- */

function EngineRow({
  label,
  value,
  detail,
  unavailable,
}: {
  label: string;
  value: string | null;
  detail?: string | null;
  unavailable: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="text-[12.5px] text-muted">{label}</span>
      {value === null ? (
        <span
          className="max-w-[60%] text-right text-[11.5px] leading-relaxed text-faint"
          title={unavailable ?? undefined}
        >
          Not computed
        </span>
      ) : (
        <span className="text-right">
          <span className="font-mono text-[12.5px] tabular-nums text-text">{value}</span>
          {detail ? (
            <span className="mt-0.5 block text-[11px] text-faint">{detail}</span>
          ) : null}
        </span>
      )}
    </div>
  );
}

const TREND_LABELS: Record<string, string> = {
  STRONG_UPTREND: "Strong uptrend",
  UPTREND: "Uptrend",
  NEUTRAL: "Neutral",
  DOWNTREND: "Downtrend",
  STRONG_DOWNTREND: "Strong downtrend",
};

/** The engine readings in their natural units, beside their 0–100 scores. */
export function EngineReadings({
  engines,
  className,
}: {
  engines: ApiEngineOutputs;
  className?: string;
}) {
  const { momentum, volume, activity, liquidity, volatility, relativeStrength, trend } =
    engines;

  return (
    <div className={cn("", className)}>
      <EngineRow
        label="Momentum"
        value={momentum.score === null ? null : momentum.score.toFixed(1)}
        detail={
          momentum.direction
            ? `${momentum.direction} · ${momentum.timeframes.join(", ")}`
            : null
        }
        unavailable={momentum.unavailableReason}
      />
      <EngineRow
        label="Volume"
        value={volume.score === null ? null : volume.score.toFixed(1)}
        detail={
          volume.relativeVolume !== null
            ? `${volume.relativeVolume.toFixed(2)}x baseline${volume.regime ? ` · ${volume.regime.toLowerCase()}` : ""}`
            : null
        }
        unavailable={volume.unavailableReason}
      />
      <EngineRow
        label="Activity"
        value={activity.score === null ? null : activity.score.toFixed(1)}
        detail={activity.basis ? `${activity.basis} basis` : null}
        unavailable={activity.unavailableReason}
      />
      <EngineRow
        label="Liquidity"
        value={liquidity.score === null ? null : liquidity.score.toFixed(1)}
        detail={
          liquidity.changePct !== null
            ? `${liquidity.state} · ${liquidity.changePct >= 0 ? "+" : ""}${liquidity.changePct.toFixed(1)}%`
            : null
        }
        unavailable={liquidity.unavailableReason}
      />
      <EngineRow
        label="Volatility"
        value={volatility.score === null ? null : volatility.score.toFixed(1)}
        detail={
          volatility.mediumTermPct !== null
            ? `${volatility.mediumTermPct.toFixed(0)}% annualised`
            : null
        }
        unavailable={volatility.unavailableReason}
      />
      <EngineRow
        label="Relative strength"
        value={relativeStrength.score === null ? null : relativeStrength.score.toFixed(1)}
        detail={
          relativeStrength.excessReturnPct !== null
            ? `${relativeStrength.excessReturnPct >= 0 ? "+" : ""}${relativeStrength.excessReturnPct.toFixed(2)} vs ${relativeStrength.benchmarkLabel}`
            : null
        }
        unavailable={relativeStrength.unavailableReason}
      />
      <EngineRow
        label="Trend"
        value={trend.score === null ? null : trend.score.toFixed(1)}
        detail={
          trend.state
            ? `${TREND_LABELS[trend.state]}${trend.slopePctPerDay !== null ? ` · ${trend.slopePctPerDay >= 0 ? "+" : ""}${trend.slopePctPerDay.toFixed(2)}%/day` : ""}`
            : null
        }
        unavailable={trend.unavailableReason}
      />
    </div>
  );
}

/* --------------------------------------------------------------- misc --- */

const SEVERITY_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = {
  low: "neutral",
  medium: "amber",
  high: "amber",
  critical: "red",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{severity.toUpperCase()}</Badge>
  );
}

const STAGE_TONE: Record<string, "green" | "amber" | "neutral"> = {
  EARLY: "neutral",
  WATCH: "amber",
  CONFIRMED: "green",
};

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={STAGE_TONE[stage] ?? "neutral"}>{stage}</Badge>;
}

const REGIME_LABELS: Record<string, string> = {
  RISK_ON: "Risk on",
  RISK_OFF: "Risk off",
  NEUTRAL: "Neutral",
  HIGH_VOLATILITY: "High volatility",
};

export function regimeLabel(state: string): string {
  return REGIME_LABELS[state] ?? state;
}

/** A score change over stored history, or nothing when there is no history. */
export function ScoreDelta({
  change,
  className,
}: {
  change: number | null;
  className?: string;
}) {
  if (change === null) {
    return (
      <span className={cn("font-mono text-[12px] text-faint", className)}>—</span>
    );
  }

  const Icon = change > 0.05 ? ArrowUpRight : change < -0.05 ? ArrowDownRight : Minus;
  const tone =
    change > 0.05 ? "text-green-ink" : change < -0.05 ? "text-red" : "text-muted";

  return (
    <span className={cn("flex items-center gap-1 font-mono text-[12px]", tone, className)}>
      <Icon className="size-3.5" />
      {change >= 0 ? "+" : ""}
      {change.toFixed(1)}
    </span>
  );
}
