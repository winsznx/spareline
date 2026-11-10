"""Fit the cross-route travel estimator on development routes; evaluate on held-out evaluation routes."""

from __future__ import annotations

import orjson

from app.data.bundle import PROCESSED, build_group, groups, load_bundle
from app.solver.travel import CrossRouteEstimator

VERSION = "xroute-quantile-1.0"


def main() -> None:
    b = load_bundle()
    dev = [r for g in groups(b, "development") for r in build_group(b, g["id"]).routes.values()]
    ev = [r for g in groups(b, "evaluation") for r in build_group(b, g["id"]).routes.values()]
    est = CrossRouteEstimator.fit(dev, VERSION)
    holdout = {
        "all_pairs": est.evaluate_holdout(ev),
        "pairs_within_8km": est.evaluate_holdout(ev, max_km=8.0),
        "pairs_within_3km": est.evaluate_holdout(ev, max_km=3.0),
        "fit": est.calibration,
        "partition_fit": "development",
        "partition_holdout": "evaluation",
    }
    est.calibration = holdout
    out = {"model": est.to_json(), "holdout": holdout}
    (PROCESSED / "travel_model.json").write_bytes(orjson.dumps(out, option=orjson.OPT_INDENT_2))
    print(orjson.dumps(holdout, option=orjson.OPT_INDENT_2).decode())


if __name__ == "__main__":
    main()
