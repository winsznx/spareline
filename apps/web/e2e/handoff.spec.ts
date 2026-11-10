import { expect, test } from "@playwright/test";

import type { RunStatus, Scenario } from "../src/lib/api-types";

const API = process.env.API_BASE_URL ?? "http://localhost:8000/v1";

test("recommended run: approve, two confirmations, CSV unlocks", async ({ page, request }) => {
  const session = (await (await request.post(`${API}/sessions`)).json()) as { session: string };
  const headers = { "X-Spareline-Session": session.session };
  const scenarios = (await (await request.get(`${API}/scenarios`, { headers })).json()) as Scenario[];
  let runId: string | null = null;
  for (const s of scenarios.filter((x) => x.curated && x.latest_run_id)) {
    const run = (await (await request.get(`${API}/runs/${s.latest_run_id}`, { headers })).json()) as RunStatus;
    if (run.state === "recommended") {
      runId = run.run_id;
      break;
    }
  }
  test.skip(!runId, "no curated recommended run is published");

  await page.goto("/app");
  await page.evaluate((token) => window.localStorage.setItem("spareline.session", token), session.session);
  await page.goto(`/app/manifests/${runId}`);
  await expect(page.getByRole("heading", { name: "Handoff and manifests" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download donor CSV" })).toBeDisabled();
  await page.getByRole("button", { name: "Approve simulated plan" }).click();
  await expect(page.getByText("Awaiting handoff confirmation").or(page.getByText("Approved (simulation)"))).toBeVisible();
  const confirm = page.getByRole("button", { name: "Record confirmation" });
  await confirm.first().click();
  await expect(confirm).toHaveCount(1);
  await confirm.first().click();
  await expect(page.getByText("Transfer recorded (simulation)", { exact: true })).toBeVisible();
  const download = page.getByRole("link", { name: "Download donor CSV" });
  const href = await download.getAttribute("href");
  expect(href).toBeTruthy();
  const csv = await request.get(href as string);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("stop_id");
});
