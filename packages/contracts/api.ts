// Spareline API contract (v1). Mirrors services/api/app/api/schemas.py. All times are ISO-8601 UTC strings.
// Base URL: NEXT_PUBLIC_API_BASE_URL (e.g. https://<host>/v1). Mutating calls send header X-Spareline-Session.

export type Provenance = "HISTORICAL ROUTES" | "RECONSTRUCTED" | "SIMULATED DELAY" | "ESTIMATED TRANSFER TIME" | "MODEL RESULT";

export interface Health { service: string; version: string; status: "ok" }
export interface Ready { status: "ready" | "not_ready"; database: boolean; groups: number; curated_scenarios: number; estimator_version: string | null }

export interface Session { session: string } // POST /sessions -> signed opaque token, store in localStorage

export interface RouteGroup {
  id: string; station_code: string; date_utc: string; route_count: number;
  source_kind: "historical_research"; cross_route_travel_source: "estimated";
  partition: "development" | "evaluation"; route_ids: string[]; total_stops: number; total_packages: number;
  windowed_packages: number;
}

export interface StopGeo {
  route_id: string; stop_id: string; lat: number; lng: number; kind: "Station" | "Dropoff";
  zone_id: string | null; observed_sequence: number; package_count: number; windowed_count: number;
  volume_cm3: number; status: "completed" | "remaining" | "station";
}

export interface VehicleSummary {
  route_id: string; short_id: string; label: string; // label like "Van A"
  role: "donor" | "helper_candidate" | "unavailable";
  capacity_cm3: number; departure_utc: string; planned_finish_utc: string; duty_end_utc: string;
  position: { stop_id: string; lat: number; lng: number }; available_at_utc: string; operational: boolean;
  completed_stops: number; remaining_stops: number; remaining_packages: number; remaining_volume_cm3: number;
}

export interface Shock {
  kind: "delay" | "traffic_multiplier" | "vehicle_failure";
  delay_minutes: number; travel_time_factor: number; failure_after_stop_index: number | null;
}

export interface ScenarioCreate {
  route_group_id: string; donor_route_id: string; cutoff_utc?: string | null; seed: number; shock: Shock;
  excluded_helper_route_ids?: string[]; parent_scenario_id?: string | null;
}

export interface Scenario extends ScenarioCreate {
  id: string; created_at: string; curated: boolean; title: string | null; curated_key: string | null;
  cutoff_utc: string; // resolved
  provenance: { source: "amazon_historical_2018"; shock: "simulated"; cross_route_travel: "estimated"; dataset_hash: string; license: string; source_url: string };
  group: RouteGroup;
  vehicles: VehicleSummary[];
  stops: StopGeo[]; // every stop of every route in the group
  latest_run_id: string | null;
}

export type RunState = "queued" | "running" | "recommended" | "no_safe_rescue" | "low_confidence" | "timed_out" | "error";

export interface PolicyOutcome {
  policy: "no_intervention" | "nearest_feasible" | "spareline";
  transfer: boolean; helper_route_id: string | null; transfer_stop_count: number; transfer_package_count: number;
  windowed_total: number; windowed_on_time: number; windowed_late: number; late_minutes: number;
  packages_total: number; packages_after_shift: number; missed_total: number;
  helper_newly_missed: number | null; helper_newly_missed_conservative: number | null;
  drive_minutes: number; extra_drive_minutes: number; wait_minutes: number; latest_finish_utc: string;
  conservative: { missed_total: number; windowed_on_time: number } | null; // q90 cross-route travel
  invariant_errors: string[]; notes: string[];
}

export interface TimelineStop {
  route_id: string; stop_id: string; lat: number; lng: number; vehicle: string; // vehicle route_id that serves it
  arrival_utc: string; service_start_utc: string; package_count: number; windowed_count: number;
  window_end_utc: string | null; late_windowed: number; after_shift: boolean; transferred: boolean;
}

export interface TransferStop {
  route_id: string; stop_id: string; zone_id: string | null; lat: number; lng: number; package_count: number;
  windowed_count: number; volume_cm3: number; old_position: number; new_position: number;
  packages: { package_short: string; window_start_utc: string | null; window_end_utc: string | null; volume_cm3: number | null }[];
}

export interface CrossEdge { from_stop: string; to_stop: string; distance_km: number; mean_s: number; lower_s: number; upper_s: number; source: "estimated_cross_route"; confidence: "calibrated" | "extrapolated" }

export interface Solution {
  donor_route_id: string; helper_route_id: string;
  meeting: { route_id: string; stop_id: string; lat: number; lng: number; kind: "donor_position" | "donor_stop" | "helper_stop" | "helper_position" };
  donor_arrival_utc: string; helper_arrival_utc: string; meeting_time_utc: string; handoff_end_utc: string;
  handoff_minutes: number; wait_donor_minutes: number; wait_helper_minutes: number; first_to_arrive: "donor" | "helper";
  transfer: TransferStop[]; transfer_package_count: number; transfer_volume_cm3: number;
  helper_capacity_cm3: number; helper_load_after_handoff_cm3: number;
  validation: { volume_fits: boolean; time_windows_evaluated: boolean; handoff_feasible_under_model: boolean; no_new_late_on_helper: boolean };
  cross_route_edges: CrossEdge[];
}

export interface RejectedCandidate { policy?: string; helper_route_id: string; meeting?: [string, string]; transfer_stops?: number; reasons: string[]; missed_total?: number; helper_newly_missed?: number }

export interface RunStatus {
  run_id: string; scenario_id: string; state: RunState; revision: number; stage: string | null;
  reason_codes: string[]; duration_ms: number | null; created_at: string; completed_at: string | null;
  solution: Solution | null;
  comparisons: { no_intervention: PolicyOutcome; nearest_feasible: PolicyOutcome; spareline: PolicyOutcome } | null;
  timelines: { no_intervention: TimelineStop[]; nearest_feasible: TimelineStop[]; spareline: TimelineStop[] } | null;
  evidence: {
    algorithm_version: string; time_model_version: string; input_hash: string; dataset_hash: string;
    cutoff_utc: string; candidates_considered: number; candidates_refined: number; solver_status: string;
    rejected: RejectedCandidate[]; provenance: Record<string, string>;
    time_model: { id: string; holdout: Record<string, unknown>; cross_route_validated: false };
  } | null;
  error: { code: string; message: string; request_id: string } | null;
}

export interface DispatchState {
  run_id: string; revision: number;
  status: "proposed" | "approved_simulation" | "awaiting_handoff" | "transferred_simulation";
  donor_ack: boolean; helper_ack: boolean; approved_at: string | null; donor_ack_at: string | null;
  helper_ack_at: string | null; transferred_at: string | null;
}

export interface Manifest {
  run_id: string; role: "donor" | "helper"; route_id: string; label: string; status: DispatchState["status"];
  dispatch_time_utc: string; handoff: Solution["meeting"] & { time_utc: string; role_action: "hand over" | "receive" };
  rows: { seq: number; route_id: string; stop_id: string; zone_id: string | null; eta_utc: string; package_count: number;
          windows: string; transferred: boolean; packages: string[] }[];
  notes: string[];
}

export interface EvaluationSummary {
  status: "not_run" | "completed" | "partial"; evaluation_id: string | null; scenario_count: number | null;
  completed_at: string | null; algorithm_version: string | null; config: Record<string, unknown> | null;
  metrics: Record<string, unknown>; limitations: string[];
}
export type EvaluationRow = Record<string, unknown>;
