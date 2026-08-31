"use client";

import * as React from "react";
import {
  categoryOf,
  type ConnectionState,
  type EventCategory,
  type StrataEvent,
} from "@/lib/realtime/events";

/**
 * THE LIVE CONNECTION
 *
 * One EventSource for the whole console. Every live surface — the feed, the
 * rankings, the asset page, the Arena, the notification bell — reads from
 * this context rather than opening a connection of its own, so a page with
 * five live components still holds one stream.
 *
 * Three behaviours are deliberate.
 *
 * The connection state is reported honestly. When the stream drops, consumers
 * are told, and the interface says the connection was lost. It never keeps
 * rendering as though data were still arriving, and it never fabricates an
 * update to cover a silence — a stale number labelled live is worse than a
 * visible disconnection.
 *
 * Reconnection is exponential and bounded, with the last event id carried so
 * the server replays what was missed. A tight retry loop against a service
 * that is down is a denial-of-service written by accident.
 *
 * And events are de-duplicated by id. A replay after reconnect will resend
 * events the client already has; without the guard, a reconnect would double
 * every entry in the feed.
 */

interface StreamContextValue {
  events: StrataEvent[];
  state: ConnectionState;
  /** Rising counter, so consumers can cheaply detect "something changed". */
  version: number;
  lastEventAt: string | null;
  reconnectAttempts: number;
  /** Manual retry, offered when automatic attempts have been exhausted. */
  retry: () => void;
}

const StreamContext = React.createContext<StreamContextValue | null>(null);

/** How many events the client keeps in memory. */
const MAX_EVENTS = 300;

/** Backoff schedule, in milliseconds. The last value repeats. */
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000];

export function StreamProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [events, setEvents] = React.useState<StrataEvent[]>([]);
  const [state, setState] = React.useState<ConnectionState>(
    enabled ? "connecting" : "idle",
  );
  const [version, setVersion] = React.useState(0);
  const [attempts, setAttempts] = React.useState(0);

  const sourceRef = React.useRef<EventSource | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const lastIdRef = React.useRef<string | null>(null);
  const seenRef = React.useRef<Set<string>>(new Set());
  const attemptRef = React.useRef(0);
  const manualRef = React.useRef(0);

  const connect = React.useCallback(() => {
    if (!enabled || typeof window === "undefined") return;

    sourceRef.current?.close();

    // the last id is passed as a query parameter because EventSource cannot
    // set request headers; the server accepts either
    const url = new URL("/api/events/stream", window.location.origin);
    if (lastIdRef.current) url.searchParams.set("lastEventId", lastIdRef.current);

    const source = new EventSource(url.toString());
    sourceRef.current = source;

    const ingest = (raw: string) => {
      try {
        const event = JSON.parse(raw) as StrataEvent;
        if (!event?.id || seenRef.current.has(event.id)) return;

        seenRef.current.add(event.id);
        lastIdRef.current = event.id;

        setEvents((current) => {
          const next = [event, ...current].slice(0, MAX_EVENTS);
          // keep the de-dupe set bounded alongside the list it guards
          if (seenRef.current.size > MAX_EVENTS * 3) {
            seenRef.current = new Set(next.map((e) => e.id));
          }
          return next;
        });
        setVersion((v) => v + 1);
      } catch {
        // a frame that will not parse is dropped rather than rendered as a
        // partial event
      }
    };

    source.addEventListener("open", () => {
      attemptRef.current = 0;
      setAttempts(0);
      setState("live");
    });

    source.addEventListener("connected", () => setState("live"));

    // named events plus the default channel, so nothing is missed if the
    // server ever emits without a name
    for (const type of [
      "STRATA_SCORE_CHANGED",
      "RANK_CHANGED",
      "SIGNAL_DETECTED",
      "SIGNAL_EXPIRED",
      "EARLY_MOVER_DETECTED",
      "ANOMALY_DETECTED",
      "MARKET_REGIME_CHANGED",
      "PRICE_MOVEMENT",
      "VOLUME_ACCELERATION",
      "ARENA_UPDATE",
      "ARENA_ELIMINATION",
      "ARENA_WINNER",
    ]) {
      source.addEventListener(type, (event) => ingest((event as MessageEvent).data));
    }
    source.addEventListener("message", (event) => ingest((event as MessageEvent).data));

    source.addEventListener("error", () => {
      source.close();
      sourceRef.current = null;

      const attempt = attemptRef.current;
      const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] as number;
      attemptRef.current = attempt + 1;
      setAttempts(attempt + 1);
      setState(attempt >= BACKOFF.length ? "lost" : "reconnecting");

      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(connect, delay);
    });
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) {
      setState("idle");
      return;
    }
    connect();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
    // manualRef forces a fresh connect when the reader asks to retry
  }, [connect, enabled, manualRef.current]);

  const retry = React.useCallback(() => {
    attemptRef.current = 0;
    setAttempts(0);
    setState("connecting");
    manualRef.current += 1;
    connect();
  }, [connect]);

  const value = React.useMemo<StreamContextValue>(
    () => ({
      events,
      state,
      version,
      lastEventAt: events[0]?.timestamp ?? null,
      reconnectAttempts: attempts,
      retry,
    }),
    [events, state, version, attempts, retry],
  );

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStream(): StreamContextValue {
  const context = React.useContext(StreamContext);
  if (!context) {
    // A component outside the provider gets an inert stream rather than an
    // exception: a missing live connection must degrade a page, never break it.
    return {
      events: [],
      state: "idle",
      version: 0,
      lastEventAt: null,
      reconnectAttempts: 0,
      retry: () => {},
    };
  }
  return context;
}

/** Events for one category, or all of them. */
export function useEvents(category?: EventCategory | "all"): StrataEvent[] {
  const { events } = useStream();
  return React.useMemo(() => {
    if (!category || category === "all") return events;
    return events.filter((event) => categoryOf(event.eventType) === category);
  }, [events, category]);
}

/** Events for one asset. Used by the asset page to update in place. */
export function useAssetEvents(assetId: string | null): StrataEvent[] {
  const { events } = useStream();
  return React.useMemo(() => {
    if (!assetId) return [];
    return events.filter((event) => event.assetId === assetId);
  }, [events, assetId]);
}
