import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { INFRASTRUCTURE } from "@/lib/landing-data";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";

const ACCENT_NODE = "computation";

const PRINCIPLES = [
  {
    label: "Computation, not presentation",
    copy: "The score is produced by a backend engine on a fixed cadence. The application renders what the engine has already computed — it never derives a number on the client.",
  },
  {
    label: "Deterministic by design",
    copy: "The same normalised inputs and the same scoring version reproduce the same score. Every computation retains its full factor attribution.",
  },
  {
    label: "Observable at every stage",
    copy: "Ingestion, normalization, computation and delivery report independently, so a degraded venue narrows coverage instead of quietly distorting a score.",
  },
];

export function InfrastructureSection() {
  return (
    <SectionShell id="architecture">
      <SectionHeader
        eyebrow="The computation layer"
        title={
          <>
            Built to compute.
            <br />
            Not just display.
          </>
        }
        description="Strata ingests external market data, normalizes different data structures and computes comparable market intelligence before anything reaches the interface."
        action={
          <Button asChild variant="secondary" className="h-11 px-5 text-[14px]">
            <Link href={routes.compute}>
              Explore Compute
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />

      <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-20">
        {/* the chain */}
        <div className="relative">
          <span
            className="absolute left-[7px] top-3 bottom-3 w-px bg-border"
            aria-hidden
          />
          <ol className="space-y-3">
            {INFRASTRUCTURE.map((node, i) => {
              const accent = node.id === ACCENT_NODE;
              return (
                <Reveal
                  as="li"
                  key={node.id}
                  delay={i * 70}
                  className="relative flex gap-5 pl-0"
                >
                  <span className="relative z-10 mt-3 flex size-3.5 shrink-0 items-center justify-center">
                    <span
                      className={cn(
                        "size-1.5 rounded-full ring-4 ring-bg",
                        accent ? "bg-green-ink" : "bg-border-strong",
                      )}
                      aria-hidden
                    />
                  </span>
                  <div
                    className={cn(
                      "min-w-0 flex-1 border px-4 py-3 transition-colors duration-200",
                      accent
                        ? "border-green-ink/30 bg-green-ink/6"
                        : "border-border bg-surface/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          "font-mono text-[11px] uppercase tracking-[0.18em]",
                          accent ? "text-green-ink" : "text-text",
                        )}
                      >
                        {node.label}
                      </span>
                      <span className="font-mono text-[9.5px] text-faint">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                      {node.detail}
                    </p>
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </div>

        {/* what it buys you */}
        <div className="space-y-10 lg:pt-2">
          {PRINCIPLES.map((principle, i) => (
            <Reveal key={principle.label} delay={i * 90}>
              <div className="border-t border-border pt-6">
                <h3 className="text-[17px] font-medium tracking-[-0.01em] text-text">
                  {principle.label}
                </h3>
                <p className="mt-3 max-w-lg text-[13.5px] leading-relaxed text-muted">
                  {principle.copy}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
