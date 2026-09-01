import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FOOTER_GROUPS } from "@/lib/landing-data";
import { routes } from "@/lib/routes";
import { Logo } from "@/components/layout/logo";

export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-[1240px] px-5 py-14 sm:px-8">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xs">
            <Link href={routes.landing} aria-label="Strata Compute">
              <Logo />
            </Link>
            <p className="mt-5 text-[13px] leading-relaxed text-muted">
              The computation layer for modern markets.
            </p>
            <Link
              href={routes.terminal}
              className="group mt-6 inline-flex items-center gap-1.5 text-[13px] text-text transition-colors hover:text-green-ink"
            >
              Open Terminal
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-x-16 gap-y-10 sm:grid-cols-2">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
                  {group.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-[13px] text-muted transition-colors duration-150 hover:text-text"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-faint">
            © 2026 Strata Compute
          </p>
          <p className="font-mono text-[11px] text-faint">
            Live market data · sourced, timestamped, computed
          </p>
        </div>
      </div>
    </footer>
  );
}
