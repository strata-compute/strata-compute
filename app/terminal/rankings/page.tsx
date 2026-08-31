import type { Metadata } from "next";
import { loadIntelligenceEvents, loadMarkets } from "@/lib/data";
import { formatCompact } from "@/lib/utils";
import { MetaStrip, PageHeader } from "@/components/layout/page-header";
import { RankingsView } from "@/components/sections/rankings-view";
import { RankingsLiveBanner } from "@/components/sections/live-rankings";
import {
  DataUnavailable,
  FreshnessBadge,
  StaleNotice,
} from "@/components/data/data-state";
import { IntelligenceEventRow } from "@/components/data/intelligence-event";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "Rankings",
  description:
    "Every covered market ordered by Strata Score, momentum, volume, activity or 24h change.",
};

const HEADER = {
  eyebrow: "Rankings",
  title: "Ordered by computed strength",
  subtitle:
    "One ranking across stocks, crypto and onchain markets. Scores are cross-normalised, so position is comparable regardless of where an asset trades.",
};

/**
 * Intelligence about the ranking itself.
 *
 * Only the events that describe standing — positions gained or lost, and
 * composite strength moving. A volume expansion is real intelligence but it
 * says nothing about where an asset sits in this table, and putting it here
 * would imply that it does.
 */
const RANK_EVENT_TYPES = [
  "RANK_ACCELERATION",
  "RANK_DETERIORATION",
  "STRENGTH_ACCELERATION",
  "STRENGTH_DETERIORATION",
].join(",");

export default async function RankingsPage() {
  const [{ data, status, sources, ageSeconds, reason }, movement] = await Promise.all([
    loadMarkets({ limit: 300 }),
    loadIntelligenceEvents({ type: RANK_EVENT_TYPES, limit: 12 }),
  ]);

  // a ranking needs a field; one scored market is not a ranking
  if (!data || data.length < 2) {
    return (
      <div className="space-y-6">
        <PageHeader {...HEADER} />
        <DataUnavailable
          title="Insufficient live data to calculate rankings"
          reason={reason ?? "Rankings appear once at least two markets have been scored."}
          status={status}
        />
      </div>
    );
  }

  const withVolume = data.filter((a) => a.volume24h > 0);
  const advancing = data.filter((a) => a.change24h > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        {...HEADER}
        meta={
          <MetaStrip
            items={[
              { label: "Coverage", value: `${data.length} markets` },
              {
                label: "24h volume",
                value:
                  withVolume.length > 0
                    ? formatCompact(
                        withVolume.reduce((sum, a) => sum + a.volume24h, 0),
                        "$",
                      )
                    : "—",
              },
              { label: "Advancing", value: `${advancing}/${data.length}` },
              {
                label: "Data",
                value: (
                  <FreshnessBadge
                    status={status}
                    ageSeconds={ageSeconds}
                  />
                ),
              },
            ]}
          />
        }
      />
      <StaleNotice status={status} ageSeconds={ageSeconds} />
      <RankingsLiveBanner />

      {movement.data && movement.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Movement the engine has confirmed</CardTitle>
            <span className="font-mono text-[10.5px] text-faint">
              {movement.data.length} holding
            </span>
          </CardHeader>
          <CardBody className="p-0">
            {movement.data.map((event, i) => (
              <IntelligenceEventRow
                key={event.id ?? `${event.assetId}-${event.eventType}-${i}`}
                event={event}
              />
            ))}
          </CardBody>
        </Card>
      ) : null}

      <RankingsView assets={data} />
    </div>
  );
}
