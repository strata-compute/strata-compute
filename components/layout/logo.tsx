import * as React from "react";
import { cn } from "@/lib/utils";

/** The strata mark — three sedimentary layers, the active one in green. */
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
      <path
        d="M12 3.2 21 7.4 12 11.6 3 7.4 12 3.2Z"
        fill="var(--color-green-ink)"
      />
      <path
        d="M12 3.2 21 7.4 12 11.6 3 7.4 12 3.2Z"
        stroke="var(--color-green-ink)"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M3.4 12 12 16 20.6 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M3.4 16.6 12 20.6 20.6 16.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.28"
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
