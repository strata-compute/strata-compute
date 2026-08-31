import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { CompareView } from "@/components/sections/compare-view";

export const metadata: Metadata = {
  title: "Compare",
  description: "Place two to four markets side by side on identical computed inputs.",
};

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ assets?: string }>;
}) {
  const { assets } = await searchParams;

  // a shared link can preselect the comparison; the symbols are still
  // resolved against the real universe before anything is rendered
  const initial = (assets ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compare"
        title="Side by side, same inputs"
        subtitle="Every column is computed from the same pass, so the numbers are comparable. A metric one market has and another does not is shown as absent on both."
      />
      <CompareView initial={initial} />
    </div>
  );
}
