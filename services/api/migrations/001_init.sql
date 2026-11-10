-- Spareline schema v1. Adapted from internal SCHEMA.sql:
--  * route groups use deterministic text IDs derived from (station, date, route_ids)
--  * the within-route travel matrix is stored as one JSONB matrix per route (order + seconds) instead of
--    one row per stop pair (~21k pairs per route); it is still keyed by route and validated on import.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE source_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  dataset_year INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  acquired_at TIMESTAMPTZ,
  sha256_manifest TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE source_routes (
  id TEXT PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES source_datasets(id),
  station_code TEXT NOT NULL,
  service_date DATE NOT NULL,
  departure_utc TIMESTAMPTZ NOT NULL,
  executor_capacity_cm3 DOUBLE PRECISION NOT NULL CHECK (executor_capacity_cm3 > 0),
  travel_order JSONB NOT NULL,
  travel_seconds JSONB NOT NULL
);
CREATE INDEX source_routes_group_idx ON source_routes(station_code, service_date);

CREATE TABLE source_stops (
  route_id TEXT NOT NULL REFERENCES source_routes(id),
  stop_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  zone_id TEXT,
  observed_sequence INTEGER NOT NULL,
  PRIMARY KEY (route_id, stop_id)
);

CREATE TABLE source_packages (
  route_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  window_start_utc TIMESTAMPTZ,
  window_end_utc TIMESTAMPTZ,
  planned_service_seconds DOUBLE PRECISION NOT NULL,
  volume_cm3 DOUBLE PRECISION CHECK (volume_cm3 IS NULL OR volume_cm3 >= 0),
  dimensions JSONB,
  PRIMARY KEY (route_id, stop_id, package_id),
  FOREIGN KEY (route_id, stop_id) REFERENCES source_stops(route_id, stop_id),
  CHECK (window_start_utc IS NULL OR window_end_utc IS NULL OR window_start_utc <= window_end_utc)
);

CREATE TABLE route_groups (
  id TEXT PRIMARY KEY,
  station_code TEXT NOT NULL,
  service_date DATE NOT NULL,
  route_ids JSONB NOT NULL,
  partition TEXT NOT NULL CHECK (partition IN ('development', 'evaluation')),
  selection_method TEXT NOT NULL,
  provenance JSONB NOT NULL
);

CREATE TABLE travel_models (
  version TEXT PRIMARY KEY,
  model JSONB NOT NULL,
  holdout JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id TEXT NOT NULL REFERENCES route_groups(id),
  donor_route_id TEXT NOT NULL REFERENCES source_routes(id),
  cutoff_utc TIMESTAMPTZ,
  seed INTEGER NOT NULL,
  shock JSONB NOT NULL,
  excluded_helpers JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_curated BOOLEAN NOT NULL DEFAULT FALSE,
  curated_key TEXT UNIQUE,
  title TEXT,
  session_key_hash TEXT,
  parent_scenario_id UUID REFERENCES scenarios(id),
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scenarios_session_idx ON scenarios(session_key_hash, created_at DESC);

CREATE TABLE solver_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES scenarios(id),
  state TEXT NOT NULL,
  stage TEXT,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  algorithm_version TEXT NOT NULL,
  time_model_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  solution JSONB,
  comparisons JSONB,
  timelines JSONB,
  evidence JSONB,
  error JSONB,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX solver_runs_scenario_idx ON solver_runs(scenario_id, started_at DESC);
CREATE INDEX solver_runs_input_idx ON solver_runs(input_hash);

CREATE TABLE dispatch_states (
  run_id UUID NOT NULL REFERENCES solver_runs(id),
  session_key_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('proposed','approved_simulation','awaiting_handoff','transferred_simulation')),
  approved_at TIMESTAMPTZ,
  donor_ack_at TIMESTAMPTZ,
  helper_ack_at TIMESTAMPTZ,
  transferred_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, session_key_hash)
);

CREATE TABLE dispatch_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES solver_runs(id),
  action TEXT NOT NULL CHECK (action IN ('approve_simulation','donor_ack','helper_ack','reset')),
  expected_revision INTEGER NOT NULL,
  actor_session_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY,
  config_sha256 TEXT NOT NULL,
  dataset_sha256 TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  status TEXT NOT NULL,
  config JSONB NOT NULL,
  summary JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE TABLE evaluation_results (
  evaluation_id TEXT NOT NULL REFERENCES evaluation_runs(id),
  idx INTEGER NOT NULL,
  row JSONB NOT NULL,
  PRIMARY KEY (evaluation_id, idx)
);
