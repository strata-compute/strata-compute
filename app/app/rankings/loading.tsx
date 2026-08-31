import { HeaderSkeleton, TableCardSkeleton } from "@/components/layout/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <TableCardSkeleton rows={12} />
    </div>
  );
}
