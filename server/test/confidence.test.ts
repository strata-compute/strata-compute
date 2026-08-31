import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONFIDENCE } from "../src/config/score-v1.ts";
import { computeConfidence } from "../src/compute/score/calibrate.ts";

/**
 * CONFIDENCE TEST CASES
 *
 * Confidence answers one question: how much of the scoring model could
 * actually be evaluated for this asset, and how well-supported were the
 * inputs it used. It is not a second opinion about the score.
 *
 * These tests pin the properties that the previous additive model failed.
 * That model let two saturated terms — freshness and historical depth, both
 * near 1.0 across the covered set — contribute a constant 0.45 floor, which
 * guaranteed every asset cleared the HIGH threshold. An asset measured on
 * four of seven components reported the same band as one measured on six.
 *
 * Completeness now bounds the result multiplicatively, so no amount of
 * quality in what was measured can speak for what was not.
 */

/** A fully-supported asset: whole model, fresh, deep, large universe. */
const IDEAL = {
  coverage: 1,
  componentsAvailable: 7,
  ageSeconds: 10,
  historyPoints: CONFIDENCE.healthyHistoryPoints,
  universeSize: CONFIDENCE.healthyUniverseSize,
  universeMinimum: 8,
};

describe("confidence responds to each kind of weakness", () => {
  const ideal = computeConfidence(IDEAL);

  it("rewards a complete, fresh, deep, well-populated reading", () => {
    assert.ok(ideal.value > 0.95, `ideal case scored only ${ideal.value}`);
    assert.equal(ideal.band, "HIGH");
  });

  it("falls when components are missing", () => {
    const partial = computeConfidence({ ...IDEAL, coverage: 0.64, componentsAvailable: 4 });
    assert.ok(partial.value < ideal.value);
    // the failure of the old model: a 36-point coverage gap must move
    // confidence by far more than the 1.6 points it used to
    assert.ok(
      ideal.value - partial.value > 0.25,
      `coverage gap moved confidence only ${(ideal.value - partial.value).toFixed(3)}`,
    );
  });

  it("falls when history is short", () => {
    const shallow = computeConfidence({ ...IDEAL, historyPoints: 10 });
    assert.ok(shallow.value < ideal.value);
    assert.ok(shallow.historicalDepth < 0.1);
  });

  it("falls when the comparison universe is small", () => {
    const small = computeConfidence({ ...IDEAL, universeSize: 8 });
    assert.ok(small.value < ideal.value);
    // an 8-member universe moves a percentile 12.5 points per rank; that
    // coarseness has to show up somewhere
    assert.ok(ideal.value - small.value > 0.1);
  });

  it("falls when the observation is stale", () => {
    const stale = computeConfidence({ ...IDEAL, ageSeconds: 40_000 });
    assert.ok(stale.value < ideal.value);
    assert.ok(stale.freshness < 0.7);
  });

  it("falls furthest when several weaknesses combine", () => {
    const weak = computeConfidence({
      coverage: 0.5,
      componentsAvailable: 3,
      ageSeconds: 50_000,
      historyPoints: 12,
      universeSize: 6,
      universeMinimum: 8,
    });
    assert.ok(weak.value < 0.3, `combined weakness scored ${weak.value}`);
    assert.equal(weak.band, "LOW");
  });
});

describe("completeness bounds confidence", () => {
  it("cannot be rescued by perfect quality on the components that exist", () => {
    // the exact shape of the old model's failure: everything ideal except
    // coverage, which was previously enough to still read HIGH
    const halfCovered = computeConfidence({ ...IDEAL, coverage: 0.5, componentsAvailable: 3 });
    assert.ok(
      halfCovered.value <= 0.5,
      `half the model was evaluated but confidence read ${halfCovered.value}`,
    );
    assert.notEqual(halfCovered.band, "HIGH");
  });

  it("scales roughly linearly with coverage when quality is held constant", () => {
    const at = (coverage: number) =>
      computeConfidence({ ...IDEAL, coverage, componentsAvailable: 7 }).value;

    const quarter = at(0.25);
    const half = at(0.5);
    const full = at(1);

    assert.ok(half > quarter && full > half, "confidence must rise with coverage");
    // proportional rather than floored: doubling coverage roughly doubles it
    assert.ok(Math.abs(half / quarter - 2) < 0.15);
  });

  it("has no floor: zero coverage yields zero confidence", () => {
    const none = computeConfidence({ ...IDEAL, coverage: 0, componentsAvailable: 0 });
    assert.equal(none.value, 0);
  });
});

describe("bands", () => {
  it("are all reachable", () => {
    const high = computeConfidence(IDEAL);
    const medium = computeConfidence({ ...IDEAL, coverage: 0.7, componentsAvailable: 5 });
    const low = computeConfidence({
      ...IDEAL,
      coverage: 0.5,
      componentsAvailable: 3,
      universeSize: 6,
      historyPoints: 20,
    });

    assert.equal(high.band, "HIGH");
    assert.equal(medium.band, "MEDIUM");
    assert.equal(low.band, "LOW");
  });

  it("uses thresholds drawn from the configuration", () => {
    assert.ok(CONFIDENCE.bands.high > CONFIDENCE.bands.medium);
    assert.ok(CONFIDENCE.bands.medium > 0);
  });
});

describe("independence from the score", () => {
  it("reads no score input at all", () => {
    // computeConfidence takes coverage, age, depth and universe size. There
    // is no parameter through which a score could influence it, which is the
    // structural guarantee that the two stay separate concepts.
    const a = computeConfidence(IDEAL);
    const b = computeConfidence(IDEAL);
    assert.deepEqual(a, b);
    assert.ok(!("score" in (IDEAL as object)));
  });

  it("is deterministic", () => {
    const input = { ...IDEAL, coverage: 0.73, ageSeconds: 321, historyPoints: 88 };
    assert.deepEqual(computeConfidence(input), computeConfidence(input));
  });
});
