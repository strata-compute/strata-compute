import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { loadArenaCurrent } from "@/lib/data";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DataUnavailable } from "@/components/data/data-state";
import { LiveArena } from "@/components/sections/arena/live-arena";

export const metadata: Metadata = {
  title: "Arena",
  description:
    "Real markets competing on computed strength. HP is derived from the same components that produce a Strata Score.",
};

/**
 * Rendered per request, then kept current by the live stream. Static
 * prerendering would freeze a round's standings into the build output.
 */
export const dynamic = "force-dynamic";

export default async function ArenaPage() {
  const arena = await loadArenaCurrent();

  const header = (
    <PageHeader
      eyebrow="Arena"
      title="Real markets, computed strength"
      subtitle="Every entrant is drawn from the scored universe. HP moves with the same components that produce a Strata Score — never with a random number."
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href={routes.arenaHistory}>
            History
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      }
    />
  );

  if (!arena.data) {
    return (
      <div className="space-y-6">
        {header}
        <DataUnavailable
          title="No Arena round is open"
          reason={
            arena.reason ??
            "A round opens once enough markets have been scored to field one."
          }
          status={arena.status}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <LiveArena
        round={arena.data.round}
        entries={arena.data.entries}
        config={arena.data.config}
      />
    </div>
  );
}
