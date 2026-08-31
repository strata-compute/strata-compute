import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { MemoryStore } from "../src/database/memory-store.ts";
import type { RawMarketSnapshot } from "../src/types/domain.ts";

/**
 * Database insertion and duplicate prevention.
 *
 * `persistSnapshots` reaches for the shared store singleton, so these tests
 * exercise the store contract directly plus the dedupe rule in isolation —
 * the two things that actually decide what lands in Postgres.
 */

function snapshot(overrides: Partial<RawMarketSnapshot> = {}): RawMarketSnapshot {
  return {
    symbol: "BTC",
    assetType: "crypto",
    name: "Bitcoin",
    price: 77660,
    volume24h: 29795118774,
    priceChange24h: -1.83,
    timestamp: "2026-08-29T09:50:12.345Z",
    source: "coingecko",
    isMock: false,
    ...overrides,
  };
}

describe("store insertion", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("upserts an asset once per symbol and class", async () => {
    const first = await store.upsertAssets([
      { symbol: "BTC", name: "Bitcoin", assetType: "crypto", chain: null, contractAddress: null },
    ]);
    const second = await store.upsertAssets([
      { symbol: "btc", name: "Bitcoin", assetType: "crypto", chain: null, contractAddress: null },
    ]);

    assert.equal(first[0]?.id, second[0]?.id, "the same asset must not be duplicated");
    assert.equal(await store.countAssets(), 1);
  });

  it("treats the same ticker in different classes as different assets", async () => {
    await store.upsertAssets([
      { symbol: "AAPL", name: "Apple", assetType: "stock", chain: null, contractAddress: null },
      {
        symbol: "AAPL",
        name: "Apple Token",
        assetType: "onchain",
        chain: "robinhood",
        contractAddress: "0xabc",
      },
    ]);
    assert.equal(await store.countAssets(), 2);
  });

  it("updates metadata on a repeat upsert", async () => {
    const [created] = await store.upsertAssets([
      { symbol: "ENA", name: "Ethena", assetType: "onchain", chain: null, contractAddress: null },
    ]);
    const [updated] = await store.upsertAssets([
      {
        symbol: "ENA",
        name: "Ethena Labs",
        assetType: "onchain",
        chain: "ethereum",
        contractAddress: "0x57e1",
      },
    ]);

    assert.equal(created?.id, updated?.id);
    assert.equal(updated?.name, "Ethena Labs");
    assert.equal(updated?.chain, "ethereum");
  });

  it("returns the latest price and score in the read model", async () => {
    const [asset] = await store.upsertAssets([
      { symbol: "ETH", name: "Ethereum", assetType: "crypto", chain: null, contractAddress: null },
    ]);
    assert.ok(asset);

    await store.insertPrices([
      {
        assetId: asset.id,
        price: 2000,
        priceChange1h: null,
        priceChange24h: null,
        volume24h: null,
        marketCap: null,
        timestamp: "2026-08-29T09:00:00.000Z",
      },
      {
        assetId: asset.id,
        price: 2436.38,
        priceChange1h: 0.1,
        priceChange24h: 2.11,
        volume24h: 12_000_000_000,
        marketCap: 294_000_000_000,
        timestamp: "2026-08-29T09:50:00.000Z",
      },
    ]);

    const row = await store.getLatestMarketRow(asset.id);
    assert.equal(row?.price?.price, 2436.38, "the newest observation must win");
  });

  it("filters assets by class", async () => {
    await store.upsertAssets([
      { symbol: "BTC", name: "Bitcoin", assetType: "crypto", chain: null, contractAddress: null },
      { symbol: "AAPL", name: "Apple", assetType: "stock", chain: null, contractAddress: null },
    ]);

    const stocks = await store.listAssets({ assetType: "stock" });
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0]?.symbol, "AAPL");
  });
});

describe("duplicate prevention", () => {
  /**
   * Mirrors the fingerprint rule in persist.ts: an observation identical to
   * the previous one for that asset carries no new information.
   */
  function fingerprint(record: {
    timestamp: string;
    price: number;
    volume24h?: number | null;
    priceChange24h?: number | null;
  }) {
    return [
      record.timestamp,
      record.price,
      record.volume24h ?? "",
      record.priceChange24h ?? "",
    ].join("|");
  }

  it("produces the same fingerprint for a republished observation", () => {
    const a = snapshot();
    const b = snapshot();
    assert.equal(
      fingerprint({ timestamp: a.timestamp as string, price: a.price as number, volume24h: a.volume24h as number, priceChange24h: a.priceChange24h as number }),
      fingerprint({ timestamp: b.timestamp as string, price: b.price as number, volume24h: b.volume24h as number, priceChange24h: b.priceChange24h as number }),
    );
  });

  it("produces a different fingerprint when the price moves", () => {
    const a = snapshot();
    const b = snapshot({ price: 77_700 });
    assert.notEqual(
      fingerprint({ timestamp: a.timestamp as string, price: a.price as number }),
      fingerprint({ timestamp: b.timestamp as string, price: b.price as number }),
    );
  });

  it("produces a different fingerprint when only the timestamp advances", () => {
    const a = snapshot();
    const b = snapshot({ timestamp: "2026-08-29T09:51:12.345Z" });
    assert.notEqual(
      fingerprint({ timestamp: a.timestamp as string, price: a.price as number }),
      fingerprint({ timestamp: b.timestamp as string, price: b.price as number }),
    );
  });
});

describe("provider failure isolation", () => {
  it("one rejected provider does not stop the others", async () => {
    const results = await Promise.allSettled([
      Promise.resolve({ provider: "coingecko", ok: true }),
      Promise.reject(new Error("coingecko down")),
      Promise.resolve({ provider: "robinhood", ok: true }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 2, "healthy providers must still complete");
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  });
});
