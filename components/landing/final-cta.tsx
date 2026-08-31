import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/landing/primitives";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-border">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 grid-lines opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(90%_120%_at_50%_50%,transparent_10%,var(--color-bg)_72%)]" />
        <div className="absolute left-1/2 top-0 h-px w-[70%] -translate-x-1/2 bg-gradient-to-r from-transparent via-green-ink/40 to-transparent" />
      </div>

      <div className="relative mx-auto w-full max-w-[1240px] px-5 py-28 text-center sm:px-8 lg:py-36">
        <Reveal>
          <h2 className="mx-auto max-w-3xl text-[clamp(30px,5.2vw,56px)] font-semibold uppercase leading-[1.02] tracking-[-0.035em] text-text">
            The market is moving.
            <br />
            <span className="text-muted">Compute it.</span>
          </h2>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-10 flex justify-center">
            <Button asChild variant="primary" className="h-12 px-7 text-[15px]">
              <Link href={routes.app}>
                Launch Strata
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
            Stocks. Crypto. Onchain.
            <br className="sm:hidden" />
            <span className="hidden sm:inline"> · </span>
            One computation layer.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
