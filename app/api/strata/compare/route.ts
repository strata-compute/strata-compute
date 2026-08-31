import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

/**
 * Comparison columns for the browser.
 *
 * One upstream request for the whole comparison rather than one per asset:
 * fetching columns separately would let them come from different computation
 * passes, and a comparison of numbers taken at different moments is not a
 * comparison.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const assets = new URL(request.url).searchParams.get("assets") ?? "";
  if (!assets.trim()) {
    return NextResponse.json({ data: null, reason: "no assets requested" });
  }

  try {
    const upstream = new URL("/api/compare", API_BASE_URL);
    upstream.searchParams.set("assets", assets);
    const response = await fetch(upstream, { cache: "no-store" });
    const body = (await response.json()) as {
      data?: unknown;
      meta?: { reason?: string };
    };
    return NextResponse.json(
      { data: body.data ?? null, reason: body.meta?.reason ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ data: null, reason: "Strata is unreachable" });
  }
}
