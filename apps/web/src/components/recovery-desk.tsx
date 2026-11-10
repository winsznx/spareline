"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { isTerminal, num, utcTime } from "@/lib/format";
import { buildScene } from "@/lib/geometry";
import { keys, useRun, useScenario } from "@/lib/queries";

import { DecisionPane } from "./decision";
import { RouteMap } from "./route-map";
import { ScenarioControls, toScenarioCreate, type Controls } from "./scenario-controls";
import { StopTable } from "./stop-table";
import { Badge, Button, ErrorState, Panel, ProvenanceChip, Spinner } from "./ui";

type MobileView = "map" | "decision" | "stops";
type PolicyView = "no_intervention" | "nearest_feasible" | "spareline";

const POLICY_TABS: { key: PolicyView; label: string }[] = [
  { key: "no_intervention", label: "Do nothing" },
  { key: "nearest_feasible", label: "Nearest helper" },
  { key: "spareline", label: "Spareline" },
];

export function RecoveryDesk({ scenarioId }: { scenarioId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const scenarioQ = useScenario(scenarioId);
  const scenario = scenarioQ.data;
  const runId = search.get("run") ?? scenario?.latest_run_id ?? null;
  const runQ = useRun(runId);
  const run = runQ.data;

  const [mobileView, setMobileView] = useState<MobileView>("decision");
  const [centerView, setCenterView] = useState<"map" | "list">("map");
  const [policyView, setPolicyView] = useState<PolicyView | null>(null);

  const recalc = useMutation({
    mutationFn: async ({ controls, changed }: { controls: Controls; changed: boolean }) => {
      if (!scenario) throw new Error("Scenario not loaded");
      const target = changed ? await api.createScenario(toScenarioCreate(scenario, controls)) : scenario;
      const started = await api.startRun(target.id);
      return { scenarioId: target.id, run: started };
    },
    onSuccess: ({ scenarioId: sid, run: started }) => {
      qc.setQueryData(keys.run(started.run_id), started);
      void qc.invalidateQueries({ queryKey: keys.scenarios });
      setPolicyView(null);
      setMobileView("decision");
      router.replace(`/app/recovery/${sid}?run=${started.run_id}`, { scroll: false });
    },
  });

  const running = recalc.isPending || (run !== undefined && !isTerminal(run.state));
  const terminalRun = run && isTerminal(run.state) ? run : null;
  const effectivePolicy: PolicyView | undefined = terminalRun?.timelines ? policyView ?? undefined : undefined;
  const scene = useMemo(
    () => (scenario ? buildScene(scenario, terminalRun, effectivePolicy) : null),
    [scenario, terminalRun, effectivePolicy],
  );

  if (scenarioQ.isPending) return <Spinner label="Loading scenario…" />;
  if (scenarioQ.isError || !scenario || !scene) {
    return <ErrorState title="This scenario could not be loaded." error={scenarioQ.error} onRetry={() => void scenarioQ.refetch()} />;
  }

  const donor = scenario.vehicles.find((v) => v.route_id === scenario.donor_route_id);
  const base = terminalRun?.comparisons?.no_intervention;
  const shownPolicy = scene.policy;
  const show = (v: MobileView) => (mobileView === v ? "block" : "hidden md:block");

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.035em] md:text-[34px]">Recovery desk</h1>
            {scenario.curated ? <Badge tone="neutral">Curated scenario</Badge> : <Badge tone="neutral">Session scenario</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-ink-2">
            {scenario.title ?? "Custom scenario"} · {donor?.label ?? "Late van"} is the late route · station {scenario.group.station_code},{" "}
            {scenario.group.date_utc} · cutoff {utcTime(scenario.cutoff_utc)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ProvenanceChip kind="HISTORICAL ROUTES" title="Amazon Last Mile Routing Research Challenge, 2018, CC BY-NC 4.0" />
          <ProvenanceChip kind="SIMULATED DELAY" title="The disruption is injected for this replay; it did not happen historically." />
        </div>
      </div>

      {base ? (
        <dl className="tnum mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-[12px] border border-line px-4 py-3 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-ink-2">Missed if nobody helps</dt>
            <dd className="text-lg font-semibold text-danger">
              {num(base.missed_total)} <span className="text-sm font-normal text-ink-3">/ {num(base.packages_total)} packages</span>
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-2">Windowed packages late</dt>
            <dd className="text-lg font-semibold">
              {base.windowed_total ? `${num(base.windowed_late)} / ${num(base.windowed_total)}` : "No windows"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-2">Helpers considered</dt>
            <dd className="text-lg font-semibold">{num(scenario.vehicles.length - 1 - (scenario.excluded_helper_route_ids?.length ?? 0))}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-2">Solver time</dt>
            <dd className="text-lg font-semibold">{terminalRun?.duration_ms != null ? `${(terminalRun.duration_ms / 1000).toFixed(1)} s` : "—"}</dd>
          </div>
        </dl>
      ) : null}

      <div
        role="tablist"
        aria-label="Recovery desk views"
        className="no-print mt-4 grid grid-cols-3 rounded-[10px] border border-line p-1 md:hidden"
      >
        {(["map", "decision", "stops"] as MobileView[]).map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={mobileView === v}
            onClick={() => setMobileView(v)}
            className={`h-10 rounded-[7px] text-sm capitalize ${mobileView === v ? "bg-surface font-medium shadow-[0_0_0_1px_var(--line)]" : "text-ink-2"}`}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_400px]">
        <Panel className={`order-2 min-w-0 p-4 md:order-none md:row-span-2 xl:row-span-1 ${show("decision")}`}>
          <h2 className="mb-4 text-[18px] font-semibold tracking-[-0.02em]">Scenario</h2>
          <ScenarioControls key={scenario.id} scenario={scenario} busy={running} onSubmit={(controls, changed) => recalc.mutate({ controls, changed })} />
        </Panel>

        <Panel className={`min-w-0 overflow-hidden ${mobileView === "decision" ? "hidden md:block" : "block"}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {terminalRun?.timelines ? (
              <div role="radiogroup" aria-label="Plan shown on map" className="inline-flex rounded-[8px] border border-line p-0.5">
                {POLICY_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={shownPolicy === t.key}
                    onClick={() => setPolicyView(t.key)}
                    className={`h-9 rounded-[6px] px-2.5 text-[12.5px] ${shownPolicy === t.key ? "bg-surface font-medium shadow-[0_0_0_1px_var(--line)]" : "text-ink-2"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-[12.5px] text-ink-2">Historical sequence after cutoff</span>
            )}
            <div className="ml-auto hidden md:inline-flex rounded-[8px] border border-line p-0.5" role="radiogroup" aria-label="Map or list">
              {(["map", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={centerView === v}
                  onClick={() => setCenterView(v)}
                  className={`h-9 rounded-[6px] px-3 text-[12.5px] capitalize ${centerView === v ? "bg-surface font-medium shadow-[0_0_0_1px_var(--line)]" : "text-ink-2"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className={`${mobileView === "map" ? "block" : "hidden"} ${centerView === "map" ? "md:block" : "md:hidden"}`}>
            <RouteMap scene={scene} className="h-[420px] md:h-[520px] xl:h-[min(62vh,640px)]" />
            <MapLegend />
          </div>
          <div className={`p-3 ${mobileView === "stops" ? "block" : "hidden"} ${centerView === "list" ? "md:block" : "md:hidden"}`}>
            <StopTable scene={scene} scenario={scenario} />
          </div>
        </Panel>

        <Panel className={`order-1 min-w-0 p-4 md:order-none md:col-start-2 xl:col-start-auto ${show("decision")}`}>
          <h2 className="mb-3 text-[18px] font-semibold tracking-[-0.02em]">Decision</h2>
          <div aria-live="polite">
            <DecisionPane
              run={recalc.isPending ? null : run}
              runError={recalc.error ?? runQ.error}
              scenario={scenario}
              running={running}
              onRetry={() => {
                recalc.reset();
                void runQ.refetch();
              }}
            />
          </div>
        </Panel>
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 p-3 backdrop-blur md:hidden">
        {terminalRun?.state === "recommended" ? (
          <Button variant="primary" className="w-full" onClick={() => router.push(`/app/manifests/${terminalRun.run_id}`)}>
            Review handoff
          </Button>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={running}
            onClick={() => recalc.mutate({ controls: { donor: scenario.donor_route_id, delay: scenario.shock.delay_minutes, factor: scenario.shock.travel_time_factor, failure: scenario.shock.kind === "vehicle_failure", excluded: scenario.excluded_helper_route_ids ?? [] }, changed: false })}
          >
            {running ? "Calculating…" : "Recalculate rescue"}
          </Button>
        )}
      </div>
    </div>
  );
}

function MapLegend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line px-3 py-2.5 text-[12px] text-ink-2">
      <li className="flex items-center gap-2">
        <svg width="26" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="26" y2="3" stroke="var(--route-donor)" strokeWidth="3" />
        </svg>
        Late van (solid)
      </li>
      <li className="flex items-center gap-2">
        <svg width="26" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="26" y2="3" stroke="var(--route-helper)" strokeWidth="3" strokeDasharray="6 4" />
        </svg>
        Helper (dashed)
      </li>
      <li className="flex items-center gap-2">
        <svg width="26" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="26" y2="3" stroke="var(--route-other)" strokeWidth="2" strokeDasharray="2 3" />
        </svg>
        Other vans (dotted)
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-danger" />
        Projected miss
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-copper ring-2 ring-graphite" />
        Handoff point
      </li>
    </ul>
  );
}
