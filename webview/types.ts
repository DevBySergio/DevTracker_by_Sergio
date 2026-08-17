export type DashboardViewName = "today" | "project" | "quality" | "global";
export type DashboardRangeName =
  | "7-days"
  | "30-days"
  | "90-days"
  | "year"
  | "custom";
export type RangePreset =
  | "today"
  | "7-days"
  | "30-days"
  | "90-days"
  | "year"
  | "custom";

export interface DashboardInitialData {
  protocolVersion: number;
  currentProjectId: string | null;
  projects: Array<{ id: string; displayName: string }>;
  dailyGoalSeconds: number;
  trackingStatus: "active" | "inactive" | "paused" | "unfocused";
  lastUpdatedAt: number;
  fileDetailAvailable: boolean;
  projectPreferences: Record<string, ProjectPreference>;
  integrationSettings: DashboardIntegrationSettings;
}

export interface DashboardIntegrationSettings {
  gitTrackingEnabled: boolean;
  debugTrackingEnabled: boolean;
  taskTrackingEnabled: boolean;
  configuredTaskCount: number;
}

export interface ProjectPreference {
  alias: string | null;
  archived: boolean;
  excluded: boolean;
}

export interface DashboardTrackingStatusMessage {
  type: "dashboard/tracking-status";
  protocolVersion: number;
  status: DashboardInitialData["trackingStatus"];
  lastUpdatedAt: number;
  dailyGoalSeconds: number;
  fileDetailAvailable: boolean;
}

export interface DashboardProjectPreferencesMessage {
  type: "dashboard/project-preferences";
  protocolVersion: number;
  preferences: Record<string, ProjectPreference>;
}

export interface DashboardIntegrationSettingsMessage {
  type: "dashboard/integration-settings";
  protocolVersion: number;
  settings: DashboardIntegrationSettings;
}

export interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
  hint: number;
}

export interface RangeMetrics {
  activeTimeMs: number;
  debugElapsedMs: number;
  debugActiveTimeMs: number;
  editEvents: number;
  insertedCharacters: number;
  removedCharacters: number;
  largeEditEvents: number;
  insertedLineBreaksApprox: number;
  removedLineBreaksApprox: number;
  saveEvents: number;
  fileSwitchEvents: number;
  projectSwitchEvents: number;
  flowBlockCount: number;
  flowActiveMs: number;
  longestFlowActiveMs: number;
  gitStatus: "disabled" | "unavailable" | "no-repository" | "available";
  gitDirtyFiles: number;
  gitBranchChanges: number;
  gitDetectedCommits: number;
  diagnostics: {
    current: SeverityCounts;
    introduced: SeverityCounts;
    resolved: SeverityCounts;
    peak: SeverityCounts;
  };
  legacyApproximate: boolean;
}

export interface RangeDimensionValue {
  id: string;
  activeTimeMs: number;
}

export interface RangeTaskSummary {
  configuredName: string;
  classification: "build" | "test";
  runCount: number;
  completedRunCount: number;
  succeededRunCount: number;
  failedRunCount: number;
  cancelledRunCount: number;
  unknownRunCount: number;
  successRatePercent: number | null;
  medianDurationMs: number | null;
}

export interface RangeDayViewModel {
  localDate: string;
  metrics: RangeMetrics;
  languages: RangeDimensionValue[];
}

export interface RangeProjectViewModel {
  project: { id: string; displayName: string };
  metrics: RangeMetrics;
  lastActiveLocalDate?: string | null;
  activityTrendPercent?: number | null;
  languages: RangeDimensionValue[];
  files: RangeDimensionValue[];
  branches: RangeDimensionValue[];
  tasks: RangeTaskSummary[];
}

export interface RangeQuarterHourBucket {
  key: string;
  localDate: string;
  label: string;
  utcOffsetMinutes: number;
  activeTimeMs: number;
}

export interface RangePeriodViewModel {
  range: {
    startLocalDate: string;
    endLocalDate: string;
    localDates: string[];
    complete: boolean;
  };
  metrics: RangeMetrics;
  days: RangeDayViewModel[];
  projects: RangeProjectViewModel[];
  languages: RangeDimensionValue[];
  files: RangeDimensionValue[];
  branches: RangeDimensionValue[];
  tasks: RangeTaskSummary[];
  quarterHours: RangeQuarterHourBucket[];
}

export interface RangeQueryViewModel {
  current: RangePeriodViewModel;
  comparison: RangePeriodViewModel | null;
  comparisonStatus:
    | "available"
    | "not-requested"
    | "current-period-incomplete";
  revision: number;
}

export interface CollectionDelta<T> {
  upsert: T[];
  remove: string[];
}

export interface RangePeriodDelta {
  range: RangePeriodViewModel["range"] | null;
  metrics: RangeMetrics | null;
  days: CollectionDelta<RangeDayViewModel> | null;
  projects: CollectionDelta<RangeProjectViewModel> | null;
  languages: CollectionDelta<RangeDimensionValue> | null;
  files: CollectionDelta<RangeDimensionValue> | null;
  branches: CollectionDelta<RangeDimensionValue> | null;
  tasks: CollectionDelta<RangeTaskSummary> | null;
  quarterHours: CollectionDelta<RangeQuarterHourBucket> | null;
}

export interface RangeViewModelDelta {
  current: RangePeriodDelta;
  comparison:
    | { kind: "unchanged" }
    | { kind: "replace"; value: RangePeriodViewModel | null }
    | { kind: "patch"; value: RangePeriodDelta };
  comparisonStatus: RangeQueryViewModel["comparisonStatus"] | null;
}

export interface DashboardSnapshotMessage {
  type: "dashboard/snapshot";
  protocolVersion: number;
  requestId: string;
  view: DashboardViewName;
  data: RangeQueryViewModel;
}

export interface DashboardLiveDeltaMessage {
  type: "dashboard/live-delta";
  protocolVersion: number;
  requestId: string;
  view: DashboardViewName;
  baseRevision: number;
  revision: number;
  delta: RangeViewModelDelta;
}

export interface DashboardErrorMessage {
  type: "dashboard/error";
  protocolVersion: number;
  requestId: string | null;
  view: DashboardViewName | null;
  code: string;
  message: string;
  limitBytes: number | null;
  actualBytes: number | null;
}

export type DashboardResponseMessage =
  | DashboardSnapshotMessage
  | DashboardLiveDeltaMessage
  | DashboardErrorMessage
  | DashboardTrackingStatusMessage
  | DashboardProjectPreferencesMessage
  | DashboardIntegrationSettingsMessage;
