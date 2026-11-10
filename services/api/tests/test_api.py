"""API integration against the seeded local Postgres (DATABASE_URL)."""

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def session() -> str:
    return client.post("/v1/sessions").json()["session"]


def _wait(run_id: str, timeout: float = 40) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"/v1/runs/{run_id}").json()
        if r["state"] not in ("queued", "running"):
            return r
        time.sleep(0.5)
    raise AssertionError("run did not finish")


def test_health_and_ready():
    assert client.get("/v1/healthz").json()["status"] == "ok"
    r = client.get("/v1/readyz")
    assert r.status_code == 200 and r.json()["groups"] > 0


def test_groups_are_historical_with_estimated_cross_route():
    items = client.get("/v1/datasets/groups?limit=5").json()["items"]
    assert items and all(i["source_kind"] == "historical_research" for i in items)
    assert all(i["cross_route_travel_source"] == "estimated" and i["route_count"] >= 2 for i in items)


def test_full_flow_create_run_approve_ack_export(session):
    h = {"X-Spareline-Session": session}
    scen = [s for s in client.get("/v1/scenarios").json() if s["curated_key"] == "a_route_falls_behind"][0]
    body = {
        "route_group_id": scen["route_group_id"],
        "donor_route_id": scen["donor_route_id"],
        "seed": 1,
        "shock": {"kind": "delay", "delay_minutes": 90, "travel_time_factor": 1.0},
    }
    created = client.post("/v1/scenarios", json=body, headers=h)
    assert created.status_code == 201
    sc = created.json()
    assert sc["provenance"]["shock"] == "simulated" and sc["vehicles"] and sc["stops"]
    run = client.post(f"/v1/scenarios/{sc['id']}/run", json={}, headers=h)
    assert run.status_code == 202
    r = _wait(run.json()["run_id"])
    assert r["state"] == "recommended" and r["solution"]["validation"]["volume_fits"]
    again = client.post(f"/v1/scenarios/{sc['id']}/run", json={}, headers=h).json()
    assert again["run_id"] == r["run_id"], "idempotent rerun returns the same run"
    rid = r["run_id"]
    assert client.get(f"/v1/runs/{rid}/manifests/donor.csv?session={session}").status_code == 409
    assert (
        client.post(
            f"/v1/runs/{rid}/handoff-ack", json={"driver_role": "donor", "expected_revision": 0}, headers=h
        ).status_code
        == 409
    )
    assert client.post(f"/v1/runs/{rid}/approve", json={"expected_revision": 0}, headers=h).status_code == 200
    assert client.post(f"/v1/runs/{rid}/approve", json={"expected_revision": 0}, headers=h).status_code == 409
    d = client.post(f"/v1/runs/{rid}/handoff-ack", json={"driver_role": "donor", "expected_revision": 1}, headers=h)
    assert d.json()["status"] == "awaiting_handoff"
    d = client.post(f"/v1/runs/{rid}/handoff-ack", json={"driver_role": "helper", "expected_revision": 2}, headers=h)
    assert d.json()["status"] == "transferred_simulation"
    donor = client.get(f"/v1/runs/{rid}/manifests/donor.csv?session={session}")
    helper = client.get(f"/v1/runs/{rid}/manifests/helper.csv?session={session}")
    assert donor.status_code == helper.status_code == 200
    stops = lambda t: {tuple(row.split(",")[3:5]) for row in t.splitlines() if row.startswith("stop,")}  # noqa: E731
    assert not stops(donor.text) & stops(helper.text), "no stop on both manifests"
    other = client.post("/v1/sessions").json()["session"]
    assert client.get(f"/v1/runs/{rid}/dispatch", headers={"X-Spareline-Session": other}).json()["status"] == "proposed"


def test_no_rescue_run_has_no_manifest():
    scen = [s for s in client.get("/v1/scenarios").json() if s["curated_key"] == "b_helper_isnt_really_free"][0]
    r = _wait(client.post(f"/v1/scenarios/{scen['id']}/run", json={}).json()["run_id"])
    assert r["state"] == "no_safe_rescue" and r["solution"] is None
    assert client.get(f"/v1/runs/{r['run_id']}/manifests/donor").status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {
            "route_group_id": "grp_x",
            "donor_route_id": "RouteID_ab",
            "seed": 1,
            "shock": {"kind": "delay", "delay_minutes": -5},
        },
        {
            "route_group_id": "grp_x",
            "donor_route_id": "RouteID_ab",
            "seed": 1,
            "shock": {"kind": "delay", "travel_time_factor": 9},
        },
        {
            "route_group_id": "grp_x; DROP TABLE scenarios",
            "donor_route_id": "RouteID_ab",
            "seed": 1,
            "shock": {"kind": "delay"},
        },
        {"route_group_id": "grp_x", "donor_route_id": "RouteID_ab", "seed": 1, "shock": {"kind": "teleport"}},
        {"route_group_id": "grp_x", "donor_route_id": "RouteID_ab", "seed": 1, "shock": {"kind": "delay"}, "extra": 1},
    ],
)
def test_malicious_or_invalid_input_rejected(session, payload):
    r = client.post("/v1/scenarios", json=payload, headers={"X-Spareline-Session": session})
    assert r.status_code == 422 and set(r.json()) == {"code", "message", "request_id"}


def test_missing_ids_and_bad_session():
    assert client.get("/v1/scenarios/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/v1/runs/not-a-uuid").json()["code"] == "run_not_found"
    assert client.post("/v1/scenarios", json={}, headers={"X-Spareline-Session": "forged.token"}).status_code in (
        401,
        422,
    )
    r = client.post(
        "/v1/runs/00000000-0000-0000-0000-000000000000/approve",
        json={"expected_revision": 0},
        headers={"X-Spareline-Session": "forged.token"},
    )
    assert r.status_code == 401


def test_oversized_payload_rejected(session):
    r = client.post(
        "/v1/scenarios",
        content=b"x" * 20000,
        headers={"X-Spareline-Session": session, "content-type": "application/json"},
    )
    assert r.status_code == 413


def test_evaluation_and_methodology_from_persisted_results():
    s = client.get("/v1/evaluations/summary").json()
    assert s["status"] == "completed" and s["scenario_count"] == len(
        client.get("/v1/evaluations/results?limit=500").json()
    )
    m = client.get("/v1/methodology").json()
    assert m["travel_model"]["cross_route_validated"] is False and m["license"]["name"] == "CC BY-NC 4.0"
    assert client.get("/v1/evaluations/results.csv").text.startswith("scenario_id")


def test_errors_do_not_leak_internals():
    r = client.get("/v1/runs/00000000-0000-0000-0000-000000000000")
    assert "Traceback" not in r.text and "postgres" not in r.text.lower()
