import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The strata mark — an S built only from beds.
 *
 * Three horizontal layers and two verticals: the S is the initial, and the
 * layers are what *strata* means, so the mark says the name twice over. It
 * replaced a stacked diamond, which read as the generic "layers" icon.
 *
 * The accent follows the theme rather than being fixed, because
 * --color-green-ink is deliberately a different value in light mode — lime on
 * white is illegible. Everything else is currentColor, so the mark inherits
 * whatever the surface around it is using.
 */
export function LogoMark({
  className,
  size = 22,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect x="5" y="4.6" width="14" height="3.1" rx="1.2" fill="currentColor" />
      <rect
        x="5"
        y="10.4"
        width="14"
        height="3.1"
        rx="1.2"
        fill="var(--color-green-ink)"
      />
      <rect x="5" y="16.2" width="14" height="3.1" rx="1.2" fill="currentColor" />
      <rect x="5" y="4.6" width="3.1" height="8.9" rx="1.2" fill="currentColor" />
      <rect
        x="15.9"
        y="10.4"
        width="3.1"
        height="8.9"
        rx="1.2"
        fill="currentColor"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-col leading-none", className)}>
      <span className="text-[13px] font-semibold tracking-[0.13em] text-text">
        STRATA
      </span>
      <span className="mt-0.5 text-[9.5px] font-medium tracking-[0.28em] text-faint">
        COMPUTE
      </span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-text", className)}>
      <LogoMark />
      <Wordmark />
    </span>
  );
}
