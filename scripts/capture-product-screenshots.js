"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const workspaceRoot = path.resolve(__dirname, "..");
const port = 4179;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshots = [
  ["today", "screenshot-session.png"],
  ["project", "screenshot-trends.png"],
  ["global", "screenshot-project.png"],
  ["quality", "screenshot-workflow.png"],
];

async function main() {
  const harness = spawn(process.execPath, ["scripts/webview-harness.js"], {
    cwd: workspaceRoot,
    env: { ...process.env, DEVTRACKER_WEBVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let harnessError = "";
  harness.stderr.on("data", (chunk) => {
    harnessError += String(chunk);
  });

  let browser;
  try {
    await waitForHarness(harness);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      locale: "en-US",
      timezoneId: "Europe/Madrid",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const [view, filename] of screenshots) {
      await page.goto(`${baseUrl}/dashboard?state=populated&theme=dark&view=${view}`);
      await page.locator("html[data-harness-requests='1']").waitFor();
      await page.locator("#dashboard-content[aria-busy='false']").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const outputPath = path.join(workspaceRoot, "media", filename);
      await page.screenshot({
        path: outputPath,
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      });
      console.log(`Captured ${path.relative(workspaceRoot, outputPath)}`);
    }
    await context.close();
  } catch (error) {
    if (harnessError.trim()) {
      console.error(harnessError.trim());
    }
    throw error;
  } finally {
    await browser?.close();
    harness.kill("SIGTERM");
  }
}

async function waitForHarness(harness) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (harness.exitCode !== null) {
      throw new Error(`Webview harness exited with code ${harness.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The local harness has not started accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the webview harness");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
