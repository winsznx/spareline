"""Scenario construction: historical replay up to a cutoff, then a declared simulated disruption."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

from app.solver.model import Group, Node
from app.solver.timeline import VehicleState

ShockKind = Literal["delay", "traffic_multiplier", "vehicle_failure"]

# Scenario assumption (not from the source data): a driver may work up to this many minutes past the
# reconstructed finish of their historical route. Packages whose service would start later are counted
# as missed (would return undelivered).
SHIFT_SLACK_MINUTES = 60
DEFAULT_CUTOFF_FRACTION = 0.40


@dataclass(frozen=True)
class Shock:
    kind: ShockKind
    delay_minutes: int = 0
    travel_time_factor: float = 1.0
    failure_after_stop_index: int | None = None

    def validate(self) -> None:
        if not 0 <= self.delay_minutes <= 240:
            raise ValueError("delay_minutes must be within 0..240")
        if not 1.0 <= self.travel_time_factor <= 3.0:
            raise ValueError("travel_time_factor must be within 1.0..3.0")
        if self.failure_after_stop_index is not None and self.failure_after_stop_index < 0:
            raise ValueError("failure_after_stop_index must be >= 0")

    def to_json(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class ScenarioSpec:
    group_id: str
    donor_route_id: str
    cutoff_utc: float | None
    shock: Shock
    seed: int
    excluded_helpers: tuple[str, ...] = ()


def reconstruct_observed(group: Group, route_id: str) -> list[tuple[Node, float, float]]:
    """Undisturbed replay of the observed sequence: (node, service_start, service_end) per delivery stop.

    Built from departure time, observed in-route mean travel seconds and planned service times. This is a
    reconstruction, not GPS tracking.
    """
    r = group.routes[route_id]
    t = r.departure
    prev = r.stops[0]
    out = []
    for s in r.stops[1:]:
        t += r.observed_seconds(prev.stop_id, s.stop_id)
        earliest = s.earliest_service
        begin = max(t, earliest) if earliest is not None else t
        end = begin + s.service_seconds
        out.append((s.node, begin, end))
        prev, t = s, end
    return out


def planned_finish(group: Group, route_id: str) -> float:
    replay = reconstruct_observed(group, route_id)
    return replay[-1][2] if replay else group.routes[route_id].departure


def default_cutoff(group: Group, donor: str) -> float:
    r = group.routes[donor]
    return r.departure + DEFAULT_CUTOFF_FRACTION * (planned_finish(group, donor) - r.departure)


def build_states(group: Group, spec: ScenarioSpec) -> tuple[dict[str, VehicleState], float]:
    spec.shock.validate()
    if spec.donor_route_id not in group.routes:
        raise ValueError("donor route is not part of this group")
    cutoff = spec.cutoff_utc if spec.cutoff_utc is not None else default_cutoff(group, spec.donor_route_id)
    states: dict[str, VehicleState] = {}
    for rid, route in group.routes.items():
        replay = reconstruct_observed(group, rid)
        duty_end = (replay[-1][2] if replay else route.departure) + SHIFT_SLACK_MINUTES * 60
        is_donor = rid == spec.donor_route_id
        # A delay of X minutes means the van is X minutes behind its plan: at the cutoff it has only finished
        # the stops it had planned to start by (cutoff - X). It is still moving and reachable for a handoff.
        progress_t = cutoff - (spec.shock.delay_minutes * 60 if is_donor else 0)
        done = [(n, s, e) for n, s, e in replay if s <= progress_t]
        remaining = tuple(n for n, s, _ in replay if s > progress_t)
        if done:
            position, available = done[-1][0], max(cutoff, done[-1][2])
        else:
            position, available = route.station.node, max(cutoff, route.departure)
        operational = True
        if rid == spec.donor_route_id:
            sh = spec.shock
            # Shock components combine: delay is applied through progress above, the traffic factor by the
            # travel model, and a failure stops the van after N further stops.
            if sh.kind == "vehicle_failure":
                operational = False
                if sh.failure_after_stop_index is not None and sh.failure_after_stop_index < len(remaining):
                    # The van keeps working through N more stops, then fails at the last of them.
                    keep = remaining[: sh.failure_after_stop_index]
                    t = available
                    pos = position
                    for n in keep:
                        t += group.routes[rid].observed_seconds(pos[1], n[1])
                        stop = group.stop(n)
                        t += stop.service_seconds
                        pos = n
                    done = done + [(n, 0.0, 0.0) for n in keep]
                    remaining = remaining[len(keep) :]
                    position, available = pos, t
        states[rid] = VehicleState(
            route_id=rid,
            position=position,
            available_at=available,
            remaining=remaining,
            completed=tuple(n for n, _, _ in done),
            duty_end=duty_end,
            operational=operational,
        )
    return states, cutoff
