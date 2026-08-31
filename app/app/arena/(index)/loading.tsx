import { CardGridSkeleton, HeaderSkeleton } from "@/components/layout/skeletons";
import { Card, Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-8">
      <HeaderSkeleton />
      <Card className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-1.5 w-full" />
      </Card>
      <CardGridSkeleton />
    </div>
  );
}
