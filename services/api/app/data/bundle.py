from __future__ import annotations

import gzip
from functools import lru_cache
from pathlib import Path

import orjson

from app.solver.model import Group, group_from_records

PROCESSED = Path(__file__).resolve().parents[4] / "data" / "processed"


@lru_cache
def load_bundle(path: str | None = None) -> dict:
    target = Path(path or PROCESSED / "bundle.json")
    if not target.exists() and target.with_suffix(".json.gz").exists():
        return orjson.loads(gzip.decompress(target.with_suffix(".json.gz").read_bytes()))
    return orjson.loads(target.read_bytes())


def groups(bundle: dict, partition: str | None = None) -> list[dict]:
    return [g for g in bundle["groups"] if partition is None or g["partition"] == partition]


def build_group(bundle: dict, gid: str) -> Group:
    g = next(x for x in bundle["groups"] if x["id"] == gid)
    return group_from_records(g, bundle["routes"])
