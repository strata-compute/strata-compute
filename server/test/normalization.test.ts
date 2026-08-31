import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSnapshot,
  normalizeSnapshots,
} from "../src/normalization/normalize.ts";
import type { RawMarketSnapshot } from "../src/types/domain.ts";

const base: RawMarketSnapshot = {
  symbol: "test",
  assetType: "crypto",
  price: 100,
  source: "unit-test",
  isMock: false,
};

describe("normalization", () => {
  it("uppercases symbols and defaults the name to the symbol", () => {
    const { data } = normalizeSnapshot({ ...base, symbol: "  btc " });
    assert.equal(data?.symbol, "BTC");
    assert.equal(data?.name, "BTC");
  });

  it("coerces numeric strings, including thousands separators", () => {
    const { data } = normalizeSnapshot({
      ...base,
      price: "1,234.56",
      volume24h: "38649374",
      marketCap: " 900000 ",
    });
    assert.equal(data?.price, 1234.56);
    assert.equal(data?.volume24h, 38649374);
    assert.equal(data?.marketCap, 900000);
  });

  it("accepts epoch seconds, epoch milliseconds and ISO timestamps alike", () => {
    const seconds = normalizeSnapshot({ ...base, timestamp: 1787000000 }).data;
    const millis = normalizeSnapshot({ ...base, timestamp: 1787000000000 }).data;
    const iso = normalizeSnapshot({ ...base, timestamp: "2026-08-29T09:00:00Z" }).data;

    assert.equal(seconds?.timestamp, millis?.timestamp);
    assert.equal(iso?.timestamp, "2026-08-29T09:00:00.000Z");
  });

  it("records absent optional fields rather than inventing values", () => {
    const { data } = normalizeSnapshot(base);
    assert.equal(data?.volume24h, null);
    assert.equal(data?.marketCap, null);
    assert.equal(data?.liquidity, null);
    assert.ok(data?.missingFields.includes("volume24h"));
    assert.ok(data?.missingFields.includes("marketCap"));
  });

  it("rejects a record with no usable price", () => {
    for (const price of [undefined, null, "abc", 0, -5, Number.NaN]) {
      const result = normalizeSnapshot({ ...base, price });
      assert.equal(result.data, null, `price ${String(price)} should be rejected`);
      assert.match(result.rejectedReason ?? "", /price/);
    }
  });

  it("rejects a record with no symbol", () => {
    const result = normalizeSnapshot({ ...base, symbol: "   " });
    assert.equal(result.data, null);
    assert.match(result.rejectedReason ?? "", /symbol/);
  });

  it("falls back to ingestion time when the provider timestamp is unparseable", () => {
    const { data } = normalizeSnapshot({ ...base, timestamp: "not-a-date" });
    assert.ok(data);
    assert.ok(data.missingFields.includes("timestamp"));
    assert.ok(Number.isFinite(new Date(data.timestamp).getTime()));
  });

  it("lowercases contract addresses so lookups are stable", () => {
    const { data } = normalizeSnapshot({
      ...base,
      contractAddress: "0xAF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    });
    assert.equal(data?.contractAddress, "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9");
  });

  it("separates good records from bad ones in a batch", () => {
    const { normalized, rejected } = normalizeSnapshots([
      { ...base, symbol: "AAA" },
      { ...base, symbol: "BBB", price: "nonsense" },
      { ...base, symbol: "CCC", price: 42 },
    ]);

    assert.equal(normalized.length, 2);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.symbol, "BBB");
  });

  it("preserves the source and mock flag for attribution", () => {
    const { data } = normalizeSnapshot({ ...base, source: "coingecko", isMock: false });
    assert.equal(data?.source, "coingecko");
    assert.equal(data?.isMock, false);
  });
});
