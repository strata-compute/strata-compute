import type { ApiEnvelope, ApiErrorBody, ApiMeta } from "./types";

/**
 * Thin fetch wrapper for the Strata Compute API.
 *
 * It unwraps the `{ data, meta }` envelope, turns error bodies into a typed
 * exception, and applies a timeout. It holds no product knowledge — endpoint
 * functions live in `endpoints.ts`.
 *
 * No API keys pass through here. The browser only ever talks to the Strata
 * API; provider credentials stay on the server.
 */

/**
 * Where the Strata API lives.
 *
 * Read on the server only. Every browser request in this application is
 * same-origin — the route handlers in `app/api/*` proxy to the backend — so
 * despite the NEXT_PUBLIC_ prefix this value never reaches a client bundle.
 *
 * The localhost default applies to development alone. A production build with
 * no API URL configured would otherwise come up pointing at a machine that is
 * not there, and every page would render an "unavailable" state that looks
 * exactly like a provider outage. Failing at build time names the real
 * problem instead.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is required for a production build. " +
        "It must point at the deployed Strata API; there is no localhost fallback in production.",
    );
  }

  return "http://localhost:4000";
}

export const API_BASE_URL = resolveApiBaseUrl();

/**
 * The Strata API is the only source of market data. There is deliberately no
 * mock switch here: a UI that can silently fall back to fixtures will
 * eventually show fabricated numbers as real ones.
 */
export const DATA_SOURCE = "api" as const;
export const isApiEnabled = true;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  /** Query parameters; `undefined` values are dropped. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Abort after this many milliseconds. */
  timeoutMs?: number;
  /** Passed through to Next's fetch cache. */
  revalidate?: number | false;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { timeoutMs = 8000, revalidate, signal } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(buildUrl(path, options.params), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      // never cached on the frontend: availability must be re-checked on every
      // render, or a page could keep showing a value after its source went
      // away. The backend owns caching, with a TTL it can reason about.
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as
      | ApiEnvelope<T>
      | ApiErrorBody
      | null;

    if (!response.ok || !body || "error" in body) {
      const errorBody = body as ApiErrorBody | null;
      throw new ApiError(
        response.status,
        errorBody?.error?.code ?? "REQUEST_FAILED",
        errorBody?.error?.message ?? `Request to ${path} failed`,
        errorBody?.error?.details,
      );
    }

    return { data: body.data, meta: body.meta };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(408, "TIMEOUT", `Request to ${path} timed out`);
    }
    throw new ApiError(
      503,
      "NETWORK_ERROR",
      error instanceof Error ? error.message : "Network request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}
