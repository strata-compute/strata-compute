"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Menu, X } from "lucide-react";
import { LANDING_NAV } from "@/lib/landing-data";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { ThemeToggle, ThemeToggleRows } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/layout/logo";

/** The strongest CTA on the marketing site — it is the way into the product. */
function OpenAppButton({
  className,
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={routes.terminal}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-green px-3 text-[13px] font-semibold text-on-accent transition-colors duration-150 hover:bg-green-bright sm:px-4",
        className,
      )}
    >
      Open Terminal
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function LandingNav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-border bg-bg/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      {/* The 40px gap separates the logo from the nav links, which are hidden
          below md — so below md it is 40px of nothing, and with the longer
          "Open Terminal" label that was enough to push the bar past a 360px
          viewport. */}
      <div className="mx-auto flex h-16 w-full max-w-full items-center gap-4 px-4 sm:px-8 md:max-w-[1240px] md:gap-10">
        <Link href={routes.landing} aria-label="Strata Compute" className="min-w-0 shrink">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {LANDING_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-[13.5px] transition-colors duration-150",
                  active ? "text-text" : "text-muted hover:text-text",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <ThemeToggle className="hidden sm:flex" />
          <OpenAppButton />

          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              aria-label="Open menu"
              className="flex size-9 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-text md:hidden"
            >
              <Menu className="size-4" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=open]:animate-enter md:hidden" />
              <Dialog.Content className="fixed inset-x-0 top-0 z-50 border-b border-border bg-surface pb-6 data-[state=open]:animate-rise md:hidden">
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <div className="flex h-16 items-center justify-between px-5 sm:px-8">
                  <Logo />
                  <Dialog.Close
                    aria-label="Close menu"
                    className="flex size-9 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-text"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <nav className="flex flex-col px-5 sm:px-8">
                  {LANDING_NAV.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="border-t border-border py-4 text-[15px] text-text"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <OpenAppButton
                    className="mt-6 h-11 justify-center text-[14px]"
                    onClick={() => setOpen(false)}
                  />
                  <ThemeToggleRows className="mt-4" />
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
