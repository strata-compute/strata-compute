"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onValueChange,
  placeholder = "Search markets...",
  className,
  autoFocusKey,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Key that focuses the field when pressed outside an input. */
  autoFocusKey?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!autoFocusKey) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === autoFocusKey && !typing) {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autoFocusKey]);

  return (
    <div
      className={cn(
        "group relative flex h-10 items-center gap-2.5 rounded-md border border-border bg-surface px-3 transition-colors duration-150 focus-within:border-border-strong",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-faint" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            ref.current?.focus();
          }}
          aria-label="Clear search"
          className="shrink-0 rounded-sm text-faint transition-colors hover:text-text"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
