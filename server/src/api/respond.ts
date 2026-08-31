import type { Response } from "express";
import type { ApiMeta, ApiSuccess, DataStatus } from "../types/api.ts";
import { nowIso } from "../utils/time.ts";

/** Every successful body is `{ data, meta }`. No exceptions. */
export function ok<T>(res: Response, data: T, meta: Partial<ApiMeta> = {}): Response {
  const body: ApiSuccess<T> = {
    data,
    meta: {
      requestId: res.locals.requestId as string | undefined,
      timestamp: nowIso(),
      ...meta,
    },
  };
  return res.json(body);
}

/** Convenience for list payloads: fills `count` from the array. */
export function okList<T>(
  res: Response,
  data: T[],
  meta: Partial<ApiMeta> = {},
): Response {
  return ok(res, data, { count: data.length, ...meta });
}

/**
 * The explicit "we have nothing" response.
 *
 * Returned with HTTP 200 because the request succeeded — there is simply no
 * data to report. `data` is null and every provenance field is null, so a
 * client cannot mistake absence for a value.
 */
export function unavailable(
  res: Response,
  reason: string,
  meta: Partial<ApiMeta> = {},
): Response {
  const body = {
    data: null,
    meta: {
      requestId: res.locals.requestId as string | undefined,
      timestamp: nowIso(),
      status: "unavailable" as DataStatus,
      sources: [],
      retrievedAt: null,
      ageSeconds: null,
      reason,
      ...meta,
    },
  };
  return res.json(body);
}
