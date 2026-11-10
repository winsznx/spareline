"""Travel-time model.

Edges between two stops of the same historical route use the observed mean travel seconds from that
route's matrix. Edges between stops of different routes are not in the dataset; they are estimated
from distance using empirical conditional quantiles fitted on within-route pairs of development-
partition routes. Estimated edges always carry their interval and are never labelled observed.
"""

from __future__ import annotations

import bisect
import random
from dataclasses import dataclass
from typing import Literal

import numpy as np

from app.solver.geo import haversine_km
from app.solver.model import Group, Node, Route

Mode = Literal["mean", "lower", "upper"]
BIN_EDGES_KM = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0, 15.0, 20.0, 30.0]
MIN_BIN_SAMPLES = 200
LOWER_Q, UPPER_Q = 0.10, 0.90


@dataclass(frozen=True)
class EdgeEstimate:
    mean_s: float
    lower_s: float
    upper_s: float
    distance_km: float
    source: str
    calibration_version: str
    confidence: str  # "calibrated" | "extrapolated"


@dataclass
class QuantileBins:
    centers: list[float]
    mean: list[float]
    lower: list[float]
    upper: list[float]
    counts: list[int]

    def _interp(self, values: list[float], d: float) -> float:
        c = self.centers
        if d <= c[0]:
            return values[0] * (d / c[0]) if c[0] > 0 and d < c[0] else values[0]
        if d >= c[-1]:
            return values[-1] * d / c[-1]
        i = bisect.bisect_right(c, d)
        t = (d - c[i - 1]) / (c[i] - c[i - 1])
        return values[i - 1] + t * (values[i] - values[i - 1])

    def predict(self, d: float) -> tuple[float, float, float]:
        return self._interp(self.mean, d), self._interp(self.lower, d), self._interp(self.upper, d)

    @property
    def max_supported_km(self) -> float:
        return self.centers[-1]

    def to_json(self) -> dict:
        return {
            "centers_km": self.centers,
            "mean_s": self.mean,
            "lower_s": self.lower,
            "upper_s": self.upper,
            "counts": self.counts,
        }

    @classmethod
    def from_json(cls, d: dict) -> QuantileBins:
        return cls(d["centers_km"], d["mean_s"], d["lower_s"], d["upper_s"], d["counts"])


def _fit_bins(dist: np.ndarray, secs: np.ndarray) -> QuantileBins | None:
    centers, mean, lower, upper, counts = [], [], [], [], []
    for lo, hi in zip(BIN_EDGES_KM, BIN_EDGES_KM[1:], strict=False):
        m = (dist >= lo) & (dist < hi)
        n = int(m.sum())
        if n < MIN_BIN_SAMPLES:
            continue
        centers.append(float(np.median(dist[m])))
        mean.append(float(secs[m].mean()))
        lower.append(float(np.quantile(secs[m], LOWER_Q)))
        upper.append(float(np.quantile(secs[m], UPPER_Q)))
        counts.append(n)
    if len(centers) < 3:
        return None
    # Enforce monotone non-decreasing quantiles so a longer distance is never estimated faster.
    for arr in (mean, lower, upper):
        for i in range(1, len(arr)):
            arr[i] = max(arr[i], arr[i - 1])
    return QuantileBins(centers, mean, lower, upper, counts)


def sample_pairs(routes: list[Route], per_route: int, seed: int) -> tuple[np.ndarray, np.ndarray, list[str]]:
    rng = random.Random(seed)
    d, s, st = [], [], []
    for r in routes:
        n = len(r.stops)
        for _ in range(per_route):
            i, j = rng.randrange(1, n), rng.randrange(1, n)
            if i == j:
                continue
            a, b = r.stops[i], r.stops[j]
            d.append(haversine_km(a.lat, a.lng, b.lat, b.lng))
            s.append(r.matrix[i][j])
            st.append(r.station_code)
    return np.array(d), np.array(s), st


@dataclass
class CrossRouteEstimator:
    version: str
    global_bins: QuantileBins
    station_bins: dict[str, QuantileBins]
    calibration: dict  # holdout metrics, filled by calibrate()

    @classmethod
    def fit(cls, routes: list[Route], version: str, per_route: int = 3000, seed: int = 7) -> CrossRouteEstimator:
        dist, secs, stations = sample_pairs(routes, per_route, seed)
        global_bins = _fit_bins(dist, secs)
        if global_bins is None:
            raise ValueError("not enough within-route pairs to fit the cross-route estimator")
        station_bins = {}
        st_arr = np.array(stations)
        for code in sorted(set(stations)):
            m = st_arr == code
            b = _fit_bins(dist[m], secs[m])
            if b is not None:
                station_bins[code] = b
        return cls(version, global_bins, station_bins, {"fit_pairs": int(len(dist)), "fit_routes": len(routes)})

    def bins_for(self, station: str) -> tuple[QuantileBins, str]:
        if station in self.station_bins:
            return self.station_bins[station], f"station:{station}"
        return self.global_bins, "global"

    def estimate(self, station: str, distance_km: float) -> EdgeEstimate:
        bins, _ = self.bins_for(station)
        mean, lower, upper = bins.predict(distance_km)
        conf = "calibrated" if distance_km <= bins.max_supported_km else "extrapolated"
        return EdgeEstimate(mean, lower, upper, distance_km, "estimated_cross_route", self.version, conf)

    def evaluate_holdout(
        self, routes: list[Route], per_route: int = 1500, seed: int = 11, max_km: float | None = None
    ) -> dict:
        dist, secs, stations = sample_pairs(routes, per_route, seed)
        if max_km is not None:
            keep = dist <= max_km
            dist, secs = dist[keep], secs[keep]
            stations = [s for s, k in zip(stations, keep, strict=True) if k]
        preds = np.array([self.estimate(st, d).mean_s for st, d in zip(stations, dist, strict=True)])
        lows = np.array([self.estimate(st, d).lower_s for st, d in zip(stations, dist, strict=True)])
        ups = np.array([self.estimate(st, d).upper_s for st, d in zip(stations, dist, strict=True)])
        err = np.abs(preds - secs)
        return {
            "pairs": int(len(secs)),
            "routes": len(routes),
            "max_km": max_km,
            "mae_s": round(float(err.mean()), 1),
            "median_ae_s": round(float(np.median(err)), 1),
            "p90_ae_s": round(float(np.quantile(err, 0.9)), 1),
            "interval": f"[q{int(LOWER_Q * 100)}, q{int(UPPER_Q * 100)}]",
            "interval_coverage": round(float(((secs >= lows) & (secs <= ups)).mean()), 4),
            "upper_exceeded_fraction": round(float((secs > ups).mean()), 4),
            "note": "Held-out WITHIN-route pairs. No observed cross-route labels exist; domain shift applies.",
        }

    def to_json(self) -> dict:
        return {
            "version": self.version,
            "global": self.global_bins.to_json(),
            "stations": {k: v.to_json() for k, v in self.station_bins.items()},
            "calibration": self.calibration,
        }

    @classmethod
    def from_json(cls, d: dict) -> CrossRouteEstimator:
        return cls(
            d["version"],
            QuantileBins.from_json(d["global"]),
            {k: QuantileBins.from_json(v) for k, v in d["stations"].items()},
            d.get("calibration", {}),
        )


class TravelModel:
    """Scenario-specific travel oracle: observed in-route edges, estimated cross-route edges, shock factor."""

    def __init__(self, group: Group, estimator: CrossRouteEstimator, slowed_route: str | None, factor: float):
        if factor <= 0:
            raise ValueError("travel factor must be positive")
        self.group = group
        self.estimator = estimator
        self.slowed_route = slowed_route
        self.factor = factor
        self._cache: dict[tuple[Node, Node], EdgeEstimate] = {}

    def is_observed(self, a: Node, b: Node) -> bool:
        return a[0] == b[0]

    def edge(self, a: Node, b: Node) -> EdgeEstimate:
        key = (a, b)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        sa, sb = self.group.stop(a), self.group.stop(b)
        dist = haversine_km(sa.lat, sa.lng, sb.lat, sb.lng)
        if a == b:
            est = EdgeEstimate(0.0, 0.0, 0.0, 0.0, "same_location", self.estimator.version, "observed")
        elif self.is_observed(a, b):
            secs = self.group.routes[a[0]].observed_seconds(a[1], b[1])
            est = EdgeEstimate(secs, secs, secs, dist, "observed_within_route", "historical_mean", "observed")
        else:
            est = self.estimator.estimate(self.group.station_code, dist)
        self._cache[key] = est
        return est

    def seconds(self, a: Node, b: Node, mode: Mode = "mean") -> float:
        e = self.edge(a, b)
        base = e.mean_s if mode == "mean" else e.lower_s if mode == "lower" else e.upper_s
        # Simulated congestion: slows every edge inside the disrupted route's area (both ends on that route).
        if self.slowed_route is not None and a[0] == self.slowed_route and b[0] == self.slowed_route:
            base *= self.factor
        return base
