import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, Skeleton } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/data/data-table";
import { AssetCardSkeleton } from "@/components/data/asset-card";

export function HeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className={cn("h-7", wide ? "w-96" : "w-64")} />
      <Skeleton className="h-3 w-full max-w-xl" />
      <div className="flex gap-6 border-t border-border pt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-24" />
        ))}
      </div>
    </div>
  );
}

export function MetricGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="space-y-5 p-5">
          <div className="flex justify-between">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2.5 w-10" />
          </div>
          <Skeleton className="h-7 w-32" />
          <div className="flex items-end justify-between">
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-7 w-24" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function TableCardSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden">
      <TableSkeleton rows={rows} />
    </Card>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <AssetCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-52" />
      </div>
      <div className="p-4">
        <Skeleton className="w-full" style={{ height }} />
      </div>
    </Card>
  );
}
