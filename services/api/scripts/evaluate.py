"""Predeclared evaluation: Spareline vs no intervention vs nearest-feasible helper on held-out groups.

Reads evaluations/config.json (written before any results), runs every scenario in the cohort, and writes
raw_results.jsonl, errors.jsonl and summary.json. No scenario is dropped after seeing its outcome.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import statistics
import time
import traceback
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import orjson

from app.data.bundle import build_group, groups, load_bundle
from app.solver.rescue import ALGORITHM_VERSION, decide
from app.solver.scenario import ScenarioSpec, Shock
from app.solver.travel import CrossRouteEstimator

ROOT = Path(__file__).resolve().parents[3]
EVAL_DIR = ROOT / "evaluations"
_EST: CrossRouteEstimator | None = None


def _estimator() -> CrossRouteEstimator:
    global _EST
    if _EST is None:
        tm = orjson.loads((ROOT / "data" / "processed" / "travel_model.json").read_bytes())
        _EST = CrossRouteEstimator.from_json(tm["model"])
    return _EST


def donor_for(group: dict) -> str:
    rids = sorted(group["route_ids"])
    return rids[int(hashlib.sha256(group["id"].encode()).hexdigest(), 16) % len(rids)]


def run_one(task: dict) -> dict:
    b = load_bundle()
    g = build_group(b, task["group_id"])
    sh = task["shock"]
    spec = ScenarioSpec(
        task["group_id"],
        task["donor_route_id"],
        None,
        Shock(
            sh["kind"],
            sh.get("delay_minutes", 0),
            sh.get("travel_time_factor", 1.0),
            sh.get("failure_after_stop_index"),
        ),
        task["seed"],
    )
    t0 = time.perf_counter()
    try:
        d = decide(g, _estimator(), spec, time_limit_s=task["time_limit_s"])
    except Exception as exc:  # noqa: BLE001 - recorded in errors.jsonl with root cause
        return {**task, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-800:]}
    ms = int((time.perf_counter() - t0) * 1000)
    na, nf, sp = d.no_action.score, d.nearest.score, d.spareline.score
    sp_up = d.spareline.upper_score
    return {
        "scenario_id": task["scenario_id"],
        "group_id": g.group_id,
        "station_code": g.station_code,
        "date": g.date,
        "partition": g.partition,
        "route_count": len(g.routes),
        "donor_route_id": task["donor_route_id"],
        "shock_kind": sh["kind"],
        "delay_minutes": sh.get("delay_minutes", 0),
        "travel_time_factor": sh.get("travel_time_factor", 1.0),
        "seed": task["seed"],
        "state": d.status,
        "reason_codes": d.reason_codes,
        "windowed_total": na.windowed_total,
        "packages_total": na.packages_total,
        "missed_no_action": na.missed_total,
        "missed_nearest": nf.missed_total,
        "missed_spareline": sp.missed_total,
        "windowed_on_time_no_action": na.windowed_on_time,
        "windowed_on_time_nearest": nf.windowed_on_time,
        "windowed_on_time_spareline": sp.windowed_on_time,
        "after_shift_no_action": na.packages_after_shift,
        "after_shift_spareline": sp.packages_after_shift,
        "delta_vs_no_action": na.missed_total - sp.missed_total,
        "delta_vs_nearest": nf.missed_total - sp.missed_total,
        "nearest_transferred": d.nearest.plan.handoff is not None,
        "helper_newly_missed_nearest": d.nearest.helper_newly_missed if d.nearest.plan.handoff else 0,
        "helper_newly_missed_spareline": d.spareline.helper_newly_missed if d.spareline.plan.handoff else 0,
        "missed_spareline_conservative": sp_up.missed_total if sp_up else sp.missed_total,
        "missed_nearest_conservative": d.nearest.upper_score.missed_total if d.nearest.upper_score else nf.missed_total,
        "helper_newly_missed_nearest_conservative": (d.nearest.helper_newly_missed_upper or 0)
        if d.nearest.plan.handoff
        else 0,
        "extra_drive_min_nearest": round(nf.drive_minutes - na.drive_minutes, 2),
        "extra_drive_min_spareline": round(sp.drive_minutes - na.drive_minutes, 2),
        "wait_min_spareline": sp.wait_minutes,
        "transfer_stops_spareline": len(d.spareline.plan.handoff.transfer) if d.spareline.plan.handoff else 0,
        "candidates_considered": d.candidates_considered,
        "candidates_refined": d.candidates_refined,
        "invariant_errors": d.spareline.invariant_errors + d.nearest.invariant_errors,
        "duration_ms": ms,
        "algorithm_version": ALGORITHM_VERSION,
    }


def _ci(values: list[float], seed: int, n: int = 2000) -> list[float] | None:
    if len(values) < 2:
        return None
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(values, k=len(values))) for _ in range(n))
    return [round(means[int(0.025 * n)], 3), round(means[int(0.975 * n)], 3)]


def summarize(rows: list[dict], errors: list[dict], cfg: dict) -> dict:
    ok = [r for r in rows]
    n = len(ok)
    states: dict[str, int] = {}
    for r in ok:
        states[r["state"]] = states.get(r["state"], 0) + 1
    with_risk = [r for r in ok if r["missed_no_action"] > 0]
    rec = [r for r in ok if r["state"] in ("recommended", "timed_out")]
    lat = sorted(r["duration_ms"] for r in ok)

    def tot(k: str, rs: list[dict] | None = None) -> int:
        return int(sum(r[k] for r in (rs if rs is not None else ok)))

    def wtl(key: str) -> dict:
        return {
            "spareline_better": sum(1 for r in ok if r[key] > 0),
            "tie": sum(1 for r in ok if r[key] == 0),
            "spareline_worse": sum(1 for r in ok if r[key] < 0),
        }

    saved = tot("delta_vs_no_action")
    metrics = {
        "missed_packages_avoided_vs_no_action": {"numerator": saved, "denominator": tot("missed_no_action")},
        "scenarios_with_safe_rescue": {"numerator": len(rec), "denominator": n},
        "at_risk_scenarios_abstained": {
            "numerator": sum(1 for r in with_risk if r["state"] in ("no_safe_rescue", "low_confidence")),
            "denominator": len(with_risk),
        },
        "helper_packages_newly_missed_by_spareline": tot("helper_newly_missed_spareline"),
        "solver_p95_ms": lat[min(len(lat) - 1, int(0.95 * len(lat)))] if lat else None,
        "scenarios": {
            "total": n,
            "errors": len(errors),
            "with_missed_packages_under_no_action": len(with_risk),
            "states": states,
        },
        "packages": {"remaining_total": tot("packages_total"), "windowed_total": tot("windowed_total")},
        "missed_packages": {
            "no_intervention": tot("missed_no_action"),
            "nearest_feasible": tot("missed_nearest"),
            "spareline": tot("missed_spareline"),
            "spareline_conservative_travel": tot("missed_spareline_conservative"),
            "nearest_feasible_conservative_travel": tot("missed_nearest_conservative"),
            "denominator_remaining_packages": tot("packages_total"),
        },
        "windowed_on_time": {
            "no_intervention": tot("windowed_on_time_no_action"),
            "nearest_feasible": tot("windowed_on_time_nearest"),
            "spareline": tot("windowed_on_time_spareline"),
            "denominator_windowed": tot("windowed_total"),
        },
        "delta_vs_no_action": {
            "packages_saved_total": tot("delta_vs_no_action"),
            "mean_per_scenario": round(statistics.fmean(r["delta_vs_no_action"] for r in ok), 3) if ok else None,
            "ci95_mean_bootstrap": _ci([r["delta_vs_no_action"] for r in ok], 1),
            **wtl("delta_vs_no_action"),
        },
        "delta_vs_nearest": {
            "packages_total": tot("delta_vs_nearest"),
            "mean_per_scenario": round(statistics.fmean(r["delta_vs_nearest"] for r in ok), 3) if ok else None,
            "ci95_mean_bootstrap": _ci([r["delta_vs_nearest"] for r in ok], 2),
            **wtl("delta_vs_nearest"),
        },
        "helper_harm": {
            "nearest_feasible_transfers": sum(1 for r in ok if r["nearest_transferred"]),
            "nearest_feasible_newly_missed_helper_packages": tot("helper_newly_missed_nearest"),
            "nearest_feasible_scenarios_harming_helper": sum(1 for r in ok if r["helper_newly_missed_nearest"] > 0),
            "nearest_feasible_newly_missed_helper_packages_conservative": tot(
                "helper_newly_missed_nearest_conservative"
            ),
            "spareline_recommendations": len(rec),
            "spareline_newly_missed_helper_packages": tot("helper_newly_missed_spareline"),
        },
        "cost_of_recommended_rescues": {
            "count": len(rec),
            "extra_drive_minutes_mean": round(statistics.fmean(r["extra_drive_min_spareline"] for r in rec), 2)
            if rec
            else None,
            "handoff_wait_minutes_mean": round(statistics.fmean(r["wait_min_spareline"] for r in rec), 2)
            if rec
            else None,
            "transfer_stops_mean": round(statistics.fmean(r["transfer_stops_spareline"] for r in rec), 2)
            if rec
            else None,
        },
        "abstention": {
            "low_confidence": states.get("low_confidence", 0),
            "no_safe_rescue_with_missed_packages": sum(1 for r in with_risk if r["state"] == "no_safe_rescue"),
            "denominator_scenarios_with_missed_packages": len(with_risk),
        },
        "latency_ms": {
            "mean": round(statistics.fmean(lat), 1) if lat else None,
            "median": lat[len(lat) // 2] if lat else None,
            "p95": lat[min(len(lat) - 1, int(0.95 * len(lat)))] if lat else None,
            "max": lat[-1] if lat else None,
            "note": "solver wall time per scenario on the evaluation machine, excludes HTTP",
        },
        "invariant_violations_in_emitted_plans": sum(len(r["invariant_errors"]) for r in ok),
    }
    return {
        "scenario_count": n,
        "metrics": metrics,
        "limitations": [
            "Disruptions are simulated; routes are historical 2018 research data, not live operations.",
            "Cross-route travel is estimated from distance; it is validated only on held-out within-route pairs.",
            "The shift limit (planned finish + 60 min) and handoff duration are declared assumptions.",
            "Only 7% of packages carry time windows; most missed packages come from the shift limit.",
            "Results describe this model on this cohort, not field performance.",
        ],
        "config_sha256": cfg["_sha256"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, default=EVAL_DIR / "config.json")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    raw_cfg = args.config.read_bytes()
    cfg = json.loads(raw_cfg)
    cfg["_sha256"] = hashlib.sha256(raw_cfg).hexdigest()
    b = load_bundle()
    cohort = groups(b, cfg["partition"])[: cfg["max_groups"]]
    tasks = []
    for g in cohort:
        donor = donor_for(g)
        for i, sh in enumerate(cfg["shocks"]):
            sid = hashlib.sha256(f"{g['id']}|{i}|{cfg['seed']}".encode()).hexdigest()[:16]
            tasks.append(
                {
                    "scenario_id": f"ev_{sid}",
                    "group_id": g["id"],
                    "donor_route_id": donor,
                    "shock": sh,
                    "seed": cfg["seed"],
                    "time_limit_s": cfg["time_limit_s"],
                }
            )
    started = datetime.now(UTC)
    print(f"{len(cohort)} groups, {len(tasks)} scenarios")
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(run_one, tasks, chunksize=2))
    rows = [r for r in results if "error" not in r]
    errors = [r for r in results if "error" in r]
    summary = summarize(rows, errors, cfg)
    eid = f"eval_{started.strftime('%Y%m%dT%H%M%SZ')}_{cfg['_sha256'][:8]}"
    summary.update(
        {
            "evaluation_id": eid,
            "started_at": started.isoformat(),
            "completed_at": datetime.now(UTC).isoformat(),
            "algorithm_version": ALGORITHM_VERSION,
            "dataset_sha256": b["dataset"]["manifest_sha256"],
            "status": "completed" if not errors else "partial",
        }
    )
    EVAL_DIR.mkdir(exist_ok=True)
    (EVAL_DIR / "raw_results.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    (EVAL_DIR / "errors.jsonl").write_text("".join(json.dumps(e) + "\n" for e in errors))
    (EVAL_DIR / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary["metrics"], indent=2))


if __name__ == "__main__":
    main()
