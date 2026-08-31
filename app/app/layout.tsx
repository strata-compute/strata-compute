import { AppShell } from "@/components/layout/app-shell";
import { loadMarkets } from "@/lib/data";

/**
 * The console chrome — sidebar, topbar, command palette.
 *
 * The palette is populated here rather than inside itself: one request per
 * navigation, shared by every page, and always the same markets the pages
 * are rendering. If the backend is unavailable the list is empty and search
 * says so, which is the correct answer.
 */
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const markets = await loadMarkets({ limit: 300 });
  return <AppShell markets={markets.data ?? []}>{children}</AppShell>;
}
