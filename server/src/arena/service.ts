import { arenaConfig, CURRENT_ARENA_VERSION } from "../config/arena.ts";
import { getStore } from "../database/index.ts";
import { emit } from "../events/bus.ts";
import type { RankableAsset } from "../rankings/service.ts";
import { rankAssets } from "../rankings/service.ts";
import type {
  ArenaEntry,
  ArenaEvent,
  ArenaRound,
  ArenaRoundView,
} from "../types/arena.ts";
import { AppError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";
import { round as roundTo } from "../utils/number.ts";
import { nowIso } from "../utils/time.ts";
import { computeArenaPower, hpDelta, nextHp, statusForHp } from "./power.ts";

/**
 * THE ARENA
 *
 * A round is a fixed window in which a fixed field of real assets competes on
 * computed strength. Nothing about it is invented: the field is drawn from
 * the scored universe, HP moves as a pure function of the same components
 * that produce a Strata Score, elimination follows a published rule, and the
 * winner is whoever the final state says it is.
 *
 * The design constraint worth stating is what the Arena must never become. A
 * competition presented over market data is exactly the kind of feature that
 * invites a nudge — a little randomness to keep it interesting, a fake
 * entrant to fill a thin field, a dramatic elimination that the numbers do
 * not support. Every one of those would turn a computation into a game with a
 * financial skin, so:
 *
 *   - entrants come only from the store's scored assets, never from a request;
 *   - an asset whose components are too thin to judge does not lose HP for it;
 *   - a round with too few real entrants does not open at all;
 *   - eliminations and the winner are read off stored state, not chosen.
 */

const HISTORY_LIMIT = 50;

/* ------------------------------------------------------------- rounds --- */

function seasonFor(roundNumber: number, roundsPerSeason = 24): number {
  return Math.floor((roundNumber - 1) / roundsPerSeason) + 1;
}

export interface EnsureRoundResult {
  round: ArenaRound | null;
  opened: boolean;
  reason: string | null;
}

/**
 * Opens a round when none is running, provided the market can actually field
 * one. A round of two assets is not a competition, so below `minimumField`
 * the Arena stays closed and says why.
 */
export async function ensureActiveRound(): Promise<EnsureRoundResult> {
  const store = getStore();
  const config = arenaConfig();
  const existing = await store.getCurrentArenaRound();
  const now = Date.now();

  if (existing && existing.status === "active" && new Date(existing.endsAt).getTime() > now) {
    return { round: existing, opened: false, reason: null };
  }

  // a round that has run its course is settled before another opens
  if (existing && existing.status === "active") {
    await settleRound(existing);
  }

  const scored = await store.listLatestIntelligence({});
  const eligible = scored.filter((record) => record.score.status === "OK");

  if (eligible.length < config.minimumField) {
    return {
      round: null,
      opened: false,
      reason: `the Arena needs ${config.minimumField} scored assets to open a round; ${eligible.length} are available`,
    };
  }

  const roundNumber = (existing?.roundNumber ?? 0) + 1;
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + config.roundDurationMs);

  const created = await store.createArenaRound({
    season: seasonFor(roundNumber),
    roundNumber,
    status: "active",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    settledAt: null,
    winnerAssetId: null,
    winnerSymbol: null,
    winnerScore: null,
    winnerHp: null,
    arenaVersion: CURRENT_ARENA_VERSION,
  });

  logger.info("arena round opened", {
    job: "arena",
    season: created.season,
    round: created.roundNumber,
    eligible: eligible.length,
  });

  return { round: created, opened: true, reason: null };
}

/* ---------------------------------------------------------- standings --- */

export interface SyncResult {
  view: ArenaRoundView | null;
  events: ArenaEvent[];
  reason: string | null;
}

/**
 * Advances the active round by one pass.
 *
 * Every entrant's HP moves by its computed power, ranks are recomputed from
 * live scores, and crossings — an overtake, a drop into the risk zone, an
 * elimination — are emitted as events. Idempotent in shape: running it twice
 * against identical inputs produces identical standings.
 */
export async function syncRoundStandings(rankable: RankableAsset[]): Promise<SyncResult> {
  const store = getStore();
  const config = arenaConfig();

  const ensured = await ensureActiveRound();
  if (!ensured.round) {
    return { view: null, events: [], reason: ensured.reason };
  }
  const round = ensured.round;

  // The field is the top N by Strata Score, drawn from the verified universe.
  // Nothing outside this list can enter, which is what makes "no fake
  // entrants" a structural property rather than a promise.
  const snapshot = rankAssets(rankable, { metric: "score", limit: config.fieldSize });
  if (snapshot.entries.length < config.minimumField) {
    return {
      view: null,
      events: [],
      reason: `only ${snapshot.entries.length} assets are currently scoreable`,
    };
  }

  const existing = await store.listArenaEntries(round.id);
  const previousByAsset = new Map(existing.map((entry) => [entry.assetId, entry]));
  const intelligenceByAsset = new Map(
    rankable.map((item) => [item.asset.id, item.intelligence]),
  );

  const timestamp = nowIso();
  const entries: ArenaEntry[] = [];
  const events: ArenaEvent[] = [];

  for (const ranked of snapshot.entries) {
    const previous = previousByAsset.get(ranked.assetId);

    // an entrant eliminated earlier in the round stays eliminated
    if (previous?.status === "eliminated") {
      entries.push({ ...previous, rank: previous.rank, updatedAt: timestamp });
      continue;
    }

    const record = intelligenceByAsset.get(ranked.assetId);
    const power = record ? computeArenaPower(record, config) : null;
    const delta = hpDelta(power?.power ?? null, config);

    const startingHp = previous?.startingHp ?? config.startingHp;
    const currentHp = previous
      ? nextHp(previous.currentHp, delta, config)
      : config.startingHp;

    const status = statusForHp(currentHp, config);

    const entry: ArenaEntry = {
      roundId: round.id,
      assetId: ranked.assetId,
      symbol: ranked.symbol,
      startingScore: previous?.startingScore ?? ranked.score,
      currentScore: ranked.score,
      startingHp,
      currentHp,
      power: power?.power ?? null,
      rank: ranked.rank,
      startingRank: previous?.startingRank ?? ranked.rank,
      status,
      eliminatedAt:
        status === "eliminated" ? (previous?.eliminatedAt ?? timestamp) : null,
      joinedAt: previous?.joinedAt ?? timestamp,
      updatedAt: timestamp,
    };
    entries.push(entry);

    if (!previous) continue;

    /* ---- crossings worth reporting ---- */

    const hpChange = roundTo(currentHp - previous.currentHp, 2);
    if (Math.abs(hpChange) >= config.hpEventThreshold) {
      events.push({
        roundId: round.id,
        assetId: entry.assetId,
        symbol: entry.symbol,
        eventType: "ARENA_UPDATE",
        previousValue: previous.currentHp,
        newValue: currentHp,
        change: hpChange,
        summary: `${entry.symbol} ${hpChange > 0 ? "gained" : "lost"} ${Math.abs(hpChange).toFixed(1)} HP`,
        metadata: { power: entry.power, rank: entry.rank },
        createdAt: timestamp,
      });
    }

    const rankChange = previous.rank - entry.rank;
    if (Math.abs(rankChange) >= config.rankEventThreshold) {
      // name who was overtaken when the move is unambiguous
      const overtaken = existing.find((other) => other.rank === entry.rank);
      events.push({
        roundId: round.id,
        assetId: entry.assetId,
        symbol: entry.symbol,
        eventType: rankChange > 0 ? "ARENA_OVERTAKE" : "ARENA_UPDATE",
        previousValue: previous.rank,
        newValue: entry.rank,
        change: rankChange,
        summary:
          rankChange > 0 && overtaken && overtaken.assetId !== entry.assetId
            ? `${entry.symbol} overtook ${overtaken.symbol} for #${entry.rank}`
            : `${entry.symbol} moved ${Math.abs(rankChange)} place${Math.abs(rankChange) === 1 ? "" : "s"} ${rankChange > 0 ? "up" : "down"} to #${entry.rank}`,
        metadata: { hp: currentHp },
        createdAt: timestamp,
      });
    }

    if (previous.status !== "at_risk" && status === "at_risk") {
      events.push({
        roundId: round.id,
        assetId: entry.assetId,
        symbol: entry.symbol,
        eventType: "ARENA_AT_RISK",
        previousValue: previous.currentHp,
        newValue: currentHp,
        change: hpChange,
        summary: `${entry.symbol} dropped into the elimination zone at ${currentHp.toFixed(0)} HP`,
        metadata: { threshold: config.atRiskHp },
        createdAt: timestamp,
      });
    }

    // an entrant already eliminated left the loop above, so reaching
    // "eliminated" here is always a fresh crossing
    if (status === "eliminated") {
      events.push({
        roundId: round.id,
        assetId: entry.assetId,
        symbol: entry.symbol,
        eventType: "ARENA_ELIMINATION",
        previousValue: previous.currentHp,
        newValue: 0,
        change: hpChange,
        summary: `${entry.symbol} was eliminated from round ${round.roundNumber}`,
        metadata: { finalRank: entry.rank, finalScore: entry.currentScore },
        createdAt: timestamp,
      });
    }
  }

  /**
   * Standings are ordered by HP, then score.
   *
   * The Strata Score decides who *enters* the field; HP decides who is
   * winning it, because HP is what accumulates over the round and what
   * settlement reads to pick a winner. Ranking the live table by score while
   * settling by HP would show an order that does not predict the outcome —
   * a table saying an asset is second when it would place third if the round
   * closed now is worse than no table.
   */
  const ordered = [...entries]
    .sort(
      (a, b) =>
        b.currentHp - a.currentHp ||
        b.currentScore - a.currentScore ||
        a.symbol.localeCompare(b.symbol),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  await store.upsertArenaEntries(ordered);
  if (events.length > 0) await store.insertArenaEvents(events);

  for (const event of events) {
    emit({
      eventType:
        event.eventType === "ARENA_ELIMINATION" ? "ARENA_ELIMINATION" : "ARENA_UPDATE",
      assetId: event.assetId,
      symbol: event.symbol,
      previousValue: event.previousValue,
      newValue: event.newValue,
      change: event.change,
      severity: event.eventType === "ARENA_ELIMINATION" ? "important" : "notable",
      summary: event.summary,
      metadata: { ...event.metadata, roundId: round.id, roundNumber: round.roundNumber },
      timestamp: event.createdAt,
    });
  }

  return { view: { round, entries: ordered }, events, reason: null };
}

/* -------------------------------------------------------- settlement --- */

/**
 * Closes a round and records its outcome permanently.
 *
 * The winner is read off the final state — highest HP, then highest score as
 * the tie-break — rather than selected. Eliminations at settlement are the
 * configured bottom slice by the same ordering, so a round's result can be
 * recomputed from its stored entries and checked.
 */
export async function settleRound(round: ArenaRound): Promise<ArenaRound | null> {
  const store = getStore();
  const config = arenaConfig();
  const entries = await store.listArenaEntries(round.id);

  if (entries.length === 0) {
    logger.warn("arena round settled with no entrants", { round: round.roundNumber });
    return store.settleArenaRound(round.id, {
      settledAt: nowIso(),
      winnerAssetId: null,
      winnerSymbol: null,
      winnerScore: null,
      winnerHp: null,
    });
  }

  const timestamp = nowIso();

  // deterministic ordering: HP, then score, then symbol
  const survivors = entries
    .filter((entry) => entry.status !== "eliminated")
    .sort(
      (a, b) =>
        b.currentHp - a.currentHp ||
        b.currentScore - a.currentScore ||
        a.symbol.localeCompare(b.symbol),
    );

  const eliminated = survivors.slice(-config.eliminationsAtSettlement);
  const remaining = survivors.slice(
    0,
    Math.max(0, survivors.length - config.eliminationsAtSettlement),
  );

  const finalEntries: ArenaEntry[] = [];
  const events: ArenaEvent[] = [];

  for (const entry of eliminated) {
    finalEntries.push({
      ...entry,
      status: "eliminated",
      eliminatedAt: entry.eliminatedAt ?? timestamp,
      updatedAt: timestamp,
    });
    events.push({
      roundId: round.id,
      assetId: entry.assetId,
      symbol: entry.symbol,
      eventType: "ARENA_ELIMINATION",
      previousValue: entry.currentHp,
      newValue: entry.currentHp,
      change: null,
      summary: `${entry.symbol} was eliminated at the close of round ${round.roundNumber}`,
      metadata: { finalRank: entry.rank, finalHp: entry.currentHp },
      createdAt: timestamp,
    });
  }

  const winner = remaining[0] ?? survivors[0] ?? null;

  for (const entry of remaining) {
    finalEntries.push({
      ...entry,
      status: entry.assetId === winner?.assetId ? "winner" : entry.status,
      updatedAt: timestamp,
    });
  }

  if (winner) {
    events.push({
      roundId: round.id,
      assetId: winner.assetId,
      symbol: winner.symbol,
      eventType: "ARENA_WINNER",
      previousValue: winner.startingHp,
      newValue: winner.currentHp,
      change: roundTo(winner.currentHp - winner.startingHp, 2),
      summary: `${winner.symbol} won round ${round.roundNumber} with ${winner.currentHp.toFixed(1)} HP and a score of ${winner.currentScore.toFixed(1)}`,
      metadata: { finalScore: winner.currentScore, finalRank: winner.rank },
      createdAt: timestamp,
    });
  }

  if (finalEntries.length > 0) await store.upsertArenaEntries(finalEntries);
  if (events.length > 0) await store.insertArenaEvents(events);

  const settled = await store.settleArenaRound(round.id, {
    settledAt: timestamp,
    winnerAssetId: winner?.assetId ?? null,
    winnerSymbol: winner?.symbol ?? null,
    winnerScore: winner?.currentScore ?? null,
    winnerHp: winner?.currentHp ?? null,
  });

  for (const event of events) {
    emit({
      eventType: event.eventType === "ARENA_WINNER" ? "ARENA_WINNER" : "ARENA_ELIMINATION",
      assetId: event.assetId,
      symbol: event.symbol,
      previousValue: event.previousValue,
      newValue: event.newValue,
      change: event.change,
      severity: "important",
      summary: event.summary,
      metadata: { ...event.metadata, roundId: round.id, roundNumber: round.roundNumber },
      timestamp: event.createdAt,
    });
  }

  logger.info("arena round settled", {
    job: "arena",
    round: round.roundNumber,
    winner: winner?.symbol ?? null,
    eliminated: eliminated.length,
  });

  return settled;
}

/* ------------------------------------------------------------- reads --- */

export async function getRoundView(roundNumber?: number): Promise<ArenaRoundView> {
  const store = getStore();
  const round =
    roundNumber === undefined
      ? await store.getCurrentArenaRound()
      : await store.getArenaRound(roundNumber);

  if (!round) throw AppError.notFound("Arena round", roundNumber?.toString());
  return { round, entries: await store.listArenaEntries(round.id) };
}

export async function listRounds(limit = HISTORY_LIMIT): Promise<ArenaRound[]> {
  return getStore().listArenaRounds(limit);
}

/** Settled rounds with a recorded winner — the Hall of Fame. */
export async function listWinners(limit = HISTORY_LIMIT): Promise<ArenaRound[]> {
  const rounds = await getStore().listArenaRounds(limit * 2);
  return rounds
    .filter((round) => round.status === "settled" && round.winnerAssetId !== null)
    .slice(0, limit);
}

export async function listRoundEvents(
  roundNumber: number,
  limit = 100,
): Promise<ArenaEvent[]> {
  const store = getStore();
  const round = await store.getArenaRound(roundNumber);
  if (!round) throw AppError.notFound("Arena round", String(roundNumber));
  return store.listArenaEvents(round.id, limit);
}
