import { DiagnosticRollup } from "../domain/schemaV2";
import { DiagnosticsBySeverity } from "../domain/types";
import { Clock } from "../platform/ports";

export const DEFAULT_DIAGNOSTIC_BUCKET_MS = 15 * 60 * 1000;
export const DEFAULT_DIAGNOSTIC_EMISSION_INTERVAL_MS = 5_000;
export const DEFAULT_MAX_DIAGNOSTIC_BUCKETS_PER_PROJECT = 96;

const SEVERITIES = ["error", "warning", "info", "hint"] as const;
type Severity = (typeof SEVERITIES)[number];
type JsonRecord = Record<string, unknown>;

export interface DiagnosticsAggregateObservation {
  /**
   * One complete count snapshot for every project affected by this event.
   * Omitted projects are unchanged; complete removal is an explicit zero set.
   */
  projects: Readonly<Record<string, DiagnosticsBySeverity>>;
}

export interface DiagnosticBucketUpdate {
  projectId: string;
  bucketStartedAt: number;
  bucketEndedAt: number;
  observedAt: number;
  diagnostics: DiagnosticRollup;
}

export interface DiagnosticProjectState {
  projectId: string;
  observedAt: number;
  diagnostics: DiagnosticRollup;
}

export interface DiagnosticsTrackerOptions {
  clock: Clock;
  bucketMs?: number;
  minEmissionIntervalMs?: number;
  maxBucketsPerProject?: number;
}

export class DiagnosticsTrackerValidationError extends Error {
  constructor(location: string, reason: string) {
    super(`Invalid diagnostics observation at ${location}: ${reason}`);
    this.name = "DiagnosticsTrackerValidationError";
  }
}

interface MutableProjectState {
  current: DiagnosticsBySeverity;
  introduced: DiagnosticsBySeverity;
  resolved: DiagnosticsBySeverity;
  peak: DiagnosticsBySeverity;
  observedAt: number;
  buckets: Map<number, DiagnosticBucketUpdate>;
}

/**
 * Instance-local diagnostic snapshot engine. It stores counts and timestamps
 * only; diagnostic messages, sources, code, and document contents are outside
 * both its input contract and its runtime validator.
 */
export class DiagnosticsTracker {
  private readonly clock: Clock;
  private readonly bucketMs: number;
  private readonly minEmissionIntervalMs: number;
  private readonly maxBucketsPerProject: number;
  private readonly projects = new Map<string, MutableProjectState>();
  private readonly dirtyBuckets = new Map<string, DiagnosticBucketUpdate>();
  private lastEmissionAt: number | null = null;

  constructor(options: DiagnosticsTrackerOptions) {
    this.clock = options.clock;
    this.bucketMs = this.positiveSafeInteger(
      options.bucketMs ?? DEFAULT_DIAGNOSTIC_BUCKET_MS,
      "bucketMs",
    );
    this.minEmissionIntervalMs = this.nonNegativeSafeInteger(
      options.minEmissionIntervalMs ??
        DEFAULT_DIAGNOSTIC_EMISSION_INTERVAL_MS,
      "minEmissionIntervalMs",
    );
    this.maxBucketsPerProject = this.positiveSafeInteger(
      options.maxBucketsPerProject ??
        DEFAULT_MAX_DIAGNOSTIC_BUCKETS_PER_PROJECT,
      "maxBucketsPerProject",
    );
  }

  public observe(
    value: DiagnosticsAggregateObservation,
  ): DiagnosticBucketUpdate[] {
    const observation = this.validateObservation(value);
    const observedAt = this.wallNow();
    const bucketStartedAt =
      Math.floor(observedAt / this.bucketMs) * this.bucketMs;

    for (const [projectId, current] of observation) {
      this.applyProjectObservation(
        projectId,
        current,
        observedAt,
        bucketStartedAt,
      );
    }

    const emissionNow = this.emissionNow();
    if (
      this.lastEmissionAt === null ||
      emissionNow - this.lastEmissionAt >= this.minEmissionIntervalMs
    ) {
      return this.drain(emissionNow);
    }
    return [];
  }

  public flush(): DiagnosticBucketUpdate[] {
    return this.drain(this.emissionNow());
  }

  public getProjectState(projectId: string): DiagnosticProjectState | undefined {
    this.requireProjectId(projectId, "projectId");
    const state = this.projects.get(projectId);
    if (!state) {
      return undefined;
    }
    return {
      projectId,
      observedAt: state.observedAt,
      diagnostics: this.rollup(
        state.current,
        state.introduced,
        state.resolved,
        state.peak,
      ),
    };
  }

  public getBucketUpdates(projectId: string): DiagnosticBucketUpdate[] {
    this.requireProjectId(projectId, "projectId");
    const buckets = this.projects.get(projectId)?.buckets;
    if (!buckets) {
      return [];
    }
    return [...buckets.values()]
      .sort((left, right) => left.bucketStartedAt - right.bucketStartedAt)
      .map((update) => this.cloneUpdate(update));
  }

  private applyProjectObservation(
    projectId: string,
    current: DiagnosticsBySeverity,
    observedAt: number,
    bucketStartedAt: number,
  ): void {
    const state = this.projects.get(projectId);
    const previous = state?.current;
    const introduced = previous
      ? this.positiveDelta(current, previous)
      : this.zeroCounts();
    const resolved = previous
      ? this.positiveDelta(previous, current)
      : this.zeroCounts();
    const peak = previous
      ? this.maximum(state!.peak, current)
      : this.cloneCounts(current);
    const nextState: MutableProjectState = state ?? {
      current: this.zeroCounts(),
      introduced: this.zeroCounts(),
      resolved: this.zeroCounts(),
      peak: this.zeroCounts(),
      observedAt,
      buckets: new Map(),
    };
    nextState.current = this.cloneCounts(current);
    nextState.introduced = this.addCounts(
      nextState.introduced,
      introduced,
      `${projectId}.introduced`,
    );
    nextState.resolved = this.addCounts(
      nextState.resolved,
      resolved,
      `${projectId}.resolved`,
    );
    nextState.peak = peak;
    nextState.observedAt = observedAt;
    this.projects.set(projectId, nextState);

    const existingBucket = nextState.buckets.get(bucketStartedAt);
    const bucketPeak = existingBucket
      ? this.maximum(existingBucket.diagnostics.peak, current)
      : previous
        ? this.maximum(previous, current)
        : this.cloneCounts(current);
    const update: DiagnosticBucketUpdate = {
      projectId,
      bucketStartedAt,
      bucketEndedAt: this.safeTimestampSum(
        bucketStartedAt,
        this.bucketMs,
        `${projectId}.bucketEndedAt`,
      ),
      observedAt,
      diagnostics: this.rollup(
        current,
        existingBucket
          ? this.addCounts(
              existingBucket.diagnostics.introduced,
              introduced,
              `${projectId}.bucket.introduced`,
            )
          : introduced,
        existingBucket
          ? this.addCounts(
              existingBucket.diagnostics.resolved,
              resolved,
              `${projectId}.bucket.resolved`,
            )
          : resolved,
        bucketPeak,
      ),
    };
    nextState.buckets.set(bucketStartedAt, update);
    this.dirtyBuckets.set(this.bucketKey(projectId, bucketStartedAt), update);
    this.pruneBuckets(projectId, nextState);
  }

  private pruneBuckets(projectId: string, state: MutableProjectState): void {
    while (state.buckets.size > this.maxBucketsPerProject) {
      const oldestBucket = Math.min(...state.buckets.keys());
      state.buckets.delete(oldestBucket);
      this.dirtyBuckets.delete(this.bucketKey(projectId, oldestBucket));
    }
  }

  private drain(emissionNow: number): DiagnosticBucketUpdate[] {
    if (this.dirtyBuckets.size === 0) {
      return [];
    }
    const updates = [...this.dirtyBuckets.values()]
      .sort(
        (left, right) =>
          left.bucketStartedAt - right.bucketStartedAt ||
          left.projectId.localeCompare(right.projectId),
      )
      .map((update) => this.cloneUpdate(update));
    this.dirtyBuckets.clear();
    this.lastEmissionAt = emissionNow;
    return updates;
  }

  private validateObservation(
    value: unknown,
  ): Array<[string, DiagnosticsBySeverity]> {
    const root = this.requireRecord(value, "root");
    this.requireExactKeys(root, "root", ["projects"]);
    const projects = this.requireRecord(root.projects, "projects");
    return Object.entries(projects)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([projectId, candidate]) => {
        this.requireProjectId(projectId, "projects key");
        return [
          projectId,
          this.validateCounts(candidate, `projects.${projectId}`),
        ];
      });
  }

  private validateCounts(
    value: unknown,
    location: string,
  ): DiagnosticsBySeverity {
    const counts = this.requireRecord(value, location);
    this.requireExactKeys(counts, location, SEVERITIES);
    return {
      error: this.requireCount(counts.error, `${location}.error`),
      warning: this.requireCount(counts.warning, `${location}.warning`),
      info: this.requireCount(counts.info, `${location}.info`),
      hint: this.requireCount(counts.hint, `${location}.hint`),
    };
  }

  private positiveDelta(
    next: DiagnosticsBySeverity,
    previous: DiagnosticsBySeverity,
  ): DiagnosticsBySeverity {
    return this.mapCounts((severity) =>
      Math.max(0, next[severity] - previous[severity]),
    );
  }

  private maximum(
    left: DiagnosticsBySeverity,
    right: DiagnosticsBySeverity,
  ): DiagnosticsBySeverity {
    return this.mapCounts((severity) =>
      Math.max(left[severity], right[severity]),
    );
  }

  private addCounts(
    left: DiagnosticsBySeverity,
    right: DiagnosticsBySeverity,
    location: string,
  ): DiagnosticsBySeverity {
    return this.mapCounts((severity) => {
      const total = left[severity] + right[severity];
      if (!Number.isSafeInteger(total)) {
        throw new DiagnosticsTrackerValidationError(
          `${location}.${severity}`,
          "count overflow",
        );
      }
      return total;
    });
  }

  private rollup(
    current: DiagnosticsBySeverity,
    introduced: DiagnosticsBySeverity,
    resolved: DiagnosticsBySeverity,
    peak: DiagnosticsBySeverity,
  ): DiagnosticRollup {
    return {
      current: this.cloneCounts(current),
      introduced: this.cloneCounts(introduced),
      resolved: this.cloneCounts(resolved),
      peak: this.cloneCounts(peak),
    };
  }

  private zeroCounts(): DiagnosticsBySeverity {
    return { error: 0, warning: 0, info: 0, hint: 0 };
  }

  private cloneCounts(value: DiagnosticsBySeverity): DiagnosticsBySeverity {
    return { ...value };
  }

  private mapCounts(
    value: (severity: Severity) => number,
  ): DiagnosticsBySeverity {
    return {
      error: value("error"),
      warning: value("warning"),
      info: value("info"),
      hint: value("hint"),
    };
  }

  private cloneUpdate(value: DiagnosticBucketUpdate): DiagnosticBucketUpdate {
    return {
      projectId: value.projectId,
      bucketStartedAt: value.bucketStartedAt,
      bucketEndedAt: value.bucketEndedAt,
      observedAt: value.observedAt,
      diagnostics: this.rollup(
        value.diagnostics.current,
        value.diagnostics.introduced,
        value.diagnostics.resolved,
        value.diagnostics.peak,
      ),
    };
  }

  private bucketKey(projectId: string, bucketStartedAt: number): string {
    return `${projectId}:${bucketStartedAt}`;
  }

  private wallNow(): number {
    const now = this.clock.nowMs();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new DiagnosticsTrackerValidationError(
        "clock.nowMs",
        "expected a non-negative safe integer",
      );
    }
    return now;
  }

  private emissionNow(): number {
    const now = this.clock.monotonicNowMs?.() ?? this.clock.nowMs();
    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
      throw new DiagnosticsTrackerValidationError(
        "clock.monotonicNowMs",
        "expected a non-negative finite number",
      );
    }
    return now;
  }

  private safeTimestampSum(
    left: number,
    right: number,
    location: string,
  ): number {
    const total = left + right;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new DiagnosticsTrackerValidationError(
        location,
        "timestamp overflow",
      );
    }
    return total;
  }

  private requireRecord(value: unknown, location: string): JsonRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DiagnosticsTrackerValidationError(location, "expected an object");
    }
    return value as JsonRecord;
  }

  private requireExactKeys(
    value: JsonRecord,
    location: string,
    expectedKeys: readonly string[],
  ): void {
    const expected = new Set(expectedKeys);
    const actual = Object.keys(value);
    const missing = expectedKeys.filter(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    );
    const extra = actual.filter((key) => !expected.has(key));
    if (missing.length > 0 || extra.length > 0) {
      throw new DiagnosticsTrackerValidationError(
        location,
        `keys mismatch; missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
      );
    }
  }

  private requireProjectId(value: string, location: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
      throw new DiagnosticsTrackerValidationError(
        location,
        "expected a safe project id",
      );
    }
  }

  private requireCount(value: unknown, location: string): number {
    return this.nonNegativeSafeInteger(value, location);
  }

  private positiveSafeInteger(value: unknown, location: string): number {
    const result = this.nonNegativeSafeInteger(value, location);
    if (result === 0) {
      throw new DiagnosticsTrackerValidationError(
        location,
        "expected a positive safe integer",
      );
    }
    return result;
  }

  private nonNegativeSafeInteger(value: unknown, location: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new DiagnosticsTrackerValidationError(
        location,
        "expected a non-negative safe integer",
      );
    }
    return value as number;
  }
}
