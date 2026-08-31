import * as React from "react";
import { cn } from "@/lib/utils";

/** Standard page header used by every non-hero route. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-4", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          {eyebrow ? (
            <div className="flex items-center gap-2">
              <span className="h-px w-5 bg-green-ink/60" aria-hidden />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-green-ink">
                {eyebrow}
              </span>
            </div>
          ) : null}
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.022em] text-text sm:text-[30px]">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-2xl text-[14px] leading-relaxed text-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <div>{meta}</div> : null}
    </header>
  );
}

/** Thin key/value strip for page-level context numbers. */
export function MetaStrip({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4 text-[12.5px]",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
            {item.label}
          </dt>
          <dd className="font-mono tabular-nums text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
