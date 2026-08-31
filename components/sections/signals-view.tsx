"use client";

import * as React from "react";
import { RadioTower } from "lucide-react";
import type { AssetClass, Signal, SignalKind } from "@/lib/types";
import { SIGNAL_KINDS, SIGNAL_META } from "@/lib/signal-meta";
import { cn } from "@/lib/utils";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusDot,
} from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SignalCard } from "@/components/data/signal-card";

const CLASS_TABS: { value: AssetClass | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stock", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
  { value: "onchain", label: "Onchain" },
];

const toneDot = {
  positive: "green",
  caution: "amber",
  negative: "red",
  info: "blue",
} as const;

export function SignalsView({ signals }: { signals: Signal[] }) {
  const [assetClass, setAssetClass] = React.useState<AssetClass | "all">("all");
  const [kinds, setKinds] = React.useState<Set<SignalKind>>(new Set());

  const toggleKind = (kind: SignalKind) => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const results = React.useMemo(
    () =>
      signals.filter(
        (signal) =>
          (assetClass === "all" || signal.assetClass === assetClass) &&
          (kinds.size === 0 || kinds.has(signal.kind)),
      ),
    [signals, assetClass, kinds],
  );

  const distribution = React.useMemo(
    () =>
      SIGNAL_KINDS.map((kind) => ({
        kind,
        count: signals.filter((s) => s.kind === kind).length,
      })),
    [signals],
  );
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);

  const classCounts = CLASS_TABS.map((tab) => ({
    ...tab,
    count:
      tab.value === "all"
        ? signals.length
        : signals.filter((s) => s.assetClass === tab.value).length,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Segmented
          ariaLabel="Asset class"
          options={classCounts}
          value={assetClass}
          onValueChange={(value) => setAssetClass(value as AssetClass | "all")}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {SIGNAL_KINDS.map((kind) => {
            const meta = SIGNAL_META[kind];
            const active = kinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors duration-150",
                  active
                    ? "border-border-strong bg-surface-2 text-text"
                    : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
                )}
              >
                <StatusDot tone={toneDot[meta.tone]} />
                {meta.label}
              </button>
            );
          })}
          {kinds.size > 0 ? (
            <button
              type="button"
              onClick={() => setKinds(new Set())}
              className="px-2 text-[12px] text-faint transition-colors hover:text-text"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          {results.length ? (
            results.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))
          ) : (
            <Card>
              <EmptyState
                icon={<RadioTower />}
                title="No signals match this filter"
                description="Nothing has crossed a threshold for this combination in the current window."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setAssetClass("all");
                      setKinds(new Set());
                    }}
                  >
                    Reset filters
                  </Button>
                }
              />
            </Card>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Distribution</CardTitle>
              <span className="font-mono text-[10.5px] text-faint">24h</span>
            </CardHeader>
            <CardBody className="space-y-3.5">
              {distribution.map(({ kind, count }) => {
                const meta = SIGNAL_META[kind];
                return (
                  <div key={kind} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="flex items-center gap-2 text-muted">
                        <StatusDot tone={toneDot[meta.tone]} />
                        {meta.label}
                      </span>
                      <span className="font-mono text-[11.5px] text-faint">
                        {count}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-elevated">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          meta.tone === "positive" && "bg-green-ink/70",
                          meta.tone === "caution" && "bg-amber/70",
                          meta.tone === "negative" && "bg-red/70",
                          meta.tone === "info" && "bg-blue/70",
                        )}
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What triggers a signal</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {SIGNAL_KINDS.map((kind) => {
                const meta = SIGNAL_META[kind];
                return (
                  <div key={kind} className="space-y-1">
                    <p className="flex items-center gap-2 text-[12.5px] text-text">
                      <StatusDot tone={toneDot[meta.tone]} />
                      {meta.label}
                    </p>
                    <p className="pl-3.5 text-[11.5px] leading-relaxed text-muted">
                      {meta.blurb}
                    </p>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
