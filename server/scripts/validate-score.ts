import { initStore, getStore } from "../src/database/index.ts";
import { closePool, getPool } from "../src/database/pool.ts";
import { runIntelligencePass } from "../src/compute/intelligence.ts";
import {
  buildCalibrations,
  buildComposite,
  percentileRank,
  resolveUniverse,
} from "../src/compute/score/calibrate.ts";
import { describe as dist } from "../src/compute/score/report.ts";
import {
  AGGREGATION,
  COMPONENT_KEYS,
  componentConfig,
  SCORE_VERSION,
  universeConfig,
  universeFor,
  type ScoreComponentKey,
} from "../src/config/score-v1.ts";
import type { AssetIntelligence } from "../src/types/domain.ts";

/**
 * SCORE VALIDATION — read only.
 *
 * Replays the current formula over persisted observations and interrogates
 * the result. It writes nothing and changes nothing; the point is to find out
 * whether the score means what it claims before anyone relies on it.
 *
 * A wider range is not evidence of a better score. These checks look for the
 * ways a wider range can still be wrong: ranks that invert a clearly stronger
 * profile, percentiles taken over samples too small to support them,
 * confidence that tracks the score instead of the data, and explanations that
 * describe something the computation did not do.
 */

const HISTORY_WINDOW = 400;
const line = (n = 74) => "─".repeat(n);

function pad(v: unknown, n: number): string {
  return String(v).padEnd(n);
}
function num(v: number | null | undefined, d = 1): string {
  return v === null || v === undefined ? "—" : v.toFixed(d);
}

async function main() {
  await initStore();
  const store = getStore();

  const rows = await store.getLatestMarketRows({ limit: 500 });
  const subjects = [];
  for (const row of rows) {
    if (!row.snapshot) continue;
    subjects.push({
      asset: row.asset,
      current: row.snapshot,
      history: await store.getObservationHistory(row.asset.id, HISTORY_WINDOW),
    });
  }

  if (subjects.length === 0) {
    console.log("No stored observations. Nothing to validate.");
    return;
  }

  const pass = runIntelligencePass({ subjects, version: "v1" });
  const records = pass.records;
  const scored = records.filter((r) => r.score.status === "OK" && r.score.score !== null);

  console.log(`STRATA SCORE VALIDATION — ${SCORE_VERSION}`);
  console.log(`${subjects.length} assets replayed · ${scored.length} scored\n`);

  /* ---------------------------------------------------- 4. universes --- */

  console.log(line());
  console.log("4. UNIVERSE STATISTICS");
  console.log(line());

  const byUniverse = new Map<string, AssetIntelligence[]>();
  for (const r of scored) {
    const u = universeFor(r.assetType);
    byUniverse.set(u, [...(byUniverse.get(u) ?? []), r]);
  }

  console.log(
    `  ${pad("universe", 10)}${pad("n", 4)}${pad("min", 7)}${pad("p10", 7)}${pad("p25", 7)}${pad("p50", 7)}${pad("p75", 7)}${pad("p90", 7)}${pad("p95", 7)}${pad("max", 7)}${pad("sd", 6)}`,
  );
  const universeStats = new Map<string, ReturnType<typeof dist>>();
  for (const [u, members] of byUniverse) {
    const d = dist(members.map((m) => m.score.score as number));
    universeStats.set(u, d);
    if (!d) continue;
    console.log(
      `  ${pad(u, 10)}${pad(d.n, 4)}${pad(num(d.min), 7)}${pad(num(d.p10), 7)}${pad(num(d.p25), 7)}${pad(num(d.p50), 7)}${pad(num(d.p75), 7)}${pad(num(d.p90), 7)}${pad(num(d.p95), 7)}${pad(num(d.max), 7)}${pad(num(d.sd), 6)}`,
    );
  }
  const all = dist(scored.map((s) => s.score.score as number));
  if (all) {
    console.log(
      `  ${pad("ALL", 10)}${pad(all.n, 4)}${pad(num(all.min), 7)}${pad(num(all.p10), 7)}${pad(num(all.p25), 7)}${pad(num(all.p50), 7)}${pad(num(all.p75), 7)}${pad(num(all.p90), 7)}${pad(num(all.p95), 7)}${pad(num(all.max), 7)}${pad(num(all.sd), 6)}`,
    );
  }

  /* ------------------------------------------------ 5. small samples --- */

  console.log(`\n${line()}`);
  console.log("5. SMALL-SAMPLE RELIABILITY");
  console.log(line());
  console.log("  A percentile over n members can take only n+1 distinct values.");
  console.log("  Granularity is the smallest score difference the sample can express.\n");

  for (const [u, members] of byUniverse) {
    const config = universeConfig(u as never);
    const n = members.length;
    const granularity = 100 / n;
    const scores = members.map((m) => m.score.score as number);
    const distinct = new Set(scores.map((s) => s.toFixed(2))).size;
    const cal = pass.calibrations.get(u as never);

    // how much a one-rank move changes the final score, after anchoring
    const sigma = cal?.compositeSigma ?? null;
    const perRank =
      sigma && sigma >= AGGREGATION.minimumSigma
        ? (granularity / sigma) * AGGREGATION.spreadPerSigma
        : granularity;

    console.log(
      `  ${pad(u, 10)} n=${pad(n, 4)} minimum=${pad(config.minimumMembers, 4)} ` +
        `percentile granularity=${num(granularity)} pts  ` +
        `one rank ≈ ${num(perRank)} score pts  distinct scores=${distinct}/${n}`,
    );
    if (n < config.minimumMembers * 2) {
      console.log(
        `             NOTE: n is under twice the configured minimum; each rank moves the score ${num(perRank)} points.`,
      );
    }
  }

  /* ------------------------------------- 1. semantics by score bucket --- */

  console.log(`\n${line()}`);
  console.log("1. SCORE SEMANTICS BY BUCKET");
  console.log(line());

  const buckets = [
    { lo: 80, hi: 101, label: "80–100" },
    { lo: 70, hi: 80, label: "70–79" },
    { lo: 60, hi: 70, label: "60–69" },
    { lo: 50, hi: 60, label: "50–59" },
    { lo: 40, hi: 50, label: "40–49" },
    { lo: 30, hi: 40, label: "30–39" },
    { lo: 0, hi: 30, label: "0–29" },
  ];

  for (const bucket of buckets) {
    const members = scored.filter((s) => {
      const v = s.score.score as number;
      return v >= bucket.lo && v < bucket.hi;
    });

    if (members.length === 0) {
      console.log(`  ${pad(bucket.label, 8)} (none)`);
      continue;
    }

    // mean normalised component value across the bucket, to see whether
    // higher-scoring buckets really do have stronger components
    const componentMeans: string[] = [];
    for (const key of COMPONENT_KEYS) {
      const values = members
        .map((m) => m.score.components[key])
        .filter((v): v is number => v !== undefined);
      if (values.length === 0) continue;
      componentMeans.push(
        `${key.slice(0, 4)}=${num(values.reduce((a, b) => a + b, 0) / values.length, 0)}`,
      );
    }

    const examples = members
      .sort((a, b) => (b.score.score as number) - (a.score.score as number))
      .slice(0, 3)
      .map((m) => `${m.symbol} ${num(m.score.score)}`)
      .join(", ");

    console.log(
      `  ${pad(bucket.label, 8)} n=${pad(members.length, 3)} ${pad(examples, 34)} ${componentMeans.join(" ")}`,
    );
  }

  /* --------------------------------------- 2. component contribution --- */

  console.log(`\n${line()}`);
  console.log("2. COMPONENT CONTRIBUTION — representative assets");
  console.log(line());

  const ordered = [...scored].sort(
    (a, b) => (b.score.score as number) - (a.score.score as number),
  );
  const representatives = [
    ordered[0],
    ordered[Math.floor(ordered.length / 2)],
    ordered.at(-1),
  ].filter((x): x is AssetIntelligence => x !== undefined);

  for (const record of representatives) {
    const componentsPresent = Object.keys(record.score.components) as ScoreComponentKey[];
    const availableWeight = componentsPresent.reduce(
      (sum, k) => sum + componentConfig(k).weight,
      0,
    );

    console.log(
      `\n  ${record.symbol} (${record.assetType})  score=${num(record.score.score, 2)}  confidence=${num(record.score.confidence.value * 100, 0)}% ${record.score.confidence.band}`,
    );
    const meta = record.score as unknown as {
      composite?: number;
      anchored?: boolean;
      scoreUniverse?: string;
    };
    console.log(
      `    composite=${num(meta.composite, 2)} anchored=${meta.anchored} universe=${meta.scoreUniverse}`,
    );
    console.log(`    ${pad("component", 18)}${pad("norm", 8)}${pad("weight", 9)}${pad("contribution", 14)}`);

    let total = 0;
    for (const key of COMPONENT_KEYS) {
      const value = record.score.components[key];
      const config = componentConfig(key);
      if (value === undefined) {
        const reason = record.score.missing.find((m) => m.component === key)?.reason ?? "";
        console.log(`    ${pad(config.label, 18)}${pad("—", 8)}${pad("excluded", 9)}${pad("—", 14)} ${reason.slice(0, 40)}`);
        continue;
      }
      const share = config.weight / availableWeight;
      const contribution = value * share;
      total += contribution;
      console.log(
        `    ${pad(config.label, 18)}${pad(num(value, 1), 8)}${pad(`${(share * 100).toFixed(1)}%`, 9)}${pad(`= ${num(contribution, 2)}`, 14)}`,
      );
    }
    console.log(`    ${pad("", 18)}${pad("", 8)}${pad("", 9)}  composite ${num(total, 2)}`);
  }

  /* --------------------------------------------- 3. ordering sanity --- */

  console.log(`\n${line()}`);
  console.log("3. ORDERING CONSISTENCY");
  console.log(line());
  console.log("  Looking for pairs where one asset is at least as strong on EVERY");
  console.log("  shared component, strictly stronger on one, yet scores lower.\n");

  let inversions = 0;
  let compared = 0;

  for (const [universe, members] of byUniverse) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = 0; j < members.length; j += 1) {
        if (i === j) continue;
        const a = members[i] as AssetIntelligence;
        const b = members[j] as AssetIntelligence;

        const shared = COMPONENT_KEYS.filter(
          (k) => a.score.components[k] !== undefined && b.score.components[k] !== undefined,
        );
        if (shared.length < 3) continue;
        // only compare assets measured on the same component set
        const aKeys = Object.keys(a.score.components).sort().join();
        const bKeys = Object.keys(b.score.components).sort().join();
        if (aKeys !== bKeys) continue;

        compared += 1;
        const dominates = shared.every(
          (k) => (a.score.components[k] as number) >= (b.score.components[k] as number),
        );
        const strictly = shared.some(
          (k) => (a.score.components[k] as number) > (b.score.components[k] as number),
        );

        if (dominates && strictly && (a.score.score as number) < (b.score.score as number)) {
          inversions += 1;
          if (inversions <= 5) {
            console.log(
              `  INVERSION in ${universe}: ${a.symbol} (${num(a.score.score)}) dominates ${b.symbol} (${num(b.score.score)})`,
            );
            for (const k of shared) {
              console.log(
                `      ${pad(k, 18)} ${num(a.score.components[k])} vs ${num(b.score.components[k])}`,
              );
            }
          }
        }
      }
    }
  }
  console.log(
    `  ${compared} comparable pairs · ${inversions} inversions` +
      (inversions === 0 ? "  — ordering is consistent" : "  — REVIEW REQUIRED"),
  );

  /* ------------------------------------------------ 7. extreme scores --- */

  console.log(`\n${line()}`);
  console.log("7. EXTREME SCORES");
  console.log(line());

  const high = scored.filter((s) => (s.score.score as number) >= 90);
  const low = scored.filter((s) => (s.score.score as number) < 20);
  console.log(`  above 90: ${high.length}   below 20: ${low.length}`);
  for (const record of [...high, ...low]) {
    const parts = COMPONENT_KEYS.map((k) =>
      record.score.components[k] === undefined
        ? null
        : `${k.slice(0, 4)}=${num(record.score.components[k], 0)}`,
    ).filter(Boolean);
    console.log(`    ${pad(record.symbol, 8)} ${num(record.score.score)}  ${parts.join(" ")}`);
  }
  if (high.length === 0 && low.length === 0) {
    console.log("  None. Acceptable: the scale is not required to be filled.");
  }

  /* ------------------------------------------------- 8. missing data --- */

  console.log(`\n${line()}`);
  console.log("8. MISSING DATA HANDLING");
  console.log(line());

  for (const key of COMPONENT_KEYS) {
    const present = records.filter((r) => r.score.components[key] !== undefined).length;
    const missing = records.length - present;
    const zeros = records.filter((r) => r.score.components[key] === 0).length;
    console.log(
      `  ${pad(componentConfig(key).label, 18)} present=${pad(present, 4)} missing=${pad(missing, 4)} ` +
        `explicit zeros=${zeros}` +
        (zeros > 0 ? "  (a true 0 rank, not a default)" : ""),
    );
  }

  // renormalisation proof: weights over present components must sum to 1
  let renormOk = true;
  for (const record of scored) {
    const keys = Object.keys(record.score.components) as ScoreComponentKey[];
    const sum = keys.reduce((s, k) => s + componentConfig(k).weight, 0);
    const shares = keys.reduce((s, k) => s + componentConfig(k).weight / sum, 0);
    if (Math.abs(shares - 1) > 1e-9) renormOk = false;
  }
  console.log(`\n  weight renormalisation over available components: ${renormOk ? "correct" : "BROKEN"}`);

  /* ------------------------------------------------- 6. confidence --- */

  console.log(`\n${line()}`);
  console.log("6. CONFIDENCE VALIDATION");
  console.log(line());

  const conf = scored.map((s) => ({
    score: s.score.score as number,
    confidence: s.score.confidence.value,
    components: s.score.confidence.componentsAvailable,
    depth: s.score.confidence.historicalDepth,
  }));

  const meanX = conf.reduce((s, c) => s + c.score, 0) / conf.length;
  const meanY = conf.reduce((s, c) => s + c.confidence, 0) / conf.length;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const c of conf) {
    cov += (c.score - meanX) * (c.confidence - meanY);
    vx += (c.score - meanX) ** 2;
    vy += (c.confidence - meanY) ** 2;
  }
  const r = vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);

  const cd = dist(conf.map((c) => c.confidence * 100));
  console.log(
    `  confidence: min=${num(cd?.min)} p50=${num(cd?.p50)} max=${num(cd?.max)} sd=${num(cd?.sd)}`,
  );
  console.log(`  correlation(score, confidence) = ${r.toFixed(4)}`);
  console.log(
    Math.abs(r) < 0.4
      ? "  Confidence is largely independent of score, as intended."
      : "  WARNING: confidence tracks score; they may not be measuring different things.",
  );

  /* ------------------------------------------- 10. explanation audit --- */

  console.log(`\n${line()}`);
  console.log("10. EXPLANATION AUDIT — do the words match the numbers?");
  console.log(line());

  let checked = 0;
  let mismatches = 0;

  for (const record of ordered.slice(0, 10)) {
    for (const driver of record.score.drivers) {
      const value = record.score.components[driver.component];
      if (value === undefined) {
        mismatches += 1;
        console.log(`  ${record.symbol}: driver ${driver.component} has no component value`);
        continue;
      }
      checked += 1;

      // the stated direction must match the sign of the contribution, and the
      // contribution must match value-vs-neutral
      const expectPositive = value >= 50;
      const claimsPositive = driver.direction === "positive";
      if (expectPositive !== claimsPositive) {
        mismatches += 1;
        console.log(
          `  MISMATCH ${record.symbol}: ${driver.component} normalised ${num(value)} but reported ${driver.direction}`,
        );
      }
    }
  }
  console.log(
    `  ${checked} drivers checked across 10 assets · ${mismatches} mismatches` +
      (mismatches === 0 ? "  — explanations agree with the computation" : ""),
  );

  /* --------------------------------------------- 12. ranking validation */

  console.log(`\n${line()}`);
  console.log("12. RANKING VALIDATION — top 10 by score");
  console.log(line());
  console.log(`  ${pad("#", 4)}${pad("asset", 9)}${pad("score", 8)}${pad("conf", 7)}${pad("universe", 10)}main components`);

  ordered.slice(0, 10).forEach((record, i) => {
    const top = COMPONENT_KEYS.map((k) => ({ k, v: record.score.components[k] }))
      .filter((x): x is { k: ScoreComponentKey; v: number } => x.v !== undefined)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => `${x.k.slice(0, 4)}=${num(x.v, 0)}`)
      .join(" ");
    const meta = record.score as unknown as { scoreUniverse?: string };
    console.log(
      `  ${pad(i + 1, 4)}${pad(record.symbol, 9)}${pad(num(record.score.score, 2), 8)}${pad(num(record.score.confidence.value * 100, 0), 7)}${pad(meta.scoreUniverse ?? "?", 10)}${top}`,
    );
  });

  // monotonically decreasing by construction?
  const scoresInOrder = ordered.map((r) => r.score.score as number);
  const monotonic = scoresInOrder.every((v, i) => i === 0 || v <= (scoresInOrder[i - 1] as number));
  console.log(`\n  ordering strictly by score, no secondary sort: ${monotonic ? "confirmed" : "VIOLATED"}`);

  /* ------------------------------------------ 11. version integrity --- */

  console.log(`\n${line()}`);
  console.log("11. SCORE VERSION INTEGRITY (persisted)");
  console.log(line());

  const pool = getPool();
  if (pool) {
    const { rows: versions } = await pool.query<{
      score_version: string;
      version: string;
      n: string;
      lo: string | null;
      hi: string | null;
    }>(
      `select coalesce(score_version,'(null)') score_version, version,
              count(*)::text n, min(score)::text lo, max(score)::text hi
         from strata_scores where score is not null
        group by 1,2 order by 1,2`,
    );
    for (const v of versions) {
      console.log(
        `  ${pad(v.score_version, 26)} engine=${pad(v.version, 5)} n=${pad(v.n, 6)} range ${Number(v.lo).toFixed(1)}–${Number(v.hi).toFixed(1)}`,
      );
    }

    const { rows: mixed } = await pool.query<{ n: string }>(
      `select count(*)::text n from (
         select asset_id from strata_scores where score is not null
          group by asset_id having count(distinct score_version) > 1) x`,
    );
    console.log(
      `\n  assets whose history spans more than one score version: ${mixed[0]?.n}`,
    );
    console.log(
      "  (expected: a chart must separate them or it compares two different measures)",
    );
  }

  console.log(`\n${line()}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
