import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared hero used by Overview and Compute. Copy, actions and the right-hand
 * panel are all injected, so no page owns hero markup of its own.
 */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  description,
  actions,
  aside,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
    >
      {/* structural background — layered strata, not decoration for its own sake */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 grid-lines opacity-[0.55]" />
        <div className="absolute inset-0 bg-gradient-to-br from-bg/10 via-bg/70 to-bg" />
        <div className="absolute -left-24 top-0 h-px w-[60%] bg-gradient-to-r from-transparent via-green-ink/50 to-transparent" />
      </div>

      <div className="relative grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:p-10">
        <div className="flex flex-col justify-center">
          {eyebrow ? (
            <div className="mb-5 flex items-center gap-2.5">
              <span className="h-1 w-1 rounded-full bg-green-ink" aria-hidden />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-green-ink">
                {eyebrow}
              </span>
            </div>
          ) : null}

          <h1 className="text-[11px] font-medium uppercase tracking-[0.34em] text-muted">
            {title}
          </h1>

          <p className="mt-4 max-w-2xl text-[clamp(28px,4.2vw,44px)] font-semibold leading-[1.08] tracking-[-0.025em] text-text">
            {subtitle}
          </p>

          {description ? (
            <div className="mt-5 max-w-xl text-[14px] leading-relaxed text-muted">
              {description}
            </div>
          ) : null}

          {actions ? (
            <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>
          ) : null}
        </div>

        {aside ? <div className="lg:pl-2">{aside}</div> : null}
      </div>
    </section>
  );
}
