"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { api, ApiError, getSession, manifestCsvUrl } from "@/lib/api";
import type { DispatchState, Manifest, RunStatus, Scenario } from "@/lib/api-types";
import { litres, num, utcDateTime, utcTime } from "@/lib/format";
import { vehicleLabel } from "@/lib/geometry";
import { keys, useDispatch, useManifest, useRun, useScenario } from "@/lib/queries";

import { SolutionSummary } from "./decision";
import { Badge, Button, buttonClass, ErrorState, PageHeader, Panel, ProvenanceChip, RunStateBadge, Spinner } from "./ui";

const STATUS_LABEL: Record<DispatchState["status"], string> = {
  proposed: "Proposed, awaiting dispatcher approval",
  approved_simulation: "Approved (simulation)",
  awaiting_handoff: "Awaiting handoff confirmation",
  transferred_simulation: "Transfer recorded (simulation)",
};

const STEPS: DispatchState["status"][] = ["proposed", "awaiting_handoff", "transferred_simulation"];

function StatusTrack({ state }: { state: DispatchState }) {
  const idx = state.status === "approved_simulation" ? 1 : STEPS.indexOf(state.status);
  const labels = ["Proposed", "Dispatcher approved", "Confirmed by both drivers"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Handoff status">
      {labels.map((l, i) => (
        <li key={l} className={`rounded-[8px] border px-3 py-2 text-[12.5px] ${i <= idx ? "border-copper/60 bg-copper-soft/60 text-ink" : "border-line text-ink-3"}`}>
          <span className="tnum mr-1.5 font-mono text-[11px]">{i + 1}</span>
          {l}
        </li>
      ))}
    </ol>
  );
}

function ManifestTable({ manifest }: { manifest: Manifest }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-left text-[13px]">
        <caption className="sr-only">{manifest.label} revised stop list</caption>
        <thead className="text-[12px] text-ink-2">
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-3 font-medium">#</th>
            <th scope="col" className="py-2 pr-3 font-medium">Stop</th>
            <th scope="col" className="py-2 pr-3 font-medium">Model ETA</th>
            <th scope="col" className="py-2 pr-3 font-medium">Packages</th>
            <th scope="col" className="py-2 font-medium">Window</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {manifest.rows.map((r) => (
            <tr key={`${r.route_id}|${r.stop_id}`} className={`border-b border-line last:border-0 ${r.transferred ? "bg-copper-soft/50" : ""}`}>
              <td className="py-2 pr-3 text-ink-3">{r.seq}</td>
              <td className="py-2 pr-3">
                <span className="font-mono text-[12px]">{r.stop_id}</span>
                {r.transferred ? <span className="ml-2 text-[11.5px] font-medium text-copper-ink">from {manifest.role === "helper" ? "late van" : "you"}</span> : null}
              </td>
              <td className="py-2 pr-3">{utcTime(r.eta_utc)}</td>
              <td className="py-2 pr-3">{r.package_count}</td>
              <td className="py-2 text-ink-2">{r.windows || "No window"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriverColumn({
  run,
  role,
  dispatch,
  session,
}: {
  run: RunStatus;
  role: "donor" | "helper";
  dispatch: DispatchState | undefined;
  session: string | undefined;
}) {
  const m = useManifest(run.run_id, role);
  const approved = dispatch && dispatch.status !== "proposed";
  return (
    <Panel className="min-w-0 p-4">
      {m.isPending ? <Spinner label="Loading manifest…" /> : null}
      {m.isError ? <ErrorState error={m.error} title="The manifest could not be loaded." onRetry={() => void m.refetch()} /> : null}
      {m.data ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[12px] text-ink-2">{role === "donor" ? "Late van (hands over)" : "Helper (receives)"}</p>
              <h3 className="text-[18px] font-semibold tracking-[-0.02em]">{m.data.label}</h3>
            </div>
            <Badge tone={approved ? "copper" : "neutral"}>{approved ? "Approved plan" : "Proposed plan"}</Badge>
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {m.data.handoff.role_action === "hand over" ? "Hand over" : "Receive"} packages at stop{" "}
            <span className="font-mono text-ink">{m.data.handoff.stop_id}</span> around {utcTime(m.data.handoff.time_utc)}. {m.data.rows.length} stops after the
            handoff.
          </p>
          <div className="mt-3">
            <ManifestTable manifest={m.data} />
          </div>
          {m.data.notes.length ? (
            <ul className="mt-3 space-y-1 text-[12px] text-ink-3">
              {m.data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="no-print mt-4 flex flex-wrap gap-2">
            {approved && session ? (
              <a className={buttonClass("secondary", "md")} href={manifestCsvUrl(run.run_id, role, session)} download>
                Download {role} CSV
              </a>
            ) : (
              <Button disabled title="Approve the plan first">
                Download {role} CSV
              </Button>
            )}
            <Link className={buttonClass("ghost", "md")} href={`/driver/${run.run_id}?role=${role}`} target="_blank">
              Driver view
            </Link>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function HandoffWorkspace({ run, scenario }: { run: RunStatus; scenario: Scenario }) {
  const qc = useQueryClient();
  const dispatchQ = useDispatch(run.run_id);
  const session = useQuery({ queryKey: ["session"], queryFn: () => getSession(), staleTime: Infinity });
  const dispatch = dispatchQ.data;
  const onDone = (d: DispatchState) => {
    qc.setQueryData(keys.dispatch(run.run_id), d);
    void qc.invalidateQueries({ queryKey: ["manifest", run.run_id] });
  };
  const approve = useMutation({ mutationFn: () => api.approve(run.run_id, dispatch?.revision ?? 0), onSuccess: onDone, onError: () => void dispatchQ.refetch() });
  const ack = useMutation({
    mutationFn: (role: "donor" | "helper") => api.ack(run.run_id, role, dispatch?.revision ?? 0),
    onSuccess: onDone,
    onError: () => void dispatchQ.refetch(),
  });
  const sol = run.solution;
  if (!sol) return null;
  const mutationError = approve.error ?? ack.error;
  const conflict = mutationError instanceof ApiError && mutationError.status === 409;
  const first = sol.first_to_arrive === "donor" ? vehicleLabel(scenario, sol.donor_route_id) : vehicleLabel(scenario, sol.helper_route_id);
  const edge = sol.cross_route_edges[0];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="p-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Handoff</h2>
          <dl className="tnum mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[12px] text-ink-2">Meeting point</dt>
              <dd className="font-mono">{sol.meeting.stop_id}</dd>
              <dd className="text-[12px] text-ink-3">
                Known stop on {vehicleLabel(scenario, sol.meeting.route_id)}&apos;s route, not a vetted loading zone
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-2">Handoff starts</dt>
              <dd>{utcTime(sol.meeting_time_utc)}</dd>
              <dd className="text-[12px] text-ink-3">ends {utcTime(sol.handoff_end_utc)} ({num(sol.handoff_minutes, 1)} min)</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-2">Arrives first</dt>
              <dd>{first}</dd>
              <dd className="text-[12px] text-ink-3">
                waits {num(sol.first_to_arrive === "donor" ? sol.wait_donor_minutes : sol.wait_helper_minutes, 1)} min
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-2">Late van arrives</dt>
              <dd>{utcTime(sol.donor_arrival_utc)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-2">Helper arrives</dt>
              <dd>{utcTime(sol.helper_arrival_utc)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-2">Helper load after handoff</dt>
              <dd>
                {litres(sol.helper_load_after_handoff_cm3)} <span className="text-ink-3">/ {litres(sol.helper_capacity_cm3)}</span>
              </dd>
            </div>
          </dl>
          {edge ? (
            <p className="mt-3 rounded-[8px] border border-line px-3 py-2 text-[12.5px] text-ink-2">
              <ProvenanceChip kind="ESTIMATED TRANSFER TIME" /> <span className="ml-1">Travel to the meeting point is estimated from distance ({num(edge.distance_km, 2)} km): {num(edge.mean_s / 60, 1)} min expected, {num(edge.lower_s / 60, 1)}–{num(edge.upper_s / 60, 1)} min range. The recommendation was re-checked at the slow end.</span>
            </p>
          ) : null}
          <div className="mt-4">
            <SolutionSummary run={run} scenario={scenario} />
          </div>
        </Panel>

        <Panel className="p-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Dispatch status</h2>
          {dispatchQ.isPending ? <Spinner label="Loading status…" /> : null}
          {dispatchQ.isError ? <ErrorState error={dispatchQ.error} onRetry={() => void dispatchQ.refetch()} title="Status could not be loaded." /> : null}
          {dispatch ? (
            <div className="mt-3 space-y-4">
              <StatusTrack state={dispatch} />
              <p className="text-sm text-ink-2">{STATUS_LABEL[dispatch.status]}</p>
              {dispatch.status === "proposed" ? (
                <>
                  <Button variant="primary" className="w-full" onClick={() => approve.mutate()} disabled={approve.isPending}>
                    {approve.isPending ? "Approving…" : "Approve simulated plan"}
                  </Button>
                  <p className="text-[12px] text-ink-3">
                    Approval only changes this replay&apos;s dispatch plan. It does not contact drivers and does not mark any package as transferred.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-ink-3">This plan was approved. Create a new revision to change it.</p>
                  <fieldset className="space-y-2">
                    <legend className="text-[13px] font-medium">Driver confirmations (simulated)</legend>
                    {(["donor", "helper"] as const).map((role) => {
                      const done = role === "donor" ? dispatch.donor_ack : dispatch.helper_ack;
                      const at = role === "donor" ? dispatch.donor_ack_at : dispatch.helper_ack_at;
                      return (
                        <div key={role} className="flex min-h-11 items-center justify-between gap-3 rounded-[8px] border border-line px-3">
                          <span className="text-sm">
                            {role === "donor" ? vehicleLabel(scenario, sol.donor_route_id) : vehicleLabel(scenario, sol.helper_route_id)}{" "}
                            {role === "donor" ? "handed over" : "received"}
                            {at ? <span className="block text-[11.5px] text-ink-3">{utcDateTime(at)}</span> : null}
                          </span>
                          {done ? (
                            <Badge tone="success">Confirmed</Badge>
                          ) : (
                            <Button size="sm" onClick={() => ack.mutate(role)} disabled={ack.isPending}>
                              Record confirmation
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                  {dispatch.status === "transferred_simulation" ? (
                    <p className="text-sm text-success">Both drivers confirmed at {utcDateTime(dispatch.transferred_at)}.</p>
                  ) : (
                    <p className="text-[12px] text-ink-3">Packages are not marked transferred until both drivers confirm.</p>
                  )}
                </>
              )}
              {mutationError ? (
                conflict ? (
                  <p role="alert" className="text-sm text-danger">
                    This plan changed in another tab. The latest status has been reloaded; try again.
                  </p>
                ) : (
                  <ErrorState error={mutationError} title="The action could not be recorded." />
                )
              ) : null}
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel className="p-4">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Package groups to move</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="text-[12px] text-ink-2">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">Stop</th>
                <th scope="col" className="py-2 pr-3 font-medium">Zone</th>
                <th scope="col" className="py-2 pr-3 font-medium">Packages</th>
                <th scope="col" className="py-2 pr-3 font-medium">Volume</th>
                <th scope="col" className="py-2 pr-3 font-medium">Old position</th>
                <th scope="col" className="py-2 pr-3 font-medium">New position</th>
                <th scope="col" className="py-2 font-medium">Windows</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {sol.transfer.map((t) => (
                <tr key={`${t.route_id}|${t.stop_id}`} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-mono text-[12px]">{t.stop_id}</td>
                  <td className="py-2 pr-3 text-ink-2">{t.zone_id ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {t.package_count}
                    <span className="block font-mono text-[10.5px] text-ink-3">{t.packages.map((p) => p.package_short).join(" ")}</span>
                  </td>
                  <td className="py-2 pr-3">{litres(t.volume_cm3)}</td>
                  <td className="py-2 pr-3">
                    {vehicleLabel(scenario, sol.donor_route_id)} #{t.old_position}
                  </td>
                  <td className="py-2 pr-3 text-copper-ink">
                    {vehicleLabel(scenario, sol.helper_route_id)} #{t.new_position}
                  </td>
                  <td className="py-2 text-ink-2">{t.windowed_count ? `${t.windowed_count} windowed` : "No window"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          {sol.transfer.length} stops, {sol.transfer_package_count} packages, {litres(sol.transfer_volume_cm3)}. Whole stops move together so no address is served by two
          vans.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <DriverColumn run={run} role="donor" dispatch={dispatch} session={session.data} />
        <DriverColumn run={run} role="helper" dispatch={dispatch} session={session.data} />
      </div>
      {dispatch?.status === "proposed" ? (
        <p className="text-[12px] text-ink-3">CSV downloads unlock after the plan is approved, so an unapproved plan is never handed to a driver.</p>
      ) : null}
    </div>
  );
}

export function HandoffPage({ runId }: { runId: string }) {
  const runQ = useRun(runId);
  const run = runQ.data;
  const scenarioQ = useScenario(run?.scenario_id);
  if (runQ.isPending) return <Spinner label="Loading run…" />;
  if (runQ.isError || !run) return <ErrorState error={runQ.error} title="This run could not be loaded." onRetry={() => void runQ.refetch()} />;
  const scenario = scenarioQ.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Handoff and manifests"
        meta={
          <span className="font-mono text-[12px]">
            Run {run.run_id} {scenario ? `· ${scenario.group.station_code} ${scenario.group.date_utc}` : ""}
          </span>
        }
      >
        <RunStateBadge state={run.state} />
        <Button className="no-print" onClick={() => window.print()}>
          Print
        </Button>
        {scenario ? (
          <Link className={buttonClass("ghost")} href={`/app/recovery/${scenario.id}?run=${run.run_id}`}>
            Back to desk
          </Link>
        ) : null}
      </PageHeader>
      {!scenario ? <Spinner label="Loading scenario…" /> : null}
      {scenario && run.state === "recommended" ? <HandoffWorkspace run={run} scenario={scenario} /> : null}
      {scenario && run.state !== "recommended" && run.state !== "queued" && run.state !== "running" ? (
        <Panel className="p-5">
          <p className="font-medium">No manifest is issued for this run.</p>
          <p className="mt-1 text-sm text-ink-2">
            The solver did not recommend a transfer, so there is nothing for drivers to act on. Open the recovery desk to see the reasons.
          </p>
        </Panel>
      ) : null}
      {run.state === "queued" || run.state === "running" ? <Spinner label="The run is still calculating…" /> : null}
    </div>
  );
}
