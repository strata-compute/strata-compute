import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn, formatPercent, formatPoints } from "@/lib/utils";

export function deltaTone(value: number, threshold = 0.005) {
  if (value > threshold) return "up" as const;
  if (value < -threshold) return "down" as const;
  return "flat" as const;
}

const toneClass = {
  up: "text-green-ink",
  down: "text-red",
  flat: "text-muted",
};

/** Percentage change, e.g. +3.84% */
export function Delta({
  value,
  showIcon = true,
  digits = 2,
  size = "md",
  className,
}: {
  value: number;
  showIcon?: boolean;
  digits?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tone = deltaTone(value);
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono tabular-nums",
        toneClass[tone],
        size === "sm" && "text-[12px]",
        size === "md" && "text-[13px]",
        size === "lg" && "text-[15px]",
        className,
      )}
    >
      {showIcon ? (
        <Icon className={cn(size === "lg" ? "size-4" : "size-3.5")} strokeWidth={2.2} />
      ) : null}
      {formatPercent(value, digits)}
    </span>
  );
}

/** Score movement in points, e.g. +2.4 pts */
export function PointsDelta({
  value,
  suffix = "pts",
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const tone = deltaTone(value, 0.05);
  return (
    <span
      className={cn(
        "font-mono text-[12px] tabular-nums",
        toneClass[tone],
        className,
      )}
    >
      {formatPoints(value)}
      {suffix ? <span className="ml-0.5 text-[10.5px] opacity-70">{suffix}</span> : null}
    </span>
  );
}
