import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

/**
 * Watchlist rows for the browser.
 *
 * The watchlist lives in localStorage, so the page that renders it is a
 * client component and cannot use the `server-only` data layer. This route is
 * the seam: the browser sends symbols, the server resolves each against the
 * real universe and returns computed rows.
 *
 * A symbol the backend cannot resolve comes back as unavailable with its name
 * attached. It is never filled in — a watchlist entry that survives a
 * de-listing must read as "no longer covered", not as a stale price.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 50;

export async function GET(request: Request) {
  const requested = (new URL(request.url).searchParams.get("symbols") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (requested.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  const rows = await Promise.all(
    requested.map(async (symbol) => {
      try {
        const response = await fetch(
          new URL(`/api/watchlist/assets/${encodeURIComponent(symbol)}`, API_BASE_URL),
          { cache: "no-store" },
        );
        if (!response.ok) {
          return { symbol, available: false as const, reason: "not covered by Strata" };
        }
        const body = (await response.json()) as { data?: unknown; meta?: { reason?: string } };
        if (!body.data) {
          return {
            symbol,
            available: false as const,
            reason: body.meta?.reason ?? "no data",
          };
        }
        return { symbol, available: true as const, data: body.data };
      } catch {
        return { symbol, available: false as const, reason: "Strata is unreachable" };
      }
    }),
  );

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
}
