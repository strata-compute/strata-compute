import { HeaderSkeleton } from "@/components/layout/skeletons";
import { Card, Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex gap-4 p-4">
            <Skeleton className="size-8 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-2.5 w-40" />
              <Skeleton className="h-2.5 w-full max-w-md" />
              <Skeleton className="h-2.5 w-3/5" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
