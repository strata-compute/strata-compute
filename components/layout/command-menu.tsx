"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { CornerDownLeft, Search } from "lucide-react";
import { ALL_NAV } from "@/lib/nav";
import { routes } from "@/lib/routes";
import type { Asset } from "@/lib/types";
import { cn, formatPrice, formatPercent } from "@/lib/utils";
import { AssetLogo } from "@/components/data/asset-logo";
import { CLASS_LABEL } from "@/components/data/asset-identity";
import { Kbd } from "@/components/ui/primitives";

const OPEN_EVENT = "strata:command-menu";

/** Opens the palette from anywhere without threading context through the tree. */
export function openCommandMenu() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function CommandMenu({ markets }: { markets?: Asset[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // the palette lists whatever markets the page handed it; it never holds a
  // catalogue of its own
  const assets = markets ?? [];

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === "/" && !open) {
        const target = event.target as HTMLElement | null;
        const typing =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!typing) {
          event.preventDefault();
          setOpen(true);
        }
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter
      filter={score}
      className="flex max-h-full flex-col overflow-hidden"
      overlayClassName="fixed inset-0 z-60 bg-scrim backdrop-blur-[2px] data-[state=open]:animate-enter"
      contentClassName="fixed left-1/2 top-[12vh] z-60 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)] data-[state=open]:animate-rise"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-faint" />
        <Command.Input
          placeholder="Search markets, pages and signals..."
          className="h-13 w-full bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
        />
        <Kbd>ESC</Kbd>
      </div>

      <Command.List className="max-h-[min(420px,52vh)] overflow-y-auto overscroll-contain p-2">
        <Command.Empty className="px-3 py-10 text-center text-[13px] text-muted">
          No matches in the compute set.
        </Command.Empty>

        <Command.Group
          heading="Navigation"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-faint"
        >
          {ALL_NAV.map((item) => (
            <Command.Item
              key={item.href}
              /* the hint is display-only — matching on it produces
                 surprises like "eth" hitting "Methodology" */
              value={item.label}
              onSelect={() => go(item.href)}
              className={itemClass}
            >
              <item.icon className="size-4 text-faint" />
              <span className="flex-1 text-text">{item.label}</span>
              <span className="text-[11.5px] text-faint">{item.hint}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {assets.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12.5px] text-faint">
            Market search is unavailable while live data is not reachable.
          </div>
        ) : null}

        <Command.Group
          heading="Markets"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-faint"
        >
          {assets.map((asset) => (
            <Command.Item
              key={asset.id}
              value={`${asset.symbol} ${asset.name} ${asset.assetClass}`}
              onSelect={() => go(routes.asset(asset.symbol))}
              className={itemClass}
            >
              <AssetLogo asset={asset} size="sm" />
              <span className="text-text">{asset.symbol}</span>
              <span className="flex-1 truncate text-[12.5px] text-muted">
                {asset.name}
              </span>
              <span className="hidden shrink-0 text-[10.5px] uppercase tracking-[0.12em] text-faint sm:inline">
                {CLASS_LABEL[asset.assetClass]}
              </span>
              <span className="font-mono text-[11.5px] text-faint">
                {formatPrice(asset.price)}
              </span>
              <span
                className={cn(
                  "w-16 text-right font-mono text-[11.5px]",
                  asset.change24h >= 0 ? "text-green-ink" : "text-red",
                )}
              >
                {formatPercent(asset.change24h)}
              </span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>

      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-faint">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft className="size-2.5" />
            </Kbd>
            open
          </span>
        </span>
        <span>Strata Compute · Phase 1 preview</span>
      </div>
    </Command.Dialog>
  );
}

/**
 * Ticker-first ranking: a prefix match on the symbol always outranks an
 * incidental substring hit elsewhere (otherwise "eth" finds "Methodology").
 */
function score(value: string, search: string) {
  const haystack = value.toLowerCase();
  const needle = search.toLowerCase().trim();
  if (!needle) return 1;
  if (haystack.startsWith(needle)) return 1;
  if (haystack.includes(` ${needle}`)) return 0.7;
  if (haystack.includes(needle)) return 0.3;
  return 0;
}

const itemClass = cn(
  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-[13px] text-muted",
  "data-[selected=true]:bg-surface-2 data-[selected=true]:text-text",
);
