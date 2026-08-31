"use client";

import * as React from "react";
import { cn, SESSION_ANCHOR } from "@/lib/utils";
import { StatusDot } from "@/components/ui/primitives";
import { useStream } from "@/components/realtime/stream-provider";

function formatUtc(date: Date) {
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}`;
}

/**
 * How each connection state is presented.
 *
 * The badge used to read LIVE unconditionally — a pulsing green claim that
 * stayed exactly as confident with the backend unreachable as with it
 * answering. It is the most prominent status in the interface, so it was also
 * the most misleading thing in it.
 *
 * It now reads the same stream state every live surface reads. Outside the
 * console there is no provider and the state is `idle`, which renders as a
 * neutral clock rather than a claim about data nobody is showing.
 */
const STATE_META: Record<
  string,
  { label: string; tone: "green" | "amber" | "red" | "muted"; text: string; pulse: boolean }
> = {
  live: { label: "Live", tone: "green", text: "text-green-ink", pulse: true },
  connecting: { label: "Connecting", tone: "amber", text: "text-amber", pulse: true },
  reconnecting: { label: "Reconnecting", tone: "amber", text: "text-amber", pulse: true },
  lost: { label: "Offline", tone: "red", text: "text-red", pulse: false },
  idle: { label: "Idle", tone: "muted", text: "text-faint", pulse: false },
};

/**
 * Connection badge with a UTC compute clock.
 *
 * The clock starts from the fixed session anchor so server and client markup
 * agree, then switches to the real clock after hydration.
 */
export function LiveIndicator({
  className,
  showClock = true,
}: {
  className?: string;
  showClock?: boolean;
}) {
  const { state } = useStream();
  const [clock, setClock] = React.useState(() => formatUtc(SESSION_ANCHOR));

  React.useEffect(() => {
    const tick = () => setClock(formatUtc(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const meta = STATE_META[state] ?? STATE_META.idle!;

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex items-center gap-1.5">
        <StatusDot tone={meta.tone} pulse={meta.pulse} />
        <span
          className={cn(
            "text-[10.5px] font-medium uppercase tracking-[0.18em]",
            meta.text,
          )}
        >
          {meta.label}
        </span>
      </span>
      {showClock ? (
        <>
          <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />
          <span className="hidden font-mono text-[11.5px] tabular-nums text-muted sm:inline">
            {clock}
            <span className="ml-1 text-faint">UTC</span>
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Sidebar footer indicator.
 *
 * This previously incremented a "compute events" counter with `Math.random()`
 * every 1.8 seconds — a number that corresponded to nothing and looked
 * exactly like telemetry. It now renders only what the caller passes in from
 * the backend, and renders a dash when there is nothing to report.
 *
 * The dash is the point: an absent count is shown as absent. Substituting a
 * zero would read as "the engine computed nothing", which is a different
 * claim from "we are not being told".
 */
export function ComputeHeartbeat({
  events,
  className,
}: {
  /** Events reported by the backend. `null`/omitted renders as unknown. */
  events?: number | null;
  className?: string;
}) {
  const { state } = useStream();
  const meta = STATE_META[state] ?? STATE_META.idle!;

  return (
    <div
      className={cn(
        "mt-4 flex items-center justify-between rounded-md border border-border bg-surface/60 px-2.5 py-2",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <StatusDot tone={meta.tone} pulse={meta.pulse} />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          Compute
        </span>
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted">
        {events === null || events === undefined ? "—" : events.toLocaleString()}
      </span>
    </div>
  );
}
