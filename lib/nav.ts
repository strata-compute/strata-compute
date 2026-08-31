import type { LucideIcon } from "lucide-react";
import { routes } from "@/lib/routes";
import {
  Activity,
  BookText,
  Boxes,
  Cpu,
  LayoutDashboard,
  ListOrdered,
  Radio,
  Scale,
  Settings2,
  Star,
  Swords,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short line used by the command palette. */
  hint: string;
  badge?: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Overview", href: routes.overview, icon: LayoutDashboard, hint: "Market compute summary" },
  // No static badge here. The round number is real state that changes, and a
  // hardcoded one was showing "R148" while the Arena was on round 1.
  { label: "Arena", href: routes.arena, icon: Swords, hint: "Competitive round standings" },
  { label: "Rankings", href: routes.rankings, icon: ListOrdered, hint: "Ordered by Strata Score" },
  { label: "Assets", href: routes.assets, icon: Boxes, hint: "Search and browse markets" },
  { label: "Signals", href: routes.signals, icon: Radio, hint: "Computed market events" },
  { label: "Activity", href: routes.activity, icon: Activity, hint: "Live event stream" },
  { label: "Watchlist", href: routes.watchlist, icon: Star, hint: "Markets you are tracking" },
  { label: "Compare", href: routes.compare, icon: Scale, hint: "Two to four markets side by side" },
  { label: "Compute", href: routes.compute, icon: Cpu, hint: "How the score is produced" },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: "Documentation", href: routes.documentation, icon: BookText, hint: "Methodology and API" },
  { label: "Status", href: routes.status, icon: Activity, hint: "Pipeline health" },
  { label: "Settings", href: routes.settings, icon: Settings2, hint: "Workspace preferences" },
];

export const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

export function titleForPath(pathname: string) {
  const match = ALL_NAV.find((item) => pathname.startsWith(item.href));
  if (match) return match.label;
  if (pathname.startsWith(`${routes.assets}/`)) return "Asset";
  return "Strata Compute";
}
