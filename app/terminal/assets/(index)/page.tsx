import type { Metadata } from "next";
import { loadAssetList } from "@/lib/data";
import { Kbd } from "@/components/ui/primitives";
import { MetaStrip, PageHeader } from "@/components/layout/page-header";
import { AssetsView } from "@/components/sections/assets-view";
import {
  DataUnavailable,
  FreshnessBadge,
  StaleNotice,
} from "@/components/data/data-state";

/**
 * Rendered per request. Static prerendering would freeze a market snapshot
 * into the build output and keep serving it after the data went stale or the
 * backend became unreachable.
 */
export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "Assets",
  description:
    "Search and browse every market in the Strata compute set across stocks, crypto and onchain venues.",
};

export default async function AssetsPage() {
  const { data, status, sources, ageSeconds, reason } = await loadAssetList();

  const header = (
    <PageHeader
      eyebrow="Assets"
      title="Market discovery"
      subtitle="Every market Strata covers, scored on the same inputs. Open any asset for its full factor breakdown and computation history."
      actions={
        <span className="hidden items-center gap-1.5 text-[12px] text-faint sm:flex">
          Press <Kbd>S</Kbd> to search
        </span>
      }
    />
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <DataUnavailable
          title="Market data unavailable"
          reason={reason}
          status={status}
        />
      </div>
    );
  }

  const byClass = (cls: string) => data.filter((a) => a.assetClass === cls).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assets"
        title="Market discovery"
        subtitle="Every market Strata covers, scored on the same inputs. Open any asset for its full factor breakdown and computation history."
        actions={
          <span className="hidden items-center gap-1.5 text-[12px] text-faint sm:flex">
            Press <Kbd>S</Kbd> to search
          </span>
        }
        meta={
          <MetaStrip
            items={[
              { label: "Total", value: data.length },
              { label: "Stocks", value: byClass("stock") },
              { label: "Crypto", value: byClass("crypto") },
              { label: "Onchain", value: byClass("onchain") },
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
      <AssetsView assets={data} />
    </div>
  );
}
