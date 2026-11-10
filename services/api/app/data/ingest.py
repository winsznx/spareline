"""Materialize same-station, same-date route groups from the Amazon Last Mile research dataset.

Reads the raw public JSON files (evaluation split), applies the predeclared group selection rules,
and writes a bounded processed bundle that the API seeds into Postgres. Raw files never leave the
build machine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import ijson
import orjson

from app.solver.geo import haversine_km

SOURCE_URL = "https://registry.opendata.aws/amazon-last-mile-challenges/"
S3_PREFIX = "s3://amazon-last-mile-challenges/almrrc2021/almrrc2021-data-evaluation/"
LICENSE = "CC BY-NC 4.0"

MAX_GROUP_SIZE = 4
MAX_DEPARTURE_GAP_MIN = 90
MAX_CENTROID_KM = 12.0
DEV_BUCKETS = 3  # sha256(group_id) % 10 < 3 -> development partition


@dataclass(frozen=True)
class SelectionConfig:
    max_groups: int
    max_group_size: int = MAX_GROUP_SIZE
    max_departure_gap_min: int = MAX_DEPARTURE_GAP_MIN
    max_centroid_km: float = MAX_CENTROID_KM


def _parse_window(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return datetime.fromisoformat(value).replace(tzinfo=UTC).isoformat()


def _volume(dims: dict) -> float | None:
    try:
        vals = [float(dims[k]) for k in ("depth_cm", "height_cm", "width_cm")]
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(v) and v > 0 for v in vals):
        return None
    return vals[0] * vals[1] * vals[2]


def _route_centroid(stops: dict) -> tuple[float, float]:
    pts = [(s["lat"], s["lng"]) for s in stops.values() if s.get("type") != "Station"]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _departure_minutes(route: dict) -> int:
    h, m, _ = route["departure_time_utc"].split(":")
    return int(h) * 60 + int(m)


def group_id_for(station: str, date: str, route_ids: list[str]) -> str:
    digest = hashlib.sha256("|".join([station, date, *sorted(route_ids)]).encode()).hexdigest()
    return f"grp_{station}_{date}_{digest[:10]}"


def partition_for(group_id: str) -> str:
    return "development" if int(hashlib.sha256(group_id.encode()).hexdigest(), 16) % 10 < DEV_BUCKETS else "evaluation"


def select_groups(routes: dict, sequences: dict, cfg: SelectionConfig) -> tuple[list[dict], dict]:
    """Deterministic predeclared grouping. Returns groups and an exclusion log."""
    exclusions: dict[str, int] = {"missing_sequence": 0, "no_station_stop": 0, "singleton_station_date": 0}
    by_sd: dict[tuple[str, str], list[str]] = {}
    for rid, r in routes.items():
        if rid not in sequences or not sequences[rid].get("actual"):
            exclusions["missing_sequence"] += 1
            continue
        if not any(s.get("type") == "Station" for s in r["stops"].values()):
            exclusions["no_station_stop"] += 1
            continue
        by_sd.setdefault((r["station_code"], r["date_YYYY_MM_DD"]), []).append(rid)

    groups: list[dict] = []
    for (station, date), rids in sorted(by_sd.items()):
        if len(rids) < 2:
            exclusions["singleton_station_date"] += len(rids)
            continue
        centroids = {rid: _route_centroid(routes[rid]["stops"]) for rid in rids}
        unused = sorted(rids, key=lambda x: hashlib.sha256(x.encode()).hexdigest())
        while unused:
            anchor = unused.pop(0)
            near = sorted(
                (
                    (haversine_km(*centroids[anchor], *centroids[o]), o)
                    for o in unused
                    if abs(_departure_minutes(routes[anchor]) - _departure_minutes(routes[o]))
                    <= cfg.max_departure_gap_min
                ),
            )
            members = [anchor] + [o for d, o in near if d <= cfg.max_centroid_km][: cfg.max_group_size - 1]
            if len(members) < 2:
                continue
            for o in members[1:]:
                unused.remove(o)
            gid = group_id_for(station, date, members)
            groups.append(
                {
                    "id": gid,
                    "station_code": station,
                    "date": date,
                    "route_ids": sorted(members),
                    "partition": partition_for(gid),
                    "max_centroid_km": round(
                        max(haversine_km(*centroids[anchor], *centroids[o]) for o in members[1:]), 3
                    ),
                }
            )
    groups.sort(key=lambda g: hashlib.sha256(g["id"].encode()).hexdigest())
    candidate_count = len(groups)
    groups = groups[: cfg.max_groups]
    exclusions["groups_formed"] = candidate_count
    exclusions["groups_kept_after_cap"] = len(groups)
    return groups, exclusions


def _stream_selected(path: Path, wanted: set[str]) -> dict:
    out: dict = {}
    with path.open("rb") as fh:
        for key, value in ijson.kvitems(fh, "", use_float=True):
            if key in wanted:
                out[key] = value
                if len(out) == len(wanted):
                    break
    return out


def build_route(rid: str, route: dict, seq: dict, packages: dict, travel: dict) -> dict:
    order = sorted(seq["actual"].items(), key=lambda kv: kv[1])
    stop_ids = [sid for sid, _ in order]
    stops = []
    for sid, ordinal in order:
        s = route["stops"][sid]
        pk = packages.get(sid, {})
        pkgs = []
        for pid, p in sorted(pk.items()):
            tw = p.get("time_window") or {}
            pkgs.append(
                {
                    "id": pid,
                    "window_start_utc": _parse_window(tw.get("start_time_utc")),
                    "window_end_utc": _parse_window(tw.get("end_time_utc")),
                    "planned_service_seconds": float(p["planned_service_time_seconds"]),
                    "volume_cm3": _volume(p.get("dimensions") or {}),
                    "dimensions": p.get("dimensions"),
                }
            )
        stops.append(
            {
                "id": sid,
                "kind": s["type"],
                "lat": s["lat"],
                "lng": s["lng"],
                "zone_id": s.get("zone_id") if isinstance(s.get("zone_id"), str) else None,
                "observed_sequence": ordinal,
                "packages": pkgs,
            }
        )
    matrix = [[round(float(travel[a][b]), 1) for b in stop_ids] for a in stop_ids]
    return {
        "id": rid,
        "station_code": route["station_code"],
        "date": route["date_YYYY_MM_DD"],
        "departure_utc": f"{route['date_YYYY_MM_DD']}T{route['departure_time_utc']}+00:00",
        "capacity_cm3": float(route["executor_capacity_cm3"]),
        "stops": stops,
        "travel": {"order": stop_ids, "seconds": matrix},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-groups", type=int, default=160)
    args = ap.parse_args()

    raw: Path = args.raw
    routes = json.loads((raw / "eval_route_data.json").read_text())
    sequences = json.loads((raw / "eval_actual_sequences.json").read_text())
    groups, exclusions = select_groups(routes, sequences, SelectionConfig(max_groups=args.max_groups))
    wanted = {rid for g in groups for rid in g["route_ids"]}
    print(f"selected {len(groups)} groups, {len(wanted)} routes; streaming packages")
    # The package file contains bare NaN literals (no time window), which ijson rejects; json accepts them.
    all_packages = json.loads((raw / "eval_package_data.json").read_text())
    packages = {rid: all_packages[rid] for rid in wanted}
    del all_packages
    print("streaming travel times (large file)")
    travel = _stream_selected(raw / "eval_travel_times.json", wanted)

    built = {rid: build_route(rid, routes[rid], sequences[rid], packages[rid], travel[rid]) for rid in sorted(wanted)}
    sha = {}
    sums = raw / "SHA256SUMS"
    if sums.exists():
        for line in sums.read_text().splitlines():
            digest, name = line.split(maxsplit=1)
            sha[name.strip()] = digest
    acquired = (raw / "ACQUIRED_AT").read_text().strip() if (raw / "ACQUIRED_AT").exists() else None
    bundle = {
        "dataset": {
            "slug": "amazon_historical_2018",
            "provider": "Amazon Last Mile Routing Research Challenge (Amazon / MIT CTL)",
            "dataset_year": 2018,
            "split": "almrrc2021-data-evaluation",
            "source_url": SOURCE_URL,
            "s3_prefix": S3_PREFIX,
            "license_name": LICENSE,
            "acquired_at": acquired,
            "file_sha256": sha,
            "manifest_sha256": hashlib.sha256(orjson.dumps(sha, option=orjson.OPT_SORT_KEYS)).hexdigest(),
            "selection": {
                "rule": "same station_code and date; anchor ordered by sha256(route_id); "
                f"add up to {MAX_GROUP_SIZE - 1} nearest unused routes by stop-centroid distance "
                f"<= {MAX_CENTROID_KM} km with departure gap <= {MAX_DEPARTURE_GAP_MIN} min; "
                f"groups ordered by sha256(group_id), first {args.max_groups} kept; "
                f"partition = development if sha256(group_id) % 10 < {DEV_BUCKETS} else evaluation",
                "exclusions": exclusions,
            },
        },
        "groups": groups,
        "routes": built,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(orjson.dumps(bundle))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
