import { API_BASE_URL } from "@/lib/api";

/**
 * SSE PROXY
 *
 * The browser connects here, not to the compute service. Two reasons.
 *
 * The service address stays server-side. Pointing an EventSource straight at
 * the backend would put its origin in the client bundle and require CORS on a
 * service that has no reason to accept cross-origin traffic.
 *
 * And it keeps the transport identical to every other request the app makes,
 * so there is one place where the backend location is configured rather than
 * two that can drift apart.
 *
 * The proxy is a pipe and nothing more. It forwards `Last-Event-ID` upstream
 * so replay works through it, and forwards bytes back untouched — it never
 * buffers, transforms, or synthesises a frame.
 */

export const runtime = "nodejs";
// a streaming response must never be cached or statically analysed
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const upstream = new URL("/api/events/stream", API_BASE_URL);
  for (const [key, value] of incoming.searchParams) {
    upstream.searchParams.set(key, value);
  }

  const lastEventId = request.headers.get("last-event-id");

  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: "text/event-stream",
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
      // the client aborting must close the upstream connection too, or the
      // service accumulates subscribers nobody is reading
      signal: request.signal,
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      return new Response(
        `event: error\ndata: ${JSON.stringify({ reason: "the compute service is unavailable" })}\n\n`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        },
      );
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    // The client is told the connection failed rather than being left to
    // guess. It must never be handed a fabricated event to fill the silence.
    return new Response(
      `event: error\ndata: ${JSON.stringify({ reason: "could not reach the compute service" })}\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }
}
