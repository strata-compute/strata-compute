"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * Keyboard-navigable segmented control used for tabs and range pickers.
 * Arrow keys move between options; Home/End jump to the ends.
 */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        // max-w-full + scroll: the row keeps its shape and scrolls itself
          // rather than pushing the document sideways on a narrow screen
          "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "relative rounded-[5px] font-medium transition-colors duration-150",
              size === "sm"
                ? "px-2.5 py-1 text-[12px]"
                : "px-3 py-1.5 text-[12.5px]",
              active
                ? "bg-elevated text-text shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                : "text-muted hover:text-text",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "ml-1.5 font-mono text-[10.5px]",
                  active ? "text-faint" : "text-faint/70",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
