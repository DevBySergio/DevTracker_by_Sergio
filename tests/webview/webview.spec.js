//@ts-check

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const views = ["today", "project", "global", "quality"];
const themes = ["light", "dark", "high-contrast"];
const widths = [600, 900];

function url({
  state = "populated",
  theme = "dark",
  view = "today",
} = {}) {
  return `/dashboard?state=${state}&theme=${theme}&view=${view}`;
}

async function openDashboard(page, options = {}) {
  const width = options.width ?? 900;
  const height = options.height ?? 900;
  const state = options.state ?? "populated";
  await page.setViewportSize({ width, height });
  await page.goto(url(options));
  await expect(page.locator("html")).toHaveAttribute("data-harness-requests", "1");
  await expect(page.locator("html")).not.toHaveAttribute("data-harness-error", /.+/);
  if (state !== "loading") {
    await expect(page.locator("#dashboard-content")).toHaveAttribute("aria-busy", "false");
  }
  await page.evaluate(() => document.fonts.ready);
}

test.describe("webview accessibility", () => {
  test("implements keyboard navigation for tabs, filters, and project rows", async ({ page }) => {
    await openDashboard(page);

    const overview = page.getByRole("tab", { name: "Overview" });
    const trends = page.getByRole("tab", { name: "Trends" });
    await overview.focus();
    await overview.press("ArrowRight");
    await expect(trends).toHaveAttribute("aria-selected", "true");
    await expect(trends).toHaveAttribute("tabindex", "0");
    await expect(trends).toBeFocused();

    await trends.press("End");
    await expect(page.getByRole("tab", { name: "Workflow" })).toBeFocused();
    await page.getByRole("tab", { name: "Workflow" }).press("Home");
    await expect(overview).toBeFocused();
    await expect(page.getByRole("button", { name: "7 Days" })).toHaveAttribute("aria-pressed", "true");

    await openDashboard(page, { view: "global" });
    const projectRows = page.locator("#global-projects-table tbody tr[tabindex='0']");
    await expect(projectRows).toHaveCount(2);
    await projectRows.nth(1).focus();
    await projectRows.nth(1).press("Space");
    await expect(projectRows.nth(1)).toHaveAttribute("aria-selected", "true");
  });

  for (const view of views) {
    test(`passes an axe-core audit in the ${view} view`, async ({ page }) => {
      await openDashboard(page, { view });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  for (const theme of ["light", "high-contrast"]) {
    test(`passes an axe-core audit in the ${theme} theme`, async ({ page }) => {
      await openDashboard(page, { theme });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  for (const state of ["empty", "loading", "error"]) {
    test(`passes an axe-core audit in the ${state} state`, async ({ page }) => {
      await openDashboard(page, { state });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("connects every chart to a captioned table alternative", async ({ page }) => {
    await openDashboard(page, { view: "today" });
    await assertChartAlternatives(page, 1);

    await page.getByRole("tab", { name: "Trends" }).click();
    await expect(page.locator("#dashboard-content")).toHaveAttribute("aria-busy", "false");
    await assertChartAlternatives(page, 3);
  });
});

test.describe("webview states", () => {
  test("renders the empty state", async ({ page }) => {
    await openDashboard(page, { state: "empty" });
    await expect(page.getByRole("heading", { name: "No activity yet today" })).toBeVisible();
    await expect(page).toHaveScreenshot("state-empty.png", { fullPage: true });
  });

  test("renders the loading state", async ({ page }) => {
    await openDashboard(page, { state: "loading" });
    await expect(page.locator("#dashboard-content")).toHaveAttribute("aria-busy", "true");
    await expect(page).toHaveScreenshot("state-loading.png", { fullPage: true });
  });

  test("renders the error state", async ({ page }) => {
    await openDashboard(page, { state: "error" });
    await expect(page.locator("#page-subtitle")).toContainText("HARNESS_UNAVAILABLE");
    await expect(page).toHaveScreenshot("state-error.png", { fullPage: true });
  });
});

test.describe("webview visual baselines", () => {
  for (const theme of themes) {
    for (const width of widths) {
      test(`captures ${theme} at ${width}px`, async ({ page }) => {
        await openDashboard(page, { theme, width });
        await expect(page.locator("#overview-content")).toBeVisible();
        await expect(page).toHaveScreenshot(`overview-${theme}-${width}.png`, { fullPage: true });
      });
    }
  }

  for (const view of views.slice(1)) {
    test(`captures the populated ${view} view`, async ({ page }) => {
      await openDashboard(page, { view });
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      if (view === "project") {
        await expect(page.locator("#trend-active-time")).toHaveText("2h 0m");
      }
      if (view === "global") {
        await expect(page.locator("#global-projects-table tbody tr[tabindex='0']")).toHaveCount(2);
      }
      if (view === "quality") {
        await expect(page.locator("#w-current")).toHaveText("8");
      }
      await expect(page).toHaveScreenshot(`view-${view}.png`, { fullPage: true });
    });
  }
});

async function assertChartAlternatives(page, expectedCount) {
  const visiblePanel = page.locator(".view-section.active");
  const canvases = visiblePanel.locator("canvas");
  await expect(canvases).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    const canvas = canvases.nth(index);
    const describedBy = await canvas.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const summary = page.locator(`#${describedBy}`);
    await expect(summary).toBeVisible();
    await summary.click();
    const table = page.locator(`#${describedBy.replace(/-summary$/, "")}`);
    await expect(table.locator("caption")).not.toHaveText("");
    await expect(table.locator("tbody tr").first()).toBeVisible();
  }
}
