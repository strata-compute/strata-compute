import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free sparkline. Renders on the server so tables paint
 * in the first response.
 */
export function Sparkline({
  data,
  positive,
  width = 96,
  height = 28,
  strokeWidth = 1.25,
  fill = false,
  className,
  id,
}: {
  data: number[];
  positive: boolean;
  width?: number;
  height?: number;
  strokeWidth?: number;
  fill?: boolean;
  className?: string;
  id?: string;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = strokeWidth;
  const stepX = (width - pad * 2) / (data.length - 1);

  const points = data.map((value, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (value - min) / span);
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;

  const stroke = positive ? "var(--color-green-ink)" : "var(--color-red)";
  const gradientId = `spark-${id ?? "x"}-${positive ? "up" : "down"}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path
        d={line}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
