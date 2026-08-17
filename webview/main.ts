import type {
  DashboardInitialData,
  DashboardRangeName,
  DashboardResponseMessage,
  DashboardViewName,
  RangeQueryViewModel,
  RangeViewModelDelta,
  ProjectPreference,
} from "./types";
import { ENGLISH_STRINGS as EN } from "../src/webview/strings";
import {
  DashboardShellState,
  restoreDashboardState,
} from "../src/webview/shellState";
import {
  OverviewDistributionValue,
  OverviewViewModel,
  buildOverviewViewModel,
} from "../src/webview/overviewModel";
import {
  TrendsViewModel,
  buildTrendsViewModel,
} from "../src/webview/trendsModel";
import {
  ProjectListItem,
  ProjectSort,
  ProjectsViewModel,
  buildProjectsViewModel,
  normalizeProjectPreference,
} from "../src/webview/projectsModel";
import {
  WorkflowIntegrationState,
  buildWorkflowViewModel,
} from "../src/webview/workflowModel";

declare const Chart: any;
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: DashboardShellState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const themeColor = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
Chart.defaults.color = themeColor('--text-secondary');
Chart.defaults.borderColor = themeColor('--card-border');
Chart.defaults.font.family = themeColor('--font-family');

const initialData = JSON.parse(
  document.getElementById('initial-data')?.textContent ?? "{}",
) as DashboardInitialData;
const vscodeApi = acquireVsCodeApi();
const restoredState = restoreDashboardState(
  vscodeApi.getState(),
  initialData.currentProjectId,
  initialData.projects.map(project => project.id),
);
let currentTab: DashboardViewName = restoredState.view;
let currentRange: DashboardRangeName = restoredState.range;
let selectedProjectId: string | null = restoredState.projectId;
const initialCustomEnd = localDateKey(new Date());
let customEndLocalDate = restoredState.customEndLocalDate &&
    restoredState.customEndLocalDate <= initialCustomEnd
  ? restoredState.customEndLocalDate
  : initialCustomEnd;
let customStartLocalDate = restoredState.customStartLocalDate &&
    restoredState.customStartLocalDate <= customEndLocalDate
  ? restoredState.customStartLocalDate
  : addLocalDays(customEndLocalDate, -6);
const knownProjects = new Map(
  initialData.projects.map(project => [project.id, project.displayName]),
);
let projectPreferences: Record<string, ProjectPreference> = {
  ...initialData.projectPreferences,
};
let projectSearch = '';
let projectSort: ProjectSort = 'activity';
let showManagedProjects = false;
let requestSequence = 0;
let activeRequestId = '';
let dashboardData: RangeQueryViewModel | null = null;
let rawSession = normalizeSession();
let rawProject = { name: EN.status.currentProject, path: '', days: {} };
let rawComparisonProject = null;
let rawAll = [];
let rangeDays = [];
let dailyGoal = initialData.dailyGoalSeconds;
let runtimeLastUpdatedAt = initialData.lastUpdatedAt;
let runtimeFileDetailAvailable = initialData.fileDetailAvailable;
let runtimeIntegrationSettings = { ...initialData.integrationSettings };
let todayTrendChart = null;
let trendsActivityChart = null;
let trendsFlowChart = null;
let trendsLanguageChart = null;

const dayNames = EN.dayNames;
const colors = Array.from(
  { length: 8 },
  (_value, index) => themeColor(`--chart-${index + 1}`),
);

document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(button => {
  button.addEventListener('click', () => switchTab(button.dataset.tab as DashboardViewName));
});
document.querySelectorAll<HTMLButtonElement>('.filter-btn').forEach(button => {
  button.addEventListener('click', () => setRange(button.dataset.range as DashboardRangeName));
});
document.getElementById('custom-range-controls')?.addEventListener('submit', event => {
  event.preventDefault();
  const start = (document.getElementById('custom-range-start') as HTMLInputElement).value;
  const end = (document.getElementById('custom-range-end') as HTMLInputElement).value;
  const today = localDateKey(new Date());
  const error = document.getElementById('custom-range-error')!;
  if (!isLocalDate(start) || !isLocalDate(end) || start > end || start > today) {
    error.textContent = EN.customRange.invalid;
    return;
  }
  customStartLocalDate = start;
  customEndLocalDate = end > today ? today : end;
  error.textContent = '';
  persistDashboardState();
  applyShellState();
  requestView();
});
document.getElementById('project-selector')?.addEventListener('change', event => {
  const value = (event.currentTarget as HTMLSelectElement).value;
  selectedProjectId = value || null;
  persistDashboardState();
  requestView();
});
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'dashboard/action', action: button.dataset.action });
    (document.getElementById('actions-menu') as HTMLDetailsElement).open = false;
  });
});
document.getElementById('projects-search')?.addEventListener('input', event => {
  projectSearch = (event.currentTarget as HTMLInputElement).value;
  if (currentTab === 'global' && dashboardData) { renderGlobal(); }
});
document.getElementById('projects-sort')?.addEventListener('change', event => {
  projectSort = (event.currentTarget as HTMLSelectElement).value as ProjectSort;
  if (currentTab === 'global' && dashboardData) { renderGlobal(); }
});
document.getElementById('projects-show-managed')?.addEventListener('change', event => {
  showManagedProjects = (event.currentTarget as HTMLInputElement).checked;
  if (currentTab === 'global' && dashboardData) { renderGlobal(); }
});
document.getElementById('project-preferences-form')?.addEventListener('submit', event => {
  event.preventDefault();
  saveSelectedProjectPreference();
});
document.getElementById('project-open-trends')?.addEventListener('click', () => {
  if (!selectedProjectId) { return; }
  switchTab('project');
});

window.addEventListener('message', (event: MessageEvent<DashboardResponseMessage>) => {
  const msg = event.data;
  if (!msg || msg.protocolVersion !== initialData.protocolVersion) {
    return;
  }
  if (msg.type === 'dashboard/tracking-status') {
    dailyGoal = msg.dailyGoalSeconds;
    runtimeFileDetailAvailable = msg.fileDetailAvailable;
    renderTrackingStatus(msg.status, msg.lastUpdatedAt);
    if (currentTab === 'today' && dashboardData) {
      renderToday();
    }
    return;
  }
  if (msg.type === 'dashboard/project-preferences') {
    projectPreferences = { ...msg.preferences };
    renderProjectOptions();
    if (currentTab === 'global' && dashboardData) { renderGlobal(); }
    return;
  }
  if (msg.type === 'dashboard/integration-settings') {
    runtimeIntegrationSettings = { ...msg.settings };
    if (currentTab === 'quality' && dashboardData) { renderQuality(); }
    return;
  }
  if (msg.requestId !== activeRequestId || msg.view !== currentTab) {
    return;
  }
  if (msg.type === 'dashboard/snapshot') {
    dashboardData = msg.data;
    rememberProjects(msg.data.current.projects);
    adaptDashboardData();
    render();
  }
  if (msg.type === 'dashboard/live-delta' && dashboardData && dashboardData.revision === msg.baseRevision) {
    applyViewModelDelta(dashboardData, msg.delta, msg.revision);
    rememberProjects(dashboardData.current.projects);
    adaptDashboardData();
    render();
  }
  if (msg.type === 'dashboard/error') {
    document.getElementById('page-subtitle')!.textContent = `${EN.status.dataUnavailable} (${msg.code}).`;
    setBusy(false);
  }
});

renderProjectOptions();
applyShellState();
renderTrackingStatus(initialData.trackingStatus, initialData.lastUpdatedAt);
persistDashboardState();
requestView();

function switchTab(tab: DashboardViewName) {
  currentTab = tab;
  persistDashboardState();
  applyShellState();
  requestView();
}

function applyShellState() {
  document.querySelectorAll('.tab-btn').forEach(item => {
    const active = (item as HTMLElement).dataset.tab === currentTab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll<HTMLElement>('.view-section').forEach(section => {
    const active = section.id === 'view-' + currentTab;
    section.classList.toggle('active', active);
    section.hidden = !active;
  });
  document.getElementById('filter-bar')!.hidden = currentTab === 'today';
  const customControls = document.getElementById('custom-range-controls')!;
  customControls.hidden = currentTab === 'today' || currentRange !== 'custom';
  const customStart = document.getElementById('custom-range-start') as HTMLInputElement;
  const customEnd = document.getElementById('custom-range-end') as HTMLInputElement;
  const today = localDateKey(new Date());
  customStart.value = customStartLocalDate;
  customEnd.value = customEndLocalDate;
  customStart.max = today;
  customEnd.max = today;
  document.querySelectorAll<HTMLButtonElement>('.filter-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.range === currentRange);
  });
  (document.getElementById('project-selector') as HTMLSelectElement).value = selectedProjectId ?? '';
  updateHeader();
}

function setRange(range: DashboardRangeName) {
  currentRange = range;
  persistDashboardState();
  applyShellState();
  requestView();
}

function requestView() {
  const needsProject = currentTab === 'project' || currentTab === 'quality';
  activeRequestId = 'request-' + (++requestSequence);
  dashboardData = null;
  if (needsProject && !selectedProjectId) {
    activeRequestId = '';
    updateHeader();
    document.getElementById('page-subtitle')!.textContent = EN.status.selectProjectToContinue;
    setBusy(false);
    return;
  }
  const projectId = needsProject ? selectedProjectId : null;
  setBusy(true);
  document.getElementById('page-subtitle')!.textContent = EN.status.loading;
  const range = currentTab === 'today'
    ? { preset: 'today', includeComparison: false }
    : currentRange === 'custom'
      ? {
        preset: 'custom',
        startLocalDate: customStartLocalDate,
        endLocalDate: customEndLocalDate,
        includeComparison: currentTab === 'project'
      }
      : {
        preset: currentRange,
        includeComparison: currentTab === 'project'
      };
  vscodeApi.postMessage({
    type: 'dashboard/request-view',
    protocolVersion: initialData.protocolVersion,
    requestId: activeRequestId,
    view: currentTab,
    range,
    projectId
  });
}

function persistDashboardState() {
  vscodeApi.setState({
    view: currentTab,
    range: currentRange,
    projectId: selectedProjectId,
    customStartLocalDate,
    customEndLocalDate,
  });
}

function rememberProjects(projects: RangeQueryViewModel['current']['projects']) {
  let changed = false;
  projects.forEach(project => {
    const { id, displayName } = project.project;
    if (knownProjects.get(id) !== displayName) {
      knownProjects.set(id, displayName);
      changed = true;
    }
  });
  if (changed) {
    renderProjectOptions();
  }
}

function renderProjectOptions() {
  const selector = document.getElementById('project-selector') as HTMLSelectElement;
  selector.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = EN.selectProject;
  selector.append(placeholder);
  const counts = new Map<string, number>();
  knownProjects.forEach(displayName => {
    const key = displayName.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  [...knownProjects.entries()]
    .sort((left, right) => projectOptionName(left).localeCompare(projectOptionName(right)) || left[0].localeCompare(right[0]))
    .forEach(([id, displayName]) => {
      const option = document.createElement('option');
      option.value = id;
      const alias = projectPreferences[id]?.alias;
      const distinguish = Boolean(alias) || (counts.get(displayName.toLocaleLowerCase()) ?? 0) > 1;
      option.textContent = `${alias || displayName}${distinguish ? ` · ${shortProjectId(id)}` : ''}`;
      selector.append(option);
    });
  selector.value = selectedProjectId ?? '';
}

function projectOptionName([id, displayName]: [string, string]): string {
  return projectPreferences[id]?.alias || displayName;
}

function renderTrackingStatus(
  status: DashboardInitialData['trackingStatus'],
  lastUpdatedAt: number,
) {
  runtimeLastUpdatedAt = lastUpdatedAt;
  const target = document.getElementById('tracking-status')!;
  target.dataset.status = status;
  target.title = `Last updated ${new Date(lastUpdatedAt).toLocaleString()}`;
  document.getElementById('tracking-status-label')!.textContent = EN.status.tracking[status];
  const overviewStatus = document.getElementById('overview-tracking-status');
  if (overviewStatus) {
    overviewStatus.textContent = EN.status.tracking[status];
  }
  renderFreshness();
}

function renderFreshness() {
  const target = document.getElementById('overview-freshness') as HTMLTimeElement | null;
  if (!target) { return; }
  const updated = new Date(runtimeLastUpdatedAt);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - runtimeLastUpdatedAt) / 1000));
  target.dateTime = updated.toISOString();
  target.title = updated.toLocaleString();
  target.textContent = elapsedSeconds < 60
    ? EN.status.updatedJustNow
    : `Updated ${Math.floor(elapsedSeconds / 60)}m ago`;
}

function setBusy(busy: boolean) {
  document.getElementById('dashboard-content')!.setAttribute('aria-busy', String(busy));
}

function render() {
  setBusy(false);
  updateHeader();
  renderToday();
  if (currentTab === 'project') { renderProject(); }
  if (currentTab === 'quality') { renderQuality(); }
  if (currentTab === 'global') { renderGlobal(); }
}

function updateHeader() {
  const title = document.getElementById('page-title');
  const subtitle = document.getElementById('page-subtitle');
  const projectName = rawProject && rawProject.name ? rawProject.name : EN.status.currentProject;
  if (currentTab === 'today') {
    title.textContent = EN.views.today;
    subtitle.textContent = EN.subtitles.today;
  }
  if (currentTab === 'project') {
    title.textContent = `${EN.views.project}: ${projectName}`;
    subtitle.textContent = EN.subtitles.project;
  }
  if (currentTab === 'quality') {
    title.textContent = `${EN.views.quality}: ${projectName}`;
    subtitle.textContent = EN.subtitles.quality;
  }
  if (currentTab === 'global') {
    title.textContent = EN.views.global;
    subtitle.textContent = EN.subtitles.global;
  }
}

function adaptDashboardData() {
  const current = dashboardData.current;
  rangeDays = periodDays(current, true);
  rawSession = normalizeSession(metricsAsLegacy(current.metrics, current));
  rawProject = periodAsLegacyProject(current);
  rawComparisonProject = dashboardData.comparison
    ? periodAsLegacyProject(dashboardData.comparison)
    : null;
  rawAll = current.projects.map(project => projectAsLegacy(project, current.range.endLocalDate));
  if (currentTab === 'today') {
    rawAll = [{ name: EN.views.today, path: '', days: Object.fromEntries(rangeDays.map(day => [day.date, day])) }];
  }
}

function periodAsLegacyProject(period) {
  const project = period.projects[0];
  const days = periodDays(period, true);
  return {
    name: project ? project.project.displayName : EN.status.currentProject,
    path: project ? project.project.id : '',
    days: Object.fromEntries(days.map(day => [day.date, day]))
  };
}

function projectAsLegacy(project, localDate) {
  const day = metricsAsLegacy(project.metrics, {
    range: { localDates: [localDate] },
    languages: project.languages,
    files: project.files,
    branches: project.branches,
    quarterHours: []
  }, localDate);
  return {
    name: project.project.displayName,
    path: project.project.id,
    days: { [localDate]: day }
  };
}

function periodDays(period, includeDistributions) {
  const byDate = new Map(period.days.map(day => [day.localDate, day.metrics]));
  const hoursByDate = {};
  (period.quarterHours || []).forEach(bucket => {
    const hour = String(bucket.label || '').slice(0, 2);
    const target = hoursByDate[bucket.localDate] || (hoursByDate[bucket.localDate] = {});
    target[hour] = (target[hour] || 0) + Number(bucket.activeTimeMs || 0) / 1000;
  });
  return period.range.localDates.map((localDate, index) => {
    const day = metricsAsLegacy(byDate.get(localDate), period, localDate);
    day.hours = hoursByDate[localDate] || {};
    if (!includeDistributions || index !== 0) {
      day.languages = {};
      day.activeTimeByDocumentMs = {};
    }
    return day;
  });
}

function metricsAsLegacy(metrics, period, localDate = undefined) {
  const safe = metrics || emptyRangeMetrics();
  const languages = Object.fromEntries((period.languages || []).map(item => [item.id, {
    name: item.id,
    seconds: Number(item.activeTimeMs || 0) / 1000
  }]));
  const files = Object.fromEntries((period.files || []).map(item => [item.id, Number(item.activeTimeMs || 0)]));
  const branches = Object.fromEntries((period.branches || []).map(item => [item.id, Number(item.activeTimeMs || 0) / 1000]));
  return {
    date: localDate || (period.range && period.range.endLocalDate) || getLocalDateKey(),
    seconds: Number(safe.activeTimeMs || 0) / 1000,
    insertedCharacters: Number(safe.insertedCharacters || 0),
    removedCharacters: Number(safe.removedCharacters || 0),
    insertedLineBreaksApprox: Number(safe.insertedLineBreaksApprox || 0),
    removedLineBreaksApprox: Number(safe.removedLineBreaksApprox || 0),
    editEvents: Number(safe.editEvents || 0),
    largeEditEvents: Number(safe.largeEditEvents || 0),
    saves: Number(safe.saveEvents || 0),
    contextSwitches: Number(safe.fileSwitchEvents || 0),
    debugSeconds: Number(safe.debugActiveTimeMs || 0) / 1000,
    diagnosticsBySeverity: normalizeDiagnostics(safe.diagnostics && safe.diagnostics.current),
    flow: {
      count: Number(safe.flowBlockCount || 0),
      totalSeconds: Number(safe.flowActiveMs || 0) / 1000,
      longestSeconds: Number(safe.longestFlowActiveMs || 0) / 1000,
      currentSeconds: 0
    },
    languages,
    activeTimeByDocumentMs: files,
    branches,
    taskSummaries: period.tasks || [],
    gitStatus: safe.gitStatus || 'disabled',
    gitDirtyFiles: Number(safe.gitDirtyFiles || 0),
    hours: {}
  };
}

function emptyRangeMetrics() {
  return {
    diagnostics: { current: {} }
  };
}

function applyViewModelDelta(target, delta, revision) {
  applyPeriodDelta(target.current, delta.current);
  if (delta.comparison.kind === 'replace') {
    target.comparison = delta.comparison.value;
  }
  if (delta.comparison.kind === 'patch' && target.comparison) {
    applyPeriodDelta(target.comparison, delta.comparison.value);
  }
  if (delta.comparisonStatus !== null) {
    target.comparisonStatus = delta.comparisonStatus;
  }
  target.revision = revision;
}

function applyPeriodDelta(target, delta) {
  if (delta.range !== null) { target.range = delta.range; }
  if (delta.metrics !== null) { target.metrics = delta.metrics; }
  if (delta.days !== null) { target.days = patchCollection(target.days, delta.days, item => item.localDate); }
  if (delta.projects !== null) { target.projects = patchCollection(target.projects, delta.projects, item => item.project.id); }
  if (delta.languages !== null) { target.languages = patchCollection(target.languages, delta.languages, item => item.id); }
  if (delta.files !== null) { target.files = patchCollection(target.files, delta.files, item => item.id); }
  if (delta.branches !== null) { target.branches = patchCollection(target.branches, delta.branches, item => item.id); }
  if (delta.tasks !== null) { target.tasks = patchCollection(target.tasks, delta.tasks, item => `${item.classification}\0${item.configuredName}`); }
  if (delta.quarterHours !== null) { target.quarterHours = patchCollection(target.quarterHours, delta.quarterHours, item => item.key); }
}

function patchCollection(current, delta, keyOf) {
  const values = new Map(current.map(item => [keyOf(item), item]));
  delta.remove.forEach(key => values.delete(key));
  delta.upsert.forEach(item => values.set(keyOf(item), item));
  return [...values.values()];
}

function normalizeSession(session: Record<string, any> = {}) {
  const safe = session || {};
  return {
    startTime: safe.startTime || Date.now(),
    seconds: safe.seconds || 0,
    insertedCharacters: safe.insertedCharacters || 0,
    removedCharacters: safe.removedCharacters || 0,
    insertedLineBreaksApprox: safe.insertedLineBreaksApprox || 0,
    removedLineBreaksApprox: safe.removedLineBreaksApprox || 0,
    languages: safe.languages || {},
    files: activeFileSeconds(safe),
    activeFileCounts: activeFileCounts(safe),
    editEvents: safe.editEvents || 0,
    largeEditEvents: safe.largeEditEvents || 0,
    activeTimeByDocumentMs: safe.activeTimeByDocumentMs || {},
    saves: safe.saves || 0,
    focusSeconds: safe.focusSeconds || safe.seconds || 0,
    idleSeconds: safe.idleSeconds || 0,
    debugSeconds: safe.debugSeconds || 0,
    diagnosticsBySeverity: normalizeDiagnostics(safe.diagnosticsBySeverity),
    contextSwitches: safe.contextSwitches || 0,
    branches: safe.branches || {},
    taskSummaries: safe.taskSummaries || [],
    gitStatus: safe.gitStatus || 'disabled',
    gitDirtyFiles: safe.gitDirtyFiles || 0,
    flow: normalizeFlow(safe.flow)
  };
}

function normalizeDay(day) {
  const safe = day || {};
  return {
    date: safe.date || getLocalDateKey(),
    seconds: safe.seconds || 0,
    insertedCharacters: safe.insertedCharacters || 0,
    removedCharacters: safe.removedCharacters || 0,
    insertedLineBreaksApprox: safe.insertedLineBreaksApprox || 0,
    removedLineBreaksApprox: safe.removedLineBreaksApprox || 0,
    languages: safe.languages || {},
    hours: safe.hours || {},
    files: activeFileSeconds(safe),
    activeFileCounts: activeFileCounts(safe),
    editEvents: safe.editEvents || 0,
    largeEditEvents: safe.largeEditEvents || 0,
    activeTimeByDocumentMs: safe.activeTimeByDocumentMs || {},
    saves: safe.saves || 0,
    focusSeconds: safe.focusSeconds || safe.seconds || 0,
    idleSeconds: safe.idleSeconds || 0,
    debugSeconds: safe.debugSeconds || 0,
    diagnosticsBySeverity: normalizeDiagnostics(safe.diagnosticsBySeverity),
    contextSwitches: safe.contextSwitches || 0,
    branches: safe.branches || {},
    gitStatus: safe.gitStatus || 'disabled',
    gitDirtyFiles: safe.gitDirtyFiles || 0,
    flow: normalizeFlow(safe.flow)
  };
}

function normalizeDiagnostics(value: Record<string, number> = {}) {
  const safe = value || {};
  return {
    error: safe.error || 0,
    warning: safe.warning || 0,
    info: safe.info || 0,
    hint: safe.hint || 0
  };
}

function activeFileSeconds(value) {
  const safe = value || {};
  const exact = safe.activeTimeByDocumentMs || {};
  if (Object.keys(exact).length > 0) {
    return Object.fromEntries(Object.entries(exact).map(([id, durationMs]) => [id, Number(durationMs || 0) / 1000]));
  }
  return safe.files || {};
}

function activeFileCounts(value) {
  return Object.fromEntries(Object.keys(activeFileSeconds(value)).map(id => [id, 1]));
}

function normalizeFlow(value: Record<string, number> = {}) {
  const safe = value || {};
  return {
    count: safe.count || 0,
    totalSeconds: safe.totalSeconds || 0,
    longestSeconds: safe.longestSeconds || 0,
    currentSeconds: safe.currentSeconds || 0
  };
}

function getLocalDateKey() {
  return localDateKey(new Date());
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
  return [...days].sort((left, right) => left.date.localeCompare(right.date));
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
    agg.insertedCharacters += day.insertedCharacters;
    agg.removedCharacters += day.removedCharacters;
    agg.insertedLineBreaksApprox += day.insertedLineBreaksApprox;
    agg.removedLineBreaksApprox += day.removedLineBreaksApprox;
    agg.editEvents += day.editEvents;
    agg.largeEditEvents += day.largeEditEvents;
    agg.saves += day.saves;
    agg.contextSwitches += day.contextSwitches;
    agg.gitDirtyFiles = Math.max(agg.gitDirtyFiles, day.gitDirtyFiles);
    agg.flow.count += day.flow.count;
    agg.flow.totalSeconds += day.flow.totalSeconds;
    agg.flow.longestSeconds = Math.max(agg.flow.longestSeconds, day.flow.longestSeconds);
    addMap(agg.languages, Object.fromEntries((Object.values(day.languages) as Array<{ name: string; seconds: number }>).map(language => [language.name, language.seconds])));
    addMap(agg.files, day.files);
    addMap(agg.activeTimeByDocumentMs, day.activeTimeByDocumentMs);
    addMap(agg.activeFileCounts, day.activeFileCounts);
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
    insertedCharacters: 0,
    removedCharacters: 0,
    insertedLineBreaksApprox: 0,
    removedLineBreaksApprox: 0,
    editEvents: 0,
    largeEditEvents: 0,
    saves: 0,
    contextSwitches: 0,
    gitDirtyFiles: 0,
    diagnosticsBySeverity: normalizeDiagnostics(),
    flow: normalizeFlow(),
    languages: {},
    files: {},
    activeTimeByDocumentMs: {},
    activeFileCounts: {},
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
  if (!dashboardData) { return; }
  const overview = buildOverviewViewModel(
    dashboardData.current,
    dailyGoal,
    runtimeFileDetailAvailable,
  );
  const empty = document.getElementById('overview-empty')!;
  const content = document.getElementById('overview-content')!;
  empty.hidden = overview.hasActivity;
  content.hidden = !overview.hasActivity;
  if (!overview.hasActivity) {
    renderFreshness();
    return;
  }

  setText('t-active', fmt(overview.activeTimeMs / 1000));
  const activeProjects = overview.projectDistribution.length;
  setText(
    't-active-sub',
    activeProjects > 0
      ? `${activeProjects} active ${activeProjects === 1 ? 'project' : 'projects'} today`
      : EN.status.trackedAcrossProjects,
  );
  const goalPercent = overview.dailyGoalCompletionPercent;
  const roundedGoal = goalPercent === null ? null : Math.round(goalPercent);
  setText('t-goal', roundedGoal === null ? '—' : `${roundedGoal}%`);
  setText(
    't-goal-sub',
    overview.dailyGoalMs === null
      ? EN.status.goalNotConfigured
      : `${fmt(overview.activeTimeMs / 1000)} ${EN.phrases.of} ${fmt(overview.dailyGoalMs / 1000)}`,
  );
  const goalProgress = document.getElementById('overview-goal-progress') as HTMLProgressElement;
  goalProgress.value = roundedGoal ?? 0;
  goalProgress.setAttribute('aria-valuetext', roundedGoal === null ? EN.status.goalNotConfigured : `${roundedGoal}%`);

  setText('t-files', overview.uniqueActiveFiles ?? '—');
  setText(
    't-files-sub',
    overview.uniqueActiveFiles === null
      ? EN.status.fileDetailUnavailable
      : EN.status.exactRetainedFileCount,
  );
  setText('t-flow-blocks', overview.flowBlockCount);
  setText('t-flow-blocks-sub', EN.status.observedFlowBlocks);

  renderOverviewTimeline(overview);
  renderFocusProfile(overview);
  renderOverviewDistribution(
    'overview-project-distribution',
    overview.projectDistribution,
    EN.empty.noProjectDistribution,
  );
  renderOverviewDistribution(
    'overview-language-distribution',
    overview.languageDistribution,
    EN.empty.noLanguageDistribution,
  );
  renderFreshness();
}

function renderProject() {
  if (!dashboardData) { return; }
  const trends = buildTrendsViewModel(
    dashboardData.current,
    dashboardData.comparison,
    dashboardData.comparisonStatus,
    dailyGoal,
  );

  setText('trend-active-time', fmt(trends.activeTimeMs / 1000));
  const deltaTarget = document.getElementById('trend-active-time-delta')!;
  if (trends.comparisonDeltaPercent === null) {
    deltaTarget.textContent = '—';
    deltaTarget.classList.remove('good', 'bad');
    setText('trend-comparison-status', EN.status.comparisonUnavailable);
  } else {
    setDelta('trend-active-time-delta', {
      label: signedPercent(trends.comparisonDeltaPercent),
      value: trends.comparisonDeltaPercent,
    });
    setText('trend-comparison-status', EN.status.comparisonAvailable);
  }
  setText('trend-active-days', `${trends.activeDays} / ${trends.days.length}`);
  setText('trend-active-days-sub', `${formatDecimal(trends.consistencyPercent)}% of days in ${trends.rangeLabel}`);
  if (trends.goalCompletionRatePercent === null) {
    setText('trend-goal-days', '—');
    setText('trend-goal-days-sub', EN.status.goalNotConfigured);
  } else {
    setText('trend-goal-days', `${trends.goalDays} / ${trends.goalEligibleDays}`);
    setText('trend-goal-days-sub', `${formatDecimal(trends.goalCompletionRatePercent)}% of selected days reached the goal`);
  }
  setText('trend-streak', `${trends.currentStreakDays} ${dayWord(trends.currentStreakDays)}`);
  setText('trend-streak-sub', `Longest streak: ${trends.longestStreakDays} ${dayWord(trends.longestStreakDays)}`);

  renderTrendsActivity(trends);
  renderTrendsFlow(trends);
  renderTrendsHeatmap(trends);
  renderTrendsLanguages(trends);
}

function renderTrendsActivity(trends: TrendsViewModel) {
  const labels = trends.days.map(day => day.localDate.slice(5));
  trendsActivityChart = renderLineChart(
    trendsActivityChart,
    'trendsActivityChart',
    labels,
    [{
      label: 'Active hours',
      data: trends.days.map(day => day.activeTimeMs / 3_600_000),
      borderColor: colors[0],
      backgroundColor: colors[0],
      fill: false,
      tension: 0.2,
    }],
  );
  renderDataTable(
    'trends-activity-table',
    'Daily active time',
    EN.tableHeaders.dailyActivity,
    trends.days.map(day => [
      day.localDate,
      fmt(day.activeTimeMs / 1000),
      day.goalCompletionPercent === null
        ? EN.tasks.unavailable
        : `${formatDecimal(day.goalCompletionPercent)}%`,
    ]),
  );
}

function renderTrendsFlow(trends: TrendsViewModel) {
  const labels = trends.days.map(day => day.localDate.slice(5));
  trendsFlowChart = renderLineChart(
    trendsFlowChart,
    'trendsFlowChart',
    labels,
    [
      {
        label: 'Flow blocks',
        data: trends.days.map(day => day.flowBlockCount),
        borderColor: colors[1],
        backgroundColor: colors[1],
        tension: 0.2,
        yAxisID: 'y',
      },
      {
        label: 'File switches / active hour',
        data: trends.days.map(day => day.fileSwitchesPerActiveHour),
        borderColor: colors[4],
        backgroundColor: colors[4],
        tension: 0.2,
        yAxisID: 'ySwitches',
      },
    ],
    {
      ySwitches: {
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        position: 'right',
      },
    },
  );
  renderDataTable(
    'trends-flow-table',
    'Daily flow blocks and file switches',
    EN.tableHeaders.flow,
    trends.days.map(day => [
      day.localDate,
      String(day.flowBlockCount),
      day.fileSwitchesPerActiveHour === null
        ? EN.tasks.unavailable
        : formatDecimal(day.fileSwitchesPerActiveHour),
    ]),
  );
}

function renderTrendsLanguages(trends: TrendsViewModel) {
  const labels = trends.days.map(day => day.localDate.slice(5));
  trendsLanguageChart = renderLineChart(
    trendsLanguageChart,
    'trendsLanguageChart',
    labels,
    trends.languages.map((language, index) => ({
      label: language.id,
      data: language.dailyActiveTimeMs.map(value => value / 3_600_000),
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length],
      tension: 0.2,
    })),
  );
  const rows = [];
  trends.days.forEach((day, dayIndex) => {
    trends.languages.forEach(language => {
      rows.push([
        day.localDate,
        language.id,
        fmt(language.dailyActiveTimeMs[dayIndex] / 1000),
      ]);
    });
  });
  renderDataTable(
    'trends-language-table',
    'Daily active time by language',
    EN.tableHeaders.language,
    rows,
    EN.empty.noLanguageEvolution,
  );
}

function renderTrendsHeatmap(trends: TrendsViewModel) {
  const table = document.getElementById('trends-heatmap-table') as HTMLTableElement;
  table.replaceChildren();
  const caption = document.createElement('caption');
  caption.textContent = `Daily activity heatmap for ${trends.rangeLabel}`;
  table.append(caption);
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const weekHeader = document.createElement('th');
  weekHeader.scope = 'col';
  weekHeader.textContent = 'Week';
  headerRow.append(weekHeader);
  EN.dayNames.forEach(name => {
    const header = document.createElement('th');
    header.scope = 'col';
    header.textContent = name;
    headerRow.append(header);
  });
  head.append(headerRow);
  table.append(head);
  const body = document.createElement('tbody');
  let row = document.createElement('tr');
  let week = 1;
  row.append(weekCell(week));
  const firstDay = trends.days.length
    ? dateFromKey(trends.days[0].localDate).getDay()
    : 0;
  for (let index = 0; index < firstDay; index += 1) {
    row.append(emptyHeatCell());
  }
  trends.days.forEach((day, index) => {
    const weekday = dateFromKey(day.localDate).getDay();
    if (weekday === 0 && (index > 0 || firstDay > 0)) {
      while (row.children.length < 8) { row.append(emptyHeatCell()); }
      body.append(row);
      row = document.createElement('tr');
      week += 1;
      row.append(weekCell(week));
    }
    const cell = document.createElement('td');
    cell.className = `trend-heat-cell heat-${day.heatLevel}`;
    cell.textContent = day.localDate.slice(5);
    cell.title = `${day.localDate}: ${fmt(day.activeTimeMs / 1000)}`;
    cell.setAttribute('aria-label', cell.title);
    row.append(cell);
  });
  while (row.children.length < 8) { row.append(emptyHeatCell()); }
  body.append(row);
  table.append(body);
}

function weekCell(week: number) {
  const cell = document.createElement('th');
  cell.scope = 'row';
  cell.textContent = String(week);
  return cell;
}

function emptyHeatCell() {
  const cell = document.createElement('td');
  cell.className = 'trend-heat-cell empty-heat-cell';
  cell.setAttribute('aria-hidden', 'true');
  return cell;
}

function renderLineChart(chart, canvasId, labels, datasets, extraScales = {}) {
  const canvas = document.getElementById(canvasId);
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.options.scales = {
      x: { grid: { display: false } },
      y: { beginAtZero: true },
      ...extraScales,
    };
    chart.update('none');
    return chart;
  }
  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true },
        ...extraScales,
      },
      plugins: { legend: { position: 'bottom' } },
    },
  });
}

function renderDataTable(
  id,
  captionText,
  headers,
  rows,
  emptyText: string = EN.empty.noActivityInRange,
) {
  const table = document.getElementById(id) as HTMLTableElement;
  table.replaceChildren();
  const caption = document.createElement('caption');
  caption.textContent = captionText;
  table.append(caption);
  if (!rows.length) {
    const body = document.createElement('tbody');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = headers.length;
    cell.className = 'empty';
    cell.textContent = emptyText;
    row.append(cell);
    body.append(row);
    table.append(body);
    return;
  }
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach(text => {
    const header = document.createElement('th');
    header.scope = 'col';
    header.textContent = text;
    headerRow.append(header);
  });
  head.append(headerRow);
  table.append(head);
  const body = document.createElement('tbody');
  rows.forEach(values => {
    const row = document.createElement('tr');
    values.forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
  table.append(body);
}

function renderQuality() {
  if (!dashboardData) { return; }
  const workflow = buildWorkflowViewModel(
    dashboardData.current,
    runtimeIntegrationSettings,
    Boolean(selectedProjectId),
  );

  setText('w-current', workflow.diagnostics.totals.current);
  setText('w-introduced', workflow.diagnostics.totals.introduced);
  setText('w-resolved', workflow.diagnostics.totals.resolved);
  setText('w-peak', workflow.diagnostics.totals.peak);
  setText('w-edit-volume', compact(workflow.editVolume));
  setText('w-saves', workflow.saveEvents);
  setText(
    'w-saves-sub',
    workflow.savesPerActiveHour === null
      ? EN.workflow.savesDescription
      : `${formatDecimal(workflow.savesPerActiveHour)} ${EN.phrases.savesPerHour}`,
  );
  renderWorkflowDiagnostics(workflow.diagnostics.rows);
  renderWorkflowGit(workflow.git);
  renderWorkflowDebug(workflow.debug);
  renderWorkflowTasks(workflow.tasks);
}

function renderWorkflowDiagnostics(rows) {
  const labels = {
    error: EN.signals.errors,
    warning: EN.signals.warnings,
    info: EN.signals.info,
    hint: EN.signals.hints,
  };
  renderDataTable(
    'workflow-diagnostics-table',
    EN.panels.diagnosticSummary,
    EN.tableHeaders.diagnostics,
    rows.map(row => [
      labels[row.severity],
      String(row.current),
      String(row.introduced),
      String(row.resolved),
      String(row.peak),
    ]),
  );
}

function renderWorkflowGit(git) {
  setIntegrationState('workflow-git', git.state, workflowExplanation('git', git.state));
  setText('workflow-git-dirty', git.dirtyFiles);
  setText('workflow-git-branches', git.branchChanges);
  setText('workflow-git-commits', git.detectedCommits);
  renderBarList(
    'branch-list',
    Object.fromEntries(git.branches.map(branch => [branch.id, branch.activeTimeMs / 1000])),
    fmt,
    EN.empty.noBranchActivity,
  );
}

function renderWorkflowDebug(debug) {
  setIntegrationState('workflow-debug', debug.state, workflowExplanation('debug', debug.state));
  setText('workflow-debug-elapsed', fmt(debug.elapsedMs / 1000));
  setText('workflow-debug-active', fmt(debug.activeMs / 1000));
}

function renderWorkflowTasks(tasks) {
  setIntegrationState('workflow-tasks', tasks.state, workflowExplanation('tasks', tasks.state));
  setText('workflow-tasks-configured', tasks.configuredTaskCount);
  renderTaskSummaries(tasks.summaries);
}

function setIntegrationState(
  prefix: string,
  state: WorkflowIntegrationState,
  explanation: string,
) {
  const status = document.getElementById(`${prefix}-status`)!;
  status.textContent = integrationStatusLabel(state);
  status.dataset.state = state;
  document.getElementById(`${prefix}-explanation`)!.textContent = explanation;
  const data = document.getElementById(`${prefix}-data`) as HTMLElement;
  data.hidden = state === 'disabled' || state === 'unavailable' || state === 'no-repository';
}

function integrationStatusLabel(state: WorkflowIntegrationState): string {
  const labels = {
    disabled: EN.workflow.disabled,
    unavailable: EN.workflow.unavailable,
    'no-repository': EN.workflow.noRepository,
    'setup-required': EN.workflow.setupRequired,
    'no-data': EN.workflow.noData,
    available: EN.workflow.available,
  };
  return labels[state];
}

function workflowExplanation(
  integration: 'git' | 'debug' | 'tasks',
  state: WorkflowIntegrationState,
): string {
  if (state === 'disabled') {
    return integration === 'git'
      ? EN.workflow.gitDisabled
      : integration === 'debug'
        ? EN.workflow.debugDisabled
        : EN.workflow.tasksDisabled;
  }
  if (state === 'unavailable') { return EN.empty.integrationUnavailable; }
  if (state === 'no-repository') { return EN.empty.noRepository; }
  if (state === 'setup-required') { return EN.empty.tasksSetupRequired; }
  if (state === 'no-data') {
    return integration === 'git'
      ? EN.empty.gitNoData
      : integration === 'debug'
        ? EN.empty.debugNoData
        : EN.empty.tasksNoData;
  }
  return integration === 'git'
    ? EN.workflow.gitAvailable
    : integration === 'debug'
      ? EN.workflow.debugAvailable
      : EN.workflow.tasksAvailable;
}

function renderTaskSummaries(tasks) {
  const target = document.getElementById('task-runs');
  target.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = EN.empty.noTrackedTaskRuns;
    target.append(empty);
    return;
  }
  tasks.forEach(task => {
    const item = document.createElement('div');
    item.className = 'bar-row task-row';
    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = `${task.classification === 'build' ? EN.tasks.build : EN.tasks.test} · ${task.configuredName}`;
    label.title = task.configuredName;
    const value = document.createElement('div');
    value.className = 'value';
    const success = task.successRatePercent === null
      ? EN.tasks.unavailable
      : `${formatDecimal(task.successRatePercent)}%`;
    const median = task.medianDurationMs === null
      ? EN.tasks.unavailable
      : fmt(task.medianDurationMs / 1000);
    value.textContent = `${EN.tasks.successRate}: ${success} · ${EN.tasks.medianDuration}: ${median}`;
    item.title = `${task.runCount} runs; ${task.succeededRunCount} succeeded; ${task.failedRunCount} failed; ${task.cancelledRunCount} cancelled; ${task.unknownRunCount} unknown`;
    item.setAttribute(
      'aria-label',
      `${task.configuredName}: ${EN.tasks.successRate} ${success}, ${EN.tasks.medianDuration} ${median}`,
    );
    item.append(label, value);
    target.append(item);
  });
}

function renderGlobal() {
  if (!dashboardData) { return; }
  const projects = buildProjectsViewModel(
    dashboardData.current,
    projectPreferences,
    {
      search: projectSearch,
      sort: projectSort,
      showManaged: showManagedProjects,
    },
  );

  setText('g-time', fmt(dashboardData.current.metrics.activeTimeMs / 1000));
  setText('g-projects', projects.activeProjectCount);
  setText('g-managed', projects.managedProjectCount);
  setText('g-visible', projects.visibleProjects.length);
  setText('projects-result-count', `${projects.visibleProjects.length} / ${projects.projects.length}`);

  renderProjectTable(projects);
  renderProjectDetails(projects);
}

function sessionAsAgg() {
  const agg = emptyAgg();
  agg.seconds = rawSession.seconds;
  agg.focusSeconds = rawSession.focusSeconds;
  agg.idleSeconds = rawSession.idleSeconds;
  agg.debugSeconds = rawSession.debugSeconds;
  agg.insertedCharacters = rawSession.insertedCharacters;
  agg.removedCharacters = rawSession.removedCharacters;
  agg.insertedLineBreaksApprox = rawSession.insertedLineBreaksApprox;
  agg.removedLineBreaksApprox = rawSession.removedLineBreaksApprox;
  agg.editEvents = rawSession.editEvents;
  agg.largeEditEvents = rawSession.largeEditEvents;
  agg.saves = rawSession.saves;
  agg.contextSwitches = rawSession.contextSwitches;
  agg.gitDirtyFiles = rawSession.gitDirtyFiles;
  agg.diagnosticsBySeverity = rawSession.diagnosticsBySeverity;
  agg.flow = rawSession.flow;
  agg.languages = rawSession.languages;
  agg.activeTimeByDocumentMs = rawSession.activeTimeByDocumentMs;
  agg.branches = rawSession.branches;
  return agg;
}

function topThreeFileShare(agg) {
  if (!agg.seconds) { return 0; }
  const topFiles = mapToRows(agg.files).slice(0, 3).reduce((total, item) => total + item.value, 0);
  return Math.max(0, Math.min(100, Math.round((topFiles / agg.seconds) * 100)));
}

function editIntensity(agg) {
  const hours = agg.seconds / 3600;
  return hours > 0 ? Math.round((agg.insertedCharacters + agg.removedCharacters) / hours) : 0;
}

function churnRatio(agg) {
  const lineActivity = agg.insertedLineBreaksApprox + agg.removedLineBreaksApprox;
  return lineActivity > 0 ? Math.round((agg.removedLineBreaksApprox / lineActivity) * 100) : 0;
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

function renderOverviewTimeline(overview: OverviewViewModel) {
  const labels = overview.timeline.map(bucket => bucket.label);
  const values = overview.timeline.map(bucket => bucket.activeTimeMs / 60000);
  const canvas = document.getElementById('todayTrendChart');

  if (todayTrendChart) {
    todayTrendChart.data.labels = labels;
    todayTrendChart.data.datasets[0].data = values;
    todayTrendChart.update('none');
    return;
  }

  todayTrendChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: EN.chartLabels.activeMinutes,
        data: values,
        backgroundColor: colors[0],
        borderRadius: 2,
        barPercentage: 1,
        categoryPercentage: 1
      }]
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        y: { beginAtZero: true },
        x: {
          grid: { display: false },
          ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: item => fmt(Number(item.raw) * 60)
          }
        }
      }
    }
  });
}

function renderFocusProfile(overview: OverviewViewModel) {
  renderFocusMetric(
    'focus-files',
    overview.focusProfile.topThreeFileSharePercent,
    value => `${formatDecimal(value)}%`,
    EN.focusProfile.topThreeFilesDescription,
  );
  renderFocusMetric(
    'focus-switches',
    overview.focusProfile.fileSwitchesPerActiveHour,
    value => formatDecimal(value),
    EN.focusProfile.fileSwitchesDescription,
  );
  renderFocusMetric(
    'focus-flow',
    overview.focusProfile.typicalFlowActiveMs,
    value => fmt(value / 1000),
    EN.focusProfile.typicalFlowDescription,
  );
}

function renderFocusMetric(prefix, insight, formatter, description) {
  const available = insight.value !== null;
  setText(
    `${prefix}-value`,
    available ? formatter(insight.value) : EN.focusProfile.unavailable,
  );
  setText(
    `${prefix}-description`,
    available ? description : insight.metadata.unavailableWhen,
  );
  setText(`${prefix}-formula`, insight.metadata.formula);
}

function renderOverviewDistribution(
  id: string,
  rows: readonly OverviewDistributionValue[],
  emptyText: string,
) {
  const target = document.getElementById(id)!;
  target.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = emptyText;
    target.append(empty);
    return;
  }
  rows.slice(0, 8).forEach(row => {
    const item = document.createElement('div');
    item.className = 'bar-row distribution-row';
    item.setAttribute(
      'aria-label',
      `${row.label}: ${fmt(row.activeTimeMs / 1000)}, ${formatDecimal(row.sharePercent)}%`,
    );
    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = row.label;
    label.title = row.label;
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = `${fmt(row.activeTimeMs / 1000)} · ${formatDecimal(row.sharePercent)}%`;
    const track = document.createElement('progress');
    track.className = 'bar-track';
    track.max = 100;
    track.value = row.sharePercent;
    track.setAttribute('aria-hidden', 'true');
    item.append(label, value, track);
    target.append(item);
  });
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
      datasets: [{ label: EN.chartLabels.hours, data: values, backgroundColor: colors[0], borderRadius: 4 }]
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => fmt(Number(item.raw) * 3600) } } }
    }
  }));
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
  rows.forEach(row => {
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
    const track = document.createElement('progress');
    track.className = 'bar-track';
    track.max = max;
    track.value = row.value;
    track.setAttribute('aria-hidden', 'true');
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
  EN.tableHeaders.file.forEach(text => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    if (text !== EN.tableHeaders.file[0]) { th.className = 'text-right'; }
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

function renderProjectTable(projects: ProjectsViewModel) {
  const table = document.getElementById('global-projects-table')!;
  const rows = projects.visibleProjects;
  table.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = EN.tableHeaders.project.length;
    cell.className = 'empty';
    cell.textContent = EN.empty.noProjectsMatch;
    row.append(cell);
    table.append(row);
    return;
  }
  const header = document.createElement('tr');
  EN.tableHeaders.project.forEach(text => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    if (text !== EN.tableHeaders.project[0]) { th.className = 'text-right'; }
    header.append(th);
  });
  table.append(header);
  rows.forEach(item => {
    const row = document.createElement('tr');
    row.className = 'project-row';
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(item.id === selectedProjectId));
    row.addEventListener('click', () => selectProjectDetails(item.id));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectProjectDetails(item.id);
      }
    });
    const name = document.createElement('td');
    name.className = 'project-name-cell';
    const nameValue = document.createElement('strong');
    nameValue.textContent = item.displayName;
    name.append(nameValue);
    if (item.discriminator) {
      const discriminator = document.createElement('small');
      discriminator.textContent = `${item.canonicalName} · ${item.discriminator}`;
      name.append(discriminator);
    }
    const time = document.createElement('td');
    time.className = 'text-right';
    time.textContent = fmt(item.activeTimeMs / 1000);
    const trend = document.createElement('td');
    trend.className = 'text-right';
    trend.textContent = item.activityTrendPercent === null
      ? '—'
      : signedPercent(item.activityTrendPercent);
    trend.title = item.activityTrendPercent === null
      ? EN.projects.noTrend
      : 'Change between equal older and newer halves of this range';
    const lastActivity = document.createElement('td');
    lastActivity.textContent = item.lastActiveLocalDate ?? EN.projects.noLastActivity;
    const status = document.createElement('td');
    const statuses = document.createElement('div');
    statuses.className = 'project-statuses';
    projectStatusLabels(item).forEach(label => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = label;
      statuses.append(badge);
    });
    status.append(statuses);
    row.append(name, time, trend, lastActivity, status);
    table.append(row);
  });
}

function renderProjectDetails(projects: ProjectsViewModel) {
  let project = projects.projects.find(item => item.id === selectedProjectId);
  if (!project && projects.visibleProjects.length > 0) {
    project = projects.visibleProjects[0];
    selectedProjectId = project.id;
    persistDashboardState();
    renderProjectOptions();
  }
  const empty = document.getElementById('project-detail-empty')!;
  const detail = document.getElementById('project-detail')!;
  empty.hidden = Boolean(project);
  detail.hidden = !project;
  if (!project) { return; }
  setText('project-detail-name', project.displayName);
  setText('project-detail-canonical', project.canonicalName);
  setText('project-detail-id', project.id);
  setText('project-detail-time', fmt(project.activeTimeMs / 1000));
  setText('project-detail-edits', compact(project.editVolume));
  (document.getElementById('project-alias') as HTMLInputElement).value =
    project.preference.alias ?? '';
  (document.getElementById('project-archived') as HTMLInputElement).checked =
    project.preference.archived;
  (document.getElementById('project-excluded') as HTMLInputElement).checked =
    project.preference.excluded;
  renderDimensionList(
    'project-detail-languages',
    project.languages,
    EN.empty.noLanguagesInRange,
  );
  renderDimensionList(
    'project-detail-files',
    project.files,
    runtimeFileDetailAvailable
      ? EN.empty.noActiveFilesToday
      : EN.status.fileDetailUnavailable,
  );
}

function renderDimensionList(
  id: string,
  values: readonly { id: string; activeTimeMs: number }[],
  emptyText: string,
) {
  renderBarList(
    id,
    Object.fromEntries(values.map(value => [value.id, value.activeTimeMs / 1000])),
    fmt,
    emptyText,
  );
}

function selectProjectDetails(projectId: string) {
  selectedProjectId = projectId;
  persistDashboardState();
  renderProjectOptions();
  if (dashboardData) { renderGlobal(); }
}

function saveSelectedProjectPreference() {
  if (!selectedProjectId) { return; }
  const preference = normalizeProjectPreference({
    alias: (document.getElementById('project-alias') as HTMLInputElement).value,
    archived: (document.getElementById('project-archived') as HTMLInputElement).checked,
    excluded: (document.getElementById('project-excluded') as HTMLInputElement).checked,
  });
  projectPreferences = {
    ...projectPreferences,
    [selectedProjectId]: preference,
  };
  vscodeApi.postMessage({
    type: 'dashboard/set-project-preference',
    protocolVersion: initialData.protocolVersion,
    projectId: selectedProjectId,
    preference,
  });
  renderProjectOptions();
  if (dashboardData) { renderGlobal(); }
}

function projectStatusLabels(project: ProjectListItem): string[] {
  const labels: string[] = [];
  if (project.preference.archived) { labels.push(EN.projects.archived); }
  if (project.preference.excluded) { labels.push(EN.projects.excluded); }
  return labels.length ? labels : [EN.projects.active];
}

function shortProjectId(projectId: string): string {
  return projectId.length <= 8
    ? projectId
    : `${projectId.slice(0, 4)}…${projectId.slice(-4)}`;
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
      const level = max > 0 ? Math.ceil((seconds / max) * 5) : 0;
      cell.classList.add(`heat-${level}`);
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

function localDateKey(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function addLocalDays(localDate, offset) {
  const date = dateFromKey(localDate);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function isLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
  return localDateKey(dateFromKey(value)) === value;
}

function signedPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${formatDecimal(rounded)}%`;
}

function dayWord(value) {
  return value === 1 ? 'day' : 'days';
}
