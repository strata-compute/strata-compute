/** Every response body in the service uses this envelope. */

/**
 * How current the payload is. `live` is never assumed — it is asserted only
 * when the data was retrieved inside the window its class allows.
 */
export type DataStatus = "live" | "delayed" | "stale" | "unavailable" | "error";

export interface ApiMeta {
  requestId?: string;
  timestamp: string;
  /** Freshness of the payload. Absent only on non-data endpoints. */
  status?: DataStatus;
  /** Providers that supplied the payload. Empty when there is no data. */
  sources?: string[];
  /** When Strata retrieved the underlying data. */
  retrievedAt?: string | null;
  /** Age of the payload in seconds. */
  ageSeconds?: number | null;
  /** Where the payload was read from: the database or the in-memory model. */
  store?: "database" | "memory";
  /** Legacy alias of `store`. */
  source?: "database" | "memory";
  /** True when any figure in `data` originated from the mock provider. */
  mock?: boolean;
  count?: number;
  page?: number;
  pageSize?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ApiMeta;
}
