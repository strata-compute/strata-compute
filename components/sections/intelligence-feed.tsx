"use client";

import * as React from "react";
import type { ApiIntelligenceEvent, ApiIntelligenceSeverity } from "@/lib/api";
import {
  INTELLIGENCE_META,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
} from "@/lib/intelligence-meta";
import { IntelligenceEventCard } from "@/components/data/intelligence-event";
import { cn } from "@/lib/utils";

/**
 * THE INTELLIGENCE FEED
 *
 * Detected conditions, ordered by the priority the engine assigned them and
 * filterable by what they are and how severe they are.
 *
 * Filtering happens over what the server already sent. The list is bounded,
 * so re-requesting per filter would trade a network round trip for nothing —
 * and would let a filter silently change which events exist rather than which
 * are shown.
 */

type TypeFilter = "all" | string;
type SeverityFilter = "all" | ApiIntelligenceSeverity;

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[4px] border px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors",
        active
          ? "border-green-ink/40 bg-green-ink/10 text-green-ink"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

export function IntelligenceFeed({
  events,
  className,
}: {
  events: ApiIntelligenceEvent[];
  className?: string;
}) {
  const [type, setType] = React.useState<TypeFilter>("all");
  const [severity, setSeverity] = React.useState<SeverityFilter>("all");

  // only offer filters that would actually match something
  const presentTypes = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const presentSeverities = React.useMemo(
    () => SEVERITY_ORDER.filter((s) => events.some((e) => e.severity === s)),
    [events],
  );

  const visible = React.useMemo(
    () =>
      events.filter(
        (event) =>
          (type === "all" || event.eventType === type) &&
          (severity === "all" || event.severity === severity),
      ),
    [events, type, severity],
  );

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterButton active={type === "all"} onClick={() => setType("all")}>
          All {events.length}
        </FilterButton>
        {presentTypes.map(([eventType, count]) => (
          <FilterButton
            key={eventType}
            active={type === eventType}
            onClick={() => setType(eventType)}
          >
            {INTELLIGENCE_META[eventType as keyof typeof INTELLIGENCE_META]?.label ??
              eventType}{" "}
            {count}
          </FilterButton>
        ))}
      </div>

      {presentSeverities.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
            Severity
          </span>
          <FilterButton active={severity === "all"} onClick={() => setSeverity("all")}>
            Any
          </FilterButton>
          {presentSeverities.map((value) => (
            <FilterButton
              key={value}
              active={severity === value}
              onClick={() => setSeverity(value)}
            >
              {SEVERITY_LABEL[value]}
            </FilterButton>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-muted">
          No events match this filter.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((event, i) => (
            <IntelligenceEventCard
              key={event.id ?? `${event.assetId}-${event.eventType}-${i}`}
              event={event}
            />
          ))}
        </div>
      )}
    </div>
  );
}
