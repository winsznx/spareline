# Spareline evaluation

Evaluation `eval_20261110T185425Z_21dfd2fe`, algorithm `spareline-rescue-1.0.0`, travel model `xroute-quantile-1.0`.
Research evaluation on historical routes with simulated disruptions. It is not field performance.

## What was run

- Source: Amazon Last Mile Routing Research Challenge, evaluation split (2018 routes, CC BY-NC 4.0), downloaded unsigned from `s3://amazon-last-mile-challenges/almrrc2021/`. File SHA-256s are in `data/raw/almrrc2021/SHA256SUMS` and in the methodology endpoint.
- Groups: same station and same date, 2 to 4 routes, stop centroids within 12 km, departures within 90 minutes. 654 groups formed, 160 kept by hash order, split by `sha256(group_id) % 10 < 3` into 46 development and 114 evaluation groups.
- Development groups were used for tuning and for the three curated judge scenarios. Every number below comes from the 114 evaluation groups only.
- Config `config.json` (sha256 prefix `21dfd2fe`) fixes the donor rule, cutoff (40% through the donor's reconstructed day), four shocks per group (75 min delay, 105 min delay, 1.6x slowdown in the donor's area, van failure at cutoff), seed 2026 and a 10 s solver limit. 456 scenarios, no exclusions after results.

## Results

| Measure | No intervention | Nearest feasible helper | Spareline |
|---|---:|---:|---:|
| Missed packages (late windowed or past shift limit), all vans | 24,474 | 24,889 | 23,593 |
| Same, every cross-route leg at q90 travel | | 25,145 | 23,713 |
| Windowed packages on time (of 13,894) | 12,165 | 12,090 | 12,200 |
| Helper packages newly missed | | 14 (129 at q90) | 0 |

Denominator: 195,279 remaining packages across 456 scenarios.

- Spareline vs no intervention: 881 missed packages avoided, mean 1.93 per scenario (bootstrap 95% CI 1.47 to 2.43). Better in 74 scenarios, tied in 382, worse in 0.
- Spareline vs nearest feasible helper: 1,296 fewer missed packages. Better in 102, tied in 350, worse in 4.
- Recommendations: 74 of 456 scenarios (31 of 114 van failures, 18 and 17 of the delays, 8 of the slowdowns). In those 74 the donor would otherwise have missed 5,983 packages; the rescue saved 881 of them.
- Abstention: 354 scenarios had missed packages under no intervention. Spareline withheld a transfer in 280 of them, 76 as `low_confidence` and 204 as `no_safe_rescue`.
- Cost of the 74 rescues: mean 23.6 extra driving minutes across the fleet, 7.1 minutes of handoff waiting, 9.6 stops moved.
- Solver wall time: mean 1.87 s, median 2.71 s, p95 3.65 s, max 4.70 s (Apple Silicon laptop, 9 worker processes, excludes HTTP).
- Invariant checker violations in emitted plans: 0. Scenario errors: 0.

## Misses

The nearest-helper baseline beat Spareline in 4 scenarios. In two of them the baseline was better only under mean travel estimates and worse at q90. In `ev_595d77afca834027` the nearest helper's transfer saves more packages, but at q90 travel it makes that helper miss 2 of its own, which Spareline's strict helper rule forbids. In `ev_a9d777943f0e06d1` Spareline's best meeting point was outside the distance range the travel model was calibrated on, so it abstained, while the baseline (which has no such rule) moved 12 more packages to on time at q90. Both are deliberate conservative choices and both cost delivered packages here.

Most missed packages come from the shift-limit assumption, since only 7.1% of packages carry a time window. Window-only gains are small: 35 more windowed packages on time than no intervention.

## Cross-route travel model

There are no observed travel times between stops of different routes. The estimator uses empirical travel-time quantiles by straight-line distance band, per station, fitted on 333,256 within-route pairs from 112 development routes. On 424,165 held-out within-route pairs from 285 evaluation routes: MAE 59.9 s, median absolute error 43.8 s, P90 absolute error 127.1 s, and the q10 to q90 interval contains the observed time 81.1% of the time (nominal 80%). This checks the estimator on the kind of edge it was fitted to. Cross-route edges may behave differently, which is why rescues must survive the q90 check.

## Files

- `config.json` predeclared configuration
- `raw_results.jsonl` one row per scenario with all three policies
- `errors.jsonl` failed scenarios (empty for this run)
- `summary.json` aggregates, denominators and confidence intervals

## Reproduce

```bash
cd services/api
uv sync
python -m app.data.ingest --raw ../../data/raw/almrrc2021 --out ../../data/processed/bundle.json --max-groups 160
PYTHONPATH=. python -m scripts.fit_travel_model
PYTHONPATH=. python -m scripts.evaluate --config ../../evaluations/config.json --workers 8
```
