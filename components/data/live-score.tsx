"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ScoreValue } from "@/components/data/score";
import { ScoreDelta } from "@/components/data/intelligence";
import { useAssetEvents } from "@/components/realtime/stream-provider";

/**
 * A Strata Score that updates when the computation layer publishes a new one.
 *
 * The server-rendered value is the starting point; a STRATA_SCORE_CHANGED
 * event for this asset carries both the previous and the new score, so the
 * component updates from the event itself rather than refetching.
 *
 * Two restraints. The number changes and the delta appears — nothing flashes,
 * and the surrounding page does not animate, because a score moving 1.2
 * points is not an occasion. And when the stream is silent the value simply
 * stays as rendered: an old number is honestly old, and the freshness label
 * beside it already says so.
 */
export function LiveScore({
  assetId,
  initialScore,
  size = "xl",
  className,
}: {
  assetId: string;
  initialScore: number | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const events = useAssetEvents(assetId);
  const [score, setScore] = React.useState(initialScore);
  const [delta, setDelta] = React.useState<number | null>(null);

  // a navigation to another asset resets to whatever the server rendered
  React.useEffect(() => {
    setScore(initialScore);
    setDelta(null);
  }, [initialScore, assetId]);

  React.useEffect(() => {
    const latest = events.find(
      (event) => event.eventType === "STRATA_SCORE_CHANGED",
    );
    if (!latest || typeof latest.newValue !== "number") return;

    setScore(latest.newValue);
    setDelta(latest.change);

    // the delta is a report of a change, not a permanent property of the
    // score, so it fades rather than accumulating on screen
    const timer = window.setTimeout(() => setDelta(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [events]);

  return (
    <span className={cn("flex items-baseline gap-3", className)}>
      <ScoreValue score={score} size={size} />
      {delta !== null ? <ScoreDelta change={delta} /> : null}
    </span>
  );
}
