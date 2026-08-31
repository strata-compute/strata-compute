/**
 * ARENA CONFIGURATION
 *
 * Every rule the Arena runs on lives here: field size, round length, how HP
 * moves, what counts as at-risk, how many are eliminated, how a winner is
 * chosen. Nothing in the arena code hardcodes any of it.
 *
 * The Arena is a competitive presentation of computed market strength, and
 * the thing that keeps it honest is that no quantity in it is invented. HP is
 * a pure function of the same components that produce a Strata Score, so an
 * asset's survival is determined by measured market behaviour rather than by
 * a die roll dressed up as one. Change a weight here and the whole model
 * moves coherently; there is no second place where HP is nudged.
 */

export interface ArenaHpWeights {
  /** Composite standing against the rest of the field. */
  score: number;
  /** Directional strength over the round's timeframes. */
  momentum: number;
  /** Performance against the asset's own class benchmark. */
  relativeStrength: number;
  /** Participation: is the market actually trading. */
  volume: number;
  activity: number;
  /** Depth, where a provider publishes it. */
  liquidity: number;
}

export interface ArenaConfig {
  readonly version: string;
  /** How long a round runs, in milliseconds. */
  readonly roundDurationMs: number;
  /** Maximum entrants. The field is the top N by Strata Score. */
  readonly fieldSize: number;
  /** Minimum scored assets before a round can open at all. */
  readonly minimumField: number;
  /** Every entrant starts here. */
  readonly startingHp: number;
  readonly maximumHp: number;
  /** At or below this, an entrant is eliminated. */
  readonly eliminationHp: number;
  /** Below this, an entrant is flagged at risk. */
  readonly atRiskHp: number;

  /**
   * Weights over the components that determine arena power. Renormalised over
   * whichever components an asset actually has, exactly as the Strata Score
   * is — an asset with no liquidity feed competes on the rest rather than
   * being penalised for a gap in coverage.
   */
  readonly hpWeights: ArenaHpWeights;

  /**
   * How much HP one pass can move.
   *
   * Power is measured 0–100 and centred on 50: an asset performing at the
   * field's midpoint holds its HP, above it gains, below it loses. The cap
   * keeps a single volatile pass from ending a round on its own.
   */
  readonly maxHpChangePerPass: number;
  /** Power below which HP starts falling. 50 is the neutral midpoint. */
  readonly neutralPower: number;

  /** Bottom N entrants eliminated when a round settles. */
  readonly eliminationsAtSettlement: number;

  /** HP movement at or beyond this magnitude is worth an event. */
  readonly hpEventThreshold: number;
  /** Rank movement at or beyond this many places is worth an event. */
  readonly rankEventThreshold: number;
}

export const ARENA_V1: ArenaConfig = {
  version: "arena-v1",
  roundDurationMs: 4 * 60 * 60 * 1000,
  fieldSize: 16,
  minimumField: 4,
  startingHp: 100,
  maximumHp: 150,
  eliminationHp: 0,
  atRiskHp: 35,

  hpWeights: {
    score: 0.34,
    momentum: 0.24,
    relativeStrength: 0.18,
    volume: 0.12,
    activity: 0.07,
    liquidity: 0.05,
  },

  maxHpChangePerPass: 6,
  neutralPower: 50,
  eliminationsAtSettlement: 4,

  hpEventThreshold: 4,
  rankEventThreshold: 2,
};

const REGISTRY: Record<string, ArenaConfig> = {
  [ARENA_V1.version]: ARENA_V1,
};

export const CURRENT_ARENA_VERSION = ARENA_V1.version;

export function arenaConfig(version: string = CURRENT_ARENA_VERSION): ArenaConfig {
  const config = REGISTRY[version];
  if (!config) throw new Error(`Unknown arena version: ${version}`);
  return config;
}
