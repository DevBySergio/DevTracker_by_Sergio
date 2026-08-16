import {
  NormalizedDateRange,
  RangeAggregateMetrics,
  RangeComparisonStatus,
  RangeDayViewModel,
  RangeDimensionValue,
  RangePeriodViewModel,
  RangePreset,
  RangeProjectViewModel,
  RangeQueryRequest,
  RangeQueryViewModel,
  RangeQuarterHourBucket,
  RangeTaskSummary,
} from "../domain/rangeQuery";

export const DASHBOARD_PROTOCOL_VERSION = 1 as const;
export const MAX_INITIAL_MESSAGE_BYTES = 100 * 1024;
export const MAX_DELTA_MESSAGE_BYTES = 10 * 1024;
export const LIVE_UPDATE_INTERVAL_MS = 1_000;

const VIEW_NAMES = ["today", "project", "quality", "global"] as const;
const RANGE_PRESETS = [
  "today",
  "7-days",
  "30-days",
  "90-days",
  "year",
  "custom",
] as const;
const COMPARISON_STATUSES = [
  "available",
  "not-requested",
  "current-period-incomplete",
] as const;
const GIT_STATUSES = [
  "disabled",
  "unavailable",
  "no-repository",
  "available",
] as const;
const METRIC_FIELDS = [
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
  "longestFlowActiveMs",
  "gitDirtyFiles",
  "gitBranchChanges",
  "gitDetectedCommits",
] as const;
const SEVERITIES = ["error", "warning", "info", "hint"] as const;

export type DashboardViewName = (typeof VIEW_NAMES)[number];

export interface DashboardViewRequestMessage {
  type: "dashboard/request-view";
  protocolVersion: typeof DASHBOARD_PROTOCOL_VERSION;
  requestId: string;
  view: DashboardViewName;
  range: Omit<RangeQueryRequest, "projectIds">;
  projectId: string | null;
}

export type DashboardRequestMessage = DashboardViewRequestMessage;

export interface DashboardSnapshotMessage {
  type: "dashboard/snapshot";
  protocolVersion: typeof DASHBOARD_PROTOCOL_VERSION;
  requestId: string;
  view: DashboardViewName;
  data: RangeQueryViewModel;
}

export interface CollectionDelta<T> {
  upsert: T[];
  remove: string[];
}

export interface RangePeriodDelta {
  range: NormalizedDateRange | null;
  metrics: RangeAggregateMetrics | null;
  days: CollectionDelta<RangeDayViewModel> | null;
  projects: CollectionDelta<RangeProjectViewModel> | null;
  languages: CollectionDelta<RangeDimensionValue> | null;
  files: CollectionDelta<RangeDimensionValue> | null;
  branches: CollectionDelta<RangeDimensionValue> | null;
  tasks: CollectionDelta<RangeTaskSummary> | null;
  quarterHours: CollectionDelta<RangeQuarterHourBucket> | null;
}

export type ComparisonDelta =
  | { kind: "unchanged" }
  | { kind: "replace"; value: RangePeriodViewModel | null }
  | { kind: "patch"; value: RangePeriodDelta };

export interface RangeViewModelDelta {
  current: RangePeriodDelta;
  comparison: ComparisonDelta;
  comparisonStatus: RangeComparisonStatus | null;
}

export interface DashboardLiveDeltaMessage {
  type: "dashboard/live-delta";
  protocolVersion: typeof DASHBOARD_PROTOCOL_VERSION;
  requestId: string;
  view: DashboardViewName;
  baseRevision: number;
  revision: number;
  delta: RangeViewModelDelta;
}

export type DashboardProtocolErrorCode =
  | "INVALID_REQUEST"
  | "QUERY_FAILED"
  | "INVALID_QUERY_RESULT"
  | "PAYLOAD_TOO_LARGE";

export interface DashboardErrorMessage {
  type: "dashboard/error";
  protocolVersion: typeof DASHBOARD_PROTOCOL_VERSION;
  requestId: string | null;
  view: DashboardViewName | null;
  code: DashboardProtocolErrorCode;
  message: string;
  limitBytes: number | null;
  actualBytes: number | null;
}

export type DashboardResponseMessage =
  | DashboardSnapshotMessage
  | DashboardLiveDeltaMessage
  | DashboardErrorMessage;

export interface DashboardProtocolClock {
  nowMs(): number;
}

export interface DashboardProtocolScheduler {
  schedule(callback: () => Promise<void>, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export type DashboardProtocolQuery = (
  request: RangeQueryRequest,
  view: DashboardViewName,
) => Promise<RangeQueryViewModel>;

export type DashboardProtocolSend = (
  message: DashboardResponseMessage,
) => void | Promise<void>;

export interface DashboardProtocolControllerOptions {
  query: DashboardProtocolQuery;
  send: DashboardProtocolSend;
  clock: DashboardProtocolClock;
  scheduler?: DashboardProtocolScheduler;
  initiallyVisible?: boolean;
}

export class DashboardProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardProtocolValidationError";
  }
}

export const nodeDashboardProtocolScheduler: DashboardProtocolScheduler = {
  schedule: (callback, delayMs) =>
    setTimeout(() => {
      void callback();
    }, delayMs),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

interface ActiveRequest {
  message: DashboardViewRequestMessage;
  query: RangeQueryRequest;
  generation: number;
}

/**
 * Host-side protocol core. The VS Code adapter supplies panel visibility,
 * validated webview input, a range query, and postMessage as injected ports.
 */
export class DashboardProtocolController {
  private readonly query: DashboardProtocolQuery;
  private readonly send: DashboardProtocolSend;
  private readonly clock: DashboardProtocolClock;
  private readonly scheduler: DashboardProtocolScheduler;
  private visible: boolean;
  private disposed = false;
  private generation = 0;
  private activeRequest: ActiveRequest | null = null;
  private lastSnapshot: RangeQueryViewModel | null = null;
  private lastLiveMessageAt = Number.NEGATIVE_INFINITY;
  private dirty = false;
  private scheduledUpdate: unknown | null = null;
  private liveQueryInFlight = false;

  constructor(options: DashboardProtocolControllerOptions) {
    this.query = options.query;
    this.send = options.send;
    this.clock = options.clock;
    this.scheduler = options.scheduler ?? nodeDashboardProtocolScheduler;
    this.visible = options.initiallyVisible ?? true;
  }

  public async handleMessage(value: unknown): Promise<void> {
    if (this.disposed) {
      return;
    }

    let message: DashboardViewRequestMessage;
    try {
      message = parseDashboardRequestMessage(value);
    } catch {
      await this.sendError("INVALID_REQUEST", null, null, null, null);
      return;
    }

    this.cancelScheduledUpdate();
    const generation = ++this.generation;
    const activeRequest: ActiveRequest = {
      message,
      query: requestToRangeQuery(message),
      generation,
    };
    this.activeRequest = activeRequest;
    this.lastSnapshot = null;
    this.dirty = true;

    if (this.visible) {
      await this.sendFreshSnapshot(activeRequest);
    }
  }

  public notifyDataChanged(): void {
    if (this.disposed || !this.activeRequest) {
      return;
    }
    this.dirty = true;
    this.scheduleLiveUpdate();
  }

  public async setVisible(visible: boolean): Promise<void> {
    if (this.disposed || visible === this.visible) {
      return;
    }
    this.visible = visible;
    if (!visible) {
      this.cancelScheduledUpdate();
      this.dirty = true;
      if (this.activeRequest) {
        const generation = ++this.generation;
        this.activeRequest = { ...this.activeRequest, generation };
      }
      return;
    }

    if (this.activeRequest) {
      await this.sendFreshSnapshot(this.activeRequest);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.cancelScheduledUpdate();
    this.activeRequest = null;
    this.lastSnapshot = null;
  }

  private async sendFreshSnapshot(request: ActiveRequest): Promise<void> {
    if (this.isCurrent(request)) {
      // A notification received after this point remains dirty and schedules a
      // follow-up; it is not hidden by completion of this snapshot query.
      this.dirty = false;
    }
    const viewModel = await this.runQuery(request);
    if (!viewModel || !this.isCurrent(request) || !this.visible) {
      this.scheduleLiveUpdate();
      return;
    }

    const message: DashboardSnapshotMessage = {
      type: "dashboard/snapshot",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      requestId: request.message.requestId,
      view: request.message.view,
      data: viewModel,
    };
    if (
      await this.sendBounded(
        message,
        MAX_INITIAL_MESSAGE_BYTES,
        request.message,
      )
    ) {
      this.lastSnapshot = cloneJson(viewModel);
      this.lastLiveMessageAt = this.clock.nowMs();
    }
    if (this.dirty) {
      this.scheduleLiveUpdate();
    }
  }

  private scheduleLiveUpdate(): void {
    if (
      !this.visible ||
      !this.dirty ||
      this.scheduledUpdate !== null ||
      this.liveQueryInFlight ||
      !this.activeRequest
    ) {
      return;
    }
    const elapsed = this.clock.nowMs() - this.lastLiveMessageAt;
    const delayMs = Math.max(0, LIVE_UPDATE_INTERVAL_MS - elapsed);
    this.scheduledUpdate = this.scheduler.schedule(async () => {
      this.scheduledUpdate = null;
      try {
        await this.flushLiveUpdate();
      } catch {
        // A transport failure is owned by the adapter; do not create an
        // unhandled rejection from a scheduled callback.
      }
    }, delayMs);
  }

  private async flushLiveUpdate(): Promise<void> {
    const request = this.activeRequest;
    if (!request || !this.visible || !this.dirty || this.disposed) {
      return;
    }

    this.liveQueryInFlight = true;
    this.dirty = false;
    try {
      const next = await this.runQuery(request);
      if (!next || !this.isCurrent(request) || !this.visible) {
        return;
      }

      if (!this.lastSnapshot) {
        await this.sendFreshSnapshot(request);
        return;
      }

      const delta = createRangeViewModelDelta(this.lastSnapshot, next);
      if (!delta) {
        this.lastSnapshot = cloneJson(next);
        return;
      }

      const message: DashboardLiveDeltaMessage = {
        type: "dashboard/live-delta",
        protocolVersion: DASHBOARD_PROTOCOL_VERSION,
        requestId: request.message.requestId,
        view: request.message.view,
        baseRevision: this.lastSnapshot.revision,
        revision: next.revision,
        delta,
      };
      if (
        await this.sendBounded(
          message,
          MAX_DELTA_MESSAGE_BYTES,
          request.message,
        )
      ) {
        this.lastSnapshot = cloneJson(next);
        this.lastLiveMessageAt = this.clock.nowMs();
      }
    } finally {
      this.liveQueryInFlight = false;
      if (this.dirty) {
        this.scheduleLiveUpdate();
      }
    }
  }

  private async runQuery(
    request: ActiveRequest,
  ): Promise<RangeQueryViewModel | null> {
    try {
      const result = await this.query(
        cloneJson(request.query),
        request.message.view,
      );
      assertRangeQueryViewModel(result, "query result");
      return cloneJson(result);
    } catch (error) {
      if (this.isCurrent(request) && this.visible) {
        await this.sendError(
          error instanceof DashboardProtocolValidationError
            ? "INVALID_QUERY_RESULT"
            : "QUERY_FAILED",
          request.message.requestId,
          request.message.view,
          null,
          null,
        );
      }
      return null;
    }
  }

  private async sendBounded(
    message: DashboardSnapshotMessage | DashboardLiveDeltaMessage,
    limitBytes: number,
    request: DashboardViewRequestMessage,
  ): Promise<boolean> {
    assertDashboardResponseMessage(message);
    const actualBytes = measureDashboardMessageBytes(message);
    if (actualBytes > limitBytes) {
      await this.sendError(
        "PAYLOAD_TOO_LARGE",
        request.requestId,
        request.view,
        limitBytes,
        actualBytes,
      );
      return false;
    }
    await this.send(message);
    return true;
  }

  private async sendError(
    code: DashboardProtocolErrorCode,
    requestId: string | null,
    view: DashboardViewName | null,
    limitBytes: number | null,
    actualBytes: number | null,
  ): Promise<void> {
    const message: DashboardErrorMessage = {
      type: "dashboard/error",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      requestId,
      view,
      code,
      message: errorMessage(code),
      limitBytes,
      actualBytes,
    };
    assertDashboardResponseMessage(message);
    await this.send(message);
  }

  private isCurrent(request: ActiveRequest): boolean {
    return (
      !this.disposed &&
      this.activeRequest?.generation === request.generation &&
      this.generation === request.generation
    );
  }

  private cancelScheduledUpdate(): void {
    if (this.scheduledUpdate !== null) {
      this.scheduler.cancel(this.scheduledUpdate);
      this.scheduledUpdate = null;
    }
  }
}

export function parseDashboardRequestMessage(
  value: unknown,
): DashboardViewRequestMessage {
  const record = exactRecord(
    value,
    "request",
    ["type", "protocolVersion", "requestId", "view", "range", "projectId"],
  );
  if (record.type !== "dashboard/request-view") {
    fail("request.type is not supported");
  }
  if (record.protocolVersion !== DASHBOARD_PROTOCOL_VERSION) {
    fail("request.protocolVersion is not supported");
  }
  const requestId = boundedSafeId(record.requestId, "request.requestId", 64);
  const view = enumValue(record.view, VIEW_NAMES, "request.view");
  const projectId = record.projectId === null
    ? null
    : boundedSafeId(record.projectId, "request.projectId", 128);
  if ((view === "project" || view === "quality") && projectId === null) {
    fail(`request.projectId is required for ${view}`);
  }
  if (view === "global" && projectId !== null) {
    fail("request.projectId must be null for global");
  }
  const range = parseRangeRequest(record.range);
  if (view === "today" && range.preset !== "today") {
    fail("request.range.preset must be today for the today view");
  }
  return {
    type: "dashboard/request-view",
    protocolVersion: DASHBOARD_PROTOCOL_VERSION,
    requestId,
    view,
    range,
    projectId,
  };
}

export function requestToRangeQuery(
  message: DashboardViewRequestMessage,
): RangeQueryRequest {
  return {
    ...message.range,
    ...(message.projectId ? { projectIds: [message.projectId] } : {}),
  };
}

/**
 * Narrows the range model to the dimensions consumed by one dashboard view.
 * Empty days and quarter-hours are reconstructed by the webview from the
 * normalized calendar range, so they do not need to cross the process boundary.
 */
export function projectDashboardViewModel(
  source: RangeQueryViewModel,
  view: DashboardViewName,
): RangeQueryViewModel {
  assertRangeQueryViewModel(source, "dashboard projection source");
  return {
    current: projectPeriod(source.current, view),
    comparison:
      source.comparison === null
        ? null
        : projectPeriod(source.comparison, view),
    comparisonStatus: source.comparisonStatus,
    revision: source.revision,
  };
}

export function measureDashboardMessageBytes(
  message: DashboardResponseMessage,
): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function projectPeriod(
  source: RangePeriodViewModel,
  view: DashboardViewName,
): RangePeriodViewModel {
  const includeDistributions = view !== "quality";
  const includeProjectDetails = view === "project" || view === "today";
  const includeQuarterHours = view === "today" || view === "global";
  const files = !includeDistributions
    ? []
    : view === "global"
      ? source.files.slice(0, 3)
      : source.files;
  const trendLanguageIds = new Set(
    source.languages.slice(0, 5).map((language) => language.id),
  );
  return {
    range: cloneJson(source.range),
    metrics: cloneJson(source.metrics),
    days: source.days.filter(hasObservedDay).map((day) => ({
      localDate: day.localDate,
      metrics: compactDashboardDayMetrics(day.metrics, view),
      languages: view === "project"
        ? day.languages
          .filter((language) => trendLanguageIds.has(language.id))
          .map(cloneJson)
        : [],
    })),
    projects: source.projects.map((project) => ({
      project: cloneJson(project.project),
      metrics: cloneJson(project.metrics),
      lastActiveLocalDate: project.lastActiveLocalDate ?? null,
      activityTrendPercent: project.activityTrendPercent ?? null,
      languages:
        includeProjectDetails && includeDistributions
          ? project.languages.map(cloneJson)
          : view === "global"
            ? project.languages.slice(0, 5).map(cloneJson)
          : [],
      files:
        includeProjectDetails && includeDistributions
          ? project.files.map(cloneJson)
          : view === "global"
            ? project.files.slice(0, 8).map(cloneJson)
          : [],
      branches:
        view === "quality" ? project.branches.map(cloneJson) : [],
      tasks: view === "quality" ? project.tasks.map(cloneJson) : [],
    })),
    languages: includeDistributions ? source.languages.map(cloneJson) : [],
    files: files.map(cloneJson),
    branches: view === "quality" ? source.branches.map(cloneJson) : [],
    tasks: view === "quality" ? source.tasks.map(cloneJson) : [],
    quarterHours: includeQuarterHours
      ? source.quarterHours
          .filter((bucket) => bucket.activeTimeMs > 0)
          .map(cloneJson)
      : [],
  };
}

function compactDashboardDayMetrics(
  source: RangeAggregateMetrics,
  view: DashboardViewName,
): RangeAggregateMetrics {
  if (view === "today") {
    return cloneJson(source);
  }
  if (view === "quality") {
    return {
      activeTimeMs: source.activeTimeMs,
      debugElapsedMs: source.debugElapsedMs,
      saveEvents: source.saveEvents,
      diagnostics: cloneJson(source.diagnostics),
    } as RangeAggregateMetrics;
  }
  if (view === "project") {
    return {
      activeTimeMs: source.activeTimeMs,
      fileSwitchEvents: source.fileSwitchEvents,
      flowBlockCount: source.flowBlockCount,
    } as RangeAggregateMetrics;
  }
  return { activeTimeMs: source.activeTimeMs } as RangeAggregateMetrics;
}

function hasObservedDay(day: RangeDayViewModel): boolean {
  const { metrics } = day;
  return (
    metrics.activeTimeMs > 0 ||
    metrics.debugElapsedMs > 0 ||
    metrics.debugActiveTimeMs > 0 ||
    metrics.editEvents > 0 ||
    metrics.insertedCharacters > 0 ||
    metrics.removedCharacters > 0 ||
    metrics.largeEditEvents > 0 ||
    metrics.insertedLineBreaksApprox > 0 ||
    metrics.removedLineBreaksApprox > 0 ||
    metrics.saveEvents > 0 ||
    metrics.fileSwitchEvents > 0 ||
    metrics.projectSwitchEvents > 0 ||
    metrics.flowBlockCount > 0 ||
    metrics.flowActiveMs > 0 ||
    metrics.longestFlowActiveMs > 0 ||
    metrics.gitDirtyFiles > 0 ||
    metrics.gitBranchChanges > 0 ||
    metrics.gitDetectedCommits > 0 ||
    metrics.legacyApproximate ||
    SEVERITIES.some(
      (severity) =>
        metrics.diagnostics.current[severity] > 0 ||
        metrics.diagnostics.introduced[severity] > 0 ||
        metrics.diagnostics.resolved[severity] > 0 ||
        metrics.diagnostics.peak[severity] > 0,
    )
  );
}

export function assertDashboardResponseMessage(
  value: unknown,
): asserts value is DashboardResponseMessage {
  const base = recordValue(value, "response");
  switch (base.type) {
    case "dashboard/snapshot":
      assertSnapshotMessage(value);
      return;
    case "dashboard/live-delta":
      assertLiveDeltaMessage(value);
      return;
    case "dashboard/error":
      assertErrorMessage(value);
      return;
    default:
      fail("response.type is not supported");
  }
}

export function createRangeViewModelDelta(
  previous: RangeQueryViewModel,
  next: RangeQueryViewModel,
): RangeViewModelDelta | null {
  assertRangeQueryViewModel(previous, "previous view model", true);
  assertRangeQueryViewModel(next, "next view model", true);
  const current = diffPeriod(previous.current, next.current);
  const comparison = diffComparison(previous.comparison, next.comparison);
  const comparisonStatus = previous.comparisonStatus === next.comparisonStatus
    ? null
    : next.comparisonStatus;
  if (
    isEmptyPeriodDelta(current) &&
    comparison.kind === "unchanged" &&
    comparisonStatus === null &&
    previous.revision === next.revision
  ) {
    return null;
  }
  return { current, comparison, comparisonStatus };
}

function parseRangeRequest(value: unknown): Omit<RangeQueryRequest, "projectIds"> {
  const range = recordValue(value, "request.range");
  const allowed = [
    "preset",
    "startLocalDate",
    "endLocalDate",
    "includeComparison",
  ];
  exactKeys(range, "request.range", ["preset"], allowed.slice(1));
  const preset = enumValue(range.preset, RANGE_PRESETS, "request.range.preset");
  const includeComparison = range.includeComparison === undefined
    ? undefined
    : booleanValue(range.includeComparison, "request.range.includeComparison");
  if (preset === "custom") {
    const startLocalDate = localDateValue(
      range.startLocalDate,
      "request.range.startLocalDate",
    );
    const endLocalDate = localDateValue(
      range.endLocalDate,
      "request.range.endLocalDate",
    );
    if (startLocalDate > endLocalDate) {
      fail("request.range start must not follow end");
    }
    return {
      preset,
      startLocalDate,
      endLocalDate,
      ...(includeComparison === undefined ? {} : { includeComparison }),
    };
  }
  if (range.startLocalDate !== undefined || range.endLocalDate !== undefined) {
    fail("request.range dates are only allowed for custom ranges");
  }
  return {
    preset,
    ...(includeComparison === undefined ? {} : { includeComparison }),
  };
}

function assertSnapshotMessage(value: unknown): void {
  const message = exactRecord(value, "snapshot", [
    "type",
    "protocolVersion",
    "requestId",
    "view",
    "data",
  ]);
  literal(message.type, "dashboard/snapshot", "snapshot.type");
  literal(
    message.protocolVersion,
    DASHBOARD_PROTOCOL_VERSION,
    "snapshot.protocolVersion",
  );
  boundedSafeId(message.requestId, "snapshot.requestId", 64);
  enumValue(message.view, VIEW_NAMES, "snapshot.view");
  assertRangeQueryViewModel(message.data, "snapshot.data", true);
}

function assertLiveDeltaMessage(value: unknown): void {
  const message = exactRecord(value, "delta", [
    "type",
    "protocolVersion",
    "requestId",
    "view",
    "baseRevision",
    "revision",
    "delta",
  ]);
  literal(message.type, "dashboard/live-delta", "delta.type");
  literal(
    message.protocolVersion,
    DASHBOARD_PROTOCOL_VERSION,
    "delta.protocolVersion",
  );
  boundedSafeId(message.requestId, "delta.requestId", 64);
  enumValue(message.view, VIEW_NAMES, "delta.view");
  nonNegativeInteger(message.baseRevision, "delta.baseRevision");
  nonNegativeInteger(message.revision, "delta.revision");
  assertRangeViewModelDelta(message.delta, "delta.delta");
}

function assertErrorMessage(value: unknown): void {
  const message = exactRecord(value, "error", [
    "type",
    "protocolVersion",
    "requestId",
    "view",
    "code",
    "message",
    "limitBytes",
    "actualBytes",
  ]);
  literal(message.type, "dashboard/error", "error.type");
  literal(
    message.protocolVersion,
    DASHBOARD_PROTOCOL_VERSION,
    "error.protocolVersion",
  );
  if (message.requestId !== null) {
    boundedSafeId(message.requestId, "error.requestId", 64);
  }
  if (message.view !== null) {
    enumValue(message.view, VIEW_NAMES, "error.view");
  }
  const code = enumValue(
    message.code,
    [
      "INVALID_REQUEST",
      "QUERY_FAILED",
      "INVALID_QUERY_RESULT",
      "PAYLOAD_TOO_LARGE",
    ] as const,
    "error.code",
  );
  literal(message.message, errorMessage(code), "error.message");
  if (code === "PAYLOAD_TOO_LARGE") {
    positiveInteger(message.limitBytes, "error.limitBytes");
    positiveInteger(message.actualBytes, "error.actualBytes");
  } else if (message.limitBytes !== null || message.actualBytes !== null) {
    fail("non-size errors must use null byte measurements");
  }
}

function assertRangeQueryViewModel(
  value: unknown,
  location: string,
  compactDays = false,
): void {
  const model = exactRecord(value, location, [
    "current",
    "comparison",
    "comparisonStatus",
    "revision",
  ]);
  assertPeriod(model.current, `${location}.current`, compactDays);
  if (model.comparison !== null) {
    assertPeriod(model.comparison, `${location}.comparison`, compactDays);
  }
  enumValue(
    model.comparisonStatus,
    COMPARISON_STATUSES,
    `${location}.comparisonStatus`,
  );
  nonNegativeInteger(model.revision, `${location}.revision`);
}

function assertPeriod(
  value: unknown,
  location: string,
  compactDays = false,
): void {
  const period = exactRecord(value, location, [
    "range",
    "metrics",
    "days",
    "projects",
    "languages",
    "files",
    "branches",
    "tasks",
    "quarterHours",
  ]);
  assertNormalizedRange(period.range, `${location}.range`);
  assertMetrics(period.metrics, `${location}.metrics`);
  arrayValue(period.days, `${location}.days`).forEach((entry, index) =>
    assertDay(entry, `${location}.days[${index}]`, compactDays),
  );
  arrayValue(period.projects, `${location}.projects`).forEach((entry, index) =>
    assertProject(entry, `${location}.projects[${index}]`),
  );
  arrayValue(period.languages, `${location}.languages`).forEach((entry, index) =>
    assertDimension(entry, `${location}.languages[${index}]`),
  );
  arrayValue(period.files, `${location}.files`).forEach((entry, index) =>
    assertDimension(entry, `${location}.files[${index}]`),
  );
  arrayValue(period.branches, `${location}.branches`).forEach((entry, index) =>
    assertDimension(entry, `${location}.branches[${index}]`),
  );
  arrayValue(period.tasks, `${location}.tasks`).forEach((entry, index) =>
    assertTaskSummary(entry, `${location}.tasks[${index}]`),
  );
  arrayValue(period.quarterHours, `${location}.quarterHours`).forEach(
    (entry, index) =>
      assertQuarterHour(entry, `${location}.quarterHours[${index}]`),
  );
}

function assertNormalizedRange(value: unknown, location: string): void {
  const range = exactRecord(value, location, [
    "startLocalDate",
    "endLocalDate",
    "localDates",
    "complete",
  ]);
  localDateValue(range.startLocalDate, `${location}.startLocalDate`);
  localDateValue(range.endLocalDate, `${location}.endLocalDate`);
  arrayValue(range.localDates, `${location}.localDates`).forEach(
    (entry, index) => localDateValue(entry, `${location}.localDates[${index}]`),
  );
  booleanValue(range.complete, `${location}.complete`);
}

function assertMetrics(value: unknown, location: string): void {
  const metrics = exactRecord(value, location, [
    ...METRIC_FIELDS,
    "gitStatus",
    "diagnostics",
    "legacyApproximate",
  ]);
  METRIC_FIELDS.forEach((field) =>
    nonNegativeNumber(metrics[field], `${location}.${field}`),
  );
  enumValue(metrics.gitStatus, GIT_STATUSES, `${location}.gitStatus`);
  assertDiagnostics(metrics.diagnostics, `${location}.diagnostics`);
  booleanValue(metrics.legacyApproximate, `${location}.legacyApproximate`);
}

function assertDiagnostics(value: unknown, location: string): void {
  const diagnostics = exactRecord(value, location, [
    "current",
    "introduced",
    "resolved",
    "peak",
  ]);
  (["current", "introduced", "resolved", "peak"] as const).forEach(
    (field) => {
      const severity = exactRecord(
        diagnostics[field],
        `${location}.${field}`,
        [...SEVERITIES],
      );
      SEVERITIES.forEach((name) =>
        nonNegativeNumber(severity[name], `${location}.${field}.${name}`),
      );
    },
  );
}

function assertDay(
  value: unknown,
  location: string,
  compactMetrics = false,
): void {
  const day = exactRecord(value, location, ["localDate", "metrics", "languages"]);
  localDateValue(day.localDate, `${location}.localDate`);
  if (compactMetrics) {
    const metrics = recordValue(day.metrics, `${location}.metrics`);
    if (metrics.gitStatus === undefined) {
      assertCompactDayMetrics(metrics, `${location}.metrics`);
    } else {
      assertMetrics(metrics, `${location}.metrics`);
    }
  } else {
    assertMetrics(day.metrics, `${location}.metrics`);
  }
  arrayValue(day.languages, `${location}.languages`).forEach((entry, index) =>
    assertDimension(entry, `${location}.languages[${index}]`),
  );
}

function assertCompactDayMetrics(value: unknown, location: string): void {
  const required = ["activeTimeMs"];
  const optional = [
    "debugElapsedMs",
    "saveEvents",
    "fileSwitchEvents",
    "flowBlockCount",
    "diagnostics",
  ];
  const metrics = exactRecord(value, location, required, optional);
  [...required, ...optional]
    .filter((field) => field !== "diagnostics" && metrics[field] !== undefined)
    .forEach((field) =>
      nonNegativeNumber(metrics[field], `${location}.${field}`),
    );
  if (metrics.diagnostics !== undefined) {
    assertDiagnostics(metrics.diagnostics, `${location}.diagnostics`);
  }
}

function assertProject(value: unknown, location: string): void {
  const project = exactRecord(value, location, [
    "project",
    "metrics",
    "languages",
    "files",
    "branches",
    "tasks",
  ], ["lastActiveLocalDate", "activityTrendPercent"]);
  const identity = exactRecord(project.project, `${location}.project`, [
    "id",
    "displayName",
  ]);
  boundedSafeId(identity.id, `${location}.project.id`, 128);
  stringValue(identity.displayName, `${location}.project.displayName`);
  assertMetrics(project.metrics, `${location}.metrics`);
  if (project.lastActiveLocalDate !== undefined && project.lastActiveLocalDate !== null) {
    localDateValue(project.lastActiveLocalDate, `${location}.lastActiveLocalDate`);
  }
  if (project.activityTrendPercent !== undefined && project.activityTrendPercent !== null) {
    finiteNumber(project.activityTrendPercent, `${location}.activityTrendPercent`);
  }
  arrayValue(project.languages, `${location}.languages`).forEach(
    (entry, index) => assertDimension(entry, `${location}.languages[${index}]`),
  );
  arrayValue(project.files, `${location}.files`).forEach((entry, index) =>
    assertDimension(entry, `${location}.files[${index}]`),
  );
  arrayValue(project.branches, `${location}.branches`).forEach((entry, index) =>
    assertDimension(entry, `${location}.branches[${index}]`),
  );
  arrayValue(project.tasks, `${location}.tasks`).forEach((entry, index) =>
    assertTaskSummary(entry, `${location}.tasks[${index}]`),
  );
}

function assertTaskSummary(value: unknown, location: string): void {
  const task = exactRecord(value, location, [
    "configuredName",
    "classification",
    "runCount",
    "completedRunCount",
    "succeededRunCount",
    "failedRunCount",
    "cancelledRunCount",
    "unknownRunCount",
    "successRatePercent",
    "medianDurationMs",
  ]);
  const configuredName = stringValue(
    task.configuredName,
    `${location}.configuredName`,
  );
  if (
    configuredName.trim().length === 0 ||
    configuredName.length > 256 ||
    configuredName.includes("\0")
  ) {
    fail(`${location}.configuredName is invalid`);
  }
  enumValue(
    task.classification,
    ["build", "test"] as const,
    `${location}.classification`,
  );
  const runCount = nonNegativeInteger(task.runCount, `${location}.runCount`);
  const completed = nonNegativeInteger(
    task.completedRunCount,
    `${location}.completedRunCount`,
  );
  const succeeded = nonNegativeInteger(
    task.succeededRunCount,
    `${location}.succeededRunCount`,
  );
  const failed = nonNegativeInteger(
    task.failedRunCount,
    `${location}.failedRunCount`,
  );
  const cancelled = nonNegativeInteger(
    task.cancelledRunCount,
    `${location}.cancelledRunCount`,
  );
  const unknown = nonNegativeInteger(
    task.unknownRunCount,
    `${location}.unknownRunCount`,
  );
  if (completed !== succeeded + failed) {
    fail(`${location}.completedRunCount does not match outcomes`);
  }
  if (runCount !== completed + cancelled + unknown) {
    fail(`${location}.runCount does not match outcomes`);
  }
  if (task.successRatePercent === null) {
    if (completed !== 0) {
      fail(`${location}.successRatePercent is missing for completed runs`);
    }
  } else {
    const rate = nonNegativeNumber(
      task.successRatePercent,
      `${location}.successRatePercent`,
    );
    if (completed === 0 || rate > 100) {
      fail(`${location}.successRatePercent is invalid`);
    }
  }
  if (task.medianDurationMs === null) {
    if (completed !== 0) {
      fail(`${location}.medianDurationMs is missing for completed runs`);
    }
  } else {
    nonNegativeInteger(task.medianDurationMs, `${location}.medianDurationMs`);
    if (completed === 0) {
      fail(`${location}.medianDurationMs requires completed runs`);
    }
  }
}

function assertDimension(value: unknown, location: string): void {
  const dimension = exactRecord(value, location, ["id", "activeTimeMs"]);
  stringValue(dimension.id, `${location}.id`);
  nonNegativeNumber(dimension.activeTimeMs, `${location}.activeTimeMs`);
}

function assertQuarterHour(value: unknown, location: string): void {
  const bucket = exactRecord(value, location, [
    "key",
    "localDate",
    "label",
    "utcOffsetMinutes",
    "activeTimeMs",
  ]);
  stringValue(bucket.key, `${location}.key`);
  localDateValue(bucket.localDate, `${location}.localDate`);
  stringValue(bucket.label, `${location}.label`);
  finiteNumber(bucket.utcOffsetMinutes, `${location}.utcOffsetMinutes`);
  nonNegativeNumber(bucket.activeTimeMs, `${location}.activeTimeMs`);
}

function assertRangeViewModelDelta(value: unknown, location: string): void {
  const delta = exactRecord(value, location, [
    "current",
    "comparison",
    "comparisonStatus",
  ]);
  assertPeriodDelta(delta.current, `${location}.current`);
  assertComparisonDelta(delta.comparison, `${location}.comparison`);
  if (delta.comparisonStatus !== null) {
    enumValue(
      delta.comparisonStatus,
      COMPARISON_STATUSES,
      `${location}.comparisonStatus`,
    );
  }
}

function assertPeriodDelta(value: unknown, location: string): void {
  const delta = exactRecord(value, location, [
    "range",
    "metrics",
    "days",
    "projects",
    "languages",
    "files",
    "branches",
    "tasks",
    "quarterHours",
  ]);
  if (delta.range !== null) {
    assertNormalizedRange(delta.range, `${location}.range`);
  }
  if (delta.metrics !== null) {
    assertMetrics(delta.metrics, `${location}.metrics`);
  }
  assertOptionalCollectionDelta(
    delta.days,
    `${location}.days`,
    (entry, entryLocation) => assertDay(entry, entryLocation, true),
  );
  assertOptionalCollectionDelta(
    delta.projects,
    `${location}.projects`,
    assertProject,
  );
  assertOptionalCollectionDelta(
    delta.languages,
    `${location}.languages`,
    assertDimension,
  );
  assertOptionalCollectionDelta(delta.files, `${location}.files`, assertDimension);
  assertOptionalCollectionDelta(
    delta.branches,
    `${location}.branches`,
    assertDimension,
  );
  assertOptionalCollectionDelta(
    delta.tasks,
    `${location}.tasks`,
    assertTaskSummary,
  );
  assertOptionalCollectionDelta(
    delta.quarterHours,
    `${location}.quarterHours`,
    assertQuarterHour,
  );
}

function assertComparisonDelta(value: unknown, location: string): void {
  const comparison = recordValue(value, location);
  if (comparison.kind === "unchanged") {
    exactKeys(comparison, location, ["kind"]);
    return;
  }
  if (comparison.kind === "replace") {
    exactKeys(comparison, location, ["kind", "value"]);
    if (comparison.value !== null) {
      assertPeriod(comparison.value, `${location}.value`, true);
    }
    return;
  }
  if (comparison.kind === "patch") {
    exactKeys(comparison, location, ["kind", "value"]);
    assertPeriodDelta(comparison.value, `${location}.value`);
    return;
  }
  fail(`${location}.kind is not supported`);
}

function assertOptionalCollectionDelta(
  value: unknown,
  location: string,
  validateEntry: (entry: unknown, location: string) => void,
): void {
  if (value === null) {
    return;
  }
  const delta = exactRecord(value, location, ["upsert", "remove"]);
  arrayValue(delta.upsert, `${location}.upsert`).forEach((entry, index) =>
    validateEntry(entry, `${location}.upsert[${index}]`),
  );
  arrayValue(delta.remove, `${location}.remove`).forEach((entry, index) =>
    stringValue(entry, `${location}.remove[${index}]`),
  );
}

function diffPeriod(
  previous: RangePeriodViewModel,
  next: RangePeriodViewModel,
): RangePeriodDelta {
  return {
    range: equalJson(previous.range, next.range) ? null : cloneJson(next.range),
    metrics: equalJson(previous.metrics, next.metrics)
      ? null
      : cloneJson(next.metrics),
    days: diffCollection(previous.days, next.days, (value) => value.localDate),
    projects: diffCollection(
      previous.projects,
      next.projects,
      (value) => value.project.id,
    ),
    languages: diffCollection(previous.languages, next.languages, (value) => value.id),
    files: diffCollection(previous.files, next.files, (value) => value.id),
    branches: diffCollection(previous.branches, next.branches, (value) => value.id),
    tasks: diffCollection(
      previous.tasks,
      next.tasks,
      (value) => `${value.classification}\0${value.configuredName}`,
    ),
    quarterHours: diffCollection(
      previous.quarterHours,
      next.quarterHours,
      (value) => value.key,
    ),
  };
}

function diffComparison(
  previous: RangePeriodViewModel | null,
  next: RangePeriodViewModel | null,
): ComparisonDelta {
  if (previous === null && next === null) {
    return { kind: "unchanged" };
  }
  if (previous === null || next === null) {
    return { kind: "replace", value: cloneJson(next) };
  }
  const value = diffPeriod(previous, next);
  return isEmptyPeriodDelta(value)
    ? { kind: "unchanged" }
    : { kind: "patch", value };
}

function diffCollection<T>(
  previous: readonly T[],
  next: readonly T[],
  keyOf: (value: T) => string,
): CollectionDelta<T> | null {
  const previousByKey = new Map(previous.map((value) => [keyOf(value), value]));
  const nextByKey = new Map(next.map((value) => [keyOf(value), value]));
  const upsert = [...nextByKey]
    .filter(([key, value]) => !equalJson(previousByKey.get(key), value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => cloneJson(value));
  const remove = [...previousByKey.keys()]
    .filter((key) => !nextByKey.has(key))
    .sort();
  return upsert.length === 0 && remove.length === 0
    ? null
    : { upsert, remove };
}

function isEmptyPeriodDelta(value: RangePeriodDelta): boolean {
  return (
    value.range === null &&
    value.metrics === null &&
    value.days === null &&
    value.projects === null &&
    value.languages === null &&
    value.files === null &&
    value.branches === null &&
    value.tasks === null &&
    value.quarterHours === null
  );
}

function exactRecord(
  value: unknown,
  location: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = recordValue(value, location);
  exactKeys(record, location, requiredKeys, optionalKeys);
  return record;
}

function exactKeys(
  record: Record<string, unknown>,
  location: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  Object.keys(record).forEach((key) => {
    if (!allowed.has(key)) {
      fail(`${location} contains unexpected key ${key}`);
    }
  });
  requiredKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      fail(`${location} is missing key ${key}`);
    }
  });
}

function recordValue(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${location} must be an array`);
  }
  return value;
}

function stringValue(value: unknown, location: string): string {
  if (typeof value !== "string") {
    fail(`${location} must be a string`);
  }
  return value;
}

function boundedSafeId(value: unknown, location: string, maxLength: number): string {
  const id = stringValue(value, location);
  if (id.length === 0 || id.length > maxLength || !/^[A-Za-z0-9._-]+$/.test(id)) {
    fail(`${location} is not a safe identifier`);
  }
  return id;
}

function booleanValue(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${location} must be a boolean`);
  }
  return value;
}

function finiteNumber(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${location} must be finite`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, location: string): number {
  const number = finiteNumber(value, location);
  if (number < 0) {
    fail(`${location} must be non-negative`);
  }
  return number;
}

function nonNegativeInteger(value: unknown, location: string): number {
  const number = nonNegativeNumber(value, location);
  if (!Number.isInteger(number)) {
    fail(`${location} must be an integer`);
  }
  return number;
}

function positiveInteger(value: unknown, location: string): number {
  const number = nonNegativeInteger(value, location);
  if (number === 0) {
    fail(`${location} must be positive`);
  }
  return number;
}

function localDateValue(value: unknown, location: string): string {
  const localDate = stringValue(value, location);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    fail(`${location} must use YYYY-MM-DD`);
  }
  const [year, month, day] = localDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail(`${location} is not a calendar date`);
  }
  return localDate;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  location: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(`${location} is not supported`);
  }
  return value as T;
}

function literal<T extends string | number>(
  value: unknown,
  expected: T,
  location: string,
): T {
  if (value !== expected) {
    fail(`${location} is not supported`);
  }
  return expected;
}

function errorMessage(code: DashboardProtocolErrorCode): string {
  switch (code) {
    case "INVALID_REQUEST":
      return "The dashboard request was rejected.";
    case "QUERY_FAILED":
      return "The requested dashboard data could not be loaded.";
    case "INVALID_QUERY_RESULT":
      return "The dashboard query returned an invalid view model.";
    case "PAYLOAD_TOO_LARGE":
      return "The dashboard payload exceeded its protocol limit.";
  }
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(message: string): never {
  throw new DashboardProtocolValidationError(message);
}
