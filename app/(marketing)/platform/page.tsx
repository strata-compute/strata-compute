import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";
import { PageIntro } from "@/components/landing/page-intro";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "How the Strata Compute platform is put together: ingestion, normalization, computation and delivery.",
};

const LAYERS = [
  {
    id: "ingestion",
    label: "Ingestion",
    copy: "Feeds from four data domains arrive continuously and are stamped at the venue clock before anything downstream sees them.",
    points: ["Market data", "Equities", "Crypto", "Onchain"],
  },
  {
    id: "normalization",
    label: "Normalization",
    copy: "Different structures resolve onto one schema. Symbology, timestamps and units are reconciled so later stages never have to special-case a source.",
    points: ["Symbol resolution", "One compute clock", "Unit reconciliation", "Outlier quarantine"],
  },
  {
    id: "computation",
    label: "Computation",
    copy: "Seven components score every covered market on identical normalised inputs. No component reads another's output, so a fault degrades one component rather than the composite.",
    points: ["Momentum", "Volume", "Activity", "Liquidity", "Market strength"],
    accent: true,
  },
  {
    id: "delivery",
    label: "Delivery",
    copy: "Scores and their full factor attribution are persisted per window and served as structured output. The interface is one consumer of that output, not the source of it.",
    points: ["Scores", "Attribution", "History", "Events"],
  },
];

const OUTPUTS = [
  {
    label: "Strata Score",
    copy: "A 0–100 composite, cross-normalised so the number carries the same meaning in every asset class.",
    href: routes.rankings,
    cta: "See rankings",
  },
  {
    label: "Arena",
    copy: "The same scores resolved into competitive rounds, where standing changes as performance does.",
    href: routes.arena,
    cta: "Enter arena",
  },
  {
    label: "Signals",
    copy: "Threshold crossings emitted the moment a computed factor breaks its own baseline.",
    href: routes.signals,
    cta: "View signals",
  },
  {
    label: "Compute",
    copy: "The pipeline itself, documented stage by stage with the weights that produce the composite.",
    href: routes.compute,
    cta: "Open compute",
  },
];

const GUARANTEES = [
  { label: "Cadence", value: "1s", copy: "Every covered market recomputes each second." },
  { label: "Determinism", value: "Replayable", copy: "Same inputs and version, same score." },
  { label: "Attribution", value: "Retained", copy: "Each score keeps its factor breakdown." },
  { label: "Observability", value: "Per stage", copy: "Each stage reports its own health." },
];

export default function PlatformPage() {
  return (
    <>
      <PageIntro
        eyebrow="Platform"
        title="Built as a pipeline, not a dashboard."
        lede={
          <p>
            Strata Compute is a backend computation engine with an interface
            attached. Data enters from four domains, resolves onto one schema,
            is scored by seven independent components, and is served as structured
            intelligence.
          </p>
        }
        actions={
          <>
            <Button asChild variant="primary" className="h-11 px-5 text-[14px]">
              <Link href={routes.terminal}>
                Open Terminal
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="h-11 px-5 text-[14px]">
              <Link href={routes.documentation}>Read the docs</Link>
            </Button>
          </>
        }
        aside={
          <div className="border border-border">
            {GUARANTEES.map((item) => (
              <div
                key={item.label}
                className="border-b border-border px-5 py-4 last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                    {item.label}
                  </span>
                  <span className="font-mono text-[13px] text-text">
                    {item.value}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                  {item.copy}
                </p>
              </div>
            ))}
          </div>
        }
      />

      <SectionShell>
        <SectionHeader
          eyebrow="The layers"
          title="Four stages, one direction."
          description="Each stage does one job and hands off a known shape. That is what keeps a problem at one venue from quietly changing a score somewhere else."
        />

        <div className="mt-14 grid gap-px border border-border bg-border sm:grid-cols-2">
          {LAYERS.map((layer, i) => (
            <Reveal key={layer.id} delay={i * 80} className="bg-bg p-6 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <span
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[0.2em]",
                    layer.accent ? "text-green-ink" : "text-text",
                  )}
                >
                  {layer.label}
                </span>
                <span className="font-mono text-[10px] text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
                {layer.copy}
              </p>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5">
                {layer.points.map((point) => (
                  <li
                    key={point}
                    className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint"
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </SectionShell>

      <SectionShell>
        <SectionHeader
          eyebrow="What it produces"
          title="Four views, one computation."
          description="Rankings, arena rounds and signals are not separate products. They are the same output, ordered differently."
        />

        <div className="mt-14 grid gap-px border border-border bg-border lg:grid-cols-2">
          {OUTPUTS.map((output, i) => (
            <Reveal key={output.label} delay={i * 70} className="bg-bg">
              <Link
                href={output.href}
                className="group flex h-full flex-col justify-between gap-6 p-6 transition-colors duration-200 hover:bg-surface/50 sm:p-7"
              >
                <div>
                  <h3 className="text-[16px] font-medium tracking-[-0.01em] text-text">
                    {output.label}
                  </h3>
                  <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-muted">
                    {output.copy}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors group-hover:text-green-ink">
                  {output.cta}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </SectionShell>
    </>
  );
}
