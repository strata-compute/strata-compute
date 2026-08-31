import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Eyebrow, Reveal } from "@/components/landing/primitives";
import { type EngineInput, HeroEngine } from "@/components/landing/hero-engine";

export interface HeroSpec {
  label: string;
  value: string;
}

/**
 * The spec strip previously showed invented coverage figures ("12,486
 * markets", "41 venues"). It now renders whatever the caller counted from
 * /api/stats, and an em dash where there is nothing to count.
 */
export function Hero({
  specs,
  engineInputs,
  engineScore,
  status,
}: {
  specs: HeroSpec[];
  engineInputs: EngineInput[];
  engineScore: number | null;
  status: import("@/lib/data").DataStatus;
}) {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 grid-lines opacity-[0.5]" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_18%,var(--color-bg)_76%)]" />
        <div className="absolute left-0 top-16 h-px w-full bg-gradient-to-r from-transparent via-green-ink/25 to-transparent" />
      </div>

      <div className="relative mx-auto w-full max-w-[1240px] px-5 pb-20 pt-28 sm:px-8 lg:pb-24 lg:pt-32">
        {/* the statement gets the full measure — no column can hold it */}
        <Reveal>
          <Eyebrow>Computation layer · Built on Robinhood Chain</Eyebrow>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="mt-6 text-[clamp(32px,6.6vw,72px)] font-semibold uppercase leading-[0.96] tracking-[-0.038em] text-text">
            Every market
            <br />
            on one scale.
          </h1>
        </Reveal>

        <div className="mt-12 grid items-start gap-12 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-20">
          <div>
            <Reveal delay={160}>
              <p className="max-w-xl text-[15.5px] leading-relaxed text-muted">
                Tokenised equities, crypto and onchain markets arrive
                measured differently and settled on different clocks. Strata
                normalises them onto one schema, computes seven independent
                components against each market&rsquo;s own history, and
                resolves them into a single comparable measure of strength.
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild variant="primary" className="h-12 px-6 text-[14.5px]">
                  <Link href={routes.terminal}>
                    Open Terminal
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" className="h-12 px-6 text-[14.5px]">
                  <Link href={routes.compute}>Explore Compute</Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <dl className="mt-10 grid max-w-lg grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-4">
                {specs.map((spec) => (
                  <div key={spec.label} className="bg-bg px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                      {spec.label}
                    </dt>
                    <dd className="mt-1.5 font-mono text-[15px] tabular-nums text-text">
                      {spec.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <HeroEngine
              inputs={engineInputs}
              score={engineScore}
              status={status}
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
