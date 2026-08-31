import type { Metadata } from "next";
import { getHealth, type ApiHealth } from "@/lib/api";
import { Badge, Card, CardHeader, StatusDot } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page-header";
import { DataUnavailable } from "@/components/data/data-state";
import { subsystemFor } from "@/lib/subsystems";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "Status",
  description: "Pipeline health across ingestion, normalization, compute and delivery.",
};

/**
 * System status, read live from `/api/health`.
 *
 * This page previously rendered a hardcoded component list and an invented
 * incident log with fabricated uptime bars. All of it is gone: what is shown
 * here is the health the backend reports right now, and if the backend cannot
 * be reached the page says exactly that rather than claiming everything is
 * operational.
 */
export default async function StatusPage() {
  let health: ApiHealth | null = null;
  let reason: string | null = null;

  try {
    const result = await getHealth({ revalidate: 10 });
    health = result.data;
  } catch (error) {
    reason =
      error instanceof Error ? error.message : "The Strata API did not respond.";
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[1240px] space-y-6 px-5 pb-24 pt-28 sm:px-8 lg:pt-32">
      {children}
    </div>
  );

  if (!health) {
    return shell(
      <>
        <PageHeader
          eyebrow="Status"
          title="System status unavailable"
          subtitle="Strata could not reach its own API to report health."
        />
        <DataUnavailable title="Status unavailable" reason={reason} status="error" />
      </>,
    );
  }

  const providers = Object.entries(health.providers ?? {});
  const overall =
    health.status === "healthy"
      ? "All systems operational"
      : health.status === "degraded"
        ? "Partially degraded"
        : "Service disruption";

  return shell(
    <>
      <PageHeader
        eyebrow="Status"
        title={overall}
        subtitle="Live health of the computation pipeline. Every provider reports independently, so a degraded source never silently changes a published score."
        meta={
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4 text-[12.5px]">
            {[
              { label: "Mode", value: (health as { mode?: string }).mode ?? "—" },
              { label: "Store", value: health.store },
              { label: "Scoring version", value: health.version },
              {
                label: "Uptime",
                value: `${Math.floor(health.uptimeSeconds / 60)}m`,
              },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <dt className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
                  {item.label}
                </dt>
                <dd className="font-mono tabular-nums text-text">{item.value}</dd>
              </div>
            ))}
          </dl>
        }
      />

      <Card>
        <CardHeader>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
            Subsystems
          </span>
          <span className="font-mono text-[10.5px] text-faint">
            {providers.filter(([, p]) => p.status === "healthy").length}/
            {providers.length} healthy
          </span>
        </CardHeader>
        <ul>
          {providers.map(([name, provider]) => (
            <li
              key={name}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 px-5 py-3.5 last:border-b-0"
            >
              <StatusDot
                tone={provider.status === "healthy" ? "green" : "red"}
                pulse={provider.status === "healthy"}
              />
              <span className="w-52 text-[13px] text-text">
                {subsystemFor(name).label}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] text-muted">
                {subsystemFor(name).description}
              </span>
              {provider.latencyMs !== null && provider.latencyMs !== undefined ? (
                <span className="font-mono text-[12px] text-faint">
                  {Math.round(provider.latencyMs)}ms
                </span>
              ) : null}
              <Badge tone={provider.status === "healthy" ? "green" : "red"}>
                {provider.status}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
            Database
          </span>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
          <StatusDot tone={health.database.connected ? "green" : "amber"} />
          <span className="w-52 text-[13px] text-text">PostgreSQL</span>
          <span className="min-w-0 flex-1 text-[12.5px] text-muted">
            {health.database.detail ??
              (health.database.connected ? "Connected" : "Not connected")}
          </span>
          <Badge tone={health.database.connected ? "green" : "amber"}>
            {health.database.connected
              ? "connected"
              : health.database.configured
                ? "unreachable"
                : "not configured"}
          </Badge>
        </div>
      </Card>
    </>,
  );
}
