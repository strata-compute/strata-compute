import { initStore, getStore } from "../src/database/index.ts";
import { closePool } from "../src/database/pool.ts";
import type { DetectionSeriesPoint, RankSeriesPoint } from "../src/database/store.ts";
import { ASSET_DETECTORS, isDetection, type DetectorInput } from "../src/intelligence/detectors.ts";
import { eventKey, reconcile } from "../src/intelligence/engine.ts";
import { breadthOf } from "../src/intelligence/market-detectors.ts";
import { bestWindow, type TimedValue } from "../src/intelligence/windows.ts";
import type { DetectionResult, IntelligenceEvent } from "../src/types/intelligence-events.ts";

/**
 * INTELLIGENCE REPLAY — development only.
 *
 * Replays the detectors over history that is already stored, stepping a
 * virtual clock forward through the recorded timestamps, and prints the
 * events the engine would have raised, held, and closed along the way.
 *
 * It writes nothing. Not to the events table, not anywhere — the whole point
 * is to inspect detector behaviour against real history without that
 * inspection becoming part of the record. Nor does it invent history: an
 * asset with too few stored observations produces `insufficient_history` here
 * exactly as it would in a live pass.
 *
 * What it is for: seeing whether a threshold change would have made the feed
 * noisier, whether a condition would have been reported once or fifteen
 * times, and how long events actually stay open.
 *
 * Usage:
 *   npm run replay:intelligence
 *   npm run replay:intelligence -- --steps=40 --symbol=BTC --minutes=720
 */

const DEFAULT_STEPS = 25;
const DEFAULT_MINUTES = 720;
const PER_ASSET_LIMIT = 400;

function argOf(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function groupByAsset<T extends { assetId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.assetId);
    if (existing) existing.push(row);
    else grouped.set(row.assetId, [row]);
  }
  return grouped;
}

/** Oldest first, with unmeasurable points dropped rather than filled in. */
function seriesFrom<T>(
  points: T[],
  at: (point: T) => string,
  pick: (point: T) => number | null,
  before: number,
): TimedValue[] {
  const series: TimedValue[] = [];
  for (const point of points) {
    const value = pick(point);
    if (value === null) continue;
    const timestamp = at(point);
    if (new Date(timestamp).getTime() > before) continue;
    series.push({ timestamp, value });
  }
  return series.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

async function main() {
  const steps = Number(argOf("steps") ?? DEFAULT_STEPS);
  const minutes = Number(argOf("minutes") ?? DEFAULT_MINUTES);
  const symbolFilter = argOf("symbol")?.toUpperCase() ?? null;

  await initStore();
  const store = getStore();

  // The same two batched reads the live pass uses. Loading history per asset
  // would make a replay of a few dozen assets slower than the market it is
  // replaying.
  const [seriesRows, rankRows, rows] = await Promise.all([
    store.getDetectionSeries(minutes, PER_ASSET_LIMIT),
    store.getRankSeries("score", "all", minutes),
    store.getLatestMarketRows({ limit: 500 }),
  ]);

  const identity = new Map(
    rows.map((row) => [
      row.asset.id,
      { symbol: row.asset.symbol, assetType: row.asset.assetType },
    ]),
  );

  const wanted = (assetId: string) =>
    !symbolFilter || identity.get(assetId)?.symbol === symbolFilter;

  const seriesByAsset = new Map(
    [...groupByAsset(seriesRows)].filter(([assetId]) => wanted(assetId)),
  );
  const ranksByAsset = groupByAsset(rankRows);

  if (seriesByAsset.size === 0) {
    console.log(
      symbolFilter
        ? `No stored computation history for ${symbolFilter} in the last ${minutes} minutes.`
        : `No stored computation history in the last ${minutes} minutes.`,
    );
    return;
  }

  // the timeline: every instant the pipeline actually recorded
  const instants = [
    ...new Set(
      [...seriesByAsset.values()].flatMap((points) =>
        points.map((p) => new Date(p.timestamp).getTime()),
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(-steps);

  console.log("");
  console.log("INTELLIGENCE REPLAY");
  console.log(`  assets      ${seriesByAsset.size}`);
  console.log(`  instants    ${instants.length} (of ${steps} requested)`);
  console.log(
    `  covering    ${new Date(instants[0] ?? 0).toISOString()} → ${new Date(instants.at(-1) ?? 0).toISOString()}`,
  );
  console.log("");

  const open = new Map<string, IntelligenceEvent>();
  let created = 0;
  let resolvedTotal = 0;
  let expiredTotal = 0;
  let insufficient = 0;

  for (const instant of instants) {
    const detections: DetectionResult[] = [];
    const changes: number[] = [];

    for (const [assetId, points] of seriesByAsset) {
      const who = identity.get(assetId);
      if (!who) continue;

      const priorObservations: Record<string, number> = {};
      for (const [key, event] of open) {
        if (!key.startsWith(`${assetId}:`)) continue;
        priorObservations[event.eventType] = event.observations;
      }

      const scoreSeries = seriesFrom(
        points,
        (p: DetectionSeriesPoint) => p.timestamp,
        (p) => p.score,
        instant,
      );
      if (scoreSeries.length === 0) continue;

      const input: DetectorInput = {
        assetId,
        symbol: who.symbol,
        assetType: who.assetType,
        scoreSeries,
        momentumSeries: seriesFrom(points, (p) => p.timestamp, (p) => p.momentum, instant),
        trendSeries: seriesFrom(points, (p) => p.timestamp, (p) => p.trend, instant),
        volumeSeries: seriesFrom(points, (p) => p.timestamp, (p) => p.volume, instant),
        rankSeries: seriesFrom(
          ranksByAsset.get(assetId) ?? [],
          (r: RankSeriesPoint) => r.timestamp,
          (r) => r.rank,
          instant,
        ),
        components: {},
        // The stored series does not carry per-pass confidence, so the replay
        // holds it at a neutral value and says so. Comparing replayed
        // significance with live significance therefore compares detector
        // behaviour, not data quality.
        dataConfidence: 0.75,
        trendState: null,
        trendFitQuality: null,
        previousTrendState: null,
        priorObservations,
        now: instant,
      };

      for (const detector of ASSET_DETECTORS) {
        const outcome = detector(input);
        if (isDetection(outcome)) detections.push(outcome);
        else insufficient += 1;
      }

      const window = bestWindow(scoreSeries, instant);
      if (window.ok) changes.push(window.stats.last - window.stats.first);
    }

    const at = new Date(instant).toISOString();
    const result = reconcile({
      detections,
      open,
      computationVersion: "replay",
      now: at,
    });

    for (const closed of [...result.resolved, ...result.expired]) {
      open.delete(eventKey(closed.assetId, closed.eventType));
    }
    for (const event of result.upserts) {
      open.set(eventKey(event.assetId, event.eventType), event);
    }

    created += result.created;
    resolvedTotal += result.resolved.length;
    expiredTotal += result.expired.length;

    if (result.created > 0 || result.resolved.length > 0 || result.expired.length > 0) {
      const breadth = breadthOf(changes);
      console.log(
        `  ${at}  +${result.created} new  ~${result.updated} held  -${result.resolved.length} resolved  ` +
          `${result.expired.length > 0 ? `!${result.expired.length} expired  ` : ""}` +
          `open=${open.size}  breadth=${breadth.advancing}/${breadth.declining}`,
      );
      for (const event of result.upserts.filter((e) => e.status === "detected")) {
        console.log(
          `      NEW  ${(event.symbol ?? "market").padEnd(8)} ${event.eventType.padEnd(24)} ` +
            `sig=${event.significance.value.toFixed(3)} conf=${event.confidence.toFixed(2)} ${event.severity}`,
        );
      }
    }
  }

  const byType = new Map<string, number>();
  for (const event of open.values()) {
    byType.set(event.eventType, (byType.get(event.eventType) ?? 0) + 1);
  }

  console.log("");
  console.log("  RESULT");
  console.log(`    created            ${created}`);
  console.log(`    resolved           ${resolvedTotal}`);
  console.log(`    expired            ${expiredTotal}`);
  console.log(`    still open         ${open.size}`);
  console.log(`    insufficient       ${insufficient} detector calls lacked history`);
  console.log(
    `    events per instant ${(created / Math.max(instants.length, 1)).toFixed(2)}`,
  );

  if (byType.size > 0) {
    console.log("");
    console.log("  STILL OPEN BY TYPE");
    for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type.padEnd(26)} ${count}`);
    }
  }

  console.log("");
  console.log("  Replay is read-only. Nothing was written to the events table.");
  console.log("  Trend shifts are not replayed: the classification is a per-pass");
  console.log("  reading the stored series does not carry. Nor are the market");
  console.log("  detectors, which need a regime series stored per pass.");
  console.log("");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
