import * as React from "react";
import { ChevronRight } from "lucide-react";
import { PIPELINE_STAGES } from "@/lib/pipeline-spec";
import type { PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

const kindStyle: Record<PipelineStage["kind"], string> = {
  source: "border-border bg-surface-2 text-muted",
  process: "border-border-strong bg-surface-2 text-text",
  output: "border-border-strong bg-elevated text-text",
};

/** Exactly one node carries the accent: the score itself. */
const ACCENT_STAGE = "score";

function Connector() {
  return (
    <div
      className="relative hidden h-px flex-1 overflow-hidden bg-border lg:block"
      aria-hidden
    >
      <div className="absolute inset-y-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-green-ink/70 to-transparent" />
    </div>
  );
}

/** The five-stage flow, rendered as a diagram on desktop and a list on mobile. */
export function PipelineDiagram({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-5 sm:p-6", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {PIPELINE_STAGES.map((stage, index) => (
          <React.Fragment key={stage.id}>
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-2 rounded-lg border px-4 py-3.5 transition-colors duration-200",
                stage.id === ACCENT_STAGE
                  ? "border-green-ink/30 bg-green-ink/6 text-green-ink"
                  : kindStyle[stage.kind],
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">
                  {stage.kind}
                </span>
                <span className="font-mono text-[10px] opacity-60">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </span>
              <span className="text-[13.5px] font-medium tracking-tight">
                {stage.label}
              </span>
              <span className="flex items-center gap-2 font-mono text-[10.5px] opacity-70">
                {stage.throughput}
                {stage.latency !== "—" ? (
                  <>
                    <span className="opacity-50">·</span>
                    {stage.latency}
                  </>
                ) : null}
              </span>
            </div>

            {index < PIPELINE_STAGES.length - 1 ? (
              <>
                <Connector />
                <ChevronRight
                  className="mx-auto size-4 rotate-90 text-border-strong lg:hidden"
                  aria-hidden
                />
              </>
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function StageDetails({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-2", className)}>
      {PIPELINE_STAGES.map((stage, index) => (
        <Card key={stage.id}>
          <CardHeader>
            <CardTitle>
              {String(index + 1).padStart(2, "0")} · {stage.label}
            </CardTitle>
            <span className="font-mono text-[10.5px] text-faint">
              {stage.latency !== "—" ? stage.latency : stage.throughput}
            </span>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-[13px] leading-relaxed text-muted">
              {stage.description}
            </p>
            <ul className="space-y-2 border-t border-border pt-4">
              {stage.detail.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-[12.5px] leading-relaxed text-muted"
                >
                  <span
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-border-strong"
                    aria-hidden
                  />
                  {item}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
