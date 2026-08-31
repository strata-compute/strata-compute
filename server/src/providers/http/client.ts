import { describeError, logger } from "../../utils/logger.ts";
import { RateLimiter, RateLimitExceededError } from "./rate-limiter.ts";
import { scrubSecrets } from "../../utils/secrets.ts";

/**
 * Shared HTTP client for every external provider.
 *
 * Responsibilities kept in one place so no provider re-implements them:
 * timeouts, retry with exponential backoff and jitter, rate limiting, and
 * detection of the two ways providers signal throttling — a 429 status, and a
 * 200 response whose body says "you are being throttled" (Alpha Vantage does
 * exactly this).
 *
 * Credentials are attached here and never logged: only the path is recorded,
 * never the query string, because keys frequently travel as query parameters.
 */

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly body: string | null;

  constructor(
    provider: string,
    message: string,
    options: { status?: number | null; retryable?: boolean; body?: string | null } = {},
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.body = options.body ?? null;
  }
}

export interface HttpClientOptions {
  provider: string;
  baseUrl: string;
  headers?: Record<string, string>;
  /** Query parameters appended to every request (some APIs key this way). */
  defaultQuery?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  rateLimit: { perSecond: number; perDay?: number };
  /**
   * Provider-specific throttle detection for 2xx bodies. Return a reason
   * string to treat the response as rate limited.
   */
  detectThrottle?: (body: unknown) => string | null;
}

export interface RequestInit_ {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: unknown;
  /** Overrides the client default for this call. */
  timeoutMs?: number;
  /** Skip retries for calls where a failure is expected and cheap. */
  retries?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, capped. */
function backoffDelay(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

export class HttpClient {
  readonly provider: string;
  readonly limiter: RateLimiter;

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly defaultQuery: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly detectThrottle: ((body: unknown) => string | null) | undefined;

  private consecutiveFailures = 0;
  private lastErrorAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: HttpClientOptions) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = options.headers ?? {};
    this.defaultQuery = options.defaultQuery ?? {};
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.detectThrottle = options.detectThrottle;
    this.limiter = new RateLimiter({
      provider: options.provider,
      perSecond: options.rateLimit.perSecond,
      ...(options.rateLimit.perDay === undefined ? {} : { perDay: options.rateLimit.perDay }),
    });
  }

  private buildUrl(path: string, params?: RequestInit_["params"]): string {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(this.defaultQuery)) {
      url.searchParams.set(key, value);
    }
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async request<T>(path: string, init: RequestInit_ = {}): Promise<T> {
    const maxRetries = init.retries ?? this.maxRetries;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.limiter.acquire();
      } catch (error) {
        // a daily quota is not retryable — surface it immediately
        if (error instanceof RateLimitExceededError) {
          this.recordFailure(error.message);
          throw new ProviderHttpError(this.provider, error.message, { retryable: false });
        }
        throw error;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? this.timeoutMs);
      const startedAt = performance.now();

      try {
        const response = await fetch(this.buildUrl(path, init.params), {
          method: init.method ?? "GET",
          headers: {
            accept: "application/json",
            ...this.headers,
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...init.headers,
          },
          ...(init.body ? { body: JSON.stringify(init.body) } : {}),
          signal: controller.signal,
        });

        const text = await response.text();

        if (!response.ok) {
          const retryable = RETRYABLE_STATUS.has(response.status);
          if (response.status === 429) this.limiter.penalise("HTTP 429");
          const error = new ProviderHttpError(
            this.provider,
            `${response.status} from ${this.provider}${path}`,
            { status: response.status, retryable, body: text.slice(0, 500) },
          );
          if (retryable && attempt < maxRetries) {
            lastError = error;
            await sleep(backoffDelay(attempt));
            continue;
          }
          this.recordFailure(error.message);
          throw error;
        }

        const parsed = text.length === 0 ? null : (JSON.parse(text) as unknown);

        // some providers answer 200 with a throttle notice in the body
        const throttleReason = this.detectThrottle?.(parsed) ?? null;
        if (throttleReason) {
          this.limiter.penalise(throttleReason);
          const error = new ProviderHttpError(
            this.provider,
            `${this.provider} rate limited: ${throttleReason}`,
            { status: 429, retryable: true },
          );
          if (attempt < maxRetries) {
            lastError = error;
            await sleep(backoffDelay(attempt + 1));
            continue;
          }
          this.recordFailure(error.message);
          throw error;
        }

        this.consecutiveFailures = 0;
        logger.debug("provider request", {
          provider: this.provider,
          // path only: query strings can carry credentials
          path,
          status: response.status,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          attempt,
        });

        return parsed as T;
      } catch (error) {
        clearTimeout(timeout);

        if (error instanceof ProviderHttpError) throw error;

        const isAbort = error instanceof Error && error.name === "AbortError";
        const wrapped = new ProviderHttpError(
          this.provider,
          isAbort ? `${this.provider} request timed out` : `${this.provider} request failed`,
          { retryable: true },
        );

        if (attempt < maxRetries) {
          lastError = error;
          await sleep(backoffDelay(attempt));
          continue;
        }
        this.recordFailure(wrapped.message);
        logger.warn("provider request failed", {
          provider: this.provider,
          path,
          ...describeError(error),
        });
        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderHttpError(this.provider, `${this.provider} request failed`);
  }

  get<T>(path: string, init: Omit<RequestInit_, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  post<T>(path: string, body: unknown, init: Omit<RequestInit_, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: "POST", body });
  }

  private recordFailure(message: string) {
    this.consecutiveFailures += 1;
    // Scrubbed at the point of capture, not at the point of display. A
    // provider can echo our own credential back inside an error message, and
    // this value is surfaced through /api/health — storing it raw and hoping
    // every reader remembers to redact is the wrong way round.
    this.lastError = scrubSecrets(message);
    this.lastErrorAt = new Date().toISOString();
  }

  /** Surfaced through /api/health without exposing configuration. */
  health() {
    return {
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      rateLimit: this.limiter.snapshot(),
    };
  }
}
