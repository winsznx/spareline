"use client";

import { useId, useState } from "react";

import type { Scenario, ScenarioCreate, Shock } from "@/lib/api-types";
import { utcTime } from "@/lib/format";

import { Button, ProvenanceChip } from "./ui";

export interface Controls {
  donor: string;
  delay: number;
  factor: number;
  failure: boolean;
  excluded: string[];
}

export function controlsFromScenario(s: Scenario): Controls {
  return {
    donor: s.donor_route_id,
    delay: s.shock.delay_minutes,
    factor: s.shock.travel_time_factor,
    failure: s.shock.kind === "vehicle_failure",
    excluded: [...(s.excluded_helper_route_ids ?? [])].sort(),
  };
}

export function sameControls(a: Controls, b: Controls): boolean {
  return (
    a.donor === b.donor &&
    a.delay === b.delay &&
    Math.abs(a.factor - b.factor) < 1e-9 &&
    a.failure === b.failure &&
    a.excluded.join(",") === b.excluded.join(",")
  );
}

export function toScenarioCreate(base: Scenario, c: Controls): ScenarioCreate {
  const kind: Shock["kind"] = c.failure ? "vehicle_failure" : c.delay === 0 && c.factor > 1 ? "traffic_multiplier" : "delay";
  return {
    route_group_id: base.route_group_id,
    donor_route_id: c.donor,
    cutoff_utc: c.donor === base.donor_route_id ? base.cutoff_utc : null,
    seed: base.seed,
    shock: {
      kind,
      delay_minutes: c.delay,
      travel_time_factor: Math.round(c.factor * 100) / 100,
      failure_after_stop_index: c.failure ? 0 : null,
    },
    excluded_helper_route_ids: c.excluded.filter((id) => id !== c.donor),
    parent_scenario_id: base.id,
  };
}

const PRESETS: { label: string; apply: (c: Controls) => Controls }[] = [
  { label: "Running 45 min late", apply: (c) => ({ ...c, delay: 45, factor: 1, failure: false }) },
  { label: "Running 90 min late", apply: (c) => ({ ...c, delay: 90, factor: 1, failure: false }) },
  { label: "Heavy traffic ×1.3", apply: (c) => ({ ...c, delay: 0, factor: 1.3, failure: false }) },
  { label: "Van breaks down", apply: (c) => ({ ...c, delay: 0, factor: 1, failure: true }) },
];

export function ScenarioControls({
  scenario,
  busy,
  onSubmit,
}: {
  scenario: Scenario;
  busy: boolean;
  onSubmit: (controls: Controls, changed: boolean) => void;
}) {
  const initial = controlsFromScenario(scenario);
  const [c, setC] = useState<Controls>(initial);
  const changed = !sameControls(c, initial);
  const ids = { delay: useId(), factor: useId(), donor: useId(), failure: useId() };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(c, changed);
      }}
    >
      <div>
        <p className="text-[12px] text-ink-2">Dataset</p>
        <p className="mt-0.5 text-sm font-medium">Amazon historical deliveries · 2018</p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Station {scenario.group.station_code}, {scenario.group.date_utc}, cutoff {utcTime(scenario.cutoff_utc)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ProvenanceChip kind="HISTORICAL ROUTES" />
          <ProvenanceChip kind="RECONSTRUCTED" />
        </div>
      </div>

      <div className="space-y-4 rounded-[12px] border border-warning/40 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold">Simulated scenario</p>
          <ProvenanceChip kind="SIMULATED DELAY" />
        </div>

        <div>
          <label htmlFor={ids.donor} className="text-[12px] text-ink-2">
            Late van
          </label>
          <select
            id={ids.donor}
            value={c.donor}
            onChange={(e) => setC({ ...c, donor: e.target.value, excluded: c.excluded.filter((x) => x !== e.target.value) })}
            className="mt-1 h-11 w-full max-w-full min-w-0 truncate rounded-[8px] border border-line bg-raised px-3 text-sm"
          >
            {scenario.vehicles.map((v) => (
              <option key={v.route_id} value={v.route_id}>
                {v.label} · {v.short_id} · {v.remaining_stops} stops left
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={ids.delay} className="text-[12px] text-ink-2">
              Route delay
            </label>
            <output htmlFor={ids.delay} className="tnum text-sm font-medium">
              {c.delay} min
            </output>
          </div>
          <input
            id={ids.delay}
            type="range"
            min={0}
            max={180}
            step={5}
            value={c.delay}
            onChange={(e) => setC({ ...c, delay: Number(e.target.value) })}
            className="mt-1.5 h-6 w-full"
            aria-valuetext={`${c.delay} minutes`}
          />
          <div className="flex justify-between text-[11px] text-ink-3">
            <span>0</span>
            <span>180 min</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={ids.factor} className="text-[12px] text-ink-2">
              Traffic factor on the late van&apos;s area
            </label>
            <output htmlFor={ids.factor} className="tnum text-sm font-medium">
              ×{c.factor.toFixed(2)}
            </output>
          </div>
          <input
            id={ids.factor}
            type="range"
            min={1}
            max={1.6}
            step={0.05}
            value={c.factor}
            onChange={(e) => setC({ ...c, factor: Number(e.target.value) })}
            className="mt-1.5 h-6 w-full"
            aria-valuetext={`times ${c.factor.toFixed(2)}`}
          />
          <div className="flex justify-between text-[11px] text-ink-3">
            <span>×1.00</span>
            <span>×1.60</span>
          </div>
        </div>

        <label htmlFor={ids.failure} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span className="text-sm">
            Vehicle unavailable
            <span className="block text-[12px] text-ink-3">The late van stops at its current position.</span>
          </span>
          <input id={ids.failure} type="checkbox" checked={c.failure} onChange={(e) => setC({ ...c, failure: e.target.checked })} className="h-5 w-5" />
        </label>

        <fieldset>
          <legend className="text-[12px] text-ink-2">Helpers available</legend>
          <ul className="mt-1.5 space-y-1">
            {scenario.vehicles
              .filter((v) => v.route_id !== c.donor)
              .map((v) => {
                const available = !c.excluded.includes(v.route_id);
                return (
                  <li key={v.route_id}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={available}
                        className="h-4.5 w-4.5"
                        onChange={(e) =>
                          setC({
                            ...c,
                            excluded: e.target.checked
                              ? c.excluded.filter((x) => x !== v.route_id)
                              : [...c.excluded, v.route_id].sort(),
                          })
                        }
                      />
                      <span>
                        {v.label} <span className="font-mono text-[11.5px] text-ink-3">{v.short_id}</span>
                        <span className="block text-[12px] text-ink-3">{v.remaining_stops} stops left</span>
                      </span>
                    </label>
                  </li>
                );
              })}
          </ul>
        </fieldset>

        <div>
          <p className="text-[12px] text-ink-2">Presets</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setC(p.apply(c))}
                className="h-9 rounded-[8px] border border-line px-2.5 text-[12.5px] text-ink-2 hover:bg-surface hover:text-ink"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="md" disabled={busy} className="flex-1">
          {busy ? "Calculating…" : "Recalculate rescue"}
        </Button>
        <Button type="button" variant="ghost" disabled={!changed || busy} onClick={() => setC(initial)}>
          Reset
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        {changed ? "Changed settings create a new scenario revision; the original stays unchanged." : "Runs the solver again on this exact scenario."}
      </p>
    </form>
  );
}
