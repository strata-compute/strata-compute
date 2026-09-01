import * as React from "react";
import { COMPUTE_MODULES, SCORE_FACTORS } from "@/lib/pipeline-spec";
import { DataUnavailable } from "@/components/data/data-state";
import type { ApiComputeScore, ApiScoreComponent } from "@/lib/api";
import { COMPONENT_LABELS } from "@/components/data/intelligence";
import { cn } from "@/lib/utils";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

/** Weight allocation across the seven components, as one continuous bar. */
/**
 * The published weights, drawn from the engine.
 *
 * There is no local copy of these numbers. A second definition of the weights
 * is one that will eventually drift from the engine, and the page would then
 * illustrate a score using proportions that did not produce it.
 */
export function WeightBar({
  weights,
  className,
}: {
  weights: Record<string, number> | null;
  className?: string;
}) {
  if (!weights || Object.keys(weights).length === 0) {
    return (
      <p className={cn("text-[12.5px] text-muted", className)}>
        Scoring weights unavailable — the engine has not published a version.
      </p>
    );
  }

  const entries = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex h-2 overflow-hidden rounded-full bg-elevated">
        {entries.map(([component, weight], i) => (
          <div
            key={component}
            className={cn(
              "h-full border-r border-bg last:border-r-0",
              i === 0 ? "bg-green-ink/70" : "bg-muted/40",
            )}
            style={{ width: `${(weight / total) * 100}%` }}
            title={`${COMPONENT_LABELS[component as ApiScoreComponent] ?? component} \— ${(weight * 100).toFixed(0)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {entries.map(([component, weight], i) => (
          <span key={component} className="flex items-center gap-2 text-[11.5px]">
            <span
              className={cn(
                "size-1.5 rounded-[2px]",
                i === 0 ? "bg-green-ink/70" : "bg-muted/40",
              )}
              aria-hidden
            />
            <span className="text-muted">
              {COMPONENT_LABELS[component as ApiScoreComponent] ?? component}
            </span>
            <span className="font-mono text-faint">
              {(weight * 100).toFixed(0)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ModuleGrid({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3", className)}>
      {COMPUTE_MODULES.map((module) => (
        <Card key={module.id} className="flex flex-col">
          <CardHeader>
            <CardTitle>{module.label}</CardTitle>
            <span className="font-mono text-[11px] text-muted">
              {(module.weight * 100).toFixed(0)}%
            </span>
          </CardHeader>
          <CardBody className="flex flex-1 flex-col gap-4">
            <p className="text-[12.5px] leading-relaxed text-muted">
              {module.description}
            </p>

            <dl className="space-y-2 text-[11.5px]">
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 uppercase tracking-[0.12em] text-faint">
                  Windows
                </dt>
                <dd className="font-mono text-muted">
                  {module.windows.join(" · ")}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 uppercase tracking-[0.12em] text-faint">
                  Output
                </dt>
                <dd className="font-mono text-muted">{module.output}</dd>
              </div>
            </dl>

            <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border pt-4">
              {module.inputs.map((input) => (
                <Badge key={input} tone="outline">
                  {input}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

/**
 * A worked example, computed from a real market.
 *
 * This previously took its readings from a fixture, which meant the page
 * showed a plausible-looking score derived from numbers no provider had ever
 * published. It now takes a live market as a prop and renders nothing but an
 * unavailable state when the compute engine has not scored one.
 */
export function WorkedExample({
  symbol,
  score,
  weights,
}: {
  symbol: string | null;
  /** The stored computation for a real scored market. */
  score: ApiComputeScore | null;
  /** Weights published by the engine, never a local copy. */
  weights: Record<string, number> | null;
}) {
  if (!symbol || !score || score.status !== "OK" || score.score === null || !weights) {
    return (
      <DataUnavailable
        title="Worked example unavailable"
        reason={
          score?.insufficientReason ??
          "A worked example requires a scored market. None has been computed yet."
        }
      />
    );
  }

  // Only the components that actually entered this score are shown, and the
  // weights are renormalised exactly as the engine renormalised them — so the
  // contributions below sum to the published score rather than to a number
  // that merely resembles it.
  const present = Object.entries(score.components) as [string, number][];
  const availableWeight = present.reduce(
    (sum, [component]) => sum + (weights[component] ?? 0),
    0,
  );

  const rows = present
    .map(([component, value]) => {
      const share = availableWeight > 0 ? (weights[component] ?? 0) / availableWeight : 0;
      return {
        label: COMPONENT_LABELS[component as ApiScoreComponent] ?? component,
        value,
        weight: share,
        points: value * share,
      };
    })
    .sort((a, b) => b.points - a.points);

  const total = rows.reduce((sum, row) => sum + row.points, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Worked example · {symbol}</CardTitle>
        <span className="font-mono text-[10.5px] text-faint">
          factor × weight = contribution
        </span>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-border">
              {["Module", "Reading", "Weight", "Contribution"].map((header, i) => (
                <th
                  key={header}
                  className={cn(
                    "px-5 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.13em] text-faint",
                    i === 0 ? "text-left" : "text-right",
                  )}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border/70">
                <td className="px-5 py-3 text-[12.5px] text-muted">{row.label}</td>
                <td className="px-5 py-3 text-right font-mono text-[12.5px] tabular-nums text-text">
                  {row.value.toFixed(1)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-[12.5px] tabular-nums text-faint">
                  {(row.weight * 100).toFixed(0)}%
                </td>
                <td className="px-5 py-3 text-right font-mono text-[12.5px] tabular-nums text-muted">
                  {row.points.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-5 py-3.5 text-[12.5px] font-medium text-text" colSpan={3}>
                Strata Score
              </td>
              <td className="px-5 py-3.5 text-right font-mono text-[15px] font-medium tabular-nums text-green-ink">
                {total.toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-5 py-2.5">
        <span className="font-mono text-[10.5px] text-faint">
          Computed from live market data
        </span>
      </div>
    </Card>
  );
}
