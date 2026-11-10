"""Source parsing, provenance and data-integrity tests on the real processed bundle."""

from datetime import UTC, datetime

from app.data.ingest import _parse_window, _volume, partition_for
from app.solver.model import parse_utc


def test_window_parsing_is_utc_and_nan_means_no_window():
    assert _parse_window("2018-07-27 23:30:00") == "2018-07-27T23:30:00+00:00"
    assert _parse_window(float("nan")) is None
    assert _parse_window(None) is None
    assert _parse_window("") is None


def test_utc_crossing_calendar_day():
    late = parse_utc("2018-07-28T02:00:00+00:00")
    assert datetime.fromtimestamp(late, UTC).date().isoformat() == "2018-07-28"
    assert late - parse_utc("2018-07-27T23:00:00+00:00") == 3 * 3600


def test_volume_rejects_missing_zero_and_nonfinite_dimensions():
    assert _volume({"depth_cm": 10, "height_cm": 2, "width_cm": 3}) == 60
    assert _volume({"depth_cm": 0, "height_cm": 2, "width_cm": 3}) is None
    assert _volume({"depth_cm": float("nan"), "height_cm": 2, "width_cm": 3}) is None
    assert _volume({"height_cm": 2}) is None


def test_groups_are_same_station_and_date_and_disjoint(bundle):
    seen = set()
    for g in bundle["groups"]:
        routes = [bundle["routes"][r] for r in g["route_ids"]]
        assert 2 <= len(routes) <= 4
        assert {r["station_code"] for r in routes} == {g["station_code"]}
        assert {r["date"] for r in routes} == {g["date"]}
        assert not seen & set(g["route_ids"])
        seen |= set(g["route_ids"])
        assert g["partition"] == partition_for(g["id"])


def test_partitions_are_disjoint_and_both_present(bundle):
    parts = {g["partition"] for g in bundle["groups"]}
    assert parts == {"development", "evaluation"}


def test_stop_ids_repeat_across_routes_so_keys_must_be_composite(bundle):
    ids = [s["id"] for r in bundle["routes"].values() for s in r["stops"]]
    assert len(ids) > len(set(ids)), "source stop IDs repeat across routes"


def test_windows_never_invented(bundle):
    for r in list(bundle["routes"].values())[:40]:
        for s in r["stops"]:
            for p in s["packages"]:
                assert (p["window_start_utc"] is None) == (p["window_end_utc"] is None)
                if p["window_start_utc"]:
                    assert p["window_start_utc"] <= p["window_end_utc"]


def test_travel_matrix_is_asymmetric_and_ordered(bundle, dev_groups):
    route = next(iter(dev_groups[0].routes.values()))
    assert [s.stop_id for s in route.stops] == bundle["routes"][route.route_id]["travel"]["order"]
    m = route.matrix
    asym = sum(1 for i in range(1, 20) for j in range(1, 20) if i != j and m[i][j] != m[j][i])
    assert asym > 0, "do not assume a symmetric matrix"


def test_dataset_provenance_recorded(bundle):
    ds = bundle["dataset"]
    assert ds["license_name"] == "CC BY-NC 4.0"
    assert ds["source_url"].startswith("https://registry.opendata.aws/amazon-last-mile-challenges")
    assert len(ds["manifest_sha256"]) == 64 and ds["file_sha256"]
