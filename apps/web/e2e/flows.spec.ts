import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
}

async function isMobile(page: Page): Promise<boolean> {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

test("landing explains the job and enters the desk", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "When a route falls behind, know exactly what to move." })).toBeVisible();
  await expect(page.getByText("Research replay using historical delivery routes. Delays are simulated.")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("region", { name: "When a route falls behind, know exactly what to move." }).getByRole("link", { name: "Open the recovery desk", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Dispatch overview" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("curated scenario runs the live solver and shows a decision", async ({ page }) => {
  await page.goto("/app/scenarios");
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  const runButtons = page.getByRole("button", { name: "Run scenario" });
  await expect(runButtons.first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await runButtons.first().click();
  await expect(page).toHaveURL(/\/app\/recovery\/[0-9a-f-]+\?run=/);
  if (await isMobile(page)) await page.getByRole("tab", { name: "decision" }).click();
  await expect(page.getByRole("heading", { name: "Compare policies" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table", { name: /Policy comparison/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("changing the delay creates a new revision and recalculates", async ({ page }) => {
  await page.goto("/app/recovery");
  await expect(page).toHaveURL(/\/app\/recovery\/[0-9a-f-]+/);
  if (await isMobile(page)) await page.getByRole("tab", { name: "decision" }).click();
  const before = page.url();
  const slider = page.getByLabel("Route delay");
  await slider.focus();
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await page.getByRole("button", { name: "Recalculate rescue" }).first().click();
  await expect.poll(() => page.url(), { timeout: 30_000 }).not.toBe(before);
  await expect(page.getByRole("heading", { name: "Compare policies" })).toBeVisible({ timeout: 60_000 });
});

test("results and methodology are reachable and honest", async ({ page }) => {
  await page.goto("/app/results");
  await expect(page.getByText("Research evaluation — not field performance.", { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto("/app/methodology");
  await expect(page.getByRole("heading", { name: "Data source and licence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "CC BY-NC 4.0" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("keyboard users can reach the primary navigation", async ({ page }) => {
  await page.goto("/app");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});
