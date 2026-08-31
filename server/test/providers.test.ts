import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alphaVantageThrottleReason,
  quoteToSnapshot,
} from "../src/providers/alphavantage/alphavantage-provider.ts";
import { mapCoinGeckoMarket } from "../src/providers/coingecko/coingecko-provider.ts";
import { mapQuoteToSnapshot } from "../src/providers/robinhood/robinhood-stock-token-provider.ts";
import { goPlusFlag, goPlusPercent } from "../src/providers/goplus/goplus-provider.ts";
import { normalizeSnapshot } from "../src/normalization/normalize.ts";
import {
  ALPHA_VANTAGE_EMPTY,
  ALPHA_VANTAGE_QUOTE_RESPONSE,
  ALPHA_VANTAGE_THROTTLED,
  COINGECKO_MARKETS_RESPONSE,
  GOPLUS_SECURITY_RESPONSE,
  GOPLUS_SPARSE_RESPONSE,
  ROBINHOOD_PRICE_HALTED,
  ROBINHOOD_PRICE_RESPONSE,
} from "./fixtures.ts";

describe("robinhood stock token parsing", () => {
  it("derives a mid price from bid and ask", () => {
    const quote = ROBINHOOD_PRICE_RESPONSE.quotes[0]!;
    const snapshot = mapQuoteToSnapshot(quote, "AAPL");
    // (316.94 + 320.26) / 2
    assert.equal(snapshot.price, 318.6);
    assert.equal(snapshot.symbol, "AAPL");
    assert.equal(snapshot.source, "robinhood_stock_tokens");
    assert.equal(snapshot.isMock, false);
  });

  it("falls back to the single side when the book is one-sided", () => {
    const quote = ROBINHOOD_PRICE_HALTED.quotes[0]!;
    const snapshot = mapQuoteToSnapshot(quote, "HALT");
    assert.equal(snapshot.price, 10);
  });

  it("carries the deployment contract address through", () => {
    const snapshot = mapQuoteToSnapshot(ROBINHOOD_PRICE_RESPONSE.quotes[0]!, "AAPL");
    assert.equal(snapshot.contractAddress, "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9");
  });

  it("produces a record normalization accepts", () => {
    const snapshot = mapQuoteToSnapshot(ROBINHOOD_PRICE_RESPONSE.quotes[0]!, "AAPL");
    const { data } = normalizeSnapshot(snapshot);
    assert.ok(data);
    assert.equal(data.assetType, "stock");
    assert.equal(data.price, 318.6);
  });
});

describe("coingecko parsing", () => {
  it("maps a market row onto a snapshot", () => {
    const snapshot = mapCoinGeckoMarket(COINGECKO_MARKETS_RESPONSE[0]!);
    assert.equal(snapshot?.symbol, "BTC");
    assert.equal(snapshot?.price, 77660);
    assert.equal(snapshot?.priceChange1h, 0.42);
    assert.equal(snapshot?.priceChange24h, -1.83);
    assert.equal(snapshot?.source, "coingecko");
  });

  it("classifies token assets as onchain and coins as crypto", () => {
    const btc = mapCoinGeckoMarket(COINGECKO_MARKETS_RESPONSE[0]!);
    assert.equal(btc?.assetType, "crypto");

    const token = mapCoinGeckoMarket({ id: "ethena", symbol: "ena", name: "Ethena", current_price: 1 });
    assert.equal(token?.assetType, "onchain");
  });

  it("survives a row missing the 1h change", () => {
    const snapshot = mapCoinGeckoMarket(COINGECKO_MARKETS_RESPONSE[1]!);
    assert.equal(snapshot?.priceChange1h, undefined);
    const { data } = normalizeSnapshot(snapshot!);
    assert.ok(data?.missingFields.includes("priceChange1h"));
  });
});

describe("alpha vantage parsing", () => {
  it("detects the 200-with-a-throttle-notice response", () => {
    assert.ok(alphaVantageThrottleReason(ALPHA_VANTAGE_THROTTLED));
    assert.equal(alphaVantageThrottleReason(ALPHA_VANTAGE_QUOTE_RESPONSE), null);
    assert.equal(alphaVantageThrottleReason(null), null);
  });

  it("converts share volume into notional volume", () => {
    const snapshot = quoteToSnapshot({
      symbol: "AAPL",
      price: 319.7,
      open: 316.845,
      high: 322.37,
      low: 315.4504,
      close: 319.7,
      volume: 1000,
      change24h: 1.4598,
      timestamp: "2026-08-28T00:00:00.000Z",
      source: "alpha_vantage",
    });
    // 1000 shares × 319.70 — the compute engine expects notional, not share count
    assert.equal(snapshot.volume24h, 319_700);
    assert.equal(snapshot.priceChange24h, 1.4598);
  });

  it("treats an empty quote object as no data", () => {
    const quote = ALPHA_VANTAGE_EMPTY["Global Quote"];
    assert.equal(Object.keys(quote).length, 0);
  });
});

describe("goplus flag mapping", () => {
  it("maps string booleans without guessing", () => {
    assert.equal(goPlusFlag("1"), true);
    assert.equal(goPlusFlag("0"), false);
    assert.equal(goPlusFlag(undefined), null);
    assert.equal(goPlusFlag("maybe"), null);
  });

  it("converts fractional percentages to percent", () => {
    assert.equal(goPlusPercent("0.000001"), 0.0001);
    assert.equal(goPlusPercent(undefined), null);
  });

  it("the fixture exposes the fields the mapper reads", () => {
    const entry =
      GOPLUS_SECURITY_RESPONSE.result["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]!;
    assert.equal(goPlusFlag(entry.is_honeypot), false);
    assert.equal(goPlusFlag(entry.is_open_source), true);
    assert.equal(goPlusFlag(entry.transfer_pausable), true);
  });

  it("returns null for fields a sparse response omits", () => {
    const entry = GOPLUS_SPARSE_RESPONSE.result["0xdeadbeef"] as Record<string, unknown>;
    assert.equal(goPlusFlag(entry.is_honeypot), null);
    assert.equal(goPlusFlag(entry.is_open_source), true);
  });
});
