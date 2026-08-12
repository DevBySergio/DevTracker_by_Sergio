import {
  NormalizedDateRange,
  RangeAggregateMetrics,
  RangeDayViewModel,
  RangeDimensionValue,
  RangePeriodViewModel,
  RangeProjectViewModel,
  RangeQuarterHourBucket,
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";

export const EXPORT_FORMAT_VERSION = 1 as const;
export const EXPORT_DATA_SCHEMA_VERSION = 2 as const;

export type ExportMetricPrecision =
  | "exact-event-count"
  | "monotonic-duration"
  | "current-snapshot"
  | "derived"
  | "editor-approximation"
  | "legacy-approximation";

export interface ExportMetricDefinition {
  name: string;
  unit: string;
  precision: ExportMetricPrecision;
}

export const EXPORT_METRIC_DEFINITIONS: readonly ExportMetricDefinition[] = [
  metric("activeTimeMs", "milliseconds", "monotonic-duration"),
  metric("debugElapsedMs", "milliseconds", "monotonic-duration"),
  metric("debugActiveTimeMs", "milliseconds", "monotonic-duration"),
  metric("editEvents", "events", "exact-event-count"),
  metric("insertedCharacters", "UTF-16 code units", "exact-event-count"),
  metric("removedCharacters", "UTF-16 code units", "exact-event-count"),
  metric("largeEditEvents", "events", "exact-event-count"),
  metric(
    "insertedLineBreaksApprox",
    "line breaks",
    "editor-approximation",
  ),
  metric(
    "removedLineBreaksApprox",
    "line breaks",
    "editor-approximation",
  ),
  metric("saveEvents", "events", "exact-event-count"),
  metric("fileSwitchEvents", "confirmed switches", "exact-event-count"),
  metric("projectSwitchEvents", "confirmed switches", "exact-event-count"),
  metric("flowBlockCount", "blocks", "derived"),
  metric("flowActiveMs", "milliseconds", "monotonic-duration"),
  metric("longestFlowActiveMs", "milliseconds", "derived"),
  metric("gitStatus", "state", "current-snapshot"),
  metric("gitDirtyFiles", "files", "current-snapshot"),
  metric("gitBranchChanges", "events", "exact-event-count"),
  metric("gitDetectedCommits", "commits", "exact-event-count"),
  metric("diagnostics.current.error", "diagnostics", "current-snapshot"),
  metric("diagnostics.current.warning", "diagnostics", "current-snapshot"),
  metric("diagnostics.current.info", "diagnostics", "current-snapshot"),
  metric("diagnostics.current.hint", "diagnostics", "current-snapshot"),
  metric("diagnostics.introduced.error", "diagnostics", "derived"),
  metric("diagnostics.introduced.warning", "diagnostics", "derived"),
  metric("diagnostics.introduced.info", "diagnostics", "derived"),
  metric("diagnostics.introduced.hint", "diagnostics", "derived"),
  metric("diagnostics.resolved.error", "diagnostics", "derived"),
  metric("diagnostics.resolved.warning", "diagnostics", "derived"),
  metric("diagnostics.resolved.info", "diagnostics", "derived"),
  metric("diagnostics.resolved.hint", "diagnostics", "derived"),
  metric("diagnostics.peak.error", "diagnostics", "derived"),
  metric("diagnostics.peak.warning", "diagnostics", "derived"),
  metric("diagnostics.peak.info", "diagnostics", "derived"),
  metric("diagnostics.peak.hint", "diagnostics", "derived"),
  metric("legacyApproximate", "boolean", "legacy-approximation"),
] as const;

export type ExportScope =
  | { kind: "selected-range"; request: RangeQueryRequest }
  | { kind: "complete-history" };

/**
 * Deliberately narrower than the persistence layer. The application can adapt
 * its range query service without exposing stored observations to exports.
 */
export interface ExportDataSource {
  queryRange(request: RangeQueryRequest): Promise<RangeQueryViewModel>;
  queryCompleteHistory(): Promise<RangeQueryViewModel>;
}

export interface DevTrackerJsonExportV1 {
  format: "devtracker-json-export";
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  dataSchemaVersion: typeof EXPORT_DATA_SCHEMA_VERSION;
  scope:
    | { kind: "selected-range"; request: RangeQueryRequest }
    | { kind: "complete-history" };
  metricDefinitions: ExportMetricDefinition[];
  data: RangeQueryViewModel;
}

export class ExportValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExportValidationError";
  }
}

const CSV_HEADERS = [
  "Local Date",
  "Active Time (milliseconds)",
  "Debug Elapsed Time (milliseconds)",
  "Active Time While Debugging (milliseconds)",
  "Edit Events (count)",
  "Inserted Characters (UTF-16 code units)",
  "Removed Characters (UTF-16 code units)",
  "Large Edit Events (count)",
  "Inserted Line Breaks (approximate count)",
  "Removed Line Breaks (approximate count)",
  "Save Events (count)",
  "File Switch Events (confirmed count)",
  "Project Switch Events (confirmed count)",
  "Flow Blocks (count)",
  "Flow Active Time (milliseconds)",
  "Longest Flow Active Time (milliseconds)",
  "Git Status",
  "Git Dirty Files (current count)",
  "Git Branch Changes (count)",
  "Git Detected Commits (count)",
  "Current Diagnostics - Errors (count)",
  "Current Diagnostics - Warnings (count)",
  "Current Diagnostics - Information (count)",
  "Current Diagnostics - Hints (count)",
  "Introduced Diagnostics - Errors (count)",
  "Introduced Diagnostics - Warnings (count)",
  "Introduced Diagnostics - Information (count)",
  "Introduced Diagnostics - Hints (count)",
  "Resolved Diagnostics - Errors (count)",
  "Resolved Diagnostics - Warnings (count)",
  "Resolved Diagnostics - Information (count)",
  "Resolved Diagnostics - Hints (count)",
  "Peak Diagnostics - Errors (count)",
  "Peak Diagnostics - Warnings (count)",
  "Peak Diagnostics - Information (count)",
  "Peak Diagnostics - Hints (count)",
  "Legacy Approximate (boolean)",
] as const;

const FORMULA_PREFIX = /^\s*[=+\-@\t\r]/u;
const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/u;
const URI_WITH_AUTHORITY = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//u;

export class ExportService {
  public constructor(private readonly dataSource: ExportDataSource) {}

  public async exportJson(scope: ExportScope): Promise<string> {
    const data = normalizeView(await this.load(scope));
    const payload: DevTrackerJsonExportV1 = {
      format: "devtracker-json-export",
      formatVersion: EXPORT_FORMAT_VERSION,
      dataSchemaVersion: EXPORT_DATA_SCHEMA_VERSION,
      scope: normalizeScope(scope),
      metricDefinitions: EXPORT_METRIC_DEFINITIONS.map((definition) => ({
        ...definition,
      })),
      data,
    };

    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  public async exportDailySummaryCsv(scope: ExportScope): Promise<string> {
    const data = normalizeView(await this.load(scope));
    const rows: readonly (readonly CsvCell[])[] = [
      CSV_HEADERS,
      ...data.current.days.map(dayToCsvRow),
    ];

    return `\uFEFF${rows.map(csvRow).join("\r\n")}\r\n`;
  }

  private load(scope: ExportScope): Promise<RangeQueryViewModel> {
    if (scope.kind === "complete-history") {
      return this.dataSource.queryCompleteHistory();
    }

    return this.dataSource.queryRange(scope.request);
  }
}

type CsvCell = string | number | boolean;

/** RFC 4180 quoting plus spreadsheet formula neutralization for text cells. */
export function encodeCsvCell(value: CsvCell): string {
  let rendered = String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(rendered)) {
    rendered = `'${rendered}`;
  }

  return `"${rendered.replace(/"/gu, '""')}"`;
}

function csvRow(cells: readonly CsvCell[]): string {
  return cells.map(encodeCsvCell).join(",");
}

function dayToCsvRow(day: RangeDayViewModel): CsvCell[] {
  const { metrics } = day;
  return [
    day.localDate,
    metrics.activeTimeMs,
    metrics.debugElapsedMs,
    metrics.debugActiveTimeMs,
    metrics.editEvents,
    metrics.insertedCharacters,
    metrics.removedCharacters,
    metrics.largeEditEvents,
    metrics.insertedLineBreaksApprox,
    metrics.removedLineBreaksApprox,
    metrics.saveEvents,
    metrics.fileSwitchEvents,
    metrics.projectSwitchEvents,
    metrics.flowBlockCount,
    metrics.flowActiveMs,
    metrics.longestFlowActiveMs,
    metrics.gitStatus,
    metrics.gitDirtyFiles,
    metrics.gitBranchChanges,
    metrics.gitDetectedCommits,
    metrics.diagnostics.current.error,
    metrics.diagnostics.current.warning,
    metrics.diagnostics.current.info,
    metrics.diagnostics.current.hint,
    metrics.diagnostics.introduced.error,
    metrics.diagnostics.introduced.warning,
    metrics.diagnostics.introduced.info,
    metrics.diagnostics.introduced.hint,
    metrics.diagnostics.resolved.error,
    metrics.diagnostics.resolved.warning,
    metrics.diagnostics.resolved.info,
    metrics.diagnostics.resolved.hint,
    metrics.diagnostics.peak.error,
    metrics.diagnostics.peak.warning,
    metrics.diagnostics.peak.info,
    metrics.diagnostics.peak.hint,
    metrics.legacyApproximate,
  ];
}

function normalizeScope(scope: ExportScope): DevTrackerJsonExportV1["scope"] {
  if (scope.kind === "complete-history") {
    return { kind: "complete-history" };
  }

  const request: RangeQueryRequest = { preset: scope.request.preset };
  if (scope.request.startLocalDate !== undefined) {
    request.startLocalDate = scope.request.startLocalDate;
  }
  if (scope.request.endLocalDate !== undefined) {
    request.endLocalDate = scope.request.endLocalDate;
  }
  if (scope.request.projectIds !== undefined) {
    request.projectIds = [...scope.request.projectIds].sort(compareText);
  }
  if (scope.request.includeComparison !== undefined) {
    request.includeComparison = scope.request.includeComparison;
  }

  return { kind: "selected-range", request };
}

function normalizeView(source: RangeQueryViewModel): RangeQueryViewModel {
  return {
    current: normalizePeriod(source.current),
    comparison:
      source.comparison === null ? null : normalizePeriod(source.comparison),
    comparisonStatus: source.comparisonStatus,
    revision: source.revision,
  };
}

function normalizePeriod(source: RangePeriodViewModel): RangePeriodViewModel {
  return {
    range: cloneRange(source.range),
    metrics: cloneMetrics(source.metrics),
    days: source.days
      .map((day) => ({
        localDate: day.localDate,
        metrics: cloneMetrics(day.metrics),
      }))
      .sort((left, right) => compareText(left.localDate, right.localDate)),
    projects: source.projects
      .map(cloneProject)
      .sort(
        (left, right) =>
          compareText(left.project.displayName, right.project.displayName) ||
          compareText(left.project.id, right.project.id),
      ),
    languages: cloneDimensions(source.languages),
    files: cloneDimensions(source.files),
    branches: cloneDimensions(source.branches),
    quarterHours: source.quarterHours
      .map(cloneQuarterHour)
      .sort(
        (left, right) =>
          compareText(left.localDate, right.localDate) ||
          compareText(left.key, right.key) ||
          left.utcOffsetMinutes - right.utcOffsetMinutes,
      ),
  };
}

function cloneRange(source: NormalizedDateRange): NormalizedDateRange {
  return {
    startLocalDate: source.startLocalDate,
    endLocalDate: source.endLocalDate,
    localDates: [...source.localDates].sort(compareText),
    complete: source.complete,
  };
}

function cloneProject(source: RangeProjectViewModel): RangeProjectViewModel {
  assertNoAbsolutePath(source.project.id, "project id");
  assertNoAbsolutePath(source.project.displayName, "project display name");
  return {
    project: {
      id: source.project.id,
      displayName: source.project.displayName,
    },
    metrics: cloneMetrics(source.metrics),
    languages: cloneDimensions(source.languages),
    files: cloneDimensions(source.files),
    branches: cloneDimensions(source.branches),
  };
}

function cloneDimensions(
  source: readonly RangeDimensionValue[],
): RangeDimensionValue[] {
  return source
    .map((value) => {
      assertNoAbsolutePath(value.id, "dimension id");
      return { id: value.id, activeTimeMs: value.activeTimeMs };
    })
    .sort(
      (left, right) =>
        compareText(left.id, right.id) || left.activeTimeMs - right.activeTimeMs,
    );
}

function cloneQuarterHour(
  source: RangeQuarterHourBucket,
): RangeQuarterHourBucket {
  return {
    key: source.key,
    localDate: source.localDate,
    label: source.label,
    utcOffsetMinutes: source.utcOffsetMinutes,
    activeTimeMs: source.activeTimeMs,
  };
}

function cloneMetrics(source: RangeAggregateMetrics): RangeAggregateMetrics {
  return {
    activeTimeMs: source.activeTimeMs,
    debugElapsedMs: source.debugElapsedMs,
    debugActiveTimeMs: source.debugActiveTimeMs,
    editEvents: source.editEvents,
    insertedCharacters: source.insertedCharacters,
    removedCharacters: source.removedCharacters,
    largeEditEvents: source.largeEditEvents,
    insertedLineBreaksApprox: source.insertedLineBreaksApprox,
    removedLineBreaksApprox: source.removedLineBreaksApprox,
    saveEvents: source.saveEvents,
    fileSwitchEvents: source.fileSwitchEvents,
    projectSwitchEvents: source.projectSwitchEvents,
    flowBlockCount: source.flowBlockCount,
    flowActiveMs: source.flowActiveMs,
    longestFlowActiveMs: source.longestFlowActiveMs,
    gitStatus: source.gitStatus,
    gitDirtyFiles: source.gitDirtyFiles,
    gitBranchChanges: source.gitBranchChanges,
    gitDetectedCommits: source.gitDetectedCommits,
    diagnostics: {
      current: { ...source.diagnostics.current },
      introduced: { ...source.diagnostics.introduced },
      resolved: { ...source.diagnostics.resolved },
      peak: { ...source.diagnostics.peak },
    },
    legacyApproximate: source.legacyApproximate,
  };
}

function assertNoAbsolutePath(value: string, field: string): void {
  if (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("~\\") ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    URI_WITH_AUTHORITY.test(value)
  ) {
    throw new ExportValidationError(
      `Refusing to export an absolute path from ${field}.`,
    );
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function metric(
  name: string,
  unit: string,
  precision: ExportMetricPrecision,
): ExportMetricDefinition {
  return { name, unit, precision };
}
