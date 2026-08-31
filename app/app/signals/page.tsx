import type { Metadata } from "next";
import { toAssetClassOrNull } from "@/lib/api/adapters";
import { loadIntelligenceEvents, loadSignals } from "@/lib/data";
import { MetaStrip, PageHeader } from "@/components/layout/page-header";
import { SignalsView } from "@/components/sections/signals-view";
import { DataUnavailable, FreshnessBadge } from "@/components/data/data-state";
import { IntelligenceEventCard } from "@/components/data/intelligence-event";
import type { Signal, SignalKind } from "@/lib/types";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "Signals",
  description: "Computed events across modern markets.",
};

const HEADER = {
  eyebrow: "Signals",
  title: "Signals",
  subtitle:
    "Computed events across modern markets. A signal is emitted whenever a factor breaks its own baseline — never on a fixed price threshold.",
};

/**
 * Intelligence shown above the signals, not mixed into them.
 *
 * A signal is a threshold crossing at an instant. An intelligence event is a
 * condition that has held across passes and cleared a significance test. The
 * second is a stronger claim than the first, and merging the two lists would
 * quietly promote every signal to the standing of a finding.
 */
const INTELLIGENCE_LIMIT = 8;

/** Backend signal types map onto the UI's own kinds; unknown kinds are dropped. */
const KIND_MAP: Record<string, SignalKind> = {
  MOMENTUM_SPIKE: "momentum-spike",
  VOLUME_ACCELERATION: "volume-acceleration",
  UNUSUAL_ACTIVITY: "unusual-activity",
  LIQUIDITY_SHIFT: "liquidity-drop",
  PRICE_BREAKOUT: "momentum-spike",
  RANK_CHANGE: "new-market",
};

export default async function SignalsPage() {
  const [{ data, status, sources, ageSeconds, reason }, intelligence] = await Promise.all([
    loadSignals({ limit: 100 }),
    loadIntelligenceEvents({ limit: INTELLIGENCE_LIMIT }),
  ]);

  const standing = intelligence.data ?? [];

  if (!data || data.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader {...HEADER} />
        {standing.length > 0 ? <StandingIntelligence events={standing} /> : null}
        <DataUnavailable
          title="No active signals detected"
          reason={
            reason ??
            "Signals appear the moment a computed factor breaks its own baseline."
          }
          status={status}
        />
      </div>
    );
  }

  const now = Date.now();
  const signals: Signal[] = data
    .filter((s) => KIND_MAP[s.signalType])
    .map((s) => ({
      id: s.id ?? `${s.assetId}-${s.signalType}-${s.timestamp}`,
      symbol: s.symbol,
      // identity is joined from the asset record by the API, never guessed
      name: s.name ?? s.symbol,
      assetClass: toAssetClassOrNull(s.assetType),
      logoUrl: s.logoUrl,
      kind: KIND_MAP[s.signalType] as SignalKind,
      magnitude: s.value,
      minutesAgo: Math.max(
        0,
        Math.round((now - new Date(s.timestamp).getTime()) / 60_000),
      ),
      summary: String(s.metadata?.summary ?? describeSignal(s.signalType, s.value)),
      detail: String(s.metadata?.detail ?? detailFor(s.metadata)),
      scoreImpact: Number(s.metadata?.scoreImpact ?? 0),
    }));

  const strongest = Math.max(...data.map((s) => s.value));

  return (
    <div className="space-y-8">
      <PageHeader
        {...HEADER}
        meta={
          <MetaStrip
            items={[
              { label: "Emitted", value: data.length },
              { label: "Strongest", value: strongest.toFixed(1) },
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
      {standing.length > 0 ? <StandingIntelligence events={standing} /> : null}
      <SignalsView signals={signals} />
    </div>
  );
}

/** Conditions that have held, above the instantaneous crossings. */
function StandingIntelligence({
  events,
}: {
  events: NonNullable<Awaited<ReturnType<typeof loadIntelligenceEvents>>["data"]>;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-medium text-text">Standing intelligence</h2>
        <p className="text-[12px] text-faint">
          Conditions still holding, with the evidence behind them.
        </p>
      </div>
      <div className="space-y-2">
        {events.map((event, i) => (
          <IntelligenceEventCard
            key={event.id ?? `${event.assetId}-${event.eventType}-${i}`}
            event={event}
          />
        ))}
      </div>
    </section>
  );
}

function describeSignal(type: string, value: number): string {
  const label = type.toLowerCase().replace(/_/g, " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} at ${value.toFixed(2)}`;
}

/** Renders whatever the detector actually recorded — nothing is invented. */
function detailFor(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "";
  const parts = Object.entries(metadata)
    .filter(([key]) => !["summary", "detail", "isMock", "source"].includes(key))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(" · ");
}
