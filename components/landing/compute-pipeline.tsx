import * as React from "react";
import { PIPELINE, PIPELINE_LINKS } from "@/lib/landing-data";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";

const ACCENT_STAGE = "score";

/** Packet travelling left-to-right along a rail. */
function Packet({
  delay,
  vertical = false,
}: {
  delay: number;
  vertical?: boolean;
}) {
  return (
    <span
      className="absolute inset-0 animate-flow"
      style={{
        ["--flow-x" as string]: vertical ? "0%" : "100%",
        ["--flow-y" as string]: vertical ? "100%" : "0%",
        animationDelay: `${delay}s`,
      }}
    >
      <span
        className={cn(
          "absolute size-1 rounded-full bg-green-ink",
          vertical ? "left-1/2 top-0 -translate-x-1/2" : "left-0 top-1/2 -translate-y-1/2",
        )}
      />
    </span>
  );
}

function Connector({ label, index }: { label: string; index: number }) {
  return (
    <>
      {/* desktop: horizontal rail aligned to the node centre */}
      <div className="hidden shrink-0 basis-16 flex-col items-center pt-[52px] lg:flex xl:basis-24">
        <span className="relative block h-px w-full overflow-hidden bg-border">
          <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-green-ink/40 to-transparent" />
          <Packet delay={index * 0.5} />
          <Packet delay={index * 0.5 + 1.6} />
        </span>
        <span className="mt-2.5 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
          {label}
        </span>
      </div>

      {/* mobile: vertical rail */}
      <div className="flex items-center gap-3 py-3 lg:hidden">
        <span className="relative ml-[27px] block h-10 w-px overflow-hidden bg-border">
          <Packet delay={index * 0.5} vertical />
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
          {label}
        </span>
      </div>
    </>
  );
}

function Stage({
  stage,
  index,
}: {
  stage: (typeof PIPELINE)[number];
  index: number;
}) {
  const accent = stage.id === ACCENT_STAGE;
  return (
    <Reveal delay={index * 90} className="min-w-0 flex-1">
      <div
        className={cn(
          "flex h-[104px] flex-col justify-between border px-4 py-3.5 transition-colors duration-200",
          accent
            ? "border-green-ink/30 bg-green-ink/6"
            : "border-border bg-surface/40 hover:border-border-strong",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "font-mono text-[10px] tracking-[0.14em]",
              accent ? "text-green-ink" : "text-faint",
            )}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          {accent ? (
            <span className="size-1 animate-live-pulse rounded-full bg-green-ink" aria-hidden />
          ) : null}
        </div>
        <div>
          <p
            className={cn(
              "text-[13px] font-medium uppercase tracking-[0.08em]",
              accent ? "text-green-ink" : "text-text",
            )}
          >
            {stage.label}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">
            {stage.caption}
          </p>
        </div>
      </div>

      {stage.items ? (
        <ul className="mt-3 space-y-1.5 border-l border-border pl-3">
          {stage.items.map((item) => (
            <li
              key={item}
              className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-l border-green-ink/30 pl-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-green-ink/80">
          Comparable
          <br />
          across classes
        </p>
      )}
    </Reveal>
  );
}

export function ComputePipeline() {
  return (
    <SectionShell id="compute">
      <SectionHeader
        eyebrow="How Strata works"
        title="From data to intelligence."
        description="Four data domains enter. One comparable measure leaves. Every stage is independent and observable — a failure in one venue degrades coverage for that venue only, it never silently changes a score."
      />

      <div className="mt-16 flex flex-col lg:flex-row lg:items-start">
        {PIPELINE.map((stage, i) => (
          <React.Fragment key={stage.id}>
            <Stage stage={stage} index={i} />
            {i < PIPELINE.length - 1 ? (
              <Connector label={PIPELINE_LINKS[i]} index={i} />
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </SectionShell>
  );
}
