import * as React from "react";
import Link from "next/link";
import type { ApiEarlyMover, ApiMarketBreadth, ApiMarketRegime } from "@/lib/api";
import { routes } from "@/lib/routes";
import { AssetLogo } from "@/components/data/asset-logo";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { DataUnavailable } from "@/components/data/data-state";
import { StageBadge, regimeLabel } from "@/components/data/intelligence";

/**
 * MARKET-LEVEL PANELS
 *
 * Three readings about the covered set rather than any one asset. Each states
 * plainly what it measured — "the covered set", with its size — because a
 * regime computed over 58 assets is a fact about those 58 assets, and phrasing
 * it as "the market" would claim far more than the data supports.
 */

/* -------------------------------------------------------------- regime --- */

const REGIME_TONE: Record<string, string> = {
  RISK_ON: "text-green-ink",
  RISK_OFF: "text-red",
  NEUTRAL: "text-muted",
  HIGH_VOLATILITY: "text-amber",
};

export function MarketRegimePanel({
  regime,
  reason,
  className,
}: {
  regime: ApiMarketRegime | null;
  reason?: string | null;
  className?: string;
}) {
  if (!regime) {
    return (
      <DataUnavailable
        title="Market regime unavailable"
        reason={reason ?? "The regime appears once enough markets have been scored."}
        className={className}
      />
    );
  }

  const covered = regime.breadth?.overall.total ?? null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Market regime</CardTitle>
        {regime.confidence !== null ? (
          <span className="font-mono text-[10.5px] text-faint">
            confidence {(regime.confidence * 100).toFixed(0)}%
          </span>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-5">
        <div>
          <p
            className={cn(
              "text-[28px] font-semibold leading-none tracking-[-0.025em]",
              REGIME_TONE[regime.state] ?? "text-text",
            )}
          >
            {regimeLabel(regime.state)}
          </p>
          {covered !== null ? (
            <p className="mt-2 text-[12px] text-faint">
              Across the {covered} markets Strata currently scores
            </p>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
            Driven by
          </p>
          <ul className="space-y-1.5">
            {regime.drivers.map((driver) => (
              <li key={driver} className="flex gap-2 text-[12.5px] text-muted">
                <span className="text-faint" aria-hidden>
                  ·
                </span>
                {driver}
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------- breadth --- */

function BreadthRow({
  label,
  counts,
}: {
  label: string;
  counts: ApiMarketBreadth["overall"];
}) {
  if (counts.total === 0) {
    return (
      <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
        <span className="text-[12.5px] text-faint">{label}</span>
        <span className="font-mono text-[11.5px] text-faint">no scored markets</span>
      </div>
    );
  }

  const advancingPct = (counts.advancing / counts.total) * 100;
  const decliningPct = (counts.declining / counts.total) * 100;

  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[12.5px] text-muted">{label}</span>
        <span className="font-mono text-[11.5px] tabular-nums text-text">
          {counts.advancing} / {counts.declining}
          {counts.unchanged > 0 ? (
            <span className="text-faint"> / {counts.unchanged}</span>
          ) : null}
        </span>
      </div>
      <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full bg-green-ink" style={{ width: `${advancingPct}%` }} />
        <span className="block h-full bg-red" style={{ width: `${decliningPct}%` }} />
      </div>
    </div>
  );
}

export function MarketBreadthPanel({
  breadth,
  reason,
  className,
}: {
  breadth: ApiMarketBreadth | null;
  reason?: string | null;
  className?: string;
}) {
  if (!breadth) {
    return (
      <DataUnavailable
        title="Market breadth unavailable"
        reason={reason ?? "Breadth appears once markets have been observed."}
        className={className}
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Market breadth</CardTitle>
        <span className="font-mono text-[10.5px] text-faint">advancing / declining</span>
      </CardHeader>
      <CardBody>
        <BreadthRow label="All markets" counts={breadth.overall} />
        <BreadthRow label="Stocks" counts={breadth.byClass.stock} />
        <BreadthRow label="Crypto" counts={breadth.byClass.crypto} />
        <BreadthRow label="Onchain" counts={breadth.byClass.onchain} />
        {breadth.medianAbsMovePct !== null ? (
          <p className="mt-4 border-t border-border pt-3.5 font-mono text-[11px] text-faint">
            median absolute move {breadth.medianAbsMovePct.toFixed(2)}%
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------- early movers --- */

/**
 * Assets accelerating before the move shows up in price.
 *
 * The copy is careful, and deliberately so: this is a detector, not a
 * forecast. It reports what has already been measured — volume and activity
 * building while price has not yet run — and makes no claim about what
 * happens next.
 */
export function EarlyMoversPanel({
  logos,
  movers,
  reason,
  className,
}: {
  movers: ApiEarlyMover[] | null;
  /**
   * Asset id → artwork. The early-mover payload carries no logo, and a ticker
   * is not enough to identify an asset — symbols are unique only per asset
   * type — so the caller supplies artwork keyed by the id both sides share.
   */
  logos?: Map<string, string | null>;
  reason?: string | null;
  className?: string;
}) {
  if (!movers || movers.length === 0) {
    return (
      <DataUnavailable
        title="No early acceleration detected"
        reason={
          reason ??
          "Early movement needs several observations per asset to measure acceleration against."
        }
        className={className}
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Early movers</CardTitle>
        <span className="font-mono text-[10.5px] text-faint">
          detected, not predicted
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        {movers.slice(0, 6).map((mover) => (
          <div key={mover.assetId} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Link
                href={routes.asset(mover.symbol)}
                className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-text transition-colors hover:text-green-ink"
              >
                <AssetLogo
                  asset={{ symbol: mover.symbol, logoUrl: logos?.get(mover.assetId) ?? null }}
                  size="xs"
                />
                <span className="truncate">{mover.symbol}</span>
              </Link>
              <span className="flex items-center gap-2.5">
                <StageBadge stage={mover.stage} />
                <span className="font-mono text-[12px] tabular-nums text-muted">
                  {mover.score.toFixed(0)}
                </span>
              </span>
            </div>
            <ul className="space-y-0.5">
              {mover.rationale.map((line) => (
                <li key={line} className="text-[11.5px] leading-relaxed text-faint">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
