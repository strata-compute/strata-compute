import * as React from "react";
import Link from "next/link";
import type { ApiIntelligenceEvent } from "@/lib/api";
import {
  INTELLIGENCE_META,
  agreementLabel,
  confidenceBand,
  driverSentence,
  heldForLabel,
  magnitudeLabel,
  type IntelligenceTone,
} from "@/lib/intelligence-meta";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { AssetLogo } from "@/components/data/asset-logo";
import { AssetClassTag } from "@/components/data/asset-identity";

/**
 * An intelligence event, rendered as the evidence that produced it.
 *
 * The card states what was measured and against what — never what to do about
 * it. Every figure on it comes from the event: the magnitude in its own unit,
 * the drivers with their observed and baseline values, how long the condition
 * has held. Nothing is computed here.
 *
 * Where the components disagree, the card says so. Conflicting evidence is a
 * finding; hiding it behind a confident-looking headline would be the one
 * thing this layer must not do.
 */

const toneStyles: Record<IntelligenceTone, { tile: string; text: string; rail: string }> = {
  positive: {
    tile: "border-green-ink/25 bg-green-ink/8 text-green-ink",
    text: "text-green-ink",
    rail: "bg-green-ink",
  },
  negative: {
    tile: "border-red/25 bg-red/8 text-red",
    text: "text-red",
    rail: "bg-red",
  },
  caution: {
    tile: "border-amber/25 bg-amber/8 text-amber",
    text: "text-amber",
    rail: "bg-amber",
  },
  info: {
    tile: "border-blue/25 bg-blue/8 text-blue",
    text: "text-blue",
    rail: "bg-blue",
  },
};

const severityStyles: Record<string, string> = {
  critical: "border-red/30 bg-red/10 text-red",
  high: "border-amber/30 bg-amber/10 text-amber",
  medium: "border-border-strong bg-surface-2 text-muted",
  low: "border-border bg-surface-2 text-faint",
};

function SeverityTag({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        "rounded-[3px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide",
        severityStyles[severity] ?? severityStyles.low,
      )}
    >
      {severity}
    </span>
  );
}

/** Market-wide events belong to no asset and must not pretend otherwise. */
function EventSubject({ event }: { event: ApiIntelligenceEvent }) {
  if (!event.symbol) {
    return (
      <span className="text-[13.5px] font-medium text-text">Across the covered market</span>
    );
  }
  return (
    <Link
      href={routes.asset(event.symbol)}
      className="flex items-center gap-1.5 text-[13.5px] font-medium text-text transition-colors hover:text-green-ink"
    >
      <AssetLogo asset={{ symbol: event.symbol, logoUrl: null }} size="xs" />
      {event.symbol}
    </Link>
  );
}

export function IntelligenceEventCard({
  event,
  className,
}: {
  event: ApiIntelligenceEvent;
  className?: string;
}) {
  const meta = INTELLIGENCE_META[event.eventType];
  const tone = toneStyles[meta?.tone ?? "info"];
  const conflicted = event.driverAgreement < 0;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-200 hover:border-border-strong",
        className,
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-px opacity-60", tone.rail)}
        aria-hidden
      />
      <div className="flex gap-4 p-4 pl-5">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border font-mono text-[12px]",
            tone.tile,
          )}
          aria-hidden
        >
          {meta?.glyph ?? "•"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <EventSubject event={event} />
            <span className={cn("text-[12.5px]", tone.text)}>
              {meta?.label ?? event.eventType}
            </span>
            {event.assetType ? <AssetClassTag assetClass={event.assetType} /> : null}
            <SeverityTag severity={event.severity} />
            {event.status === "resolved" || event.status === "expired" ? (
              <span className="rounded-[3px] border border-border bg-surface-2 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-faint">
                {event.status}
              </span>
            ) : null}
          </div>

          <p className="mt-1.5 text-[13px] leading-relaxed text-text/90">
            {meta?.blurb ?? "A computed condition crossed its significance threshold."}
          </p>

          {event.drivers.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {event.drivers.slice(0, 4).map((driver, i) => (
                <li
                  key={`${driver.metric}-${i}`}
                  className="font-mono text-[11.5px] leading-relaxed text-muted"
                >
                  <span
                    className={cn(
                      "mr-1.5",
                      driver.direction === "up"
                        ? "text-green-ink"
                        : driver.direction === "down"
                          ? "text-red"
                          : "text-faint",
                    )}
                    aria-hidden
                  >
                    {driver.direction === "up" ? "↑" : driver.direction === "down" ? "↓" : "→"}
                  </span>
                  {driverSentence(driver)}
                </li>
              ))}
            </ul>
          ) : null}

          {conflicted ? (
            <p className="mt-2 text-[12px] leading-relaxed text-amber">
              Components disagree on this one — the evidence behind it is mixed.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-faint">
            <span>
              <span className="text-muted">{magnitudeLabel(event)}</span>
            </span>
            <span>
              confidence <span className="text-muted">{confidenceBand(event.confidence)}</span>
            </span>
            <span className="hidden sm:inline">{agreementLabel(event.driverAgreement)}</span>
            <span>
              seen <span className="text-muted">{event.observations}×</span>
            </span>
            <span className="ml-auto">held {heldForLabel(event)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Condensed variant for panels beside other content. */
export function IntelligenceEventRow({
  event,
  className,
}: {
  event: ApiIntelligenceEvent;
  className?: string;
}) {
  const meta = INTELLIGENCE_META[event.eventType];
  const tone = toneStyles[meta?.tone ?? "info"];

  const body = (
    <>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-[4px] border font-mono text-[10.5px]",
          tone.tile,
        )}
        aria-hidden
      >
        {meta?.glyph ?? "•"}
      </span>
      <span className="w-14 shrink-0 text-[12.5px] font-medium text-text">
        {event.symbol ?? "Market"}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
        {meta?.label ?? event.eventType}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-faint">
        {magnitudeLabel(event)}
      </span>
    </>
  );

  const shell = cn(
    "flex items-center gap-3 border-b border-border/70 px-4 py-3 transition-colors last:border-b-0",
    className,
  );

  return event.symbol ? (
    <Link href={routes.asset(event.symbol)} className={cn(shell, "hover:bg-surface-2/60")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
