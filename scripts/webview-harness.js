//@ts-check

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { renderDashboardHtml } = require("../out/webview/template.js");

const workspace = path.resolve(__dirname, "..");
const port = Number(process.env.DEVTRACKER_WEBVIEW_PORT ?? 4178);
const baseUrl = `http://127.0.0.1:${port}`;
const fixedNow = Date.UTC(2026, 7, 17, 10, 0, 0);
const localDates = [
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
  "2026-08-17",
];

const severity = (error, warning, info, hint) => ({ error, warning, info, hint });

function metrics(activeTimeMs = 0, factor = 1) {
  return {
    activeTimeMs,
    debugElapsedMs: Math.round(1_800_000 * factor),
    debugActiveTimeMs: Math.round(900_000 * factor),
    editEvents: Math.round(38 * factor),
    insertedCharacters: Math.round(2_450 * factor),
    removedCharacters: Math.round(870 * factor),
    largeEditEvents: Math.round(2 * factor),
    insertedLineBreaksApprox: Math.round(62 * factor),
    removedLineBreaksApprox: Math.round(21 * factor),
    saveEvents: Math.round(14 * factor),
    fileSwitchEvents: Math.round(9 * factor),
    projectSwitchEvents: Math.round(2 * factor),
    flowBlockCount: Math.round(5 * factor),
    flowActiveMs: Math.round(activeTimeMs * 0.78),
    longestFlowActiveMs: Math.round(1_800_000 * factor),
    gitStatus: "available",
    gitDirtyFiles: Math.round(4 * factor),
    gitBranchChanges: Math.round(2 * factor),
    gitDetectedCommits: Math.round(3 * factor),
    diagnostics: {
      current: severity(2, 5, 1, 0),
      introduced: severity(3, 7, 2, 1),
      resolved: severity(4, 4, 1, 2),
      peak: severity(6, 9, 3, 2),
    },
    legacyApproximate: false,
  };
}

const zeroMetrics = metrics();
const currentMetrics = metrics(7_200_000);
const previousMetrics = metrics(6_300_000, 0.88);
const taskSummary = {
  configuredName: "test",
  classification: "test",
  runCount: 4,
  completedRunCount: 4,
  succeededRunCount: 3,
  failedRunCount: 1,
  cancelledRunCount: 0,
  unknownRunCount: 0,
  successRatePercent: 75,
  medianDurationMs: 4_200,
};

function period(populated, comparison = false) {
  const selectedMetrics = populated
    ? comparison ? previousMetrics : currentMetrics
    : zeroMetrics;
  const selectedDates = comparison ? [
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-09",
    "2026-08-10",
  ] : localDates;
  const projects = populated ? [
    {
      project: { id: "project-alpha", displayName: "DevTracker" },
      metrics: metrics(5_400_000, 0.75),
      lastActiveLocalDate: "2026-08-17",
      activityTrendPercent: 12,
      languages: [
        { id: "TypeScript", activeTimeMs: 3_900_000 },
        { id: "CSS", activeTimeMs: 1_500_000 },
      ],
      files: [
        { id: "src/extension.ts", activeTimeMs: 2_700_000 },
        { id: "webview/main.ts", activeTimeMs: 1_800_000 },
      ],
      branches: [
        { id: "feature/dashboard", activeTimeMs: 3_600_000 },
        { id: "main", activeTimeMs: 1_800_000 },
      ],
      tasks: [taskSummary],
    },
    {
      project: { id: "project-beta", displayName: "JustAPI" },
      metrics: metrics(1_800_000, 0.25),
      lastActiveLocalDate: "2026-08-16",
      activityTrendPercent: -8,
      languages: [{ id: "TypeScript", activeTimeMs: 1_800_000 }],
      files: [{ id: "src/client.ts", activeTimeMs: 1_800_000 }],
      branches: [{ id: "main", activeTimeMs: 1_800_000 }],
      tasks: [],
    },
  ] : [];
  const dayActive = [2_400_000, 3_000_000, 4_200_000, 3_600_000, 5_100_000, 1_800_000, 7_200_000];
  return {
    range: {
      startLocalDate: selectedDates[0],
      endLocalDate: selectedDates[selectedDates.length - 1],
      localDates: selectedDates,
      complete: comparison,
    },
    metrics: selectedMetrics,
    days: selectedDates.map((localDate, index) => ({
      localDate,
      metrics: populated ? metrics(dayActive[index], dayActive[index] / 7_200_000) : zeroMetrics,
      languages: populated ? [
        { id: "TypeScript", activeTimeMs: Math.round(dayActive[index] * 0.72) },
        { id: "CSS", activeTimeMs: Math.round(dayActive[index] * 0.28) },
      ] : [],
    })),
    projects,
    languages: populated ? [
      { id: "TypeScript", activeTimeMs: 5_400_000 },
      { id: "CSS", activeTimeMs: 1_800_000 },
    ] : [],
    files: populated ? [
      { id: "src/extension.ts", activeTimeMs: 2_700_000 },
      { id: "webview/main.ts", activeTimeMs: 1_800_000 },
      { id: "webview/styles.css", activeTimeMs: 900_000 },
    ] : [],
    branches: populated ? [
      { id: "feature/dashboard", activeTimeMs: 5_400_000 },
      { id: "main", activeTimeMs: 1_800_000 },
    ] : [],
    tasks: populated ? [taskSummary] : [],
    quarterHours: populated ? [
      ["09:00", 900_000],
      ["09:15", 1_200_000],
      ["09:30", 1_500_000],
      ["10:00", 1_200_000],
      ["14:15", 900_000],
      ["15:30", 1_500_000],
    ].map(([label, activeTimeMs]) => {
      const [hour, minute] = String(label).split(":").map(Number);
      return {
        key: String(Date.UTC(2026, 7, 17, hour - 2, minute)),
        localDate: "2026-08-17",
        label: `${label} UTC+02:00`,
        utcOffsetMinutes: 120,
        activeTimeMs,
      };
    }) : [],
  };
}

function initialData(populated) {
  return {
    protocolVersion: 1,
    currentProjectId: populated ? "project-alpha" : null,
    projects: populated ? [
      { id: "project-alpha", displayName: "DevTracker" },
      { id: "project-beta", displayName: "JustAPI" },
    ] : [],
    dailyGoalSeconds: 14_400,
    trackingStatus: populated ? "active" : "inactive",
    lastUpdatedAt: fixedNow,
    fileDetailAvailable: true,
    projectPreferences: {},
    integrationSettings: {
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      configuredTaskCount: 1,
    },
  };
}

function harnessScript(state, initialView, theme) {
  const chart = fs.readFileSync(path.join(workspace, "media", "chart.min.js"), "utf8");
  const populated = state === "populated";
  const snapshot = {
    current: period(populated),
    comparison: populated ? period(true, true) : null,
    comparisonStatus: populated ? "available" : "not-requested",
    revision: 1,
  };
  return `${chart}\n
Chart.defaults.animation = false;
document.documentElement.dataset.theme = ${JSON.stringify(theme)};
document.documentElement.dataset.harnessState = ${JSON.stringify(state)};
document.documentElement.dataset.harnessRequests = '0';
window.addEventListener('error', event => {
  document.documentElement.dataset.harnessError = event.message;
});
Date.now = () => ${fixedNow};
document.addEventListener('DOMContentLoaded', () => {
  if (${JSON.stringify(theme)} === 'high-contrast') {
    document.body.classList.add('vscode-high-contrast');
  } else {
    document.body.classList.add(${JSON.stringify(theme === "light" ? "vscode-light" : "vscode-dark")});
  }
});
window.acquireVsCodeApi = () => ({
  getState: () => ({
    view: ${JSON.stringify(initialView)},
    range: '7-days',
    projectId: ${populated ? "'project-alpha'" : "null"}
  }),
  setState: state => { window.__harnessState = state; },
  postMessage: message => {
    document.documentElement.dataset.harnessRequests = String(Number(document.documentElement.dataset.harnessRequests) + 1);
    window.__harnessMessages = [...(window.__harnessMessages || []), message];
    if (message.type !== 'dashboard/request-view') { return; }
    if (${JSON.stringify(state)} === 'loading') { return; }
    const response = ${JSON.stringify(state)} === 'error'
      ? {
          type: 'dashboard/error',
          protocolVersion: 1,
          requestId: message.requestId,
          view: message.view,
          code: 'HARNESS_UNAVAILABLE',
          message: 'Harness data unavailable',
          limitBytes: null,
          actualBytes: null
        }
      : {
          type: 'dashboard/snapshot',
          protocolVersion: 1,
          requestId: message.requestId,
          view: message.view,
          data: ${JSON.stringify(snapshot)}
        };
    setTimeout(() => window.postMessage(response, '*'), 0);
  }
});`;
}

function dashboardHtml(url) {
  const state = ["populated", "empty", "loading", "error"].includes(url.searchParams.get("state"))
    ? url.searchParams.get("state")
    : "populated";
  const view = ["today", "project", "global", "quality"].includes(url.searchParams.get("view"))
    ? url.searchParams.get("view")
    : "today";
  const theme = ["light", "dark", "high-contrast"].includes(url.searchParams.get("theme"))
    ? url.searchParams.get("theme")
    : "dark";
  const populated = state === "populated";
  const html = renderDashboardHtml(initialData(populated), {
    nonce: "webview-harness",
    cspSource: baseUrl,
    chartScriptUri: `${baseUrl}/harness/${state}/${view}/${theme}.js`,
    webviewScriptUri: `${baseUrl}/media/webview.js`,
    stylesheetUri: `${baseUrl}/media/webview.css`,
  });
  return html.replace(
    "</head>",
    `<link rel="stylesheet" href="${baseUrl}/tests/webview/theme-fixtures.css"></head>`,
  );
}

function sendFile(response, filePath, contentType) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentType,
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", baseUrl);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (url.pathname === "/dashboard") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(dashboardHtml(url));
    return;
  }
  const harnessMatch = /^\/harness\/(populated|empty|loading|error)\/(today|project|global|quality)\/(light|dark|high-contrast)\.js$/.exec(url.pathname);
  if (harnessMatch) {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    });
    response.end(harnessScript(harnessMatch[1], harnessMatch[2], harnessMatch[3]));
    return;
  }
  const assets = new Map([
    ["/media/webview.js", [path.join(workspace, "media", "webview.js"), "text/javascript; charset=utf-8"]],
    ["/media/webview.css", [path.join(workspace, "media", "webview.css"), "text/css; charset=utf-8"]],
    ["/tests/webview/theme-fixtures.css", [path.join(workspace, "tests", "webview", "theme-fixtures.css"), "text/css; charset=utf-8"]],
  ]);
  const asset = assets.get(url.pathname);
  if (asset) {
    sendFile(response, asset[0], asset[1]);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DevTracker webview harness listening on ${baseUrl}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
