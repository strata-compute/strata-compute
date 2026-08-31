import { initStore, getStore } from "../src/database/index.ts";
import { closePool } from "../src/database/pool.ts";
import { runIntelligencePass } from "../src/compute/intelligence.ts";
import { describe as dist } from "../src/compute/score/report.ts";
import { CONFIDENCE, COMPONENT_KEYS, universeFor } from "../src/config/score-v1.ts";

await initStore();
const store = getStore();
const rows = await store.getLatestMarketRows({ limit: 500 });
const subjects = [];
for (const row of rows) {
  if (!row.snapshot) continue;
  subjects.push({ asset: row.asset, current: row.snapshot,
    history: await store.getObservationHistory(row.asset.id, 400) });
}
const pass = runIntelligencePass({ subjects, version: "v1" });
const scored = pass.records.filter((r) => r.score.status === "OK");

console.log("CONFIDENCE BREAKDOWN per universe");
console.log(`  ${"universe".padEnd(10)}${"n".padEnd(4)}${"complete".padEnd(10)}${"fresh".padEnd(8)}${"depth".padEnd(8)}${"value".padEnd(8)}band spread`);
const byU = new Map<string, typeof scored>();
for (const r of scored) { const u = universeFor(r.assetType); byU.set(u, [...(byU.get(u) ?? []), r]); }
for (const [u, ms] of byU) {
  const avg = (f: (m: typeof ms[number]) => number) => ms.reduce((s, m) => s + f(m), 0) / ms.length;
  const bands = new Set(ms.map((m) => m.score.confidence.band));
  console.log(`  ${u.padEnd(10)}${String(ms.length).padEnd(4)}` +
    `${avg((m) => m.score.confidence.completeness).toFixed(3).padEnd(10)}` +
    `${avg((m) => m.score.confidence.freshness).toFixed(3).padEnd(8)}` +
    `${avg((m) => m.score.confidence.historicalDepth).toFixed(3).padEnd(8)}` +
    `${avg((m) => m.score.confidence.value).toFixed(3).padEnd(8)}${[...bands].join("/")}`);
}
const cv = dist(scored.map((s) => s.score.confidence.value * 100));
console.log(`\n  ALL confidence: min=${cv?.min} p50=${cv?.p50} max=${cv?.max} spread=${cv?.spread}`);
console.log(`  bands in use: ${[...new Set(scored.map((s) => s.score.confidence.band))].join(", ")}`);
console.log(`  thresholds: HIGH>=${CONFIDENCE.bands.high} MEDIUM>=${CONFIDENCE.bands.medium}`);

console.log("\nCOMPONENT SETS — are assets scored on the same basis?");
const sets = new Map<string, { n: number; universes: Set<string> }>();
for (const r of scored) {
  const key = (Object.keys(r.score.components) as string[]).sort().join("+");
  const e = sets.get(key) ?? { n: 0, universes: new Set<string>() };
  e.n += 1; e.universes.add(universeFor(r.assetType)); sets.set(key, e);
}
for (const [key, e] of [...sets.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const cov = key.split("+").length;
  console.log(`  ${String(e.n).padStart(3)} assets · ${cov} components · ${[...e.universes].join(",")}`);
  console.log(`      ${key}`);
}

console.log("\nCROSS-UNIVERSE: does the same score mean the same thing?");
for (const [u, ms] of byU) {
  const d = dist(ms.map((m) => m.score.score as number));
  const cal = pass.calibrations.get(u as never);
  console.log(`  ${u.padEnd(10)} n=${String(ms.length).padStart(2)} sd=${d?.sd}` +
    `  composite sigma=${cal?.compositeSigma?.toFixed(2)}` +
    `  -> anchoring forces sd to ~${(cal?.compositeSigma ?? 0) >= 1.5 ? 16 : "unanchored"}`);
}
await closePool();
