"""Turn solver decisions into the persisted, versioned decision object served by the API."""

from __future__ import annotations

from datetime import UTC, datetime

from app.solver.model import Group, Node
from app.solver.rescue import Decision, PolicyResult
from app.solver.timeline import Score, VehicleState

VEHICLE_LABELS = ["Van A", "Van B", "Van C", "Van D", "Van E"]


def iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")


def short_id(value: str, n: int = 8) -> str:
    tail = value.split("_", 1)[-1]
    return tail.replace("-", "")[:n]


def vehicle_labels(group: Group, donor: str) -> dict[str, str]:
    others = [r for r in sorted(group.routes) if r != donor]
    return {rid: VEHICLE_LABELS[i] for i, rid in enumerate([donor, *others])}


def _outcome(res: PolicyResult, base: Score, donor: str) -> dict:
    sc, h = res.score, res.plan.handoff
    up = res.upper_score
    return {
        "policy": res.policy,
        "transfer": h is not None,
        "helper_route_id": h.helper if h else None,
        "transfer_stop_count": len(h.transfer) if h else 0,
        "transfer_package_count": 0,
        "windowed_total": sc.windowed_total,
        "windowed_on_time": sc.windowed_on_time,
        "windowed_late": sc.windowed_late,
        "late_minutes": sc.late_minutes,
        "packages_total": sc.packages_total,
        "packages_after_shift": sc.packages_after_shift,
        "missed_total": sc.missed_total,
        "helper_newly_missed": res.helper_newly_missed if h else None,
        "helper_newly_missed_conservative": res.helper_newly_missed_upper if h else None,
        "drive_minutes": sc.drive_minutes,
        "extra_drive_minutes": round(sc.drive_minutes - base.drive_minutes, 2),
        "wait_minutes": sc.wait_minutes,
        "latest_finish_utc": iso(sc.max_finish),
        "conservative": {"missed_total": up.missed_total, "windowed_on_time": up.windowed_on_time} if up else None,
        "invariant_errors": res.invariant_errors,
        "notes": res.notes,
    }


def _timeline(group: Group, res: PolicyResult, states: dict[str, VehicleState]) -> list[dict]:
    out = []
    transferred = set(res.plan.handoff.transfer) if res.plan.handoff else set()
    for vehicle, visits in res.sim.visits.items():
        duty_end = states[vehicle].duty_end
        for v in visits:
            stop = group.stop(v.node)
            ends = [p.window_end for p in stop.packages if p.window_end is not None]
            out.append(
                {
                    "route_id": v.node[0],
                    "stop_id": v.node[1],
                    "lat": stop.lat,
                    "lng": stop.lng,
                    "vehicle": vehicle,
                    "arrival_utc": iso(v.arrival),
                    "service_start_utc": iso(v.service_start),
                    "package_count": len(stop.packages),
                    "windowed_count": len(ends),
                    "window_end_utc": iso(min(ends)) if ends else None,
                    "late_windowed": sum(1 for e in ends if v.service_start > e or v.service_start > duty_end),
                    "after_shift": v.service_start > duty_end,
                    "transferred": v.node in transferred,
                }
            )
    for node in res.sim.undelivered:
        stop = group.stop(node)
        ends = [p.window_end for p in stop.packages if p.window_end is not None]
        out.append(
            {
                "route_id": node[0],
                "stop_id": node[1],
                "lat": stop.lat,
                "lng": stop.lng,
                "vehicle": node[0],
                "arrival_utc": None,
                "service_start_utc": None,
                "package_count": len(stop.packages),
                "windowed_count": len(ends),
                "window_end_utc": iso(min(ends)) if ends else None,
                "late_windowed": len(ends),
                "after_shift": True,
                "transferred": False,
            }
        )
    return out


def _meeting_kind(states: dict[str, VehicleState], donor: str, helper: str, meeting: Node, dk: int, hk: int) -> str:
    if meeting == states[donor].position and dk == 0:
        return "donor_position"
    if meeting[0] == donor:
        return "donor_stop"
    if meeting == states[helper].position and hk == 0:
        return "helper_position"
    return "helper_stop"


def solution_payload(group: Group, d: Decision) -> dict | None:
    res = d.spareline
    h = res.plan.handoff
    if d.status not in ("recommended", "timed_out") or h is None or res.sim.handoff is None:
        return None
    ht = res.sim.handoff
    helper_visits = res.sim.visits[h.helper]
    new_pos = {v.node: i + 1 for i, v in enumerate(helper_visits)}
    old_pos = {n: i + 1 for i, n in enumerate(d.states[h.donor].remaining)}
    transfer = []
    for node in h.transfer:
        stop = group.stop(node)
        transfer.append(
            {
                "route_id": node[0],
                "stop_id": node[1],
                "zone_id": stop.zone_id,
                "lat": stop.lat,
                "lng": stop.lng,
                "package_count": len(stop.packages),
                "windowed_count": sum(1 for p in stop.packages if p.windowed),
                "volume_cm3": round(stop.volume_cm3, 1),
                "old_position": old_pos[node],
                "new_position": new_pos[node],
                "packages": [
                    {
                        "package_short": short_id(p.package_id),
                        "window_start_utc": iso(p.window_start),
                        "window_end_utc": iso(p.window_end),
                        "volume_cm3": round(p.volume_cm3, 1) if p.volume_cm3 else None,
                    }
                    for p in stop.packages
                ],
            }
        )
    edges = []
    d_from = h.donor_prefix[-1] if h.donor_prefix else d.states[h.donor].position
    h_from = h.helper_prefix[-1] if h.helper_prefix else d.states[h.helper].position
    pairs = [(d_from, h.meeting), (h_from, h.meeting)]
    seq = [h.meeting, *[v.node for v in helper_visits[len(h.helper_prefix) :]]]
    pairs += list(zip(seq, seq[1:], strict=False))
    for a, b in pairs:
        if a[0] != b[0]:
            e = d.travel.edge(a, b)
            edges.append(
                {
                    "from_stop": f"{a[0]}:{a[1]}",
                    "to_stop": f"{b[0]}:{b[1]}",
                    "distance_km": round(e.distance_km, 3),
                    "mean_s": round(e.mean_s, 1),
                    "lower_s": round(e.lower_s, 1),
                    "upper_s": round(e.upper_s, 1),
                    "source": e.source,
                    "confidence": e.confidence,
                }
            )
    helper_load_after = sum(group.stop(n).volume_cm3 for n in res.plan.sequences[h.helper][len(h.helper_prefix) :])
    cap = group.routes[h.helper].capacity_cm3
    stop = group.stop(h.meeting)
    return {
        "donor_route_id": h.donor,
        "helper_route_id": h.helper,
        "meeting": {
            "route_id": h.meeting[0],
            "stop_id": h.meeting[1],
            "lat": stop.lat,
            "lng": stop.lng,
            "kind": _meeting_kind(d.states, h.donor, h.helper, h.meeting, len(h.donor_prefix), len(h.helper_prefix)),
        },
        "donor_arrival_utc": iso(ht.donor_arrival),
        "helper_arrival_utc": iso(ht.helper_arrival),
        "meeting_time_utc": iso(ht.start),
        "handoff_end_utc": iso(ht.end),
        "handoff_minutes": round(ht.duration / 60, 1),
        "wait_donor_minutes": round(ht.wait_donor / 60, 1),
        "wait_helper_minutes": round(ht.wait_helper / 60, 1),
        "first_to_arrive": "donor" if ht.donor_arrival <= ht.helper_arrival else "helper",
        "transfer": transfer,
        "transfer_package_count": sum(t["package_count"] for t in transfer),
        "transfer_volume_cm3": round(sum(t["volume_cm3"] for t in transfer), 1),
        "helper_capacity_cm3": cap,
        "helper_load_after_handoff_cm3": round(helper_load_after, 1),
        "validation": {
            "volume_fits": helper_load_after <= cap,
            "time_windows_evaluated": True,
            "handoff_feasible_under_model": not res.invariant_errors,
            "no_new_late_on_helper": res.helper_newly_missed == 0 and (res.helper_newly_missed_upper or 0) == 0,
        },
        "cross_route_edges": edges,
    }


def comparisons_payload(d: Decision) -> dict:
    base = d.no_action.score
    out = {
        "no_intervention": _outcome(d.no_action, base, ""),
        "nearest_feasible": _outcome(d.nearest, base, ""),
        "spareline": _outcome(d.spareline, base, ""),
    }
    for key, res in (("no_intervention", d.no_action), ("nearest_feasible", d.nearest), ("spareline", d.spareline)):
        h = res.plan.handoff
        out[key]["transfer_package_count"] = 0
        if h is not None:
            out[key]["transfer_package_count"] = sum(len(d.travel.group.stop(n).packages) for n in h.transfer)
        if key == "spareline" and h is None:
            out[key]["notes"] = ["no transfer recommended; outcome equals no intervention"]
    return out


def timelines_payload(group: Group, d: Decision) -> dict:
    return {
        "no_intervention": _timeline(group, d.no_action, d.states),
        "nearest_feasible": _timeline(group, d.nearest, d.states),
        "spareline": _timeline(group, d.spareline, d.states),
    }


def rejected_payload(d: Decision) -> list[dict]:
    out = []
    for r in d.rejected:
        item = {k: v for k, v in r.items() if k not in ("meeting", "dk", "hk")}
        if "meeting" in r:
            item["meeting"] = list(r["meeting"])
        out.append(item)
    return out


def vehicles_payload(group: Group, states: dict[str, VehicleState], donor: str, excluded: set[str]) -> list[dict]:
    from app.solver.scenario import planned_finish

    labels = vehicle_labels(group, donor)
    out = []
    for rid in [donor, *[r for r in sorted(group.routes) if r != donor]]:
        st, route = states[rid], group.routes[rid]
        stop = group.stop(st.position)
        role = (
            "donor"
            if rid == donor
            else ("unavailable" if rid in excluded or not st.operational else "helper_candidate")
        )
        out.append(
            {
                "route_id": rid,
                "short_id": short_id(rid),
                "label": labels[rid],
                "role": role,
                "capacity_cm3": route.capacity_cm3,
                "departure_utc": iso(route.departure),
                "planned_finish_utc": iso(planned_finish(group, rid)),
                "duty_end_utc": iso(st.duty_end),
                "position": {"stop_id": st.position[1], "lat": stop.lat, "lng": stop.lng},
                "available_at_utc": iso(st.available_at),
                "operational": st.operational,
                "completed_stops": len(st.completed),
                "remaining_stops": len(st.remaining),
                "remaining_packages": sum(len(group.stop(n).packages) for n in st.remaining),
                "remaining_volume_cm3": round(sum(group.stop(n).volume_cm3 for n in st.remaining), 1),
            }
        )
    return out


def stops_payload(group: Group, states: dict[str, VehicleState]) -> list[dict]:
    out = []
    for rid, route in group.routes.items():
        done = set(states[rid].completed)
        for s in route.stops:
            status = "station" if s.kind == "Station" else ("completed" if s.node in done else "remaining")
            out.append(
                {
                    "route_id": rid,
                    "stop_id": s.stop_id,
                    "lat": s.lat,
                    "lng": s.lng,
                    "kind": s.kind,
                    "zone_id": s.zone_id,
                    "observed_sequence": s.observed_sequence,
                    "package_count": len(s.packages),
                    "windowed_count": sum(1 for p in s.packages if p.windowed),
                    "volume_cm3": round(s.volume_cm3, 1),
                    "status": status,
                }
            )
    return out
