"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { RunStatus, Scenario, TimelineStop } from "@/lib/api-types";
import { num, reasonLabel, signed, utcTime } from "@/lib/format";
import { buildScene } from "@/lib/geometry";
import { useRun, useScenario, useScenarios } from "@/lib/queries";

import { RouteSchematic } from "./route-schematic";
import { Badge, ButtonLink, ErrorState, Metric, PageHeader, Panel, ProvenanceChip, RunStateBadge, Spinner } from "./ui";

type VanStatus = { label: "On time" | "At risk" | "Rescue candidate" | "Unrecoverable"; tone: "success" | "warning" | "copper" | "danger" };

function missedByVehicle(timeline: TimelineStop[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of timeline ?? []) {
    const missed = t.after_shift ? t.package_count : t.late_windowed;
    if (missed) m.set(t.vehicle, (m.get(t.vehicle) ?? 0) + missed);
  }
  return m;
}

function vanStatus(routeId: string, scenario: Scenario, run: RunStatus | undefined, missed: Map<string, number>): VanStatus {
  if (run?.solution?.helper_route_id === routeId) return { label: "Rescue candidate", tone: "copper" };
  const n = missed.get(routeId) ?? 0;
  if (n === 0) return { label: "On time", tone: "success" };
  if (routeId === scenario.donor_route_id && (run?.state === "no_safe_rescue" || run?.state === "low_confidence")) {
    return { label: "Unrecoverable", tone: "danger" };
  }
  return { label: "At risk", tone: "warning" };
}

export function Overview() {
  const list = useScenarios();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const scenarios = list.data ?? [];
  const activeId = selected ?? scenarios.find((s) => s.curated)?.id ?? scenarios[0]?.id ?? null;
  const scenarioQ = useScenario(activeId);
  const scenario = scenarioQ.data;
  const runQ = useRun(scenario?.latest_run_id);
  const run = runQ.data;
  const missed = useMemo(() => missedByVehicle(run?.timelines?.no_intervention), [run]);
  const scene = useMemo(() => (scenario ? buildScene(scenario, run) : null), [scenario, run]);

  if (list.isPending) return <Spinner label="Loading scenarios…" />;
  if (list.isError) return <ErrorState title="Scenarios could not be loaded." error={list.error} onRetry={() => void list.refetch()} />;
  if (!scenarios.length) {
    return (
      <Panel className="p-6">
        <p className="font-medium">Choose a historical route group to start a replay.</p>
        <p className="mt-1 text-sm text-ink-2">No scenarios are available from the API yet.</p>
      </Panel>
    );
  }

  const base = run?.comparisons?.no_intervention;
  const best = run?.comparisons?.spareline;
  const vans = (scenario?.vehicles ?? []).filter((v) => {
    const q = filter.trim().toLowerCase();
    return !q || v.label.toLowerCase().includes(q) || v.short_id.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dispatch overview"
        meta={
          scenario ? (
            <span>
              Station {scenario.group.station_code} · {scenario.group.date_utc} · {scenario.vehicles.length} vans in this route group
            </span>
          ) : null
        }
      >
        <label className="flex flex-col text-[12px] text-ink-2">
          Depot and date
          <select
            value={activeId ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 h-11 max-w-[320px] rounded-[8px] border border-line bg-raised px-3 text-sm text-ink"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.curated ? "★ " : ""}
                {s.title ?? "Session scenario"} · {s.group.station_code} {s.group.date_utc}
              </option>
            ))}
          </select>
        </label>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        <ProvenanceChip kind="HISTORICAL ROUTES" />
        <ProvenanceChip kind="RECONSTRUCTED" />
        <ProvenanceChip kind="SIMULATED DELAY" />
      </div>

      {scenarioQ.isError ? <ErrorState title="This scenario could not be loaded." error={scenarioQ.error} onRetry={() => void scenarioQ.refetch()} /> : null}
      {!scenario ? <Spinner label="Loading scenario…" /> : null}

      {scenario ? (
        <>
          <Panel className="grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
            <Metric
              label="At-risk deliveries"
              value={base ? num(base.missed_total) : "—"}
              hint={base ? `of ${num(base.packages_total)} remaining packages, if nobody helps` : "Run the scenario to project"}
              tone={base && base.missed_total > 0 ? "danger" : undefined}
            />
            <Metric
              label="Candidate help"
              value={run?.solution ? scenario.vehicles.find((v) => v.route_id === run.solution?.helper_route_id)?.label ?? "—" : run ? "None safe" : "—"}
              hint={run ? <RunStateBadge state={run.state} /> : "No run yet"}
            />
            <Metric
              label="Extra driving"
              value={best && best.transfer ? `${signed(best.extra_drive_minutes)} min` : "—"}
              hint={best?.transfer ? "Added across both vans, model estimate" : "No transfer recommended"}
            />
            <Metric label="Scenario clock" value={utcTime(scenario.cutoff_utc).replace(" UTC", "")} hint="UTC cutoff of the historical replay" />
          </Panel>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel>
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Routes</h2>
                <label className="ml-auto">
                  <span className="sr-only">Filter routes</span>
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter vans"
                    className="h-10 w-40 rounded-[8px] border border-line bg-raised px-3 text-[13px]"
                  />
                </label>
              </div>
              <ul className="divide-y divide-line">
                {vans.map((v) => {
                  const st = vanStatus(v.route_id, scenario, run, missed);
                  return (
                    <li key={v.route_id}>
                      <Link
                        href={`/app/recovery/${scenario.id}${scenario.latest_run_id ? `?run=${scenario.latest_run_id}` : ""}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-surface"
                      >
                        <div className="min-w-[140px]">
                          <p className="font-medium">
                            {v.label}
                            {v.route_id === scenario.donor_route_id ? <span className="ml-2 text-[12px] font-normal text-warning-ink">simulated delay</span> : null}
                          </p>
                          <p className="font-mono text-[11.5px] text-ink-3">{v.short_id}</p>
                        </div>
                        <div className="tnum flex flex-1 flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
                          <span>
                            {v.completed_stops} done · {v.remaining_stops} left
                          </span>
                          <span>{num(v.remaining_packages)} packages</span>
                          <span>Shift limit {utcTime(v.duty_end_utc)}</span>
                          {missed.get(v.route_id) ? <span className="text-danger">{missed.get(v.route_id)} projected misses</span> : null}
                        </div>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel className="p-4">
              <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Current issue</h2>
              {run ? (
                <div className="mt-2 space-y-3 text-sm text-ink-2">
                  <p>
                    {scenario.vehicles.find((v) => v.route_id === scenario.donor_route_id)?.label} carries a simulated disruption
                    {scenario.shock.delay_minutes ? ` of ${scenario.shock.delay_minutes} minutes` : ""}
                    {scenario.shock.travel_time_factor > 1 ? ` with traffic ×${scenario.shock.travel_time_factor.toFixed(2)}` : ""}
                    {scenario.shock.kind === "vehicle_failure" ? " and cannot continue" : ""}.
                    {base ? ` If nobody helps, ${num(base.missed_total)} packages are projected to miss.` : ""}
                  </p>
                  {run.state === "recommended" && run.solution ? (
                    <p className="text-ink">
                      Spareline found a handoff to {scenario.vehicles.find((v) => v.route_id === run.solution?.helper_route_id)?.label} that brings
                      misses to {num(best?.missed_total)}.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {run.reason_codes.map((c) => (
                        <li key={c}>{reasonLabel(c)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-2">This scenario has no completed run yet.</p>
              )}
              {scene ? (
                <div className="mt-4 h-[220px] overflow-hidden rounded-[10px] border border-line">
                  <RouteSchematic scene={scene} compact title="Spatial schematic of the route group" />
                </div>
              ) : null}
              <ButtonLink
                href={`/app/recovery/${scenario.id}${scenario.latest_run_id ? `?run=${scenario.latest_run_id}` : ""}`}
                variant="primary"
                className="mt-4 w-full"
              >
                Inspect rescue
              </ButtonLink>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}
