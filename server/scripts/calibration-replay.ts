import { initStore, getStore } from "../src/database/index.ts";
import { runIntelligencePass } from "../src/compute/intelligence.ts";
import { buildCalibrationReport, describe, formatReport } from "../src/compute/score/report.ts";
import { LEGACY_SCORE_VERSION, SCORE_VERSION } from "../src/config/score-v1.ts";
import { closePool } from "../src/database/pool.ts";

/**
 * CALIBRATION REPLAY — development only.
 *
 * Reads persisted observations, replays the current scoring formula over
 * them, and prints the resulting distribution beside the one already stored.
 * It writes nothing: the point is to see what a calibration would do before
 * letting it near production data.
 *
 * No history is generated. If an asset has no stored observations it simply
 * does not appear, exactly as it would not in a live pass.
 */

const HISTORY_WINDOW = 400;

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
    console.log("No stored observations to replay.");
    return;
  }

  // ---- what is already stored, by whichever method produced it ----------
  const stored = rows
    .map((row) => row.score)
    .filter((s): s is NonNullable<typeof s> => s !== null && s.score !== null);

  const storedByVersion = new Map<string, number[]>();
  for (const s of stored) {
    const key = s.scoreVersion || LEGACY_SCORE_VERSION;
    storedByVersion.set(key, [...(storedByVersion.get(key) ?? []), s.score as number]);
  }

  console.log("STORED SCORES (as currently persisted)");
  for (const [version, values] of storedByVersion) {
    const d = describe(values);
    console.log(
      `  ${version.padEnd(24)} n=${d?.n}  min=${d?.min}  p50=${d?.p50}  max=${d?.max}  sd=${d?.sd}  spread=${d?.spread}`,
    );
  }
  console.log("");

  // ---- replay the current formula, in memory only -----------------------
  const pass = runIntelligencePass({ subjects, version: "v1" });
  const report = buildCalibrationReport(pass.records);

  console.log(formatReport(report));
  console.log("");
  console.log("  UNIVERSE CALIBRATION (anchoring parameters this pass)");
  for (const [universe, calibration] of pass.calibrations) {
    if (calibration.compositeMean === null) continue;
    console.log(
      `    ${universe.padEnd(9)} n=${String(calibration.sampleSize).padStart(3)}  composite mean=${calibration.compositeMean.toFixed(2)}  sigma=${(calibration.compositeSigma ?? 0).toFixed(2)}`,
    );
  }

  console.log("");
  console.log(`  Replay used ${SCORE_VERSION}. Nothing was written.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
