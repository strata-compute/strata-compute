import * as React from "react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";

/**
 * THE SYSTEM DIAGRAM
 *
 * A layered view of what Strata is, sitting beside the pipeline strip rather
 * than repeating it: the pipeline shows the five stages a market passes
 * through, this shows what each layer is made of and which direction the work
 * flows.
 *
 * Nothing here is a measurement. Every string is the name of a subsystem, so
 * the diagram cannot be misread as live telemetry — the one thing an animated
 * system view is most likely to be mistaken for. Counts that are real, like
 * coverage, live on the pages that read them from the API.
 *
 * The motion is two descending packets per connector on a long, offset loop.
 * It reads as data moving downward through the stack and costs nothing: four
 * connectors, eight elements, pure CSS transform and opacity, no timers and
 * no JavaScript. `prefers-reduced-motion` is honoured globally in
 * app/globals.css, which reduces every animation here to a single 0.001ms
 * frame.
 */

interface Layer {
  id: string;
  label: string;
  caption: string;
  parts: string[];
  /** The layer that gives the system its name gets the accent. */
  accent?: boolean;
}

const LAYERS: Layer[] = [
  {
    id: "inputs",
    label: "Market inputs",
    caption: "What Strata reads",
    parts: ["Tokenised equities", "Crypto", "Onchain"],
  },
  {
    id: "normalization",
    label: "Data normalization",
    caption: "Made comparable before anything is computed",
    parts: ["Common schema", "One clock", "Resolved symbology", "Outlier quarantine"],
  },
  {
    id: "compute",
    label: "Strata compute",
    caption: "Seven independent components, published weights",
    parts: ["Scoring", "Percentile normalisation", "Calibration", "Confidence"],
    accent: true,
  },
  {
    id: "intelligence",
    label: "Intelligence",
    caption: "What changed, and whether it means anything",
    parts: ["Detection", "Classification", "Significance", "Persistence"],
  },
  {
    id: "output",
    label: "Output",
    caption: "What the Terminal renders",
    parts: ["Signals", "Rankings", "Arena", "Comparison"],
  },
];

/** A packet descending one connector. */
function Packet({ delay }: { delay: number }) {
  return (
    <span
      className="absolute inset-0 animate-flow"
      style={{
        ["--flow-x" as string]: "0%",
        ["--flow-y" as string]: "100%",
        animationDelay: `${delay}s`,
      }}
      aria-hidden
    >
      <span className="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-green-ink" />
    </span>
  );
}

function Connector({ index }: { index: number }) {
  return (
    <div className="flex justify-center py-2" aria-hidden>
      <span className="relative block h-10 w-px overflow-hidden bg-border sm:h-12">
        <span className="absolute inset-0 animate-sweep bg-gradient-to-b from-transparent via-green-ink/35 to-transparent" />
        <Packet delay={index * 0.8} />
        <Packet delay={index * 0.8 + 2.4} />
      </span>
    </div>
  );
}

function LayerRow({ layer, index }: { layer: Layer; index: number }) {
  return (
    <Reveal delay={index * 70}>
      <div
        className={cn(
          "rounded-lg border bg-surface/60 px-4 py-4 sm:px-5",
          layer.accent ? "border-green-ink/30 bg-green-ink/[0.04]" : "border-border",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  layer.accent ? "animate-live-pulse bg-green-ink" : "bg-border-strong",
                )}
                aria-hidden
              />
              <h3
                className={cn(
                  "font-mono text-[11px] uppercase tracking-[0.18em]",
                  layer.accent ? "text-green-ink" : "text-text",
                )}
              >
                {layer.label}
              </h3>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              {layer.caption}
            </p>
          </div>

          <ul className="flex flex-wrap gap-1.5 sm:justify-end">
            {layer.parts.map((part) => (
              <li
                key={part}
                className="rounded-[4px] border border-border bg-bg px-2 py-1 font-mono text-[10.5px] text-faint"
              >
                {part}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Reveal>
  );
}

export function ArchitectureSection() {
  return (
    <SectionShell id="architecture" bordered>
      <SectionHeader
        eyebrow="System architecture"
        title="How a market becomes a number."
        description="Five layers, in one direction. Every stage is independent and observable: a provider that stops answering narrows what the layer above it can compute, and says so, rather than passing a guess upward."
      />

      <div className="mt-12 lg:mt-14">
        {LAYERS.map((layer, index) => (
          <React.Fragment key={layer.id}>
            <LayerRow layer={layer} index={index} />
            {index < LAYERS.length - 1 ? <Connector index={index} /> : null}
          </React.Fragment>
        ))}
      </div>

      <Reveal delay={400}>
        <p className="mt-10 max-w-2xl text-[12.5px] leading-relaxed text-faint">
          The diagram is a map of the system, not a readout of it. Every number
          Strata publishes is computed by this stack and read from the API at
          request time — never illustrated.
        </p>
      </Reveal>
    </SectionShell>
  );
}
