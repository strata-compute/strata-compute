import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { ARENA_V1, arenaConfig } from "../src/config/arena.ts";
import {
  __resetBus,
  bufferSize,
  emit,
  recent,
  replayAfter,
  subscribe,
  subscriberCount,
} from "../src/events/bus.ts";
import { categoryOf, EVENT_TYPES } from "../src/events/types.ts";
import type { StrataEvent } from "../src/events/types.ts";
import { computeArenaPower, hpDelta, nextHp, statusForHp } from "../src/arena/power.ts";
import type { AssetIntelligence } from "../src/types/domain.ts";
import type { EngineOutputs } from "../src/types/intelligence.ts";

/**
 * REAL-TIME AND ARENA TESTS
 *
 * Two properties are under test that the rest of the suite cannot cover.
 *
 * The event stream must be ordered, replayable and incapable of inventing
 * anything. A client that reconnects has to receive exactly what it missed —
 * not a summary, not a regenerated approximation — because a feed that
 * silently fills gaps is worse than one that admits them.
 *
 * And the Arena must be deterministic. It is the one feature whose framing
 * invites a nudge for drama, so the tests assert that identical inputs
 * produce identical HP, that missing components cost an entrant nothing, and
 * that elimination follows the published rule rather than the score.
 */

/* ------------------------------------------------------------ helpers --- */

function engines(values: Partial<Record<string, number | null>>): EngineOutputs {
  const none = (reason: string) => ({ score: null, unavailableReason: reason });
  const has = (key: string) => values[key] !== undefined && values[key] !== null;

  return {
    momentum: has("momentum")
      ? {
          score: values.momentum as number,
          direction: "rising",
          change: null,
          timeframes: ["24h"],
          unavailableReason: null,
        }
      : { ...none("no data"), direction: null, change: null, timeframes: [] },
    volume: has("volume")
      ? {
          score: values.volume as number,
          regime: "NORMAL",
          relativeVolume: 1,
          acceleration: null,
          unavailableReason: null,
        }
      : { ...none("no data"), regime: null, relativeVolume: null, acceleration: null },
    activity: has("activity")
      ? { score: values.activity as number, basis: "onchain", unavailableReason: null }
      : { ...none("no data"), basis: null },
    liquidity: has("liquidity")
      ? {
          score: values.liquidity as number,
          state: "stable",
          changePct: 0,
          unavailableReason: null,
        }
      : { ...none("no data"), state: null, changePct: null },
    volatility: { ...none("no data"), shortTermPct: null, mediumTermPct: null, expansion: null },
    relativeStrength: has("relativeStrength")
      ? {
          score: values.relativeStrength as number,
          excessReturnPct: 1,
          benchmarkId: "crypto-majors",
          benchmarkLabel: "Crypto majors",
          unavailableReason: null,
        }
      : {
          ...none("no data"),
          excessReturnPct: null,
          benchmarkId: null,
          benchmarkLabel: null,
        },
    trend: { ...none("no data"), state: null, slopePctPerDay: null, fitQuality: null },
  };
}

function record(
  score: number | null,
  componentValues: Partial<Record<string, number | null>>,
): AssetIntelligence {
  return {
    assetId: "asset-1",
    symbol: "TEST",
    assetType: "crypto",
    score: {
      status: score === null ? "INSUFFICIENT_DATA" : "OK",
      score,
      version: "v1",
      components: {},
      missing: [],
      confidence: {
        value: 0.9,
        band: "HIGH",
        completeness: 1,
        freshness: 1,
        historicalDepth: 1,
        componentsAvailable: 7,
        componentsTotal: 7,
      },
      drivers: [],
      insufficientReason: null,
      calculatedAt: "2026-01-08T00:00:00.000Z",
    },
    engines: engines(componentValues),
    historyPoints: 100,
    ageSeconds: 10,
    sources: ["test"],
    timestamp: "2026-01-08T00:00:00.000Z",
  };
}

/* --------------------------------------------------------- event bus --- */

describe("event bus", () => {
  beforeEach(() => __resetBus());

  it("stamps every event with an id, a timestamp and a version", () => {
    const event = emit({ eventType: "STRATA_SCORE_CHANGED", summary: "test" });
    assert.ok(event.id.length > 0);
    assert.ok(event.timestamp.length > 0);
    assert.ok(event.computationVersion.length > 0);
    assert.equal(event.severity, "info");
  });

  it("delivers to subscribers in emission order", () => {
    const seen: string[] = [];
    subscribe((event) => seen.push(event.summary));

    emit({ eventType: "RANK_CHANGED", summary: "first" });
    emit({ eventType: "RANK_CHANGED", summary: "second" });
    emit({ eventType: "RANK_CHANGED", summary: "third" });

    assert.deepEqual(seen, ["first", "second", "third"]);
  });

  it("honours a type filter", () => {
    const seen: string[] = [];
    subscribe((event) => seen.push(event.eventType), { types: ["ARENA_WINNER"] });

    emit({ eventType: "RANK_CHANGED", summary: "ignored" });
    emit({ eventType: "ARENA_WINNER", summary: "kept" });

    assert.deepEqual(seen, ["ARENA_WINNER"]);
  });

  it("honours a category filter", () => {
    const seen: string[] = [];
    subscribe((event) => seen.push(event.eventType), { category: "arena" });

    emit({ eventType: "STRATA_SCORE_CHANGED", summary: "market" });
    emit({ eventType: "ARENA_ELIMINATION", summary: "arena" });

    assert.deepEqual(seen, ["ARENA_ELIMINATION"]);
  });

  it("replays exactly what a reconnecting client missed", () => {
    const first = emit({ eventType: "RANK_CHANGED", summary: "one" });
    emit({ eventType: "RANK_CHANGED", summary: "two" });
    emit({ eventType: "RANK_CHANGED", summary: "three" });

    const missed = replayAfter(first.id);
    assert.deepEqual(missed.map((e) => e.summary), ["two", "three"]);
  });

  it("replays nothing when the client is already current", () => {
    emit({ eventType: "RANK_CHANGED", summary: "one" });
    const last = emit({ eventType: "RANK_CHANGED", summary: "two" });
    assert.deepEqual(replayAfter(last.id), []);
  });

  it("returns the whole buffer when the client's marker has aged out", () => {
    emit({ eventType: "RANK_CHANGED", summary: "one" });
    emit({ eventType: "RANK_CHANGED", summary: "two" });
    // an id the buffer has never held: the gap is real and is surfaced rather
    // than hidden behind an empty reply
    const replayed = replayAfter("00000000-0000-0000-0000-000000000000");
    assert.equal(replayed.length, 2);
  });

  it("unsubscribes cleanly", () => {
    const subscription = subscribe(() => {});
    assert.ok(subscription);
    assert.equal(subscriberCount(), 1);
    subscription.unsubscribe();
    assert.equal(subscriberCount(), 0);
  });

  it("isolates a subscriber that throws", () => {
    const seen: string[] = [];
    subscribe(() => {
      throw new Error("boom");
    });
    subscribe((event) => seen.push(event.summary));

    emit({ eventType: "RANK_CHANGED", summary: "delivered" });
    assert.deepEqual(seen, ["delivered"], "the healthy subscriber still received it");
  });

  it("bounds the replay buffer", () => {
    for (let i = 0; i < 600; i += 1) {
      emit({ eventType: "RANK_CHANGED", summary: `event-${i}` });
    }
    assert.ok(bufferSize() <= 500);
  });

  it("returns recent events newest first", () => {
    emit({ eventType: "RANK_CHANGED", summary: "older" });
    emit({ eventType: "RANK_CHANGED", summary: "newer" });
    const events = recent();
    assert.equal(events[0]?.summary, "newer");
  });

  it("assigns every declared event type a category", () => {
    for (const type of EVENT_TYPES) {
      assert.ok(categoryOf(type), `${type} has no category`);
    }
  });
});

/* ------------------------------------------------------------- arena --- */

describe("arena power", () => {
  const config = arenaConfig();

  it("is deterministic for identical input", () => {
    const subject = record(80, { momentum: 70, relativeStrength: 60, volume: 65 });
    const a = computeArenaPower(subject, config);
    const b = computeArenaPower(subject, config);
    assert.deepEqual(a, b);
  });

  it("renormalises over the components that exist", () => {
    // identical readings, one set simply missing more components
    const full = computeArenaPower(
      record(70, {
        momentum: 70,
        relativeStrength: 70,
        volume: 70,
        activity: 70,
        liquidity: 70,
      }),
      config,
    );
    const partial = computeArenaPower(
      record(70, { momentum: 70, relativeStrength: 70, volume: 70 }),
      config,
    );

    assert.equal(full.power, 70);
    assert.equal(partial.power, 70, "a coverage gap is not a performance penalty");
    assert.ok(partial.coverage < full.coverage);
  });

  it("declines to judge an entrant with too little coverage", () => {
    const thin = computeArenaPower(record(null, { activity: 60 }), config);
    assert.equal(thin.power, null);
    assert.ok(thin.unavailableReason);
  });

  it("costs an unjudgeable entrant no HP", () => {
    assert.equal(hpDelta(null, config), 0);
  });

  it("moves HP up above neutral and down below it", () => {
    assert.ok(hpDelta(90, config) > 0);
    assert.ok(hpDelta(10, config) < 0);
    assert.equal(hpDelta(config.neutralPower, config), 0);
  });

  it("caps how much one pass can move HP", () => {
    assert.ok(Math.abs(hpDelta(100, config)) <= config.maxHpChangePerPass);
    assert.ok(Math.abs(hpDelta(0, config)) <= config.maxHpChangePerPass);
  });

  it("clamps HP to the configured range", () => {
    assert.equal(nextHp(config.maximumHp, 50, config), config.maximumHp);
    assert.equal(nextHp(1, -50, config), 0);
  });

  it("derives status from HP against published thresholds", () => {
    assert.equal(statusForHp(100, config), "active");
    assert.equal(statusForHp(config.atRiskHp - 1, config), "at_risk");
    assert.equal(statusForHp(0, config), "eliminated");
  });

  it("keeps every weight and threshold in configuration", () => {
    const total = Object.values(ARENA_V1.hpWeights).reduce((sum, w) => sum + w, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, "hp weights sum to 1");
    assert.ok(ARENA_V1.minimumField >= 2);
    assert.ok(ARENA_V1.eliminationHp < ARENA_V1.atRiskHp);
  });

  it("produces the same HP trajectory when replayed", () => {
    // the same sequence of passes must reconstruct the same round
    const subject = record(75, { momentum: 68, relativeStrength: 61, volume: 72 });
    const run = () => {
      let hp = config.startingHp;
      for (let pass = 0; pass < 10; pass += 1) {
        hp = nextHp(hp, hpDelta(computeArenaPower(subject, config).power, config), config);
      }
      return hp;
    };
    assert.equal(run(), run());
  });
});

/* ------------------------------------------------- event construction --- */

describe("event payloads", () => {
  beforeEach(() => __resetBus());

  it("carries the values that produced the event", () => {
    const event: StrataEvent = emit({
      eventType: "STRATA_SCORE_CHANGED",
      assetId: "a1",
      symbol: "BTC",
      previousValue: 71.2,
      newValue: 74.8,
      change: 3.6,
      summary: "BTC Strata Score 71.2 → 74.8",
    });

    // a claim a reader can check, not one they must take on trust
    assert.equal(event.previousValue, 71.2);
    assert.equal(event.newValue, 74.8);
    assert.equal(event.change, 3.6);
    assert.match(event.summary, /71\.2/);
    assert.match(event.summary, /74\.8/);
  });

  it("defaults metadata rather than leaving it undefined", () => {
    const event = emit({ eventType: "RANK_CHANGED", summary: "x" });
    assert.deepEqual(event.metadata, {});
    assert.equal(event.assetId, null);
  });
});
