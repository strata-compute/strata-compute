import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

/**
 * Asset search for client-side pickers.
 *
 * Results come from the backend's asset table, never a local list — which is
 * what makes "only assets returned by the real backend can be added" a
 * structural property of the picker rather than a rule someone has to follow.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("q") ?? "";

  try {
    const upstream = new URL("/api/assets", API_BASE_URL);
    upstream.searchParams.set("limit", "300");
    if (search.trim()) upstream.searchParams.set("search", search.trim());

    const response = await fetch(upstream, { cache: "no-store" });
    const body = (await response.json()) as { data?: unknown[] };
    return NextResponse.json(
      { assets: Array.isArray(body.data) ? body.data : [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ assets: [] });
  }
}
