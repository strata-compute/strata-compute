import * as React from "react";
import { cn, formatPrice } from "@/lib/utils";
import { NoValue } from "@/components/data/data-state";

/**
 * A quote, rendered exactly as the backend reported it.
 *
 * This replaces the previous `LivePrice`, which nudged the number on a timer
 * to make tables feel alive. That movement was invented — it corresponded to
 * no trade and no provider update — so it is gone. A price changes here only
 * when the backend returns a different one.
 */
export function Quote({
  price,
  className,
}: {
  price: number | null;
  className?: string;
}) {
  if (price === null) return <NoValue hint="No price reported by the provider" />;
  return (
    <span className={cn("inline-block font-mono tabular-nums text-text", className)}>
      {formatPrice(price)}
    </span>
  );
}
