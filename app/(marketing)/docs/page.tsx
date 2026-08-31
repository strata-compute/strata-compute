import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SCORE_FACTORS } from "@/lib/pipeline-spec";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page-header";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Methodology, scoring definitions and the planned Strata Compute API.",
};

const SECTIONS = [
  {
    id: "methodology",
    title: "Methodology",
    body: "Every covered market is scored on five independently computed factors. Factor readings are cross-normalised within an asset class, then combined using published weights. No factor reads another factor's output, so a failure in one module degrades that factor only.",
  },
  {
    id: "coverage",
    title: "Coverage rules",
    body: "A market enters the compute set once it holds sustained notional above the coverage floor for seven consecutive days across at least one qualifying venue. Markets that fall below the floor are marked stale rather than removed, so their history stays intact.",
  },
  {
    id: "versioning",
    title: "Scoring versions",
    body: "Weights are fixed for the life of a scoring version. When weights change the version increments, every covered market is recomputed, and prior scores remain queryable under the previous version.",
  },
  {
    id: "determinism",
    title: "Determinism",
    body: "Given the same normalised inputs and the same scoring version, a computation reproduces exactly. Every published score retains its full factor attribution and the identifier of the computation that produced it.",
  },
];

const ENDPOINTS = [
  { method: "GET", path: "/v1/assets", detail: "Paginated compute set with current scores" },
  { method: "GET", path: "/v1/assets/{symbol}", detail: "Single market with factor breakdown" },
  { method: "GET", path: "/v1/rankings", detail: "Ordered standings, filterable by class" },
  { method: "GET", path: "/v1/signals", detail: "Signal feed with cursor pagination" },
  { method: "GET", path: "/v1/arena/rounds/{id}", detail: "Round standings and events" },
  { method: "WS", path: "/v1/stream", detail: "Score, signal and round event stream" },
];

export default function DocumentationPage() {
  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-6 px-5 pb-24 pt-28 sm:px-8 lg:pt-32">
      <PageHeader
        eyebrow="Documentation"
        title="Methodology and API"
        subtitle="How the Strata Score is defined, what enters the compute set, and the interface Phase 2 will expose."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-[13px] leading-relaxed text-muted">
                {section.body}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Factor definitions</CardTitle>
          <span className="font-mono text-[10.5px] text-faint">
            scoring version 2.4
          </span>
        </CardHeader>
        <ul>
          {SCORE_FACTORS.map((factor) => (
            <li
              key={factor.key}
              className="flex flex-col gap-1.5 border-b border-border/70 px-5 py-4 last:border-b-0 sm:flex-row sm:gap-6"
            >
              <div className="flex w-40 shrink-0 items-baseline justify-between gap-3 sm:block">
                <p className="text-[13px] font-medium text-text">{factor.label}</p>
                <p className="mt-0.5 font-mono text-[11px] text-faint">
                  weight {(factor.weight * 100).toFixed(0)}%
                </p>
              </div>
              <p className="text-[12.5px] leading-relaxed text-muted">
                {factor.description}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API surface</CardTitle>
          <Badge tone="amber">Phase 2</Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-muted">
            The interface below is what the frontend consumes today. Every view
            in the console and on this site reads it directly; there is no
            second data path.
          </p>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-md border border-border">
            {ENDPOINTS.map((endpoint) => (
              <li
                key={endpoint.path}
                className="flex flex-wrap items-center gap-3 bg-surface-2/40 px-4 py-2.5"
              >
                <span
                  className={
                    endpoint.method === "WS"
                      ? "w-10 font-mono text-[11px] text-blue"
                      : "w-10 font-mono text-[11px] text-green-ink"
                  }
                >
                  {endpoint.method}
                </span>
                <code className="font-mono text-[12.5px] text-text">
                  {endpoint.path}
                </code>
                <span className="ml-auto text-[12px] text-muted">
                  {endpoint.detail}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where to go next</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-3">
          {[
            { href: routes.compute, label: "The computation pipeline" },
            { href: routes.rankings, label: "Live rankings" },
            { href: routes.status, label: "Pipeline status" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center justify-between rounded-md border border-border px-3.5 py-3 text-[12.5px] text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {link.label}
              <ArrowUpRight className="size-3.5 text-border-strong transition-colors group-hover:text-green-ink" />
            </Link>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
