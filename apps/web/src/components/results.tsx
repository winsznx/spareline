"use client";

import { useMemo, useState } from "react";

import { EVALUATION_CSV_URL, METHODOLOGY_JSON_URL, type EvaluationRow } from "@/lib/api";
import { num, reasonLabel, utcDateTime } from "@/lib/format";
import { useEvaluationResults, useEvaluationSummary } from "@/lib/queries";

import { buttonClass, ErrorState, PageHeader, Panel, Spinner } from "./ui";

type Baseline = "no_action" | "nearest";

function n(row: EvaluationRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function s(row: EvaluationRow, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
}

function humanKey(k: string): string {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function MetricValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  if (typeof value === "number") return <span className="tnum">{num(value, Number.isInteger(value) ? 0 : 2)}</span>;
  if (typeof value === "string" || typeof value === "boolean") return <span className="[overflow-wrap:anywhere]">{String(value)}</span>;
  if (Array.isArray(value)) return <span className="font-mono text-[12px]">{value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ")}</span>;
  const obj = value as Record<string, unknown>;
  if (typeof obj.numerator === "number" && typeof obj.denominator === "number") {
    const pct = obj.denominator ? (100 * obj.numerator) / obj.denominator : null;
    return (
      <span className="tnum">
        {num(obj.numerator)} / {num(obj.denominator)}
        {pct !== null ? <span className="text-ink-3"> ({num(pct, 1)}%)</span> : null}
      </span>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{humanKey(k)}</dt>
          <dd>
            <MetricValue value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DeltaScatter({ rows, baseline }: { rows: EvaluationRow[]; baseline: Baseline }) {
  const W = 640;
  const H = 280;
  const pad = { l: 44, r: 16, t: 16, b: 36 };
  const pts = rows
    .map((r) => {
      const x = n(r, baseline === "no_action" ? "missed_no_action" : "missed_nearest");
      const d = n(r, baseline === "no_action" ? "delta_vs_no_action" : "delta_vs_nearest");
      return x === null || d === null ? null : { x, d, state: s(r, "state"), id: s(r, "scenario_id") };
    })
    .filter((p): p is { x: number; d: number; state: string; id: string } => p !== null);
  if (!pts.length) return <p className="text-sm text-ink-2">No per-scenario deltas available.</p>;
  const maxX = Math.max(1, ...pts.map((p) => p.x));
  const maxD = Math.max(1, ...pts.map((p) => Math.abs(p.d)));
  const sx = (x: number) => pad.l + (x / maxX) * (W - pad.l - pad.r);
  const sy = (d: number) => pad.t + ((maxD - d) / (2 * maxD)) * (H - pad.t - pad.b);
  const jitter = (i: number) => ((i * 37) % 7) - 3;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Packages saved per scenario versus packages missed by the baseline">
        <line x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} stroke="var(--ink-3)" strokeWidth={1} />
        <text x={pad.l - 6} y={sy(0) + 4} textAnchor="end" fontSize={11} fill="var(--ink-2)">0</text>
        <text x={pad.l - 6} y={sy(maxD) + 8} textAnchor="end" fontSize={11} fill="var(--ink-2)">+{maxD}</text>
        <text x={pad.l - 6} y={sy(-maxD)} textAnchor="end" fontSize={11} fill="var(--ink-2)">−{maxD}</text>
        <text x={sx(maxX)} y={H - 8} textAnchor="end" fontSize={11} fill="var(--ink-2)">{maxX} missed by baseline</text>
        <text x={pad.l} y={H - 8} fontSize={11} fill="var(--ink-2)">0</text>
        {pts.map((p, i) => {
          const rec = p.state === "recommended";
          return (
            <circle
              key={p.id + i}
              cx={sx(p.x)}
              cy={sy(p.d) + jitter(i) * 0.6}
              r={4}
              fill={rec ? (p.d < 0 ? "var(--danger)" : "var(--copper)") : "none"}
              stroke={rec ? "var(--surface)" : "var(--ink-3)"}
              strokeWidth={rec ? 1 : 1.3}
            >
              <title>{`${p.id.slice(0, 8)}: ${p.state}, saved ${p.d}, baseline missed ${p.x}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-[12px] text-ink-3">
        Each point is one scenario. Above the line, Spareline misses fewer packages than the baseline; below it, more. Filled points are recommended transfers;
        hollow points are abstentions or no-rescue results (always zero change versus doing nothing).
      </figcaption>
    </figure>
  );
}

function LatencyHistogram({ rows }: { rows: EvaluationRow[] }) {
  const values = rows.map((r) => n(r, "duration_ms")).filter((v): v is number => v !== null);
  if (!values.length) return null;
  const max = Math.max(...values);
  const bins = 12;
  const width = Math.max(1, max / bins);
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((v) => {
    counts[Math.min(bins - 1, Math.floor(v / width))] += 1;
  });
  const W = 640;
  const H = 200;
  const pad = { l: 36, r: 12, t: 12, b: 30 };
  const cmax = Math.max(...counts);
  const bw = (W - pad.l - pad.r) / bins;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Distribution of solver wall time per scenario">
        {counts.map((c, i) => {
          const h = (c / cmax) * (H - pad.t - pad.b);
          return (
            <g key={i}>
              <rect x={pad.l + i * bw + 1} y={H - pad.b - h} width={bw - 2} height={h} fill="var(--route-other)" opacity={0.85} rx={2}>
                <title>{`${num((i * width) / 1000, 1)}–${num(((i + 1) * width) / 1000, 1)} s: ${c} runs`}</title>
              </rect>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--ink-3)" />
        <text x={pad.l} y={H - 10} fontSize={11} fill="var(--ink-2)">0 s</text>
        <text x={W - pad.r} y={H - 10} fontSize={11} textAnchor="end" fill="var(--ink-2)">{num(max / 1000, 1)} s</text>
        <text x={pad.l - 6} y={pad.t + 8} fontSize={11} textAnchor="end" fill="var(--ink-2)">{cmax}</text>
      </svg>
      <figcaption className="mt-1 text-[12px] text-ink-3">Solver wall time per scenario on the evaluation machine ({values.length} runs).</figcaption>
    </figure>
  );
}

export function Results() {
  const summary = useEvaluationSummary();
  const hasRun = summary.data && summary.data.status !== "not_run";
  const results = useEvaluationResults(Boolean(hasRun));
  const [baseline, setBaseline] = useState<Baseline>("no_action");
  const [onlyMisses, setOnlyMisses] = useState(false);
  const rows = useMemo(() => results.data ?? [], [results.data]);
  const shown = useMemo(
    () =>
      onlyMisses
        ? rows.filter((r) => (n(r, baseline === "no_action" ? "delta_vs_no_action" : "delta_vs_nearest") ?? 0) <= 0 || s(r, "state") !== "recommended")
        : rows,
    [rows, onlyMisses, baseline],
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Results">
        <a className={buttonClass("secondary")} href={EVALUATION_CSV_URL}>
          Download results CSV
        </a>
        <a className={buttonClass("secondary")} href={METHODOLOGY_JSON_URL}>
          Download methodology JSON
        </a>
        <a className={buttonClass("ghost")} href="/app/methodology#limitations">
          See limitations
        </a>
      </PageHeader>
      <p className="rounded-[10px] border border-warning/50 bg-warning-soft/50 px-4 py-2.5 text-sm font-medium text-warning-ink">
        Research evaluation — not field performance. Historical routes, simulated disruptions, estimated cross-route travel.
      </p>

      {summary.isPending ? <Spinner label="Loading evaluation…" /> : null}
      {summary.isError ? <ErrorState error={summary.error} title="Evaluation results could not be loaded." onRetry={() => void summary.refetch()} /> : null}
      {summary.data && summary.data.status === "not_run" ? (
        <Panel className="p-5">
          <p className="font-medium">No evaluation results yet</p>
          <p className="mt-1 text-sm text-ink-2">The benchmark has not been run against the published cohort, so no numbers are shown.</p>
        </Panel>
      ) : null}

      {summary.data && hasRun ? (
        <>
          <Panel className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Summary</h2>
              <p className="font-mono text-[11.5px] break-all text-ink-3">
                {summary.data.evaluation_id} · {summary.data.algorithm_version} · {utcDateTime(summary.data.completed_at)} · {num(summary.data.scenario_count)} scenarios
              </p>
            </div>
            <dl className="mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2">
              {Object.entries(summary.data.metrics).map(([k, v]) => (
                <div key={k} className="border-t border-line pt-2">
                  <dt className="text-[12.5px] text-ink-2">{humanKey(k)}</dt>
                  <dd className="mt-0.5 text-sm">
                    <MetricValue value={v} />
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-semibold">Packages saved per scenario</h2>
                <div role="radiogroup" aria-label="Baseline" className="ml-auto inline-flex rounded-[8px] border border-line p-0.5">
                  {(
                    [
                      ["no_action", "No intervention"],
                      ["nearest", "Nearest feasible rescuer"],
                    ] as [Baseline, string][]
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={baseline === k}
                      onClick={() => setBaseline(k)}
                      className={`h-9 rounded-[6px] px-2.5 text-[12.5px] ${baseline === k ? "bg-surface font-medium shadow-[0_0_0_1px_var(--line)]" : "text-ink-2"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {results.isPending ? <Spinner label="Loading rows…" /> : <DeltaScatter rows={rows} baseline={baseline} />}
            </Panel>
            <Panel className="p-4">
              <h2 className="mb-3 text-[16px] font-semibold">Solver latency</h2>
              <LatencyHistogram rows={rows} />
            </Panel>
          </div>

          <Panel className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[16px] font-semibold">Per-scenario records</h2>
              <label className="ml-auto flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyMisses} onChange={(e) => setOnlyMisses(e.target.checked)} className="h-4 w-4" />
                Show only misses, abstentions and zero-gain cases
              </label>
            </div>
            {results.isError ? <ErrorState error={results.error} title="Rows could not be loaded." onRetry={() => void results.refetch()} /> : null}
            <div className="mt-3 max-h-[640px] overflow-auto rounded-[10px] border border-line">
              <table className="w-full min-w-[820px] text-left text-[12.5px]">
                <thead className="sticky top-0 bg-surface text-[12px] text-ink-2">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Scenario</th>
                    <th scope="col" className="px-3 py-2 font-medium">Depot / date</th>
                    <th scope="col" className="px-3 py-2 font-medium">Shock</th>
                    <th scope="col" className="px-3 py-2 font-medium">Decision</th>
                    <th scope="col" className="px-3 py-2 font-medium">Missed: none / nearest / Spareline</th>
                    <th scope="col" className="px-3 py-2 font-medium">Δ vs {baseline === "no_action" ? "none" : "nearest"}</th>
                    <th scope="col" className="px-3 py-2 font-medium">Helper newly late (nearest / Spareline)</th>
                    <th scope="col" className="px-3 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {shown.map((r, i) => {
                    const delta = n(r, baseline === "no_action" ? "delta_vs_no_action" : "delta_vs_nearest");
                    const codes = Array.isArray(r.reason_codes) ? (r.reason_codes as string[]) : [];
                    return (
                      <tr key={s(r, "scenario_id") + i} className="border-t border-line align-top">
                        <td className="px-3 py-2">
                          <details>
                            <summary className="cursor-pointer font-mono text-[11.5px]">{s(r, "scenario_id").slice(0, 10) || `row ${i + 1}`}</summary>
                            <pre className="mt-2 max-w-[520px] overflow-auto rounded-[8px] bg-surface p-2 text-[11px]">{JSON.stringify(r, null, 2)}</pre>
                          </details>
                        </td>
                        <td className="px-3 py-2">
                          {s(r, "station_code")} {s(r, "date")}
                          <span className="block text-ink-3">{s(r, "partition")}</span>
                        </td>
                        <td className="px-3 py-2">
                          {s(r, "shock_kind")}
                          <span className="block text-ink-3">
                            {n(r, "delay_minutes") ? `${n(r, "delay_minutes")} min ` : ""}
                            {(n(r, "travel_time_factor") ?? 1) > 1 ? `×${n(r, "travel_time_factor")}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {s(r, "state").replace(/_/g, " ")}
                          {codes.length ? <span className="block max-w-[220px] text-ink-3">{codes.map(reasonLabel).join(" ")}</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          {num(n(r, "missed_no_action"))} / {num(n(r, "missed_nearest"))} / {num(n(r, "missed_spareline"))}
                        </td>
                        <td className={`px-3 py-2 font-medium ${delta !== null && delta < 0 ? "text-danger" : delta ? "text-copper-ink" : "text-ink-3"}`}>
                          {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                        </td>
                        <td className="px-3 py-2">
                          {num(n(r, "helper_newly_missed_nearest"))} / {num(n(r, "helper_newly_missed_spareline"))}
                        </td>
                        <td className="px-3 py-2">{n(r, "duration_ms") !== null ? `${num((n(r, "duration_ms") ?? 0) / 1000, 1)} s` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-ink-3">Δ is packages saved: positive means Spareline missed fewer packages than the selected baseline on the same scenario.</p>
          </Panel>

          {summary.data.limitations.length ? (
            <Panel className="p-4" >
              <h2 id="limitations" className="text-[16px] font-semibold">Limitations</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
                {summary.data.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
