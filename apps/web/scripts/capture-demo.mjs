// Real-product capture for the deck and the Hyperframes edit. Drives the deployed app in Chromium,
// waits on genuine solver runs, saves screenshots, a 1920x1080 recording and an event trace.
// Usage: BASE_URL=https://spareline-steel.vercel.app node scripts/capture-demo.mjs
import { mkdir, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://spareline-steel.vercel.app";
const OUT = path.resolve(process.cwd(), "../../artifacts");
const SHOTS = path.join(OUT, "screens");
const VIDEO = path.join(OUT, "footage");
await mkdir(SHOTS, { recursive: true });
await mkdir(VIDEO, { recursive: true });

const t0 = Date.now();
const events = [];
const mark = (name, detail = {}) => events.push({ t_ms: Date.now() - t0, name, ...detail });

const browser = await chromium.launch();

async function curated(page) {
  const res = await page.request.get(`${BASE}/api/v1/scenarios`);
  const list = await res.json();
  return Object.fromEntries(list.filter((s) => s.curated).map((s) => [s.curated_key, s]));
}

async function runScenario(page, scenarioId) {
  await page.goto(`${BASE}/app/recovery/${scenarioId}`);
  await page.getByRole("button", { name: "Recalculate rescue" }).first().waitFor();
  return page;
}

// Stills at 1440x900 (deck) ------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const sc = await curated(page);
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, "landing-1440.png") });

  await page.goto(`${BASE}/app`);
  await page.getByRole("heading", { name: "Dispatch overview" }).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, "overview-1440.png") });

  const a = sc.a_route_falls_behind;
  await page.goto(`${BASE}/app/recovery/${a.id}?run=${a.latest_run_id}`);
  await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(SHOTS, "desk-recommended-1440.png") });

  const b = sc.b_helper_isnt_really_free;
  await page.goto(`${BASE}/app/recovery/${b.id}?run=${b.latest_run_id}`);
  await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(SHOTS, "desk-rejected-1440.png") });

  await page.goto(`${BASE}/app/manifests/${a.latest_run_id}`);
  await page.getByRole("heading", { name: "Handoff and manifests" }).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "handoff-1440.png") });

  await page.goto(`${BASE}/app/scenarios`);
  await page.getByRole("button", { name: "Run scenario" }).first().waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "scenarios-1440.png") });

  await page.goto(`${BASE}/app/results`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, "results-1440.png") });
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/driver/${a.latest_run_id}?role=helper`);
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: path.join(SHOTS, "driver-mobile-390.png") });
  await m.close();
}

// Recorded walkthrough at 1920x1080 ----------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: VIDEO, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  const sc = await curated(page);
  const a = sc.a_route_falls_behind;
  const b = sc.b_helper_isnt_really_free;

  await page.goto(`${BASE}/app`);
  await page.getByRole("heading", { name: "Dispatch overview" }).waitFor();
  mark("scenario_loaded", { scenario_id: a.id });
  await page.waitForTimeout(4000);

  await runScenario(page, a.id);
  await page.waitForTimeout(3000);
  const slider = page.getByLabel("Route delay");
  await slider.focus();
  for (let i = 0; i < 2; i += 1) await slider.press("ArrowRight");
  mark("shock_set", { delay_minutes: "90 + 10 (two steps)" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Recalculate rescue" }).first().click();
  mark("solver_started");
  await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 90_000 });
  mark("solver_finished", { url: page.url() });
  await page.waitForTimeout(6000);

  await page.goto(`${BASE}/app/recovery/${b.id}?run=${b.latest_run_id}`);
  await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
  mark("candidate_rejected", { scenario_id: b.id, run_id: b.latest_run_id });
  await page.waitForTimeout(6000);

  await page.goto(`${BASE}/app/manifests/${a.latest_run_id}`);
  await page.getByRole("heading", { name: "Handoff and manifests" }).waitFor();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Approve simulated plan" }).click();
  await page.waitForTimeout(1500);
  const confirm = page.getByRole("button", { name: "Record confirmation" });
  await confirm.first().click();
  await page.waitForTimeout(1200);
  await confirm.first().click();
  await page.waitForTimeout(1500);
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download donor CSV" }).click();
  await (await dl).saveAs(path.join(VIDEO, "donor-manifest.csv"));
  mark("manifests_downloaded");
  await page.waitForTimeout(3000);

  await page.goto(`${BASE}/app/results`);
  await page.waitForTimeout(6000);
  mark("results_shown");
  await ctx.close();
  const files = (await readdir(VIDEO)).filter((f) => f.endsWith(".webm"));
  if (files.length) await rename(path.join(VIDEO, files.at(-1)), path.join(VIDEO, "spareline-walkthrough-1920x1080.webm"));
}

await browser.close();
await writeFile(path.join(VIDEO, "events.json"), JSON.stringify({ base_url: BASE, captured_at: new Date().toISOString(), events }, null, 2));
console.log(JSON.stringify(events, null, 1));
