import * as React from "react";
import { MARKET_CATEGORIES } from "@/lib/landing-data";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";

/**
 * Four domains on one bus. The convergence graphic below the grid is the
 * point of the section — these are inputs to a single layer, not four
 * unrelated feature cards.
 */
export function MarketCategories() {
  return (
    <SectionShell>
      <SectionHeader
        eyebrow="Coverage"
        title={
          <>
            One layer.
            <br />
            Multiple markets.
          </>
        }
        description="The same five modules, the same weights and the same normalisation run against all of it — which is what makes the output comparable."
      />

      <div className="mt-16">
        <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {MARKET_CATEGORIES.map((category, i) => (
            <Reveal
              key={category.id}
              delay={i * 80}
              className="flex flex-col bg-bg p-6 transition-colors duration-200 hover:bg-surface/50"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-text">
                  {category.label}
                </span>
                {/* coverage counts previously shown here were invented; real
                    counts live on the console overview, sourced from /api/stats */}
              </div>

              <p className="mt-8 text-[14.5px] leading-snug text-text">
                {category.description}
              </p>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                {category.detail}
              </p>
            </Reveal>
          ))}
        </div>

        {/* convergence bus */}
        <div aria-hidden className="relative">
          {/* four lanes once the grid is four-wide; one lane below that */}
          <div className="hidden grid-cols-4 lg:grid">
            {MARKET_CATEGORIES.map((category, i) => (
              <div key={category.id} className="flex justify-center">
                <span className="relative block h-10 w-px overflow-hidden bg-border">
                  <span
                    className="absolute inset-0 animate-flow"
                    style={{
                      ["--flow-x" as string]: "0%",
                      ["--flow-y" as string]: "100%",
                      animationDelay: `${i * 0.45}s`,
                    }}
                  >
                    <span className="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-green-ink" />
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-center lg:hidden">
            <span className="relative block h-10 w-px overflow-hidden bg-border">
              <span
                className="absolute inset-0 animate-flow"
                style={{
                  ["--flow-x" as string]: "0%",
                  ["--flow-y" as string]: "100%",
                }}
              >
                <span className="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-green-ink" />
              </span>
            </span>
          </div>

          <div className="relative hidden h-px lg:mx-[12.5%] lg:block">
            <span className="absolute inset-0 bg-border" />
            <span className="absolute inset-0 overflow-hidden">
              <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-green-ink/35 to-transparent" />
            </span>
          </div>

          <div className="hidden justify-center lg:flex">
            <span className="block h-10 w-px bg-border" />
          </div>
        </div>

        <Reveal className="flex justify-center">
          <div className="border border-green-ink/30 bg-green-ink/6 px-6 py-3.5 text-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-green-ink">
              One computation layer
            </span>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
