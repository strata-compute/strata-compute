import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";
import { NumberedList, PageIntro } from "@/components/landing/page-intro";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Strata Compute exists: one computation layer that makes stock, crypto and onchain markets comparable on the same terms.",
};

const BUILDING = [
  {
    title: "A computation layer",
    copy: "Not a terminal and not another feed. Strata sits between raw market data and the decisions made on top of it, and its only job is to compute.",
  },
  {
    title: "One comparable measure",
    copy: "The Strata Score reduces five independently computed factors to a single number that means the same thing in every market it describes.",
  },
  {
    title: "A programmatic surface",
    copy: "The interface renders what the engine has already computed. The same structured output is intended to be available to anything that can call an API.",
  },
];

const PRINCIPLES = [
  {
    label: "Comparability over completeness",
    copy: "It is easy to publish more numbers. It is harder to publish numbers that can be compared. Strata would rather cover fewer markets well than every market ambiguously.",
  },
  {
    label: "Determinism over convenience",
    copy: "A score you cannot reconstruct is a score you cannot trust. Weights are published, factor attribution is retained, and the same inputs always reproduce the same result.",
  },
  {
    label: "Computation over presentation",
    copy: "Nothing meaningful is derived in the browser. The interface is a view onto a computation that already happened, on a fixed cadence, in one place.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro
        eyebrow="About"
        title="Why Strata exists."
        lede={
          <p>
            Markets have never produced more data, or agreed on less of it.
            Strata Compute turns that fragmentation into a single comparable
            measure, so activity in equities, crypto and onchain markets can be
            judged on the same terms.
          </p>
        }
        actions={
          <>
            <Button asChild variant="primary" className="h-11 px-5 text-[14px]">
              <Link href={routes.app}>
                Open App
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="h-11 px-5 text-[14px]">
              <Link href={routes.platform}>See the platform</Link>
            </Button>
          </>
        }
      />

      <SectionShell>
        <SectionHeader
          eyebrow="What we are building"
          title="One layer, three jobs."
          description="Strata is deliberately narrow. It ingests, it computes, and it serves — everything else is downstream of those three things."
        />
        <NumberedList items={BUILDING} className="mt-14" />
      </SectionShell>

      <SectionShell>
        <SectionHeader
          eyebrow="How we think about it"
          title="What the product optimises for."
        />
        <div className="mt-14 grid gap-10 lg:grid-cols-3 lg:gap-14">
          {PRINCIPLES.map((principle, i) => (
            <Reveal key={principle.label} delay={i * 90}>
              <div className="border-t border-border pt-6">
                <h3 className="text-[17px] font-medium tracking-[-0.01em] text-text">
                  {principle.label}
                </h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                  {principle.copy}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </SectionShell>

      <SectionShell>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-20">
          <SectionHeader
            eyebrow="Where it stands"
            title="Honest about the stage."
            description="Strata Compute is in preview. The interface is complete and the pipeline runs against live providers — every figure shown is sourced and timestamped. The scoring formula is still a development version, and price history has not yet accumulated."
            className="lg:block"
          />
          <Reveal delay={120}>
            <ul className="border border-border">
              {[
                { label: "Interface", value: "Complete" },
                { label: "Live market data", value: "Connected" },
                { label: "Scoring version", value: "v1 (development)" },
                { label: "Persistence", value: "In-memory" },
              ].map((row) => (
                <li
                  key={row.label}
                  className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
                >
                  <span className="text-[13px] text-muted">{row.label}</span>
                  <span className="font-mono text-[12px] text-text">
                    {row.value}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button asChild variant="secondary" size="sm">
                <Link href={routes.documentation}>Read the docs</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={routes.status}>System status</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </SectionShell>
    </>
  );
}
