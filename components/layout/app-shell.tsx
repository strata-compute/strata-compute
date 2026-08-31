import * as React from "react";
import type { Asset } from "@/lib/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StreamProvider } from "@/components/realtime/stream-provider";
import { CommandMenu } from "@/components/layout/command-menu";
import { PageTransition } from "@/components/layout/page-transition";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({
  children,
  markets = [],
}: {
  children: React.ReactNode;
  /**
   * Real markets from the backend, loaded once by the console layout and
   * handed to the palette. Search has no catalogue of its own; when the
   * backend has nothing, search finds nothing.
   */
  markets?: Asset[];
}) {
  return (
    /* One live connection for the whole console. Every live surface reads
       from this provider rather than opening a stream of its own. */
    <StreamProvider>
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <div className="min-h-screen bg-bg">
        <Sidebar />
        <div className="lg:pl-60">
          <Topbar />
          <main
            id="content"
            className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
          >
            <PageTransition>{children}</PageTransition>
          </main>
          <footer className="mx-auto w-full max-w-[1440px] px-4 pb-10 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-2 border-t border-border pt-5 text-[11.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
              <p>
                Strata Compute — the computation layer for modern markets.
              </p>
              <p className="font-mono">
                Live market data · every figure is sourced and timestamped
              </p>
            </div>
          </footer>
        </div>
      </div>
        <CommandMenu markets={markets} />
      </TooltipProvider>
    </StreamProvider>
  );
}
