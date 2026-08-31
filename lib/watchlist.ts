/**
 * THE WATCHLIST
 *
 * A per-reader preference with no account to attach it to, so it lives in
 * `localStorage`. That has a consequence worth being explicit about: the
 * browser holds a list of *symbols*, never market data. Every figure shown
 * for a watched asset is fetched from the backend at render time.
 *
 * This is what stops a hand-edited storage entry from becoming a row of
 * invented numbers. A symbol the server cannot resolve produces an
 * unavailable row that names the symbol, not a fabricated price — the list is
 * a set of pointers into the real universe, and the universe is authoritative.
 */

const STORAGE_KEY = "strata-watchlist";
const MAX_ENTRIES = 50;

/** Broadcast so every mounted component reflects a change immediately. */
const CHANGE_EVENT = "strata:watchlist";

function normalise(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isPlausibleSymbol(symbol: string): boolean {
  // A shape check only. Whether the symbol exists is the server's answer, not
  // the browser's — this just keeps obvious junk out of storage.
  return /^[A-Z0-9][A-Z0-9.\-$]{0,15}$/.test(symbol);
}

export function readWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map(normalise)
          .filter(isPlausibleSymbol),
      ),
    ].slice(0, MAX_ENTRIES);
  } catch {
    // private mode, blocked storage, or corrupted JSON — an empty watchlist
    // is the correct degradation
    return [];
  }
}

function write(symbols: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  } catch {
    // the change still applies for this session
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: symbols }));
}

export function addToWatchlist(symbol: string): string[] {
  const clean = normalise(symbol);
  if (!isPlausibleSymbol(clean)) return readWatchlist();

  const current = readWatchlist();
  if (current.includes(clean)) return current;

  const next = [clean, ...current].slice(0, MAX_ENTRIES);
  write(next);
  return next;
}

export function removeFromWatchlist(symbol: string): string[] {
  const clean = normalise(symbol);
  const next = readWatchlist().filter((entry) => entry !== clean);
  write(next);
  return next;
}

export function toggleWatchlist(symbol: string): string[] {
  const clean = normalise(symbol);
  return readWatchlist().includes(clean)
    ? removeFromWatchlist(clean)
    : addToWatchlist(clean);
}

export function isWatched(symbol: string): boolean {
  return readWatchlist().includes(normalise(symbol));
}

/** Subscribes to changes from this tab and from others. */
export function onWatchlistChange(listener: (symbols: string[]) => void): () => void {
  const local = () => listener(readWatchlist());
  const remote = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener(readWatchlist());
  };

  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener("storage", remote);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener("storage", remote);
  };
}

export const WATCHLIST_STORAGE_KEY = STORAGE_KEY;
export const WATCHLIST_LIMIT = MAX_ENTRIES;
