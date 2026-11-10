"""Optimizer invariants, baselines parity, determinism and edge cases on real route groups."""

import pytest

from app.data.bundle import build_group
from app.solver import invariants
from app.solver.rescue import _base_plan, decide
from app.solver.scenario import ScenarioSpec, Shock, build_states
from app.solver.timeline import Handoff, Plan, simulate_dispatch
from app.solver.travel import TravelModel

SHOCKS = [Shock("delay", 90), Shock("traffic_multiplier", 0, 1.6), Shock("vehicle_failure", 0, 1.0, 0)]


def _donor(g):
    return sorted(g.routes)[0]


@pytest.fixture(scope="module")
def decisions(dev_groups, estimator):
    out = []
    for g in dev_groups[:4]:
        for sh in SHOCKS:
            spec = ScenarioSpec(g.group_id, _donor(g), None, sh, 1)
            out.append((g, spec, decide(g, estimator, spec, time_limit_s=8)))
    return out


def _all_packages(group, states):
    return sorted(
        (p.route_id, p.stop_id, p.package_id)
        for st in states.values()
        for n in st.remaining
        for p in group.stop(n).packages
    )


def test_conservation_capacity_and_time_for_every_policy(decisions):
    for g, _spec, d in decisions:
        for res in (d.no_action, d.nearest, d.spareline):
            assert res.invariant_errors == [], res.invariant_errors
            served = sorted(
                (p.route_id, p.stop_id, p.package_id)
                for seq in res.plan.sequences.values()
                for n in seq
                for p in g.stop(n).packages
            )
            assert served == _all_packages(g, d.states)


def test_handoff_is_synchronized_and_after_both_arrivals(decisions):
    seen = 0
    for _g, _spec, d in decisions:
        for res in (d.nearest, d.spareline):
            if res.plan.handoff is None:
                continue
            seen += 1
            ht = res.sim.handoff
            assert ht.start >= ht.donor_arrival - 1e-6 and ht.start >= ht.helper_arrival - 1e-6
            assert ht.end > ht.start
            assert ht.start >= d.cutoff
            for v in res.sim.visits[res.plan.handoff.helper]:
                if v.node in res.plan.handoff.transfer:
                    assert v.service_start >= ht.end
    assert seen > 0, "expected at least one transfer across the sampled scenarios"


def test_recommendation_never_harms_helper_and_never_worse_than_no_action(decisions):
    for _g, _spec, d in decisions:
        assert d.spareline.score.missed_total <= d.no_action.score.missed_total
        if d.status == "recommended":
            assert d.spareline.helper_newly_missed == 0
            assert (d.spareline.helper_newly_missed_upper or 0) == 0
            assert d.spareline.upper_score.missed_total < d.no_action.score.missed_total


def test_status_is_from_closed_set_with_reasons(decisions):
    for _g, _spec, d in decisions:
        assert d.status in {"recommended", "no_safe_rescue", "low_confidence", "timed_out"}
        if d.status in ("no_safe_rescue", "low_confidence"):
            assert d.reason_codes


def test_no_disturbance_gives_no_spurious_rescue(dev_groups, estimator):
    for g in dev_groups[:4]:
        d = decide(g, estimator, ScenarioSpec(g.group_id, _donor(g), None, Shock("delay", 0), 1), time_limit_s=5)
        if d.no_action.score.missed_total == 0:
            assert d.status == "no_safe_rescue" and "NO_AT_RISK_WORK" in d.reason_codes


def test_deterministic_for_same_inputs(dev_groups, estimator):
    g = dev_groups[0]
    spec = ScenarioSpec(g.group_id, _donor(g), None, Shock("delay", 90), 7)
    a, b = decide(g, estimator, spec, 8), decide(g, estimator, spec, 8)
    assert a.status == b.status
    assert a.no_action.score.missed_total == b.no_action.score.missed_total
    assert a.nearest.score.missed_total == b.nearest.score.missed_total


def test_baselines_share_states_and_travel_model(decisions):
    for _g, _spec, d in decisions:
        for res in (d.nearest, d.spareline):
            for rid in d.states:
                if res.plan.handoff is None or rid not in (res.plan.handoff.donor, res.plan.handoff.helper):
                    assert res.plan.sequences[rid] == d.no_action.plan.sequences[rid]


def test_slower_roads_never_improve_no_action(dev_groups, estimator):
    g = dev_groups[1]
    donor = _donor(g)
    base = decide(g, estimator, ScenarioSpec(g.group_id, donor, None, Shock("delay", 0), 1), 5).no_action.score
    slow = decide(
        g, estimator, ScenarioSpec(g.group_id, donor, None, Shock("traffic_multiplier", 0, 2.0), 1), 5
    ).no_action.score
    assert slow.missed_total >= base.missed_total


def test_invariant_checker_catches_duplicate_and_capacity_violation(dev_groups, estimator):
    g = dev_groups[0]
    donor, helper = sorted(g.routes)[:2]
    states, cutoff = build_states(g, ScenarioSpec(g.group_id, donor, None, Shock("delay", 30), 1))
    plan = _base_plan(states)
    dup = Plan(dict(plan.sequences))
    dup.sequences[helper] = dup.sequences[helper] + states[donor].remaining[:1]
    tm = TravelModel(g, estimator, None, 1.0)
    errs = invariants.check(g, states, dup, simulate_dispatch(g, tm, states, dup), cutoff)
    assert any(e.startswith("CONSERVATION_VIOLATED") for e in errs)

    big = list(states[donor].remaining)
    seqs = dict(plan.sequences)
    seqs[donor] = ()
    seqs[helper] = tuple(states[helper].remaining) + tuple(big)
    cap_plan = Plan(seqs, Handoff(donor, helper, states[donor].position, (), (), tuple(big)))
    original = g.routes[helper].capacity_cm3
    g.routes[helper].capacity_cm3 = 1.0
    try:
        errs = invariants.check(g, states, cap_plan, simulate_dispatch(g, tm, states, cap_plan), cutoff)
    finally:
        g.routes[helper].capacity_cm3 = original
    assert any("CAPACITY" in e or "PEAK_LOAD" in e for e in errs)


def test_invalid_shocks_rejected(dev_groups):
    g = dev_groups[0]
    for bad in (Shock("delay", -1), Shock("traffic_multiplier", 0, 0.5), Shock("delay", 500)):
        with pytest.raises(ValueError):
            build_states(g, ScenarioSpec(g.group_id, _donor(g), None, bad, 1))
    with pytest.raises(ValueError):
        TravelModel(g, None, None, 0.0)


def test_cross_route_edges_are_estimated_never_observed(dev_groups, estimator):
    g = dev_groups[0]
    a, b = sorted(g.routes)[:2]
    tm = TravelModel(g, estimator, None, 1.0)
    e = tm.edge(g.routes[a].stops[3].node, g.routes[b].stops[3].node)
    assert e.source == "estimated_cross_route" and e.lower_s <= e.mean_s <= e.upper_s
    o = tm.edge(g.routes[a].stops[3].node, g.routes[a].stops[4].node)
    assert o.source == "observed_within_route"


def test_curated_scenarios_reproduce_their_outcome_class(bundle, estimator, curated):
    expected = {
        "a_route_falls_behind": "recommended",
        "b_helper_isnt_really_free": "no_safe_rescue",
        "c_no_handoff_helps": "low_confidence",
    }
    for c in curated:
        g = build_group(bundle, c["group_id"])
        sh = c["shock"]
        d = decide(
            g,
            estimator,
            ScenarioSpec(
                g.group_id,
                c["donor_route_id"],
                None,
                Shock(sh["kind"], sh["delay_minutes"], sh["travel_time_factor"]),
                c["seed"],
            ),
            10,
        )
        assert d.status == expected[c["key"]]
    b = next(c for c in curated if c["key"] == "b_helper_isnt_really_free")
    g = build_group(bundle, b["group_id"])
    d = decide(g, estimator, ScenarioSpec(g.group_id, b["donor_route_id"], None, Shock("delay", 90), 1), 10)
    assert "HELPER_WOULD_BE_LATE" in d.reason_codes
