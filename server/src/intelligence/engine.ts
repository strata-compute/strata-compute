import {
  INTELLIGENCE_VERSION,
  LIFECYCLE,
  PRIORITY,
  SEVERITY_BANDS,
  SIGNIFICANCE,
} from "../config/intelligence.ts";
import { SCORE_VERSION } from "../config/score-v1.ts";
import type {
  DetectionResult,
  IntelligenceEvent,
  IntelligenceEventType,
  IntelligenceSeverity,
} from "../types/intelligence-events.ts";
import { clamp, round } from "../utils/number.ts";
import { persistenceOf } from "./significance.ts";
import { nowIso } from "../utils/time.ts";

/**
 * THE LIFECYCLE ENGINE
 *
 * Turns detections into events that persist, evolve and eventually end.
 *
 * This is where the difference between a signal and an intelligence event
 * actually lives. A detector fires on every pass while its condition holds —
 * fifteen passes of a strengthening asset produce fifteen detections. Left
 * alone that becomes fifteen identical entries in the feed, which is both
 * useless and actively misleading, because a reader would infer fifteen
 * separate things happened.
 *
 * So the engine reconciles detections against events already open. The same
 * condition on the same asset updates the existing event: its magnitude moves
 * to the latest reading, its observation count grows, its significance is
 * recomputed with the added persistence. A condition that stops being
 * detected is RESOLVED — measured to have ended. One that stops being
 * observed at all is EXPIRED, which is a different statement and must not be
 * confused with the market having changed.
 *
 * Identity is (assetId, eventType) among open events, and the database
 * enforces it with a partial unique index. Deduplication is therefore a
 * property of the schema rather than a behaviour of this code.
 */

export function severityFor(significance: number): IntelligenceSeverity {
  if (significance >= SEVERITY_BANDS.critical) return "critical";
  if (significance >= SEVERITY_BANDS.high) return "high";
  if (significance >= SEVERITY_BANDS.medium) return "medium";
  return "low";
}

/**
 * Feed ordering.
 *
 * Significance decides whether an event is raised; priority decides which of
 * the raised events is read first. Kept apart from both the Strata Score and
 * severity so the feed can rank by "what deserves attention" without
 * implying "what is strongest".
 */
export function priorityFor(event: {
  significance: number;
  confidence: number;
  observations: number;
}): number {
  const w = PRIORITY.weights;
  const persistence = persistenceOf(event.observations);
  return round(
    clamp(
      event.significance * w.significance +
        event.confidence * w.confidence +
        persistence * w.persistence,
      0,
      1,
    ),
    4,
  );
}

/** Identity of an open event. Matches the database's partial unique index. */
export function eventKey(
  assetId: string | null,
  eventType: IntelligenceEventType,
): string {
  return `${assetId ?? "market"}:${eventType}`;
}

export interface ReconcileInput {
  detections: DetectionResult[];
  /** Events currently open, keyed by `eventKey`. */
  open: Map<string, IntelligenceEvent>;
  computationVersion: string;
  now?: string;
}

export interface ReconcileResult {
  /** Events to write: newly detected and updated alike. */
  upserts: IntelligenceEvent[];
  /** Open events whose condition was measured to have ended. */
  resolved: IntelligenceEvent[];
  /** Open events that stopped being observed rather than ending. */
  expired: IntelligenceEvent[];
  created: number;
  updated: number;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const at = input.now ?? nowIso();
  const nowMs = new Date(at).getTime();

  const upserts: IntelligenceEvent[] = [];
  const resolved: IntelligenceEvent[] = [];
  const expired: IntelligenceEvent[] = [];
  const seen = new Set<string>();

  let created = 0;
  let updated = 0;

  for (const detection of input.detections) {
    // below the floor is not an event; it is ordinary market noise
    if (detection.significance.value < SIGNIFICANCE.minimum) continue;

    const key = eventKey(detection.assetId, detection.eventType);
    seen.add(key);

    const existing = input.open.get(key);
    const ttl = LIFECYCLE.ttlSeconds[detection.eventType] ?? 10_800;
    const expiresAt = new Date(nowMs + ttl * 1000).toISOString();

    if (existing) {
      // The condition still holds: the SAME event evolves. Its start time is
      // preserved, so the feed can say how long this has been going on.
      const observations = existing.observations + 1;
      const persistence = persistenceOf(observations);
      const significanceValue = round(
        detection.significance.magnitude *
          persistence *
          detection.significance.historicalDeviation *
          detection.significance.dataConfidence,
        4,
      );

      updated += 1;
      upserts.push({
        ...existing,
        status: "active",
        severity: severityFor(significanceValue),
        significance: {
          ...detection.significance,
          persistence,
          value: significanceValue,
        },
        confidence: detection.confidence,
        driverAgreement: detection.driverAgreement,
        magnitude: detection.magnitude,
        observations,
        drivers: detection.drivers,
        context: detection.context,
        latestValue: detection.value,
        priority: priorityFor({
          significance: significanceValue,
          confidence: detection.confidence,
          observations,
        }),
        latestAt: at,
        expiresAt,
      });
      continue;
    }

    created += 1;
    upserts.push({
      assetId: detection.assetId,
      symbol: detection.symbol,
      assetType: detection.assetType,
      eventType: detection.eventType,
      status: "detected",
      severity: severityFor(detection.significance.value),
      significance: detection.significance,
      confidence: detection.confidence,
      driverAgreement: detection.driverAgreement,
      magnitude: detection.magnitude,
      observations: 1,
      drivers: detection.drivers,
      context: detection.context,
      firstValue: detection.value,
      latestValue: detection.value,
      priority: priorityFor({
        significance: detection.significance.value,
        confidence: detection.confidence,
        observations: 1,
      }),
      detectedAt: at,
      latestAt: at,
      resolvedAt: null,
      expiresAt,
      computationVersion: input.computationVersion,
      scoreVersion: SCORE_VERSION,
    });
  }

  // Anything open that was not re-detected has either ended or gone quiet.
  for (const [key, event] of input.open) {
    if (seen.has(key)) continue;

    const missedFor = nowMs - new Date(event.latestAt).getTime();
    const ttl = (LIFECYCLE.ttlSeconds[event.eventType] ?? 10_800) * 1000;

    if (missedFor > ttl) {
      // Stopped being observed. Not the same as having ended — a pipeline
      // outage must never read as a market change.
      expired.push({ ...event, status: "expired", latestAt: at });
    } else {
      resolved.push({ ...event, status: "resolved", resolvedAt: at, latestAt: at });
    }
  }

  return { upserts, resolved, expired, created, updated };
}

export { INTELLIGENCE_VERSION };
