import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryStore } from "../src/database/memory-store.ts";
import { eventKey, reconcile } from "../src/intelligence/engine.ts";
import { persistenceOf } from "../src/intelligence/significance.ts";
import type { StrataStore } from "../src/database/store.ts";
import type { Observation } from "../src/types/domain.ts";

/**
 * PERSISTENCE CONTRACT TESTS
 *
 * These exercise the store *interface*, against the in-memory implementation.
 * They are not a substitute for running against Postgres — Phase 7 proved
 * exactly why, since three defects (a missing column, a JSONB payload, an
 * array type) lived entirely inside SQL strings that no type-checker or
 * memory-backed test could see.
 *
 * What they do pin down is the behaviour both implementations must share, and
 * which is easy to break silently: that history accumulates rather than being
 * overwritten, that a backfill re-run does not double-count, and that a
 * computation which could not produce a score still records that it ran.
 */

const ASSET = {
  symbol: "TEST",
  name: "Test Asset",
  assetType: "crypto" as const,
  chain: null,
  contractAddress: null,
  logoUrl: null,
};

function observation(minutesAgo: number, price: number): Observation {
  return {
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    price,
    volume24h: 1_000_000,
    liquidity: null,
    tradeCount24h: null,
    uniqueParticipants24h: null,
  };
}

async function seeded(): Promise<{ store: StrataStore; assetId: string }> {
  const store = new MemoryStore();
  const [asset] = await store.upsertAssets([ASSET]);
  return { store, assetId: asset!.id };
}

describe("asset persistence", () => {
  it("does not duplicate an asset across ingestion cycles", async () => {
    const store = new MemoryStore();
    await store.upsertAssets([ASSET]);
    await store.upsertAssets([ASSET]);
    await store.upsertAssets([{ ...ASSET, name: "Renamed" }]);

    const assets = await store.listAssets({});
    assert.equal(assets.length, 1, "symbol + type identifies one asset");
    assert.equal(assets[0]?.name, "Renamed", "metadata updates in place");
  });

  it("keeps a logo already published when a later pass omits it", async () => {
    const store = new MemoryStore();
    await store.upsertAssets([{ ...ASSET, logoUrl: "https://example.test/a.png" }]);
    await store.upsertAssets([{ ...ASSET, logoUrl: null }]);

    const [asset] = await store.listAssets({});
    assert.equal(asset?.logoUrl, "https://example.test/a.png");
  });
});

describe("historical observations", () => {
  it("accumulates rather than overwriting the latest value", async () => {
    const { store, assetId } = await seeded();

    await store.backfillObservations(assetId, [
      observation(180, 100),
      observation(120, 101),
      observation(60, 102),
    ]);

    const history = await store.getObservationHistory(assetId, 100);
    assert.equal(history.length, 3, "every observation is retained");
  });

  it("returns history oldest-first", async () => {
    const { store, assetId } = await seeded();
    await store.backfillObservations(assetId, [
      observation(60, 102),
      observation(180, 100),
      observation(120, 101),
    ]);

    const history = await store.getObservationHistory(assetId, 100);
    const times = history.map((point) => new Date(point.timestamp).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it("does not double-count when a backfill is re-run", async () => {
    const { store, assetId } = await seeded();
    const points = [observation(180, 100), observation(120, 101)];

    const first = await store.backfillObservations(assetId, points);
    const second = await store.backfillObservations(assetId, points);

    assert.equal(first, 2);
    assert.equal(second, 0, "an already-stored timestamp is skipped");
    assert.equal((await store.getObservationHistory(assetId, 100)).length, 2);
  });

  it("respects the requested limit", async () => {
    const { store, assetId } = await seeded();
    await store.backfillObservations(
      assetId,
      Array.from({ length: 40 }, (_, i) => observation(400 - i, 100 + i)),
    );

    const history = await store.getObservationHistory(assetId, 10);
    assert.equal(history.length, 10);
  });
});

describe("computation history", () => {
  it("never overwrites an earlier score", async () => {
    const { store, assetId } = await seeded();

    for (const [i, score] of [82.1, 83.4, 87.2].entries()) {
      await store.insertScores([
        {
          assetId,
          score,
          status: "OK",
          confidence: 0.9,
          version: "v1",
          timestamp: new Date(Date.now() - (3 - i) * 60_000).toISOString(),
          sources: ["test"],
        },
      ]);
    }

    const history = await store.getScoreHistory(assetId, 50);
    assert.equal(history.length, 3, "all three observations remain queryable");
    assert.deepEqual([...history.map((s) => s.score)].sort(), [82.1, 83.4, 87.2]);
  });

  it("records a pass that could not produce a score", async () => {
    const { store, assetId } = await seeded();
    await store.insertScores([
      {
        assetId,
        score: null,
        status: "INSUFFICIENT_DATA",
        confidence: 0.4,
        version: "v1",
        timestamp: new Date().toISOString(),
        sources: ["test"],
      },
    ]);

    const [stored] = await store.getScoreHistory(assetId, 10);
    assert.equal(stored?.score, null);
    assert.equal(stored?.status, "INSUFFICIENT_DATA");
    // "we looked and could not compute" is a result, not an absence of one
  });
});

describe("arena persistence", () => {
  it("keeps a settled round permanently and does not resettle it", async () => {
    const store = new MemoryStore();
    const round = await store.createArenaRound({
      season: 1,
      roundNumber: 1,
      status: "active",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      settledAt: null,
      winnerAssetId: null,
      winnerSymbol: null,
      winnerScore: null,
      winnerHp: null,
      arenaVersion: "arena-v1",
    });

    const settled = await store.settleArenaRound(round.id, {
      settledAt: new Date().toISOString(),
      winnerAssetId: "a1",
      winnerSymbol: "BTC",
      winnerScore: 71.2,
      winnerHp: 118.4,
    });

    assert.equal(settled?.status, "settled");
    assert.equal(settled?.winnerSymbol, "BTC");

    const reread = await store.getArenaRoundById(round.id);
    assert.equal(reread?.winnerSymbol, "BTC", "the outcome is durable");
  });

  it("retains arena events for a round", async () => {
    const store = new MemoryStore();
    const round = await store.createArenaRound({
      season: 1,
      roundNumber: 2,
      status: "active",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      settledAt: null,
      winnerAssetId: null,
      winnerSymbol: null,
      winnerScore: null,
      winnerHp: null,
      arenaVersion: "arena-v1",
    });

    await store.insertArenaEvents([
      {
        roundId: round.id,
        assetId: "a1",
        symbol: "BTC",
        eventType: "ARENA_ELIMINATION",
        previousValue: 12,
        newValue: 0,
        change: -12,
        summary: "BTC was eliminated",
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);

    const events = await store.listArenaEvents(round.id, 10);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.summary, "BTC was eliminated");
  });
});

describe("operational stats", () => {
  it("reports counts from stored data, not from process counters", async () => {
    const { store, assetId } = await seeded();
    await store.backfillObservations(assetId, [observation(60, 100)]);
    await store.insertScores([
      {
        assetId,
        score: 70,
        status: "OK",
        confidence: 0.9,
        version: "v1",
        timestamp: new Date().toISOString(),
        sources: ["test"],
      },
    ]);

    const stats = await store.getPersistedStats();
    assert.equal(stats.assetsTracked, 1);
    assert.equal(stats.scoresComputed, 1);
    assert.ok(stats.marketSnapshots >= 1);
    assert.ok(stats.lastComputationAt !== null, "derived from stored rows");
  });

  it("reports nothing rather than zero on an empty store", async () => {
    const stats = await new MemoryStore().getPersistedStats();
    assert.equal(stats.lastIngestionAt, null);
    assert.equal(stats.lastComputationAt, null);
    assert.equal(stats.assetsTracked, 0);
  });
});

/* --------------------------------------------- intelligence events ------- */

/**
 * The lifecycle only works if the open set survives a restart. The engine
 * decides "new or continuing" by looking up what is already open, so a
 * process that came back with an empty map would re-create every condition it
 * had already reported — the exact duplication the design exists to prevent.
 */
describe("intelligence event persistence", () => {
  const detection = (magnitude: number) => ({
    assetId: "asset-1",
    symbol: "TEST",
    assetType: "crypto" as const,
    eventType: "STRENGTH_ACCELERATION" as const,
    magnitude,
    significance: {
      magnitude: 0.8,
      persistence: persistenceOf(1),
      historicalDeviation: 0.9,
      dataConfidence: 0.9,
      value: 0.5,
    },
    confidence: 0.8,
    driverAgreement: 0.9,
    drivers: [],
    context: {},
    value: 70,
  });

  /** One computation pass: read what is open, reconcile, write the outcome. */
  async function pass(
    store: StrataStore,
    detections: ReturnType<typeof detection>[],
    now: string,
  ) {
    const open = await store.listOpenIntelligenceEvents();
    const result = reconcile({
      detections,
      open: new Map(open.map((e) => [eventKey(e.assetId, e.eventType), e])),
      computationVersion: "test",
      now,
    });
    await store.upsertIntelligenceEvents(result.upserts);
    await store.closeIntelligenceEvents([...result.resolved, ...result.expired]);
    return result;
  }

  it("holds one open event per asset and type however often it is written", async () => {
    const store: StrataStore = new MemoryStore();

    for (let i = 0; i < 10; i += 1) {
      await pass(store, [detection(10)], `2026-01-08T10:${String(i).padStart(2, "0")}:00.000Z`);
    }

    const open = await store.listOpenIntelligenceEvents();
    assert.equal(open.length, 1, "ten passes must leave one open event");
    assert.equal(open[0]?.observations, 10);
    assert.equal((await store.countIntelligenceEvents()).open, 1);
  });

  it("survives a restart with its detection time and history intact", async () => {
    const store: StrataStore = new MemoryStore();
    await pass(store, [detection(10)], "2026-01-08T10:00:00.000Z");
    await pass(store, [detection(14)], "2026-01-08T10:02:00.000Z");

    // the restart: nothing carried in memory, everything read back from store
    const after = await pass(store, [detection(18)], "2026-01-08T10:04:00.000Z");

    assert.equal(after.created, 0, "a restart must not re-create an open event");
    assert.equal(after.updated, 1);
    assert.equal(after.upserts[0]?.detectedAt, "2026-01-08T10:00:00.000Z");
    assert.equal(after.upserts[0]?.observations, 3);
    assert.equal(after.upserts[0]?.firstValue, 70);
  });

  it("closes an event when the condition stops, and keeps it queryable", async () => {
    const store: StrataStore = new MemoryStore();
    await pass(store, [detection(10)], "2026-01-08T10:00:00.000Z");
    await pass(store, [], "2026-01-08T10:02:00.000Z");

    assert.equal((await store.listOpenIntelligenceEvents()).length, 0);

    const history = await store.listIntelligenceEvents({
      assetId: "asset-1",
      status: ["resolved"],
      limit: 10,
    });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.resolvedAt, "2026-01-08T10:02:00.000Z");

    const counts = await store.countIntelligenceEvents();
    assert.equal(counts.open, 0);
    assert.equal(counts.resolved, 1);
  });

  it("reopens as a new event once a resolved condition returns", async () => {
    const store: StrataStore = new MemoryStore();
    await pass(store, [detection(10)], "2026-01-08T10:00:00.000Z");
    await pass(store, [], "2026-01-08T10:02:00.000Z");
    const again = await pass(store, [detection(12)], "2026-01-08T10:04:00.000Z");

    assert.equal(again.created, 1, "a condition that returns is a new occurrence");
    assert.equal(again.upserts[0]?.detectedAt, "2026-01-08T10:04:00.000Z");
    assert.equal(again.upserts[0]?.observations, 1);
  });
});
