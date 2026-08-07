export interface LanguageData {
  name: string;
  seconds: number;
}

/** Canonical editor observations emitted by one accepted document-change event. */
export interface EditorEditActivity {
  insertedCharacters: number;
  removedCharacters: number;
  largeEditEvents: 0 | 1;
  insertedLineBreaksApprox: number;
  removedLineBreaksApprox: number;
}

/**
 * V1 compatibility fields. New activity must not be written to these aliases;
 * they are retained only so an imported v1 snapshot can be normalized.
 */
export interface LegacyEditorMetricAliases {
  /** @deprecated V1 could not distinguish inserted and removed characters. */
  keystrokes: number;
  /** @deprecated Use `insertedLineBreaksApprox`. */
  linesAdded: number;
  /** @deprecated Use `removedLineBreaksApprox`. */
  linesDeleted: number;
  /** @deprecated Use `largeEditEvents`. */
  pasteEvents: number;
  /** @deprecated V1 mixed active-time samples and edit events. */
  filesTouched: { [filePath: string]: number };
}

export interface DayData extends LegacyEditorMetricAliases {
  date: string;
  seconds: number;
  languages: { [key: string]: LanguageData };
  hours: { [hour: string]: number };
  /** @deprecated V1 active-time distribution keyed by relative file path. */
  files: { [filePath: string]: number };
  editEvents: number;
  insertedCharacters?: number;
  removedCharacters?: number;
  largeEditEvents?: number;
  insertedLineBreaksApprox?: number;
  removedLineBreaksApprox?: number;
  activeTimeByDocumentMs?: { [documentId: string]: number };
  saves: number;
  focusSeconds: number;
  idleSeconds: number;
  debugSeconds: number;
  diagnosticsBySeverity: DiagnosticsBySeverity;
  contextSwitches: number;
  fileSwitchEvents?: number;
  projectSwitchEvents?: number;
  flowBlockCount?: number;
  flowActiveMs?: number;
  longestFlowActiveMs?: number;
  currentFlowActiveMs?: number;
  branches: { [branch: string]: number };
  gitDirtyFiles: number;
  flow: FlowData;
}

export interface ProjectData {
  name: string;
  path: string;
  days: { [date: string]: DayData };
}

export interface GlobalData {
  projects: { [path: string]: ProjectData };
  dailyGoal: number;
  weeklyGoal?: number;
}

export interface SessionState extends LegacyEditorMetricAliases {
  startTime: number;
  trackingStatus: TrackingStatus;
  lastUpdatedAt: number;
  seconds: number;
  languages: { [key: string]: number };
  editEvents: number;
  insertedCharacters: number;
  removedCharacters: number;
  largeEditEvents: number;
  insertedLineBreaksApprox: number;
  removedLineBreaksApprox: number;
  activeTimeByDocumentMs: { [documentId: string]: number };
  saves: number;
  focusSeconds: number;
  idleSeconds: number;
  debugSeconds: number;
  diagnosticsBySeverity: DiagnosticsBySeverity;
  contextSwitches: number;
  fileSwitchEvents: number;
  projectSwitchEvents: number;
  flowBlockCount: number;
  flowActiveMs: number;
  longestFlowActiveMs: number;
  currentFlowActiveMs: number;
  branches: { [branch: string]: number };
  gitDirtyFiles: number;
  flow: FlowData;
}

export type TrackingStatus =
  | "active"
  | "inactive"
  | "paused"
  | "unfocused";

export interface DiagnosticsBySeverity {
  error: number;
  warning: number;
  info: number;
  hint: number;
}

export interface FlowData {
  count: number;
  totalSeconds: number;
  longestSeconds: number;
  currentSeconds: number;
}

export interface CurrentFlowMetrics {
  flowBlockCount: number;
  flowActiveMs: number;
  longestFlowActiveMs: number;
  currentFlowActiveMs: number;
}

export type PersistenceStatus = "idle" | "pending" | "writing" | "failed";

export interface PersistenceHealth {
  status: PersistenceStatus;
  pendingWrites: number;
  lastSuccessfulWriteAt: number | null;
  lastError: string | null;
}
