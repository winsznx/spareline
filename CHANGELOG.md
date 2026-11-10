# Changelog

## 1.0.0 (2026-11-10)

First public release for DataNova 2026 (DN-OR-01).

- Ingests 160 same-station, same-date route groups (397 routes) from the Amazon Last Mile Routing Research Challenge evaluation split.
- Rescue solver: candidate helpers, meeting points and whole-stop transfers; OR-Tools re-sequencing with the helper's own stop order fixed; independent invariant checker; q90 cross-route travel check; `recommended`, `no_safe_rescue` and `low_confidence` outcomes.
- Baselines: no intervention and nearest feasible helper, scored on the same clock.
- Predeclared evaluation on 456 scenarios from 114 held-out groups (`eval_20261110T185425Z_21dfd2fe`).
- FastAPI backend with Postgres, per-session approval and two-driver confirmation, CSV manifests.
- Next.js app: landing, overview, recovery desk, scenarios, manifests, phone driver view, results, methodology.
- Fixed during development: delays were first modelled as the van being held in place, which made every long delay unrescuable; now a delay means the van is behind plan and still reachable.
