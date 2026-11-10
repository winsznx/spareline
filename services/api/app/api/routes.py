from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import secrets
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text

from app.config import SERVICE_NAME, SERVICE_VERSION, get_settings
from app.db import repo
from app.db.core import engine
from app.services import jobs, serialize
from app.solver.rescue import ALGORITHM_VERSION
from app.solver.scenario import build_states

router = APIRouter(prefix="/v1")


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(status_code=status, detail={"code": code, "message": message})


# ---------- sessions ----------


def _sign(raw: str) -> str:
    key = get_settings().session_signing_key.encode()
    return hmac.new(key, raw.encode(), hashlib.sha256).hexdigest()[:32]


def new_session_token() -> str:
    raw = secrets.token_urlsafe(18)
    return f"{raw}.{_sign(raw)}"


def session_hash(token: str | None) -> str | None:
    if not token or "." not in token or len(token) > 200:
        return None
    raw, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(raw)):
        return None
    return hashlib.sha256(raw.encode()).hexdigest()


def require_session(token: str | None) -> str:
    h = session_hash(token)
    if h is None:
        raise ApiError(401, "session_required", "A valid demo session is required. Reload the page to start one.")
    return h


SessionHeader = Annotated[str | None, Header(alias="X-Spareline-Session")]


# ---------- schemas ----------


class ShockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["delay", "traffic_multiplier", "vehicle_failure"]
    delay_minutes: int = Field(0, ge=0, le=240)
    travel_time_factor: float = Field(1.0, ge=1.0, le=3.0)
    failure_after_stop_index: int | None = Field(None, ge=0, le=400)


class ScenarioCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route_group_id: str = Field(min_length=4, max_length=80, pattern=r"^grp_[A-Za-z0-9_\-]+$")
    donor_route_id: str = Field(min_length=4, max_length=80, pattern=r"^RouteID_[0-9a-f\-]+$")
    cutoff_utc: datetime | None = None
    seed: int = Field(0, ge=0, le=2**31 - 1)
    shock: ShockIn
    excluded_helper_route_ids: list[str] = Field(default_factory=list, max_length=5)
    parent_scenario_id: str | None = Field(None, max_length=40)

    @field_validator("cutoff_utc")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("cutoff_utc must include a timezone (use Z for UTC)")
        return v


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    solver_time_limit_seconds: int = Field(15, ge=1, le=60)


class ApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)


class AckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    driver_role: Literal["donor", "helper"]
    expected_revision: int = Field(ge=0)


# ---------- system ----------


@router.get("/healthz")
def healthz() -> dict:
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "ok"}


@router.get("/readyz")
def readyz() -> JSONResponse:
    body = {"status": "not_ready", "database": False, "groups": 0, "curated_scenarios": 0, "estimator_version": None}
    try:
        with engine().connect() as c:
            body["database"] = True
            body["groups"] = c.execute(text("SELECT count(*) FROM route_groups")).scalar_one()
            body["curated_scenarios"] = c.execute(text("SELECT count(*) FROM scenarios WHERE is_curated")).scalar_one()
            body["estimator_version"] = c.execute(
                text("SELECT version FROM travel_models ORDER BY created_at DESC LIMIT 1")
            ).scalar()
    except Exception:  # noqa: BLE001 - readiness reports dependency failure as a status, not an exception
        return JSONResponse(body, status_code=503)
    ok = body["groups"] > 0 and body["estimator_version"] is not None
    body["status"] = "ready" if ok else "not_ready"
    return JSONResponse(body, status_code=200 if ok else 503)


@router.post("/sessions", status_code=201)
def create_session() -> dict:
    return {"session": new_session_token()}


# ---------- datasets ----------


def _group_out(g: dict) -> dict:
    return {
        "id": g["id"],
        "station_code": g["station_code"],
        "date_utc": g["service_date"].isoformat(),
        "route_count": len(g["route_ids"]),
        "source_kind": "historical_research",
        "cross_route_travel_source": "estimated",
        "partition": g["partition"],
        "route_ids": list(g["route_ids"]),
        "total_stops": g.get("total_stops"),
        "total_packages": g.get("total_packages"),
        "windowed_packages": g.get("windowed_packages"),
    }


@router.get("/datasets/groups")
def datasets_groups(
    station: Annotated[str | None, Query(max_length=8, pattern=r"^[A-Z0-9]+$")] = None,
    date: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}-\d{2}$")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    with engine().connect() as c:
        return {"items": [_group_out(g) for g in repo.list_groups(c, station, date, limit)]}


# ---------- scenarios ----------


def _scenario_out(c, sc: dict, full: bool) -> dict:
    ds = repo.dataset_row(c) or {}
    meta = repo.group_meta(c, sc["group_id"])
    groups = repo.list_groups(c, meta["station_code"], meta["service_date"].isoformat(), 100)
    gout = _group_out(next(g for g in groups if g["id"] == sc["group_id"]))
    out = {
        "id": str(sc["id"]),
        "created_at": sc["created_at"].isoformat(),
        "curated": sc["is_curated"],
        "curated_key": sc["curated_key"],
        "title": sc["title"],
        "route_group_id": sc["group_id"],
        "donor_route_id": sc["donor_route_id"],
        "seed": sc["seed"],
        "shock": sc["shock"],
        "excluded_helper_route_ids": list(sc["excluded_helpers"] or []),
        "parent_scenario_id": str(sc["parent_scenario_id"]) if sc["parent_scenario_id"] else None,
        "provenance": {
            "source": "amazon_historical_2018",
            "shock": "simulated",
            "cross_route_travel": "estimated",
            "dataset_hash": ds.get("sha256_manifest"),
            "license": ds.get("license_name"),
            "source_url": ds.get("source_url"),
        },
        "group": gout,
        "latest_run_id": sc.get("latest_run_id") and str(sc["latest_run_id"]) or repo.latest_run_id(c, str(sc["id"])),
        "vehicles": [],
        "stops": [],
        "cutoff_utc": sc["cutoff_utc"].isoformat() if sc["cutoff_utc"] else None,
    }
    if full or out["cutoff_utc"] is None:
        group = repo.load_group(sc["group_id"])
        states, cutoff = build_states(group, jobs.spec_from_row(sc))
        out["cutoff_utc"] = serialize.iso(cutoff)
        if full:
            out["vehicles"] = serialize.vehicles_payload(
                group, states, sc["donor_route_id"], set(sc["excluded_helpers"] or [])
            )
            out["stops"] = serialize.stops_payload(group, states)
    return out


@router.get("/scenarios")
def list_scenarios(x_session: SessionHeader = None) -> list[dict]:
    with engine().connect() as c:
        return [_scenario_out(c, s, False) for s in repo.list_scenarios(c, session_hash(x_session))]


@router.post("/scenarios", status_code=201)
def create_scenario(body: ScenarioCreate, x_session: SessionHeader = None) -> dict:
    sess = require_session(x_session)
    with engine().begin() as c:
        meta = repo.group_meta(c, body.route_group_id)
        if meta is None:
            raise ApiError(404, "group_not_found", "Route group not found.")
        if body.donor_route_id not in meta["route_ids"]:
            raise ApiError(422, "donor_not_in_group", "The delayed route must belong to the selected route group.")
        bad = [h for h in body.excluded_helper_route_ids if h not in meta["route_ids"]]
        if bad:
            raise ApiError(422, "helper_not_in_group", "Excluded helpers must belong to the route group.")
        count = c.execute(
            text(
                "SELECT count(*) FROM scenarios WHERE session_key_hash = :s AND created_at > now() - interval '1 hour'"
            ),
            {"s": sess},
        ).scalar_one()
        if count >= 60:
            raise ApiError(429, "scenario_quota", "Scenario limit reached for this demo session. Try again later.")
        ds = repo.dataset_row(c)
        parent = None
        if body.parent_scenario_id:
            p = repo.get_scenario(c, body.parent_scenario_id) if _is_uuid(body.parent_scenario_id) else None
            parent = str(p["id"]) if p else None
        group = repo.load_group(body.route_group_id)
        total = sum(len(r.stops) - 1 for r in group.routes.values())
        if total > get_settings().max_scenario_stops * 2:
            raise ApiError(422, "too_many_stops", "This route group exceeds the demo complexity limit.")
        sc = repo.insert_scenario(
            c,
            group_id=body.route_group_id,
            donor_route_id=body.donor_route_id,
            cutoff_utc=body.cutoff_utc,
            seed=body.seed,
            shock=body.shock.model_dump(),
            excluded=body.excluded_helper_route_ids,
            is_curated=False,
            curated_key=None,
            title=None,
            session=sess,
            parent=parent,
            source_hash=ds["sha256_manifest"],
        )
        sc["latest_run_id"] = None
        try:
            return _scenario_out(c, sc, True)
        except ValueError as exc:
            raise ApiError(422, "invalid_scenario", str(exc)) from exc


def _is_uuid(v: str) -> bool:
    import uuid

    try:
        uuid.UUID(v)
        return True
    except ValueError:
        return False


def _scenario_or_404(c, scenario_id: str) -> dict:
    sc = repo.get_scenario(c, scenario_id) if _is_uuid(scenario_id) else None
    if sc is None:
        raise ApiError(404, "scenario_not_found", "Scenario not found.")
    return sc


@router.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: str) -> dict:
    with engine().connect() as c:
        return _scenario_out(c, _scenario_or_404(c, scenario_id), True)


@router.post("/scenarios/{scenario_id}/run", status_code=202)
def run_scenario(scenario_id: str, body: RunRequest | None = None) -> dict:
    body = body or RunRequest()
    with engine().begin() as c:
        sc = _scenario_or_404(c, scenario_id)
        ds = repo.dataset_row(c)
        loaded = repo.load_estimator()
        if loaded is None:
            raise ApiError(503, "not_ready", "The travel model is not loaded yet.")
        est, _ = loaded
        h = jobs.input_hash(sc, ds["sha256_manifest"], est.version, body.solver_time_limit_seconds)
        existing = repo.find_run_by_input(c, scenario_id, h)
        if existing is not None:
            return _run_out(existing)
        run = repo.create_run(c, scenario_id, ALGORITHM_VERSION, est.version, h)
    payload = {
        **sc,
        "_input_hash": h,
        "id": str(sc["id"]),
        "parent_scenario_id": str(sc["parent_scenario_id"]) if sc["parent_scenario_id"] else None,
    }
    jobs.submit(str(run["id"]), payload, body.solver_time_limit_seconds, ds["sha256_manifest"])
    return _run_out(run)


def _run_out(r: dict) -> dict:
    return {
        "run_id": str(r["id"]),
        "scenario_id": str(r["scenario_id"]),
        "state": r["state"],
        "revision": 0,
        "stage": r["stage"],
        "reason_codes": r["reason_codes"] or [],
        "duration_ms": r["duration_ms"],
        "created_at": r["started_at"].isoformat(),
        "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
        "solution": r["solution"],
        "comparisons": r["comparisons"],
        "timelines": r["timelines"],
        "evidence": r["evidence"],
        "error": r["error"],
    }


def _run_or_404(c, run_id: str) -> dict:
    r = repo.get_run(c, run_id) if _is_uuid(run_id) else None
    if r is None:
        raise ApiError(404, "run_not_found", "Run not found.")
    return r


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict:
    with engine().connect() as c:
        out = _run_out(_run_or_404(c, run_id))
    if out["error"]:
        out["error"]["request_id"] = request.state.request_id
    return out


# ---------- dispatch (per demo session) ----------


def _dispatch_row(c, run_id: str, sess: str) -> dict:
    r = (
        c.execute(
            text("SELECT * FROM dispatch_states WHERE run_id = CAST(:r AS uuid) AND session_key_hash = :s"),
            {"r": run_id, "s": sess},
        )
        .mappings()
        .first()
    )
    return (
        dict(r)
        if r
        else {
            "run_id": run_id,
            "revision": 0,
            "status": "proposed",
            "approved_at": None,
            "donor_ack_at": None,
            "helper_ack_at": None,
            "transferred_at": None,
        }
    )


def _dispatch_out(d: dict) -> dict:
    def t(v):
        return v.isoformat() if v else None

    return {
        "run_id": str(d["run_id"]),
        "revision": d["revision"],
        "status": d["status"],
        "donor_ack": d["donor_ack_at"] is not None,
        "helper_ack": d["helper_ack_at"] is not None,
        "approved_at": t(d["approved_at"]),
        "donor_ack_at": t(d["donor_ack_at"]),
        "helper_ack_at": t(d["helper_ack_at"]),
        "transferred_at": t(d["transferred_at"]),
    }


@router.get("/runs/{run_id}/dispatch")
def get_dispatch(run_id: str, x_session: SessionHeader = None) -> dict:
    sess = require_session(x_session)
    with engine().connect() as c:
        _run_or_404(c, run_id)
        return _dispatch_out(_dispatch_row(c, run_id, sess))


@router.post("/runs/{run_id}/approve")
def approve(run_id: str, body: ApproveIn, x_session: SessionHeader = None) -> dict:
    sess = require_session(x_session)
    with engine().begin() as c:
        run = _run_or_404(c, run_id)
        c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{run_id}:{sess}"})
        if run["state"] not in ("recommended", "timed_out") or not run["solution"]:
            raise ApiError(409, "not_recommendable", "Only a recommended rescue can be approved.")
        cur = _dispatch_row(c, run_id, sess)
        if cur["status"] != "proposed":
            raise ApiError(409, "already_approved", "This plan was approved. Create a new revision to change it.")
        if cur["revision"] != body.expected_revision:
            raise ApiError(409, "revision_conflict", "This plan changed in another tab. Reload to continue.")
        c.execute(
            text("""INSERT INTO dispatch_states (run_id, session_key_hash, revision, status, approved_at)
                          VALUES (CAST(:r AS uuid), :s, 1, 'awaiting_handoff', now())"""),
            {"r": run_id, "s": sess},
        )
        c.execute(
            text("""INSERT INTO dispatch_actions (run_id, action, expected_revision, actor_session_hash)
                          VALUES (CAST(:r AS uuid), 'approve_simulation', :e, :s)"""),
            {"r": run_id, "e": body.expected_revision, "s": sess},
        )
        return _dispatch_out(_dispatch_row(c, run_id, sess))


@router.post("/runs/{run_id}/handoff-ack")
def handoff_ack(run_id: str, body: AckIn, x_session: SessionHeader = None) -> dict:
    sess = require_session(x_session)
    with engine().begin() as c:
        _run_or_404(c, run_id)
        c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{run_id}:{sess}"})
        cur = _dispatch_row(c, run_id, sess)
        if cur["status"] == "proposed":
            raise ApiError(409, "not_approved", "Approve the simulated plan before recording handoff confirmations.")
        if cur["status"] == "transferred_simulation":
            raise ApiError(409, "already_recorded", "Both confirmations are already recorded.")
        if cur["revision"] != body.expected_revision:
            raise ApiError(409, "revision_conflict", "This plan changed in another tab. Reload to continue.")
        col = "donor_ack_at" if body.driver_role == "donor" else "helper_ack_at"
        if cur[col] is not None:
            raise ApiError(409, "already_acknowledged", f"The {body.driver_role} confirmation is already recorded.")
        c.execute(
            text(f"""UPDATE dispatch_states SET {col} = now(), revision = revision + 1
                           WHERE run_id = CAST(:r AS uuid) AND session_key_hash = :s"""),
            {"r": run_id, "s": sess},
        )
        c.execute(
            text("""UPDATE dispatch_states SET status = 'transferred_simulation', transferred_at = now()
                          WHERE run_id = CAST(:r AS uuid) AND session_key_hash = :s
                            AND donor_ack_at IS NOT NULL AND helper_ack_at IS NOT NULL"""),
            {"r": run_id, "s": sess},
        )
        c.execute(
            text("""INSERT INTO dispatch_actions (run_id, action, expected_revision, actor_session_hash)
                          VALUES (CAST(:r AS uuid), :a, :e, :s)"""),
            {"r": run_id, "a": f"{body.driver_role}_ack", "e": body.expected_revision, "s": sess},
        )
        return _dispatch_out(_dispatch_row(c, run_id, sess))


# ---------- manifests ----------


def _manifest(c, run: dict, role: str, dispatch: dict) -> dict:
    sol = run["solution"]
    if run["state"] not in ("recommended", "timed_out") or not sol:
        raise ApiError(409, "no_rescue_plan", "No transfer is recommended for this run, so there is no manifest.")
    sc = repo.get_scenario(c, str(run["scenario_id"]))
    group = repo.load_group(sc["group_id"])
    labels = serialize.vehicle_labels(group, sc["donor_route_id"])
    route_id = sol["donor_route_id"] if role == "donor" else sol["helper_route_id"]
    rows = [s for s in run["timelines"]["spareline"] if s["vehicle"] == route_id]
    pk = {(t["route_id"], t["stop_id"]): [p["package_short"] for p in t["packages"]] for t in sol["transfer"]}
    out_rows = []
    for i, s in enumerate(rows, 1):
        stop = group.stop((s["route_id"], s["stop_id"]))
        wins = sorted(
            {
                f"{serialize.iso(p.window_start)[11:16]}-{serialize.iso(p.window_end)[11:16]} UTC"
                for p in stop.packages
                if p.window_end is not None and p.window_start is not None
            }
        )
        out_rows.append(
            {
                "seq": i,
                "route_id": s["route_id"],
                "stop_id": s["stop_id"],
                "zone_id": stop.zone_id,
                "eta_utc": s["service_start_utc"],
                "package_count": s["package_count"],
                "windows": "; ".join(wins),
                "transferred": s["transferred"],
                "packages": pk.get((s["route_id"], s["stop_id"]))
                or [serialize.short_id(p.package_id) for p in stop.packages],
            }
        )
    moved = ", ".join(f"{t['stop_id']} ({t['package_count']} pkg)" for t in sol["transfer"])
    notes = [
        "Research replay of historical 2018 routes. The disruption is simulated; this is not a live dispatch.",
        "ETAs are model results reconstructed from historical average travel times.",
        "Cross-route travel to the handoff point is estimated, not observed.",
    ]
    if role == "donor":
        notes.append(f"Hand over these stop groups at the meeting point: {moved}.")
    else:
        notes.append(f"Receive these stop groups at the meeting point, then deliver them in the order shown: {moved}.")
    if dispatch["status"] == "proposed":
        notes.append("PROPOSED ONLY: not approved by the dispatcher. Do not move parcels.")
    elif dispatch["status"] != "transferred_simulation":
        notes.append("Approved in simulation. Parcels are not recorded as transferred until both drivers confirm.")
    return {
        "run_id": str(run["id"]),
        "role": role,
        "route_id": route_id,
        "label": labels[route_id],
        "status": dispatch["status"],
        "dispatch_time_utc": dispatch["approved_at"]
        and dispatch["approved_at"].isoformat()
        or run["completed_at"].isoformat(),
        "handoff": {
            **sol["meeting"],
            "time_utc": sol["meeting_time_utc"],
            "role_action": "hand over" if role == "donor" else "receive",
        },
        "rows": out_rows,
        "notes": notes,
    }


@router.get("/runs/{run_id}/manifests/{role}.csv")
def manifest_csv(
    run_id: str,
    role: Literal["donor", "helper"],
    session: Annotated[str | None, Query(max_length=200)] = None,
    x_session: SessionHeader = None,
) -> Response:
    sess = require_session(x_session or session)
    with engine().connect() as c:
        run = _run_or_404(c, run_id)
        dispatch = _dispatch_row(c, run_id, sess)
        if dispatch["status"] == "proposed":
            raise ApiError(409, "not_approved", "Approve the simulated plan before exporting driver manifests.")
        m = _manifest(c, run, role, dispatch)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "record",
            "seq",
            "route_label",
            "route_id",
            "stop_id",
            "zone_id",
            "eta_utc",
            "package_count",
            "delivery_windows_utc",
            "transferred_at_handoff",
            "package_ids_short",
            "provenance",
        ]
    )
    w.writerow(
        [
            "meta",
            "",
            m["label"],
            m["route_id"],
            "",
            "",
            m["dispatch_time_utc"],
            "",
            "",
            "",
            f"run={m['run_id']} status={m['status']}",
            "historical routes + simulated disruption",
        ]
    )
    h = m["handoff"]
    w.writerow(
        [
            "handoff",
            "",
            m["label"],
            h["route_id"],
            h["stop_id"],
            "",
            h["time_utc"],
            "",
            "",
            h["role_action"],
            "",
            "estimated transfer time; model result",
        ]
    )
    for r in m["rows"]:
        w.writerow(
            [
                "stop",
                r["seq"],
                m["label"],
                r["route_id"],
                r["stop_id"],
                r["zone_id"] or "",
                r["eta_utc"],
                r["package_count"],
                r["windows"],
                "yes" if r["transferred"] else "no",
                " ".join(r["packages"]),
                "reconstructed ETA; model result",
            ]
        )
    for n in m["notes"]:
        w.writerow(["note", "", "", "", "", "", "", "", "", "", n, ""])
    fname = f"spareline-{m['run_id'][:8]}-{role}-manifest.csv"
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/runs/{run_id}/manifests/{role}")
def manifest_json(run_id: str, role: Literal["donor", "helper"], x_session: SessionHeader = None) -> dict:
    sess = session_hash(x_session)
    with engine().connect() as c:
        run = _run_or_404(c, run_id)
        dispatch = _dispatch_row(c, run_id, sess) if sess else _dispatch_row(c, run_id, "-")
        return _manifest(c, run, role, dispatch)


# ---------- research ----------


def _latest_eval(c) -> dict | None:
    r = (
        c.execute(text("SELECT * FROM evaluation_runs ORDER BY completed_at DESC NULLS LAST LIMIT 1"))
        .mappings()
        .first()
    )
    return dict(r) if r else None


@router.get("/evaluations/summary")
def evaluation_summary() -> dict:
    with engine().connect() as c:
        ev = _latest_eval(c)
    if ev is None:
        return {
            "status": "not_run",
            "evaluation_id": None,
            "scenario_count": None,
            "completed_at": None,
            "algorithm_version": None,
            "config": None,
            "metrics": {},
            "limitations": ["No evaluation has been run yet."],
        }
    s = ev["summary"]
    return {
        "status": ev["status"],
        "evaluation_id": ev["id"],
        "scenario_count": s.get("scenario_count"),
        "completed_at": ev["completed_at"].isoformat() if ev["completed_at"] else None,
        "algorithm_version": ev["algorithm_version"],
        "config": ev["config"],
        "metrics": s.get("metrics", {}),
        "limitations": s.get("limitations", []),
    }


def _eval_rows(limit: int) -> list[dict]:
    with engine().connect() as c:
        ev = _latest_eval(c)
        if ev is None:
            return []
        rows = (
            c.execute(
                text("SELECT row FROM evaluation_results WHERE evaluation_id = :e ORDER BY idx LIMIT :l"),
                {"e": ev["id"], "l": limit},
            )
            .scalars()
            .all()
        )
    return list(rows)


@router.get("/evaluations/results")
def evaluation_results(limit: Annotated[int, Query(ge=1, le=500)] = 100) -> list[dict]:
    return _eval_rows(limit)


@router.get("/evaluations/results.csv")
def evaluation_results_csv() -> Response:
    rows = _eval_rows(5000)
    buf = io.StringIO()
    if rows:
        lead = [
            "scenario_id",
            "group_id",
            "station_code",
            "date",
            "partition",
            "route_count",
            "donor_route_id",
            "shock_kind",
            "delay_minutes",
            "travel_time_factor",
            "seed",
            "state",
            "reason_codes",
        ]
        keys = lead + sorted(k for k in rows[0] if k not in lead)
        w = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: json.dumps(v) if isinstance(v, list | dict) else v for k, v in r.items()})
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="spareline-evaluation-results.csv"'},
    )


@router.get("/evaluations/methodology.json")
def evaluation_methodology() -> JSONResponse:
    body = {"methodology": methodology(), "evaluation": evaluation_summary()}
    return JSONResponse(body, headers={"Content-Disposition": 'attachment; filename="spareline-methodology.json"'})


@router.get("/methodology")
def methodology() -> dict:
    from app.services.methodology import build

    with engine().connect() as c:
        ds = repo.dataset_row(c)
    loaded = repo.load_estimator()
    return build(ds, loaded[1] if loaded else None, loaded[0].version if loaded else None)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
