"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Minus, Trophy } from "lucide-react";
import type { ArenaEntrant } from "@/lib/types";
import { cn, formatCompact } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { Card, EmptyState, Badge } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { Column, DataTable } from "@/components/data/data-table";
import { AssetIdentity, AssetClassTag } from "@/components/data/asset-identity";
import { PointsDelta } from "@/components/data/delta";
import { NoValue } from "@/components/data/data-state";
import { ScoreCell } from "@/components/data/score";
import { STATE_META } from "@/components/data/arena-card";

type Scope = "active" | "eliminated" | "all";

function RankShift({ entrant }: { entrant: ArenaEntrant }) {
  const shift = entrant.previousRank - entrant.rank;
  if (shift === 0)
    return <Minus className="size-3 text-faint" aria-label="unchanged" />;
  const up = shift > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[11px]",
        up ? "text-green-ink" : "text-red",
      )}
    >
      {up ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      {Math.abs(shift)}
    </span>
  );
}

const columns: Column<ArenaEntrant>[] = [
  {
    key: "rank",
    header: "Rank",
    width: "w-20",
    cell: (entrant) => (
      <span className="flex items-center gap-2">
        <span className="font-mono text-[12.5px] tabular-nums text-faint">
          {entrant.rank.toString().padStart(2, "0")}
        </span>
        <RankShift entrant={entrant} />
      </span>
    ),
  },
  {
    key: "asset",
    header: "Asset",
    cell: (entrant) => (
      <Link
        href={routes.asset(entrant.symbol)}
        className="flex min-w-0 items-center rounded-sm after:absolute after:inset-0 after:content-['']"
      >
        <AssetIdentity
          asset={{
            symbol: entrant.symbol,
            name: entrant.name,
            logoUrl: entrant.logoUrl,
          }}
        />
      </Link>
    ),
  },
  {
    key: "type",
    header: "Type",
    width: "w-24",
    hideBelow: "md",
    cell: (entrant) => <AssetClassTag assetClass={entrant.assetClass} />,
  },
  {
    key: "round",
    header: "Round",
    align: "right",
    width: "w-24",
    cell: (entrant) => (
      <span className="flex justify-end">
        {entrant.roundDelta === null ? (
          <NoValue hint="Round settlement has not run" />
        ) : (
          <PointsDelta value={entrant.roundDelta} />
        )}
      </span>
    ),
  },
  {
    key: "momentum",
    header: "Momentum",
    align: "right",
    width: "w-28",
    hideBelow: "lg",
    cell: (entrant) =>
      entrant.momentum === null ? (
        <span className="flex justify-end">
          <NoValue hint="Momentum not reported for this entrant" />
        </span>
      ) : (
        <span className="flex items-center justify-end gap-2">
          <span className="h-1 w-10 overflow-hidden rounded-full bg-elevated">
            <span
              className="block h-full rounded-full bg-muted/60"
              style={{ width: `${entrant.momentum}%` }}
            />
          </span>
          <span className="font-mono text-[12.5px] tabular-nums text-muted">
            {entrant.momentum.toFixed(0)}
          </span>
        </span>
      ),
  },
  {
    key: "volume",
    header: "Volume",
    align: "right",
    width: "w-28",
    hideBelow: "lg",
    cell: (entrant) =>
      entrant.volume24h === null ? (
        <NoValue hint="Volume not joined to the arena row yet" />
      ) : (
        <span className="font-mono text-[12.5px] tabular-nums text-muted">
          {formatCompact(entrant.volume24h, "$")}
        </span>
      ),
  },
  {
    key: "score",
    header: "Score",
    align: "right",
    width: "w-36",
    cell: (entrant) => <ScoreCell score={entrant.score} />,
  },
  {
    key: "state",
    header: "State",
    width: "w-28",
    hideBelow: "sm",
    cell: (entrant) => {
      const meta = STATE_META[entrant.state];
      return (
        <Badge tone={meta.tone === "neutral" ? "neutral" : meta.tone}>
          {meta.label}
        </Badge>
      );
    },
  },
];

export function ArenaLeaderboard({
  entrants,
  className,
}: {
  entrants: ArenaEntrant[];
  className?: string;
}) {
  const [scope, setScope] = React.useState<Scope>("active");

  const rows = React.useMemo(() => {
    if (scope === "all") return entrants;
    if (scope === "eliminated")
      return entrants.filter((e) => e.state === "eliminated");
    return entrants.filter((e) => e.state !== "eliminated");
  }, [entrants, scope]);

  const options = [
    {
      value: "active" as const,
      label: "Active",
      count: entrants.filter((e) => e.state !== "eliminated").length,
    },
    {
      value: "eliminated" as const,
      label: "Eliminated",
      count: entrants.filter((e) => e.state === "eliminated").length,
    },
    { value: "all" as const, label: "All", count: entrants.length },
  ];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-4">
        <Segmented
          ariaLabel="Leaderboard scope"
          options={options}
          value={scope}
          onValueChange={(value) => setScope(value as Scope)}
        />
        <span className="hidden font-mono text-[11px] text-faint sm:block">
          standings recompute every second
        </span>
      </div>

      <Card className="overflow-hidden">
        {rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(entrant) => entrant.symbol}
          />
        ) : (
          <EmptyState
            icon={<Trophy />}
            title="Nobody has been eliminated yet"
            description="Entrants leave the round when their liquidity or momentum floor is breached for three consecutive windows."
          />
        )}
      </Card>
    </div>
  );
}
