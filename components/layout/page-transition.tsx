"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/** Re-keys on navigation so each route fades and rises into place. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-rise">
      {children}
    </div>
  );
}
