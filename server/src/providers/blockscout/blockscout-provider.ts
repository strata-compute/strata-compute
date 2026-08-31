import type {
  NormalizedAsset,
  NormalizedOnchainData,
  NormalizedTransfer,
} from "../../types/providers.ts";
import { toNumber } from "../../utils/number.ts";
import { logger } from "../../utils/logger.ts";
import { nowIso } from "../../utils/time.ts";
import { HttpClient, ProviderHttpError } from "../http/client.ts";
import type { OnchainIndexProvider, ProviderHealth } from "../types.ts";

/**
 * Blockscout — indexed onchain data.
 *
 * Verified live: the v2 API answers on the per-chain instances
 * (`eth.blockscout.com`, `base.blockscout.com`) for `/stats`,
 * `/tokens/{address}`, `/tokens/{address}/holders` and
 * `/addresses/{address}/transactions`.
 *
 * Verified absent: **there is no Blockscout instance for Robinhood Chain**
 * (`robinhood.blockscout.com` and `robinhood-mainnet.blockscout.com` both
 * return 404). `supportsChain()` therefore returns false for 4663, and the
 * registry routes Robinhood Chain to Alchemy alone rather than silently
 * substituting a different source.
 *
 * Endpoint availability differs between instances, so every call treats a 404
 * as "this instance does not offer it" and returns null instead of throwing.
 */

export const BLOCKSCOUT_SOURCE = "blockscout";

/** Chain id → Blockscout instance. Only instances confirmed to respond. */
export const BLOCKSCOUT_INSTANCES: Record<number, { host: string; chain: string }> = {
  1: { host: "https://eth.blockscout.com", chain: "ethereum" },
  8453: { host: "https://base.blockscout.com", chain: "base" },
  10: { host: "https://optimism.blockscout.com", chain: "optimism" },
  42161: { host: "https://arbitrum.blockscout.com", chain: "arbitrum" },
};

interface BsToken {
  address_hash?: string;
  address?: string;
  name?: string;
  symbol?: string;
  decimals?: string;
  holders_count?: string;
  holders?: string;
  total_supply?: string;
  icon_url?: string;
  exchange_rate?: string;
  circulating_market_cap?: string;
}

interface BsHolder {
  address?: { hash?: string };
  value?: string;
}

interface BsTransfer {
  transaction_hash?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  total?: { value?: string; decimals?: string };
  token?: { address_hash?: string; symbol?: string };
  block_number?: number;
  timestamp?: string;
}

interface BsTransaction {
  hash?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  block_number?: number;
  timestamp?: string;
}

export class BlockscoutProvider implements OnchainIndexProvider {
  readonly name = BLOCKSCOUT_SOURCE;
  readonly isMock = false;
  readonly chains: readonly number[] = Object.keys(BLOCKSCOUT_INSTANCES).map(Number);

  private readonly clients = new Map<number, HttpClient>();
  private readonly apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  supportsChain(chainId: number): boolean {
    return chainId in BLOCKSCOUT_INSTANCES;
  }

  private client(chainId: number): HttpClient {
    const existing = this.clients.get(chainId);
    if (existing) return existing;

    const instance = BLOCKSCOUT_INSTANCES[chainId];
    if (!instance) {
      throw new Error(`Blockscout has no indexer for chain ${chainId}`);
    }

    const client = new HttpClient({
      provider: `${BLOCKSCOUT_SOURCE}:${instance.chain}`,
      baseUrl: `${instance.host}/api/v2`,
      headers: this.apiKey ? { "x-api-key": this.apiKey } : {},
      rateLimit: { perSecond: 3 },
      timeoutMs: 15_000,
      maxRetries: 2,
    });
    this.clients.set(chainId, client);
    return client;
  }

  /** 404 means "not offered here", which is information rather than failure. */
  private async optional<T>(fn: () => Promise<T>, context: string): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) {
        logger.debug("blockscout endpoint unavailable on this instance", {
          provider: BLOCKSCOUT_SOURCE,
          endpoint: context,
        });
        return null;
      }
      throw error;
    }
  }

  async getContract(chainId: number, address: string): Promise<NormalizedAsset | null> {
    if (!this.supportsChain(chainId)) return null;
    const instance = BLOCKSCOUT_INSTANCES[chainId];

    const token = await this.optional(
      () => this.client(chainId).get<BsToken>(`/tokens/${address}`),
      "tokens",
    );
    if (!token) return null;

    return {
      symbol: (token.symbol ?? "").toUpperCase(),
      name: token.name ?? token.symbol ?? address,
      assetType: "onchain",
      chain: instance?.chain ?? String(chainId),
      chainId,
      contractAddress: (token.address_hash ?? token.address ?? address).toLowerCase(),
      decimals: toNumber(token.decimals),
      logoUrl: token.icon_url ?? null,
      source: BLOCKSCOUT_SOURCE,
      fetchedAt: nowIso(),
    };
  }

  async getAddressActivity(
    chainId: number,
    address: string,
  ): Promise<NormalizedOnchainData | null> {
    if (!this.supportsChain(chainId)) return null;
    const instance = BLOCKSCOUT_INSTANCES[chainId];
    const missingFields: string[] = [];

    const [token, transfers, transactions] = await Promise.all([
      this.optional(() => this.client(chainId).get<BsToken>(`/tokens/${address}`), "tokens"),
      this.optional(
        () =>
          this.client(chainId).get<{ items?: BsTransfer[] }>(`/tokens/${address}/transfers`, {
            params: { limit: 50 },
          }),
        "token transfers",
      ),
      this.optional(
        () =>
          this.client(chainId).get<{ items?: BsTransaction[] }>(
            `/addresses/${address}/transactions`,
            { params: { limit: 50 } },
          ),
        "address transactions",
      ),
    ]);

    if (!token && !transfers && !transactions) return null;
    if (!token) missingFields.push("tokenMetadata");
    if (!transfers) missingFields.push("transfers");
    if (!transactions) missingFields.push("transactions");

    const transferItems = transfers?.items ?? [];
    const counterparties = new Set<string>();
    for (const transfer of transferItems) {
      if (transfer.from?.hash) counterparties.add(transfer.from.hash.toLowerCase());
      if (transfer.to?.hash) counterparties.add(transfer.to.hash.toLowerCase());
    }

    const holderCount = toNumber(token?.holders_count ?? token?.holders);
    if (holderCount === null) missingFields.push("holderCount");

    return {
      chainId,
      chain: instance?.chain ?? String(chainId),
      address: address.toLowerCase(),
      transferCount: transfers ? transferItems.length : null,
      transactionCount: transactions ? (transactions.items?.length ?? 0) : null,
      uniqueCounterparties: transfers ? counterparties.size : null,
      holderCount,
      totalSupply: token?.total_supply ?? null,
      decimals: toNumber(token?.decimals),
      blockNumber: transactions?.items?.[0]?.block_number ?? null,
      source: BLOCKSCOUT_SOURCE,
      fetchedAt: nowIso(),
      missingFields,
    };
  }

  async getTokenTransfers(
    chainId: number,
    address: string,
    limit = 50,
  ): Promise<NormalizedTransfer[]> {
    if (!this.supportsChain(chainId)) return [];

    const body = await this.optional(
      () =>
        this.client(chainId).get<{ items?: BsTransfer[] }>(`/tokens/${address}/transfers`, {
          params: { limit },
        }),
      "token transfers",
    );

    return (body?.items ?? []).slice(0, limit).map((transfer) => ({
      chainId,
      hash: transfer.transaction_hash ?? "",
      from: transfer.from?.hash ?? "",
      to: transfer.to?.hash ?? null,
      value: transfer.total?.value ?? "0",
      tokenAddress: transfer.token?.address_hash?.toLowerCase() ?? address.toLowerCase(),
      tokenSymbol: transfer.token?.symbol ?? null,
      blockNumber: transfer.block_number ?? null,
      timestamp: transfer.timestamp ?? null,
      source: BLOCKSCOUT_SOURCE,
    }));
  }

  async getTokenHolders(
    chainId: number,
    token: string,
    limit = 50,
  ): Promise<{ address: string; balance: string; percent: number | null }[]> {
    if (!this.supportsChain(chainId)) return [];

    const body = await this.optional(
      () =>
        this.client(chainId).get<{ items?: BsHolder[] }>(`/tokens/${token}/holders`, {
          params: { limit },
        }),
      "token holders",
    );

    const items = body?.items ?? [];
    const total = items.reduce((sum, holder) => sum + (toNumber(holder.value) ?? 0), 0);

    return items.slice(0, limit).map((holder) => {
      const balance = toNumber(holder.value) ?? 0;
      return {
        address: holder.address?.hash?.toLowerCase() ?? "",
        balance: holder.value ?? "0",
        percent: total > 0 ? Number(((balance / total) * 100).toFixed(6)) : null,
      };
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      // ethereum is the reference instance for the probe
      const stats = await this.client(1).get<{ total_blocks?: string }>("/stats", {
        retries: 0,
      });
      return {
        provider: this.name,
        healthy: Boolean(stats),
        latencyMs: Number((performance.now() - started).toFixed(1)),
        checkedAt: nowIso(),
        detail: `indexing ${this.chains.length} chains; Robinhood Chain (4663) not indexed by Blockscout`,
      };
    } catch (error) {
      return {
        provider: this.name,
        healthy: false,
        latencyMs: null,
        checkedAt: nowIso(),
        detail: error instanceof Error ? error.message : "health check failed",
      };
    }
  }

  health() {
    return {
      chains: this.chains,
      instances: Object.fromEntries(
        [...this.clients.entries()].map(([chainId, client]) => [chainId, client.health()]),
      ),
    };
  }
}
