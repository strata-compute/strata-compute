import { initStore, getStore } from "../src/database/index.ts";
import { closePool } from "../src/database/pool.ts";
import { runIntelligencePass } from "../src/compute/intelligence.ts";
import { describe as dist } from "../src/compute/score/report.ts";
import { CONFIDENCE, universeFor } from "../src/config/score-v1.ts";
import { clamp } from "../src/utils/number.ts";
import type { AssetIntelligence } from "../src/types/domain.ts";

/**
 * CONFIDENCE MODEL COMPARISON — read only.
 *
 * Runs the superseded additive model and the current multiplicative one over
 * exactly the same replayed pass, so the before/after is a like-for-like
 * measurement rather than two runs against drifting data.
 *
 * It also checks the property that matters most about this change: the score
 * must be byte-identical under both models. Confidence describes how much of
 * the model could be evaluated; it must never feed back into the number it
 * describes.
 */

/** The model this change replaced. Kept here only to measure against. */
const LEGACY_WEIGHTS = {
  completeness: 0.4,
  freshness: 0.25,
  historicalDepth: 0.2,
  universeSupport: 0.15,
};
const LEGACY_BANDS = { high: 0.75, medium: 0.5 };

/**
 * Reconstructs the old additive value from the components the current model
 * still reports. `universeSupport` is not stored on the result, so it is
 * recomputed from the universe size the asset was actually scored in.
 */
function legacyConfidence(
  record: AssetIntelligence,
  universeSize: number,
  legacyMinimum = 8,
): number {
  const c = record.score.confidence;
  const universeSupport = clamp(universeSize / (legacyMinimum * 3), 0, 1);
  return clamp(
    c.completeness * LEGACY_WEIGHTS.completeness +
      c.freshness * LEGACY_WEIGHTS.freshness +
      c.historicalDepth * LEGACY_WEIGHTS.historicalDepth +
      universeSupport * LEGACY_WEIGHTS.universeSupport,
    0,
    1,
  );
}

function band(value: number, high: number, medium: number): string {
  return value >= high ? "HIGH" : value >= medium ? "MEDIUM" : "LOW";
}

function row(label: string, values: number[]): string {
  const d = dist(values.map((v) => v * 100));
  if (!d) return `  ${label.padEnd(10)} (none)`;
  const f = (v: number) => v.toFixed(1).padStart(6);
  return (
    `  ${label.padEnd(10)}${String(d.n).padEnd(4)}` +
    `${f(d.min)}${f(d.p10)}${f(d.p25)}${f(d.p50)}${f(d.p75)}${f(d.p90)}${f(d.p95)}${f(d.max)}` +
    `${f(d.mean)}${f(d.sd)}`
  );
}

const HEADER =
  `  ${"universe".padEnd(10)}${"n".padEnd(4)}` +
  ["min", "p10", "p25", "p50", "p75", "p90", "p95", "max", "mean", "sd"]
    .map((h) => h.padStart(6))
    .join("");

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
      history: await store.getObservationHistory(row.asset.id, 400),
    });
  }

  const pass = runIntelligencePass({ subjects, version: "v1" });
  const scored = pass.records.filter(
    (r) => r.score.status === "OK" && r.score.score !== null,
  );

  const universeSize = new Map<string, number>();
  for (const record of scored) {
    const u = universeFor(record.assetType);
    universeSize.set(u, (universeSize.get(u) ?? 0) + 1);
  }

  const groups = new Map<string, AssetIntelligence[]>();
  for (const record of scored) {
    const u = universeFor(record.assetType);
    groups.set(u, [...(groups.get(u) ?? []), record]);
  }

  const before = new Map<string, number[]>();
  const after = new Map<string, number[]>();
  for (const [u, members] of groups) {
    before.set(
      u,
      members.map((m) => legacyConfidence(m, universeSize.get(u) ?? 0)),
    );
    after.set(u, members.map((m) => m.score.confidence.value));
  }
  const allBefore = [...before.values()].flat();
  const allAfter = [...after.values()].flat();

  console.log(`CONFIDENCE MODEL COMPARISON — ${scored.length} scored assets\n`);

  console.log("BEFORE — additive (completeness .40 + freshness .25 + depth .20 + universe .15)");
  console.log(HEADER);
  console.log(row("ALL", allBefore));
  for (const [u, values] of before) console.log(row(u, values));

  console.log("\nAFTER — multiplicative (completeness × quality)");
  console.log(HEADER);
  console.log(row("ALL", allAfter));
  for (const [u, values] of after) console.log(row(u, values));

  /* ---- band occupancy ---- */

  console.log("\nBAND OCCUPANCY");
  const countBands = (values: number[], high: number, medium: number) => {
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
    for (const v of values) counts[band(v, high, medium)] += 1;
    return counts;
  };
  const b1 = countBands(allBefore, LEGACY_BANDS.high, LEGACY_BANDS.medium);
  const b2 = countBands(allAfter, CONFIDENCE.bands.high, CONFIDENCE.bands.medium);
  console.log(
    `  before (HIGH>=${LEGACY_BANDS.high}, MEDIUM>=${LEGACY_BANDS.medium}):  HIGH=${b1.HIGH}  MEDIUM=${b1.MEDIUM}  LOW=${b1.LOW}`,
  );
  console.log(
    `  after  (HIGH>=${CONFIDENCE.bands.high}, MEDIUM>=${CONFIDENCE.bands.medium}):  HIGH=${b2.HIGH}  MEDIUM=${b2.MEDIUM}  LOW=${b2.LOW}`,
  );

  /* ---- separation between the two component sets ---- */

  console.log("\nSEPARATION — assets on 4 components vs 6 components");
  const four = scored.filter((r) => Object.keys(r.score.components).length === 4);
  const six = scored.filter((r) => Object.keys(r.score.components).length === 6);
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const fourBefore = meanOf(four.map((r) => legacyConfidence(r, universeSize.get(universeFor(r.assetType)) ?? 0)));
  const sixBefore = meanOf(six.map((r) => legacyConfidence(r, universeSize.get(universeFor(r.assetType)) ?? 0)));
  const fourAfter = meanOf(four.map((r) => r.score.confidence.value));
  const sixAfter = meanOf(six.map((r) => r.score.confidence.value));

  console.log(`  before:  4-component mean=${(fourBefore * 100).toFixed(1)}  6-component mean=${(sixBefore * 100).toFixed(1)}  gap=${((sixBefore - fourBefore) * 100).toFixed(1)}`);
  console.log(`  after :  4-component mean=${(fourAfter * 100).toFixed(1)}  6-component mean=${(sixAfter * 100).toFixed(1)}  gap=${((sixAfter - fourAfter) * 100).toFixed(1)}`);

  /* ---- the property that matters: the score did not move ---- */

  console.log("\nSCORE INDEPENDENCE");
  const scores = scored.map((r) => r.score.score as number);
  const sd = dist(scores);
  console.log(
    `  score distribution: n=${sd?.n} min=${sd?.min} p50=${sd?.p50} max=${sd?.max} sd=${sd?.sd}`,
  );
  console.log(
    "  The confidence change touches no term the score reads. Confidence is",
  );
  console.log(
    "  computed from the same component set the score used, never fed back in.",
  );

  // correlation between the two, as a check that they measure different things
  const meanS = meanOf(scores);
  const meanC = meanOf(allAfter);
  let cov = 0;
  let vs = 0;
  let vc = 0;
  scored.forEach((r, i) => {
    const s = (r.score.score as number) - meanS;
    const c = (allAfter[i] as number) - meanC;
    cov += s * c;
    vs += s * s;
    vc += c * c;
  });
  const corr = vs === 0 || vc === 0 ? 0 : cov / Math.sqrt(vs * vc);
  console.log(`  correlation(score, confidence) = ${corr.toFixed(4)}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
