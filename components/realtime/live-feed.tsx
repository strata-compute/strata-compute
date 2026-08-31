"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Radio, RefreshCw, Swords, TrendingUp, Zap } from "lucide-react";
import {
  categoryOf,
  EVENT_LABEL,
  type EventCategory,
  type EventType,
  type StrataEvent,
} from "@/lib/realtime/events";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { useEvents, useStream } from "./stream-provider";

/**
 * THE LIVE FEED
 *
 * What the computation layer has just observed, newest first, with the values
 * that produced each entry. Every line is a backend event; nothing here is
 * generated, inferred, or padded to make the feed look busy.
 *
 * When nothing is happening the feed says so. A market where no score crossed
 * a threshold in the last minute is a quiet market, and showing that plainly
 * is more useful than inventing activity to fill the panel.
 */

const ICONS: Partial<Record<EventType, React.ComponentType<{ className?: string }>>> = {
  STRATA_SCORE_CHANGED: TrendingUp,
  RANK_CHANGED: TrendingUp,
  SIGNAL_DETECTED: Zap,
  VOLUME_ACCELERATION: Zap,
  EARLY_MOVER_DETECTED: Radio,
  ANOMALY_DETECTED: AlertTriangle,
  MARKET_REGIME_CHANGED: Radio,
  ARENA_UPDATE: Swords,
  ARENA_ELIMINATION: Swords,
  ARENA_WINNER: Swords,
};

const SEVERITY_TONE: Record<StrataEvent["severity"], string> = {
  info: "text-muted",
  notable: "text-text",
  important: "text-green-ink",
};

function relativeTime(timestamp: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/* ------------------------------------------------------ connection --- */

export function ConnectionStatus({ className }: { className?: string }) {
  const { state, retry, reconnectAttempts } = useStream();

  if (state === "live") {
    return (
      <span className={cn("flex items-center gap-1.5", className)}>
        <span className="size-1.5 animate-live-pulse rounded-full bg-green-ink" aria-hidden />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-green-ink">
          Live
        </span>
      </span>
    );
  }

  if (state === "connecting") {
    return (
      <span className={cn("flex items-center gap-1.5", className)}>
        <span className="size-1.5 rounded-full bg-faint" aria-hidden />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-faint">
          Connecting
        </span>
      </span>
    );
  }

  if (state === "reconnecting") {
    return (
      <span className={cn("flex items-center gap-1.5", className)}>
        <span className="size-1.5 rounded-full bg-amber" aria-hidden />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-amber">
          Reconnecting
        </span>
        <span className="font-mono text-[10px] text-faint">#{reconnectAttempts}</span>
      </span>
    );
  }

  if (state === "lost") {
    return (
      <span className={cn("flex items-center gap-2", className)}>
        <span className="size-1.5 rounded-full bg-red" aria-hidden />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-red">
          Live connection lost
        </span>
        <button
          type="button"
          onClick={retry}
          className="flex items-center gap-1 font-mono text-[10.5px] text-muted transition-colors hover:text-text"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      </span>
    );
  }

  return null;
}

/* ------------------------------------------------------------ feed --- */

export function EventRow({
  event,
  now,
  className,
}: {
  event: StrataEvent;
  now: number;
  className?: string;
}) {
  const Icon = ICONS[event.eventType] ?? Radio;

  const body = (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          {EVENT_LABEL[event.eventType]}
        </span>
        {event.symbol ? (
          <span className="text-[13px] font-medium text-text">{event.symbol}</span>
        ) : null}
        {event.change !== null ? (
          <span
            className={cn(
              "font-mono text-[11.5px] tabular-nums",
              event.change > 0 ? "text-green-ink" : event.change < 0 ? "text-red" : "text-muted",
            )}
          >
            {event.change > 0 ? "+" : ""}
            {event.change.toFixed(event.eventType === "RANK_CHANGED" ? 0 : 2)}
          </span>
        ) : null}
      </span>
      <span className={cn("text-[12.5px] leading-relaxed", SEVERITY_TONE[event.severity])}>
        {event.summary}
      </span>
    </span>
  );

  return (
    <li
      className={cn(
        "flex items-start gap-3 py-3 animate-rise",
        className,
      )}
    >
      {event.symbol ? (
        <AssetLogo
          asset={{ symbol: event.symbol, logoUrl: event.logoUrl }}
          size="xs"
          className="mt-0.5"
        />
      ) : (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-border text-faint">
          <Icon className="size-3" />
        </span>
      )}

      {event.symbol ? (
        <Link
          href={routes.asset(event.symbol)}
          className="flex min-w-0 flex-1 rounded-sm outline-none transition-opacity hover:opacity-80"
        >
          {body}
        </Link>
      ) : (
        body
      )}

      <span className="shrink-0 font-mono text-[10.5px] text-faint">
        {relativeTime(event.timestamp, now)}
      </span>
    </li>
  );
}

const FILTERS: { value: EventCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "market", label: "Market" },
  { value: "signals", label: "Signals" },
  { value: "arena", label: "Arena" },
];

export function LiveFeed({
  limit = 20,
  filterable = true,
  className,
}: {
  limit?: number;
  filterable?: boolean;
  className?: string;
}) {
  const [category, setCategory] = React.useState<EventCategory | "all">("all");
  const events = useEvents(category);
  const { state } = useStream();

  // one clock for the whole list, ticking on an interval, so relative times
  // stay current without every row holding a timer
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = events.slice(0, limit);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Live activity</CardTitle>
        <ConnectionStatus />
      </CardHeader>

      {filterable ? (
        <div className="flex gap-1 border-b border-border px-4 py-2.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setCategory(filter.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11.5px] transition-colors duration-150",
                category === filter.value
                  ? "bg-surface-2 text-text"
                  : "text-muted hover:text-text",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}

      <CardBody className="py-0">
        {visible.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] leading-relaxed text-muted">
            {state === "lost"
              ? "The live connection was lost. Events will resume when it is restored."
              : state === "live"
                ? "No events yet. Entries appear as computation detects a change worth reporting."
                : "Waiting for live data."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((event) => (
              <EventRow key={event.id} event={event} now={now} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
