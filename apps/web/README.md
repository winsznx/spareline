# Spareline web app

Next.js (App Router) front end for Spareline: landing page, dispatch overview, recovery desk, scenario library, handoff and manifests, phone driver view, results and methodology.

```bash
pnpm install
pnpm dev            # http://localhost:3000, API at http://localhost:8000/v1 by default
pnpm build && pnpm start
pnpm lint && pnpm typecheck
BASE_URL=http://localhost:3000 pnpm test:e2e
```

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/v1` | Absolute API URL, or a same-origin path such as `/api/v1` |
| `SPARELINE_API_ORIGIN` | `http://localhost:8000` | Where `/api/v1/*` is forwarded when the path form is used |
| `NEXT_PUBLIC_MAP_STYLE_URL` | OpenFreeMap positron | MapLibre style URL |

`scripts/copy-maplibre-worker.mjs` copies the MapLibre worker into `public/vendor` before dev and build. `scripts/capture-demo.mjs` records the product walkthrough and screenshots from a running deployment.
