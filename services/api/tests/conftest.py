from __future__ import annotations

import json
from pathlib import Path

import orjson
import pytest

from app.data.bundle import build_group, groups, load_bundle
from app.solver.travel import CrossRouteEstimator

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def bundle() -> dict:
    return load_bundle()


@pytest.fixture(scope="session")
def estimator() -> CrossRouteEstimator:
    tm = orjson.loads((ROOT / "data" / "processed" / "travel_model.json").read_bytes())
    return CrossRouteEstimator.from_json(tm["model"])


@pytest.fixture(scope="session")
def curated() -> list[dict]:
    return json.loads((ROOT / "data" / "processed" / "curated.json").read_text())


@pytest.fixture(scope="session")
def dev_groups(bundle):
    return [build_group(bundle, g["id"]) for g in groups(bundle, "development")[:6]]
