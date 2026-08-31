/**
 * Captured provider responses.
 *
 * These are trimmed copies of real payloads observed while building the
 * providers, so parsing tests exercise the shapes the APIs actually return —
 * including the awkward parts: numbers as strings, epoch-second timestamps,
 * absent optional fields.
 *
 * Tests never hit the network. Live APIs make tests slow, flaky and
 * rate-limited; fixtures make failures mean "our code broke".
 */

export const ROBINHOOD_ASSETS_RESPONSE = {
  assets: [
    {
      id: "0x0000000000000000000000000000000002",
      tokenSymbol: "AAPL",
      tokenName: "Apple • Robinhood Token",
      deployments: [
        {
          contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
          chainId: 4663,
          networkName: "Robinhood Chain",
        },
      ],
      currentMultiplier: "1.000000000000000000",
      pendingMultiplier: "",
      status: "ASSET_STATUS_ACTIVE",
      logoUrl: "https://cdn.robinhood.com/aapl.png",
    },
    {
      id: "0x0000000000000000000000000000000003",
      tokenSymbol: "CRM",
      tokenName: "Salesforce • Robinhood Token",
      deployments: [
        { contractAddress: "0xd95B44124e475743a7589e68F3D74008A5536D44", chainId: 4663 },
      ],
      status: "ASSET_STATUS_ACTIVE",
    },
  ],
};

export const ROBINHOOD_PRICE_RESPONSE = {
  quotes: [
    {
      tokenSymbol: "AAPL",
      deployments: [
        { contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", chainId: 4663 },
      ],
      bid: "316.94",
      ask: "320.26",
      currency: "USD",
      dailyTradingVolume: "38649374",
      isTradingHalt: false,
      generatedAt: "2026-08-29T09:55:14.877296619Z",
      dailyHigh: "322.37",
      dailyLow: "314.34",
    },
  ],
};

/** A halted token with a one-sided book — the awkward case. */
export const ROBINHOOD_PRICE_HALTED = {
  quotes: [
    {
      tokenSymbol: "HALT",
      deployments: [{ contractAddress: "0xabc", chainId: 4663 }],
      bid: "10.00",
      ask: "",
      currency: "USD",
      dailyTradingVolume: "0",
      isTradingHalt: true,
      generatedAt: "2026-08-29T09:55:14Z",
    },
  ],
};

export const COINGECKO_MARKETS_RESPONSE = [
  {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    current_price: 77660,
    market_cap: 1559138014166,
    total_volume: 29795118774,
    price_change_percentage_1h_in_currency: 0.42,
    price_change_percentage_24h_in_currency: -1.83,
    last_updated: "2026-08-29T09:50:12.345Z",
    image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
  },
  {
    id: "ethereum",
    symbol: "eth",
    name: "Ethereum",
    current_price: 2436.38,
    market_cap: 294000000000,
    total_volume: 12000000000,
    price_change_percentage_24h_in_currency: 2.11,
    last_updated: "2026-08-29T09:50:10.000Z",
  },
];

export const COINGECKO_RATE_LIMITED = {
  status: { error_code: 429, error_message: "You've exceeded the Rate Limit." },
};

export const ALPHA_VANTAGE_QUOTE_RESPONSE = {
  "Global Quote": {
    "01. symbol": "AAPL",
    "02. open": "316.8450",
    "03. high": "322.3700",
    "04. low": "315.4504",
    "05. price": "319.7000",
    "06. volume": "38649398",
    "07. latest trading day": "2026-08-28",
    "08. previous close": "315.1000",
    "09. change": "4.6000",
    "10. change percent": "1.4598%",
  },
};

/** Alpha Vantage signals throttling with HTTP 200 and an Information key. */
export const ALPHA_VANTAGE_THROTTLED = {
  Information:
    "Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second). You may subscribe to any of the premium plans...",
};

export const ALPHA_VANTAGE_EMPTY = { "Global Quote": {} };

export const GOPLUS_SECURITY_RESPONSE = {
  code: 1,
  message: "OK",
  result: {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
      is_honeypot: "0",
      is_open_source: "1",
      is_proxy: "1",
      is_mintable: "1",
      can_take_back_ownership: "0",
      owner_address: "0x95ba4cf87d6723ad9c0db21737d862be80e93911",
      owner_percent: "0.000001",
      creator_percent: "0.000000",
      buy_tax: "0",
      sell_tax: "0",
      is_blacklisted: "1",
      transfer_pausable: "1",
      holder_count: "8790339",
      lp_holder_count: "120",
    },
  },
};

/** GoPlus omits fields it cannot determine. */
export const GOPLUS_SPARSE_RESPONSE = {
  code: 1,
  result: {
    "0xdeadbeef": {
      is_open_source: "1",
      holder_count: "42",
    },
  },
};

export const BLOCKSCOUT_TOKEN_RESPONSE = {
  address_hash: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USD Coin",
  symbol: "USDC",
  decimals: "6",
  holders_count: "9024428",
  total_supply: "74106903634821410",
  icon_url: "https://example.invalid/usdc.png",
};

export const ALCHEMY_BLOCK_RESPONSE = {
  number: "0x2eca20c",
  hash: "0xblockhash",
  parentHash: "0xparent",
  timestamp: "0x68b1a2c0",
  transactions: ["0x1", "0x2", "0x3"],
  gasUsed: "0x5208",
  gasLimit: "0x1c9c380",
};

export const ALCHEMY_TRANSFERS_RESPONSE = {
  transfers: [
    {
      hash: "0xbdcf2090de264eaa36b8cbd80209ae47968689e95d4124c09586364fb2e1e78d",
      from: "0xd9561c5de260e7ea1b879e7994967077e71241db",
      to: "0x1111111111111111111111111111111111111111",
      value: 1.5,
      rawContract: { address: null, value: "0x14d1120d7b160000", decimal: "0x12" },
      asset: "ETH",
      blockNum: "0x4",
      metadata: { blockTimestamp: "2026-08-29T09:00:00.000Z" },
    },
  ],
};
