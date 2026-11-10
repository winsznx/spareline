"""Seed Postgres from the processed bundle, travel model, evaluation outputs and curated scenarios.

Idempotent: source tables are replaced only if the dataset manifest changed; curated scenarios are upserted
by key; the evaluation run is inserted once per evaluation_id.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import orjson
from sqlalchemy import text

from app.data.bundle import load_bundle
from app.db.core import engine, migrate

ROOT = Path(__file__).resolve().parents[4]


def _j(v) -> str:
    return json.dumps(v, default=str)


def seed_source(conn, bundle: dict) -> None:
    ds = bundle["dataset"]
    existing = conn.execute(
        text("SELECT sha256_manifest FROM source_datasets WHERE slug = :s"), {"s": ds["slug"]}
    ).scalar()
    have_groups = conn.execute(text("SELECT count(*) FROM route_groups")).scalar_one()
    if existing == ds["manifest_sha256"] and have_groups == len(bundle["groups"]):
        print("source data already seeded")
        return
    if existing is not None:
        raise SystemExit("A different dataset manifest is already seeded; refusing to overwrite automatically.")
    dsid = conn.execute(
        text("""INSERT INTO source_datasets (slug, provider, dataset_year, source_url, license_name, acquired_at,
                  sha256_manifest, metadata) VALUES (:slug, :provider, :year, :url, :lic, :acq, :sha,
                  CAST(:meta AS jsonb)) RETURNING id"""),
        {
            "slug": ds["slug"],
            "provider": ds["provider"],
            "year": ds["dataset_year"],
            "url": ds["source_url"],
            "lic": ds["license_name"],
            "acq": ds["acquired_at"],
            "sha": ds["manifest_sha256"],
            "meta": _j({k: ds[k] for k in ("split", "s3_prefix", "file_sha256", "selection")}),
        },
    ).scalar_one()
    routes, stops, pkgs = [], [], []
    for rid, r in bundle["routes"].items():
        routes.append(
            {
                "id": rid,
                "ds": dsid,
                "st": r["station_code"],
                "d": r["date"],
                "dep": r["departure_utc"],
                "cap": r["capacity_cm3"],
                "ord": _j(r["travel"]["order"]),
                "sec": _j(r["travel"]["seconds"]),
            }
        )
        for s in r["stops"]:
            stops.append(
                {
                    "r": rid,
                    "s": s["id"],
                    "k": s["kind"],
                    "lat": s["lat"],
                    "lng": s["lng"],
                    "z": s["zone_id"],
                    "o": s["observed_sequence"],
                }
            )
            for p in s["packages"]:
                pkgs.append(
                    {
                        "r": rid,
                        "s": s["id"],
                        "p": p["id"],
                        "ws": p["window_start_utc"],
                        "we": p["window_end_utc"],
                        "svc": p["planned_service_seconds"],
                        "v": p["volume_cm3"],
                        "dim": _j(p["dimensions"]),
                    }
                )
    conn.execute(
        text("""INSERT INTO source_routes VALUES (:id, :ds, :st, :d, :dep, :cap, CAST(:ord AS jsonb),
                         CAST(:sec AS jsonb))"""),
        routes,
    )
    conn.execute(text("INSERT INTO source_stops VALUES (:r, :s, :k, :lat, :lng, :z, :o)"), stops)
    conn.execute(text("INSERT INTO source_packages VALUES (:r, :s, :p, :ws, :we, :svc, :v, CAST(:dim AS jsonb))"), pkgs)
    conn.execute(
        text("""INSERT INTO route_groups VALUES (:id, :st, :d, CAST(:rids AS jsonb), :part, :sel,
                CAST(:prov AS jsonb))"""),
        [
            {
                "id": g["id"],
                "st": g["station_code"],
                "d": g["date"],
                "rids": _j(g["route_ids"]),
                "part": g["partition"],
                "sel": ds["selection"]["rule"],
                "prov": _j({"source": "amazon_historical_2018", "max_centroid_km": g["max_centroid_km"]}),
            }
            for g in bundle["groups"]
        ],
    )
    print(f"seeded {len(routes)} routes, {len(stops)} stops, {len(pkgs)} packages, {len(bundle['groups'])} groups")


def seed_travel_model(conn, tm: dict) -> None:
    conn.execute(
        text("""INSERT INTO travel_models (version, model, holdout) VALUES (:v, CAST(:m AS jsonb),
                         CAST(:h AS jsonb)) ON CONFLICT (version) DO UPDATE SET model = EXCLUDED.model,
                         holdout = EXCLUDED.holdout"""),
        {"v": tm["model"]["version"], "m": _j(tm["model"]), "h": _j(tm["holdout"])},
    )


def seed_evaluation(conn, eval_dir: Path) -> None:
    sp = eval_dir / "summary.json"
    if not sp.exists():
        print("no evaluation summary; skipping")
        return
    s = json.loads(sp.read_text())
    if conn.execute(text("SELECT 1 FROM evaluation_runs WHERE id = :i"), {"i": s["evaluation_id"]}).first():
        print("evaluation already seeded")
        return
    cfg = json.loads((eval_dir / "config.json").read_text())
    conn.execute(
        text("""INSERT INTO evaluation_runs VALUES (:id, :c, :d, :a, :st, CAST(:cfg AS jsonb), CAST(:sum AS jsonb),
                :s0, :s1)"""),
        {
            "id": s["evaluation_id"],
            "c": s["config_sha256"],
            "d": s["dataset_sha256"],
            "a": s["algorithm_version"],
            "st": s["status"],
            "cfg": _j(cfg),
            "sum": _j(s),
            "s0": datetime.fromisoformat(s["started_at"]),
            "s1": datetime.fromisoformat(s["completed_at"]),
        },
    )
    rows = [json.loads(line) for line in (eval_dir / "raw_results.jsonl").read_text().splitlines() if line.strip()]
    conn.execute(
        text("INSERT INTO evaluation_results VALUES (:e, :i, CAST(:r AS jsonb))"),
        [{"e": s["evaluation_id"], "i": i, "r": _j(r)} for i, r in enumerate(rows)],
    )
    print(f"seeded evaluation {s['evaluation_id']} with {len(rows)} rows")


def seed_curated(conn, curated: list[dict], dataset_sha: str) -> None:
    for c in curated:
        row = conn.execute(text("SELECT id FROM scenarios WHERE curated_key = :k"), {"k": c["key"]}).first()
        params = {
            "g": c["group_id"],
            "d": c["donor_route_id"],
            "seed": c["seed"],
            "shock": _j(c["shock"]),
            "ex": _j(c.get("excluded_helper_route_ids", [])),
            "k": c["key"],
            "t": c["title"],
            "h": dataset_sha,
        }
        if row:
            # Curated scenario definitions are immutable once runs exist; only the title may change.
            conn.execute(
                text("UPDATE scenarios SET title = :t WHERE curated_key = :k"), {"t": c["title"], "k": c["key"]}
            )
            continue
        conn.execute(
            text("""INSERT INTO scenarios (group_id, donor_route_id, cutoff_utc, seed, shock, excluded_helpers,
                             is_curated, curated_key, title, source_hash) VALUES (:g, :d, NULL, :seed,
                             CAST(:shock AS jsonb), CAST(:ex AS jsonb), TRUE, :k, :t, :h)"""),
            params,
        )
    print(f"curated scenarios: {len(curated)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--evaluations", type=Path, default=ROOT / "evaluations")
    args = ap.parse_args()
    print("migrations applied:", migrate())
    bundle = load_bundle(str(args.processed / "bundle.json"))
    tm = orjson.loads((args.processed / "travel_model.json").read_bytes())
    with engine().begin() as conn:
        seed_source(conn, bundle)
        seed_travel_model(conn, tm)
        seed_evaluation(conn, args.evaluations)
        cp = args.processed / "curated.json"
        if cp.exists():
            seed_curated(conn, json.loads(cp.read_text()), bundle["dataset"]["manifest_sha256"])


if __name__ == "__main__":
    main()
