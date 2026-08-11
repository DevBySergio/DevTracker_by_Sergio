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
import { ENGLISH_STRINGS } from "../webview/strings";
import { renderDashboardHtml } from "../webview/template";

suite("WebviewFoundation", () => {
  test("renders only nonce-protected local scripts and an external stylesheet", () => {
    const html = renderDashboardHtml(
      {
        protocolVersion: 1,
        currentProjectId: 'project-alpha</script><script>alert("x")</script>',
        dailyGoalSeconds: 14_400,
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
    assert.strictEqual(ENGLISH_STRINGS.ranges.all, "Last 90 Days");

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
  });
});
