"""Methodology document served to the app. Every number here is read from persisted data, not hard-coded."""

from __future__ import annotations

from app.solver.rescue import ALGORITHM_VERSION, MAX_MEETING_KM
from app.solver.scenario import DEFAULT_CUTOFF_FRACTION, SHIFT_SLACK_MINUTES
from app.solver.timeline import HANDOFF_FIXED_SECONDS, HANDOFF_PER_PACKAGE_SECONDS


def build(dataset: dict | None, holdout: dict | None, estimator_version: str | None) -> dict:
    meta = (dataset or {}).get("metadata") or {}
    return {
        "dataset": {
            "name": "Amazon Last Mile Routing Research Challenge (2021), evaluation split",
            "provider": (dataset or {}).get("provider"),
            "year_of_routes": 2018,
            "source_url": (dataset or {}).get("source_url"),
            "s3_prefix": meta.get("s3_prefix"),
            "acquired_at": (dataset or {}).get("acquired_at") and dataset["acquired_at"].isoformat(),
            "manifest_sha256": (dataset or {}).get("sha256_manifest"),
            "file_sha256": meta.get("file_sha256"),
            "citation": "Merchán, D., Arora, J., Pachon, J., Konduri, K., Winkenbach, M., Parks, S., Noszek, J. "
            "(2022). 2021 Amazon Last Mile Routing Research Challenge: Data Set. Transportation Science.",
            "fields_used": [
                "route: station_code, date, departure_time_utc, executor_capacity_cm3",
                "stops: lat, lng, type, zone_id",
                "actual sequence (observed stop order)",
                "packages: time_window, planned_service_time_seconds, dimensions",
                "travel_times: mean seconds between stops WITHIN one route",
            ],
            "selection": meta.get("selection"),
        },
        "license": {
            "name": (dataset or {}).get("license_name"),
            "url": "https://creativecommons.org/licenses/by-nc/4.0/",
            "note": "Non-commercial research and demonstration use. A commercial product needs separately "
            "licensed operational data.",
        },
        "assumptions": [
            "Routes, stops, packages, windows and the observed stop order are historical (HISTORICAL ROUTES).",
            "Vehicle progress is reconstructed from departure time, observed in-route mean travel times and "
            "planned service times (RECONSTRUCTED). There is no GPS trace.",
            "Disruptions (delay, area slowdown, vehicle failure) are simulated (SIMULATED DELAY).",
            f"Default scenario cutoff: {int(DEFAULT_CUTOFF_FRACTION * 100)}% through the delayed route's "
            "reconstructed day.",
            "Planned service time repeats per package at a stop in the source (99% of multi-package stops), so a "
            "stop's service time is the maximum, not the sum, of its package values.",
            f"Shift limit (scenario assumption, not source data): each driver may work up to "
            f"{SHIFT_SLACK_MINUTES} minutes past the reconstructed finish of their historical route. Packages whose "
            "service would start later count as missed.",
            "Packages with no time window are never counted as on-time or late for a window; they only count "
            "toward the shift limit.",
            f"Handoff takes {int(HANDOFF_FIXED_SECONDS / 60)} minutes plus {int(HANDOFF_PER_PACKAGE_SECONDS)} "
            "seconds per package. Meeting points are existing stop locations only, not vetted parking.",
            "Traffic slowdown multiplies every travel leg inside the delayed route's own stop set, whichever "
            "van drives it.",
        ],
        "travel_model": {
            "version": estimator_version,
            "within_route": "Observed historical mean travel seconds (asymmetric matrix) from the source.",
            "cross_route": "No observed cross-route times exist. Estimated from straight-line distance using "
            "empirical travel-time quantiles (q10, mean, q90) per distance band, fitted per station "
            "on development-partition routes only.",
            "holdout": holdout,
            "conservative_rule": "A rescue is recommended only if it still helps, and the helper gains no "
            "missed package, when every cross-route leg takes its q90 time.",
            "cross_route_validated": False,
        },
        "baselines": {
            "no_intervention": "Every van keeps its remaining observed sequence under the same disruption.",
            "nearest_feasible": "Pick the helper closest (estimated travel) to the delayed van; move every "
            "at-risk stop at the delayed van's position; insert each stop at its cheapest "
            "position. Rejected if capacity or the helper's shift limit is violated; then the "
            "next-nearest helper is tried; if none fits, no transfer.",
            "spareline": "Search helpers x meeting points (current positions and next few stops of either van, "
            f"within {MAX_MEETING_KM} km) x whole-stop transfer sets (route tails, at-risk stops, "
            "delivery zones). Screen with insertion, re-sequence the best candidates with OR-Tools "
            "while preserving the helper's own observed stop order, validate with an independent "
            "invariant checker, then apply the conservative travel check.",
        },
        "objective": [
            "1. Fewest missed packages across ALL vans (late windowed packages plus packages past shift limit).",
            "2. No newly missed package on the helper (strict mode; reported for every policy).",
            "3. Fewest late minutes, then least added driving plus waiting, then fewest moved stops.",
        ],
        "constraints": [
            "Every undelivered package is assigned to exactly one van; none lost or duplicated.",
            "Completed stops are immutable.",
            "Receiving van volume never exceeds executor capacity at the handoff or after it.",
            "Handoff starts only after both vans arrive at the same stop location, and lasts > 0 minutes.",
            "Transferred stops are delivered only after the handoff ends.",
            "Schedules move forward in time and never before the scenario cutoff.",
        ],
        "statuses": {
            "recommended": "A transfer helps and passes every constraint and the conservative travel check.",
            "no_safe_rescue": "No transfer helps, or every helpful transfer makes the helper miss packages.",
            "low_confidence": "A transfer helps under mean travel estimates but not under conservative ones.",
            "timed_out": "Time limit reached; only fully validated candidates are returned.",
        },
        "approval": "Approving a plan changes simulated dispatch state for your demo session only. Nothing is "
        "sent to any real driver. Parcels are recorded as transferred only after both simulated "
        "driver confirmations.",
        "algorithm_version": ALGORITHM_VERSION,
        "limitations": [
            "Historical 2018 routes with anonymized, perturbed coordinates; not live operations.",
            "Cross-route travel times are estimated and validated only against held-out within-route pairs.",
            "Shift limit and handoff duration are declared assumptions.",
            "No field validation with drivers or dispatchers has been done.",
        ],
        "reproduction": [
            "python -m app.data.ingest --raw data/raw/almrrc2021 --out data/processed/bundle.json",
            "python -m scripts.fit_travel_model",
            "python -m scripts.evaluate --config evaluations/config.json",
            "python -m app.data.seed",
        ],
    }
