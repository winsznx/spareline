"use client";

import { useMemo, useState } from "react";

import type { Scenario } from "@/lib/api-types";
import { utcTime } from "@/lib/format";
import type { SceneGeometry } from "@/lib/geometry";

type Filter = "remaining" | "issues" | "all";

export function StopTable({ scene, scenario }: { scene: SceneGeometry; scenario: Scenario }) {
  const [filter, setFilter] = useState<Filter>("remaining");
  const [query, setQuery] = useState("");
  const labels = useMemo(() => new Map(scenario.vehicles.map((v) => [v.route_id, v.label])), [scenario.vehicles]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scene.stops
      .filter((s) => s.status !== "station")
      .filter((s) => (filter === "all" ? true : filter === "issues" ? s.lateWindowed > 0 || s.afterShift || s.status === "transferred" : s.status !== "completed"))
      .filter((s) => !q || s.stopId.toLowerCase().includes(q) || (labels.get(s.routeId) ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.etaUtc ?? "~").localeCompare(b.etaUtc ?? "~"));
  }, [scene.stops, filter, query, labels]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Stop filter" className="inline-flex rounded-[8px] border border-line p-0.5">
          {(["remaining", "issues", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={`h-9 rounded-[6px] px-3 text-[13px] capitalize ${filter === f ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-2"}`}
            >
              {f === "issues" ? "Issues" : f}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
          <span className="sr-only">Search stops</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stop or van"
            className="h-10 w-44 rounded-[8px] border border-line bg-raised px-3 text-[13px] text-ink placeholder:text-ink-3"
          />
        </label>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">
        {rows.length} stops · ETAs are {scene.policy === "observed" ? "not yet calculated" : `model results for “${scene.policy.replace("_", " ")}”`} · coordinates are anonymized source values
      </p>
      <div className="mt-2 max-h-[520px] overflow-auto rounded-[10px] border border-line">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <caption className="sr-only">Stops for this scenario</caption>
          <thead className="sticky top-0 bg-surface text-[12px] text-ink-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Van</th>
              <th scope="col" className="px-3 py-2 font-medium">Stop</th>
              <th scope="col" className="px-3 py-2 font-medium">Model ETA</th>
              <th scope="col" className="px-3 py-2 font-medium">Window ends</th>
              <th scope="col" className="px-3 py-2 font-medium">Packages</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Lat, lng</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((s) => {
              const late = s.lateWindowed > 0 || s.afterShift;
              return (
                <tr key={`${s.routeId}|${s.stopId}`} className="border-t border-line">
                  <td className="px-3 py-2">
                    {labels.get(s.routeId)}
                    {s.servedBy && s.servedBy !== s.routeId ? <span className="text-copper-ink"> → {labels.get(s.servedBy)}</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{s.stopId}</td>
                  <td className="px-3 py-2">{s.status === "completed" ? "Delivered" : utcTime(s.etaUtc)}</td>
                  <td className="px-3 py-2">{s.windowEndUtc ? utcTime(s.windowEndUtc) : <span className="text-ink-3">No window</span>}</td>
                  <td className="px-3 py-2">
                    {s.packageCount}
                    {s.windowedCount ? <span className="text-ink-3"> ({s.windowedCount} windowed)</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {s.status === "completed" ? (
                      <span className="text-ink-3">Historical</span>
                    ) : late ? (
                      <span className="font-medium text-danger">{s.afterShift ? "After shift" : `${s.lateWindowed} late`}</span>
                    ) : s.status === "transferred" ? (
                      <span className="font-medium text-copper-ink">Moved in plan</span>
                    ) : (
                      <span className="text-success">On time</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-ink-3">
                    {s.lngLat[1].toFixed(4)}, {s.lngLat[0].toFixed(4)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
