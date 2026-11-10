"""Independent invariant checker.

Deliberately re-derives every check from the plan and the raw group instead of trusting optimizer
internals. Any violation rejects the candidate regardless of its objective value.
"""

from __future__ import annotations

from collections import Counter

from app.solver.model import Group
from app.solver.timeline import Plan, Simulation, VehicleState

EPS = 1e-6


def check(group: Group, states: dict[str, VehicleState], plan: Plan, sim: Simulation, cutoff: float) -> list[str]:
    errors: list[str] = []

    expected = Counter(
        (p.route_id, p.stop_id, p.package_id)
        for st in states.values()
        for node in st.remaining
        for p in group.stop(node).packages
    )
    assigned = Counter(
        (p.route_id, p.stop_id, p.package_id)
        for seq in plan.sequences.values()
        for node in seq
        for p in group.stop(node).packages
    )
    if expected != assigned:
        missing = sum((expected - assigned).values())
        extra = sum((assigned - expected).values())
        errors.append(f"CONSERVATION_VIOLATED missing={missing} duplicated_or_foreign={extra}")

    for rid, st in states.items():
        completed = set(st.completed)
        for node in plan.sequences.get(rid, ()):
            if node in completed:
                errors.append(f"COMPLETED_STOP_REPLANNED {node}")

    h = plan.handoff
    if h is not None:
        if h.donor == h.helper:
            errors.append("HANDOFF_SAME_VEHICLE")
        if not states[h.helper].operational:
            errors.append("HELPER_NOT_OPERATIONAL")
        donor_rem = set(states[h.donor].remaining)
        if not set(h.transfer) <= donor_rem:
            errors.append("TRANSFER_NOT_FROM_DONOR_REMAINING")
        if set(h.transfer) & set(h.donor_prefix):
            errors.append("TRANSFER_STOP_SERVED_BEFORE_HANDOFF")
        if any(n in plan.sequences[h.donor] for n in h.transfer):
            errors.append("TRANSFER_STOP_STILL_ON_DONOR")
        helper_seq = plan.sequences[h.helper]
        if tuple(helper_seq[: len(h.helper_prefix)]) != h.helper_prefix:
            errors.append("HELPER_PREFIX_MISMATCH")
        if any(n in h.helper_prefix for n in h.transfer):
            errors.append("TRANSFER_SERVED_BEFORE_RECEIPT")
        if sim.handoff is None:
            errors.append("HANDOFF_NOT_SIMULATED")
        else:
            ht = sim.handoff
            if ht.start + EPS < ht.donor_arrival or ht.start + EPS < ht.helper_arrival:
                errors.append("HANDOFF_BEFORE_ARRIVAL")
            if ht.duration <= 0:
                errors.append("HANDOFF_ZERO_DURATION")
            if ht.start + EPS < cutoff:
                errors.append("HANDOFF_BEFORE_CUTOFF")
            for v in sim.visits.get(h.helper, []):
                if v.node in h.transfer and v.service_start + EPS < ht.end:
                    errors.append("TRANSFER_DELIVERED_BEFORE_HANDOFF_END")

    for rid, visits in sim.visits.items():
        cap = group.routes[rid].capacity_cm3
        last = states[rid].available_at
        for v in visits:
            if v.load_before > cap + EPS:
                errors.append(f"CAPACITY_EXCEEDED vehicle={rid[:16]} load={v.load_before:.0f} cap={cap:.0f}")
                break
            if v.load_before < -EPS:
                errors.append(f"NEGATIVE_LOAD vehicle={rid[:16]}")
                break
            if v.arrival + EPS < cutoff or v.service_start + EPS < v.arrival or v.service_end + EPS < v.service_start:
                errors.append(f"NON_MONOTONIC_TIME vehicle={rid[:16]}")
                break
            if v.arrival + EPS < last:
                errors.append(f"TIME_TRAVEL vehicle={rid[:16]}")
                break
            last = v.service_end
        if sim.peak_load.get(rid, 0.0) > cap + EPS:
            errors.append(f"PEAK_LOAD_EXCEEDED vehicle={rid[:16]}")
    return sorted(set(errors))
