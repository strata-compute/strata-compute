"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Fades and lifts its children the first time they enter the viewport.
 * A `<noscript>` rule in the marketing layout keeps content visible when
 * JavaScript never runs.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  /** Stagger in milliseconds. */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const ref = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.setAttribute("data-reveal", "in");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-reveal=""
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
      className={className}
    >
      {children}
    </Tag>
  );
}

/** Small green label that opens every section. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.26em] text-green-ink",
        className,
      )}
    >
      <span className="h-1 w-1 rounded-full bg-green-ink" aria-hidden />
      {children}
    </span>
  );
}

export function SectionShell({
  id,
  children,
  className,
  bordered = true,
  width = "default",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  bordered?: boolean;
  width?: "default" | "wide";
}) {
  return (
    <section
      id={id}
      className={cn(bordered && "border-t border-border", className)}
    >
      <div
        className={cn(
          "mx-auto w-full px-5 py-20 sm:px-8 lg:py-28",
          width === "wide" ? "max-w-[1440px]" : "max-w-[1240px]",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Eyebrow + headline + supporting copy, shared by every section. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  className,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <Reveal
      className={cn(
        "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between",
        align === "center" && "items-center text-center lg:flex-col",
        className,
      )}
    >
      <div className={cn("max-w-2xl space-y-5", align === "center" && "mx-auto")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {/* section headlines run in caps to match the hero statement */}
        <h2 className="text-[clamp(24px,3.6vw,38px)] font-semibold uppercase leading-[1.06] tracking-[-0.03em] text-text">
          {title}
        </h2>
        {description ? (
          <div className="max-w-xl text-[14.5px] leading-relaxed text-muted">
            {description}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </Reveal>
  );
}

/** Percent value in the shared up/down colour language. */
export function ChangeValue({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        value >= 0 ? "text-green-ink" : "text-red",
        className,
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}
