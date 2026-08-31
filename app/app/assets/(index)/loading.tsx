import { CardGridSkeleton, HeaderSkeleton } from "@/components/layout/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <CardGridSkeleton count={9} />
    </div>
  );
}
