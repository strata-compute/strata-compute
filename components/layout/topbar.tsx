"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, Menu, Search, X } from "lucide-react";
import { titleForPath } from "@/lib/nav";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/primitives";
import { LiveIndicator } from "@/components/layout/live-indicator";
import { SidebarContent } from "@/components/layout/sidebar";
import { openCommandMenu } from "@/components/layout/command-menu";
import { LogoMark } from "@/components/layout/logo";
import { ThemeToggle, ThemeToggleRows } from "@/components/theme/theme-toggle";
import { NotificationCenter } from "@/components/realtime/notifications";

function Breadcrumb() {
  const pathname = usePathname();
  const title = titleForPath(pathname);
  const detail =
    pathname.startsWith(`${routes.assets}/`) && pathname.split("/")[3]
      ? pathname.split("/")[3].toUpperCase()
      : null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-[13px]"
    >
      {/* The breadcrumb root is the way back to the public site. A crumb that
          is not a link is decoration; this one goes home. */}
      <Link
        href={routes.landing}
        className="hidden text-faint transition-colors hover:text-text sm:inline"
      >
        Strata
      </Link>
      <ChevronRight className="hidden size-3.5 text-border-strong sm:inline" />
      {detail ? (
        <>
          <Link href={routes.assets} className="text-muted transition-colors hover:text-text">
            Assets
          </Link>
          <ChevronRight className="size-3.5 text-border-strong" />
          <span className="truncate font-medium text-text">{detail}</span>
        </>
      ) : (
        <span className="truncate font-medium text-text">{title}</span>
      )}
    </nav>
  );
}

function MobileNav() {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="flex size-8 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-text lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-enter lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-bg data-[state=open]:animate-enter lg:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Close
            className="absolute right-3 top-4 flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:text-text"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </Dialog.Close>
          <SidebarContent onNavigate={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 border-t border-border p-3">
            <ThemeToggleRows />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
      <MobileNav />
      <Link href={routes.overview} className="lg:hidden" aria-label="Strata Compute">
        <LogoMark size={20} />
      </Link>

      <div className="hidden min-w-0 flex-1 sm:block">
        <Breadcrumb />
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={openCommandMenu}
          className={cn(
            "group flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-faint transition-colors duration-150",
            "hover:border-border-strong hover:text-muted",
          )}
        >
          <Search className="size-3.5" />
          <span className="hidden md:inline">Search markets...</span>
          <span className="ml-6 hidden items-center gap-0.5 md:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <NotificationCenter />
        <ThemeToggle className="hidden sm:flex" />

        <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
        <LiveIndicator className="shrink-0" />
      </div>
    </header>
  );
}
