"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import type { Scenario } from "@/lib/api-types";
import { num, reasonLabel, shortId, utcDateTime, utcTime } from "@/lib/format";
import { keys, useRun, useScenarios } from "@/lib/queries";

import { Button, buttonClass, ErrorState, PageHeader, Panel, ProvenanceChip, RunStateBadge, Spinner } from "./ui";

function shockText(s: Scenario): string {
  const parts: string[] = [];
  if (s.shock.kind === "vehicle_failure") parts.push("van becomes unavailable");
  if (s.shock.delay_minutes) parts.push(`${s.shock.delay_minutes} min delay`);
  if (s.shock.travel_time_factor > 1) parts.push(`traffic ×${s.shock.travel_time_factor.toFixed(2)}`);
  return parts.length ? parts.join(", ") : "no disruption";
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const router = useRouter();
  const qc = useQueryClient();
  const runQ = useRun(scenario.latest_run_id);
  const run = runQ.data;
  const start = useMutation({
    mutationFn: () => api.startRun(scenario.id),
    onSuccess: (r) => {
      qc.setQueryData(keys.run(r.run_id), r);
      router.push(`/app/recovery/${scenario.id}?run=${r.run_id}`);
    },
  });
  const base = run?.comparisons?.no_intervention;
  const best = run?.comparisons?.spareline;
  return (
    <Panel className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[18px] font-semibold tracking-[-0.02em]">{scenario.title ?? "Session scenario"}</h3>
        {run ? <RunStateBadge state={run.state} /> : null}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-ink-2">Depot / date</dt>
        <dd>
          {scenario.group.station_code} · {scenario.group.date_utc}
        </dd>
        <dt className="text-ink-2">Routes</dt>
        <dd className="font-mono text-[12px]">{scenario.group.route_ids.map((r) => shortId(r)).join(", ")}</dd>
        <dt className="text-ink-2">Simulated</dt>
        <dd>{shockText(scenario)} at {utcTime(scenario.cutoff_utc)}</dd>
        <dt className="text-ink-2">Outcome</dt>
        <dd>
          {run && base && best
            ? run.state === "recommended"
              ? `${num(base.missed_total)} → ${num(best.missed_total)} missed packages with a handoff`
              : run.reason_codes.slice(0, 2).map(reasonLabel).join(" ")
            : runQ.isPending && scenario.latest_run_id
              ? "Loading…"
              : "Not run yet"}
        </dd>
        <dt className="text-ink-2">Last run</dt>
        <dd>{run?.completed_at ? utcDateTime(run.completed_at) : "—"}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ProvenanceChip kind="HISTORICAL ROUTES" />
        <ProvenanceChip kind="SIMULATED DELAY" />
      </div>
      {start.error ? (
        <div className="mt-3">
          <ErrorState error={start.error} title="The scenario could not be started." />
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Run scenario"}
        </Button>
        <Link className={buttonClass("secondary")} href={`/app/recovery/${scenario.id}${scenario.latest_run_id ? `?run=${scenario.latest_run_id}` : ""}`}>
          Open and adjust
        </Link>
      </div>
    </Panel>
  );
}

export function ScenarioLibrary() {
  const list = useScenarios();
  if (list.isPending) return <Spinner label="Loading scenarios…" />;
  if (list.isError) return <ErrorState title="Scenarios could not be loaded." error={list.error} onRetry={() => void list.refetch()} />;
  const curated = list.data.filter((s) => s.curated);
  const mine = list.data.filter((s) => !s.curated);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Scenarios"
        meta="Three curated replays, chosen after running the evaluation cohort. Each uses real historical routes from one depot and day, with a disclosed simulated disruption."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {curated.map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </div>
      {!curated.length ? <p className="text-sm text-ink-2">No curated scenarios are published by the API yet.</p> : null}
      <section>
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Your revisions</h2>
        <p className="mt-1 text-sm text-ink-2">Scenarios you changed on the recovery desk. Only this browser session can see them.</p>
        {mine.length ? (
          <ul className="mt-3 divide-y divide-line rounded-[12px] border border-line">
            {mine.map((s) => (
              <li key={s.id}>
                <Link href={`/app/recovery/${s.id}${s.latest_run_id ? `?run=${s.latest_run_id}` : ""}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-surface">
                  <span className="font-medium">{s.group.station_code} · {s.group.date_utc}</span>
                  <span className="text-ink-2">{shockText(s)}</span>
                  <span className="ml-auto font-mono text-[11.5px] text-ink-3">{s.id.slice(0, 8)} · {utcDateTime(s.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-[12px] border border-dashed border-line px-4 py-3 text-sm text-ink-2">No revisions yet. Change a curated scenario on the recovery desk to create one.</p>
        )}
      </section>
    </div>
  );
}
