"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";

function Row({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <p className="text-[13px] text-text">{label}</p>
        <p className="mt-1 max-w-lg text-[12.5px] leading-relaxed text-muted">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full border transition-colors duration-200",
        checked ? "border-green-ink/40 bg-green-ink/25" : "border-border bg-elevated",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-3.5 rounded-full transition-transform duration-200",
          checked ? "translate-x-4.5 bg-green-ink" : "translate-x-0.5 bg-muted",
        )}
      />
    </button>
  );
}

/**
 * Preferences are held in component state for the Phase 1 preview — nothing
 * is persisted and no account is involved.
 */
export function SettingsView() {
  const [density, setDensity] = React.useState("comfortable");
  const [defaultClass, setDefaultClass] = React.useState("all");
  const [numbers, setNumbers] = React.useState("compact");
  const [liveTicks, setLiveTicks] = React.useState(true);
  const [motion, setMotion] = React.useState(true);
  const [signalAlerts, setSignalAlerts] = React.useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
        </CardHeader>
        <CardBody className="py-0">
          <Row
            label="Table density"
            description="Row height used across rankings, arena standings and asset tables."
            control={
              <Segmented
                size="sm"
                ariaLabel="Table density"
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
                value={density}
                onValueChange={setDensity}
              />
            }
          />
          <Row
            label="Number format"
            description="Whether large figures are abbreviated or written in full."
            control={
              <Segmented
                size="sm"
                ariaLabel="Number format"
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "full", label: "Full" },
                ]}
                value={numbers}
                onValueChange={setNumbers}
              />
            }
          />
          <Row
            label="Reduced motion"
            description="Turn off ticking quotes, the battle feed animation and chart draw-in."
            control={
              <Toggle
                checked={!motion}
                onChange={(value) => setMotion(!value)}
                label="Reduced motion"
              />
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
        </CardHeader>
        <CardBody className="py-0">
          <Row
            label="Default asset class"
            description="Which class rankings and signals open on."
            control={
              <Segmented
                size="sm"
                ariaLabel="Default asset class"
                options={[
                  { value: "all", label: "All" },
                  { value: "stock", label: "Stocks" },
                  { value: "crypto", label: "Crypto" },
                  { value: "onchain", label: "Onchain" },
                ]}
                value={defaultClass}
                onValueChange={setDefaultClass}
              />
            }
          />
          <Row
            label="Live quote ticks"
            description="Animate quotes between computation windows."
            control={
              <Toggle
                checked={liveTicks}
                onChange={setLiveTicks}
                label="Live quote ticks"
              />
            }
          />
          <Row
            label="Signal alerts"
            description="Surface a notification when a covered market emits a signal above 3σ."
            control={
              <Toggle
                checked={signalAlerts}
                onChange={setSignalAlerts}
                label="Signal alerts"
              />
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phase 1 preview</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-[12.5px] leading-relaxed text-muted">
            These preferences are held in memory for the preview and reset on
            reload. Phase 2 attaches them to a workspace and applies them across
            every view.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
