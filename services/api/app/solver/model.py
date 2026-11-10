"""Immutable in-memory representation of a historical route group.

Every stop is keyed by the composite (route_id, stop_id): stop IDs repeat across independent routes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

Node = tuple[str, str]  # (route_id, stop_id)


@dataclass(frozen=True, slots=True)
class Package:
    route_id: str
    stop_id: str
    package_id: str
    window_start: float | None  # epoch seconds UTC, None means no promised window
    window_end: float | None
    planned_service_seconds: float
    volume_cm3: float | None

    @property
    def windowed(self) -> bool:
        return self.window_end is not None


@dataclass(frozen=True, slots=True)
class Stop:
    route_id: str
    stop_id: str
    kind: str
    lat: float
    lng: float
    zone_id: str | None
    observed_sequence: int
    packages: tuple[Package, ...]

    @property
    def node(self) -> Node:
        return (self.route_id, self.stop_id)

    @property
    def service_seconds(self) -> float:
        # Planned service time is repeated per package at a stop in 99% of multi-package stops in the
        # source data, so it is treated as a stop-level duration: aggregate with max, not sum.
        return max((p.planned_service_seconds for p in self.packages), default=0.0)

    @property
    def volume_cm3(self) -> float:
        return sum(p.volume_cm3 or 0.0 for p in self.packages)

    @property
    def earliest_service(self) -> float | None:
        """Latest window start among windowed packages, if consistent with every window end."""
        starts = [p.window_start for p in self.packages if p.window_start is not None]
        ends = [p.window_end for p in self.packages if p.window_end is not None]
        if not starts:
            return None
        s = max(starts)
        return s if not ends or s <= min(ends) else None


@dataclass(slots=True)
class Route:
    route_id: str
    station_code: str
    date: str
    departure: float  # epoch seconds UTC
    capacity_cm3: float
    stops: list[Stop]  # observed order, station first
    index: dict[str, int] = field(default_factory=dict)
    matrix: list[list[float]] = field(default_factory=list)  # observed mean seconds, matrix order == stops order

    def __post_init__(self) -> None:
        self.index = {s.stop_id: i for i, s in enumerate(self.stops)}

    def stop(self, stop_id: str) -> Stop:
        return self.stops[self.index[stop_id]]

    def observed_seconds(self, a: str, b: str) -> float:
        return self.matrix[self.index[a]][self.index[b]]

    @property
    def station(self) -> Stop:
        return self.stops[0]


@dataclass(slots=True)
class Group:
    group_id: str
    station_code: str
    date: str
    routes: dict[str, Route]
    partition: str

    def stop(self, node: Node) -> Stop:
        return self.routes[node[0]].stop(node[1])


def parse_utc(value: str | None) -> float | None:
    if value is None:
        return None
    return datetime.fromisoformat(value).timestamp()


def group_from_records(group: dict, routes: dict[str, dict]) -> Group:
    built: dict[str, Route] = {}
    for rid in group["route_ids"]:
        r = routes[rid]
        stops = []
        for s in r["stops"]:
            pkgs = tuple(
                Package(
                    route_id=rid,
                    stop_id=s["id"],
                    package_id=p["id"],
                    window_start=parse_utc(p["window_start_utc"]),
                    window_end=parse_utc(p["window_end_utc"]),
                    planned_service_seconds=float(p["planned_service_seconds"]),
                    volume_cm3=p["volume_cm3"],
                )
                for p in s["packages"]
            )
            stops.append(Stop(rid, s["id"], s["kind"], s["lat"], s["lng"], s["zone_id"], s["observed_sequence"], pkgs))
        order = r["travel"]["order"]
        if order != [s.stop_id for s in stops]:
            raise ValueError(f"travel matrix order mismatch for {rid}")
        route = Route(
            route_id=rid,
            station_code=r["station_code"],
            date=r["date"],
            departure=parse_utc(r["departure_utc"]) or 0.0,
            capacity_cm3=float(r["capacity_cm3"]),
            stops=stops,
            matrix=r["travel"]["seconds"],
        )
        if stops[0].kind != "Station":
            raise ValueError(f"route {rid} does not start at its station")
        built[rid] = route
    return Group(group["id"], group["station_code"], group["date"], built, group.get("partition", "unknown"))
