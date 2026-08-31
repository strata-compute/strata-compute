"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "@/lib/nav";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/logo";
import { ArrowLeft } from "lucide-react";
import { ComputeHeartbeat } from "@/components/layout/live-indicator";

function useIsActive() {
  const pathname = usePathname();
  // every console route now has its own path segment, so a prefix test is
  // unambiguous — /app/overview is not a prefix of any sibling
  return React.useCallback(
    (href: string) => pathname.startsWith(href),
    [pathname],
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors duration-150",
        active
          ? "bg-surface text-text"
          : "text-muted hover:bg-surface/70 hover:text-text",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-green-ink transition-opacity duration-200",
          active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <item.icon
        className={cn(
          "size-4 transition-colors duration-150",
          active ? "text-green-ink" : "text-faint group-hover:text-muted",
        )}
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="rounded-[3px] border border-border bg-surface-2 px-1 font-mono text-[10px] text-faint">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useIsActive();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link
          href={routes.overview}
          onClick={onNavigate}
          className="rounded-sm outline-none"
          aria-label="Strata Compute — Overview"
        >
          <Logo />
        </Link>
      </div>

      <div className="px-3 pb-2 pt-3">
        <p className="px-2.5 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
          Platform
        </p>
        <nav className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      </div>

      <div className="mt-auto space-y-3 px-3 pb-4">
        <nav className="space-y-0.5 border-t border-border pt-3">
          {SECONDARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        {/* Explicit rather than implied: the sidebar logo goes to the
            overview, so without this there is no obvious exit from the
            product back to the public site. */}
        <Link
          href={routes.landing}
          onClick={onNavigate}
          className="group flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-surface/70 hover:text-text"
        >
          <ArrowLeft
            className="size-4 text-faint transition-colors group-hover:text-muted"
            strokeWidth={1.75}
          />
          Back to home
        </Link>
        <ComputeHeartbeat />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-border bg-bg lg:block">
      <SidebarContent />
    </aside>
  );
}
