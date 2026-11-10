"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { RunStatus, Scenario, TimelineStop } from "@/lib/api-types";
import { num, POLICY_LABEL, reasonLabel, signed, utcDateTime, utcTime } from "@/lib/format";
import { buildScene, vehicleLabel } from "@/lib/geometry";
import { useEvaluationSummary, useRun, useScenario, useScenarios } from "@/lib/queries";

import { RouteMap } from "./route-map";
import { RouteSchematic } from "./route-schematic";
import { buttonClass, Spinner } from "./ui";

interface Featured {
  scenario: Scenario | undefined;
  run: RunStatus | undefined;
  loading: boolean;
  failed: boolean;
}

/** The first curated scenario is the published "rescuable delay" judge path. */
function useFeatured(): Featured {
  const list = useScenarios();
  const pick = list.data?.find((s) => s.curated);
  const scenarioQ = useScenario(pick?.id);
  const runQ = useRun(scenarioQ.data?.latest_run_id);
  return {
    scenario: scenarioQ.data,
    run: runQ.data,
    loading: list.isPending || (Boolean(pick) && scenarioQ.isPending) || (Boolean(scenarioQ.data?.latest_run_id) && runQ.isPending),
    failed: list.isError || scenarioQ.isError || runQ.isError,
  };
}

function Offline({ dark = false }: { dark?: boolean }) {
  return (
    <p className={`text-sm ${dark ? "text-[#A7B2BD]" : "text-ink-2"}`}>
      Live replay data is unavailable because the Spareline API did not respond.{" "}
      <Link className="underline underline-offset-2" href="/app">
        Open the recovery desk
      </Link>
    </p>
  );
}

function shockSentence(s: Scenario): string {
  if (s.shock.kind === "vehicle_failure") return "stops working";
  const parts = [];
  if (s.shock.delay_minutes) parts.push(`is ${s.shock.delay_minutes} minutes behind plan`);
  if (s.shock.travel_time_factor > 1) parts.push(`drives in traffic ×${s.shock.travel_time_factor.toFixed(2)}`);
  return parts.join(" and ") || "has no disruption";
}

/* ---------------------------------------------------------------- 1. Hero */

export function HeroReplay() {
  const { scenario, run, loading, failed } = useFeatured();
  const scene = useMemo(() => (scenario ? buildScene(scenario, run) : null), [scenario, run]);
  if (failed) return <Offline />;
  if (loading || !scenario || !scene) return <Spinner label="Loading a historical replay…" />;
  const base = run?.comparisons?.no_intervention;
  const best = run?.comparisons?.spareline;
  const donor = scenario.vehicles.find((v) => v.route_id === scenario.donor_route_id);
  return (
    <figure className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <RouteSchematic scene={scene} width={720} height={560} title={`Replay of ${scenario.vehicles.length} historical routes from station ${scenario.group.station_code}`} />
      </div>
      <figcaption className="tnum mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-line pt-3 text-[13px] text-ink-2">
        <span>
          Station {scenario.group.station_code}, {scenario.group.date_utc}
        </span>
        <span>
          {donor?.label} {shockSentence(scenario)} <span className="text-warning-ink">(simulated)</span>
        </span>
        {base && best ? (
          <span className="text-ink">
            Missed packages <span className="text-danger">{num(base.missed_total)}</span> → <span className="font-semibold text-copper-ink">{num(best.missed_total)}</span>
          </span>
        ) : null}
        <Link className="ml-auto font-medium text-copper-ink underline-offset-2 hover:underline" href={`/app/recovery/${scenario.id}${run ? `?run=${run.run_id}` : ""}`}>
          Open this replay
        </Link>
      </figcaption>
    </figure>
  );
}

/* ---------------------------------------------------- 2. The failing moment */

interface Lane {
  key: string;
  label: string;
  sub: string;
  stops: TimelineStop[];
  dutyEnd: number;
  delayFrom?: number;
  delayTo?: number;
  helperColor?: boolean;
}

const t = (iso: string) => new Date(iso).getTime();

function LaneChart({ lanes, start, end, meeting }: { lanes: Lane[]; start: number; end: number; meeting: number | null }) {
  const W = 1100;
  const labelW = 0;
  const laneH = 74;
  const top = 28;
  const H = top + lanes.length * laneH + 8;
  const x = (ms: number) => labelW + ((ms - start) / (end - start)) * (W - labelW);
  const hours: number[] = [];
  const h0 = Math.ceil(start / 3_600_000) * 3_600_000;
  for (let h = h0; h <= end; h += 3_600_000) hours.push(h);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected stop times for each van, with shift limits">
      {hours.map((h) => (
        <g key={h}>
          <line x1={x(h)} x2={x(h)} y1={top - 6} y2={H} stroke="var(--line)" />
          <text x={x(h) + 4} y={top - 12} fontSize={12} fontFamily="var(--font-mono)" fill="var(--ink-3)">
            {utcTime(new Date(h).toISOString()).replace(" UTC", "")}
          </text>
        </g>
      ))}
      {lanes.map((lane, i) => {
        const y = top + i * laneH;
        const mid = y + laneH / 2 + 8;
        return (
          <g key={lane.key}>
            <text x={4} y={y + 18} fontSize={14}>
              <tspan fontWeight={600} fill="var(--ink)">
                {lane.label}
              </tspan>
              <tspan dx={10} fontSize={12.5} fill="var(--ink-2)">
                {lane.sub}
              </tspan>
            </text>
            <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--line)" strokeWidth={1} />
            {lane.delayFrom !== undefined && lane.delayTo !== undefined ? (
              <g>
                <rect x={x(lane.delayFrom)} y={mid - 12} width={Math.max(2, x(lane.delayTo) - x(lane.delayFrom))} height={24} fill="var(--warning-soft)" stroke="var(--warning)" strokeDasharray="3 3" />
                <text x={x(lane.delayFrom) + 6} y={mid + 4} fontSize={11.5} fill="var(--warning-ink)">
                  behind plan (simulated)
                </text>
              </g>
            ) : null}
            {lane.stops.map((s) => {
              const missed = s.after_shift || s.late_windowed > 0;
              const cx = x(t(s.service_start_utc));
              const color = missed ? "var(--danger)" : s.transferred ? "var(--copper)" : lane.helperColor ? "var(--route-helper)" : "var(--ink)";
              return <line key={`${s.route_id}${s.stop_id}`} x1={cx} x2={cx} y1={mid - (missed ? 11 : 7)} y2={mid + (missed ? 11 : 7)} stroke={color} strokeWidth={missed ? 2 : 1.4} opacity={missed || s.transferred ? 1 : 0.55} />;
            })}
            <line x1={x(lane.dutyEnd)} x2={x(lane.dutyEnd)} y1={mid - 22} y2={mid + 22} stroke="var(--danger)" strokeWidth={2} />
            <text x={x(lane.dutyEnd) - 6} y={mid + 34} textAnchor="end" fontSize={11.5} fill="var(--danger)">
              shift limit
            </text>
            {meeting !== null && i > 0 ? <circle cx={x(meeting)} cy={mid} r={6} fill="var(--copper)" stroke="var(--canvas)" strokeWidth={2} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function FailingMoment() {
  const { scenario, run, loading, failed } = useFeatured();
  const [withRescue, setWithRescue] = useState(false);
  if (failed) return <Offline />;
  if (loading || !scenario || !run?.timelines || !run.comparisons) return <Spinner label="Loading the replay timeline…" />;
  const donor = scenario.vehicles.find((v) => v.route_id === scenario.donor_route_id);
  const helperId = run.solution?.helper_route_id ?? run.comparisons.nearest_feasible.helper_route_id ?? scenario.vehicles.find((v) => v.route_id !== scenario.donor_route_id)?.route_id;
  const helper = scenario.vehicles.find((v) => v.route_id === helperId);
  if (!donor || !helper) return null;
  const policy = withRescue && run.solution ? "spareline" : "no_intervention";
  const tl = run.timelines[policy];
  const cutoff = t(scenario.cutoff_utc);
  const delayMs = scenario.shock.delay_minutes * 60_000;
  const lanes: Lane[] = [
    {
      key: "donor",
      label: donor.label,
      sub: policy === "spareline" ? "keeps its own stops, hands the rest over" : "runs every remaining stop alone",
      stops: tl.filter((s) => s.vehicle === donor.route_id),
      dutyEnd: t(donor.duty_end_utc),
      // Work the van had planned for the last X minutes is still ahead of it.
      delayFrom: delayMs ? cutoff - delayMs : undefined,
      delayTo: delayMs ? cutoff : undefined,
    },
    {
      key: "helper",
      label: helper.label,
      sub: policy === "spareline" ? "takes the transferred stops" : "on its own route",
      stops: tl.filter((s) => s.vehicle === helper.route_id),
      dutyEnd: t(helper.duty_end_utc),
      helperColor: true,
    },
  ];
  const all = lanes.flatMap((l) => [...l.stops.map((s) => t(s.service_start_utc)), l.dutyEnd]);
  const start = cutoff - 15 * 60_000;
  const end = Math.max(...all) + 25 * 60_000;
  const c = run.comparisons;
  const missedDonor = lanes[0].stops.filter((s) => s.after_shift || s.late_windowed > 0).length;

  return (
    <div>
      <p className="max-w-[760px] text-[17px] leading-[1.55] text-ink-2">
        At {utcTime(scenario.cutoff_utc)} on {scenario.group.date_utc}, {donor.label} {shockSentence(scenario)}. With{" "}
        {donor.remaining_stops} stops left, {missedDonor} of them now land after its shift limit or outside a promised window.{" "}
        {helper.label} is nearby with {helper.remaining_stops} stops of its own.
      </p>
      <div className="mt-8 overflow-x-auto">
        <div className="min-w-[680px]">
          <LaneChart lanes={lanes} start={start} end={end} meeting={policy === "spareline" && run.solution ? t(run.solution.meeting_time_utc) : null} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-[15px]">
        <span>
          <span className="text-ink-2">Do nothing</span> <strong className="tnum text-danger">{num(c.no_intervention.missed_total)}</strong> missed
        </span>
        <span>
          <span className="text-ink-2">Send the nearest van</span> <strong className="tnum">{num(c.nearest_feasible.missed_total)}</strong> missed
        </span>
        <span>
          <span className="text-ink-2">Plan the handoff</span> <strong className="tnum text-copper-ink">{num(c.spareline.missed_total)}</strong> missed,{" "}
          {num(c.spareline.helper_newly_missed)} new on {helper.label}
        </span>
        {run.solution ? (
          <button
            type="button"
            onClick={() => setWithRescue((v) => !v)}
            aria-pressed={withRescue}
            className={buttonClass(withRescue ? "primary" : "secondary", "md", "ml-auto")}
          >
            {withRescue ? "Show without help" : "Show with the handoff"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- 3. How it works */

const STEPS = [
  {
    title: "Detect the threatened windows",
    body: "Replay every van from its historical stop sequence to the cutoff, apply the simulated delay, and project which packages would miss their window or the end of the shift.",
  },
  {
    title: "Test the handoff under real limits",
    body: "For each helper, try meeting points and whole-stop package groups. Check van capacity, both drivers' remaining windows and shift limits, then re-check with slower transfer travel.",
  },
  {
    title: "Send revised manifests",
    body: "If a transfer is safe, both drivers get a revised stop list and a meeting time. If none is, Spareline says why and issues nothing.",
  },
];

function StepArtifact({ step, scenario, run }: { step: number; scenario: Scenario; run: RunStatus }) {
  const c = run.comparisons;
  if (!c) return null;
  if (step === 0) {
    const donor = scenario.vehicles.find((v) => v.route_id === scenario.donor_route_id);
    return (
      <dl className="tnum grid grid-cols-2 gap-x-8 gap-y-6">
        <div>
          <dt className="text-[13px] text-ink-2">{donor?.label} stops still to deliver</dt>
          <dd className="mt-1 text-[44px] leading-none font-semibold tracking-[-0.04em]">{num(donor?.remaining_stops)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Packages projected to miss</dt>
          <dd className="mt-1 text-[44px] leading-none font-semibold tracking-[-0.04em] text-danger">{num(c.no_intervention.missed_total)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Windowed packages late</dt>
          <dd className="mt-1 text-[28px] font-semibold">
            {num(c.no_intervention.windowed_late)} <span className="text-[16px] font-normal text-ink-3">of {num(c.no_intervention.windowed_total)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Remaining packages in the group</dt>
          <dd className="mt-1 text-[28px] font-semibold">{num(c.no_intervention.packages_total)}</dd>
        </div>
      </dl>
    );
  }
  if (step === 1) {
    const rows = [c.no_intervention, c.nearest_feasible, c.spareline];
    return (
      <table className="tnum w-full text-left text-[15px]">
        <caption className="sr-only">Policy comparison from a live run</caption>
        <thead className="text-[12.5px] text-ink-2">
          <tr>
            <th scope="col" className="pb-2 font-medium">Policy</th>
            <th scope="col" className="pb-2 font-medium">Missed</th>
            <th scope="col" className="pb-2 font-medium">New misses on helper</th>
            <th scope="col" className="pb-2 font-medium">Added driving</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.policy} className="border-t border-line">
              <th scope="row" className={`py-3 font-medium ${r.policy === "spareline" ? "text-copper-ink" : ""}`}>
                {POLICY_LABEL[r.policy]}
              </th>
              <td className="py-3">{num(r.missed_total)}</td>
              <td className={`py-3 ${(r.helper_newly_missed ?? 0) > 0 ? "text-danger" : ""}`}>{r.transfer ? num(r.helper_newly_missed) : "—"}</td>
              <td className="py-3">{r.transfer ? `${signed(r.extra_drive_minutes)} min` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const sol = run.solution;
  if (!sol) return <p className="text-[15px] text-ink-2">No safe transfer: {run.reason_codes.map(reasonLabel).join(" ")} No manifest is issued.</p>;
  return (
    <div>
      <p className="text-[15px] text-ink-2">
        {vehicleLabel(scenario, sol.donor_route_id)} hands {sol.transfer_package_count} packages to {vehicleLabel(scenario, sol.helper_route_id)} at stop{" "}
        <span className="font-mono text-ink">{sol.meeting.stop_id}</span>, {utcTime(sol.meeting_time_utc)}.
      </p>
      <ol className="tnum mt-4 divide-y divide-line border-y border-line font-mono text-[13px]">
        {sol.transfer.slice(0, 5).map((s) => (
          <li key={s.stop_id} className="flex justify-between py-2">
            <span>{s.stop_id}</span>
            <span className="text-ink-2">
              {s.package_count} pkg · #{s.old_position} → <span className="text-copper-ink">#{s.new_position}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12.5px] text-ink-3">First 5 of {sol.transfer.length} transferred stops, from the helper&apos;s revised manifest.</p>
    </div>
  );
}

export function HowItWorks() {
  const { scenario, run, failed } = useFeatured();
  const [step, setStep] = useState(0);
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
      <ol className="space-y-1" aria-label="Rescue steps">
        {STEPS.map((s, i) => {
          const active = i === step;
          return (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-pressed={active}
                className={`grid w-full grid-cols-[48px_minmax(0,1fr)] gap-3 border-l-2 py-4 pr-2 pl-4 text-left transition-colors duration-200 ${active ? "border-copper" : "border-line hover:border-ink-3"}`}
              >
                <span className={`tnum font-mono text-[28px] leading-none ${active ? "text-copper-ink" : "text-ink-3"}`}>{i + 1}</span>
                <span>
                  <span className={`block text-[20px] leading-snug font-semibold tracking-[-0.025em] ${active ? "text-ink" : "text-ink-2"}`}>{s.title}</span>
                  {active ? <span className="mt-2 block text-[15px] leading-relaxed text-ink-2">{s.body}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="self-center" aria-live="polite">
        <p className="mb-4 text-[12.5px] text-ink-3">Output of the live run for step {step + 1}</p>
        {failed ? <Offline /> : scenario && run ? <StepArtifact step={step} scenario={scenario} run={run} /> : <Spinner label="Loading the live run…" />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------- 4. Inside the desk */

export function DeskMap() {
  const { scenario, run, loading, failed } = useFeatured();
  const scene = useMemo(() => (scenario ? buildScene(scenario, run) : null), [scenario, run]);
  if (failed) return <div className="grid h-full place-items-center bg-graphite p-6"><Offline dark /></div>;
  if (loading || !scenario || !scene) return <div className="grid h-full place-items-center bg-graphite text-[#A7B2BD]">Loading the recovery desk…</div>;
  return <RouteMap scene={scene} className="h-full w-full" />;
}

export function DeskDecision() {
  const { scenario, run } = useFeatured();
  if (!scenario || !run?.comparisons) return null;
  const c = run.comparisons;
  const sol = run.solution;
  return (
    <div className="space-y-4 text-[14px]">
      <p className="text-[18px] leading-snug font-semibold tracking-[-0.02em]">
        {sol ? "Transfer may preserve more delivery windows." : "No safe rescue under these conditions."}
      </p>
      {sol ? (
        <p className="text-ink-2">
          Move {sol.transfer.length} stops from {vehicleLabel(scenario, sol.donor_route_id)} to {vehicleLabel(scenario, sol.helper_route_id)}, meeting at{" "}
          <span className="font-mono text-ink">{sol.meeting.stop_id}</span> around {utcTime(sol.meeting_time_utc)}.
        </p>
      ) : null}
      <dl className="tnum grid grid-cols-3 gap-3 border-y border-line py-3">
        <div>
          <dt className="text-[12px] text-ink-2">Do nothing</dt>
          <dd className="text-[22px] font-semibold text-danger">{num(c.no_intervention.missed_total)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-2">Nearest van</dt>
          <dd className="text-[22px] font-semibold">{num(c.nearest_feasible.missed_total)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-2">Spareline</dt>
          <dd className="text-[22px] font-semibold text-copper-ink">{num(c.spareline.missed_total)}</dd>
        </div>
      </dl>
      <p className="text-[12.5px] text-ink-3">
        Missed packages of {num(c.no_intervention.packages_total)}. Run {run.run_id.slice(0, 8)}, {num((run.duration_ms ?? 0) / 1000, 1)} s on the server.
      </p>
      <Link className={buttonClass("primary", "md", "w-full")} href={`/app/recovery/${scenario.id}?run=${run.run_id}`}>
        Open the live scenario
      </Link>
    </div>
  );
}

/* ------------------------------------------------ 5. Measured, not promised */

function get(obj: unknown, ...path: string[]): number | null {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "number" ? cur : null;
}

export function Evidence() {
  const q = useEvaluationSummary();
  if (q.isPending) return <Spinner label="Loading evaluation…" />;
  if (q.isError) return <Offline />;
  const d = q.data;
  if (d.status === "not_run") {
    return <p className="max-w-[640px] text-[17px] leading-relaxed text-ink-2">No evaluation results are published yet, so this page shows no numbers.</p>;
  }
  const m = d.metrics;
  const none = get(m, "missed_packages", "no_intervention");
  const nearest = get(m, "missed_packages", "nearest_feasible");
  const spare = get(m, "missed_packages", "spareline");
  const denom = get(m, "missed_packages", "denominator_remaining_packages");
  const savedSpare = none !== null && spare !== null ? none - spare : null;
  const savedNearest = none !== null && nearest !== null ? none - nearest : null;
  const scale = Math.max(Math.abs(savedSpare ?? 0), Math.abs(savedNearest ?? 0), 1);
  const bar = (v: number | null) => (v === null ? 0 : (Math.abs(v) / scale) * 50);
  const rows: { label: string; value: string; note: string }[] = [];
  const better = get(m, "delta_vs_no_action", "spareline_better");
  const withMissed = get(m, "scenarios", "with_missed_packages_under_no_action");
  if (better !== null && withMissed !== null)
    rows.push({ label: "Scenarios where Spareline recommended a rescue", value: `${num(better)} of ${num(withMissed)}`, note: "scenarios with at least one projected miss" });
  const lowConf = get(m, "abstention", "low_confidence");
  const noSafe = get(m, "abstention", "no_safe_rescue_with_missed_packages");
  if (lowConf !== null && noSafe !== null && withMissed !== null)
    rows.push({ label: "Abstained or found no safe rescue", value: `${num(lowConf + noSafe)} of ${num(withMissed)}`, note: `${num(lowConf)} for travel-time uncertainty` });
  const harmN = get(m, "helper_harm", "nearest_feasible_scenarios_harming_helper");
  const harmS = get(m, "helper_harm", "spareline_newly_missed_helper_packages");
  if (harmN !== null && harmS !== null)
    rows.push({ label: "New misses pushed onto the helper", value: `${num(harmS)} vs ${num(get(m, "helper_harm", "nearest_feasible_newly_missed_helper_packages"))}`, note: `Spareline vs nearest van (${num(harmN)} scenarios harmed)` });
  const worse = get(m, "delta_vs_nearest", "spareline_worse");
  const betterN = get(m, "delta_vs_nearest", "spareline_better");
  if (worse !== null && betterN !== null) rows.push({ label: "Against the nearest van, scenario by scenario", value: `${num(betterN)} better, ${num(worse)} worse`, note: "the rest tie" });
  const p95 = get(m, "latency_ms", "p95");
  if (p95 !== null) rows.push({ label: "Solver time, 95th percentile", value: `${num(p95 / 1000, 1)} s`, note: "server wall time per scenario" });

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
      <div>
        <p className="text-[13px] text-ink-2">Packages saved compared with doing nothing</p>
        <div className="mt-5 space-y-5">
          {[
            { label: "Spareline", v: savedSpare, cls: "bg-copper" },
            { label: "Nearest van", v: savedNearest, cls: "bg-ink-3" },
          ].map((b) => (
            <div key={b.label}>
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="font-medium">{b.label}</span>
                <span className={`tnum text-[26px] font-semibold tracking-[-0.03em] ${b.v !== null && b.v < 0 ? "text-danger" : ""}`}>{signed(b.v)}</span>
              </div>
              <div className="relative mt-2 h-3 bg-surface" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px bg-ink-3" />
                <span
                  className={`absolute inset-y-0 ${b.v !== null && b.v < 0 ? "bg-danger" : b.cls}`}
                  style={b.v !== null && b.v < 0 ? { right: "50%", width: `${bar(b.v)}%` } : { left: "50%", width: `${bar(b.v)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[13px] leading-relaxed text-ink-3">
          Across {num(d.scenario_count)} predeclared scenarios and {num(denom)} remaining packages. Below the centre line means more missed packages than
          doing nothing.
        </p>
      </div>
      <div>
        <dl className="divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 py-3.5">
              <dt>
                <span className="text-[15px]">{r.label}</span>
                <span className="block text-[12.5px] text-ink-3">{r.note}</span>
              </dt>
              <dd className="tnum text-right text-[20px] font-semibold tracking-[-0.02em]">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 font-mono text-[11.5px] break-all text-ink-3">
          {d.evaluation_id} · {d.algorithm_version} · {utcDateTime(d.completed_at)}
        </p>
        <Link className="mt-4 inline-block text-[14px] font-medium text-copper-ink underline underline-offset-4" href="/app/results">
          Every scenario, including misses and abstentions
        </Link>
      </div>
    </div>
  );
}
