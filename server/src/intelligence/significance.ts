import { SIGNIFICANCE } from "../config/intelligence.ts";
import { clamp, round } from "../utils/number.ts";

/**
 * PERSISTENCE
 *
 * How much credit a condition earns for having held.
 *
 * Significance is a product, so this term has veto power: whatever it returns
 * near zero collapses everything else. That makes the shape of the curve a
 * real design decision rather than a scaling detail.
 *
 * It runs from a floor at one observation to 1.0 at saturation. The floor is
 * the load-bearing part — a first sighting is a genuine measurement, not a
 * near-zero one, and treating it as near-zero would prevent any event from
 * ever being raised at all.
 *
 * Shared by the detectors, the market detectors and the lifecycle engine, so
 * that "seen three times" means the same thing everywhere.
 */
export function persistenceOf(observations: number): number {
  if (observations <= 0) return 0;

  const { persistenceFloor: floor, persistenceSaturation: saturation } = SIGNIFICANCE;
  const confirmed = clamp((observations - 1) / Math.max(saturation - 1, 1), 0, 1);

  return round(floor + (1 - floor) * confirmed, 4);
}
