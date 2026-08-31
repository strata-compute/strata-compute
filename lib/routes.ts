/**
 * Single source of truth for every internal URL.
 *
 * The public landing page lives at `/`; the application console is mounted
 * under `/app`. Nothing should hardcode a path — import from here so the mount
 * point can move again without touching components.
 */
export const APP_BASE = "/app";

export const routes = {
  landing: "/",
  /** Marketing pages — the public story, not the product. */
  about: "/about",
  platform: "/platform",
  /** Entry point for the console — redirects to the overview. */
  app: APP_BASE,
  overview: `${APP_BASE}/overview`,
  arena: `${APP_BASE}/arena`,
  rankings: `${APP_BASE}/rankings`,
  assets: `${APP_BASE}/assets`,
  signals: `${APP_BASE}/signals`,
  compute: `${APP_BASE}/compute`,
  settings: `${APP_BASE}/settings`,
  /** Public pages — they sit outside the console. */
  documentation: "/docs",
  status: "/status",
  /** Detail page for a single market. */
  asset: (symbol: string) => `${APP_BASE}/assets/${symbol.toLowerCase()}`,
  /** Standings for one arena round. */
  arenaRound: (round: number) => `${APP_BASE}/arena/${round}`,
  arenaHistory: `${APP_BASE}/arena/history`,
  watchlist: `${APP_BASE}/watchlist`,
  compare: `${APP_BASE}/compare`,
  activity: `${APP_BASE}/activity`,
} as const;

/**
 * There is deliberately no anchor map here.
 *
 * Every item that represents a real product section routes to that section's
 * page. Hash fragments are reserved for the in-page skip link, which is an
 * accessibility affordance rather than navigation.
 */
