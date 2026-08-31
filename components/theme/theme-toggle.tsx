"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";
import { THEME_OPTIONS, type ThemePreference } from "./theme";

const ICONS: Record<ThemePreference, React.ComponentType<{ className?: string }>> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

/**
 * Segmented theme control.
 *
 * Implemented as a radiogroup rather than a menu so all three states are
 * visible at once and reachable without opening anything. Roving tabindex:
 * one Tab stop for the group, arrow keys to move within it — the pattern
 * screen-reader users expect from a radio group.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference, ready } = useTheme();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: React.KeyboardEvent, index: number) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const last = THEME_OPTIONS.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (index + 1) % THEME_OPTIONS.length
            : (index - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;

    const option = THEME_OPTIONS[next];
    if (!option) return;
    setPreference(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {THEME_OPTIONS.map((option, index) => {
        const Icon = ICONS[option.value];
        // before storage is read, dark is both what is rendered and what is
        // stored by default, so the control is never briefly wrong
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option.label} theme`}
            tabIndex={selected ? 0 : -1}
            title={option.label}
            onClick={() => setPreference(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              "flex size-6 items-center justify-center rounded-[5px] outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-green-ink/50",
              selected
                ? "bg-surface-2 text-text"
                : "text-faint hover:text-muted",
              !ready && "opacity-90",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Full-width labelled variant for the mobile drawer, where an icon-only
 * control has no room for a tooltip and no hover state to reveal it.
 */
export function ThemeToggleRows({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("grid grid-cols-3 gap-1", className)}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option.value];
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(option.value)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 text-[11px] outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-green-ink/50",
              selected
                ? "border-border-strong bg-surface-2 text-text"
                : "border-border text-muted hover:text-text",
            )}
          >
            <Icon className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
