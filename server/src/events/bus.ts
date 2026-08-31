import { randomUUID } from "node:crypto";
import { CURRENT_SCORING_VERSION } from "../config/scoring.ts";
import { logger } from "../utils/logger.ts";
import { nowIso } from "../utils/time.ts";
import {
  categoryOf,
  type EventDraft,
  type EventFilter,
  type StrataEvent,
} from "./types.ts";

/**
 * THE EVENT BUS
 *
 * One in-process publisher, many subscribers. Deliberately not a message
 * broker: the service is a single process, and introducing one would add an
 * operational dependency to solve a problem this application does not have.
 *
 * The bus also keeps a bounded ring buffer of recent events. That is what
 * makes reconnection work — a client that drops and returns replays what it
 * missed by `Last-Event-ID` instead of waiting for the next computation pass
 * to tell it anything. Without the buffer, every reconnect would look like a
 * dead feed until the pipeline next ran, which on a 60-second cadence is a
 * long time to stare at nothing.
 *
 * Delivery is best-effort and non-blocking. A slow consumer is dropped rather
 * than allowed to apply backpressure to the computation that produced the
 * event: the pipeline must never wait on a browser.
 */

/** Recent history retained for replay. Roughly an hour of normal activity. */
const BUFFER_SIZE = 500;

/** A subscriber that cannot keep up is disconnected rather than queued. */
const MAX_SUBSCRIBERS = 200;

export type EventListener = (event: StrataEvent) => void;

interface Subscription {
  id: string;
  listener: EventListener;
  filter: EventFilter | undefined;
}

const buffer: StrataEvent[] = [];
const subscriptions = new Map<string, Subscription>();

function matches(event: StrataEvent, filter?: EventFilter): boolean {
  if (!filter) return true;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(event.eventType)) {
    return false;
  }
  if (filter.category && categoryOf(event.eventType) !== filter.category) return false;
  if (filter.assetId && event.assetId !== filter.assetId) return false;
  if (filter.assetType && event.assetType !== filter.assetType) return false;
  if (filter.since && event.timestamp <= filter.since) return false;
  return true;
}

/**
 * Publishes one event.
 *
 * Returns the completed event so callers can persist exactly what subscribers
 * received — the id in the database and the id on the wire are the same
 * value, which is what lets a client de-duplicate a replayed event against
 * one it already rendered.
 */
export function emit(draft: EventDraft): StrataEvent {
  const event: StrataEvent = {
    id: randomUUID(),
    eventType: draft.eventType,
    assetId: draft.assetId ?? null,
    symbol: draft.symbol ?? null,
    assetType: draft.assetType ?? null,
    logoUrl: draft.logoUrl ?? null,
    previousValue: draft.previousValue ?? null,
    newValue: draft.newValue ?? null,
    change: draft.change ?? null,
    severity: draft.severity ?? "info",
    summary: draft.summary,
    metadata: draft.metadata ?? {},
    computationVersion: draft.computationVersion ?? CURRENT_SCORING_VERSION,
    timestamp: draft.timestamp ?? nowIso(),
  };

  buffer.push(event);
  if (buffer.length > BUFFER_SIZE) buffer.splice(0, buffer.length - BUFFER_SIZE);

  for (const subscription of subscriptions.values()) {
    if (!matches(event, subscription.filter)) continue;
    try {
      subscription.listener(event);
    } catch (error) {
      // one broken consumer must not stop delivery to the others, and must
      // never propagate back into the computation that emitted the event
      logger.warn("event subscriber threw", {
        subscription: subscription.id,
        event: event.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return event;
}

export function emitAll(drafts: EventDraft[]): StrataEvent[] {
  return drafts.map(emit);
}

export interface SubscribeResult {
  id: string;
  unsubscribe: () => void;
}

export function subscribe(
  listener: EventListener,
  filter?: EventFilter,
): SubscribeResult | null {
  if (subscriptions.size >= MAX_SUBSCRIBERS) {
    logger.warn("event subscription refused: at capacity", {
      subscribers: subscriptions.size,
    });
    return null;
  }

  const id = randomUUID();
  subscriptions.set(id, { id, listener, filter });
  return { id, unsubscribe: () => void subscriptions.delete(id) };
}

/**
 * Events after a given id, in order.
 *
 * When the id is no longer in the buffer the client has been away longer than
 * the buffer covers, and the honest answer is the whole buffer rather than
 * silence — it is a gap the client can see, not one it cannot.
 */
export function replayAfter(lastEventId: string | null, filter?: EventFilter): StrataEvent[] {
  const source = filter ? buffer.filter((event) => matches(event, filter)) : buffer;
  if (!lastEventId) return [];

  const index = source.findIndex((event) => event.id === lastEventId);
  if (index === -1) return source;
  return source.slice(index + 1);
}

/** Most recent first. */
export function recent(filter?: EventFilter): StrataEvent[] {
  const source = filter ? buffer.filter((event) => matches(event, filter)) : buffer;
  const limit = filter?.limit ?? 100;
  return [...source].reverse().slice(0, limit);
}

export function subscriberCount(): number {
  return subscriptions.size;
}

export function bufferSize(): number {
  return buffer.length;
}

/** Test seam. Never called by the service. */
export function __resetBus(): void {
  buffer.length = 0;
  subscriptions.clear();
}
