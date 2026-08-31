import type { ArenaConfig, ArenaHpWeights } from "../config/arena.ts";
import type { AssetIntelligence } from "../types/domain.ts";
import { clamp, round } from "../utils/number.ts";

/**
 * ARENA POWER AND HP
 *
 * The whole competitive layer reduces to one pure function: computed market
 * components in, a 0–100 power reading out, and an HP delta derived from
 * where that reading sits relative to the field's neutral midpoint.
 *
 * Two properties matter more than the formula itself.
 *
 * It is deterministic. The same intelligence record always yields the same
 * power and the same HP change. No clock, no randomness, no dependence on
 * evaluation order — which means a round's outcome can be reconstructed from
 * the stored records that produced it, and a disputed elimination can be
 * checked rather than argued about.
 *
 * And it never invents an input. Components absent for an asset are excluded
 * and the remaining weights renormalise over what exists, exactly as the
 * Strata Score does. An equity with no liquidity feed competes on the six
 * components it has, rather than being quietly marked down for the seventh.
 * If too little is present to be meaningful, power is null and the entrant's
 * HP does not move at all — a coverage gap must never read as poor
 * performance.
 */

export interface ArenaPower {
  /** 0–100. Null when the record supports too little to judge. */
  power: number | null;
  /** Share of weight backed by real components, 0–1. */
  coverage: number;
  /** Components that actually contributed. */
  contributing: string[];
  unavailableReason: string | null;
}

/** Below this share of weight, an entrant is not judged this pass. */
const MINIMUM_COVERAGE = 0.5;

export function computeArenaPower(
  record: AssetIntelligence,
  config: ArenaConfig,
): ArenaPower {
  const weights = config.hpWeights;
  const { engines, score } = record;

  const readings: { key: keyof ArenaHpWeights; value: number | null }[] = [
    { key: "score", value: score.score },
    { key: "momentum", value: engines.momentum.score },
    { key: "relativeStrength", value: engines.relativeStrength.score },
    { key: "volume", value: engines.volume.score },
    { key: "activity", value: engines.activity.score },
    { key: "liquidity", value: engines.liquidity.score },
  ];

  const present = readings.filter(
    (reading): reading is { key: keyof ArenaHpWeights; value: number } =>
      reading.value !== null,
  );

  const totalWeight = readings.reduce((sum, r) => sum + weights[r.key], 0);
  const availableWeight = present.reduce((sum, r) => sum + weights[r.key], 0);
  const coverage = totalWeight === 0 ? 0 : availableWeight / totalWeight;

  if (coverage < MINIMUM_COVERAGE || present.length === 0) {
    return {
      power: null,
      coverage: round(coverage, 4),
      contributing: present.map((r) => r.key),
      unavailableReason: `only ${(coverage * 100).toFixed(0)}% of arena weight is backed by computed components`,
    };
  }

  // renormalised over what exists, so a six-component entrant is on the same
  // 0-100 axis as a seven-component one
  const power = present.reduce(
    (sum, r) => sum + clamp(r.value, 0, 100) * (weights[r.key] / availableWeight),
    0,
  );

  return {
    power: round(clamp(power, 0, 100), 2),
    coverage: round(coverage, 4),
    contributing: present.map((r) => r.key),
    unavailableReason: null,
  };
}

/**
 * HP movement for one pass.
 *
 * Linear in the distance from neutral and hard-capped, so a round is decided
 * by sustained performance rather than by one violent print. An entrant with
 * no power reading does not move: the correct response to missing data is to
 * do nothing, not to assume the worst.
 */
export function hpDelta(power: number | null, config: ArenaConfig): number {
  if (power === null) return 0;

  const distance = (power - config.neutralPower) / config.neutralPower;
  const delta = distance * config.maxHpChangePerPass;
  return round(clamp(delta, -config.maxHpChangePerPass, config.maxHpChangePerPass), 2);
}

export function nextHp(currentHp: number, delta: number, config: ArenaConfig): number {
  return round(clamp(currentHp + delta, 0, config.maximumHp), 2);
}

export function statusForHp(
  hp: number,
  config: ArenaConfig,
): "active" | "at_risk" | "eliminated" {
  if (hp <= config.eliminationHp) return "eliminated";
  if (hp < config.atRiskHp) return "at_risk";
  return "active";
}
