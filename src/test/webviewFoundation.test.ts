import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  Card,
  ChartPanel,
  EmptyState,
  Metric,
  Toolbar,
} from "../webview/components";
import { dashboardActionCommand } from "../presentation/DashboardActions";
import { buildDashboardShellModel } from "../presentation/DashboardShellModel";
import { ENGLISH_STRINGS } from "../webview/strings";
import { restoreDashboardState } from "../webview/shellState";
import { renderDashboardHtml } from "../webview/template";

suite("WebviewFoundation", () => {
  test("renders only nonce-protected local scripts and an external stylesheet", () => {
    const html = renderDashboardHtml(
      {
        protocolVersion: 1,
        currentProjectId: 'project-alpha</script><script>alert("x")</script>',
        projects: [{
          id: 'project-alpha</script><script>alert("x")</script>',
          displayName: 'Alpha <script>alert("x")</script>',
        }],
        dailyGoalSeconds: 14_400,
        trackingStatus: "active",
        lastUpdatedAt: Date.UTC(2026, 7, 11),
        fileDetailAvailable: true,
        projectPreferences: {},
        integrationSettings: {
          gitTrackingEnabled: false,
          debugTrackingEnabled: false,
          taskTrackingEnabled: false,
          configuredTaskCount: 0,
        },
      },
      {
        nonce: "test-nonce",
        cspSource: "vscode-webview://test",
        chartScriptUri: "vscode-webview://test/media/chart.min.js",
        webviewScriptUri: "vscode-webview://test/media/webview.js",
        stylesheetUri: "vscode-webview://test/media/webview.css",
      },
    );

    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'nonce-test-nonce'/);
    assert.match(html, /style-src vscode-webview:\/\/test/);
    assert.ok(!html.includes("unsafe-inline"));
    assert.ok(!html.includes("https:"));
    assert.ok(!html.includes(" style="));
    assert.match(html, /src="vscode-webview:\/\/test\/media\/chart\.min\.js"/);
    assert.match(html, /src="vscode-webview:\/\/test\/media\/webview\.js"/);
    assert.match(html, /href="vscode-webview:\/\/test\/media\/webview\.css"/);
    assert.ok(!html.includes('<script>alert("x")</script>'));
    assert.ok(html.includes("project-alpha&lt;/script&gt;"));
    assert.ok(html.includes("Alpha &lt;script&gt;"));
  });

  test("renders persistent shell navigation and dashboard controls", () => {
    const html = renderDashboardHtml(
      {
        protocolVersion: 1,
        currentProjectId: "project-alpha",
        projects: [{ id: "project-alpha", displayName: "Alpha" }],
        dailyGoalSeconds: 14_400,
        trackingStatus: "paused",
        lastUpdatedAt: Date.UTC(2026, 7, 11),
        fileDetailAvailable: true,
        projectPreferences: {},
        integrationSettings: {
          gitTrackingEnabled: false,
          debugTrackingEnabled: false,
          taskTrackingEnabled: false,
          configuredTaskCount: 0,
        },
      },
      {
        nonce: "test-nonce",
        cspSource: "vscode-webview://test",
        chartScriptUri: "vscode-webview://test/media/chart.min.js",
        webviewScriptUri: "vscode-webview://test/media/webview.js",
        stylesheetUri: "vscode-webview://test/media/webview.css",
      },
    );

    ["Overview", "Trends", "Projects", "Workflow"].forEach((label) =>
      assert.match(html, new RegExp(`>${label}</button>`)),
    );
    assert.match(html, /<select id="project-selector">/);
    assert.match(html, /value="project-alpha" selected>Alpha<\/option>/);
    assert.match(html, /id="tracking-status"[^>]+data-status="paused"/);
    assert.match(html, /id="filter-bar"[^>]+aria-label="Date range"/);
    assert.strictEqual(
      html.match(/data-primary-metric="true"/g)?.length,
      3,
    );
    assert.match(html, /id="overview-goal-progress"/);
    assert.match(html, /Today · 15-Minute Activity/);
    assert.match(html, /id="focus-files-formula"/);
    assert.match(html, /id="focus-switches-formula"/);
    assert.match(html, /id="focus-flow-formula"/);
    assert.match(html, /id="overview-project-distribution"/);
    assert.match(html, /id="overview-language-distribution"/);
    assert.match(html, /id="overview-freshness"/);
    assert.match(html, /id="overview-empty"[^>]+hidden/);
    assert.match(html, /id="task-runs"/);
    assert.match(html, /Task Outcomes/);
    assert.match(html, /id="workflow-diagnostics-table"/);
    assert.match(html, /id="workflow-git-status"/);
    assert.match(html, /id="workflow-debug-status"/);
    assert.match(html, /id="workflow-tasks-status"/);
    ["7-days", "30-days", "90-days", "year", "custom"].forEach((range) =>
      assert.match(html, new RegExp(`data-range="${range}"`)),
    );
    assert.match(html, /id="custom-range-controls"[^>]+hidden/);
    assert.match(html, /id="trendsActivityChart"/);
    assert.match(html, /id="trendsFlowChart"/);
    assert.match(html, /id="trendsLanguageChart"/);
    assert.match(html, /id="trends-heatmap-table"/);
    assert.match(html, /id="projects-search"/);
    assert.match(html, /id="projects-sort"/);
    assert.match(html, /id="projects-show-managed"/);
    assert.match(html, /id="project-detail"/);
    assert.match(html, /id="project-alias"/);
    [
      "trends-activity-table",
      "trends-flow-table",
      "trends-language-table",
    ].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    [
      "export",
      "settings",
      "settings-git",
      "settings-debug",
      "settings-tasks",
      "open-data",
      "reset",
    ].forEach((action) =>
      assert.match(html, new RegExp(`data-action="${action}"`)),
    );
  });

  test("allows only fixed dashboard actions to reach extension commands", () => {
    assert.deepStrictEqual(
      dashboardActionCommand({ type: "dashboard/action", action: "export" }),
      { command: "devtracker.exportJson", args: [] },
    );
    assert.deepStrictEqual(
      dashboardActionCommand({ type: "dashboard/action", action: "settings" }),
      {
        command: "workbench.action.openSettings",
        args: ["@ext:DevBySergio.DevTrackerBySergio"],
      },
    );
    assert.deepStrictEqual(
      dashboardActionCommand({
        type: "dashboard/action",
        action: "settings-git",
      }),
      {
        command: "workbench.action.openSettings",
        args: [
          "@ext:DevBySergio.DevTrackerBySergio devtracker.gitTrackingEnabled",
        ],
      },
    );
    assert.deepStrictEqual(
      dashboardActionCommand({
        type: "dashboard/action",
        action: "settings-debug",
      }),
      {
        command: "workbench.action.openSettings",
        args: [
          "@ext:DevBySergio.DevTrackerBySergio devtracker.debugTrackingEnabled",
        ],
      },
    );
    assert.deepStrictEqual(
      dashboardActionCommand({
        type: "dashboard/action",
        action: "settings-tasks",
      }),
      {
        command: "workbench.action.openSettings",
        args: [
          "@ext:DevBySergio.DevTrackerBySergio devtracker.taskTrackingEnabled devtracker.trackedTasks",
        ],
      },
    );
    assert.strictEqual(
      dashboardActionCommand({
        type: "dashboard/action",
        action: "workbench.action.reloadWindow",
      }),
      null,
    );
    assert.strictEqual(
      dashboardActionCommand({
        type: "dashboard/action",
        action: "reset",
        extra: true,
      }),
      null,
    );
  });

  test("opens from historical or empty project state without an active editor", () => {
    const historical = buildDashboardShellModel(
      {
        projects: [
          { name: "Alpha", path: "/work/alpha" },
          { name: "Beta", path: "/work/beta" },
        ],
      },
      (projectPath) => `id:${projectPath}`,
    );
    assert.strictEqual(historical.currentProjectId, "id:/work/alpha");
    assert.deepStrictEqual(historical.projects, [
      { id: "id:/work/alpha", displayName: "Alpha" },
      { id: "id:/work/beta", displayName: "Beta" },
    ]);

    assert.deepStrictEqual(
      buildDashboardShellModel({ projects: [] }, () => undefined),
      { currentProjectId: null, projects: [] },
    );
  });

  test("restores only valid dashboard-owned view, range, and project state", () => {
    assert.deepStrictEqual(
      restoreDashboardState(
        { view: "quality", range: "month", projectId: "project-beta" },
        "project-alpha",
        ["project-alpha", "project-beta"],
      ),
      {
        view: "quality",
        range: "30-days",
        projectId: "project-beta",
        customStartLocalDate: null,
        customEndLocalDate: null,
      },
    );
    assert.deepStrictEqual(
      restoreDashboardState(
        { view: "unknown", range: "forever", projectId: "missing" },
        "project-alpha",
        ["project-alpha"],
      ),
      {
        view: "today",
        range: "7-days",
        projectId: "project-alpha",
        customStartLocalDate: null,
        customEndLocalDate: null,
      },
    );
    assert.deepStrictEqual(
      restoreDashboardState(
        {
          view: "project",
          range: "custom",
          projectId: "project-alpha",
          customStartLocalDate: "2026-07-01",
          customEndLocalDate: "2026-07-31",
        },
        null,
        ["project-alpha"],
      ),
      {
        view: "project",
        range: "custom",
        projectId: "project-alpha",
        customStartLocalDate: "2026-07-01",
        customEndLocalDate: "2026-07-31",
      },
    );
  });

  test("provides reusable escaped design-system components", () => {
    assert.strictEqual(
      Card("<span>trusted body</span>", 'wide" onclick="alert(1)'),
      '<div class="card wide&quot; onclick=&quot;alert(1)"><span>trusted body</span></div>',
    );
    assert.match(
      Metric({
        id: "active",
        title: "A < B",
        value: "12m",
        subtitle: "Current & retained",
        tone: "success",
      }),
      /A &lt; B/,
    );
    assert.match(EmptyState("No <data>"), /No &lt;data&gt;/);
    assert.match(
      ChartPanel({
        title: "Trend",
        canvasId: "trend",
        ariaLabel: "Activity trend",
      }),
      /<canvas id="trend" role="img" aria-label="Activity trend"><\/canvas>/,
    );
    assert.match(
      Toolbar({
        className: "tabs",
        buttonClassName: "tab-btn",
        ariaLabel: "Views",
        role: "tablist",
        dataAttribute: "tab",
        items: [{ id: "tab-today", label: "Today", value: "today", active: true }],
      }),
      /class="tab-btn active"[^>]+aria-selected="true"/,
    );
  });

  test("centralizes English UI copy and uses VS Code color variables", () => {
    assert.strictEqual(ENGLISH_STRINGS.views.quality, "Workflow");
    assert.strictEqual(ENGLISH_STRINGS.ranges.quarter, "90 Days");

    const stylesheet = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "webview", "styles.css"),
      "utf8",
    );
    assert.match(stylesheet, /--space-1:/);
    assert.match(stylesheet, /--radius-lg:/);
    assert.match(stylesheet, /--font-size-metric:/);
    assert.match(stylesheet, /--success: var\(--vscode-charts-green\)/);
    assert.match(stylesheet, /--danger: var\(--vscode-charts-red\)/);
    assert.ok(!/#[0-9a-f]{3,8}/i.test(stylesheet));
    assert.ok(!/rgba?\(/i.test(stylesheet));

    const reportPanel = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "src", "ReportPanel.ts"),
      "utf8",
    );
    const browserEntry = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "webview", "main.ts"),
      "utf8",
    );
    assert.ok(!reportPanel.includes("<script"));
    assert.ok(!reportPanel.includes("<style"));
    assert.ok(!browserEntry.includes(".style."));
    assert.match(browserEntry, /getState\(\)/);
    assert.match(browserEntry, /setState\(/);
    assert.ok(!reportPanel.includes("currentProjectId ==="));
  });
});
