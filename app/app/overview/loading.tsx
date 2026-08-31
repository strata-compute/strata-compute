import { HeaderSkeleton, MetricGridSkeleton, TableCardSkeleton } from "@/components/layout/skeletons";

export default function Loading() {
  return (
    <div className="space-y-10">
      <HeaderSkeleton wide />
      <MetricGridSkeleton />
      <TableCardSkeleton />
    </div>
  );
}
