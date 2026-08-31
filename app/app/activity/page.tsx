import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { LiveFeed } from "@/components/realtime/live-feed";
import { IntelligenceFeed } from "@/components/sections/intelligence-feed";
import { DataUnavailable } from "@/components/data/data-state";
import { loadIntelligenceEvents } from "@/lib/data";

export const metadata: Metadata = {
  title: "Activity",
  description:
    "Detected intelligence and the raw event stream behind it, newest first.",
};

export const dynamic = "force-dynamic";

/**
 * Two views of the same market, deliberately kept apart.
 *
 * Intelligence is the interpreted layer: conditions that persisted long
 * enough, and cleared enough evidence, to be worth naming. The event stream
 * below it is everything the engine emitted, unfiltered.
 *
 * They are not merged. An interpreted finding and a raw emission are
 * different kinds of claim, and interleaving them would let the weaker one
 * borrow the authority of the stronger.
 */
export default async function ActivityPage() {
  const intelligence = await loadIntelligenceEvents({ limit: 80 });

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Activity"
        title="What the engine has detected"
        subtitle="Conditions that held long enough to be significant, followed by the full stream of computed events — ordered newest first."
      />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[15px] font-medium text-text">Active intelligence</h2>
          <p className="text-[12px] text-faint">
            Each entry is one condition, held across passes — not one entry per pass.
          </p>
        </div>

        {intelligence.data && intelligence.data.length > 0 ? (
          <IntelligenceFeed events={intelligence.data} />
        ) : (
          <DataUnavailable
            title="Nothing significant is happening right now"
            reason={
              intelligence.reason ??
              "Intelligence appears when a computed condition clears its significance threshold and holds. A quiet market is a real finding."
            }
            status={intelligence.status}
          />
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[15px] font-medium text-text">Event stream</h2>
          <p className="text-[12px] text-faint">
            Everything emitted, before any significance filter.
          </p>
        </div>
        <LiveFeed limit={200} />
      </section>
    </div>
  );
}
