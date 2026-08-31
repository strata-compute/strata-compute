import Link from "next/link";
import { routes } from "@/lib/routes";
import { Logo } from "@/components/layout/logo";

/**
 * Global 404 — rendered outside both the console shell and the marketing
 * chrome, so it stands on its own.
 */
export default function NotFound() {
  return (
    <main
      id="content"
      className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center"
    >
      <Logo />
      <div className="space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-green-ink">
          404
        </p>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-text">
          Nothing computed at this address.
        </h1>
        <p className="mx-auto max-w-sm text-[13.5px] leading-relaxed text-muted">
          The page you are looking for is not part of the compute set.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={routes.landing}
          className="rounded-md border border-border bg-surface px-4 py-2 text-[13px] text-text transition-colors hover:border-border-strong"
        >
          Back to strata.compute
        </Link>
        <Link
          href={routes.app}
          className="rounded-md bg-green px-4 py-2 text-[13px] font-semibold text-on-accent transition-colors hover:bg-green-bright"
        >
          Launch App
        </Link>
      </div>
    </main>
  );
}
