import * as React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow, Reveal } from "@/components/landing/primitives";

/**
 * Opening block for a marketing sub-page. Clears the fixed navbar and sets
 * the same rhythm the landing sections use.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  actions,
  aside,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 grid-lines opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_20%,var(--color-bg)_78%)]" />
        <div className="absolute left-0 top-16 h-px w-full bg-gradient-to-r from-transparent via-green-ink/25 to-transparent" />
      </div>

      <div className="relative mx-auto w-full max-w-[1240px] px-5 pb-16 pt-28 sm:px-8 lg:pb-20 lg:pt-36">
        <div
          className={cn(
            "grid gap-12",
            aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-20",
          )}
        >
          <div>
            <Reveal>
              <Eyebrow>{eyebrow}</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="mt-6 max-w-3xl text-[clamp(30px,5vw,54px)] font-semibold uppercase leading-[1.02] tracking-[-0.035em] text-text">
                {title}
              </h1>
            </Reveal>
            {lede ? (
              <Reveal delay={160}>
                <div className="mt-7 max-w-xl text-[15.5px] leading-relaxed text-muted">
                  {lede}
                </div>
              </Reveal>
            ) : null}
            {actions ? (
              <Reveal delay={240}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  {actions}
                </div>
              </Reveal>
            ) : null}
          </div>

          {aside ? <Reveal delay={200}>{aside}</Reveal> : null}
        </div>
      </div>
    </section>
  );
}

/** Numbered list block shared by the About and Platform pages. */
export function NumberedList({
  items,
  className,
}: {
  items: { title: string; copy: string }[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-px border border-border bg-border md:grid-cols-3", className)}>
      {items.map((item, i) => (
        <Reveal key={item.title} delay={i * 80} className="bg-bg p-6">
          <span className="font-mono text-[10px] tracking-[0.2em] text-green-ink">
            {String(i + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-5 text-[16px] font-medium tracking-[-0.01em] text-text">
            {item.title}
          </h3>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
            {item.copy}
          </p>
        </Reveal>
      ))}
    </div>
  );
}
