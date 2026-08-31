import { Router } from "express";
import { z } from "zod";
import { EVENT_CATEGORIES, EVENT_TYPES, type EventFilter } from "../../events/types.ts";
import { recent, replayAfter, subscribe, subscriberCount } from "../../events/bus.ts";
import { getStore } from "../../database/index.ts";
import { logger } from "../../utils/logger.ts";
import { query, validateQuery } from "../middleware/validate.ts";
import { okList, unavailable } from "../respond.ts";

/**
 * REAL-TIME TRANSPORT
 *
 * Server-Sent Events, not WebSockets. The traffic here is entirely
 * server-to-client — the browser has nothing to say back that an ordinary
 * request cannot carry — and SSE gets reconnection, event ids and replay from
 * the protocol itself rather than from a library. Adding a socket layer would
 * mean new infrastructure to solve a problem this application does not have.
 *
 * Three things are handled deliberately.
 *
 * Reconnection replays. The browser resends `Last-Event-ID` automatically,
 * and the bus keeps a bounded buffer, so a client that drops for thirty
 * seconds receives what it missed instead of waiting for the next computation
 * pass. Without that, every reconnect would look like a dead feed for up to a
 * minute.
 *
 * Heartbeats keep the connection open. Proxies and load balancers close idle
 * connections, and a quiet market is genuinely idle — a comment frame every
 * fifteen seconds is what stops "no events" from being mistaken for "no
 * connection".
 *
 * And the stream never generates anything. It forwards what computation
 * emitted. When there is nothing to say it says nothing, which is why the
 * heartbeat is a protocol comment rather than a synthetic event.
 */

export const streamRouter: Router = Router();

const HEARTBEAT_MS = 15_000;

/**
 * Every stream currently open.
 *
 * An SSE response is a socket that never ends, which means `server.close()`
 * waits for it forever: without this registry every deployment would hang
 * until the shutdown timer gave up and killed the process. Holding the
 * closers lets shutdown end the streams deliberately — clients see a clean
 * disconnect and reconnect on their own `retry` interval, instead of a
 * severed connection.
 */
const openStreams = new Set<() => void>();

/** Ends every open stream. Called once, from the shutdown path. */
export function closeEventStreams(): number {
  const count = openStreams.size;
  for (const close of [...openStreams]) close();
  openStreams.clear();
  return count;
}

export function openStreamCount(): number {
  return openStreams.size;
}

const streamQuery = z.object({
  category: z.enum(EVENT_CATEGORIES).optional(),
  types: z.string().optional(),
  assetId: z.string().max(64).optional(),
  assetType: z.enum(["stock", "crypto", "onchain"]).optional(),
});

function parseTypes(raw: string | undefined): EventFilter["types"] {
  if (!raw) return undefined;
  const requested = raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is (typeof EVENT_TYPES)[number] =>
      (EVENT_TYPES as readonly string[]).includes(value),
    );
  return requested.length > 0 ? requested : undefined;
}

streamRouter.get("/events/stream", validateQuery(streamQuery), (req, res) => {
  const q = query<z.infer<typeof streamQuery>>(res);

  const filter: EventFilter = {
    ...(q.category ? { category: q.category } : {}),
    ...(parseTypes(q.types) ? { types: parseTypes(q.types) } : {}),
    ...(q.assetId ? { assetId: q.assetId } : {}),
    ...(q.assetType ? { assetType: q.assetType } : {}),
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx and similar buffer by default, which defeats the entire point
    "X-Accel-Buffering": "no",
  });

  const write = (payload: string) => {
    // a client that has gone away must not be written to
    if (res.writableEnded) return;
    res.write(payload);
  };

  const send = (event: { id: string; eventType: string }, data: unknown) => {
    write(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Tell the client how long to wait before reconnecting, then hand it the
  // events it missed while it was away.
  write("retry: 3000\n\n");

  const lastEventId =
    (req.headers["last-event-id"] as string | undefined) ??
    (typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined) ??
    null;

  const backlog = lastEventId ? replayAfter(lastEventId, filter) : [];
  for (const event of backlog) send(event, event);

  write(
    `event: connected\ndata: ${JSON.stringify({
      replayed: backlog.length,
      subscribers: subscriberCount() + 1,
      at: new Date().toISOString(),
    })}\n\n`,
  );

  const subscription = subscribe((event) => send(event, event), filter);

  if (!subscription) {
    write(
      `event: error\ndata: ${JSON.stringify({
        reason: "the event stream is at capacity; retry shortly",
      })}\n\n`,
    );
    res.end();
    return;
  }

  const heartbeat = setInterval(() => {
    // a comment frame: keeps proxies from closing the connection without
    // putting a synthetic entry into the feed
    write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscription.unsubscribe();
    openStreams.delete(cleanup);
    if (!res.writableEnded) res.end();
  };

  openStreams.add(cleanup);

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", (error) => {
    logger.debug("event stream write failed", { error: error.message });
    cleanup();
  });
});

/* ------------------------------------------------------------- history --- */

const eventsQuery = z.object({
  category: z.enum(EVENT_CATEGORIES).optional(),
  types: z.string().optional(),
  assetId: z.string().max(64).optional(),
  assetType: z.enum(["stock", "crypto", "onchain"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

/**
 * Recent events, newest first.
 *
 * This is what a page renders on first load, before the stream has had
 * anything to say. Served from the same buffer the stream replays from, so a
 * reader never sees the feed jump when the connection opens.
 */
streamRouter.get("/events", validateQuery(eventsQuery), async (_req, res) => {
  const q = query<z.infer<typeof eventsQuery>>(res);
  const store = getStore();

  const filter: EventFilter = {
    limit: q.limit,
    ...(q.category ? { category: q.category } : {}),
    ...(parseTypes(q.types) ? { types: parseTypes(q.types) } : {}),
    ...(q.assetId ? { assetId: q.assetId } : {}),
    ...(q.assetType ? { assetType: q.assetType } : {}),
  };

  const events = recent(filter);

  if (events.length === 0) {
    return unavailable(
      res,
      "No events have been emitted yet. Events appear as computation detects changes.",
      { store: store.kind === "postgres" ? "database" : "memory" },
    );
  }

  return okList(res, events, {
    status: "live",
    count: events.length,
    retrievedAt: events[0]?.timestamp ?? null,
    store: store.kind === "postgres" ? "database" : "memory",
  });
});
