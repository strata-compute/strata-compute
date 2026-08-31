import { createHash } from "node:crypto";
import type { NormalizedSecurityData } from "../../types/providers.ts";
import { toNumber } from "../../utils/number.ts";
import { logger } from "../../utils/logger.ts";
import { nowIso } from "../../utils/time.ts";
import { HttpClient } from "../http/client.ts";
import type { ProviderHealth, SecurityDataProvider } from "../types.ts";

/**
 * GoPlus — token security signals.
 *
 * Verified live: `POST /api/v1/token` exchanges an app key and a
 * `sha1(app_key + timestamp + app_secret)` signature for a bearer token, and
 * `GET /api/v1/token_security/{chainId}` returns the per-token flags.
 *
 * Two things this provider deliberately does not do:
 *  - **It does not invent a security score.** GoPlus publishes individual
 *    flags, not a composite. `securityScore` stays null and every raw flag is
 *    preserved in `flags` so the compute engine can derive its own later.
 *  - **It does not claim chains it cannot serve.** The supported-chain list is
 *    fetched from GoPlus itself; Robinhood Chain (4663) is not on it, so
 *    `supportsChain(4663)` is false and the ingestion job skips those tokens
 *    rather than reporting a false clean bill of health.
 */

export const GOPLUS_SOURCE = "goplus";

/** Bearer tokens are short-lived; refresh a minute before expiry. */
const TOKEN_SKEW_MS = 60_000;

interface GoPlusEnvelope<T> {
  code?: number;
  message?: string;
  result?: T;
}

interface GoPlusTokenResult {
  access_token?: string;
  expires_in?: number;
}

interface GoPlusSecurity {
  is_honeypot?: string;
  is_open_source?: string;
  is_proxy?: string;
  is_mintable?: string;
  can_take_back_ownership?: string;
  owner_address?: string;
  owner_percent?: string;
  creator_percent?: string;
  buy_tax?: string;
  sell_tax?: string;
  is_blacklisted?: string;
  transfer_pausable?: string;
  holder_count?: string;
  lp_holder_count?: string;
  [key: string]: unknown;
}

/** GoPlus encodes booleans as "0" / "1" strings, and omits unknown fields. */
function flag(value: unknown): boolean | null {
  if (value === "1" || value === 1 || value === true) return true;
  if (value === "0" || value === 0 || value === false) return false;
  return null;
}

function percent(value: unknown): number | null {
  const n = toNumber(value);
  return n === null ? null : Number((n * 100).toFixed(4));
}

export class GoPlusProvider implements SecurityDataProvider {
  readonly name = GOPLUS_SOURCE;
  readonly isMock = false;

  private readonly http: HttpClient;
  private readonly appKey: string | undefined;
  private readonly appSecret: string | undefined;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private supported: Set<number> = new Set();
  private supportedFetchedAt = 0;

  constructor(appKey?: string, appSecret?: string) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.http = new HttpClient({
      provider: this.name,
      baseUrl: "https://api.gopluslabs.io/api/v1",
      rateLimit: { perSecond: 1 },
      timeoutMs: 15_000,
      maxRetries: 2,
      detectThrottle: (body) => {
        const code = (body as GoPlusEnvelope<unknown>)?.code;
        // GoPlus signals throttling with a non-1 code and HTTP 200
        return code === 4029 || code === 4028 ? "goplus rate limit code" : null;
      },
    });
  }

  get chains(): readonly number[] {
    return [...this.supported];
  }

  supportsChain(chainId: number): boolean {
    // before the list is loaded, only refuse the chain we know is unsupported
    if (this.supported.size === 0) return chainId !== 4663;
    return this.supported.has(chainId);
  }

  /** Anonymous access works but is rate limited; a token raises the ceiling. */
  private async authenticate(): Promise<string | null> {
    if (!this.appKey || !this.appSecret) return null;
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_SKEW_MS) {
      return this.accessToken;
    }

    const time = Math.floor(Date.now() / 1000);
    const sign = createHash("sha1")
      .update(`${this.appKey}${time}${this.appSecret}`)
      .digest("hex");

    try {
      const body = await this.http.post<GoPlusEnvelope<GoPlusTokenResult>>("/token", {
        app_key: this.appKey,
        sign,
        time,
      });

      const token = body?.result?.access_token ?? null;
      if (token) {
        this.accessToken = token;
        this.tokenExpiresAt = Date.now() + (body?.result?.expires_in ?? 3600) * 1000;
      }
      return this.accessToken;
    } catch (error) {
      // authentication failure degrades to anonymous access, it does not stop
      // security lookups entirely
      logger.warn("goplus authentication failed — continuing unauthenticated", {
        provider: this.name,
        err: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async loadSupportedChains(): Promise<number[]> {
    // refresh at most daily; the list changes rarely
    if (this.supported.size > 0 && Date.now() - this.supportedFetchedAt < 86_400_000) {
      return [...this.supported];
    }

    try {
      const body = await this.http.get<GoPlusEnvelope<{ id?: string; name?: string }[]>>(
        "/supported_chains",
      );
      const ids = (body?.result ?? [])
        .map((entry) => Number(entry.id))
        .filter((id) => Number.isFinite(id));
      this.supported = new Set(ids);
      this.supportedFetchedAt = Date.now();
    } catch {
      // leave the previous list in place
    }
    return [...this.supported];
  }

  async getTokenSecurity(
    chainId: number,
    tokenAddress: string,
  ): Promise<NormalizedSecurityData | null> {
    await this.loadSupportedChains();
    if (!this.supportsChain(chainId)) return null;

    const token = await this.authenticate();
    const address = tokenAddress.toLowerCase();

    const body = await this.http.get<GoPlusEnvelope<Record<string, GoPlusSecurity>>>(
      `/token_security/${chainId}`,
      {
        params: { contract_addresses: address },
        ...(token ? { headers: { Authorization: token } } : {}),
      },
    );

    const entry = body?.result?.[address];
    if (!entry) return null;

    const missingFields: string[] = [];
    const track = <T>(field: string, value: T | null): T | null => {
      if (value === null) missingFields.push(field);
      return value;
    };

    // every raw flag is preserved so a future composite can use fields this
    // mapping does not yet name
    const flags: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        flags[key] = value;
      }
    }

    return {
      chainId,
      tokenAddress: address,
      // GoPlus publishes no composite score — never invent one
      securityScore: null,
      isHoneypot: track("isHoneypot", flag(entry.is_honeypot)),
      isOpenSource: track("isOpenSource", flag(entry.is_open_source)),
      isProxy: track("isProxy", flag(entry.is_proxy)),
      isMintable: track("isMintable", flag(entry.is_mintable)),
      canTakeBackOwnership: track(
        "canTakeBackOwnership",
        flag(entry.can_take_back_ownership),
      ),
      ownerAddress: entry.owner_address ?? null,
      ownerPercent: track("ownerPercent", percent(entry.owner_percent)),
      creatorPercent: track("creatorPercent", percent(entry.creator_percent)),
      buyTax: track("buyTax", percent(entry.buy_tax)),
      sellTax: track("sellTax", percent(entry.sell_tax)),
      isBlacklisted: track("isBlacklisted", flag(entry.is_blacklisted)),
      transferPausable: track("transferPausable", flag(entry.transfer_pausable)),
      holderCount: track("holderCount", toNumber(entry.holder_count)),
      lpHolderCount: track("lpHolderCount", toNumber(entry.lp_holder_count)),
      flags,
      source: GOPLUS_SOURCE,
      fetchedAt: nowIso(),
      missingFields,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const chains = await this.loadSupportedChains();
      const authenticated = (await this.authenticate()) !== null;
      return {
        provider: this.name,
        healthy: chains.length > 0,
        latencyMs: Number((performance.now() - started).toFixed(1)),
        checkedAt: nowIso(),
        detail: `${chains.length} chains supported${authenticated ? ", authenticated" : ", anonymous"}; Robinhood Chain (4663) not supported`,
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
      ...this.http.health(),
      authenticated: this.accessToken !== null,
      supportedChains: this.supported.size,
    };
  }
}

/** Exported for tests: flag mapping without a network call. */
export { flag as goPlusFlag, percent as goPlusPercent };
