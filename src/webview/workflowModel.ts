import {
  RangeAggregateMetrics,
  RangeDimensionValue,
  RangePeriodViewModel,
  RangeTaskSummary,
} from "../domain/rangeQuery";

export interface DashboardIntegrationSettings {
  gitTrackingEnabled: boolean;
  debugTrackingEnabled: boolean;
  taskTrackingEnabled: boolean;
  configuredTaskCount: number;
}

export type WorkflowIntegrationState =
  | "disabled"
  | "unavailable"
  | "no-repository"
  | "setup-required"
  | "no-data"
  | "available";

export interface WorkflowDiagnosticsRow {
  severity: keyof RangeAggregateMetrics["diagnostics"]["current"];
  current: number;
  introduced: number;
  resolved: number;
  peak: number;
}

export interface WorkflowViewModel {
  diagnostics: {
    rows: WorkflowDiagnosticsRow[];
    totals: {
      current: number;
      introduced: number;
      resolved: number;
      peak: number;
    };
  };
  editVolume: number;
  saveEvents: number;
  savesPerActiveHour: number | null;
  git: {
    state: WorkflowIntegrationState;
    dirtyFiles: number;
    branchChanges: number;
    detectedCommits: number;
    branches: readonly RangeDimensionValue[];
  };
  debug: {
    state: WorkflowIntegrationState;
    elapsedMs: number;
    activeMs: number;
  };
  tasks: {
    state: WorkflowIntegrationState;
    configuredTaskCount: number;
    summaries: readonly RangeTaskSummary[];
  };
}

const SEVERITIES: WorkflowDiagnosticsRow["severity"][] = [
  "error",
  "warning",
  "info",
  "hint",
];

export function buildWorkflowViewModel(
  period: RangePeriodViewModel,
  settings: DashboardIntegrationSettings,
  projectSelected = true,
): WorkflowViewModel {
  const metrics = period.metrics;
  const rows = SEVERITIES.map((severity) => ({
    severity,
    current: metrics.diagnostics.current[severity],
    introduced: metrics.diagnostics.introduced[severity],
    resolved: metrics.diagnostics.resolved[severity],
    peak: metrics.diagnostics.peak[severity],
  }));
  const activeHours = metrics.activeTimeMs / 3_600_000;

  return {
    diagnostics: {
      rows,
      totals: {
        current: sum(rows, "current"),
        introduced: sum(rows, "introduced"),
        resolved: sum(rows, "resolved"),
        peak: sum(rows, "peak"),
      },
    },
    editVolume: metrics.insertedCharacters + metrics.removedCharacters,
    saveEvents: metrics.saveEvents,
    savesPerActiveHour: activeHours > 0
      ? metrics.saveEvents / activeHours
      : null,
    git: {
      state: gitState(period, settings, projectSelected),
      dirtyFiles: metrics.gitDirtyFiles,
      branchChanges: metrics.gitBranchChanges,
      detectedCommits: metrics.gitDetectedCommits,
      branches: period.branches,
    },
    debug: {
      state: integrationState(
        settings.debugTrackingEnabled,
        projectSelected,
        metrics.debugElapsedMs > 0 || metrics.debugActiveTimeMs > 0,
      ),
      elapsedMs: metrics.debugElapsedMs,
      activeMs: metrics.debugActiveTimeMs,
    },
    tasks: {
      state: taskState(period, settings, projectSelected),
      configuredTaskCount: settings.configuredTaskCount,
      summaries: period.tasks,
    },
  };
}

function sum(
  rows: readonly WorkflowDiagnosticsRow[],
  field: "current" | "introduced" | "resolved" | "peak",
): number {
  return rows.reduce((total, row) => total + row[field], 0);
}

function integrationState(
  enabled: boolean,
  projectSelected: boolean,
  hasData: boolean,
): WorkflowIntegrationState {
  if (!projectSelected) {
    return "unavailable";
  }
  if (!enabled) {
    return "disabled";
  }
  return hasData ? "available" : "no-data";
}

function gitState(
  period: RangePeriodViewModel,
  settings: DashboardIntegrationSettings,
  projectSelected: boolean,
): WorkflowIntegrationState {
  if (!projectSelected) {
    return "unavailable";
  }
  if (!settings.gitTrackingEnabled) {
    return "disabled";
  }
  if (period.metrics.gitStatus === "unavailable" ||
      period.metrics.gitStatus === "disabled") {
    return "unavailable";
  }
  if (period.metrics.gitStatus === "no-repository") {
    return "no-repository";
  }
  const hasData = period.branches.length > 0 ||
    period.metrics.gitDirtyFiles > 0 ||
    period.metrics.gitBranchChanges > 0 ||
    period.metrics.gitDetectedCommits > 0;
  return hasData ? "available" : "no-data";
}

function taskState(
  period: RangePeriodViewModel,
  settings: DashboardIntegrationSettings,
  projectSelected: boolean,
): WorkflowIntegrationState {
  if (!projectSelected) {
    return "unavailable";
  }
  if (!settings.taskTrackingEnabled) {
    return "disabled";
  }
  if (settings.configuredTaskCount === 0) {
    return "setup-required";
  }
  return period.tasks.length > 0 ? "available" : "no-data";
}
