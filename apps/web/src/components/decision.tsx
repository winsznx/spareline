"use client";

import Link from "next/link";

import type { PolicyOutcome, RunStatus, Scenario } from "@/lib/api-types";
import { litres, num, POLICY_LABEL, reasonLabel, signed, stageLabel, utcTime } from "@/lib/format";
import { vehicleLabel } from "@/lib/geometry";

import { Badge, buttonClass, ErrorState, ProvenanceChip, RunStateBadge, Spinner } from "./ui";

export function ComparisonTable({ run, scenario }: { run: RunStatus; scenario: Scenario }) {
  const c = run.comparisons;
  if (!c) return null;
  const rows: PolicyOutcome[] = [c.no_intervention, c.nearest_feasible, c.spareline];
  const anyWindows = c.no_intervention.windowed_total > 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <caption className="sr-only">Policy comparison computed by the backend for run {run.run_id}</caption>
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-2">
            <th scope="col" className="py-2 pr-3 font-medium">Policy</th>
            <th scope="col" className="py-2 pr-3 font-medium">Missed packages</th>
            <th scope="col" className="py-2 pr-3 font-medium">On-time windowed</th>
            <th scope="col" className="py-2 pr-3 font-medium">Newly late on helper</th>
            <th scope="col" className="py-2 pr-3 font-medium">Added driving</th>
            <th scope="col" className="py-2 pr-3 font-medium">Latest finish</th>
            <th scope="col" className="py-2 font-medium">Under slower transfer</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r) => {
            const highlight = r.policy === "spareline" && run.state === "recommended";
            return (
              <tr key={r.policy} className={`border-b border-line last:border-0 ${highlight ? "bg-copper-soft/60" : ""}`}>
                <th scope="row" className="py-2.5 pr-3 font-medium">
                  <span className={highlight ? "text-copper-ink" : ""}>{POLICY_LABEL[r.policy]}</span>
                  <span className="block text-[11.5px] font-normal text-ink-3">
                    {r.transfer ? `${r.transfer_stop_count} stops → ${vehicleLabel(scenario, r.helper_route_id)}` : "No transfer"}
                  </span>
                </th>
                <td className="py-2.5 pr-3">
                  {num(r.missed_total)}
                  <span className="text-ink-3"> / {num(r.packages_total)}</span>
                </td>
                <td className="py-2.5 pr-3">
                  {anyWindows ? (
                    <>
                      {num(r.windowed_on_time)}
                      <span className="text-ink-3"> / {num(r.windowed_total)}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">No windows</span>
                  )}
                </td>
                <td className={`py-2.5 pr-3 ${(r.helper_newly_missed ?? 0) > 0 ? "font-semibold text-danger" : ""}`}>
                  {r.transfer ? num(r.helper_newly_missed) : "—"}
                </td>
                <td className="py-2.5 pr-3">{r.transfer ? `${signed(r.extra_drive_minutes)} min` : "—"}</td>
                <td className="py-2.5 pr-3">{utcTime(r.latest_finish_utc)}</td>
                <td className="py-2.5">
                  {r.conservative ? `${num(r.conservative.missed_total)} missed` : r.transfer ? "—" : "Same (no transfer edges)"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-ink-3">
        Missed = delivery would start after its window closes or after the driver&apos;s shift limit. Windowed packages are the only ones with
        a promised time; other packages are counted only for the shift limit.
      </p>
    </div>
  );
}

function RejectedList({ run, scenario }: { run: RunStatus; scenario: Scenario }) {
  const rejected = run.evidence?.rejected ?? [];
  if (!rejected.length) return null;
  const shown = rejected.filter((r) => r.missed_total !== undefined || r.policy === "nearest_feasible").slice(0, 6);
  const list = shown.length ? shown : rejected.slice(0, 6);
  return (
    <details className="group rounded-[10px] border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-[13px] font-medium">
        Options the solver rejected ({rejected.length})
        <span className="text-ink-3 group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {list.map((r, i) => (
          <li key={i} className="px-3 py-2.5 text-[13px]">
            <p className="font-medium">
              {r.policy === "nearest_feasible" ? "Nearest helper · " : ""}
              {vehicleLabel(scenario, r.helper_route_id)}
              {r.transfer_stops ? ` · ${r.transfer_stops} stops` : ""}
              {r.meeting ? <span className="font-mono text-[11.5px] text-ink-3"> · meet {r.meeting[1]}</span> : null}
            </p>
            <ul className="mt-1 space-y-0.5 text-ink-2">
              {r.reasons.map((code) => (
                <li key={code}>
                  {reasonLabel(code)} <span className="font-mono text-[10.5px] text-ink-3">{code.split(" ")[0]}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Evidence({ run }: { run: RunStatus }) {
  const ev = run.evidence;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-ink-3">
      <dt>Run</dt>
      <dd className="truncate text-ink-2" title={run.run_id}>{run.run_id}</dd>
      {ev ? (
        <>
          <dt>Algorithm</dt>
          <dd className="text-ink-2">{ev.algorithm_version}</dd>
          <dt>Travel model</dt>
          <dd className="text-ink-2">{ev.time_model_version}</dd>
          <dt>Searched</dt>
          <dd className="text-ink-2">
            {ev.candidates_considered} candidates, {ev.candidates_refined} re-sequenced ({ev.solver_status})
          </dd>
          <dt>Input</dt>
          <dd className="truncate text-ink-2" title={ev.input_hash}>{ev.input_hash.slice(0, 16)}</dd>
        </>
      ) : null}
      <dt>Duration</dt>
      <dd className="text-ink-2">{run.duration_ms !== null ? `${num(run.duration_ms)} ms` : "—"}</dd>
    </dl>
  );
}

export function DecisionPane({
  run,
  runError,
  scenario,
  onRetry,
  running,
}: {
  run: RunStatus | null | undefined;
  runError: unknown;
  scenario: Scenario;
  onRetry: () => void;
  running: boolean;
}) {
  if (runError) return <ErrorState error={runError} onRetry={onRetry} />;
  if (!run && !running) {
    return (
      <div className="rounded-[12px] border border-dashed border-line p-5">
        <p className="text-[15px] font-medium">Choose a disruption and calculate a rescue.</p>
        <p className="mt-1.5 text-sm text-ink-2">
          Set the simulated delay or traffic on the left, then select Recalculate rescue. The backend replays every van from its historical route and
          tests real handoff options.
        </p>
      </div>
    );
  }
  if (!run || run.state === "queued" || run.state === "running") {
    return (
      <div className="rounded-[12px] border border-line p-5" aria-busy="true">
        <p className="text-[15px] font-medium">Checking what each driver can still carry.</p>
        <div className="mt-3">
          <Spinner label={stageLabel(run?.stage)} />
        </div>
        <p className="mt-3 text-[12px] text-ink-3">The solver runs on the server. Results appear only when this run finishes; nothing shown is from an earlier run.</p>
      </div>
    );
  }
  if (run.state === "error") {
    return <ErrorState error={new Error(run.error?.message ?? "Solver error")} onRetry={onRetry} title="The route could not be recalculated." />;
  }

  const c = run.comparisons;
  const sol = run.solution;
  const base = c?.no_intervention;
  const best = c?.spareline;
  const saved = base && best ? base.missed_total - best.missed_total : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RunStateBadge state={run.state} />
        <ProvenanceChip kind="MODEL RESULT" />
        {sol ? <ProvenanceChip kind="ESTIMATED TRANSFER TIME" /> : null}
      </div>

      {run.state === "recommended" || (run.state === "timed_out" && sol) ? (
        <div className="rounded-[12px] border border-copper/50 bg-copper-soft/50 p-4">
          <p className="text-[17px] font-semibold tracking-[-0.02em]">Transfer may preserve more delivery windows.</p>
          {sol && base && best ? (
            <>
              <p className="mt-1.5 text-sm text-ink-2">
                Move <strong className="text-ink">{sol.transfer.length} stops ({sol.transfer_package_count} packages)</strong> from{" "}
                {vehicleLabel(scenario, sol.donor_route_id)} to {vehicleLabel(scenario, sol.helper_route_id)}. Meet at stop{" "}
                <span className="font-mono">{sol.meeting.stop_id}</span> around {utcTime(sol.meeting_time_utc)}.
              </p>
              <dl className="tnum mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-[12px] text-ink-2">Missed packages</dt>
                  <dd className="mt-0.5 text-[20px] font-semibold">
                    {num(base.missed_total)} → <span className="text-copper-ink">{num(best.missed_total)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-2">Under slower transfer</dt>
                  <dd className="mt-0.5 text-[20px] font-semibold">{best.conservative ? num(best.conservative.missed_total) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-2">Added driving</dt>
                  <dd className="mt-0.5 text-[20px] font-semibold">{signed(best.extra_drive_minutes)} min</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] text-ink-3">
                {saved !== null && saved > 0 ? `${saved} fewer missed packages than doing nothing under the model. ` : ""}
                Handoff travel uses estimated cross-route times ({sol.cross_route_edges[0] ? `${Math.round(sol.cross_route_edges[0].lower_s / 60)}–${Math.round(sol.cross_route_edges[0].upper_s / 60)} min range for the first leg` : "interval shown on the handoff page"}).
              </p>
              <Link href={`/app/manifests/${run.run_id}`} className={buttonClass("primary", "md", "mt-3 w-full sm:w-auto")}>
                Review handoff
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {run.state === "no_safe_rescue" ? (
        <div className="rounded-[12px] border border-danger/40 bg-danger-soft/60 p-4">
          <p className="text-[17px] font-semibold tracking-[-0.02em]">No safe rescue under these conditions.</p>
          <p className="mt-1 text-sm text-ink-2">No transfer meets the current limits.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {run.reason_codes.map((code) => (
              <li key={code} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                <span>
                  {reasonLabel(code)} <span className="font-mono text-[10.5px] text-ink-3">{code}</span>
                </span>
              </li>
            ))}
          </ul>
          {base && base.missed_total > 0 ? (
            <p className="mt-2 text-[12px] text-ink-2">
              Without help, {num(base.missed_total)} packages are projected to miss. Spareline is not recommending a transfer, so no manifest is issued.
            </p>
          ) : null}
        </div>
      ) : null}

      {run.state === "low_confidence" ? (
        <div className="rounded-[12px] border border-warning/50 bg-warning-soft/60 p-4">
          <p className="text-[17px] font-semibold tracking-[-0.02em]">Travel-time uncertainty is too high to recommend this handoff.</p>
          <p className="mt-1 text-sm text-ink-2">Transfer time cannot be estimated reliably for this pairing.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {run.reason_codes.map((code) => (
              <li key={code}>
                {reasonLabel(code)} <span className="font-mono text-[10.5px] text-ink-3">{code}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {run.state === "timed_out" && !sol ? (
        <div className="rounded-[12px] border border-warning/50 bg-warning-soft/60 p-4">
          <p className="text-[15px] font-semibold">The solver reached its time limit without a verified rescue.</p>
          <p className="mt-1 text-sm text-ink-2">No recommendation is shown. Retry with a longer limit or fewer helpers.</p>
        </div>
      ) : null}

      {base && base.windowed_total === 0 ? (
        <p className="rounded-[10px] border border-line px-3 py-2 text-[13px] text-ink-2">
          No guaranteed delivery windows in the selected remaining stops. Results are measured against the shift limit only.
        </p>
      ) : null}

      <div>
        <h3 className="mb-2 text-[13px] font-semibold">Compare policies</h3>
        <ComparisonTable run={run} scenario={scenario} />
      </div>

      <RejectedList run={run} scenario={scenario} />
      <Evidence run={run} />
    </div>
  );
}

export function SolutionSummary({ run, scenario }: { run: RunStatus; scenario: Scenario }) {
  const sol = run.solution;
  if (!sol) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={sol.validation.volume_fits ? "success" : "danger"}>{sol.validation.volume_fits ? "Volume fits" : "Volume exceeds capacity"}</Badge>
      <Badge tone="neutral">{sol.validation.time_windows_evaluated ? "Time windows evaluated" : "No windows to evaluate"}</Badge>
      <Badge tone={sol.validation.handoff_feasible_under_model ? "success" : "danger"}>
        {sol.validation.handoff_feasible_under_model ? "Handoff feasible under model" : "Handoff not feasible"}
      </Badge>
      <Badge tone={sol.validation.no_new_late_on_helper ? "success" : "danger"}>
        {sol.validation.no_new_late_on_helper ? "No new late delivery on helper" : "Helper gets late deliveries"}
      </Badge>
      <span className="sr-only">Helper {vehicleLabel(scenario, sol.helper_route_id)} load after handoff {litres(sol.helper_load_after_handoff_cm3)}</span>
    </div>
  );
}
