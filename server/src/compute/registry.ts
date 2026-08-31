import {
  CURRENT_SCORING_VERSION,
  listScoringVersions,
  scoringConfig,
  type ScoringConfig,
} from "../config/scoring.ts";

/**
 * The published record of how scores are computed.
 *
 * Versions coexist rather than replace one another: a stored result keeps the
 * version it was computed under, and this registry is what lets the API state
 * the weights that produced it. Changing a weight means adding a version, not
 * editing one — otherwise a score published yesterday would silently acquire
 * a new meaning today.
 */

export interface ComputeVersionInfo {
  version: string;
  description: string;
  weights: Record<string, number>;
  minimumCoverage: number;
  requiredComponents: string[];
  isCurrent: boolean;
}

function describe(config: ScoringConfig): ComputeVersionInfo {
  return {
    version: config.version,
    description: config.description,
    weights: { ...config.weights },
    minimumCoverage: config.minimumCoverage,
    requiredComponents: [...config.requiredComponents],
    isCurrent: config.version === CURRENT_SCORING_VERSION,
  };
}

export function getComputeVersion(version?: string): ComputeVersionInfo {
  return describe(scoringConfig(version ?? CURRENT_SCORING_VERSION));
}

export function listComputeVersions(): ComputeVersionInfo[] {
  return listScoringVersions().map(describe);
}

export { CURRENT_SCORING_VERSION };
