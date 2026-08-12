import { DiagnosticRollup } from "./schemaV2";
import { GitTrackingStatus } from "./git";

export type RangePreset =
  | "today"
  | "7-days"
  | "30-days"
  | "90-days"
  | "year"
  | "custom";

export interface RangeQueryRequest {
  preset: RangePreset;
  startLocalDate?: string;
  endLocalDate?: string;
  projectIds?: readonly string[];
  includeComparison?: boolean;
}

export interface NormalizedDateRange {
  startLocalDate: string;
  endLocalDate: string;
  localDates: string[];
  complete: boolean;
}

export interface NormalizedRangeQuery {
  current: NormalizedDateRange;
  comparison: NormalizedDateRange | null;
  projectIds: string[] | null;
  includeComparison: boolean;
}

export interface RangeAggregateMetrics {
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
  legacyApproximate: boolean;
}

export interface RangeDimensionValue {
  id: string;
  activeTimeMs: number;
}

export interface RangeQuarterHourBucket {
  key: string;
  localDate: string;
  label: string;
  utcOffsetMinutes: number;
  activeTimeMs: number;
}

export interface RangeDayViewModel {
  localDate: string;
  metrics: RangeAggregateMetrics;
}

export interface RangeProjectViewModel {
  project: { id: string; displayName: string };
  metrics: RangeAggregateMetrics;
  languages: RangeDimensionValue[];
  files: RangeDimensionValue[];
  branches: RangeDimensionValue[];
}

export interface RangePeriodViewModel {
  range: NormalizedDateRange;
  metrics: RangeAggregateMetrics;
  days: RangeDayViewModel[];
  projects: RangeProjectViewModel[];
  languages: RangeDimensionValue[];
  files: RangeDimensionValue[];
  branches: RangeDimensionValue[];
  quarterHours: RangeQuarterHourBucket[];
}

export type RangeComparisonStatus =
  | "available"
  | "not-requested"
  | "current-period-incomplete";

export interface RangeQueryViewModel {
  current: RangePeriodViewModel;
  comparison: RangePeriodViewModel | null;
  comparisonStatus: RangeComparisonStatus;
  revision: number;
}
