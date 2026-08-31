import type {
  ChainBlock,
  ChainLog,
  ChainTransaction,
  ChainTransactionReceipt,
  LogFilter,
  NormalizedTransfer,
  TokenTransferQuery,
} from "../../types/providers.ts";
import { describeError, logger } from "../../utils/logger.ts";
import { nowIso } from "../../utils/time.ts";
import { HttpClient } from "../http/client.ts";
import type { ChainDataProvider, ProviderHealth } from "../types.ts";

/**
 * Alchemy — RPC and indexed data for Robinhood Chain (chain id 4663).
 *
 * Verified live against the configured endpoint: `eth_chainId` returns
 * `0x1237` (4663), `net_version` returns `4663`, and `alchemy_getAssetTransfers`
 * responds — the enhanced API *is* available on this chain.
 *
 * That last point is checked at runtime rather than assumed. `supportsEnhancedApi()`
 * probes once, caches the answer, and `getTokenTransfers` falls back to
 * standard `eth_getLogs` over ERC-20 Transfer topics when the enhanced method
 * is unavailable. Everything else is plain JSON-RPC.
 */

export const ALCHEMY_SOURCE = "alchemy";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface RpcResponse<T> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code?: number; message?: string };
}

interface RpcBlock {
  number?: string;
  hash?: string;
  parentHash?: string;
  timestamp?: string;
  transactions?: unknown[];
  gasUsed?: string;
  gasLimit?: string;
}

interface RpcTransaction {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: string;
  blockNumber?: string | null;
  gas?: string;
  gasPrice?: string;
  input?: string;
}

interface RpcReceipt {
  transactionHash?: string;
  status?: string;
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  contractAddress?: string | null;
  logs?: unknown[];
}

interface RpcLog {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
}

interface AlchemyTransfer {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: number | null;
  rawContract?: { address?: string | null; value?: string | null; decimal?: string | null };
  asset?: string | null;
  blockNum?: string;
  metadata?: { blockTimestamp?: string };
}

function hexToNumber(hex: string | undefined | null): number | null {
  if (!hex) return null;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

function hexToIso(hex: string | undefined): string {
  const seconds = hexToNumber(hex);
  return seconds === null ? nowIso() : new Date(seconds * 1000).toISOString();
}

export class AlchemyChainProvider implements ChainDataProvider {
  readonly name = ALCHEMY_SOURCE;
  readonly isMock = false;
  readonly chainId: number;

  private readonly http: HttpClient;
  private enhancedSupport: boolean | null = null;

  constructor(rpcUrl: string, chainId: number) {
    this.chainId = chainId;
    this.http = new HttpClient({
      provider: this.name,
      baseUrl: rpcUrl,
      // conservative: this is shared infrastructure, and the spec is explicit
      // that we must not poll aggressively
      rateLimit: { perSecond: 5 },
      timeoutMs: 15_000,
      maxRetries: 2,
    });
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const body = await this.http.post<RpcResponse<T>>("", {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });

    if (body?.error) {
      throw new Error(`${method} failed: ${body.error.message ?? "rpc error"}`);
    }
    return body?.result as T;
  }

  async getChainId(): Promise<number | null> {
    const hex = await this.rpc<string>("eth_chainId");
    return hexToNumber(hex);
  }

  async getLatestBlock(): Promise<ChainBlock> {
    const block = await this.rpc<RpcBlock>("eth_getBlockByNumber", ["latest", false]);
    const mapped = this.mapBlock(block);
    if (!mapped) throw new Error("Chain returned no latest block");
    return mapped;
  }

  async getBlock(blockNumber: number | "latest"): Promise<ChainBlock | null> {
    const tag = blockNumber === "latest" ? "latest" : `0x${blockNumber.toString(16)}`;
    const block = await this.rpc<RpcBlock | null>("eth_getBlockByNumber", [tag, false]);
    return this.mapBlock(block);
  }

  private mapBlock(block: RpcBlock | null | undefined): ChainBlock | null {
    if (!block?.hash) return null;
    return {
      chainId: this.chainId,
      number: hexToNumber(block.number) ?? 0,
      hash: block.hash,
      parentHash: block.parentHash ?? "",
      timestamp: hexToIso(block.timestamp),
      transactionCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
      gasUsed: block.gasUsed ?? null,
      gasLimit: block.gasLimit ?? null,
      source: ALCHEMY_SOURCE,
    };
  }

  async getTransaction(hash: string): Promise<ChainTransaction | null> {
    const tx = await this.rpc<RpcTransaction | null>("eth_getTransactionByHash", [hash]);
    if (!tx?.hash) return null;
    return {
      chainId: this.chainId,
      hash: tx.hash,
      from: tx.from ?? "",
      to: tx.to ?? null,
      value: tx.value ?? "0x0",
      blockNumber: hexToNumber(tx.blockNumber ?? null),
      gas: tx.gas ?? null,
      gasPrice: tx.gasPrice ?? null,
      input: tx.input ?? null,
      source: ALCHEMY_SOURCE,
    };
  }

  async getTransactionReceipt(hash: string): Promise<ChainTransactionReceipt | null> {
    const receipt = await this.rpc<RpcReceipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt?.transactionHash) return null;
    return {
      chainId: this.chainId,
      hash: receipt.transactionHash,
      status:
        receipt.status === "0x1" ? "success" : receipt.status === "0x0" ? "reverted" : "unknown",
      blockNumber: hexToNumber(receipt.blockNumber),
      gasUsed: receipt.gasUsed ?? null,
      effectiveGasPrice: receipt.effectiveGasPrice ?? null,
      contractAddress: receipt.contractAddress ?? null,
      logCount: Array.isArray(receipt.logs) ? receipt.logs.length : 0,
      source: ALCHEMY_SOURCE,
    };
  }

  async getLogs(filter: LogFilter): Promise<ChainLog[]> {
    const params: Record<string, unknown> = {};
    if (filter.address) params.address = filter.address;
    if (filter.topics) params.topics = filter.topics;
    params.fromBlock =
      typeof filter.fromBlock === "number" ? `0x${filter.fromBlock.toString(16)}` : (filter.fromBlock ?? "latest");
    params.toBlock =
      typeof filter.toBlock === "number" ? `0x${filter.toBlock.toString(16)}` : (filter.toBlock ?? "latest");

    const logs = await this.rpc<RpcLog[]>("eth_getLogs", [params]);
    return (logs ?? []).map((log) => ({
      address: log.address ?? "",
      topics: log.topics ?? [],
      data: log.data ?? "0x",
      blockNumber: hexToNumber(log.blockNumber),
      transactionHash: log.transactionHash ?? null,
      logIndex: hexToNumber(log.logIndex),
    }));
  }

  /**
   * Probes the enhanced API once and remembers the answer. The spec is
   * explicit: do not assume an Alchemy enhanced method exists on this chain
   * until a real response confirms it.
   */
  async supportsEnhancedApi(): Promise<boolean> {
    if (this.enhancedSupport !== null) return this.enhancedSupport;
    try {
      await this.rpc("alchemy_getAssetTransfers", [
        { fromBlock: "0x0", maxCount: "0x1", category: ["external"] },
      ]);
      this.enhancedSupport = true;
    } catch (error) {
      this.enhancedSupport = false;
      logger.info("alchemy enhanced api unavailable — falling back to standard JSON-RPC", {
        provider: this.name,
        ...describeError(error),
      });
    }
    return this.enhancedSupport;
  }

  async getTokenTransfers(query: TokenTransferQuery): Promise<NormalizedTransfer[]> {
    if (await this.supportsEnhancedApi()) {
      try {
        return await this.getTransfersEnhanced(query);
      } catch (error) {
        logger.warn("enhanced transfer lookup failed — falling back to eth_getLogs", {
          provider: this.name,
          ...describeError(error),
        });
      }
    }
    return this.getTransfersViaLogs(query);
  }

  private async getTransfersEnhanced(
    query: TokenTransferQuery,
  ): Promise<NormalizedTransfer[]> {
    const params: Record<string, unknown> = {
      fromBlock:
        typeof query.fromBlock === "number" ? `0x${query.fromBlock.toString(16)}` : (query.fromBlock ?? "0x0"),
      toBlock:
        typeof query.toBlock === "number" ? `0x${query.toBlock.toString(16)}` : (query.toBlock ?? "latest"),
      category: ["erc20", "external"],
      maxCount: `0x${Math.min(query.limit ?? 25, 1000).toString(16)}`,
      withMetadata: true,
      order: "desc",
    };
    if (query.address) params.toAddress = query.address;
    if (query.contractAddress) params.contractAddresses = [query.contractAddress];

    const result = await this.rpc<{ transfers?: AlchemyTransfer[] }>(
      "alchemy_getAssetTransfers",
      [params],
    );

    return (result?.transfers ?? []).map((transfer) => ({
      chainId: this.chainId,
      hash: transfer.hash ?? "",
      from: transfer.from ?? "",
      to: transfer.to ?? null,
      value: transfer.rawContract?.value ?? String(transfer.value ?? "0"),
      tokenAddress: transfer.rawContract?.address ?? null,
      tokenSymbol: transfer.asset ?? null,
      blockNumber: hexToNumber(transfer.blockNum),
      timestamp: transfer.metadata?.blockTimestamp ?? null,
      source: ALCHEMY_SOURCE,
    }));
  }

  /** Standard-RPC fallback: ERC-20 Transfer logs over a bounded window. */
  private async getTransfersViaLogs(
    query: TokenTransferQuery,
  ): Promise<NormalizedTransfer[]> {
    const latest = await this.getLatestBlock();
    // a bounded window keeps the call cheap and within node limits
    const fromBlock =
      typeof query.fromBlock === "number" ? query.fromBlock : Math.max(0, latest.number - 2_000);

    const logs = await this.getLogs({
      ...(query.contractAddress ? { address: query.contractAddress } : {}),
      topics: [TRANSFER_TOPIC],
      fromBlock,
      toBlock: latest.number,
    });

    const topicToAddress = (topic: string | undefined) =>
      topic && topic.length >= 42 ? `0x${topic.slice(-40)}` : "";

    return logs.slice(0, query.limit ?? 25).map((log) => ({
      chainId: this.chainId,
      hash: log.transactionHash ?? "",
      from: topicToAddress(log.topics[1]),
      to: topicToAddress(log.topics[2]) || null,
      value: log.data ?? "0x0",
      tokenAddress: log.address,
      tokenSymbol: null,
      blockNumber: log.blockNumber,
      timestamp: null,
      source: ALCHEMY_SOURCE,
    }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const [chainId, block] = await Promise.all([
        this.getChainId(),
        this.rpc<string>("eth_blockNumber"),
      ]);
      const matches = chainId === this.chainId;
      return {
        provider: this.name,
        healthy: matches,
        latencyMs: Number((performance.now() - started).toFixed(1)),
        checkedAt: nowIso(),
        detail: matches
          ? `chain ${chainId} at block ${hexToNumber(block) ?? "?"}`
          : `chain id mismatch: expected ${this.chainId}, got ${chainId}`,
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
    return { ...this.http.health(), enhancedApi: this.enhancedSupport };
  }
}
