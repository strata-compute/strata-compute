"use client";

import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, Check, X } from "lucide-react";
import { EVENT_LABEL, type StrataEvent } from "@/lib/realtime/events";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import { useStream } from "./stream-provider";

/**
 * THE NOTIFICATION CENTRE
 *
 * A filtered view of the same event stream everything else reads, kept to
 * what is worth interrupting someone for: anomalies, eliminations, winners,
 * regime changes and large moves.
 *
 * Read state is per-reader and this build has no accounts, so it lives in
 * localStorage — a set of ids that have been seen. Storing ids rather than
 * notifications means nothing here can ever display a market figure that did
 * not come from the stream, and clearing storage loses a preference rather
 * than data.
 */

const STORAGE_KEY = "strata-read-notifications";
const MAX_TRACKED = 400;

/** Only these reach the bell. Everything else stays in the activity feed. */
function isNotifiable(event: StrataEvent): boolean {
  if (event.severity === "important") return true;
  if (event.eventType === "EARLY_MOVER_DETECTED") return true;
  if (event.eventType === "MARKET_REGIME_CHANGED") return true;
  if (event.eventType === "RANK_CHANGED" && Math.abs(event.change ?? 0) >= 5) return true;
  if (event.eventType === "STRATA_SCORE_CHANGED" && Math.abs(event.change ?? 0) >= 4) {
    return true;
  }
  return false;
}

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  try {
    // bounded: read state for an event that has aged out of the buffer can
    // never be needed again
    const trimmed = [...ids].slice(-MAX_TRACKED);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // the session still behaves correctly without persistence
  }
}

export function NotificationCenter({ className }: { className?: string }) {
  const { events } = useStream();
  const [open, setOpen] = React.useState(false);
  const [seen, setSeen] = React.useState<Set<string>>(() => new Set());
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setSeen(readSeen());
    setReady(true);
  }, []);

  const notifications = React.useMemo(
    () => events.filter(isNotifiable).slice(0, 40),
    [events],
  );

  const unread = React.useMemo(
    () => (ready ? notifications.filter((event) => !seen.has(event.id)) : []),
    [notifications, seen, ready],
  );

  const markRead = React.useCallback((id: string) => {
    setSeen((current) => {
      const next = new Set(current).add(id);
      writeSeen(next);
      return next;
    });
  }, []);

  const markAllRead = React.useCallback(() => {
    setSeen((current) => {
      const next = new Set(current);
      for (const event of notifications) next.add(event.id);
      writeSeen(next);
      return next;
    });
  }, [notifications]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={cn(
          "relative flex size-8 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-text",
          className,
        )}
        aria-label={
          unread.length > 0
            ? `Notifications, ${unread.length} unread`
            : "Notifications"
        }
      >
        <Bell className="size-3.5" />
        {unread.length > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-green px-1 font-mono text-[9px] font-semibold text-on-accent"
            aria-hidden
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        ) : null}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-enter" />
        <Dialog.Content className="fixed right-4 top-16 z-50 flex max-h-[min(560px,75vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl data-[state=open]:animate-rise">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <Dialog.Title className="text-[13px] font-medium text-text">
              Notifications
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {unread.length > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11.5px] text-muted transition-colors hover:text-text"
                >
                  <Check className="size-3" />
                  Mark all read
                </button>
              ) : null}
              <Dialog.Close
                className="flex size-6 items-center justify-center rounded-md text-faint transition-colors hover:text-text"
                aria-label="Close notifications"
              >
                <X className="size-3.5" />
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12.5px] leading-relaxed text-muted">
                Nothing to report. Notifications appear when computation detects
                a change significant enough to interrupt you.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((event) => {
                  const isUnread = ready && !seen.has(event.id);
                  const row = (
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint">
                          {EVENT_LABEL[event.eventType]}
                        </span>
                        {isUnread ? (
                          <span className="size-1.5 rounded-full bg-green-ink" aria-hidden />
                        ) : null}
                      </span>
                      <span className="text-[12.5px] leading-relaxed text-text">
                        {event.summary}
                      </span>
                    </span>
                  );

                  return (
                    <li
                      key={event.id}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 transition-colors",
                        isUnread ? "bg-surface-2/40" : "",
                      )}
                      onMouseEnter={() => isUnread && markRead(event.id)}
                    >
                      {event.symbol ? (
                        <AssetLogo
                          asset={{ symbol: event.symbol, logoUrl: event.logoUrl }}
                          size="xs"
                          className="mt-0.5"
                        />
                      ) : null}
                      {event.symbol ? (
                        <Link
                          href={routes.asset(event.symbol)}
                          onClick={() => setOpen(false)}
                          className="flex min-w-0 flex-1"
                        >
                          {row}
                        </Link>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
