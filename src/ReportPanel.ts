import * as vscode from "vscode";
import { SessionState, ProjectData } from "./DataManager";

export class ReportPanel {
  public static currentPanel: ReportPanel | undefined;
  public static readonly viewType = "devTrackerStats";
  public readonly currentProjectPath: string;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    sessionData: SessionState,
    projectData: ProjectData,
    allProjects: ProjectData[],
    dailyGoal: number,
    projectPath: string,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel._panel.reveal(column);
      ReportPanel.currentPanel.sendUpdate(
        sessionData,
        projectData,
        allProjects,
        dailyGoal,
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReportPanel.viewType,
      "DevTracker Dashboard",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        retainContextWhenHidden: true,
      },
    );

    ReportPanel.currentPanel = new ReportPanel(
      panel,
      extensionUri,
      sessionData,
      projectData,
      allProjects,
      dailyGoal,
      projectPath,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sData: SessionState,
    pData: ProjectData,
    allData: ProjectData[],
    goal: number,
    path: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.currentProjectPath = path;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.html = this._getWebviewContent(
      sData,
      pData,
      allData,
      goal,
    );
  }

  public sendUpdate(
    sData: SessionState,
    pData: ProjectData,
    allData: ProjectData[],
    goal: number,
  ) {
    this._panel.webview.postMessage({
      command: "update",
      sData,
      pData,
      allData,
      goal,
    });
  }

  public dispose() {
    ReportPanel.currentPanel = undefined;
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getWebviewContent(
    sData: SessionState,
    pData: ProjectData,
    allData: ProjectData[],
    goal: number,
  ) {
    const webview = this._panel.webview;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "chart.min.js"),
    );
    const initialData = escapeHtml(
      JSON.stringify({ sData, pData, allData, goal }),
    );

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script nonce="${nonce}" src="${scriptUri}"></script>
        <title>DevTracker</title>
        <style>
          :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --surface: var(--vscode-sideBar-background);
            --surface-raised: var(--vscode-editorWidget-background);
            --card-bg: color-mix(in srgb, var(--surface) 88%, var(--fg) 12%);
            --card-border: color-mix(in srgb, var(--vscode-widget-border) 82%, var(--fg) 18%);
            --accent: var(--vscode-textLink-foreground);
            --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
            --text-secondary: var(--vscode-descriptionForeground);
            --muted: var(--vscode-disabledForeground);
            --focus-ring: var(--vscode-focusBorder);
            --button-fg: var(--vscode-button-foreground);
            --success: #2aa876;
            --danger: #d85c57;
            --info: #4b8fd6;
            --warning: #c69026;
            --yellow: #b99f2f;
            --purple: #a970d8;
          }

          * { box-sizing: border-box; }
          html { font-size: 15px; }
          body {
            background: var(--bg);
            color: var(--fg);
            display: flex;
            flex-direction: column;
            font-family: var(--vscode-font-family);
            height: 100vh;
            margin: 0;
          }
          .skip-link {
            background: var(--accent);
            color: var(--button-fg);
            left: 12px;
            padding: 8px 12px;
            position: fixed;
            top: 8px;
            transform: translateY(-140%);
            z-index: 20;
          }
          .skip-link:focus { transform: translateY(0); }
          .sr-only {
            border: 0;
            clip: rect(0 0 0 0);
            height: 1px;
            margin: -1px;
            overflow: hidden;
            padding: 0;
            position: absolute;
            width: 1px;
          }
          .navbar {
            align-items: center;
            background: color-mix(in srgb, var(--surface) 90%, transparent);
            border-bottom: 1px solid var(--card-border);
            display: flex;
            gap: 16px;
            justify-content: space-between;
            padding: 12px 18px;
          }
          .brand {
            align-items: center;
            display: flex;
            font-size: 1.05rem;
            font-weight: 700;
            gap: 10px;
            white-space: nowrap;
          }
          .brand-mark {
            background: var(--accent);
            border-radius: 6px;
            display: inline-block;
            height: 18px;
            width: 6px;
          }
          .tabs, .filters {
            align-items: center;
            display: flex;
            gap: 6px;
          }
          .tabs {
            background: color-mix(in srgb, var(--surface) 82%, var(--fg) 8%);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 4px;
          }
          button {
            background: transparent;
            border: 0;
            color: var(--fg);
            cursor: pointer;
            font: inherit;
          }
          button:focus-visible, .skip-link:focus-visible {
            outline: 2px solid var(--focus-ring);
            outline-offset: 2px;
          }
          .tab-btn, .filter-btn {
            border-radius: 6px;
            color: var(--fg);
            min-height: 34px;
            opacity: 0.86;
            padding: 7px 13px;
          }
          .tab-btn:hover, .filter-btn:hover {
            background: color-mix(in srgb, var(--fg) 8%, transparent);
            opacity: 1;
          }
          .tab-btn.active, .filter-btn.active {
            background: var(--accent);
            color: var(--button-fg);
            font-weight: 600;
            opacity: 1;
          }
          .container {
            flex: 1;
            margin: 0 auto;
            max-width: 1280px;
            overflow-y: auto;
            padding: 22px;
            scroll-behavior: smooth;
            width: 100%;
          }
          .view-header {
            align-items: center;
            display: flex;
            gap: 12px;
            justify-content: space-between;
            margin-bottom: 18px;
          }
          .page-title {
            font-size: 1.35rem;
            font-weight: 650;
            letter-spacing: 0;
            margin: 0;
          }
          .view-subtitle {
            color: var(--text-secondary);
            font-size: 0.9rem;
            margin-top: 4px;
          }
          .filters { display: none; }
          .filter-btn {
            border: 1px solid var(--card-border);
            font-size: 0.86rem;
            padding: 6px 11px;
          }
          .view-section { display: none; }
          .view-section.active { display: block; }
          .grid-4 {
            display: grid;
            gap: 12px;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            margin-bottom: 12px;
          }
          .grid-3 {
            display: grid;
            gap: 12px;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            margin-bottom: 12px;
          }
          .grid-2 {
            display: grid;
            gap: 12px;
            grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
            margin-bottom: 12px;
          }
          @media (max-width: 980px) {
            .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
            .navbar, .view-header { align-items: flex-start; flex-direction: column; }
            .tabs, .filters { flex-wrap: wrap; }
          }
          .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            box-shadow: 0 1px 0 color-mix(in srgb, var(--fg) 5%, transparent);
            min-width: 0;
            padding: 16px;
          }
          .metric-card {
            border-left: 4px solid var(--accent);
            display: flex;
            flex-direction: column;
            gap: 8px;
            justify-content: space-between;
            min-height: 126px;
          }
          .metric-card.warning { border-left-color: var(--warning); }
          .metric-card.danger { border-left-color: var(--danger); }
          .metric-card.success { border-left-color: var(--success); }
          .card-title {
            color: var(--text-secondary);
            font-size: 0.82rem;
            font-weight: 650;
            letter-spacing: 0;
            text-transform: none;
          }
          .metric-big {
            color: var(--fg);
            font-size: 2rem;
            font-weight: 750;
            line-height: 1.1;
            overflow-wrap: anywhere;
          }
          .metric-sub {
            color: var(--text-secondary);
            font-size: 0.9rem;
            line-height: 1.45;
          }
          .metric-row {
            align-items: baseline;
            display: flex;
            gap: 8px;
            justify-content: space-between;
          }
          .delta {
            color: var(--text-secondary);
            font-size: 0.82rem;
            white-space: nowrap;
          }
          .delta.good { color: var(--success); }
          .delta.bad { color: var(--danger); }
          .chart-container {
            height: 250px;
            position: relative;
            width: 100%;
          }
          .chart-short { height: 210px; }
          .split {
            display: grid;
            gap: 12px;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          }
          @media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
          .list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .bar-row {
            display: grid;
            gap: 8px;
            grid-template-columns: minmax(0, 1fr) 86px;
            padding: 4px 0;
          }
          .bar-label {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .bar-track {
            background: color-mix(in srgb, var(--fg) 13%, transparent);
            border-radius: 999px;
            grid-column: 1 / 3;
            height: 9px;
            overflow: hidden;
          }
          .bar-fill {
            background: var(--accent);
            height: 100%;
            min-width: 2px;
          }
          .value {
            color: var(--text-secondary);
            font-variant-numeric: tabular-nums;
            text-align: right;
          }
          .table-wrapper {
            border: 1px solid color-mix(in srgb, var(--card-border) 70%, transparent);
            border-radius: 6px;
            max-height: 330px;
            overflow: auto;
          }
          table {
            border-collapse: collapse;
            font-size: 0.9rem;
            width: 100%;
          }
          th {
            background: color-mix(in srgb, var(--surface) 82%, var(--fg) 6%);
            border-bottom: 1px solid var(--card-border);
            color: var(--text-secondary);
            font-weight: 650;
            padding: 8px;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 1;
          }
          td {
            border-bottom: 1px solid color-mix(in srgb, var(--card-border) 65%, transparent);
            padding: 9px 8px;
            vertical-align: middle;
          }
          tr:hover td { background: color-mix(in srgb, var(--fg) 5%, transparent); }
          tr:last-child td { border-bottom: 0; }
          .file-name {
            color: var(--accent);
            font-family: var(--vscode-editor-font-family);
            max-width: 520px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .text-right {
            font-variant-numeric: tabular-nums;
            text-align: right;
          }
          .badge {
            border: 1px solid var(--card-border);
            border-radius: 999px;
            color: var(--text-secondary);
            display: inline-flex;
            font-size: 0.76rem;
            max-width: 100%;
            overflow: hidden;
            padding: 2px 8px;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .heatmap {
            display: grid;
            gap: 4px;
            grid-template-columns: 44px repeat(24, minmax(20px, 1fr));
            overflow-x: auto;
          }
          .heat-label, .heat-cell {
            align-items: center;
            display: flex;
            font-size: 0.72rem;
            justify-content: center;
            min-height: 24px;
          }
          .heat-label { color: var(--text-secondary); }
          .heat-cell {
            background: color-mix(in srgb, var(--accent) calc(var(--heat) * 1%), var(--bg));
            border: 1px solid color-mix(in srgb, var(--card-border) 55%, transparent);
            border-radius: 4px;
          }
          .empty {
            color: var(--text-secondary);
            padding: 14px 0;
          }
          @media (prefers-reduced-motion: reduce) {
            .container { scroll-behavior: auto; }
            *, *::before, *::after {
              animation-duration: 0.001ms !important;
              scroll-behavior: auto !important;
              transition-duration: 0.001ms !important;
            }
          }
        </style>
      </head>
      <body>
        <a class="skip-link" href="#dashboard-content">Skip to dashboard</a>
        <script id="initial-data" nonce="${nonce}" type="application/json">${initialData}</script>
        <header class="navbar">
          <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>DevTracker</span></div>
          <div class="tabs" role="tablist" aria-label="Dashboard views">
            <button class="tab-btn active" data-tab="today" id="tab-today" role="tab" aria-selected="true" aria-controls="view-today">Today</button>
            <button class="tab-btn" data-tab="project" id="tab-project" role="tab" aria-selected="false" aria-controls="view-project">Project</button>
            <button class="tab-btn" data-tab="quality" id="tab-quality" role="tab" aria-selected="false" aria-controls="view-quality">Quality</button>
            <button class="tab-btn" data-tab="global" id="tab-global" role="tab" aria-selected="false" aria-controls="view-global">Global</button>
          </div>
        </header>

        <main id="dashboard-content" class="container" tabindex="-1">
          <div class="view-header">
            <div>
              <h1 id="page-title" class="page-title">Today</h1>
              <div id="page-subtitle" class="view-subtitle">Live view of your current coding rhythm.</div>
            </div>
            <div id="filter-bar" class="filters" role="group" aria-label="Date range">
              <button class="filter-btn" data-range="today" id="btn-today">Today</button>
              <button class="filter-btn active" data-range="week" id="btn-week">Last Week</button>
              <button class="filter-btn" data-range="month" id="btn-month">Last Month</button>
              <button class="filter-btn" data-range="all" id="btn-all">All Time</button>
            </div>
          </div>

          <section id="view-today" class="view-section active" role="tabpanel" aria-labelledby="tab-today">
            <div class="grid-4">
              <div class="card metric-card success" aria-label="Active time today"><div class="card-title">Active Today</div><div class="metric-big" id="t-active" aria-live="polite">0m</div><div class="metric-sub" id="t-active-sub">Session 0m</div></div>
              <div class="card metric-card" aria-label="Daily goal progress"><div class="card-title">Daily Goal</div><div class="metric-big" id="t-goal" aria-live="polite">0%</div><div class="metric-sub" id="t-goal-sub">Target 0m</div></div>
              <div class="card metric-card" aria-label="Focus score"><div class="card-title">Focus Score</div><div class="metric-big" id="t-focus" aria-live="polite">0</div><div class="metric-sub" id="t-focus-sub">No activity yet</div></div>
              <div class="card metric-card" aria-label="Current flow block"><div class="card-title">Current Flow</div><div class="metric-big" id="t-flow" aria-live="polite">0m</div><div class="metric-sub" id="t-flow-sub">Longest 0m</div></div>
            </div>
            <div class="grid-4">
              <div class="card metric-card" aria-label="Edit volume"><div class="card-title">Edit Volume</div><div class="metric-big" id="t-edit">0</div><div class="metric-sub" id="t-edit-sub">0 edit events</div></div>
              <div class="card metric-card warning" aria-label="Code churn"><div class="card-title">Code Churn</div><div class="metric-big" id="t-churn">0</div><div class="metric-sub" id="t-churn-sub">Net 0 lines</div></div>
              <div class="card metric-card danger" aria-label="Quality pressure"><div class="card-title">Quality Pressure</div><div class="metric-big" id="t-quality">0</div><div class="metric-sub" id="t-quality-sub">0 warnings</div></div>
              <div class="card metric-card" aria-label="Git context"><div class="card-title">Git Context</div><div class="metric-big" id="t-git">0</div><div class="metric-sub" id="t-git-sub">Git unavailable</div></div>
            </div>
            <div class="grid-2">
              <div class="card">
                <div class="metric-row"><div class="card-title">Today Timeline</div><span class="delta" id="t-save-rhythm">0 saves/hour</span></div>
                <div class="chart-container chart-short"><canvas id="todayTrendChart" role="img" aria-label="Bar chart of active hours today"></canvas></div>
              </div>
              <div class="card">
                <div class="card-title">Session Languages</div>
                <div class="list" id="today-language-list"></div>
              </div>
            </div>
            <div class="card">
              <div class="card-title">Active Files</div>
              <div class="table-wrapper"><table id="today-files-table"></table></div>
            </div>
          </section>

          <section id="view-project" class="view-section" role="tabpanel" aria-labelledby="tab-project" hidden>
            <div class="grid-4">
              <div class="card metric-card"><div class="card-title">Project Time</div><div class="metric-row"><div class="metric-big" id="p-time">0m</div><span class="delta" id="p-time-delta">0%</span></div><div class="metric-sub" id="p-time-sub">Selected range</div></div>
              <div class="card metric-card"><div class="card-title">Focus Score</div><div class="metric-big" id="p-focus">0</div><div class="metric-sub" id="p-focus-sub">Context switches 0</div></div>
              <div class="card metric-card"><div class="card-title">Edit Intensity</div><div class="metric-big" id="p-intensity">0</div><div class="metric-sub">Edit volume/hour</div></div>
              <div class="card metric-card"><div class="card-title">Churn Ratio</div><div class="metric-big" id="p-churn">0%</div><div class="metric-sub" id="p-churn-sub">0 changed lines</div></div>
            </div>
            <div class="grid-2">
              <div class="card"><div class="card-title">Activity Trend</div><div class="chart-container"><canvas id="projectTrendChart" role="img" aria-label="Bar chart of project active hours"></canvas></div></div>
              <div class="card"><div class="card-title">Languages</div><div class="list" id="project-language-list"></div></div>
            </div>
            <div class="card"><div class="card-title">Most Active Files</div><div class="table-wrapper"><table id="project-files-table"></table></div></div>
          </section>

          <section id="view-quality" class="view-section" role="tabpanel" aria-labelledby="tab-quality" hidden>
            <div class="grid-4">
              <div class="card metric-card danger"><div class="card-title">Errors</div><div class="metric-big" style="color:var(--danger)" id="q-errors">0</div><div class="metric-sub">Current snapshot</div></div>
              <div class="card metric-card warning"><div class="card-title">Warnings</div><div class="metric-big" style="color:var(--warning)" id="q-warnings">0</div><div class="metric-sub">Current snapshot</div></div>
              <div class="card metric-card"><div class="card-title">Saves</div><div class="metric-big" id="q-saves">0</div><div class="metric-sub" id="q-saves-sub">0 saves/hour</div></div>
              <div class="card metric-card"><div class="card-title">Debug Time</div><div class="metric-big" id="q-debug">0m</div><div class="metric-sub">Selected range</div></div>
            </div>
            <div class="grid-2">
              <div class="card"><div class="card-title">Diagnostics Trend</div><div class="chart-container"><canvas id="qualityTrendChart" role="img" aria-label="Stacked chart of diagnostics by severity"></canvas></div></div>
              <div class="card"><div class="card-title">Branch Mix</div><div class="list" id="branch-list"></div></div>
            </div>
            <div class="card"><div class="card-title">Quality Breakdown</div><div class="list" id="quality-breakdown"></div></div>
          </section>

          <section id="view-global" class="view-section" role="tabpanel" aria-labelledby="tab-global" hidden>
            <div class="grid-4">
              <div class="card metric-card"><div class="card-title">Lifetime Code</div><div class="metric-big" id="g-time">0m</div><div class="metric-sub">All tracked work</div></div>
              <div class="card metric-card"><div class="card-title">Projects</div><div class="metric-big" id="g-projects">0</div><div class="metric-sub">With activity</div></div>
              <div class="card metric-card"><div class="card-title">Best Hour</div><div class="metric-big" id="g-best-hour">--</div><div class="metric-sub" id="g-best-hour-sub">No activity</div></div>
              <div class="card metric-card"><div class="card-title">Global Focus</div><div class="metric-big" id="g-focus">0</div><div class="metric-sub">Selected range</div></div>
            </div>
            <div class="grid-2">
              <div class="card"><div class="card-title">Weekly Heatmap</div><div id="heatmap" class="heatmap"></div></div>
              <div class="card"><div class="card-title">Top Projects</div><div class="table-wrapper"><table id="global-projects-table"></table></div></div>
            </div>
            <div class="card"><div class="card-title">Global Languages</div><div class="list" id="global-language-list"></div></div>
          </section>
        </main>

        <script nonce="${nonce}">
          Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#999';
          Chart.defaults.borderColor = 'rgba(127,127,127,0.16)';
          Chart.defaults.font.family = 'Segoe UI, sans-serif';

          const initialData = JSON.parse(document.getElementById('initial-data').textContent);
          let currentTab = 'today';
          let currentRange = 'week';
          let rawSession = normalizeSession(initialData.sData);
          let rawProject = initialData.pData;
          let rawAll = initialData.allData || [];
          let dailyGoal = initialData.goal;
          let todayTrendChart = null;
          let projectTrendChart = null;
          let qualityTrendChart = null;

          const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          const colors = ['#569cd6','#4ec9b0','#ce9178','#dcdcaa','#c586c0','#9cdcfe','#f14c4c','#b5cea8'];

          document.querySelectorAll('.tab-btn').forEach(button => {
            button.addEventListener('click', () => switchTab(button.dataset.tab, button));
          });
          document.querySelectorAll('.filter-btn').forEach(button => {
            button.addEventListener('click', () => setRange(button.dataset.range));
          });

          window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'update') {
              rawSession = normalizeSession(msg.sData);
              rawProject = msg.pData;
              rawAll = msg.allData || [];
              dailyGoal = msg.goal;
              render();
            }
          });

          render();

          function switchTab(tab, button) {
            currentTab = tab;
            document.querySelectorAll('.tab-btn').forEach(item => {
              item.classList.remove('active');
              item.setAttribute('aria-selected', 'false');
            });
            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');
            document.querySelectorAll('.view-section').forEach(section => {
              section.classList.remove('active');
              section.hidden = true;
            });
            const activeSection = document.getElementById('view-' + tab);
            activeSection.classList.add('active');
            activeSection.hidden = false;
            document.getElementById('filter-bar').style.display = tab === 'today' ? 'none' : 'flex';
            render();
          }

          function setRange(range) {
            currentRange = range;
            document.querySelectorAll('.filter-btn').forEach(button => button.classList.remove('active'));
            document.getElementById('btn-' + range).classList.add('active');
            render();
          }

          function render() {
            updateHeader();
            renderToday();
            if (currentTab === 'project') { renderProject(); }
            if (currentTab === 'quality') { renderQuality(); }
            if (currentTab === 'global') { renderGlobal(); }
          }

          function updateHeader() {
            const title = document.getElementById('page-title');
            const subtitle = document.getElementById('page-subtitle');
            const projectName = rawProject && rawProject.name ? rawProject.name : 'Current Project';
            if (currentTab === 'today') {
              title.textContent = 'Today';
              subtitle.textContent = 'Live view of your current coding rhythm.';
            }
            if (currentTab === 'project') {
              title.textContent = 'Project: ' + projectName;
              subtitle.textContent = 'Range-based focus, churn, intensity, languages, and active files.';
            }
            if (currentTab === 'quality') {
              title.textContent = 'Quality: ' + projectName;
              subtitle.textContent = 'Diagnostics, saves, debug time, and Git branch context.';
            }
            if (currentTab === 'global') {
              title.textContent = 'Global';
              subtitle.textContent = 'Your long-term work patterns across tracked projects.';
            }
          }

          function normalizeSession(session) {
            const safe = session || {};
            return {
              startTime: safe.startTime || Date.now(),
              seconds: safe.seconds || 0,
              keystrokes: safe.keystrokes || 0,
              linesAdded: safe.linesAdded || 0,
              linesDeleted: safe.linesDeleted || 0,
              languages: safe.languages || {},
              editEvents: safe.editEvents || 0,
              pasteEvents: safe.pasteEvents || 0,
              filesTouched: safe.filesTouched || {},
              saves: safe.saves || 0,
              focusSeconds: safe.focusSeconds || safe.seconds || 0,
              idleSeconds: safe.idleSeconds || 0,
              debugSeconds: safe.debugSeconds || 0,
              diagnosticsBySeverity: normalizeDiagnostics(safe.diagnosticsBySeverity),
              contextSwitches: safe.contextSwitches || 0,
              branches: safe.branches || {},
              gitDirtyFiles: safe.gitDirtyFiles || 0,
              flow: normalizeFlow(safe.flow)
            };
          }

          function normalizeDay(day) {
            const safe = day || {};
            return {
              date: safe.date || getLocalDateKey(),
              seconds: safe.seconds || 0,
              keystrokes: safe.keystrokes || 0,
              linesAdded: safe.linesAdded || 0,
              linesDeleted: safe.linesDeleted || 0,
              languages: safe.languages || {},
              hours: safe.hours || {},
              files: safe.files || {},
              editEvents: safe.editEvents || 0,
              pasteEvents: safe.pasteEvents || 0,
              filesTouched: safe.filesTouched || {},
              saves: safe.saves || 0,
              focusSeconds: safe.focusSeconds || safe.seconds || 0,
              idleSeconds: safe.idleSeconds || 0,
              debugSeconds: safe.debugSeconds || 0,
              diagnosticsBySeverity: normalizeDiagnostics(safe.diagnosticsBySeverity),
              contextSwitches: safe.contextSwitches || 0,
              branches: safe.branches || {},
              gitDirtyFiles: safe.gitDirtyFiles || 0,
              flow: normalizeFlow(safe.flow)
            };
          }

          function normalizeDiagnostics(value) {
            const safe = value || {};
            return {
              error: safe.error || 0,
              warning: safe.warning || 0,
              info: safe.info || 0,
              hint: safe.hint || 0
            };
          }

          function normalizeFlow(value) {
            const safe = value || {};
            return {
              count: safe.count || 0,
              totalSeconds: safe.totalSeconds || 0,
              longestSeconds: safe.longestSeconds || 0,
              currentSeconds: safe.currentSeconds || 0
            };
          }

          function getLocalDateKey() {
            const date = new Date();
            return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
          }

          function daysForProject(project) {
            if (!project || !project.days) { return []; }
            return Object.values(project.days).map(normalizeDay);
          }

          function allDays() {
            const result = [];
            rawAll.forEach(project => result.push(...daysForProject(project)));
            return result;
          }

          function getFilteredDays(days) {
            const now = new Date();
            now.setHours(0,0,0,0);
            const cutoff = new Date(now);
            if (currentRange === 'week') { cutoff.setDate(now.getDate() - 6); }
            if (currentRange === 'month') { cutoff.setDate(now.getDate() - 29); }
            if (currentRange === 'all') { cutoff.setFullYear(2000); }

            return days.filter(day => {
              const date = dateFromKey(day.date);
              if (currentRange === 'today') { return date.getTime() === now.getTime(); }
              return date >= cutoff;
            });
          }

          function getPreviousRangeDays(days) {
            if (currentRange === 'all') { return []; }
            const now = new Date();
            now.setHours(0,0,0,0);
            const length = currentRange === 'month' ? 30 : currentRange === 'week' ? 7 : 1;
            const end = new Date(now);
            end.setDate(now.getDate() - length);
            const start = new Date(end);
            start.setDate(end.getDate() - length + 1);

            return days.filter(day => {
              const date = dateFromKey(day.date);
              return date >= start && date <= end;
            });
          }

          function dateFromKey(key) {
            const parts = key.split('-').map(Number);
            const date = new Date(parts[0], parts[1] - 1, parts[2]);
            date.setHours(0,0,0,0);
            return date;
          }

          function aggregateDays(days) {
            const agg = emptyAgg();
            days.forEach(day => {
              agg.seconds += day.seconds;
              agg.focusSeconds += day.focusSeconds;
              agg.idleSeconds += day.idleSeconds;
              agg.debugSeconds += day.debugSeconds;
              agg.linesAdded += day.linesAdded;
              agg.linesDeleted += day.linesDeleted;
              agg.keystrokes += day.keystrokes;
              agg.editEvents += day.editEvents;
              agg.pasteEvents += day.pasteEvents;
              agg.saves += day.saves;
              agg.contextSwitches += day.contextSwitches;
              agg.gitDirtyFiles = Math.max(agg.gitDirtyFiles, day.gitDirtyFiles);
              agg.flow.count += day.flow.count;
              agg.flow.totalSeconds += day.flow.totalSeconds;
              agg.flow.longestSeconds = Math.max(agg.flow.longestSeconds, day.flow.longestSeconds);
              addMap(agg.languages, Object.fromEntries(Object.values(day.languages).map(language => [language.name, language.seconds])));
              addMap(agg.files, day.files);
              addMap(agg.filesTouched, day.filesTouched);
              addMap(agg.branches, day.branches);
              addDiagnostics(agg.diagnosticsBySeverity, day.diagnosticsBySeverity);
              Object.entries(day.hours).forEach(([hour, seconds]) => {
                agg.hours[hour] = (agg.hours[hour] || 0) + seconds;
              });
            });
            return agg;
          }

          function emptyAgg() {
            return {
              seconds: 0,
              focusSeconds: 0,
              idleSeconds: 0,
              debugSeconds: 0,
              linesAdded: 0,
              linesDeleted: 0,
              keystrokes: 0,
              editEvents: 0,
              pasteEvents: 0,
              saves: 0,
              contextSwitches: 0,
              gitDirtyFiles: 0,
              diagnosticsBySeverity: normalizeDiagnostics(),
              flow: normalizeFlow(),
              languages: {},
              files: {},
              filesTouched: {},
              branches: {},
              hours: {}
            };
          }

          function addMap(target, source) {
            Object.entries(source || {}).forEach(([key, value]) => {
              target[key] = (target[key] || 0) + Number(value || 0);
            });
          }

          function addDiagnostics(target, source) {
            const diagnostics = normalizeDiagnostics(source);
            target.error += diagnostics.error;
            target.warning += diagnostics.warning;
            target.info += diagnostics.info;
            target.hint += diagnostics.hint;
          }

          function renderToday() {
            const todayKey = getLocalDateKey();
            const todayDays = allDays().filter(day => day.date === todayKey);
            const todayAgg = aggregateDays(todayDays);
            const sessionAgg = sessionAsAgg();
            const targetSeconds = dailyGoal > 0 ? dailyGoal : 14400;
            const pct = targetSeconds > 0 ? Math.min(100, Math.round((todayAgg.seconds / targetSeconds) * 100)) : 0;
            const focus = focusScore(todayAgg);
            const churn = todayAgg.linesAdded + todayAgg.linesDeleted;
            const quality = rawSession.diagnosticsBySeverity.error + rawSession.diagnosticsBySeverity.warning;

            setText('t-active', fmt(todayAgg.seconds));
            setText('t-active-sub', 'Session ' + fmt(rawSession.seconds));
            setText('t-goal', pct + '%');
            setText('t-goal-sub', fmt(todayAgg.seconds) + ' of ' + fmt(targetSeconds));
            setText('t-focus', focus);
            setText('t-focus-sub', topLabel(todayAgg.files, 'No active file'));
            setText('t-flow', fmt(rawSession.flow.currentSeconds));
            setText('t-flow-sub', 'Longest ' + fmt(Math.max(rawSession.flow.longestSeconds, todayAgg.flow.longestSeconds)));
            setText('t-edit', compact(rawSession.keystrokes));
            setText('t-edit-sub', rawSession.editEvents + ' edit events, ' + rawSession.pasteEvents + ' paste events');
            setText('t-churn', compact(churn));
            setText('t-churn-sub', 'Net ' + compact(todayAgg.linesAdded - todayAgg.linesDeleted) + ' lines');
            setText('t-quality', quality);
            setText('t-quality-sub', rawSession.diagnosticsBySeverity.error + ' errors, ' + rawSession.diagnosticsBySeverity.warning + ' warnings');
            setText('t-git', rawSession.gitDirtyFiles);
            setText('t-git-sub', topLabel(rawSession.branches, 'Git unavailable'));
            setText('t-save-rhythm', saveRhythm(todayAgg));

            renderTimeline(todayTrendChart, 'todayTrendChart', todayDays, chart => todayTrendChart = chart);
            renderBarList('today-language-list', sessionAgg.languages, fmt, 'No session languages yet');
            renderFileTable('today-files-table', mapToRows(todayAgg.files).slice(0, 10), todayAgg.filesTouched, 'No active files today');
          }

          function renderProject() {
            const projectDays = daysForProject(rawProject);
            const days = getFilteredDays(projectDays);
            const previous = getPreviousRangeDays(projectDays);
            const agg = aggregateDays(days);
            const prevAgg = aggregateDays(previous);

            setText('p-time', fmt(agg.seconds));
            setText('p-time-sub', days.length + ' tracked days');
            setDelta('p-time-delta', deltaPct(agg.seconds, prevAgg.seconds));
            setText('p-focus', focusScore(agg));
            setText('p-focus-sub', 'Context switches ' + agg.contextSwitches);
            setText('p-intensity', compact(editIntensity(agg)));
            setText('p-churn', churnRatio(agg) + '%');
            setText('p-churn-sub', compact(agg.linesAdded + agg.linesDeleted) + ' changed lines');

            renderTimeline(projectTrendChart, 'projectTrendChart', days, chart => projectTrendChart = chart);
            renderBarList('project-language-list', agg.languages, fmt, 'No languages in this range');
            renderFileTable('project-files-table', mapToRows(agg.files).slice(0, 15), agg.filesTouched, 'No activity in this range');
          }

          function renderQuality() {
            const days = getFilteredDays(daysForProject(rawProject));
            const agg = aggregateDays(days);
            const currentDiagnostics = rawSession.diagnosticsBySeverity;

            setText('q-errors', currentDiagnostics.error);
            setText('q-warnings', currentDiagnostics.warning);
            setText('q-saves', agg.saves);
            setText('q-saves-sub', saveRhythm(agg));
            setText('q-debug', fmt(agg.debugSeconds));

            renderDiagnosticsChart(days);
            renderBarList('branch-list', agg.branches, fmt, 'Git unavailable');
            renderBarList('quality-breakdown', {
              Errors: currentDiagnostics.error,
              Warnings: currentDiagnostics.warning,
              Info: currentDiagnostics.info,
              Hints: currentDiagnostics.hint,
              'Dirty files': rawSession.gitDirtyFiles
            }, compact, 'Diagnostics unavailable');
          }

          function renderGlobal() {
            const days = getFilteredDays(allDays());
            const agg = aggregateDays(days);
            const bestHour = bestHourFromDays(days);

            setText('g-time', fmt(agg.seconds));
            setText('g-projects', rawAll.length);
            setText('g-best-hour', bestHour.label);
            setText('g-best-hour-sub', bestHour.value > 0 ? fmt(bestHour.value) + ' tracked' : 'No activity');
            setText('g-focus', focusScore(agg));

            renderHeatmap(days);
            renderProjectTable();
            renderBarList('global-language-list', agg.languages, fmt, 'No global language activity');
          }

          function sessionAsAgg() {
            const agg = emptyAgg();
            agg.seconds = rawSession.seconds;
            agg.focusSeconds = rawSession.focusSeconds;
            agg.idleSeconds = rawSession.idleSeconds;
            agg.debugSeconds = rawSession.debugSeconds;
            agg.linesAdded = rawSession.linesAdded;
            agg.linesDeleted = rawSession.linesDeleted;
            agg.keystrokes = rawSession.keystrokes;
            agg.editEvents = rawSession.editEvents;
            agg.pasteEvents = rawSession.pasteEvents;
            agg.saves = rawSession.saves;
            agg.contextSwitches = rawSession.contextSwitches;
            agg.gitDirtyFiles = rawSession.gitDirtyFiles;
            agg.diagnosticsBySeverity = rawSession.diagnosticsBySeverity;
            agg.flow = rawSession.flow;
            agg.languages = rawSession.languages;
            agg.filesTouched = rawSession.filesTouched;
            agg.branches = rawSession.branches;
            return agg;
          }

          function focusScore(agg) {
            if (!agg.seconds) { return 0; }
            const topFiles = mapToRows(agg.files).slice(0, 3).reduce((total, item) => total + item.value, 0);
            const concentration = topFiles / agg.seconds;
            const switchPenalty = Math.min(35, agg.contextSwitches * 2);
            return Math.max(0, Math.min(100, Math.round(concentration * 100 - switchPenalty)));
          }

          function editIntensity(agg) {
            const hours = agg.seconds / 3600;
            return hours > 0 ? Math.round(agg.keystrokes / hours) : 0;
          }

          function churnRatio(agg) {
            const churn = agg.linesAdded + agg.linesDeleted;
            return churn > 0 ? Math.round((agg.linesDeleted / churn) * 100) : 0;
          }

          function saveRhythm(agg) {
            const hours = agg.seconds / 3600;
            const value = hours > 0 ? agg.saves / hours : 0;
            return value.toFixed(value >= 10 ? 0 : 1) + ' saves/hour';
          }

          function deltaPct(current, previous) {
            if (!previous && !current) { return { label: '0%', value: 0 }; }
            if (!previous) { return { label: '+100%', value: 100 }; }
            const value = Math.round(((current - previous) / previous) * 100);
            return { label: (value > 0 ? '+' : '') + value + '%', value };
          }

          function setDelta(id, delta) {
            const el = document.getElementById(id);
            el.textContent = delta.label;
            el.className = 'delta ' + (delta.value > 0 ? 'good' : delta.value < 0 ? 'bad' : '');
          }

          function renderTimeline(chart, canvasId, days, assign) {
            const byDate = {};
            days.forEach(day => byDate[day.date] = (byDate[day.date] || 0) + day.seconds);
            const labels = Object.keys(byDate).sort();
            const values = labels.map(date => Math.round((byDate[date] / 3600) * 100) / 100);
            const canvas = document.getElementById(canvasId);

            if (chart) {
              chart.data.labels = labels.map(date => date.slice(5));
              chart.data.datasets[0].data = values;
              chart.update('none');
              return;
            }

            assign(new Chart(canvas, {
              type: 'bar',
              data: {
                labels: labels.map(date => date.slice(5)),
                datasets: [{ label: 'Hours', data: values, backgroundColor: 'rgba(86,156,214,0.72)', borderRadius: 4 }]
              },
              options: {
                maintainAspectRatio: false,
                responsive: true,
                scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => fmt(Number(item.raw) * 3600) } } }
              }
            }));
          }

          function renderDiagnosticsChart(days) {
            const labels = days.map(day => day.date.slice(5));
            const errors = days.map(day => day.diagnosticsBySeverity.error);
            const warnings = days.map(day => day.diagnosticsBySeverity.warning);
            const infos = days.map(day => day.diagnosticsBySeverity.info + day.diagnosticsBySeverity.hint);
            const canvas = document.getElementById('qualityTrendChart');

            if (qualityTrendChart) {
              qualityTrendChart.data.labels = labels;
              qualityTrendChart.data.datasets[0].data = errors;
              qualityTrendChart.data.datasets[1].data = warnings;
              qualityTrendChart.data.datasets[2].data = infos;
              qualityTrendChart.update('none');
              return;
            }

            qualityTrendChart = new Chart(canvas, {
              type: 'bar',
              data: {
                labels,
                datasets: [
                  { label: 'Errors', data: errors, backgroundColor: 'rgba(241,76,76,0.76)', borderRadius: 3 },
                  { label: 'Warnings', data: warnings, backgroundColor: 'rgba(206,145,120,0.76)', borderRadius: 3 },
                  { label: 'Info', data: infos, backgroundColor: 'rgba(86,156,214,0.58)', borderRadius: 3 }
                ]
              },
              options: {
                maintainAspectRatio: false,
                responsive: true,
                scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
                plugins: { legend: { position: 'bottom' } }
              }
            });
          }

          function renderBarList(id, dataMap, formatter, emptyText) {
            const target = document.getElementById(id);
            const rows = mapToRows(dataMap).slice(0, 8);
            target.replaceChildren();
            if (!rows.length) {
              const empty = document.createElement('div');
              empty.className = 'empty';
              empty.textContent = emptyText;
              target.append(empty);
              return;
            }
            const max = rows[0].value || 1;
            rows.forEach((row, index) => {
              const item = document.createElement('div');
              item.className = 'bar-row';
              item.setAttribute('aria-label', row.name + ': ' + formatter(row.value));
              const label = document.createElement('div');
              label.className = 'bar-label';
              label.textContent = row.name;
              label.title = row.name;
              const value = document.createElement('div');
              value.className = 'value';
              value.textContent = formatter(row.value);
              const track = document.createElement('div');
              track.className = 'bar-track';
              const fill = document.createElement('div');
              fill.className = 'bar-fill';
              fill.style.width = Math.max(4, Math.round((row.value / max) * 100)) + '%';
              fill.style.background = colors[index % colors.length];
              fill.setAttribute('aria-hidden', 'true');
              track.append(fill);
              item.append(label, value, track);
              target.append(item);
            });
          }

          function renderFileTable(id, rows, touches, emptyText) {
            const table = document.getElementById(id);
            table.replaceChildren();
            if (!rows.length) {
              const row = document.createElement('tr');
              const cell = document.createElement('td');
              cell.colSpan = 3;
              cell.className = 'empty';
              cell.textContent = emptyText;
              row.append(cell);
              table.append(row);
              return;
            }
            const header = document.createElement('tr');
            ['File', 'Time', 'Touches'].forEach(text => {
              const th = document.createElement('th');
              th.scope = 'col';
              th.textContent = text;
              if (text !== 'File') { th.className = 'text-right'; }
              header.append(th);
            });
            table.append(header);
            rows.forEach(rowData => {
              const row = document.createElement('tr');
              const name = document.createElement('td');
              name.className = 'file-name';
              name.textContent = rowData.name;
              name.title = rowData.name;
              const time = document.createElement('td');
              time.className = 'text-right';
              time.textContent = fmt(rowData.value);
              const touched = document.createElement('td');
              touched.className = 'text-right';
              touched.textContent = compact((touches && touches[rowData.name]) || 0);
              row.append(name, time, touched);
              table.append(row);
            });
          }

          function renderProjectTable() {
            const table = document.getElementById('global-projects-table');
            const rows = rawAll.map(project => {
              const agg = aggregateDays(getFilteredDays(daysForProject(project)));
              return { name: project.name, value: agg.seconds, focus: focusScore(agg) };
            }).filter(row => row.value > 0).sort((a,b) => b.value - a.value).slice(0, 12);
            table.replaceChildren();
            if (!rows.length) {
              const row = document.createElement('tr');
              const cell = document.createElement('td');
              cell.colSpan = 3;
              cell.className = 'empty';
              cell.textContent = 'No activity in this range';
              row.append(cell);
              table.append(row);
              return;
            }
            const header = document.createElement('tr');
            ['Project','Time','Focus'].forEach(text => {
              const th = document.createElement('th');
              th.scope = 'col';
              th.textContent = text;
              if (text !== 'Project') { th.className = 'text-right'; }
              header.append(th);
            });
            table.append(header);
            rows.forEach(item => {
              const row = document.createElement('tr');
              const name = document.createElement('td');
              name.textContent = item.name;
              const time = document.createElement('td');
              time.className = 'text-right';
              time.textContent = fmt(item.value);
              const focus = document.createElement('td');
              focus.className = 'text-right';
              focus.textContent = item.focus;
              row.append(name, time, focus);
              table.append(row);
            });
          }

          function renderHeatmap(days) {
            const target = document.getElementById('heatmap');
            const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
            let max = 0;
            days.forEach(day => {
              const dow = dateFromKey(day.date).getDay();
              Object.entries(day.hours).forEach(([hour, seconds]) => {
                const hourIndex = Number(hour);
                if (hourIndex >= 0 && hourIndex < 24) {
                  matrix[dow][hourIndex] += seconds;
                  max = Math.max(max, matrix[dow][hourIndex]);
                }
              });
            });
            target.replaceChildren();
            const corner = document.createElement('div');
            corner.className = 'heat-label';
            target.append(corner);
            for (let hour = 0; hour < 24; hour += 1) {
              const label = document.createElement('div');
              label.className = 'heat-label';
              label.textContent = String(hour).padStart(2, '0');
              target.append(label);
            }
            matrix.forEach((row, dayIndex) => {
              const label = document.createElement('div');
              label.className = 'heat-label';
              label.textContent = dayNames[dayIndex];
              target.append(label);
              row.forEach((seconds, hour) => {
                const cell = document.createElement('div');
                cell.className = 'heat-cell';
                cell.style.setProperty('--heat', max > 0 ? String(Math.round((seconds / max) * 88) + 8) : '0');
                cell.title = dayNames[dayIndex] + ' ' + String(hour).padStart(2, '0') + ':00 - ' + fmt(seconds);
                target.append(cell);
              });
            });
          }

          function bestHourFromDays(days) {
            const hours = new Array(24).fill(0);
            days.forEach(day => {
              Object.entries(day.hours).forEach(([hour, seconds]) => {
                const hourIndex = Number(hour);
                if (hourIndex >= 0 && hourIndex < 24) { hours[hourIndex] += seconds; }
              });
            });
            let bestIndex = 0;
            hours.forEach((value, index) => {
              if (value > hours[bestIndex]) { bestIndex = index; }
            });
            return {
              label: hours[bestIndex] > 0 ? String(bestIndex).padStart(2, '0') + ':00' : '--',
              value: hours[bestIndex]
            };
          }

          function mapToRows(map) {
            return Object.entries(map || {})
              .map(([name, value]) => ({ name, value: Number(value || 0) }))
              .filter(item => item.value > 0)
              .sort((a,b) => b.value - a.value);
          }

          function topLabel(map, fallback) {
            const rows = mapToRows(map);
            return rows.length ? rows[0].name : fallback;
          }

          function setText(id, value) {
            document.getElementById(id).textContent = String(value);
          }

          function compact(value) {
            const num = Number(value || 0);
            if (Math.abs(num) >= 1000000) { return (num / 1000000).toFixed(1) + 'M'; }
            if (Math.abs(num) >= 1000) { return (num / 1000).toFixed(1) + 'k'; }
            return String(num);
          }

          function fmt(seconds) {
            const safeSeconds = Math.max(0, Number(seconds || 0));
            const h = Math.floor(safeSeconds / 3600);
            const m = Math.floor((safeSeconds % 3600) / 60);
            if (h === 0 && m === 0 && safeSeconds > 0) { return '< 1m'; }
            return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
          }
        </script>
      </body>
      </html>`;
  }
}

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";

  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
