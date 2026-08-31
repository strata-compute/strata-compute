/**
 * SUBSYSTEM NAMING
 *
 * The backend identifies its upstreams by vendor id, because that is what an
 * operator needs when something breaks. The product does not: a reader is
 * looking at Strata Compute, and which vendor served a quote is an
 * implementation detail of the platform.
 *
 * This module is the one translation between the two vocabularies, and it
 * only translates in the safe direction — internal id to capability name.
 * There is no inverse. The public status page describes what a subsystem
 * does; `/api/health` continues to name the vendor for diagnostics.
 *
 * An unrecognised id degrades to a generic capability label rather than
 * falling through to the raw vendor string, so adding a provider can never
 * silently leak its name into the interface.
 */

export interface Subsystem {
  label: string;
  description: string;
}

const SUBSYSTEMS: Record<string, Subsystem> = {
  robinhood_stock_tokens: {
    label: "Tokenised equities",
    description: "Quotes and contract identity for tokenised stock markets.",
  },
  coingecko: {
    label: "Crypto markets",
    description: "Spot pricing, volume and capitalisation for crypto assets.",
  },
  alpha_vantage: {
    label: "Equity reference",
    description: "Reference pricing used to corroborate equity observations.",
  },
  alchemy: {
    label: "Chain data",
    description: "Block, transaction and log reads from the chain itself.",
  },
  blockscout: {
    label: "Onchain index",
    description: "Token metadata and transfer activity from the chain index.",
  },
  goplus: {
    label: "Token security",
    description: "Contract risk checks applied to onchain tokens.",
  },
  strata: {
    label: "Strata compute",
    description: "The scoring engine and its derived outputs.",
  },
};

const UNKNOWN: Subsystem = {
  label: "Market data",
  description: "A market data subsystem of the platform.",
};

export function subsystemFor(id: string): Subsystem {
  return SUBSYSTEMS[id] ?? UNKNOWN;
}

/**
 * Distinct capability labels for a set of internal source ids. Used where a
 * view wants to say what a figure was computed from without naming a vendor.
 */
export function subsystemLabels(ids: string[]): string[] {
  return [...new Set(ids.map((id) => subsystemFor(id).label))];
}
