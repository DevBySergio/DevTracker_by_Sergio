//@ts-check

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/webview",
  outputDir: "./test-results/webview",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
      scale: "css",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4178",
    browserName: "chromium",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/webview-harness.js",
    url: "http://127.0.0.1:4178/health",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  },
});
