import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsView } from "@/components/sections/settings-view";

export const metadata: Metadata = {
  title: "Settings",
  description: "Workspace display preferences for the Strata Compute console.",
};

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Workspace"
        subtitle="Display and default preferences for this console. Phase 1 keeps them local to the session."
      />
      <SettingsView />
    </div>
  );
}
