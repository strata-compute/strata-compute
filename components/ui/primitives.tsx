import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface",
        interactive &&
          "transition-colors duration-200 hover:border-border-strong hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border px-5 py-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.14em] text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

/* ----------------------------------------------------------------- Badge */

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.09em] leading-4",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-2 text-muted",
        green: "border-green-ink/25 bg-green-ink/8 text-green-ink",
        red: "border-red/25 bg-red/8 text-red",
        amber: "border-amber/25 bg-amber/8 text-amber",
        blue: "border-blue/25 bg-blue/8 text-blue",
        outline: "border-border-strong bg-transparent text-faint",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ------------------------------------------------------------- Section */

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        {eyebrow ? (
          <div className="flex items-center gap-2">
            <span className="h-px w-5 bg-green-ink/60" aria-hidden />
            <span className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-green-ink">
              {eyebrow}
            </span>
          </div>
        ) : null}
        <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-text">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- Skeleton */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-[4px] bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-md border border-border bg-surface-2 text-faint [&_svg]:size-4.5">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-text">{title}</p>
        {description ? (
          <p className="max-w-sm text-[13px] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------- Kbd */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-border bg-surface-2 px-1 font-mono text-[10px] font-medium text-faint">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------ StatusDot */

const dotTone: Record<string, string> = {
  green: "bg-green-ink",
  red: "bg-red",
  amber: "bg-amber",
  blue: "bg-blue",
  muted: "bg-faint",
};

export function StatusDot({
  tone = "green",
  pulse = false,
  className,
}: {
  tone?: keyof typeof dotTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative flex size-1.5", className)} aria-hidden>
      {pulse ? (
        <span
          className={cn(
            "absolute inset-0 animate-live-pulse rounded-full opacity-70",
            dotTone[tone],
          )}
        />
      ) : null}
      <span className={cn("relative size-1.5 rounded-full", dotTone[tone])} />
    </span>
  );
}
