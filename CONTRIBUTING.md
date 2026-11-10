# Contributing

Thanks for looking. Spareline is a research prototype built for DataNova 2026, so the bar for changes is that they stay honest about what the data can show.

## Setup

See "Run locally" in the README. You need Docker (for Postgres), Python 3.12 with `uv`, Node 20+ with `pnpm`.

## Before opening a pull request

```bash
cd services/api && .venv/bin/ruff check app scripts && .venv/bin/python -m pytest
cd apps/web && pnpm lint && pnpm typecheck && pnpm build
```

Run the browser tests against a local stack with `BASE_URL=http://localhost:3000 pnpm test:e2e`.

## Rules that matter here

- Every number shown in the UI, README or deck must come from a solver run or `evaluations/summary.json`. No hand-typed results.
- Simulated inputs (delays, slowdowns, failures) and estimated values (cross-route travel) must stay labelled as such.
- If you change the solver, scoring or travel model, bump `ALGORITHM_VERSION` or the travel model version and re-run the evaluation. Do not edit `evaluations/config.json` after seeing results; add a new config instead.
- Solver changes need a test in `services/api/tests/test_solver.py` that would fail without them.

## Commit style

Short imperative subject (`Fix helper insertion when prefix is empty`), a body that says why.
