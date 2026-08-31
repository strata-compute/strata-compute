"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function useMeasure<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export interface AreaChartProps {
  data: number[];
  /** X-axis tick labels, evenly distributed. */
  xLabels?: string[];
  height?: number;
  positive?: boolean;
  /** Renders a dashed line at this value (e.g. the session open). */
  baseline?: number;
  formatValue?: (value: number) => string;
  formatCursor?: (value: number, index: number) => string;
  className?: string;
  /** Draw the y-axis value gutter on the right. */
  showAxis?: boolean;
  animate?: boolean;
}

export function AreaChart({
  data,
  xLabels,
  height = 280,
  positive = true,
  baseline,
  formatValue = (v) => v.toFixed(2),
  formatCursor,
  className,
  showAxis = true,
  animate = true,
}: AreaChartProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [cursor, setCursor] = React.useState<number | null>(null);
  const gradientId = `grad${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const gutter = showAxis ? 56 : 0;
  const padY = 16;
  const plotW = Math.max(0, width - gutter);
  const plotH = height - padY * 2;

  const stats = React.useMemo(() => {
    const min = Math.min(...data, ...(baseline !== undefined ? [baseline] : []));
    const max = Math.max(...data, ...(baseline !== undefined ? [baseline] : []));
    const pad = (max - min) * 0.12 || 1;
    return { min: min - pad, max: max + pad };
  }, [data, baseline]);

  const toX = (i: number) => (plotW * i) / (data.length - 1);
  const toY = (v: number) =>
    padY + plotH * (1 - (v - stats.min) / (stats.max - stats.min || 1));

  const path = React.useMemo(() => {
    if (!plotW) return { line: "", area: "" };
    const line = data
      .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(2)},${toY(v).toFixed(2)}`)
      .join(" ");
    const area = `${line} L${plotW.toFixed(2)},${height} L0,${height} Z`;
    return { line, area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plotW, plotH, stats.min, stats.max, height]);

  const color = positive ? "var(--color-green-ink)" : "var(--color-red)";
  const gridRows = 4;
  const activeIndex = cursor ?? data.length - 1;
  const activeValue = data[activeIndex];

  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!plotW) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = Math.round((x / plotW) * (data.length - 1));
    setCursor(Math.max(0, Math.min(data.length - 1, index)));
  };

  return (
    <div className={cn("select-none", className)}>
    <div
      ref={ref}
      className="relative"
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setCursor(null)}
    >
      {width > 0 ? (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.16" />
              <stop offset="70%" stopColor={color} stopOpacity="0.02" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* horizontal grid + right-hand value gutter */}
          {Array.from({ length: gridRows + 1 }).map((_, i) => {
            const y = padY + (plotH * i) / gridRows;
            const value = stats.max - ((stats.max - stats.min) * i) / gridRows;
            return (
              <g key={i}>
                <line
                  x1={0}
                  x2={plotW}
                  y1={y}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  opacity={0.55}
                />
                {showAxis ? (
                  <text
                    x={width}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-faint font-mono text-[10px]"
                  >
                    {formatValue(value)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {baseline !== undefined ? (
            <line
              x1={0}
              x2={plotW}
              y1={toY(baseline)}
              y2={toY(baseline)}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          ) : null}

          <path d={path.area} fill={`url(#${gradientId})`} />
          <path
            d={path.line}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={
              animate
                ? {
                    strokeDasharray: 4000,
                    strokeDashoffset: 4000,
                    animation: "draw 1.1s cubic-bezier(0.16,1,0.3,1) forwards",
                  }
                : undefined
            }
          />

          {/* cursor */}
          {cursor !== null ? (
            <g>
              <line
                x1={toX(cursor)}
                x2={toX(cursor)}
                y1={padY - 8}
                y2={height - padY + 8}
                stroke="var(--color-border-strong)"
                strokeWidth={1}
              />
              <circle
                cx={toX(cursor)}
                cy={toY(data[cursor])}
                r={3.5}
                fill="var(--color-bg)"
                stroke={color}
                strokeWidth={1.6}
              />
            </g>
          ) : (
            <circle
              cx={toX(data.length - 1)}
              cy={toY(data[data.length - 1])}
              r={3}
              fill={color}
            />
          )}
        </svg>
      ) : null}

      {/* floating readout */}
      {width > 0 ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 transition-opacity duration-150"
          style={{
            left: Math.min(Math.max(toX(activeIndex), 44), plotW - 44),
            opacity: cursor === null ? 0 : 1,
          }}
        >
          <div className="rounded-[4px] border border-border-strong bg-elevated px-2 py-1 font-mono text-[11px] text-text shadow-[0_8px_24px_-10px_rgba(0,0,0,0.9)]">
            {formatCursor
              ? formatCursor(activeValue, activeIndex)
              : formatValue(activeValue)}
          </div>
        </div>
      ) : null}
    </div>

      {xLabels?.length ? (
        <div
          className="mt-2 flex justify-between font-mono text-[10px] text-faint"
          style={{ paddingRight: gutter }}
        >
          {xLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
