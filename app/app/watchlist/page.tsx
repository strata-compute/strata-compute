import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { WatchlistView } from "@/components/sections/watchlist-view";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "The markets you are tracking, scored and updated live.",
};

/**
 * The watchlist is stored in the reader's browser, so the page shell is
 * server-rendered and the rows are fetched client-side from the symbols in
 * localStorage. Nothing about the list is prerenderable.
 */
export const dynamic = "force-dynamic";

export default function WatchlistPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Watchlist"
        title="What you are tracking"
        subtitle="Scores, ranks and signals for the markets you have added, updating as computation runs. The list is stored in this browser."
      />
      <WatchlistView />
    </div>
  );
}
