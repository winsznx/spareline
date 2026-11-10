# Spareline

**Tagline:** Save deliveries that are about to miss their promised time.

## Inspiration
When one delivery van runs late, a dispatcher can ask another driver to help. That only works if both vans can reach the same place, the receiving van has room, and the rescued parcels arrive without making the helper late on its own route. We built for that one decision instead of a whole fleet suite.

## What it does
Spareline opens a recovery desk for a group of vans from the same depot on the same day. It replays their real historical routes up to a cutoff, applies a declared simulated disruption, and shows which deliveries are at risk. It then searches for a transfer: which van helps, where the two drivers meet, which stops move, and in what order the helper delivers them. It compares that plan with doing nothing and with sending the nearest van. When a rescue is recommended it produces separate revised manifests for both drivers as CSV and a phone-friendly printable view. Nothing is marked transferred until the dispatcher approves and both drivers confirm (simulated). When no transfer is safe it says why: the helper would be late, the van is full, or the gain disappears when cross-route travel runs slow.

## How we built it
- Data: the Amazon Last Mile Routing Research Challenge evaluation split (2018 routes, CC BY-NC 4.0), pulled unsigned from the public S3 bucket. 160 same-station, same-date groups of 2 to 4 routes: 397 routes, 54,405 stops, 94,229 packages.
- Solver (Python): stop-level replay on each route's own travel matrix, candidate search over helpers, meeting points and whole-stop transfer sets, OR-Tools routing to re-sequence the helper while keeping its own stops in observed order, an independent invariant checker, and a q90 travel re-check.
- Cross-route travel: the dataset only has travel times within a route. We fit distance-band travel-time quantiles per station on development routes and checked them on 424,165 held-out pairs: MAE 59.9 s, P90 error 127 s, q10 to q90 interval coverage 81.1%.
- Backend: FastAPI and Postgres in an isolated Docker Compose project on our VPS, with process-pool solver jobs, idempotent runs keyed by input hash, per-session approval state and versioned migrations.
- Frontend: Next.js and MapLibre on Vercel, deployed with the CLI.

## Validation
456 predeclared scenarios on 114 held-out station-day groups (4 shocks each: 75 and 105 minute delays, a 1.6x slowdown, a van failure). Missed packages across all vans: 24,474 doing nothing, 24,889 with the nearest feasible helper, 23,593 with Spareline, out of 195,279 remaining packages. Spareline was never worse than doing nothing and avoided 881 missed packages (mean 1.93 per scenario, 95% CI 1.47 to 2.43). The nearest-helper policy made helpers miss 14 of their own packages (129 at q90 travel); Spareline made them miss 0. Spareline recommended 74 transfers and withheld one in 280 of the 354 scenarios that had misses. It did worse than the nearest-helper policy in 4 scenarios, and we document each. p95 solver time 3.65 s.

## Challenges
1. No observed travel times between routes. We estimate them, publish the held-out error, and require every recommendation to survive q90 travel on those legs.
2. Our first delay model held the late van in place, so any helper had to wait out the whole delay at the meeting point and no 120-minute delay was ever rescuable. On 16 development groups none of the 120-minute delays produced a recommendation. Modeling the delay as the van being X minutes behind plan, still driving and reachable, fixed it, and long delays started producing rescues that pass every check.
3. Planned service time repeats per package in 99.1% of multi-package stops. Summing it would have tripled stop times, so we take the maximum.

## Accomplishments
On the "A route falls behind" scenario (DCH1, 2018-07-17), doing nothing misses 30 packages, the nearest van misses 19, and Spareline's plan misses 2 with no new misses for the helper. Both drivers get a revised manifest.

## What we learned
A transfer that rescues the late van can still make the fleet worse. Most of the value is in saying no clearly and showing why.

## What's next
Test with real concurrent vehicle telemetry and measured travel between routes, then pilot with a consenting delivery operator on licensed data.

## Limitations
Historical routes with simulated disruptions. Progress is reconstructed, not GPS. Coordinates are anonymized. Cross-route travel is estimated. The 60-minute shift limit and handoff time are assumptions. No field validation. The dataset licence restricts commercial use.

## Links
- Working demo: https://spareline-steel.vercel.app
- PPT: artifacts/Spareline_DataNova_2026_Final.pptx (and .pdf)
- Methodology: https://spareline-steel.vercel.app/app/methodology
- Dataset: https://registry.opendata.aws/amazon-last-mile-challenges/ (CC BY-NC 4.0)

## Team
Timothy Popoola and Anu Kolapo.
