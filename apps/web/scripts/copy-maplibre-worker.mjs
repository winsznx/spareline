// MapLibre v6 loads its tile worker from a URL. Bundlers rename the chunk, so serve the shipped worker as a static file.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json"));
mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(dist, "dist", "maplibre-gl-worker.mjs"), "public/vendor/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs to public/vendor");
