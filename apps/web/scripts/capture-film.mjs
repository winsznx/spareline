// Records one real 1920x1080 clip per film scene from the deployed app, with genuine solver waits.
// A small dot mirrors the real pointer position (browser recordings omit the OS cursor).
// Usage: BASE_URL=https://spareline-steel.vercel.app OUT=/path/to/assets/footage node scripts/capture-film.mjs [scene...]
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://spareline-steel.vercel.app";
const API = `${BASE}/api/v1`;
const OUT = process.env.OUT ?? path.resolve("footage");
const W = 1920;
const H = 1080;
await mkdir(OUT, { recursive: true });

const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.id = '__cursor';
    Object.assign(d.style, {position:'fixed',left:'0',top:'0',width:'22px',height:'22px',marginLeft:'-11px',marginTop:'-11px',
      borderRadius:'50%',background:'rgba(23,28,34,.28)',border:'2px solid #171C22',zIndex:2147483647,pointerEvents:'none',
      transition:'transform 90ms ease-out',transform:'translate(-100px,-100px)'});
    document.body.appendChild(d);
    addEventListener('mousemove', e => { d.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    addEventListener('mousedown', () => { d.style.background = 'rgba(167,105,65,.55)'; }, true);
    addEventListener('mouseup', () => { d.style.background = 'rgba(23,28,34,.28)'; }, true);
  });`;

const log = {};
const browser = await chromium.launch();
const sessionToken = async (request) => (await (await request.post(`${API}/sessions`)).json()).session;

async function scene(name, viewport, fn) {
  const dir = path.join(OUT, `.rec-${name}`);
  await rm(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport, recordVideo: { dir, size: viewport } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = [];
  const mark = (label) => marks.push({ label, t: (Date.now() - t0) / 1000 });
  await fn(page, mark);
  await ctx.close();
  const [file] = (await readdir(dir)).filter((f) => f.endsWith(".webm"));
  await rename(path.join(dir, file), path.join(OUT, `${name}.webm`));
  await rm(dir, { recursive: true, force: true });
  log[name] = marks;
  console.log(name, JSON.stringify(marks));
}

async function glide(page, x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
}

async function curated(request) {
  const list = await (await request.get(`${API}/scenarios`)).json();
  return Object.fromEntries(list.filter((s) => s.curated).map((s) => [s.curated_key, s]));
}

const pick = process.argv.slice(2);
const want = (n) => pick.length === 0 || pick.includes(n);
const req = (await browser.newContext()).request;
const C = await curated(req);
const A = C.a_route_falls_behind;
const B = C.b_helper_isnt_really_free;

if (want("s1"))
  await scene("s1", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/app`);
    await page.getByRole("heading", { name: "Dispatch overview" }).waitFor();
    await page.waitForTimeout(2500);
    mark("ready");
    await glide(page, 700, 520);
    await page.waitForTimeout(2500);
    await glide(page, 1100, 640);
    await page.waitForTimeout(6000);
  });

if (want("s2"))
  await scene("s2", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight, behavior: "instant" }));
    await page.waitForTimeout(3000);
    mark("ready");
    await glide(page, 600, 560);
    await page.waitForTimeout(3000);
    await glide(page, 1400, 620);
    await page.waitForTimeout(6000);
  });

if (want("s3"))
  await scene("s3", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/app/scenarios`);
    await page.getByRole("button", { name: "Run scenario" }).first().waitFor();
    await page.waitForTimeout(1500);
    mark("ready");
    const btn = page.getByRole("button", { name: "Run scenario" }).first();
    const box = await btn.boundingBox();
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    mark("click");
    await btn.click();
    await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
    mark("decision");
    await page.waitForTimeout(5000);
  });

if (want("s4"))
  await scene("s4", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/app/recovery/${A.id}?run=${A.latest_run_id}`);
    await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    mark("ready");
    await glide(page, 520, 480);
    await page.waitForTimeout(2500);
    await glide(page, 560, 650);
    await page.waitForTimeout(3000);
    await glide(page, 1500, 140);
    await page.waitForTimeout(3500);
  });

if (want("s5")) {
  // Start from a 60-minute revision of scenario A, then push to 90 on camera and recalculate for real.
  const token = await sessionToken(req);
  const headers = { "X-Spareline-Session": token, "content-type": "application/json" };
  const child = await (
    await req.post(`${API}/scenarios`, {
      headers,
      data: { route_group_id: A.route_group_id, donor_route_id: A.donor_route_id, seed: 1, parent_scenario_id: A.id,
        shock: { kind: "delay", delay_minutes: 60, travel_time_factor: 1.0 } },
    })
  ).json();
  const run = await (await req.post(`${API}/scenarios/${child.id}/run`, { headers, data: {} })).json();
  for (let i = 0; i < 60; i += 1) {
    const r = await (await req.get(`${API}/runs/${run.run_id}`)).json();
    if (!["queued", "running"].includes(r.state)) break;
    await new Promise((res) => setTimeout(res, 700));
  }
  await scene("s5", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("spareline.session", t), token);
    await page.goto(`${BASE}/app/recovery/${child.id}?run=${run.run_id}`);
    await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    mark("ready_60min");
    const slider = page.getByLabel("Route delay");
    const sb = await slider.boundingBox();
    const y = sb.y + sb.height / 2;
    const x60 = sb.x + sb.width * (60 / 180);
    const x90 = sb.x + sb.width * (90 / 180);
    await glide(page, x60, y);
    await page.mouse.down();
    await page.mouse.move(x90, y, { steps: 30 });
    await page.mouse.up();
    const val = await slider.inputValue();
    if (val !== "90") {
      await slider.focus();
      for (let v = Number(val); v < 90; v += 5) await slider.press("ArrowRight");
      for (let v = Number(val); v > 90; v -= 5) await slider.press("ArrowLeft");
    }
    mark("delay_90");
    await page.waitForTimeout(900);
    const before = page.url();
    const recalc = page.getByRole("button", { name: "Recalculate rescue" }).first();
    const rb = await recalc.boundingBox();
    await glide(page, rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.waitForTimeout(400);
    mark("solver_started");
    await recalc.click();
    await page.waitForFunction((b) => location.href !== b && location.href.includes("run="), before, { timeout: 60_000 });
    await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 90_000 });
    await page.getByText("30 → 2").or(page.getByText("30→2")).first().waitFor({ timeout: 90_000 }).catch(() => {});
    mark("solver_finished");
    await page.waitForTimeout(2500);
    await glide(page, 1690, 1020);
    await page.mouse.wheel(0, 0);
    await page.waitForTimeout(7000);
    mark("end");
  });
}

if (want("s6"))
  await scene("s6", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/app/recovery/${B.id}?run=${B.latest_run_id}`);
    await page.getByRole("heading", { name: "Compare policies" }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    mark("candidate_rejected");
    await glide(page, 1690, 560);
    await page.waitForTimeout(3500);
    await glide(page, 1700, 760);
    await page.waitForTimeout(5000);
  });

if (want("s7")) {
  const token = await sessionToken(req);
  await scene("s7", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("spareline.session", t), token);
    await page.goto(`${BASE}/app/manifests/${A.latest_run_id}`);
    await page.getByRole("heading", { name: "Handoff and manifests" }).waitFor();
    await page.waitForTimeout(2000);
    mark("ready");
    const approve = page.getByRole("button", { name: "Approve simulated plan" });
    const ab = await approve.boundingBox();
    await glide(page, ab.x + ab.width / 2, ab.y + ab.height / 2);
    await page.waitForTimeout(400);
    await approve.click();
    mark("approved");
    await page.waitForTimeout(1500);
    for (let i = 0; i < 2; i += 1) {
      const c = page.getByRole("button", { name: "Record confirmation" }).first();
      const cb = await c.boundingBox();
      await glide(page, cb.x + cb.width / 2, cb.y + cb.height / 2, 18);
      await page.waitForTimeout(300);
      await c.click();
      mark(`ack_${i + 1}`);
      await page.waitForTimeout(1300);
    }
    const dl = page.waitForEvent("download");
    const link = page.getByRole("link", { name: "Download donor CSV" });
    const lb = await link.boundingBox();
    await glide(page, lb.x + lb.width / 2, lb.y + lb.height / 2, 18);
    await page.waitForTimeout(300);
    await link.click();
    await (await dl).path();
    mark("manifests_downloaded");
    await page.waitForTimeout(3500);
  });
}

if (want("s7m"))
  await scene("s7m", { width: 430, height: 932 }, async (page, mark) => {
    await page.goto(`${BASE}/driver/${A.latest_run_id}?role=helper`);
    await page.waitForTimeout(2500);
    mark("ready");
    await page.mouse.move(215, 600);
    await page.mouse.wheel(0, 0);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, 70);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(4000);
  });

if (want("s8"))
  await scene("s8", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/app/results`);
    await page.waitForTimeout(3500);
    mark("ready");
    await glide(page, 900, 600);
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, 70);
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(6500);
  });

if (want("s9"))
  await scene("s9", { width: W, height: H }, async (page, mark) => {
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(3500);
    mark("ready");
    await glide(page, 420, 640);
    await page.waitForTimeout(10000);
  });

await browser.close();
await writeFile(path.join(OUT, "events.json"), JSON.stringify({ base_url: BASE, captured_at: new Date().toISOString(), scenes: log }, null, 2));
