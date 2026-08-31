import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Fixed session anchor. Every "time ago" label in Phase 1 is derived from
 * this constant rather than `Date.now()` so server and client markup match.
 * Phase 2 replaces the *Ago fields with real ISO timestamps.
 */
export const SESSION_ANCHOR = new Date("2026-03-04T15:42:00Z");

export function formatPrice(value: number, currency = "$") {
  const decimals = value >= 1000 ? 2 : value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return (
    currency +
    value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function formatCompact(value: number, currency = "") {
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      return `${currency}${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
    }
  }
  return `${currency}${value.toFixed(0)}`;
}

export function formatPercent(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatPoints(value: number, digits = 1) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function formatInteger(value: number) {
  return value.toLocaleString("en-US");
}

export function formatRelative(minutesAgo: number) {
  if (minutesAgo < 1) return "just now";
  if (minutesAgo < 60) return `${Math.round(minutesAgo)}m ago`;
  const hours = minutesAgo / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatSecondsAgo(secondsAgo: number) {
  if (secondsAgo < 60) return `${secondsAgo}s`;
  return `${Math.floor(secondsAgo / 60)}m`;
}

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * The seeded PRNG and synthetic price-path builders that used to live here
 * were removed in the real-data audit. They existed only to manufacture
 * market series for the UI; nothing may generate a market value on the
 * client, so the capability is gone rather than merely unused.
 */

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
