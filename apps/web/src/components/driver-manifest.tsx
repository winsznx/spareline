"use client";

import { useSearchParams } from "next/navigation";

import { utcDateTime, utcTime } from "@/lib/format";
import { useManifest } from "@/lib/queries";

import { Mark } from "./brand";
import { Button, ErrorState, Spinner } from "./ui";

export function DriverManifest({ runId }: { runId: string }) {
  const params = useSearchParams();
  const role = params.get("role") === "helper" ? "helper" : "donor";
  const m = useManifest(runId, role);

  return (
    <main className="mx-auto max-w-[720px] px-5 py-6">
      <header className="flex items-center gap-3 border-b border-line pb-4">
        <Mark size={28} />
        <div className="min-w-0">
          <p className="text-[12px] text-ink-2">Spareline driver manifest · research replay</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em]">{m.data?.label ?? "Driver manifest"}</h1>
        </div>
        <Button className="no-print ml-auto" size="sm" onClick={() => window.print()}>
          Print
        </Button>
      </header>
      {m.isPending ? (
        <div className="py-6">
          <Spinner label="Loading manifest…" />
        </div>
      ) : null}
      {m.isError ? (
        <div className="py-6">
          <ErrorState error={m.error} title="This manifest could not be loaded." onRetry={() => void m.refetch()} />
        </div>
      ) : null}
      {m.data ? (
        <>
          <p className="mt-4 rounded-[10px] border border-warning/50 px-3 py-2 text-[13px] text-warning-ink">
            {m.data.status === "proposed"
              ? "Proposed plan. Not approved by a dispatcher. Do not act on it."
              : "Simulation only. Built from historical 2018 routes with a simulated delay. No real driver is dispatched."}
          </p>
          <section className="mt-5 rounded-[12px] border border-copper/50 bg-copper-soft/50 p-4">
            <p className="text-[12px] text-ink-2">Handoff</p>
            <p className="mt-1 text-[17px] font-semibold">
              {m.data.handoff.role_action === "hand over" ? "Hand over" : "Collect"} packages at stop <span className="font-mono">{m.data.handoff.stop_id}</span>
            </p>
            <p className="tnum mt-1 text-sm text-ink-2">
              Around {utcTime(m.data.handoff.time_utc)} · {m.data.handoff.lat.toFixed(5)}, {m.data.handoff.lng.toFixed(5)}
            </p>
          </section>
          <ol className="mt-5 divide-y divide-line rounded-[12px] border border-line">
            {m.data.rows.map((r) => (
              <li key={`${r.route_id}|${r.stop_id}`} className="flex gap-3 px-4 py-3">
                <span className="tnum w-7 shrink-0 pt-0.5 font-mono text-[12px] text-ink-3">{r.seq}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[14px] font-medium">{r.stop_id}</span>
                    {r.transferred ? <span className="text-[12px] font-medium text-copper-ink">{m.data.role === "helper" ? "from late van" : "hand over"}</span> : null}
                    <span className="tnum ml-auto text-sm">{utcTime(r.eta_utc)}</span>
                  </p>
                  <p className="text-[13px] text-ink-2">
                    {r.package_count} package{r.package_count === 1 ? "" : "s"} · {r.windows || "no delivery window"}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">{r.packages.join(" ")}</p>
                </div>
              </li>
            ))}
          </ol>
          <footer className="mt-5 space-y-1 text-[12px] text-ink-3">
            <p>Dispatch time {utcDateTime(m.data.dispatch_time_utc)} · run {m.data.run_id}</p>
            {m.data.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            <p>Source: Amazon Last Mile Routing Research Challenge (2018), CC BY-NC 4.0. ETAs are model estimates.</p>
          </footer>
        </>
      ) : null}
    </main>
  );
}
