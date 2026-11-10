"""Deterministic schedule simulation and package-level scoring.

This module is the single source of truth for timing. The baselines, the optimizer and the invariant
checker all score plans through `simulate_dispatch`, so no policy gets a more forgiving clock.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.solver.model import Group, Node
from app.solver.travel import Mode, TravelModel

HANDOFF_FIXED_SECONDS = 300.0
HANDOFF_PER_PACKAGE_SECONDS = 15.0


@dataclass(frozen=True)
class VehicleState:
    """Where a vehicle is at the scenario cutoff, reconstructed from its observed sequence."""

    route_id: str
    position: Node
    available_at: float  # epoch seconds; already includes simulated delay for the donor
    remaining: tuple[Node, ...]  # undelivered stops in observed order
    completed: tuple[Node, ...]
    duty_end: float
    operational: bool  # False when a simulated vehicle failure stops it


@dataclass(frozen=True)
class Handoff:
    donor: str
    helper: str
    meeting: Node
    donor_prefix: tuple[Node, ...]  # donor stops served before meeting
    helper_prefix: tuple[Node, ...]
    transfer: tuple[Node, ...]  # donor stops handed over (whole stop package groups)


@dataclass
class Plan:
    """Ordered stops each vehicle serves after cutoff, plus an optional single synchronized handoff."""

    sequences: dict[str, tuple[Node, ...]]  # route_id -> full post-cutoff sequence served by that vehicle
    handoff: Handoff | None = None


@dataclass
class Visit:
    node: Node
    vehicle: str
    arrival: float
    service_start: float
    service_end: float
    load_before: float


@dataclass
class HandoffTiming:
    donor_arrival: float
    helper_arrival: float
    start: float
    end: float
    duration: float
    wait_donor: float
    wait_helper: float


@dataclass
class Simulation:
    visits: dict[str, list[Visit]] = field(default_factory=dict)
    handoff: HandoffTiming | None = None
    drive_seconds: dict[str, float] = field(default_factory=dict)
    finish: dict[str, float] = field(default_factory=dict)
    undelivered: list[Node] = field(default_factory=list)
    peak_load: dict[str, float] = field(default_factory=dict)


def handoff_duration(group: Group, transfer: tuple[Node, ...]) -> float:
    n = sum(len(group.stop(n).packages) for n in transfer)
    return HANDOFF_FIXED_SECONDS + HANDOFF_PER_PACKAGE_SECONDS * n


def _run(
    group: Group,
    travel: TravelModel,
    vehicle: str,
    start: Node,
    t: float,
    stops: tuple[Node, ...],
    load: float,
    mode: Mode,
    out: list[Visit],
) -> tuple[Node, float, float, float]:
    pos, drive = start, 0.0
    for node in stops:
        leg = travel.seconds(pos, node, mode)
        drive += leg
        arrival = t + leg
        stop = group.stop(node)
        earliest = stop.earliest_service
        begin = max(arrival, earliest) if earliest is not None else arrival
        end = begin + stop.service_seconds
        out.append(Visit(node, vehicle, arrival, begin, end, load))
        load -= stop.volume_cm3
        pos, t = node, end
    return pos, t, drive, load


def simulate_dispatch(
    group: Group, travel: TravelModel, states: dict[str, VehicleState], plan: Plan, mode: Mode = "mean"
) -> Simulation:
    sim = Simulation()
    h = plan.handoff
    for rid, st in states.items():
        if h is not None and rid in (h.donor, h.helper):
            continue
        seq = plan.sequences.get(rid, ())
        visits: list[Visit] = []
        if st.operational:
            load = sum(group.stop(n).volume_cm3 for n in seq)
            _, t, drive, _ = _run(group, travel, rid, st.position, st.available_at, seq, load, mode, visits)
        else:
            t, drive = st.available_at, 0.0
            sim.undelivered.extend(seq)
            visits = []
        sim.visits[rid] = visits
        sim.drive_seconds[rid] = drive
        sim.finish[rid] = t
        sim.peak_load[rid] = sum(group.stop(n).volume_cm3 for n in seq) if st.operational else 0.0
    if h is None:
        return sim

    d, hp = states[h.donor], states[h.helper]
    donor_seq, helper_seq = plan.sequences[h.donor], plan.sequences[h.helper]
    donor_post = donor_seq[len(h.donor_prefix) :]
    helper_post = helper_seq[len(h.helper_prefix) :]
    dv: list[Visit] = []
    hv: list[Visit] = []
    donor_load0 = sum(group.stop(n).volume_cm3 for n in h.donor_prefix + donor_post + h.transfer)
    helper_load0 = sum(group.stop(n).volume_cm3 for n in helper_seq if n not in h.transfer)

    dpos, dt, ddrive, dload = _run(
        group, travel, h.donor, d.position, d.available_at, h.donor_prefix, donor_load0, mode, dv
    )
    hpos, ht, hdrive, hload = _run(
        group, travel, h.helper, hp.position, hp.available_at, h.helper_prefix, helper_load0, mode, hv
    )
    d_leg = travel.seconds(dpos, h.meeting, mode)
    h_leg = travel.seconds(hpos, h.meeting, mode)
    d_arr, h_arr = dt + d_leg, ht + h_leg
    start = max(d_arr, h_arr)
    dur = handoff_duration(group, h.transfer)
    end = start + dur
    sim.handoff = HandoffTiming(d_arr, h_arr, start, end, dur, start - d_arr, start - h_arr)
    moved = sum(group.stop(n).volume_cm3 for n in h.transfer)
    peak_helper = hload + moved

    if d.operational:
        _, dfin, ddrive2, _ = _run(group, travel, h.donor, h.meeting, end, donor_post, dload - moved, mode, dv)
    else:
        dfin, ddrive2 = end, 0.0
        sim.undelivered.extend(donor_post)
    _, hfin, hdrive2, _ = _run(group, travel, h.helper, h.meeting, end, helper_post, peak_helper, mode, hv)

    sim.visits[h.donor], sim.visits[h.helper] = dv, hv
    sim.drive_seconds[h.donor] = ddrive + d_leg + ddrive2
    sim.drive_seconds[h.helper] = hdrive + h_leg + hdrive2
    sim.finish[h.donor], sim.finish[h.helper] = dfin, hfin
    sim.peak_load[h.donor] = donor_load0
    sim.peak_load[h.helper] = max(helper_load0, peak_helper)
    return sim


@dataclass
class Score:
    windowed_total: int
    windowed_on_time: int
    windowed_late: int
    late_minutes: float
    packages_total: int
    packages_after_shift: int  # service would start after the driver's shift limit, or never
    missed_total: int  # unique packages that are late-windowed or after-shift
    per_vehicle_missed: dict[str, int]
    per_vehicle_windowed_late: dict[str, int]
    drive_minutes: float
    wait_minutes: float
    max_finish: float
    missed_package_keys: set[tuple[str, str, str]]

    @property
    def objective(self) -> tuple[int, float]:
        return (self.missed_total, round(self.late_minutes, 3))


def score(group: Group, states: dict[str, VehicleState], sim: Simulation) -> Score:
    windowed_total = on_time = late = after_shift = packages_total = 0
    late_minutes = 0.0
    missed: set[tuple[str, str, str]] = set()
    per_vehicle: dict[str, int] = {r: 0 for r in states}
    per_vehicle_late: dict[str, int] = {r: 0 for r in states}

    for rid, visits in sim.visits.items():
        duty_end = states[rid].duty_end
        for v in visits:
            for p in group.stop(v.node).packages:
                packages_total += 1
                key = (p.route_id, p.stop_id, p.package_id)
                is_missed = False
                if v.service_start > duty_end:
                    after_shift += 1
                    is_missed = True
                if p.window_end is not None:
                    windowed_total += 1
                    if v.service_start <= p.window_end and v.service_start <= duty_end:
                        on_time += 1
                    else:
                        late += 1
                        per_vehicle_late[rid] += 1
                        late_minutes += max(0.0, v.service_start - p.window_end) / 60.0
                        is_missed = True
                if is_missed:
                    missed.add(key)
                    per_vehicle[rid] += 1
    for node in sim.undelivered:
        for p in group.stop(node).packages:
            packages_total += 1
            after_shift += 1
            missed.add((p.route_id, p.stop_id, p.package_id))
            per_vehicle[node[0]] = per_vehicle.get(node[0], 0) + 1
            if p.window_end is not None:
                windowed_total += 1
                late += 1
                per_vehicle_late[node[0]] = per_vehicle_late.get(node[0], 0) + 1
    wait = 0.0
    if sim.handoff:
        wait = sim.handoff.wait_donor + sim.handoff.wait_helper
    return Score(
        windowed_total=windowed_total,
        windowed_on_time=on_time,
        windowed_late=late,
        late_minutes=round(late_minutes, 2),
        packages_total=packages_total,
        packages_after_shift=after_shift,
        missed_total=len(missed),
        per_vehicle_missed=per_vehicle,
        per_vehicle_windowed_late=per_vehicle_late,
        drive_minutes=round(sum(sim.drive_seconds.values()) / 60.0, 2),
        wait_minutes=round(wait / 60.0, 2),
        max_finish=max(sim.finish.values()) if sim.finish else 0.0,
        missed_package_keys=missed,
    )
