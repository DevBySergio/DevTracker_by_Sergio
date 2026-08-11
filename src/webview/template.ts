import {
  Card,
  ChartPanel,
  EmptyState,
  Metric,
  Toolbar,
  escapeHtml,
} from "./components";
import { ENGLISH_STRINGS as EN } from "./strings";

export interface DashboardInitialData {
  protocolVersion: number;
  currentProjectId: string;
  dailyGoalSeconds: number;
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
      { id: "tab-today", label: EN.views.today, value: "today", active: true },
      { id: "tab-project", label: EN.views.project, value: "project" },
      { id: "tab-quality", label: EN.views.quality, value: "quality" },
      { id: "tab-global", label: EN.views.global, value: "global" },
    ],
  });
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
  <header class="navbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>${EN.appName}</span></div>
    ${tabs}
  </header>

  <main id="dashboard-content" class="container" tabindex="-1">
    <div class="view-header">
      <div>
        <h1 id="page-title" class="page-title">${EN.views.today}</h1>
        <div id="page-subtitle" class="view-subtitle">${EN.subtitles.today}</div>
      </div>
      ${filters}
    </div>

    <section id="view-today" class="view-section active" role="tabpanel" aria-labelledby="tab-today">
      <div class="grid-4">
        ${Metric({ id: "t-active", title: EN.metrics.activeToday, value: "0m", subtitle: EN.status.sessionZeroMinutes, ariaLabel: EN.aria.activeTimeToday, tone: "success" })}
        ${Metric({ id: "t-goal", title: EN.metrics.dailyGoal, value: "0%", subtitle: EN.status.targetZeroMinutes, ariaLabel: EN.aria.dailyGoalProgress })}
        ${Metric({ id: "t-focus", title: EN.metrics.topThreeFileShare, value: "0%", subtitle: EN.empty.noActivity, ariaLabel: EN.aria.topThreeFileShare })}
        ${Metric({ id: "t-flow", title: EN.metrics.currentFlow, value: "0m", subtitle: EN.status.longestZeroMinutes, ariaLabel: EN.aria.currentFlowBlock })}
      </div>
      <div class="grid-4">
        ${Metric({ id: "t-edit", title: EN.metrics.characterEditVolume, value: "0", subtitle: EN.initial.zeroEditEvents, ariaLabel: EN.aria.characterEditVolume })}
        ${Metric({ id: "t-churn", title: EN.metrics.approximateLineActivity, value: "0", subtitle: EN.initial.approximateNetZeroLineBreaks, ariaLabel: EN.aria.approximateLineActivity, tone: "warning" })}
        ${Metric({ id: "t-quality", title: EN.metrics.currentDiagnostics, value: "0", subtitle: EN.initial.zeroWarnings, ariaLabel: EN.aria.currentDiagnostics, tone: "danger" })}
        ${Metric({ id: "t-git", title: EN.metrics.gitContext, value: "0", subtitle: EN.empty.gitUnavailable, ariaLabel: EN.aria.gitContext })}
      </div>
      <div class="grid-2">
        ${ChartPanel({ title: EN.panels.todayTimeline, canvasId: "todayTrendChart", ariaLabel: EN.aria.activeHoursTodayChart, short: true, accessory: `<span class="delta" id="t-save-rhythm">${EN.initial.zeroSavesPerHour}</span>` })}
        ${Card(`<div class="card-title">${EN.panels.sessionLanguages}</div><div class="list" id="today-language-list">${EmptyState(EN.empty.noSessionLanguages)}</div>`)}
      </div>
      ${Card(`<div class="card-title">${EN.panels.activeFiles}</div><div class="table-wrapper"><table id="today-files-table"></table></div>`)}
    </section>

    <section id="view-project" class="view-section" role="tabpanel" aria-labelledby="tab-project" hidden>
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

    <section id="view-quality" class="view-section" role="tabpanel" aria-labelledby="tab-quality" hidden>
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

    <section id="view-global" class="view-section" role="tabpanel" aria-labelledby="tab-global" hidden>
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
