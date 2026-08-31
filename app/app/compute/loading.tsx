import { HeaderSkeleton } from "@/components/layout/skeletons";
import { Card, Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-8">
      <HeaderSkeleton wide />
      <Card className="flex flex-col gap-3 p-6 lg:flex-row">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 flex-1" />
        ))}
      </Card>
    </div>
  );
}
