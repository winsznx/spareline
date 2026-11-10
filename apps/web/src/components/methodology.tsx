"use client";

import { METHODOLOGY_JSON_URL } from "@/lib/api";
import { useMethodology } from "@/lib/queries";

import { buttonClass, ErrorState, PageHeader, Panel, Spinner } from "./ui";

const ORDER = ["dataset", "license", "assumptions", "travel_model", "baselines", "constraints", "limitations", "reproduction"];

function humanKey(k: string): string {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function isUrl(v: string): boolean {
  return /^https?:\/\//.test(v);
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  if (typeof value === "string") {
    return isUrl(value) ? (
      <a className="break-all text-route-other underline underline-offset-2" href={value} rel="noreferrer" target="_blank">
        {value}
      </a>
    ) : (
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</span>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") return <span className="tnum">{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(min(140px,30%),220px)_minmax(0,1fr)]">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2 [overflow-wrap:anywhere]">{humanKey(k)}</dt>
          <dd className="min-w-0">
            <Value value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Methodology() {
  const q = useMethodology();
  const data = q.data ?? {};
  const keys = [...ORDER.filter((k) => k in data), ...Object.keys(data).filter((k) => !ORDER.includes(k))];
  return (
    <div className="space-y-5">
      <PageHeader title="Methodology" meta="How Spareline replays historical routes, simulates disruptions and decides whether a transfer is safe.">
        <a className={buttonClass("secondary")} href={METHODOLOGY_JSON_URL}>
          Download methodology JSON
        </a>
      </PageHeader>
      <Panel className="p-4 text-sm leading-relaxed">
        <h2 className="text-[16px] font-semibold">Data source and licence</h2>
        <p className="mt-1 text-ink-2">
          Routes, stops, packages, observed stop sequences and within-route travel times come from the Amazon Last Mile Routing Research Challenge dataset
          (2021 release of 2018 routes, Amazon and MIT CTL), available at{" "}
          <a className="text-route-other underline underline-offset-2" href="https://registry.opendata.aws/amazon-last-mile-challenges/" target="_blank" rel="noreferrer">
            registry.opendata.aws/amazon-last-mile-challenges
          </a>{" "}
          under{" "}
          <a className="text-route-other underline underline-offset-2" href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">
            CC BY-NC 4.0
          </a>
          . Locations are anonymized. This is a non-commercial research demonstration; commercial use would need separately licensed operational data.
        </p>
      </Panel>
      {q.isPending ? <Spinner label="Loading methodology…" /> : null}
      {q.isError ? <ErrorState error={q.error} title="Methodology could not be loaded from the API." onRetry={() => void q.refetch()} /> : null}
      {keys.map((k) => (
        <Panel key={k} className="p-4 text-sm">
          <h2 id={k} className="mb-2 text-[16px] font-semibold">
            {humanKey(k)}
          </h2>
          <div className="min-w-0 overflow-x-auto">
            <Value value={data[k]} />
          </div>
        </Panel>
      ))}
    </div>
  );
}
