import * as React from "react";
import { cn } from "@/lib/utils";

export type ColumnAlign = "left" | "right" | "center";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  align?: ColumnAlign;
  /** Tailwind width class, e.g. "w-32". */
  width?: string;
  /** Hide the column below this breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  headerClassName?: string;
  cellClassName?: string;
  sortKey?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

const hideClass = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const alignClass: Record<ColumnAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onHeaderClick,
  sortState,
  dense = false,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  /** Provided by interactive wrappers to enable sorting. */
  onHeaderClick?: (sortKey: string) => void;
  sortState?: { key: string; direction: "asc" | "desc" };
  dense?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onHeaderClick);
              const active = sortState?.key === column.sortKey;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sortState?.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={cn(
                    "px-3 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.13em] text-faint first:pl-4 last:pr-4",
                    alignClass[column.align ?? "left"],
                    column.width,
                    column.hideBelow && hideClass[column.hideBelow],
                    column.headerClassName,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onHeaderClick?.(column.sortKey!)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-muted",
                        active && "text-text",
                      )}
                    >
                      {column.header}
                      <span
                        className={cn(
                          "font-mono text-[9px] leading-none transition-opacity",
                          active ? "opacity-100 text-green-ink" : "opacity-0",
                        )}
                        aria-hidden
                      >
                        {sortState?.direction === "asc" ? "▲" : "▼"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              className={cn(
                "group relative border-b border-border/70 transition-colors duration-150 last:border-b-0",
                "hover:bg-surface/60",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 first:pl-4 last:pr-4",
                    dense ? "py-2.5" : "py-3.5",
                    alignClass[column.align ?? "left"],
                    column.hideBelow && hideClass[column.hideBelow],
                    column.cellClassName,
                  )}
                >
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Row-shaped skeleton used while a table is loading. */
export function TableSkeleton({
  rows = 8,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="w-full">
      <div className="flex gap-3 border-b border-border px-4 py-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={i}
            className="h-2.5 animate-shimmer rounded-[3px] bg-surface-2"
            style={{ width: i === 0 ? "22%" : `${12 + (i % 3) * 4}%` }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-3 border-b border-border/70 px-4 py-3.5"
          style={{ opacity: 1 - r * 0.06 }}
        >
          <div className="size-9 animate-shimmer rounded-md bg-surface-2" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-24 animate-shimmer rounded-[3px] bg-surface-2" />
            <div className="h-2 w-36 animate-shimmer rounded-[3px] bg-surface-2/70" />
          </div>
          {Array.from({ length: columns - 2 }).map((_, i) => (
            <div
              key={i}
              className="h-2.5 animate-shimmer rounded-[3px] bg-surface-2"
              style={{ width: `${8 + (i % 3) * 3}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
