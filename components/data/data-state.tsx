import * as React from "react";
import { AlertTriangle, CloudOff, Clock } from "lucide-react";
import type { DataStatus } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Card, EmptyState, StatusDot } from "@/components/ui/primitives";

/**
 * The vocabulary for saying "we do not have this".
 *
 * These components exist so a page never has to choose between rendering a
 * number and rendering nothing: there is always a correct third option, which
 * is saying plainly what is missing and why.
 */

/**
 * PROVENANCE IS NOT PRODUCT.
 *
 * The API still returns `meta.sources` on every response, and the backend
 * still records which upstream produced which field — that is what makes the
 * data auditable. None of it is rendered here.
 *
 * A reader of Strata Compute is looking at Strata Compute. Which vendor
 * happened to serve a quote is an implementation detail of the platform, and
 * naming it in the interface both leaks infrastructure and implies the
 * reader should evaluate the vendor rather than the number.
 *
 * These components therefore accept no `sources` prop at all. Removing the
 * ability was deliberate: a prop that is accepted and ignored is a prop that
 * gets rendered again later.
 *
 * Freshness is a different matter and stays visible — see FreshnessBadge.
 * It describes the data, not its supplier.
 */

export function formatAge(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/* ---------------------------------------------------------- freshness --- */

const STATUS_META: Record<
  DataStatus,
  { label: string; tone: "green" | "amber" | "red" | "muted"; text: string }
> = {
  live: { label: "LIVE", tone: "green", text: "text-green-ink" },
  delayed: { label: "DELAYED", tone: "amber", text: "text-amber" },
  stale: { label: "STALE", tone: "amber", text: "text-amber" },
  unavailable: { label: "NO DATA", tone: "muted", text: "text-faint" },
  error: { label: "ERROR", tone: "red", text: "text-red" },
};

/**
 * Freshness badge. `LIVE` is only ever rendered when the backend asserted it —
 * this component never infers liveness from the presence of data.
 */
export function FreshnessBadge({
  status,
  ageSeconds,
  className,
}: {
  status: DataStatus;
  ageSeconds?: number | null;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const age = formatAge(ageSeconds ?? null);

  return (
    <span className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      <span className="flex items-center gap-1.5">
        <StatusDot tone={meta.tone} pulse={status === "live"} />
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.18em]",
            meta.text,
          )}
        >
          {meta.label}
        </span>
      </span>
      {age ? (
        <span className="font-mono text-[10.5px] text-faint">Updated {age}</span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------- unavailable --- */

/**
 * Shown in place of data, never alongside a partial rendering of it.
 * The reason comes from the backend so the message names the actual cause.
 */
export function DataUnavailable({
  title,
  reason,
  status = "unavailable",
  className,
}: {
  title: string;
  reason?: string | null;
  status?: DataStatus;
  className?: string;
}) {
  const isError = status === "error";
  return (
    <Card className={className}>
      <EmptyState
        icon={isError ? <AlertTriangle /> : <CloudOff />}
        title={title}
        description={
          reason ??
          (isError
            ? "The Strata API did not respond."
            : "No live data is available for this view yet.")
        }
      />
    </Card>
  );
}

/** Inline variant for a cell or a small panel. */
export function NoValue({ label = "—", hint }: { label?: string; hint?: string }) {
  return (
    <span
      className="font-mono text-[13px] text-faint"
      title={hint ?? "No live data available"}
    >
      {label}
    </span>
  );
}

/* --------------------------------------------------------------- stale --- */

/** Banner shown above data that is real but past its freshness window. */
export function StaleNotice({
  status,
  ageSeconds,
  className,
}: {
  status: DataStatus;
  ageSeconds?: number | null;
  className?: string;
}) {
  if (status !== "delayed" && status !== "stale") return null;

  const age = formatAge(ageSeconds ?? null);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border border-amber/25 bg-amber/6 px-4 py-2.5",
        className,
      )}
    >
      <Clock className="size-3.5 shrink-0 text-amber" />
      <span className="text-[12.5px] text-amber">
        {status === "stale" ? "Stale data" : "Delayed data"}
      </span>
      <span className="text-[12.5px] text-muted">
        This is the most recent observation Strata holds, not a live quote.
      </span>
      <span className="ml-auto font-mono text-[11px] text-faint">
        {age ? `Last update ${age}` : null}
      </span>
    </div>
  );
}

/* -------------------------------------------------------- awaiting ------ */

/**
 * For a value that requires a computation which has not run. Distinct from
 * "unavailable": the input may exist, the output does not yet.
 */
export function AwaitingComputation({
  label = "Awaiting computation",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-col gap-1", className)}>
      <span className="font-mono text-[32px] leading-none text-faint">—</span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
        {label}
      </span>
    </span>
  );
}
