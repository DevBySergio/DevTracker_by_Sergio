import {
  NormalizedDateRange,
  NormalizedRangeQuery,
  RangeAggregateMetrics,
  RangeDayViewModel,
  RangeDimensionValue,
  RangePeriodViewModel,
  RangeProjectViewModel,
  RangeQueryRequest,
  RangeQueryViewModel,
  RangeQuarterHourBucket,
} from "../domain/rangeQuery";
import {
  DailyRollup,
  DiagnosticRollup,
  ProjectIdentity,
  createEmptyDiagnostics,
} from "../domain/schemaV2";
import { Clock } from "../platform/ports";

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const ADDITIVE_FIELDS = [
  "activeTimeMs",
  "debugElapsedMs",
  "debugActiveTimeMs",
  "editEvents",
  "insertedCharacters",
  "removedCharacters",
  "largeEditEvents",
  "insertedLineBreaksApprox",
  "removedLineBreaksApprox",
  "saveEvents",
  "fileSwitchEvents",
  "projectSwitchEvents",
  "flowBlockCount",
  "flowActiveMs",
] as const;
const SEVERITIES = ["error", "warning", "info", "hint"] as const;

export interface RangeQueryDelta {
  upsert?: readonly DailyRollup[];
  remove?: readonly { projectId: string; localDate: string }[];
}

export interface RangeQueryEngineStats {
  revision: number;
  cacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
  recordLookups: number;
}

/**
 * Indexed, pure range aggregation. Queries touch only requested date/project
 * keys; applying a rollup delta invalidates cached view models.
 */
export class RangeQueryEngine {
  private readonly rollups = new Map<string, DailyRollup>();
  private readonly rollupsByDate = new Map<string, Map<string, DailyRollup>>();
  private readonly projects = new Map<string, ProjectIdentity>();
  private readonly cache = new Map<string, RangeQueryViewModel>();
  private revision = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private recordLookups = 0;

  constructor(private readonly clock: Clock) {}

  public setProjectIdentities(values: readonly ProjectIdentity[]): void {
    const next = new Map(values.map((value) => [value.id, this.clone(value)]));
    if (JSON.stringify([...next]) === JSON.stringify([...this.projects])) {
      return;
    }
    this.projects.clear();
    next.forEach((value, key) => this.projects.set(key, value));
    this.invalidate();
  }

  public applyDelta(delta: RangeQueryDelta): void {
    let changed = false;
    (delta.remove ?? []).forEach(({ projectId, localDate }) => {
      changed = this.removeRollup(projectId, localDate) || changed;
    });
    (delta.upsert ?? []).forEach((rollup) => {
      changed = this.upsertRollup(rollup) || changed;
    });
    if (changed) {
      this.invalidate();
    }
  }

  public replaceScope(
    projectIds: readonly string[],
    localDates: readonly string[],
    values: readonly DailyRollup[],
  ): void {
    const scopeProjects = new Set(projectIds);
    const scopeDates = new Set(localDates);
    const incoming = new Set(
      values.map((value) => this.rollupKey(value.projectId, value.localDate)),
    );
    const remove: Array<{ projectId: string; localDate: string }> = [];
    scopeDates.forEach((localDate) => {
      this.rollupsByDate.get(localDate)?.forEach((_value, projectId) => {
        if (
          scopeProjects.has(projectId) &&
          !incoming.has(this.rollupKey(projectId, localDate))
        ) {
          remove.push({ projectId, localDate });
        }
      });
    });
    this.applyDelta({ remove, upsert: values });
  }

  public normalize(request: RangeQueryRequest): NormalizedRangeQuery {
    const today = this.localDateKey(this.clock.now());
    let startLocalDate: string;
    let endLocalDate = today;

    switch (request.preset) {
      case "today":
        startLocalDate = today;
        break;
      case "7-days":
        startLocalDate = this.addCalendarDays(today, -6);
        break;
      case "30-days":
        startLocalDate = this.addCalendarDays(today, -29);
        break;
      case "90-days":
        startLocalDate = this.addCalendarDays(today, -89);
        break;
      case "year":
        startLocalDate = `${today.slice(0, 4)}-01-01`;
        break;
      case "custom": {
        if (!request.startLocalDate || !request.endLocalDate) {
          throw new Error("Custom ranges require startLocalDate and endLocalDate");
        }
        this.assertLocalDate(request.startLocalDate);
        this.assertLocalDate(request.endLocalDate);
        if (request.startLocalDate > today) {
          throw new Error("Range start cannot be in the future");
        }
        startLocalDate = request.startLocalDate;
        endLocalDate = request.endLocalDate > today
          ? today
          : request.endLocalDate;
        if (startLocalDate > endLocalDate) {
          throw new Error("Range start must not follow range end");
        }
        break;
      }
    }

    const current = this.createRange(startLocalDate, endLocalDate, today);
    const includeComparison = request.includeComparison ?? false;
    let comparison: NormalizedDateRange | null = null;
    if (includeComparison && current.complete) {
      const previousEnd = this.addCalendarDays(current.startLocalDate, -1);
      const previousStart = this.addCalendarDays(
        previousEnd,
        -(current.localDates.length - 1),
      );
      comparison = this.createRange(previousStart, previousEnd, today);
    }

    const projectIds = request.projectIds
      ? [...new Set(request.projectIds)].sort()
      : null;
    projectIds?.forEach((projectId) => this.assertProjectId(projectId));
    return { current, comparison, projectIds, includeComparison };
  }

  public query(request: RangeQueryRequest): RangeQueryViewModel {
    const normalized = this.normalize(request);
    const key = JSON.stringify(normalized);
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits += 1;
      return this.clone(cached);
    }

    this.cacheMisses += 1;
    const selectedProjectIds = normalized.projectIds ?? this.allProjectIds();
    const current = this.buildPeriod(normalized.current, selectedProjectIds);
    const comparison = normalized.comparison
      ? this.buildPeriod(normalized.comparison, selectedProjectIds)
      : null;
    const view: RangeQueryViewModel = {
      current,
      comparison,
      comparisonStatus: !normalized.includeComparison
        ? "not-requested"
        : comparison
          ? "available"
          : "current-period-incomplete",
      revision: this.revision,
    };
    this.cache.set(key, this.clone(view));
    return this.clone(view);
  }

  public getStats(): RangeQueryEngineStats {
    return {
      revision: this.revision,
      cacheEntries: this.cache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      recordLookups: this.recordLookups,
    };
  }

  private buildPeriod(
    range: NormalizedDateRange,
    projectIds: readonly string[],
  ): RangePeriodViewModel {
    const records = this.recordsFor(range.localDates, projectIds);
    const days: RangeDayViewModel[] = range.localDates.map((localDate) => ({
      localDate,
      metrics: this.aggregateMetrics(
        records.filter((record) => record.localDate === localDate),
      ),
    }));
    const projects: RangeProjectViewModel[] = projectIds
      .map((projectId) => {
        const identity = this.projects.get(projectId);
        if (!identity) {
          return undefined;
        }
        const projectRecords = records.filter(
          (record) => record.projectId === projectId,
        );
        return {
          project: { id: identity.id, displayName: identity.displayName },
          metrics: this.aggregateMetrics(projectRecords),
          languages: this.aggregateDimension(
            projectRecords,
            "activeTimeByLanguageMs",
          ),
          files: this.aggregateDimension(
            projectRecords,
            "activeTimeByDocumentMs",
          ),
        };
      })
      .filter((value): value is RangeProjectViewModel => value !== undefined)
      .sort((left, right) =>
        left.project.displayName.localeCompare(right.project.displayName) ||
        left.project.id.localeCompare(right.project.id),
      );

    return {
      range: this.clone(range),
      metrics: this.aggregateMetrics(records),
      days,
      projects,
      languages: this.aggregateDimension(records, "activeTimeByLanguageMs"),
      files: this.aggregateDimension(records, "activeTimeByDocumentMs"),
      quarterHours: this.aggregateQuarterHours(range, records),
    };
  }

  private recordsFor(
    localDates: readonly string[],
    projectIds: readonly string[],
  ): DailyRollup[] {
    const records: DailyRollup[] = [];
    localDates.forEach((localDate) => {
      const byProject = this.rollupsByDate.get(localDate);
      projectIds.forEach((projectId) => {
        this.recordLookups += 1;
        const record = byProject?.get(projectId);
        if (record) {
          records.push(record);
        }
      });
    });
    return records;
  }

  private aggregateMetrics(records: readonly DailyRollup[]): RangeAggregateMetrics {
    const result = this.emptyMetrics();
    const latestByProject = new Map<string, DailyRollup>();
    records.forEach((record) => {
      ADDITIVE_FIELDS.forEach((field) => {
        result[field] = this.safeAdd(result[field], record[field], field);
      });
      result.longestFlowActiveMs = Math.max(
        result.longestFlowActiveMs,
        record.longestFlowActiveMs,
      );
      result.legacyApproximate ||= record.legacyApproximate;
      SEVERITIES.forEach((severity) => {
        result.diagnostics.introduced[severity] = this.safeAdd(
          result.diagnostics.introduced[severity],
          record.diagnostics.introduced[severity],
          `diagnostics.introduced.${severity}`,
        );
        result.diagnostics.resolved[severity] = this.safeAdd(
          result.diagnostics.resolved[severity],
          record.diagnostics.resolved[severity],
          `diagnostics.resolved.${severity}`,
        );
        result.diagnostics.peak[severity] = Math.max(
          result.diagnostics.peak[severity],
          record.diagnostics.peak[severity],
        );
      });
      const latest = latestByProject.get(record.projectId);
      if (
        !latest ||
        record.localDate > latest.localDate ||
        (record.localDate === latest.localDate &&
          record.updatedAt > latest.updatedAt)
      ) {
        latestByProject.set(record.projectId, record);
      }
    });
    latestByProject.forEach((record) => {
      SEVERITIES.forEach((severity) => {
        result.diagnostics.current[severity] = this.safeAdd(
          result.diagnostics.current[severity],
          record.diagnostics.current[severity],
          `diagnostics.current.${severity}`,
        );
      });
    });
    return result;
  }

  private aggregateDimension(
    records: readonly DailyRollup[],
    field: "activeTimeByLanguageMs" | "activeTimeByDocumentMs",
  ): RangeDimensionValue[] {
    const totals = new Map<string, number>();
    records.forEach((record) => {
      Object.entries(record[field]).forEach(([id, amount]) => {
        totals.set(
          id,
          this.safeAdd(totals.get(id) ?? 0, amount, `${field}.${id}`),
        );
      });
    });
    return [...totals]
      .map(([id, activeTimeMs]) => ({ id, activeTimeMs }))
      .sort(
        (left, right) =>
          right.activeTimeMs - left.activeTimeMs ||
          left.id.localeCompare(right.id),
      );
  }

  private aggregateQuarterHours(
    range: NormalizedDateRange,
    records: readonly DailyRollup[],
  ): RangeQuarterHourBucket[] {
    const totals = new Map<string, number>();
    records.forEach((record) => {
      Object.entries(record.activeTimeByQuarterHourMs).forEach(
        ([key, amount]) => {
          totals.set(
            key,
            this.safeAdd(
              totals.get(key) ?? 0,
              amount,
              `activeTimeByQuarterHourMs.${key}`,
            ),
          );
        },
      );
    });
    return range.localDates.flatMap((localDate) =>
      this.quarterHoursForDay(localDate).map((bucket) => ({
        ...bucket,
        activeTimeMs: totals.get(bucket.key) ?? 0,
      })),
    );
  }

  private quarterHoursForDay(
    localDate: string,
  ): Omit<RangeQuarterHourBucket, "activeTimeMs">[] {
    const [year, month, day] = localDate.split("-").map(Number);
    const start = new Date(year, month - 1, day).getTime();
    const end = new Date(year, month - 1, day + 1).getTime();
    const buckets: Omit<RangeQuarterHourBucket, "activeTimeMs">[] = [];
    for (let timestamp = start; timestamp < end; timestamp += QUARTER_HOUR_MS) {
      const date = new Date(timestamp);
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const utcOffsetMinutes = -date.getTimezoneOffset();
      const offsetSign = utcOffsetMinutes >= 0 ? "+" : "-";
      const offsetHours = String(
        Math.floor(Math.abs(utcOffsetMinutes) / 60),
      ).padStart(2, "0");
      const offsetMinutes = String(Math.abs(utcOffsetMinutes) % 60).padStart(
        2,
        "0",
      );
      buckets.push({
        key: String(timestamp),
        localDate,
        label: `${hours}:${minutes} UTC${offsetSign}${offsetHours}:${offsetMinutes}`,
        utcOffsetMinutes,
      });
    }
    return buckets;
  }

  private createRange(
    startLocalDate: string,
    endLocalDate: string,
    today: string,
  ): NormalizedDateRange {
    return {
      startLocalDate,
      endLocalDate,
      localDates: this.calendarDates(startLocalDate, endLocalDate),
      complete: endLocalDate < today,
    };
  }

  private calendarDates(start: string, end: string): string[] {
    this.assertLocalDate(start);
    this.assertLocalDate(end);
    if (start > end) {
      throw new Error("Range start must not follow range end");
    }
    const dates: string[] = [];
    for (let value = start; value <= end; value = this.addCalendarDays(value, 1)) {
      dates.push(value);
    }
    return dates;
  }

  private addCalendarDays(localDate: string, amount: number): string {
    this.assertLocalDate(localDate);
    const [year, month, day] = localDate.split("-").map(Number);
    const value = new Date(Date.UTC(year, month - 1, day + amount));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }

  private localDateKey(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  private assertLocalDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid local date ${value}`);
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`Invalid local date ${value}`);
    }
  }

  private assertProjectId(value: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
      throw new Error(`Invalid project id ${value}`);
    }
  }

  private allProjectIds(): string[] {
    return [...this.projects.keys()].sort();
  }

  private upsertRollup(value: DailyRollup): boolean {
    this.assertProjectId(value.projectId);
    this.assertLocalDate(value.localDate);
    const rollup = this.clone(value);
    const key = this.rollupKey(rollup.projectId, rollup.localDate);
    const existing = this.rollups.get(key);
    if (existing && JSON.stringify(existing) === JSON.stringify(rollup)) {
      return false;
    }
    this.rollups.set(key, rollup);
    const byProject = this.rollupsByDate.get(rollup.localDate) ?? new Map();
    byProject.set(rollup.projectId, rollup);
    this.rollupsByDate.set(rollup.localDate, byProject);
    return true;
  }

  private removeRollup(projectId: string, localDate: string): boolean {
    const key = this.rollupKey(projectId, localDate);
    if (!this.rollups.delete(key)) {
      return false;
    }
    const byProject = this.rollupsByDate.get(localDate);
    byProject?.delete(projectId);
    if (byProject?.size === 0) {
      this.rollupsByDate.delete(localDate);
    }
    return true;
  }

  private rollupKey(projectId: string, localDate: string): string {
    return `${projectId}\u0000${localDate}`;
  }

  private invalidate(): void {
    this.revision += 1;
    this.cache.clear();
  }

  private emptyMetrics(): RangeAggregateMetrics {
    const diagnostics: DiagnosticRollup = {
      current: createEmptyDiagnostics(),
      introduced: createEmptyDiagnostics(),
      resolved: createEmptyDiagnostics(),
      peak: createEmptyDiagnostics(),
    };
    return {
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
      diagnostics,
      legacyApproximate: false,
    };
  }

  private safeAdd(left: number, right: number, field: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error(`Range aggregate overflow at ${field}`);
    }
    return result;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
