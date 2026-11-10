"""Bounded background execution of solver runs in separate processes (keeps the event loop free)."""

from __future__ import annotations

import hashlib
import json
import logging
import multiprocessing as mp
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime

from app.config import get_settings
from app.db import repo
from app.services import serialize
from app.solver.rescue import ALGORITHM_VERSION, decide
from app.solver.scenario import ScenarioSpec, Shock

log = logging.getLogger("spareline.jobs")
_pool: ProcessPoolExecutor | None = None


def pool() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(max_workers=get_settings().solver_workers, mp_context=mp.get_context("spawn"))
    return _pool


def spec_from_row(sc: dict) -> ScenarioSpec:
    shock = sc["shock"]
    return ScenarioSpec(
        group_id=sc["group_id"],
        donor_route_id=sc["donor_route_id"],
        cutoff_utc=sc["cutoff_utc"].timestamp() if sc.get("cutoff_utc") else None,
        shock=Shock(
            shock["kind"],
            int(shock.get("delay_minutes", 0)),
            float(shock.get("travel_time_factor", 1.0)),
            shock.get("failure_after_stop_index"),
        ),
        seed=int(sc["seed"]),
        excluded_helpers=tuple(sc.get("excluded_helpers") or ()),
    )


def input_hash(sc: dict, dataset_hash: str, estimator_version: str, time_limit: int) -> str:
    payload = {
        "group": sc["group_id"],
        "donor": sc["donor_route_id"],
        "cutoff": sc["cutoff_utc"].isoformat() if sc.get("cutoff_utc") else None,
        "seed": sc["seed"],
        "shock": sc["shock"],
        "excluded": sorted(sc.get("excluded_helpers") or []),
        "dataset": dataset_hash,
        "algorithm": ALGORITHM_VERSION,
        "estimator": estimator_version,
        "time_limit": time_limit,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def execute_run(run_id: str, scenario: dict, time_limit: int, dataset_hash: str) -> None:
    """Runs inside a worker process."""
    logging.basicConfig(level=logging.INFO, format='{"lvl":"%(levelname)s","msg":"%(message)s"}')
    started = time.perf_counter()
    try:
        repo.update_run(run_id, state="running", stage="loading_source_routes")
        group = repo.load_group(scenario["group_id"])
        loaded = repo.load_estimator()
        if group is None or loaded is None:
            raise RuntimeError("route group or travel model not loaded")
        estimator, holdout = loaded
        spec = spec_from_row(scenario)

        def progress(stage: str) -> None:
            if stage != "done":
                repo.update_run(run_id, stage=stage)

        decision = decide(group, estimator, spec, time_limit_s=float(time_limit), progress=progress)
        evidence = {
            "algorithm_version": ALGORITHM_VERSION,
            "time_model_version": estimator.version,
            "input_hash": scenario.get("_input_hash"),
            "dataset_hash": dataset_hash,
            "cutoff_utc": serialize.iso(decision.cutoff),
            "candidates_considered": decision.candidates_considered,
            "candidates_refined": decision.candidates_refined,
            "solver_status": decision.solver_status,
            "rejected": serialize.rejected_payload(decision),
            "provenance": {
                "routes": "HISTORICAL ROUTES",
                "eta": "RECONSTRUCTED",
                "shock": "SIMULATED DELAY",
                "cross_route_travel": "ESTIMATED TRANSFER TIME",
                "outcomes": "MODEL RESULT",
                "source": "amazon_historical_2018",
            },
            "time_model": {"id": estimator.version, "holdout": holdout, "cross_route_validated": False},
            "computed_at": datetime.now(UTC).isoformat(),
        }
        repo.update_run(
            run_id,
            state=decision.status,
            stage="done",
            reason_codes=decision.reason_codes,
            solution=serialize.solution_payload(group, decision),
            comparisons=serialize.comparisons_payload(decision),
            timelines=serialize.timelines_payload(group, decision),
            evidence=evidence,
            duration_ms=int((time.perf_counter() - started) * 1000),
            completed=True,
        )
        log.info(f"run {run_id} state={decision.status} ms={int((time.perf_counter() - started) * 1000)}")
    except Exception as exc:  # noqa: BLE001 - persisted as structured error state, never a traceback to clients
        log.exception(f"run {run_id} failed")
        repo.update_run(
            run_id,
            state="error",
            stage="failed",
            reason_codes=["SOLVER_ERROR"],
            error={
                "code": "solver_error",
                "message": "The route could not be recalculated.",
                "detail": type(exc).__name__,
            },
            duration_ms=int((time.perf_counter() - started) * 1000),
            completed=True,
        )


def submit(run_id: str, scenario: dict, time_limit: int, dataset_hash: str) -> None:
    fut = pool().submit(execute_run, run_id, scenario, time_limit, dataset_hash)

    def _done(f) -> None:
        exc = f.exception()
        if exc is not None:
            log.error(f"worker crashed for run {run_id}: {type(exc).__name__}")
            repo.update_run(
                run_id,
                state="error",
                stage="failed",
                reason_codes=["WORKER_CRASHED"],
                error={"code": "worker_crashed", "message": "The route could not be recalculated."},
                completed=True,
            )

    fut.add_done_callback(_done)
