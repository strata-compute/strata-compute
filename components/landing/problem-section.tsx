import * as React from "react";
import { SectionHeader, SectionShell, Reveal } from "@/components/landing/primitives";

/**
 * Three deliberately dissimilar shapes: the same market described by three
 * feeds that agree on nothing.
 */
function FeedShape() {
  return (
    <svg
      viewBox="0 0 120 36"
      preserveAspectRatio="xMinYMid meet"
      className="h-12 w-full"
      fill="none"
      aria-hidden
    >
      <path
        d="M2 28 L18 23 L30 26 L44 16 L58 20 L72 11 L86 14 L102 6 L118 9"
        stroke="var(--color-muted)"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FormatShape() {
  const bars = [9, 20, 13, 27, 7, 24, 11, 31, 16, 22, 8, 26];
  return (
    <svg
      viewBox="0 0 120 36"
      preserveAspectRatio="xMinYMid meet"
      className="h-12 w-full"
      fill="none"
      aria-hidden
    >
      {bars.map((h, i) => (
        <rect
          key={i}
          x={2 + i * 10}
          y={34 - h}
          width="5"
          height={h}
          fill="var(--color-muted)"
          opacity={0.55}
        />
      ))}
    </svg>
  );
}

function SignalShape() {
  const dots = [
    [6, 27], [18, 12], [26, 21], [38, 8], [46, 25], [58, 16],
    [66, 30], [78, 10], [88, 23], [98, 6], [108, 19], [116, 27],
  ];
  return (
    <svg
      viewBox="0 0 120 36"
      preserveAspectRatio="xMinYMid meet"
      className="h-12 w-full"
      fill="none"
      aria-hidden
    >
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" fill="var(--color-muted)" opacity={0.7} />
      ))}
    </svg>
  );
}

const FRAGMENTS = [
  { label: "FEEDS", copy: "Different feeds.", shape: <FeedShape /> },
  { label: "FORMATS", copy: "Different formats.", shape: <FormatShape /> },
  { label: "SIGNALS", copy: "Different signals.", shape: <SignalShape /> },
];

export function ProblemSection() {
  return (
    <SectionShell id="product">
      <SectionHeader
        eyebrow="The problem"
        title="Market data is fragmented."
        description="A tokenised equity, a crypto major and an onchain pool each report a different shape of truth — different venues, different settlement, different clocks. Comparing them by eye is guesswork, and comparing them by raw price is worse: it compares units that were never the same."
      />

      <div className="mt-16 grid gap-px border border-border bg-border sm:grid-cols-3">
        {FRAGMENTS.map((fragment, i) => (
          <Reveal key={fragment.label} delay={i * 90} className="bg-bg p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
              {fragment.label}
            </span>
            <div className="mt-6">{fragment.shape}</div>
            <p className="mt-6 text-[15px] tracking-tight text-text">
              {fragment.copy}
            </p>
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <div className="mt-8 flex flex-col items-start gap-4 border-l border-green-ink/40 pl-6 sm:flex-row sm:items-center sm:gap-8">
          <p className="text-[clamp(17px,2.2vw,22px)] font-medium tracking-[-0.02em] text-text">
            Strata brings them into one computational framework.
          </p>
          <p className="text-[13.5px] leading-relaxed text-muted sm:max-w-sm">
            One normalisation layer, one set of weights, one number that means
            the same thing in every market it describes.
          </p>
        </div>
      </Reveal>
    </SectionShell>
  );
}
