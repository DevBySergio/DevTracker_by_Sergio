import { DiagnosticsBySeverity } from "./types";
import { GitTrackingStatus } from "./git";
import { TaskRunRecord } from "./tasks";

export const SCHEMA_VERSION = 2 as const;

export interface ProjectIdentity {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  canonicalUri: string;
  displayName: string;
  scheme: string;
  authority: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentIdentity {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  canonicalUri: string;
  projectId: string | null;
  scheme: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityInterval {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  sessionId: string;
  projectId: string;
  documentId: string | null;
  languageId: string | null;
  lastInteractionAt: number;
  startedAt: number;
  endedAt: number;
  monotonicStartedAt: number;
  monotonicEndedAt: number;
}

export type TrackingSessionState = "active" | "completed";

export interface TrackingSession {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  instanceId: string;
  state: TrackingSessionState;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  intervals: ActivityInterval[];
}

export interface DiagnosticRollup {
  current: DiagnosticsBySeverity;
  introduced: DiagnosticsBySeverity;
  resolved: DiagnosticsBySeverity;
  peak: DiagnosticsBySeverity;
}

export interface DiagnosticTimeBucket {
  bucketStartedAt: number;
  bucketEndedAt: number;
  observedAt: number;
  diagnostics: DiagnosticRollup;
}

export interface DailyRollup {
  schemaVersion: typeof SCHEMA_VERSION;
  projectId: string;
  localDate: string;
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
  gitStatus: GitTrackingStatus;
  gitDirtyFiles: number;
  gitBranchChanges: number;
  gitDetectedCommits: number;
  diagnostics: DiagnosticRollup;
  diagnosticBuckets: Record<string, DiagnosticTimeBucket>;
  activeTimeByLanguageMs: Record<string, number>;
  activeTimeByDocumentMs: Record<string, number>;
  activeTimeByQuarterHourMs: Record<string, number>;
  activeTimeByGitBranchMs: Record<string, number>;
  taskRuns: TaskRunRecord[];
  legacyApproximate: boolean;
  updatedAt: number;
}

export interface SchemaMetadataV2 {
  schemaVersion: typeof SCHEMA_VERSION;
  createdAt: number;
  updatedAt: number;
  projects: Record<string, ProjectIdentity>;
}

export function createEmptyDiagnostics(): DiagnosticsBySeverity {
  return { error: 0, warning: 0, info: 0, hint: 0 };
}

export function createEmptyDailyRollup(
  projectId: string,
  localDate: string,
  updatedAt: number,
): DailyRollup {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    localDate,
    activeTimeMs: 0,
    debugElapsedMs: 0,
    debugActiveTimeMs: 0,
    editEvents: 0,
    insertedCharacters: 0,
    removedCharacters: 0,
    largeEditEvents: 0,
    insertedLineBreaksApprox: 0,
    removedLineBreaksApprox: 0,
    saveEvents: 0,
    fileSwitchEvents: 0,
    projectSwitchEvents: 0,
    flowBlockCount: 0,
    flowActiveMs: 0,
    longestFlowActiveMs: 0,
    gitStatus: "disabled",
    gitDirtyFiles: 0,
    gitBranchChanges: 0,
    gitDetectedCommits: 0,
    diagnostics: {
      current: createEmptyDiagnostics(),
      introduced: createEmptyDiagnostics(),
      resolved: createEmptyDiagnostics(),
      peak: createEmptyDiagnostics(),
    },
    diagnosticBuckets: {},
    activeTimeByLanguageMs: {},
    activeTimeByDocumentMs: {},
    activeTimeByQuarterHourMs: {},
    activeTimeByGitBranchMs: {},
    taskRuns: [],
    legacyApproximate: false,
    updatedAt,
  };
}
