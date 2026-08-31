import type { IsoTimestamp } from "../utils/time.ts";

export const ARENA_ROUND_STATUSES = ["pending", "active", "settled"] as const;
export type ArenaRoundStatus = (typeof ARENA_ROUND_STATUSES)[number];

export const ARENA_ENTRY_STATUSES = [
  "active",
  "at_risk",
  "eliminated",
  "winner",
] as const;
export type ArenaEntryStatus = (typeof ARENA_ENTRY_STATUSES)[number];

export interface ArenaRound {
  id: string;
  /** Rounds are grouped into seasons for presentation and history. */
  season: number;
  roundNumber: number;
  status: ArenaRoundStatus;
  startsAt: IsoTimestamp;
  endsAt: IsoTimestamp;
  /** Set when the round settles. Null while it is running. */
  settledAt: IsoTimestamp | null;
  winnerAssetId: string | null;
  winnerSymbol: string | null;
  winnerScore: number | null;
  winnerHp: number | null;
  /** The rules this round was run under. */
  arenaVersion: string;
  createdAt: IsoTimestamp;
}

/**
 * One asset's standing in one round.
 *
 * Both the starting and current values are kept so the round can show
 * progression rather than only a final state — "entered at 71.2, now 78.4" is
 * the story a competition is actually about, and it cannot be reconstructed
 * from the current value alone.
 */
export interface ArenaEntry {
  id?: string;
  roundId: string;
  assetId: string;
  symbol: string;
  startingScore: number;
  currentScore: number;
  startingHp: number;
  currentHp: number;
  /** 0–100 computed strength this pass. Null when coverage was too thin. */
  power: number | null;
  rank: number;
  startingRank: number;
  status: ArenaEntryStatus;
  /** Set when the entrant was eliminated. */
  eliminatedAt: IsoTimestamp | null;
  joinedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** A recorded moment in a round, kept permanently for the history view. */
export interface ArenaEvent {
  id?: string;
  roundId: string;
  assetId: string | null;
  symbol: string | null;
  eventType:
    | "ARENA_UPDATE"
    | "ARENA_ELIMINATION"
    | "ARENA_WINNER"
    | "ARENA_OVERTAKE"
    | "ARENA_AT_RISK";
  previousValue: number | null;
  newValue: number | null;
  change: number | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

export interface ArenaRoundView {
  round: ArenaRound;
  entries: ArenaEntry[];
}
