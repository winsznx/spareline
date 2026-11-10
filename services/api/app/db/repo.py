"""Database access. Plain SQL through SQLAlchemy Core; every query is parameterized."""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from typing import Any

from sqlalchemy import Connection, text

from app.db.core import engine
from app.solver.model import Group, group_from_records
from app.solver.travel import CrossRouteEstimator

_group_cache: OrderedDict[str, Group] = OrderedDict()
_group_lock = threading.Lock()
_estimator_cache: dict[str, tuple[CrossRouteEstimator, dict]] = {}


def _j(v: Any) -> str:
    return json.dumps(v, default=str)


def dataset_row(conn: Connection) -> dict | None:
    r = conn.execute(text("SELECT * FROM source_datasets ORDER BY slug LIMIT 1")).mappings().first()
    return dict(r) if r else None


def list_groups(conn: Connection, station: str | None, date: str | None, limit: int) -> list[dict]:
    q = """
      SELECT g.id, g.station_code, g.service_date, g.route_ids, g.partition,
        (SELECT count(*) FROM source_stops s WHERE s.route_id IN (SELECT jsonb_array_elements_text(g.route_ids))
           AND s.kind <> 'Station') AS total_stops,
        (SELECT count(*) FROM source_packages p WHERE p.route_id IN (SELECT jsonb_array_elements_text(g.route_ids)))
           AS total_packages,
        (SELECT count(*) FROM source_packages p WHERE p.route_id IN (SELECT jsonb_array_elements_text(g.route_ids))
           AND p.window_end_utc IS NOT NULL) AS windowed_packages
      FROM route_groups g
      WHERE (CAST(:station AS text) IS NULL OR g.station_code = :station)
        AND (CAST(:date AS date) IS NULL OR g.service_date = CAST(:date AS date))
      ORDER BY g.station_code, g.service_date, g.id
      LIMIT :limit"""
    rows = conn.execute(text(q), {"station": station, "date": date, "limit": limit}).mappings().all()
    return [dict(r) for r in rows]


def group_meta(conn: Connection, group_id: str) -> dict | None:
    r = conn.execute(text("SELECT * FROM route_groups WHERE id = :id"), {"id": group_id}).mappings().first()
    return dict(r) if r else None


def load_group(group_id: str) -> Group | None:
    with _group_lock:
        if group_id in _group_cache:
            _group_cache.move_to_end(group_id)
            return _group_cache[group_id]
    with engine().connect() as conn:
        meta = group_meta(conn, group_id)
        if meta is None:
            return None
        rids = list(meta["route_ids"])
        routes = conn.execute(text("SELECT * FROM source_routes WHERE id = ANY(:ids)"), {"ids": rids}).mappings().all()
        stops = (
            conn.execute(
                text("SELECT * FROM source_stops WHERE route_id = ANY(:ids) ORDER BY route_id, observed_sequence"),
                {"ids": rids},
            )
            .mappings()
            .all()
        )
        pkgs = (
            conn.execute(
                text("SELECT * FROM source_packages WHERE route_id = ANY(:ids) ORDER BY route_id, stop_id, package_id"),
                {"ids": rids},
            )
            .mappings()
            .all()
        )
    by_stop: dict[tuple[str, str], list[dict]] = {}
    for p in pkgs:
        by_stop.setdefault((p["route_id"], p["stop_id"]), []).append(
            {
                "id": p["package_id"],
                "window_start_utc": p["window_start_utc"].isoformat() if p["window_start_utc"] else None,
                "window_end_utc": p["window_end_utc"].isoformat() if p["window_end_utc"] else None,
                "planned_service_seconds": p["planned_service_seconds"],
                "volume_cm3": p["volume_cm3"],
            }
        )
    recs: dict[str, dict] = {}
    for r in routes:
        recs[r["id"]] = {
            "station_code": r["station_code"],
            "date": r["service_date"].isoformat(),
            "departure_utc": r["departure_utc"].isoformat(),
            "capacity_cm3": r["executor_capacity_cm3"],
            "travel": {"order": r["travel_order"], "seconds": r["travel_seconds"]},
            "stops": [],
        }
    for s in stops:
        recs[s["route_id"]]["stops"].append(
            {
                "id": s["stop_id"],
                "kind": s["kind"],
                "lat": s["lat"],
                "lng": s["lng"],
                "zone_id": s["zone_id"],
                "observed_sequence": s["observed_sequence"],
                "packages": by_stop.get((s["route_id"], s["stop_id"]), []),
            }
        )
    group = group_from_records(
        {
            "id": meta["id"],
            "station_code": meta["station_code"],
            "date": meta["service_date"].isoformat(),
            "route_ids": rids,
            "partition": meta["partition"],
        },
        recs,
    )
    with _group_lock:
        _group_cache[group_id] = group
        while len(_group_cache) > 48:
            _group_cache.popitem(last=False)
    return group


def load_estimator(conn: Connection | None = None) -> tuple[CrossRouteEstimator, dict] | None:
    if "current" in _estimator_cache:
        return _estimator_cache["current"]
    with engine().connect() as c:
        r = c.execute(text("SELECT * FROM travel_models ORDER BY created_at DESC LIMIT 1")).mappings().first()
    if r is None:
        return None
    est = CrossRouteEstimator.from_json(r["model"])
    _estimator_cache["current"] = (est, r["holdout"])
    return _estimator_cache["current"]


def insert_scenario(conn: Connection, **f: Any) -> dict:
    row = (
        conn.execute(
            text("""INSERT INTO scenarios (group_id, donor_route_id, cutoff_utc, seed, shock, excluded_helpers,
                  is_curated, curated_key, title, session_key_hash, parent_scenario_id, source_hash)
                VALUES (:group_id, :donor_route_id, :cutoff_utc, :seed, CAST(:shock AS jsonb),
                  CAST(:excluded AS jsonb), :is_curated, :curated_key, :title, :session, :parent, :source_hash)
                RETURNING *"""),
            {**f, "shock": _j(f["shock"]), "excluded": _j(f["excluded"])},
        )
        .mappings()
        .one()
    )
    return dict(row)


def get_scenario(conn: Connection, scenario_id: str) -> dict | None:
    r = (
        conn.execute(text("SELECT * FROM scenarios WHERE id = CAST(:id AS uuid)"), {"id": scenario_id})
        .mappings()
        .first()
    )
    return dict(r) if r else None


def list_scenarios(conn: Connection, session_hash: str | None) -> list[dict]:
    rows = (
        conn.execute(
            text("""SELECT s.*, (SELECT r.id FROM solver_runs r WHERE r.scenario_id = s.id
                               ORDER BY r.started_at DESC LIMIT 1) AS latest_run_id
                FROM scenarios s
                WHERE s.is_curated OR (CAST(:sess AS text) IS NOT NULL AND s.session_key_hash = :sess)
                ORDER BY s.is_curated DESC, s.curated_key NULLS LAST, s.created_at DESC LIMIT 60"""),
            {"sess": session_hash},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


def latest_run_id(conn: Connection, scenario_id: str) -> str | None:
    r = conn.execute(
        text("SELECT id FROM solver_runs WHERE scenario_id = CAST(:id AS uuid) ORDER BY started_at DESC LIMIT 1"),
        {"id": scenario_id},
    ).first()
    return str(r[0]) if r else None


def find_run_by_input(conn: Connection, scenario_id: str, input_hash: str) -> dict | None:
    r = (
        conn.execute(
            text("""SELECT * FROM solver_runs WHERE scenario_id = CAST(:sid AS uuid) AND input_hash = :h
                AND state NOT IN ('error') ORDER BY started_at DESC LIMIT 1"""),
            {"sid": scenario_id, "h": input_hash},
        )
        .mappings()
        .first()
    )
    return dict(r) if r else None


def create_run(conn: Connection, scenario_id: str, algorithm: str, time_model: str, input_hash: str) -> dict:
    return dict(
        conn.execute(
            text("""INSERT INTO solver_runs
                  (scenario_id, state, stage, algorithm_version, time_model_version, input_hash)
                VALUES (CAST(:sid AS uuid), 'queued', 'queued', :a, :t, :h) RETURNING *"""),
            {"sid": scenario_id, "a": algorithm, "t": time_model, "h": input_hash},
        )
        .mappings()
        .one()
    )


def update_run(run_id: str, **f: Any) -> None:
    sets, params = [], {"id": run_id}
    for k, v in f.items():
        if k in ("reason_codes", "solution", "comparisons", "timelines", "evidence", "error"):
            sets.append(f"{k} = CAST(:{k} AS jsonb)")
            params[k] = _j(v)
        elif k == "completed":
            sets.append("completed_at = now()")
        else:
            sets.append(f"{k} = :{k}")
            params[k] = v
    with engine().begin() as conn:
        conn.execute(text(f"UPDATE solver_runs SET {', '.join(sets)} WHERE id = CAST(:id AS uuid)"), params)


def get_run(conn: Connection, run_id: str) -> dict | None:
    r = conn.execute(text("SELECT * FROM solver_runs WHERE id = CAST(:id AS uuid)"), {"id": run_id}).mappings().first()
    return dict(r) if r else None
