import * as React from "react";
import { external } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The two outbound accounts.
 *
 * Drawn by hand rather than pulled from the icon set: Lucide dropped its brand
 * icons, and a wordmark approximated from a generic glyph is worse than none.
 * Both paths are the marks as their owners publish them, at 24 units so they
 * sit on the same grid as everything else here.
 */

const ICON: Record<string, string> = {
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z",
  github:
    "M12 .5A11.5 11.5 0 0 0 8.365 22.92c.575.106.785-.25.785-.554 0-.273-.01-.998-.015-1.958-3.196.694-3.87-1.541-3.87-1.541-.523-1.328-1.278-1.682-1.278-1.682-1.044-.714.079-.699.079-.699 1.154.081 1.762 1.185 1.762 1.185 1.026 1.758 2.691 1.25 3.347.956.104-.744.401-1.25.73-1.538-2.552-.291-5.235-1.276-5.235-5.68 0-1.255.448-2.281 1.183-3.086-.119-.29-.513-1.46.112-3.043 0 0 .965-.309 3.162 1.179a10.98 10.98 0 0 1 5.76 0c2.195-1.488 3.159-1.179 3.159-1.179.626 1.583.232 2.753.114 3.043.737.805 1.181 1.831 1.181 3.086 0 4.415-2.687 5.386-5.247 5.671.412.355.78 1.056.78 2.128 0 1.537-.014 2.777-.014 3.155 0 .307.208.666.79.553A11.5 11.5 0 0 0 12 .5Z",
};

export function SocialLinks({ className }: { className?: string }) {
  const accounts = [
    { key: "x", label: "Strata Compute on X", href: external.x },
    { key: "github", label: "Strata Compute on GitHub", href: external.github },
  ];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {accounts.map((account) => (
        <a
          key={account.key}
          href={account.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={account.label}
          className="grid size-8 place-items-center rounded-md text-faint transition-colors duration-150 hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-ink"
        >
          <svg viewBox="0 0 24 24" className="size-[15px]" fill="currentColor" aria-hidden>
            <path d={ICON[account.key]} />
          </svg>
        </a>
      ))}
    </div>
  );
}
