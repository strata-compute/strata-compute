"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { routes } from "@/lib/routes";
import { cn, formatCompact, formatPrice } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import { Delta } from "@/components/data/delta";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { ConfidenceBadge } from "@/components/data/intelligence";
import { useStream } from "@/components/realtime/stream-provider";

/**
 * COMPARE
 *
 * Two to four markets side by side on identical computed inputs.
 *
 * The comparison rules are the same ones that govern every number in the
 * product, and they matter more here than anywhere else: a table invites the
 * eye to read down a column and conclude. So a metric one asset has and
 * another does not shows an em dash on both rows and is excluded from any
 * "leads on" claim — comparing a measured 62 against an absent value and
 * declaring a winner would be the most confident wrong statement the product
 * could make.
 */

type ComponentKey =
  | "momentum"
  | "volume"
  | "activity"
  | "liquidity"
  | "relativeStrength"
  | "trend"
  | "volatility";

const ROWS: { key: ComponentKey; label: string }[] = [
  { key: "momentum", label: "Momentum" },
  { key: "volume", label: "Volume" },
  { key: "activity", label: "Activity" },
  { key: "liquidity", label: "Liquidity" },
  { key: "relativeStrength", label: "Relative strength" },
  { key: "trend", label: "Trend" },
  { key: "volatility", label: "Volatility" },
];

interface Column {
  asset: { symbol: string; name: string; logoUrl: string | null; assetType: string };
  price: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  score: number | null;
  scoreStatus: "OK" | "INSUFFICIENT_DATA" | null;
  confidence: {
    value: number;
    band: "HIGH" | "MEDIUM" | "LOW";
    completeness: number;
    freshness: number;
    historicalDepth: number;
    componentsAvailable: number;
    componentsTotal: number;
  } | null;
  components: Partial<Record<ComponentKey, number>>;
  updatedAt: string | null;
}

interface SearchAsset {
  symbol: string;
  name: string;
  logoUrl: string | null;
  assetType: string;
}

/* --------------------------------------------------------- the insight --- */

/**
 * The comparison summary.
 *
 * Assembled by arithmetic: for each metric both assets actually have, the
 * higher value leads. No model writes it, and the vocabulary is deliberately
 * observational — "currently leads on" describes a measurement that has
 * already happened. It never advises, never projects, and never ranks the
 * assets overall, because a composite of composites would imply a judgement
 * the data does not support.
 */
function buildInsight(columns: Column[]): { symbol: string; leads: string[] }[] {
  const leaders = new Map<string, string[]>();

  const contest = (label: string, values: (number | null)[]) => {
    // only assets that have the metric take part
    const present = values
      .map((value, index) => ({ value, index }))
      .filter((entry): entry is { value: number; index: number } => entry.value !== null);

    if (present.length < 2) return;

    const best = present.reduce((a, b) => (b.value > a.value ? b : a));
    // a tie is not a lead
    const tied = present.filter((entry) => entry.value === best.value).length > 1;
    if (tied) return;

    const symbol = columns[best.index]!.asset.symbol;
    leaders.set(symbol, [...(leaders.get(symbol) ?? []), label]);
  };

  contest(
    "Strata Score",
    columns.map((column) => (column.scoreStatus === "OK" ? column.score : null)),
  );
  for (const row of ROWS) {
    contest(row.label, columns.map((column) => column.components[row.key] ?? null));
  }

  return [...leaders.entries()]
    .map(([symbol, leads]) => ({ symbol, leads }))
    .sort((a, b) => b.leads.length - a.leads.length);
}

/* ------------------------------------------------------------- picker --- */

function AssetPicker({
  onSelect,
  exclude,
}: {
  onSelect: (symbol: string) => void;
  exclude: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [assets, setAssets] = React.useState<SearchAsset[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/strata/search?q=${encodeURIComponent(term)}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as { assets: SearchAsset[] };
        if (!cancelled) setAssets(body.assets ?? []);
      } catch {
        if (!cancelled) setAssets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term, open]);

  const results = assets
    .filter((asset) => !exclude.includes(asset.symbol.toUpperCase()))
    .slice(0, 40);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted transition-colors hover:border-border-strong hover:text-text"
      >
        <Plus className="size-4" />
        <span className="text-[12.5px]">Add market</span>
      </button>
    );
  }

  return (
    <Card className="min-h-[120px]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3.5 shrink-0 text-faint" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search markets…"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-faint transition-colors hover:text-text"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {loading && results.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-faint">Searching…</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-faint">
            No markets match that.
          </p>
        ) : (
          <ul>
            {results.map((asset) => (
              <li key={asset.symbol}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(asset.symbol);
                    setOpen(false);
                    setTerm("");
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <AssetLogo asset={asset} size="xs" />
                  <span className="text-[12.5px] text-text">{asset.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                    {asset.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- view --- */

export function CompareView({ initial = [] }: { initial?: string[] }) {
  const [symbols, setSymbols] = React.useState<string[]>(initial);
  const [columns, setColumns] = React.useState<Column[]>([]);
  const [reason, setReason] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const { events } = useStream();

  const load = React.useCallback(async (list: string[]) => {
    if (list.length < 2) {
      setColumns([]);
      setReason(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/strata/compare?assets=${encodeURIComponent(list.join(","))}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        data: { columns: Column[]; missing: string[] } | null;
        reason: string | null;
      };
      setColumns(body.data?.columns ?? []);
      setReason(body.reason);
    } catch {
      setColumns([]);
      setReason("Strata is temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(symbols);
  }, [symbols, load]);

  // refresh when the stream reports a change to one of the compared assets
  const watched = React.useMemo(() => new Set(symbols), [symbols]);
  const relevant = React.useMemo(
    () => events.filter((event) => event.symbol && watched.has(event.symbol)).length,
    [events, watched],
  );
  React.useEffect(() => {
    if (relevant === 0 || symbols.length < 2) return;
    void load(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant]);

  const add = (symbol: string) => {
    setSymbols((current) =>
      current.includes(symbol.toUpperCase()) || current.length >= 4
        ? current
        : [...current, symbol.toUpperCase()],
    );
  };

  const remove = (symbol: string) =>
    setSymbols((current) => current.filter((entry) => entry !== symbol));

  const insight = React.useMemo(() => buildInsight(columns), [columns]);

  return (
    <div className="space-y-6">
      {/* selection */}
      <div
        className={cn(
          "grid gap-3",
          symbols.length >= 3 ? "sm:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
        {symbols.map((symbol) => {
          const column = columns.find((c) => c.asset.symbol === symbol);
          return (
            <Card key={symbol}>
              <CardBody className="flex items-start justify-between gap-2">
                <Link
                  href={routes.asset(symbol)}
                  className="flex min-w-0 items-center gap-2.5"
                >
                  <AssetLogo
                    asset={column?.asset ?? { symbol }}
                    size="sm"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-text">
                      {symbol}
                    </span>
                    <span className="truncate text-[11.5px] text-muted">
                      {column?.asset.name ?? "resolving…"}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => remove(symbol)}
                  className="shrink-0 text-faint transition-colors hover:text-text"
                  aria-label={`Remove ${symbol} from comparison`}
                >
                  <X className="size-3.5" />
                </button>
              </CardBody>
            </Card>
          );
        })}

        {symbols.length < 4 ? <AssetPicker onSelect={add} exclude={symbols} /> : null}
      </div>

      {symbols.length < 2 ? (
        <Card>
          <EmptyState
            title="Choose at least two markets"
            description="A comparison needs two. Add up to four and Strata will place them on identical computed inputs."
          />
        </Card>
      ) : columns.length < 2 ? (
        <Card>
          <EmptyState
            title={loading ? "Loading comparison…" : "Comparison unavailable"}
            description={
              loading
                ? "Fetching computed values."
                : (reason ??
                  "Not enough of the selected markets are covered by Strata.")
            }
          />
        </Card>
      ) : (
        <>
          {/* table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-[10.5px] uppercase tracking-[0.14em] text-faint">
                      Metric
                    </th>
                    {columns.map((column) => (
                      <th key={column.asset.symbol} className="px-4 py-3 text-right">
                        <span className="flex items-center justify-end gap-2">
                          <AssetLogo asset={column.asset} size="xs" />
                          <span className="text-[12.5px] font-medium text-text">
                            {column.asset.symbol}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 text-[12.5px] text-muted">Price</td>
                    {columns.map((column) => (
                      <td
                        key={column.asset.symbol}
                        className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-text"
                      >
                        {column.price === null ? "—" : formatPrice(column.price)}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 text-[12.5px] text-muted">24H change</td>
                    {columns.map((column) => (
                      <td key={column.asset.symbol} className="px-4 py-2.5 text-right">
                        {column.priceChange24h === null ? (
                          <span className="font-mono text-[12.5px] text-faint">—</span>
                        ) : (
                          <Delta value={column.priceChange24h} className="justify-end" />
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border bg-surface-2/30">
                    <td className="px-4 py-2.5 text-[12.5px] font-medium text-text">
                      Strata Score
                    </td>
                    {columns.map((column) => (
                      <td
                        key={column.asset.symbol}
                        className="px-4 py-2.5 text-right font-mono text-[13px] font-medium tabular-nums text-text"
                      >
                        {column.scoreStatus === "OK" && column.score !== null
                          ? column.score.toFixed(1)
                          : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 text-[12.5px] text-muted">Confidence</td>
                    {columns.map((column) => (
                      <td key={column.asset.symbol} className="px-4 py-2.5 text-right">
                        {column.confidence ? (
                          <span className="font-mono text-[12px] text-muted">
                            {column.confidence.band} ·{" "}
                            {(column.confidence.value * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="font-mono text-[12.5px] text-faint">—</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {ROWS.map((row) => (
                    <tr key={row.key} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2.5 text-[12.5px] text-muted">{row.label}</td>
                      {columns.map((column) => {
                        const value = column.components[row.key];
                        return (
                          <td
                            key={column.asset.symbol}
                            className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums"
                          >
                            {value === undefined ? (
                              <span
                                className="text-faint"
                                title="Not computed for this market"
                              >
                                —
                              </span>
                            ) : (
                              <span className="text-text">{value.toFixed(1)}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* insight */}
          <Card>
            <CardHeader>
              <CardTitle>Strata comparison</CardTitle>
              <span className="font-mono text-[10.5px] text-faint">
                computed, not advice
              </span>
            </CardHeader>
            <CardBody className="space-y-4">
              {insight.length === 0 ? (
                <p className="text-[13px] text-muted">
                  No metric separates these markets: every comparable component
                  is either tied or missing on one side.
                </p>
              ) : (
                insight.map((entry) => (
                  <div key={entry.symbol}>
                    <p className="text-[13px] text-text">
                      <span className="font-medium">{entry.symbol}</span> currently
                      leads on:
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {entry.leads.map((lead) => (
                        <li
                          key={lead}
                          className="flex items-center gap-2 text-[12.5px] text-muted"
                        >
                          <span className="text-green-ink" aria-hidden>
                            ·
                          </span>
                          {lead}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
              <p className="border-t border-border pt-3.5 text-[11.5px] leading-relaxed text-faint">
                Leadership is stated only where both markets have the metric.
                A component missing on either side is excluded from the
                comparison rather than treated as zero.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
