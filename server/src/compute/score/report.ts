import { COMPONENT_KEYS, componentConfig, SCORE_VERSION, universeFor, type ScoreComponentKey, type ScoreUniverse } from "../../config/score-v1.ts";
import type { AssetIntelligence } from "../../types/domain.ts";
import { round } from "../../utils/number.ts";

/**
 * CALIBRATION REPORTING
 *
 * Pure description. Nothing here changes a score; it measures what the
 * scoring produced so the calibration can be judged rather than admired.
 *
 * The measures were chosen to answer the questions that actually decide
 * whether a score is worth publishing: does it separate assets, does every
 * component contribute anything, and how often is each component simply
 * absent. A component that never varies adds a column to the interface and no
 * information to the score, and the report is what makes that visible.
 */

export interface Distribution {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  sd: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  /** max − min. The headline number for "does this scale get used". */
  spread: number;
}

export function describe(values: number[]): Distribution | null {
  const x = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (x.length === 0) return null;

  const q = (p: number) => x[Math.min(x.length - 1, Math.floor(p * x.length))] as number;
  const mean = x.reduce((s, v) => s + v, 0) / x.length;
  const sd =
    x.length < 2
      ? 0
      : Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (x.length - 1));

  return {
    n: x.length,
    min: round(x[0] as number, 2),
    max: round(x.at(-1) as number, 2),
    mean: round(mean, 2),
    median: round(q(0.5), 2),
    sd: round(sd, 2),
    p10: round(q(0.1), 2),
    p25: round(q(0.25), 2),
    p50: round(q(0.5), 2),
    p75: round(q(0.75), 2),
    p90: round(q(0.9), 2),
    p95: round(q(0.95), 2),
    spread: round((x.at(-1) as number) - (x[0] as number), 2),
  };
}

/* ------------------------------------------------------------ components -- */

export interface ComponentDiagnostic {
  component: ScoreComponentKey;
  label: string;
  weight: number;
  /** How often the component was available, 0–1. */
  availability: number;
  missingRate: number;
  distribution: Distribution | null;
  /** Pearson correlation with the final score, where both exist. */
  correlationWithScore: number | null;
  /**
   * Set when the component carries no information: present but constant.
   * Flagged, never removed — the decision is a human's.
   */
  flag: string | null;
}

function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = (xs[i] as number) - mx;
    const b = (ys[i] as number) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return round(num / Math.sqrt(dx * dy), 4);
}

export function diagnoseComponents(
  records: AssetIntelligence[],
): ComponentDiagnostic[] {
  return COMPONENT_KEYS.map((key) => {
    const config = componentConfig(key);

    const paired: { value: number; score: number }[] = [];
    let present = 0;

    for (const record of records) {
      const value = record.score.components[key];
      if (value === undefined) continue;
      present += 1;
      if (record.score.score !== null) {
        paired.push({ value, score: record.score.score });
      }
    }

    const values = paired.map((p) => p.value);
    const distribution = describe(
      records
        .map((r) => r.score.components[key])
        .filter((v): v is number => v !== undefined),
    );

    const availability = records.length === 0 ? 0 : present / records.length;

    let flag: string | null = null;
    if (availability === 0) {
      flag = "never available across the sample";
    } else if (distribution && distribution.sd === 0) {
      flag = "constant across every asset; contributes no separation";
    } else if (distribution && distribution.sd < 2) {
      flag = `near-constant (sd ${distribution.sd}); contributes little separation`;
    } else if (availability < 0.25) {
      flag = `available for only ${(availability * 100).toFixed(0)}% of assets`;
    }

    return {
      component: key,
      label: config.label,
      weight: config.weight,
      availability: round(availability, 4),
      missingRate: round(1 - availability, 4),
      distribution,
      correlationWithScore: correlation(
        values,
        paired.map((p) => p.score),
      ),
      flag,
    };
  });
}

/* -------------------------------------------------------------- universes -- */

export interface UniverseReport {
  universe: ScoreUniverse;
  scored: number;
  insufficient: number;
  scores: Distribution | null;
  confidence: Distribution | null;
  /** Reasons assets could not be scored, most common first. */
  insufficientReasons: { reason: string; count: number }[];
}

export interface CalibrationReport {
  scoreVersion: string;
  generatedAt: string;
  sampleSize: number;
  overall: UniverseReport;
  byUniverse: UniverseReport[];
  components: ComponentDiagnostic[];
}

function reportFor(
  universe: ScoreUniverse,
  records: AssetIntelligence[],
): UniverseReport {
  const scored = records.filter((r) => r.score.status === "OK" && r.score.score !== null);
  const insufficient = records.filter((r) => r.score.status === "INSUFFICIENT_DATA");

  const reasons = new Map<string, number>();
  for (const record of insufficient) {
    // group by the shape of the reason, not the exact numbers inside it
    const reason = (record.score.insufficientReason ?? "unspecified")
      .replace(/\d+(\.\d+)?/g, "N")
      .slice(0, 90);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    universe,
    scored: scored.length,
    insufficient: insufficient.length,
    scores: describe(scored.map((r) => r.score.score as number)),
    confidence: describe(records.map((r) => r.score.confidence.value * 100)),
    insufficientReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function buildCalibrationReport(
  records: AssetIntelligence[],
): CalibrationReport {
  const byUniverse: UniverseReport[] = [];
  const groups = new Map<ScoreUniverse, AssetIntelligence[]>();

  for (const record of records) {
    const id = universeFor(record.assetType);
    groups.set(id, [...(groups.get(id) ?? []), record]);
  }

  for (const [universe, members] of groups) {
    byUniverse.push(reportFor(universe, members));
  }

  return {
    scoreVersion: SCORE_VERSION,
    generatedAt: new Date().toISOString(),
    sampleSize: records.length,
    overall: reportFor("all", records),
    byUniverse: byUniverse.sort((a, b) => b.scored - a.scored),
    components: diagnoseComponents(records),
  };
}

/** Human-readable rendering, for the development report. */
export function formatReport(report: CalibrationReport): string {
  const lines: string[] = [];
  const row = (d: Distribution | null) =>
    d === null
      ? "      (none)"
      : `      n=${String(d.n).padStart(3)}  min=${String(d.min).padStart(6)}  p10=${String(d.p10).padStart(6)}  p50=${String(d.p50).padStart(6)}  p90=${String(d.p90).padStart(6)}  max=${String(d.max).padStart(6)}  sd=${String(d.sd).padStart(5)}  spread=${d.spread}`;

  lines.push(`CALIBRATION REPORT — ${report.scoreVersion}`);
  lines.push(`  sample: ${report.sampleSize} assets   generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("  SCORES");
  lines.push(`    ALL (scored ${report.overall.scored}, insufficient ${report.overall.insufficient})`);
  lines.push(row(report.overall.scores));

  for (const u of report.byUniverse) {
    lines.push(`    ${u.universe.toUpperCase()} (scored ${u.scored}, insufficient ${u.insufficient})`);
    lines.push(row(u.scores));
    for (const r of u.insufficientReasons) {
      lines.push(`        ${r.count}x  ${r.reason}`);
    }
  }

  lines.push("");
  lines.push("  COMPONENTS");
  for (const c of report.components) {
    const d = c.distribution;
    lines.push(
      `    ${c.label.padEnd(18)} w=${c.weight.toFixed(2)} avail=${(c.availability * 100).toFixed(0).padStart(3)}%` +
        (d ? `  sd=${String(d.sd).padStart(5)}  spread=${String(d.spread).padStart(6)}` : "  (never available)") +
        (c.correlationWithScore !== null ? `  r=${c.correlationWithScore}` : ""),
    );
    if (c.flag) lines.push(`        FLAG: ${c.flag}`);
  }

  return lines.join("\n");
}
