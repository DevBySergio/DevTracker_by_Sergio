import {
  CurrentFlowMetrics,
  DiagnosticsBySeverity,
  EditorEditActivity,
  PersistenceHealth,
  ProjectData,
  SessionState,
  TrackingStatus,
} from "../domain/types";
import {
  DailyRollup,
  DiagnosticRollup,
  ProjectIdentity,
} from "../domain/schemaV2";
import {
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";
import { GitTrackingStatus } from "../domain/git";

export interface TrackingReader {
  getDailyGoal(): number;
  getWeeklyGoal(): number | null;
  getTodayTotalSeconds(): number;
  getSessionState(): SessionState;
  getAllProjects(): ProjectData[];
  getProjectData(projectPath: string): ProjectData;
  generateCSV(): string;
  getPersistenceHealth(): PersistenceHealth;
}

export interface TrackingWriter {
  addTime(
    projectPath: string,
    languageId: string,
    relativeFilePath: string,
    seconds: number,
    branch?: string,
    localDateKey?: string,
    trackLegacyFlow?: boolean,
    documentId?: string,
  ): void;
  addEditActivity(
    projectPath: string,
    activity: EditorEditActivity,
  ): void;
  addSave(projectPath: string): void;
  addIdleSeconds(projectPath: string, seconds: number): void;
  addDebugSeconds(projectPath: string, seconds: number): void;
  addContextSwitch(projectPath: string): void;
  addConfirmedContextSwitch(
    projectPath: string,
    projectSwitch: boolean,
    localDateKey: string,
  ): void;
  recordFlowBlock(projectPath: string, localDateKey: string): void;
  addFlowActiveTime(
    projectPath: string,
    durationMs: number,
    localDateKey: string,
  ): void;
  setCurrentFlowForDay(
    projectPath: string,
    currentFlowActiveMs: number,
    localDateKey: string,
  ): void;
  setCurrentFlowMetrics(metrics: CurrentFlowMetrics): void;
  setDiagnostics(
    projectPath: string,
    diagnostics: DiagnosticsBySeverity,
  ): void;
  setGitDirtyFiles(projectPath: string, count: number): void;
  setTrackingStatus(status: TrackingStatus, lastUpdatedAt: number): void;
  setDailyGoal(hours: number): void;
  setWeeklyGoal(hours: number | null): void;
  saveData(): Promise<void>;
  flush(): Promise<void>;
}

export interface TrackingStore extends TrackingReader, TrackingWriter {}

export interface ActivityIntervalObservation {
  projectId: string;
  localDate: string;
  documentId: string | null;
  languageId: string | null;
  gitBranch: string | null;
  startedAt: number;
  endedAt: number;
  monotonicStartedAt: number;
  monotonicEndedAt: number;
  lastInteractionAt: number;
}

export interface ActivityIntervalSink {
  recordActivityInterval(value: ActivityIntervalObservation): void;
  flush(): Promise<void>;
}

export interface DailyEditMetricObservation extends EditorEditActivity {
  projectId: string;
  localDate: string;
}

export interface DailyEventMetricObservation {
  projectId: string;
  localDate: string;
}

export interface DailyContextSwitchObservation
  extends DailyEventMetricObservation {
  projectSwitch: boolean;
}

export interface DailyFlowMetricObservation
  extends DailyEventMetricObservation {
  durationMs: number;
}

export interface DailyMetricSink {
  recordEditActivity(value: DailyEditMetricObservation): void;
  recordSave(value: DailyEventMetricObservation): void;
  recordContextSwitch(value: DailyContextSwitchObservation): void;
  recordFlowBlock(value: DailyEventMetricObservation): void;
  recordFlowActiveTime(value: DailyFlowMetricObservation): void;
  closeFlow(value: DailyEventMetricObservation): void;
  flush(): Promise<void>;
}

export interface GitState {
  status: GitTrackingStatus;
  repositoryUri: string | null;
  repositoryRootPath: string | null;
  branch: string | null;
  headCommit: string | null;
  dirtyFiles: number;
}

export interface GitStateChange {
  previous: GitState | null;
  current: GitState;
  branchChanged: boolean;
  commitDetected: boolean;
}

export interface GitMetricObservation {
  projectId: string;
  localDate: string;
  status: GitTrackingStatus;
  dirtyFiles: number;
  branchChanges: number;
  detectedCommits: number;
}

export interface GitMetricSink {
  recordGitMetrics(value: GitMetricObservation): void;
  flush(): Promise<void>;
}

export interface DiagnosticBucketObservation {
  projectId: string;
  bucketStartedAt: number;
  bucketEndedAt: number;
  observedAt: number;
  diagnostics: DiagnosticRollup;
}

export interface DiagnosticBucketSink {
  recordDiagnosticBucket(value: DiagnosticBucketObservation): void;
  flush(): Promise<void>;
}

export interface DebugMetricObservation {
  projectId: string;
  localDate: string;
  debugElapsedMs: number;
  debugActiveTimeMs: number;
}

export interface DebugMetricSink {
  recordDebugMetrics(value: DebugMetricObservation): void;
  flush(): Promise<void>;
}

export interface TrackingDocumentPrivacyDecision {
  excluded: boolean;
  documentIdentity: string | null;
}

export interface TrackingPrivacyPolicy {
  evaluateDocument(
    projectPath: string,
    documentPath: string,
  ): TrackingDocumentPrivacyDecision;
  isProjectExcluded(projectPath: string): boolean;
  isGitTrackingEnabled(): boolean;
  isDebugTrackingEnabled(): boolean;
  isTaskTrackingEnabled(): boolean;
  getDetailedDataRetentionDays(): number;
}

export interface DashboardSnapshot {
  session: SessionState;
  project?: ProjectData;
  projects: ProjectData[];
  dailyGoalSeconds: number;
  weeklyGoalSeconds: number | null;
  todayTotalSeconds: number;
  persistence: PersistenceHealth;
  trackingStatus: TrackingStatus;
  lastUpdatedAt: number;
  fileSwitchesPerActiveHour: number | null;
}

export interface DashboardQueryService {
  getSnapshot(projectPath?: string): DashboardSnapshot;
}

export interface GitAdapter {
  configure(enabled: boolean): Promise<void>;
  getState(resourcePath: string): GitState;
  onDidChange(listener: (change: GitStateChange) => void): { dispose(): void };
  dispose(): void;
}

export interface DashboardPresentation {
  update(snapshot: DashboardSnapshot): void;
  open(snapshot: DashboardSnapshot): void;
  dispose(): void;
}

export interface ProjectIdentityRegistry {
  getProjectIdentity(projectId: string): Promise<ProjectIdentity | undefined>;
  upsertProjectIdentity(project: ProjectIdentity): Promise<unknown>;
}

export interface DailyRollupRangeReader {
  listProjectIdentities(): Promise<ProjectIdentity[]>;
  readDailyRollups(
    projectIds: readonly string[],
    localDates: readonly string[],
  ): Promise<DailyRollup[]>;
  getRollupRevision(): number;
}

export interface RangeAnalyticsQueryService {
  query(request: RangeQueryRequest): Promise<RangeQueryViewModel>;
}
