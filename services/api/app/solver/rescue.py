"""Rescue decision: no intervention, nearest-feasible helper, and Spareline's constrained search.

All three policies share one scenario state, one travel model and one scoring function.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from app.solver import invariants
from app.solver.model import Group, Node
from app.solver.scenario import ScenarioSpec, build_states
from app.solver.timeline import Handoff, Plan, Score, Simulation, VehicleState, score, simulate_dispatch
from app.solver.travel import CrossRouteEstimator, TravelModel

ALGORITHM_VERSION = "spareline-rescue-1.0.0"
MAX_MEETING_KM = 8.0
DONOR_MEETING_LOOKAHEAD = 3
HELPER_MEETING_LOOKAHEAD = 2
REFINE_TOP_K = 5
MAX_SCENARIO_STOPS = 700
LATE_PENALTY_PER_SECOND = 40
SHIFT_PENALTY_PER_SECOND = 200

ProgressFn = Callable[[str], None]
UNCERTAINTY_REASONS = {
    "GAIN_DISAPPEARS_UNDER_CONSERVATIVE_TRAVEL",
    "HELPER_LATE_UNDER_CONSERVATIVE_TRAVEL",
    "MEETING_OUTSIDE_CALIBRATED_RANGE",
}


@dataclass
class PolicyResult:
    policy: str
    plan: Plan
    sim: Simulation
    score: Score
    upper_score: Score | None = None
    invariant_errors: list[str] = field(default_factory=list)
    helper_newly_missed: int = 0
    helper_newly_missed_upper: int | None = None
    notes: list[str] = field(default_factory=list)


@dataclass
class Decision:
    status: str  # recommended | no_safe_rescue | low_confidence | timed_out
    reason_codes: list[str]
    no_action: PolicyResult
    nearest: PolicyResult
    spareline: PolicyResult
    candidates_considered: int
    candidates_refined: int
    rejected: list[dict]
    cutoff: float
    states: dict[str, VehicleState]
    travel: TravelModel
    solver_status: str
    duration_ms: int


def _base_plan(states: dict[str, VehicleState]) -> Plan:
    return Plan({rid: st.remaining for rid, st in states.items()})


def _evaluate(
    group: Group,
    travel: TravelModel,
    states: dict[str, VehicleState],
    plan: Plan,
    cutoff: float,
    policy: str,
    baseline_missed: set,
    with_upper: bool,
) -> PolicyResult:
    sim = simulate_dispatch(group, travel, states, plan, "mean")
    sc = score(group, states, sim)
    res = PolicyResult(policy, plan, sim, sc)
    res.invariant_errors = invariants.check(group, states, plan, sim, cutoff)
    if plan.handoff is not None:
        helper = plan.handoff.helper
        res.helper_newly_missed = sum(1 for k in sc.missed_package_keys - baseline_missed if k[0] == helper)
        if with_upper:
            usim = simulate_dispatch(group, travel, states, plan, "upper")
            res.upper_score = score(group, states, usim)
            res.helper_newly_missed_upper = sum(
                1 for k in res.upper_score.missed_package_keys - baseline_missed if k[0] == helper
            )
    return res


def _insert_cheapest(travel: TravelModel, start: Node, seq: list[Node], new: Node) -> list[Node]:
    best, best_cost = None, float("inf")
    path = [start, *seq]
    for i in range(len(path)):
        a = path[i]
        b = path[i + 1] if i + 1 < len(path) else None
        cost = travel.seconds(a, new) + (travel.seconds(new, b) - travel.seconds(a, b) if b is not None else 0.0)
        if cost < best_cost:
            best, best_cost = i, cost
    out = list(seq)
    out.insert(best, new)
    return out


def _compose(
    states: dict[str, VehicleState],
    donor: str,
    helper: str,
    meeting: Node,
    dk: int,
    hk: int,
    transfer: tuple[Node, ...],
    helper_post: list[Node],
) -> Plan:
    d_rem = states[donor].remaining
    h_rem = states[helper].remaining
    donor_prefix, helper_prefix = d_rem[:dk], h_rem[:hk]
    tset = set(transfer)
    donor_post = tuple(n for n in d_rem[dk:] if n not in tset)
    seqs = {rid: st.remaining for rid, st in states.items()}
    seqs[donor] = donor_prefix + donor_post
    seqs[helper] = helper_prefix + tuple(helper_post)
    return Plan(seqs, Handoff(donor, helper, meeting, donor_prefix, helper_prefix, transfer))


def _meeting_options(
    group: Group, travel: TravelModel, states: dict[str, VehicleState], donor: str, helper: str
) -> list[tuple[Node, int, int]]:
    d, h = states[donor], states[helper]
    opts: list[tuple[Node, int, int]] = [(d.position, 0, 0)]
    for k in range(1, min(DONOR_MEETING_LOOKAHEAD, len(d.remaining)) + 1):
        if d.operational:
            opts.append((d.remaining[k - 1], k, 0))
    for k in range(1, min(HELPER_MEETING_LOOKAHEAD, len(h.remaining)) + 1):
        opts.append((h.remaining[k - 1], 0, k))
    opts.append((h.position, 0, 0))
    seen, out = set(), []
    for m, dk, hk in opts:
        if (m, dk, hk) in seen:
            continue
        seen.add((m, dk, hk))
        dpos = d.remaining[dk - 1] if dk else d.position
        hpos = h.remaining[hk - 1] if hk else h.position
        if not d.operational and m != d.position:
            continue  # a failed van cannot drive to a meeting point
        if max(travel.edge(dpos, m).distance_km, travel.edge(hpos, m).distance_km) > MAX_MEETING_KM:
            continue
        out.append((m, dk, hk))
    return out


def _transfer_sets(
    group: Group, states: dict[str, VehicleState], donor: str, dk: int, at_risk: list[Node]
) -> list[tuple[Node, ...]]:
    rem = list(states[donor].remaining[dk:])
    if not rem:
        return []
    risk = [n for n in at_risk if n in rem]
    sets: list[tuple[Node, ...]] = []
    if not states[donor].operational:
        sets.append(tuple(rem))
    if risk:
        first = rem.index(risk[0])
        tail = rem[first:]
        sets.append(tuple(tail))
        for frac in (0.25, 0.5, 0.75):
            k = max(1, int(len(tail) * frac))
            sets.append(tuple(tail[-k:]))
        sets.append(tuple(risk))
        zones: dict[str | None, list[Node]] = {}
        for n in rem:
            zones.setdefault(group.stop(n).zone_id, []).append(n)
        risk_zones = []
        for n in risk:
            z = group.stop(n).zone_id
            if z not in risk_zones:
                risk_zones.append(z)
        for z in risk_zones[:4]:
            sets.append(tuple(zones[z]))
        if len(risk_zones) > 1:
            sets.append(tuple(n for n in rem if group.stop(n).zone_id in set(risk_zones)))
    uniq, seen = [], set()
    for s in sets:
        if s and s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def _ortools_sequence(
    group: Group,
    travel: TravelModel,
    start: Node,
    start_time: float,
    own: list[Node],
    transfer: list[Node],
    duty_end: float,
    initial: list[Node],
    time_limit_s: float,
) -> tuple[list[Node] | None, str]:
    """Re-sequence the helper after the handoff.

    The helper's own stops keep their observed relative order (enforced by a rank dimension), so any gain
    comes from where the transferred stops are placed, never from re-optimizing the helper's own route.
    """
    nodes = [start, *own, *transfer]
    n = len(nodes)
    end_index = n  # dummy end, zero-cost arcs
    origin = int(start_time)
    service = [0] + [int(round(group.stop(x).service_seconds)) for x in nodes[1:]]
    # Full transit matrix (service at origin + travel) evaluated in C++; the dummy end node has zero-cost arcs.
    mat = [[0] * (n + 1) for _ in range(n + 1)]
    for i in range(n):
        for j in range(1, n):
            if i != j:
                mat[i][j] = service[i] + int(round(travel.seconds(nodes[i], nodes[j], "mean")))
        mat[i][end_index] = service[i]
    manager = pywrapcp.RoutingIndexManager(n + 1, 1, [0], [end_index])
    routing = pywrapcp.RoutingModel(manager)
    cb = routing.RegisterTransitMatrix(mat)
    routing.SetArcCostEvaluatorOfAllVehicles(cb)
    horizon = 36 * 3600
    routing.AddDimension(cb, horizon, horizon, False, "time")
    time_dim = routing.GetDimensionOrDie("time")
    time_dim.CumulVar(routing.Start(0)).SetRange(0, 0)
    for i in range(1, n):
        idx = manager.NodeToIndex(i)
        stop = group.stop(nodes[i])
        if stop.earliest_service is not None:
            time_dim.CumulVar(idx).SetMin(max(0, int(stop.earliest_service) - origin))
        ends = [p.window_end for p in stop.packages if p.window_end is not None]
        if ends:
            time_dim.SetCumulVarSoftUpperBound(
                idx, max(0, int(min(ends)) - origin), LATE_PENALTY_PER_SECOND * len(ends)
            )
        time_dim.SetCumulVarSoftUpperBound(
            idx, max(0, int(duty_end) - origin), SHIFT_PENALTY_PER_SECOND * max(1, len(stop.packages))
        )
    rank_cb = routing.RegisterUnaryTransitVector([1] * (n + 1))
    routing.AddDimension(rank_cb, 0, n + 2, True, "rank")
    rank = routing.GetDimensionOrDie("rank")
    solver = routing.solver()
    for i in range(1, len(own)):
        solver.Add(rank.CumulVar(manager.NodeToIndex(i)) < rank.CumulVar(manager.NodeToIndex(i + 1)))

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromMilliseconds(int(time_limit_s * 1000))
    pos = {x: i for i, x in enumerate(nodes)}
    routing.CloseModelWithParameters(params)
    init = routing.ReadAssignmentFromRoutes([[manager.NodeToIndex(pos[x]) for x in initial]], True)
    sol = routing.SolveFromAssignmentWithParameters(init, params) if init else routing.SolveWithParameters(params)
    status = {
        0: "not_solved",
        1: "success",
        2: "fail",
        3: "fail_timeout",
        4: "invalid",
        5: "infeasible",
        7: "optimal",
    }.get(routing.status(), str(routing.status()))
    if sol is None:
        return None, status
    order, idx = [], routing.Start(0)
    while not routing.IsEnd(idx):
        node = manager.IndexToNode(idx)
        if node != 0:
            order.append(nodes[node])
        idx = sol.Value(routing.NextVar(idx))
    return order, status


def _missed_stops(group: Group, res: PolicyResult, donor: str) -> list[Node]:
    keys = res.score.missed_package_keys
    seen, out = set(), []
    for rid, sid, _ in sorted(keys):
        if rid == donor and (rid, sid) not in seen:
            seen.add((rid, sid))
            out.append((rid, sid))
    order = {s.node: i for i, s in enumerate(group.routes[donor].stops)}
    return sorted(out, key=lambda n: order[n])


def _is_improvement(res: PolicyResult, base: Score, upper: bool) -> bool:
    sc = res.upper_score if upper else res.score
    if sc is None:
        return False
    return sc.missed_total < base.missed_total


def decide(
    group: Group,
    estimator: CrossRouteEstimator,
    spec: ScenarioSpec,
    time_limit_s: float = 15.0,
    progress: ProgressFn | None = None,
    strict_helper: bool = True,
) -> Decision:
    t0 = time.perf_counter()
    deadline = t0 + time_limit_s
    say = progress or (lambda _s: None)
    say("reconstructing_routes")
    states, cutoff = build_states(group, spec)
    total_stops = sum(len(s.remaining) for s in states.values())
    if total_stops > MAX_SCENARIO_STOPS:
        raise ValueError(f"scenario has {total_stops} remaining stops; limit is {MAX_SCENARIO_STOPS}")
    donor = spec.donor_route_id
    slowed = donor if spec.shock.travel_time_factor > 1.0 else None
    travel = TravelModel(group, estimator, slowed, spec.shock.travel_time_factor)

    say("scoring_no_intervention")
    base = _evaluate(group, travel, states, _base_plan(states), cutoff, "no_intervention", set(), False)
    baseline_missed = base.score.missed_package_keys
    at_risk = _missed_stops(group, base, donor)

    helpers = [
        rid for rid, st in states.items() if rid != donor and st.operational and rid not in spec.excluded_helpers
    ]
    reasons: set[str] = set()
    rejected: list[dict] = []
    if not helpers:
        reasons.add("NO_HELPER_AVAILABLE")

    # Baseline B: nearest helper by estimated travel to the donor's position, at-risk stops by cheapest insertion.
    say("scoring_nearest_feasible_helper")
    nearest = PolicyResult("nearest_feasible", base.plan, base.sim, base.score, notes=["no transfer"])
    nearest.upper_score = base.score
    if at_risk:
        ranked = sorted(helpers, key=lambda h: travel.seconds(states[h].position, states[donor].position))
        for h in ranked:
            hp = list(states[h].remaining)
            for node in at_risk:
                hp = _insert_cheapest(travel, states[donor].position, hp, node)
            plan = _compose(states, donor, h, states[donor].position, 0, 0, tuple(at_risk), hp)
            res = _evaluate(group, travel, states, plan, cutoff, "nearest_feasible", baseline_missed, True)
            sim_h = res.sim
            over_cap = res.invariant_errors
            shift_ok = all(v.service_start <= states[h].duty_end for v in sim_h.visits[h])
            if not over_cap and shift_ok:
                res.notes = [f"helper chosen by estimated proximity: {h}"]
                nearest = res
                break
            rejected.append(
                {"policy": "nearest_feasible", "helper_route_id": h, "reasons": over_cap or ["HELPER_SHIFT_EXCEEDED"]}
            )

    if not at_risk:
        reasons.add("NO_AT_RISK_WORK")
        say("done")
        return Decision(
            "no_safe_rescue",
            sorted(reasons),
            base,
            nearest,
            base,
            0,
            0,
            rejected,
            cutoff,
            states,
            travel,
            "not_needed",
            int((time.perf_counter() - t0) * 1000),
        )

    say("generating_candidates")
    screened: list[tuple[tuple, PolicyResult, dict]] = []
    considered = 0
    timed_out = False
    for h in helpers:
        h_state = states[h]
        for meeting, dk, hk in _meeting_options(group, travel, states, donor, h):
            for tset in _transfer_sets(group, states, donor, dk, at_risk):
                if time.perf_counter() > deadline - 2.0:
                    timed_out = True
                    break
                considered += 1
                tvol = sum(group.stop(n).volume_cm3 for n in tset)
                h_load = sum(group.stop(n).volume_cm3 for n in h_state.remaining[hk:])
                cap = group.routes[h].capacity_cm3
                meta = {"helper_route_id": h, "meeting": meeting, "transfer_stops": len(tset), "dk": dk, "hk": hk}
                if h_load + tvol > cap:
                    reasons.add("HELPER_CAPACITY_EXCEEDED")
                    rejected.append({**meta, "reasons": ["HELPER_CAPACITY_EXCEEDED"]})
                    continue
                post = list(h_state.remaining[hk:])
                for node in tset:
                    post = _insert_cheapest(travel, meeting, post, node)
                plan = _compose(states, donor, h, meeting, dk, hk, tset, post)
                res = _evaluate(group, travel, states, plan, cutoff, "spareline", baseline_missed, False)
                if res.invariant_errors:
                    rejected.append({**meta, "reasons": res.invariant_errors})
                    continue
                key = (
                    res.score.missed_total,
                    res.helper_newly_missed,
                    res.score.late_minutes,
                    res.score.drive_minutes + res.score.wait_minutes,
                    len(tset),
                )
                screened.append((key, res, meta))
            if timed_out:
                break
        if timed_out:
            break

    say("optimizing_handoff")
    screened.sort(key=lambda x: x[0])
    shortlist: list[tuple[tuple, PolicyResult, dict]] = []
    per_helper: dict[str, int] = {}
    for item in screened:
        h = item[2]["helper_route_id"]
        if len(shortlist) < REFINE_TOP_K or per_helper.get(h, 0) == 0:
            shortlist.append(item)
            per_helper[h] = per_helper.get(h, 0) + 1
        if len(shortlist) >= REFINE_TOP_K + len(helpers):
            break

    refined: list[tuple[tuple, PolicyResult, dict]] = []
    solver_statuses: list[str] = []
    for _, res, meta in shortlist:
        remaining = deadline - time.perf_counter()
        if remaining < 0.6:
            timed_out = True
            break
        h, dk, hk, meeting = meta["helper_route_id"], meta["dk"], meta["hk"], meta["meeting"]
        tset = res.plan.handoff.transfer
        own = list(states[h].remaining[hk:])
        initial = list(res.plan.sequences[h][hk:])
        start_time = res.sim.handoff.end if res.sim.handoff else states[h].available_at
        order, status = _ortools_sequence(
            group, travel, meeting, start_time, own, list(tset), states[h].duty_end, initial, min(0.5, remaining / 3)
        )
        solver_statuses.append(status)
        candidates = [res]
        if order is not None:
            plan2 = _compose(states, donor, h, meeting, dk, hk, tset, order)
            res2 = _evaluate(group, travel, states, plan2, cutoff, "spareline", baseline_missed, False)
            if not res2.invariant_errors:
                candidates.append(res2)
        for c in candidates:
            c.upper_score = None
            up = _evaluate(group, travel, states, c.plan, cutoff, "spareline", baseline_missed, True)
            c.upper_score, c.helper_newly_missed_upper = up.upper_score, up.helper_newly_missed_upper
            key = (
                c.score.missed_total,
                c.helper_newly_missed,
                c.score.late_minutes,
                c.score.drive_minutes + c.score.wait_minutes,
                len(tset),
            )
            refined.append((key, c, meta))

    say("robustness_check")
    refined.sort(key=lambda x: x[0])
    best_mean_gain = next((x for x in refined if _is_improvement(x[1], base.score, False)), None)
    safe = []
    for key, c, meta in refined:
        if not _is_improvement(c, base.score, False):
            continue
        problems = []
        if strict_helper and c.helper_newly_missed > 0:
            problems.append("HELPER_WOULD_BE_LATE")
        if not _is_improvement(c, base.score, True):
            problems.append("GAIN_DISAPPEARS_UNDER_CONSERVATIVE_TRAVEL")
        if strict_helper and (c.helper_newly_missed_upper or 0) > 0:
            problems.append("HELPER_LATE_UNDER_CONSERVATIVE_TRAVEL")
        meet_edge = max(
            travel.edge(
                c.plan.handoff.donor_prefix[-1] if c.plan.handoff.donor_prefix else states[donor].position,
                c.plan.handoff.meeting,
            ).distance_km,
            travel.edge(
                c.plan.handoff.helper_prefix[-1]
                if c.plan.handoff.helper_prefix
                else states[c.plan.handoff.helper].position,
                c.plan.handoff.meeting,
            ).distance_km,
        )
        if meet_edge > estimator.bins_for(group.station_code)[0].max_supported_km:
            problems.append("MEETING_OUTSIDE_CALIBRATED_RANGE")
        if problems:
            reasons.update(problems)
            rejected.append(
                {
                    **meta,
                    "reasons": problems,
                    "missed_total": c.score.missed_total,
                    "helper_newly_missed": c.helper_newly_missed,
                }
            )
        else:
            safe.append((key, c, meta))

    duration = int((time.perf_counter() - t0) * 1000)
    solver_status = "feasible" if solver_statuses else "heuristic_only"
    say("done")
    if safe:
        best = safe[0][1]
        best.notes = ["robust under conservative (q90) cross-route travel", "helper own-stop order preserved"]
        status = "timed_out" if timed_out else "recommended"
        return Decision(
            status,
            sorted({"TIME_LIMIT_REACHED"} if timed_out else set()),
            base,
            nearest,
            best,
            considered,
            len(refined),
            rejected[-50:],
            cutoff,
            states,
            travel,
            solver_status,
            duration,
        )
    if best_mean_gain is not None:
        # Low confidence only when some improving candidate failed purely on travel-time uncertainty;
        # if every improving candidate hurts the helper even under mean travel, it is unsafe, not uncertain.
        uncertain_only = any(
            r.get("reasons") and set(r["reasons"]) <= UNCERTAINTY_REASONS and "missed_total" in r for r in rejected
        )
        status = "low_confidence" if uncertain_only else "no_safe_rescue"
    else:
        status = "no_safe_rescue"
        reasons.add("NO_TRANSFER_IMPROVES_OUTCOME")
    if timed_out:
        reasons.add("TIME_LIMIT_REACHED")
    return Decision(
        status,
        sorted(reasons),
        base,
        nearest,
        base,
        considered,
        len(refined),
        rejected[-50:],
        cutoff,
        states,
        travel,
        solver_status,
        duration,
    )
