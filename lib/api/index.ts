/**
 * Frontend API layer — the only source of market data in the application.
 *
 * Pages do not call these functions directly; they go through `lib/data/*`,
 * which converts a failure into an explicit unavailable state rather than an
 * exception or a fallback value.
 */

export {
  API_BASE_URL,
  ApiError,
  DATA_SOURCE,
  isApiEnabled,
  apiRequest,
  type ApiResult,
  type RequestOptions,
} from "./client";

export * from "./endpoints";
export * from "./types";
export * from "./adapters";
