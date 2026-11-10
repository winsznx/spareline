from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from sqlalchemy import Engine, create_engine, text

from app.config import get_settings

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


@lru_cache
def engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def migrate(eng: Engine | None = None) -> list[str]:
    eng = eng or engine()
    applied: list[str] = []
    with eng.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(724101)"))
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
        )
        done = {r[0] for r in conn.execute(text("SELECT version FROM schema_migrations"))}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.stem in done:
                continue
            conn.exec_driver_sql(f.read_text())
            conn.execute(text("INSERT INTO schema_migrations(version) VALUES (:v)"), {"v": f.stem})
            applied.append(f.stem)
    return applied


if __name__ == "__main__":
    print("applied:", migrate())
