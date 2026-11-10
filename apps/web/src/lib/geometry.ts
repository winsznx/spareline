import type { RunStatus, Scenario, TimelineStop } from "./api-types";

export type LngLat = [number, number];
export type VehicleRole = "donor" | "helper" | "other";

export interface VehicleGeometry {
  routeId: string;
  label: string;
  role: VehicleRole;
  completed: LngLat[];
  planned: LngLat[];
  position: LngLat;
  operational: boolean;
}

export interface StopPoint {
  routeId: string;
  stopId: string;
  lngLat: LngLat;
  status: "completed" | "remaining" | "transferred" | "station";
  lateWindowed: number;
  afterShift: boolean;
  servedBy: string | null;
  etaUtc: string | null;
  windowEndUtc: string | null;
  packageCount: number;
  windowedCount: number;
}

export interface SceneGeometry {
  vehicles: VehicleGeometry[];
  stops: StopPoint[];
  meeting: { lngLat: LngLat; label: string } | null;
  bounds: [LngLat, LngLat] | null;
  policy: "no_intervention" | "spareline" | "nearest_feasible" | "observed";
}

export const ROUTE_COLORS = { donor: "#171C22", helper: "#A76941", other: "#426886" } as const;

type PolicyKey = "no_intervention" | "nearest_feasible" | "spareline";

export function choosePolicy(run: RunStatus | null | undefined): PolicyKey | "observed" {
  if (!run?.timelines) return "observed";
  return run.state === "recommended" || run.state === "timed_out" ? "spareline" : "no_intervention";
}

export function buildScene(scenario: Scenario, run: RunStatus | null | undefined, policyOverride?: PolicyKey): SceneGeometry {
  const policy = policyOverride && run?.timelines ? policyOverride : choosePolicy(run);
  const timeline: TimelineStop[] | null = policy !== "observed" && run?.timelines ? run.timelines[policy] : null;
  const solution = policy === "spareline" ? run?.solution ?? null : null;
  const nearestComparison = policy === "nearest_feasible" ? run?.comparisons?.nearest_feasible : null;
  const helperId = solution?.helper_route_id ?? nearestComparison?.helper_route_id ?? null;

  const timelineByKey = new Map<string, TimelineStop>();
  timeline?.forEach((t) => timelineByKey.set(`${t.route_id}|${t.stop_id}`, t));

  const stops: StopPoint[] = scenario.stops.map((s) => {
    const t = timelineByKey.get(`${s.route_id}|${s.stop_id}`);
    const status: StopPoint["status"] =
      s.status === "station" ? "station" : s.status === "completed" ? "completed" : t?.transferred ? "transferred" : "remaining";
    return {
      routeId: s.route_id,
      stopId: s.stop_id,
      lngLat: [s.lng, s.lat],
      status,
      lateWindowed: t?.late_windowed ?? 0,
      afterShift: t?.after_shift ?? false,
      servedBy: t?.vehicle ?? (s.status === "remaining" ? s.route_id : null),
      etaUtc: t?.service_start_utc ?? null,
      windowEndUtc: t?.window_end_utc ?? null,
      packageCount: s.package_count,
      windowedCount: s.windowed_count,
    };
  });

  const vehicles: VehicleGeometry[] = scenario.vehicles.map((v) => {
    const role: VehicleRole = v.route_id === scenario.donor_route_id ? "donor" : v.route_id === helperId ? "helper" : "other";
    const own = scenario.stops
      .filter((s) => s.route_id === v.route_id)
      .sort((a, b) => a.observed_sequence - b.observed_sequence);
    // The station is often far from the delivery area; leaving it out keeps the drawing on the work that matters.
    const completed: LngLat[] = own.filter((s) => s.status === "completed").map((s) => [s.lng, s.lat]);
    const position: LngLat = [v.position.lng, v.position.lat];
    let planned: LngLat[];
    if (timeline) {
      const served = timeline
        .filter((t) => t.vehicle === v.route_id)
        .sort((a, b) => a.service_start_utc.localeCompare(b.service_start_utc));
      const atStation = scenario.stops.some((s) => s.status === "station" && s.route_id === v.route_id && s.stop_id === v.position.stop_id);
      const pts: LngLat[] = atStation ? [] : [position];
      let meetingInserted = !solution || (v.route_id !== solution.donor_route_id && v.route_id !== solution.helper_route_id);
      for (const t of served) {
        if (!meetingInserted && solution && t.service_start_utc > solution.meeting_time_utc) {
          pts.push([solution.meeting.lng, solution.meeting.lat]);
          meetingInserted = true;
        }
        pts.push([t.lng, t.lat]);
      }
      if (!meetingInserted && solution) pts.push([solution.meeting.lng, solution.meeting.lat]);
      planned = pts;
    } else {
      const remaining = own.filter((s) => s.status === "remaining").map((s) => [s.lng, s.lat] as LngLat);
      const atStation = own.some((s) => s.status === "station" && s.stop_id === v.position.stop_id);
      planned = atStation ? remaining : [position, ...remaining];
    }
    return { routeId: v.route_id, label: v.label, role, completed, planned, position, operational: v.operational };
  });

  let bounds: [LngLat, LngLat] | null = null;
  for (const s of stops) {
    if (s.status === "station") continue;
    const [x, y] = s.lngLat;
    if (!bounds) bounds = [[x, y], [x, y]];
    else {
      bounds[0][0] = Math.min(bounds[0][0], x);
      bounds[0][1] = Math.min(bounds[0][1], y);
      bounds[1][0] = Math.max(bounds[1][0], x);
      bounds[1][1] = Math.max(bounds[1][1], y);
    }
  }

  return {
    vehicles,
    stops,
    meeting: solution ? { lngLat: [solution.meeting.lng, solution.meeting.lat], label: `Handoff ${solution.meeting.stop_id}` } : null,
    bounds,
    policy,
  };
}

export function vehicleLabel(scenario: Scenario | undefined, routeId: string | null | undefined): string {
  if (!routeId) return "—";
  return scenario?.vehicles.find((v) => v.route_id === routeId)?.label ?? routeId.slice(0, 16);
}
