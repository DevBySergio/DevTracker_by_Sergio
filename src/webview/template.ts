import {
  Card,
  ChartPanel,
  EmptyState,
  Metric,
  Toolbar,
  escapeAttribute,
  escapeHtml,
} from "./components";
import { ENGLISH_STRINGS as EN } from "./strings";

export type DashboardTrackingStatus =
  | "active"
  | "inactive"
  | "paused"
  | "unfocused";

export interface DashboardProjectOption {
  id: string;
  displayName: string;
}

export interface DashboardInitialData {
  protocolVersion: number;
  currentProjectId: string | null;
  projects: readonly DashboardProjectOption[];
  dailyGoalSeconds: number;
  trackingStatus: DashboardTrackingStatus;
  lastUpdatedAt: number;
  fileDetailAvailable: boolean;
}

export interface DashboardResources {
  nonce: string;
  cspSource: string;
  chartScriptUri: string;
  webviewScriptUri: string;
  stylesheetUri: string;
}

export function renderDashboardHtml(
  initialData: DashboardInitialData,
  resources: DashboardResources,
): string {
  const serializedData = escapeHtml(JSON.stringify(initialData));
  const tabs = Toolbar({
    className: "tabs",
    buttonClassName: "tab-btn",
    ariaLabel: EN.dashboardViews,
    role: "tablist",
    dataAttribute: "tab",
    items: [
      { id: "tab-overview", label: EN.views.today, value: "today", active: true },
      { id: "tab-trends", label: EN.views.project, value: "project" },
      { id: "tab-projects", label: EN.views.global, value: "global" },
      { id: "tab-workflow", label: EN.views.quality, value: "quality" },
    ],
  });
  const projectOptions = initialData.projects.map((project) =>
    `<option value="${escapeAttribute(project.id)}"${project.id === initialData.currentProjectId ? " selected" : ""}>${escapeHtml(project.displayName)}</option>`
  ).join("");
  const trackingLabel = EN.status.tracking[initialData.trackingStatus];
  const filters = Toolbar({
    id: "filter-bar",
    hidden: true,
    className: "filters",
    buttonClassName: "filter-btn",
    ariaLabel: EN.dateRange,
    role: "group",
    dataAttribute: "range",
    items: [
      { id: "btn-today", label: EN.ranges.today, value: "today" },
      { id: "btn-week", label: EN.ranges.week, value: "week", active: true },
      { id: "btn-month", label: EN.ranges.month, value: "month" },
      { id: "btn-all", label: EN.ranges.all, value: "all" },
    ],
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${resources.cspSource}; script-src 'nonce-${resources.nonce}'; style-src ${resources.cspSource}; font-src ${resources.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${resources.stylesheetUri}">
  <script nonce="${resources.nonce}" src="${resources.chartScriptUri}"></script>
  <script nonce="${resources.nonce}" src="${resources.webviewScriptUri}" defer></script>
  <title>${EN.documentTitle}</title>
</head>
<body>
  <a class="skip-link" href="#dashboard-content">${EN.skipToDashboard}</a>
  <script id="initial-data" nonce="${resources.nonce}" type="application/json">${serializedData}</script>
  <header class="app-shell">
    <div class="navbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>${EN.appName}</span></div>
      ${tabs}
      <div class="navbar-actions">
        <div id="tracking-status" class="tracking-status" data-status="${escapeAttribute(initialData.trackingStatus)}" title="Last updated ${escapeAttribute(new Date(initialData.lastUpdatedAt).toISOString())}">
          <span class="status-dot" aria-hidden="true"></span><span id="tracking-status-label">${escapeHtml(trackingLabel)}</span>
        </div>
        <details id="actions-menu" class="actions-menu">
          <summary>${EN.actions}</summary>
          <div class="actions-popover">
            <button type="button" data-action="export">${EN.actionItems.export}</button>
            <button type="button" data-action="settings">${EN.actionItems.settings}</button>
            <button type="button" data-action="open-data">${EN.actionItems.openData}</button>
            <button type="button" data-action="reset" class="danger-action">${EN.actionItems.reset}</button>
          </div>
        </details>
      </div>
    </div>
    <div class="shell-controls">
      <label class="project-control" for="project-selector">
        <span>${EN.projectSelector}</span>
        <select id="project-selector">
          <option value="">${EN.selectProject}</option>
          ${projectOptions}
        </select>
      </label>
    </div>
  </header>

  <main id="dashboard-content" class="container" tabindex="-1" aria-busy="true">
    <div class="view-header">
      <div>
        <h1 id="page-title" class="page-title">${EN.views.today}</h1>
        <div id="page-subtitle" class="view-subtitle">${EN.subtitles.today}</div>
      </div>
      ${filters}
    </div>

    <section id="view-today" class="view-section active" role="tabpanel" aria-labelledby="tab-overview">
      <div id="overview-empty" class="card overview-empty" hidden>
        <div class="empty-mark" aria-hidden="true"></div>
        <h2>${EN.empty.overviewTitle}</h2>
        <p>${EN.empty.overviewBody}</p>
      </div>
      <div id="overview-content">
        <div class="overview-metrics">
          <div class="card overview-hero" data-primary-metric="true" aria-label="${EN.aria.activeTimeToday}">
            <div class="overview-hero-heading">
              <div>
                <div class="card-title">${EN.metrics.activeToday}</div>
                <div class="hero-value" id="t-active">0m</div>
                <div class="metric-sub" id="t-active-sub">${EN.status.trackedAcrossProjects}</div>
              </div>
              <div class="overview-runtime">
                <span id="overview-tracking-status" class="badge">${escapeHtml(trackingLabel)}</span>
                <time id="overview-freshness">${EN.status.updatedJustNow}</time>
              </div>
            </div>
            <div class="goal-row">
              <div>
                <div class="goal-label">${EN.metrics.dailyGoal}</div>
                <div id="t-goal-sub" class="metric-sub">${EN.status.targetZeroMinutes}</div>
              </div>
              <strong id="t-goal">0%</strong>
            </div>
            <progress id="overview-goal-progress" class="goal-progress" max="100" value="0" aria-label="${EN.aria.dailyGoalProgress}"></progress>
          </div>
          <div class="overview-supporting-metrics">
            ${Metric({ id: "t-files", title: EN.metrics.uniqueActiveFiles, value: "0", subtitle: EN.status.exactRetainedFileCount, primary: true })}
            ${Metric({ id: "t-flow-blocks", title: EN.metrics.flowBlocks, value: "0", subtitle: EN.status.observedFlowBlocks, primary: true })}
          </div>
        </div>
        <div class="grid-2">
          ${ChartPanel({ title: EN.panels.todayTimeline, canvasId: "todayTrendChart", ariaLabel: EN.aria.activeHoursTodayChart, short: true })}
          ${Card(`<div class="card-title">${EN.panels.focusProfile}</div><div class="focus-profile">
            <div class="focus-item"><div class="focus-heading"><span>${EN.focusProfile.topThreeFiles}</span><strong id="focus-files-value">—</strong></div><p id="focus-files-description">${EN.focusProfile.topThreeFilesDescription}</p><code id="focus-files-formula"></code></div>
            <div class="focus-item"><div class="focus-heading"><span>${EN.focusProfile.fileSwitches}</span><strong id="focus-switches-value">—</strong></div><p id="focus-switches-description">${EN.focusProfile.fileSwitchesDescription}</p><code id="focus-switches-formula"></code></div>
            <div class="focus-item"><div class="focus-heading"><span>${EN.focusProfile.typicalFlow}</span><strong id="focus-flow-value">—</strong></div><p id="focus-flow-description">${EN.focusProfile.typicalFlowDescription}</p><code id="focus-flow-formula"></code></div>
          </div>`, "focus-card")}
        </div>
        <div class="grid-2 distribution-grid">
          ${Card(`<div class="card-title">${EN.panels.projectDistribution}</div><div class="list" id="overview-project-distribution">${EmptyState(EN.empty.noProjectDistribution)}</div>`)}
          ${Card(`<div class="card-title">${EN.panels.languageDistribution}</div><div class="list" id="overview-language-distribution">${EmptyState(EN.empty.noLanguageDistribution)}</div>`)}
        </div>
      </div>
    </section>

    <section id="view-project" class="view-section" role="tabpanel" aria-labelledby="tab-trends" hidden>
      <div class="grid-4">
        ${Card(`<div class="card-title">${EN.metrics.projectTime}</div><div class="metric-row"><div class="metric-big" id="p-time">0m</div><span class="delta" id="p-time-delta">0%</span></div><div class="metric-sub" id="p-time-sub">${EN.status.selectedRange}</div>`, "metric-card")}
        ${Metric({ id: "p-focus", title: EN.metrics.topThreeFileShare, value: "0%", subtitle: EN.initial.zeroObservedEditorTransitions })}
        ${Metric({ id: "p-intensity", title: EN.metrics.characterEditsPerHour, value: "0", subtitle: EN.initial.legacyApproximation })}
        ${Metric({ id: "p-churn", title: EN.metrics.removalShare, value: "0%", subtitle: EN.initial.zeroApproximateLineBreakChanges })}
      </div>
      <div class="grid-2">
        ${ChartPanel({ title: EN.panels.activityTrend, canvasId: "projectTrendChart", ariaLabel: EN.aria.projectHoursChart })}
        ${Card(`<div class="card-title">${EN.panels.languages}</div><div class="list" id="project-language-list">${EmptyState(EN.empty.noLanguagesInRange)}</div>`)}
      </div>
      ${Card(`<div class="card-title">${EN.panels.mostActiveFiles}</div><div class="table-wrapper"><table id="project-files-table"></table></div>`)}
    </section>

    <section id="view-quality" class="view-section" role="tabpanel" aria-labelledby="tab-workflow" hidden>
      <div class="grid-4">
        ${Metric({ id: "q-errors", title: EN.metrics.errors, value: "0", subtitle: EN.status.currentSnapshot, tone: "danger" })}
        ${Metric({ id: "q-warnings", title: EN.metrics.warnings, value: "0", subtitle: EN.status.currentSnapshot, tone: "warning" })}
        ${Metric({ id: "q-saves", title: EN.metrics.saves, value: "0", subtitle: EN.initial.zeroSavesPerHour })}
        ${Metric({ id: "q-debug", title: EN.metrics.debugTime, value: "0m", subtitle: EN.status.selectedRange })}
      </div>
      <div class="grid-2">
        ${ChartPanel({ title: EN.panels.diagnosticsTrend, canvasId: "qualityTrendChart", ariaLabel: EN.aria.diagnosticsChart })}
        ${Card(`<div class="card-title">${EN.panels.branchMix}</div><div class="list" id="branch-list">${EmptyState(EN.empty.gitUnavailable)}</div>`)}
      </div>
      ${Card(`<div class="card-title">${EN.panels.currentSignals}</div><div class="list" id="quality-breakdown">${EmptyState(EN.empty.diagnosticsUnavailable)}</div>`)}
    </section>

    <section id="view-global" class="view-section" role="tabpanel" aria-labelledby="tab-projects" hidden>
      <div class="grid-4">
        ${Metric({ id: "g-time", title: EN.metrics.trackedTime, value: "0m", subtitle: EN.status.allTrackedActivity })}
        ${Metric({ id: "g-projects", title: EN.metrics.projects, value: "0", subtitle: EN.status.withActivity })}
        ${Metric({ id: "g-best-hour", title: EN.metrics.mostActiveHour, value: "--", subtitle: EN.empty.noActivity })}
        ${Metric({ id: "g-focus", title: EN.metrics.topThreeFileShare, value: "0%", subtitle: EN.status.selectedRange })}
      </div>
      <div class="grid-2">
        ${Card(`<div class="card-title">${EN.panels.weeklyHeatmap}</div><div id="heatmap" class="heatmap"></div>`)}
        ${Card(`<div class="card-title">${EN.panels.topProjects}</div><div class="table-wrapper"><table id="global-projects-table"></table></div>`)}
      </div>
      ${Card(`<div class="card-title">${EN.panels.globalLanguages}</div><div class="list" id="global-language-list">${EmptyState(EN.empty.noActivityInRange)}</div>`)}
    </section>
  </main>
</body>
</html>`;
}
