import * as assert from "assert";
import {
  RangeAggregateMetrics,
  RangePeriodViewModel,
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";
import {
  DASHBOARD_PROTOCOL_VERSION,
  DashboardProtocolClock,
  DashboardProtocolController,
  DashboardProtocolScheduler,
  DashboardResponseMessage,
  DashboardViewRequestMessage,
  MAX_DELTA_MESSAGE_BYTES,
  MAX_INITIAL_MESSAGE_BYTES,
  assertDashboardResponseMessage,
  measureDashboardMessageBytes,
  parseDashboardRequestMessage,
  projectDashboardViewModel,
  requestToRangeQuery,
} from "../presentation/DashboardProtocol";

suite("DashboardProtocol", () => {
  test("accepts only exact named view, range, and project requests", () => {
    const request = projectRequest();

    assert.deepStrictEqual(parseDashboardRequestMessage(request), request);
    assert.deepStrictEqual(requestToRangeQuery(request), {
      preset: "7-days",
      includeComparison: true,
      projectIds: ["project-alpha"],
    });

    const invalid: unknown[] = [
      { command: "open", path: "/tmp/private" },
      { ...request, content: "arbitrary" },
      { ...request, type: "dashboard/run-command" },
      { ...request, view: "settings" },
      { ...request, projectId: "/workspace/private" },
      { ...request, projectId: null },
      { ...request, range: { ...request.range, path: "/tmp/private" } },
      {
        ...request,
        range: { preset: "7-days", startLocalDate: "2026-08-01" },
      },
      {
        ...request,
        range: {
          preset: "custom",
          startLocalDate: "2026-02-30",
          endLocalDate: "2026-03-01",
        },
      },
      { ...request, view: "global", projectId: "project-alpha" },
      { ...request, view: "today", range: { preset: "30-days" } },
    ];
    invalid.forEach((value) =>
      assert.throws(() => parseDashboardRequestMessage(value)),
    );
  });

  test("returns one validated, bounded snapshot for only the requested query", async () => {
    const harness = new ProtocolHarness(viewModel(7));
    const request = projectRequest();

    await harness.controller.handleMessage(request);

    assert.deepStrictEqual(harness.queries, [
      {
        request: {
          preset: "7-days",
          includeComparison: true,
          projectIds: ["project-alpha"],
        },
        view: "project",
      },
    ]);
    assert.strictEqual(harness.messages.length, 1);
    const snapshot = harness.messages[0];
    assert.strictEqual(snapshot.type, "dashboard/snapshot");
    assert.strictEqual(snapshot.requestId, request.requestId);
    assert.strictEqual(snapshot.view, "project");
    assert.ok(measureDashboardMessageBytes(snapshot) <= MAX_INITIAL_MESSAGE_BYTES);
    assertDashboardResponseMessage(snapshot);
  });

  test("coalesces changes and emits at most one structural delta per second", async () => {
    const harness = new ProtocolHarness(viewModel(1));
    await harness.controller.handleMessage(projectRequest());

    harness.result = changedViewModel(2, 10);
    harness.controller.notifyDataChanged();
    harness.controller.notifyDataChanged();
    harness.controller.notifyDataChanged();
    await harness.advance(999);
    assert.strictEqual(harness.messages.length, 1);

    await harness.advance(1);
    assert.strictEqual(harness.messages.length, 2);
    const firstDelta = harness.messages[1];
    assert.strictEqual(firstDelta.type, "dashboard/live-delta");
    if (firstDelta.type !== "dashboard/live-delta") {
      assert.fail("expected a live delta");
    }
    assert.strictEqual(firstDelta.baseRevision, 1);
    assert.strictEqual(firstDelta.revision, 2);
    assert.strictEqual(firstDelta.delta.current.metrics?.activeTimeMs, 10);
    assert.deepStrictEqual(
      firstDelta.delta.current.days?.upsert.map((day) => day.localDate),
      ["2026-08-07"],
    );
    assert.ok(measureDashboardMessageBytes(firstDelta) <= MAX_DELTA_MESSAGE_BYTES);

    harness.result = changedViewModel(3, 20);
    harness.controller.notifyDataChanged();
    harness.controller.notifyDataChanged();
    await harness.advance(999);
    assert.strictEqual(harness.messages.length, 2);
    await harness.advance(1);
    assert.strictEqual(harness.messages.length, 3);
    assert.deepStrictEqual(harness.messageTimes, [0, 1_000, 2_000]);
  });

  test("suspends hidden work and resumes with a fresh snapshot", async () => {
    const harness = new ProtocolHarness(viewModel(1));
    await harness.controller.handleMessage(projectRequest());

    harness.result = changedViewModel(2, 10);
    harness.controller.notifyDataChanged();
    await harness.controller.setVisible(false);
    await harness.advance(5_000);
    assert.strictEqual(harness.queries.length, 1);
    assert.strictEqual(harness.messages.length, 1);

    await harness.controller.setVisible(true);
    assert.strictEqual(harness.queries.length, 2);
    assert.strictEqual(harness.messages.length, 2);
    assert.strictEqual(harness.messages[1].type, "dashboard/snapshot");
    if (harness.messages[1].type === "dashboard/snapshot") {
      assert.strictEqual(harness.messages[1].data.revision, 2);
    }

    const hiddenHarness = new ProtocolHarness(viewModel(3), false);
    await hiddenHarness.controller.handleMessage(projectRequest());
    assert.strictEqual(hiddenHarness.queries.length, 0);
    await hiddenHarness.controller.setVisible(true);
    assert.strictEqual(hiddenHarness.messages[0].type, "dashboard/snapshot");
  });

  test("retains a change notification that arrives during a snapshot query", async () => {
    const clock = new FakeClock();
    const scheduler = new FakeScheduler(clock);
    const messages: DashboardResponseMessage[] = [];
    let queryCount = 0;
    let resolveFirstQuery: ((value: RangeQueryViewModel) => void) | undefined;
    const firstQuery = new Promise<RangeQueryViewModel>((resolve) => {
      resolveFirstQuery = resolve;
    });
    const controller = new DashboardProtocolController({
      query: async () => {
        queryCount += 1;
        return queryCount === 1 ? firstQuery : changedViewModel(2, 10);
      },
      send: (message) => {
        messages.push(message);
      },
      clock,
      scheduler,
    });

    const initial = controller.handleMessage(projectRequest());
    controller.notifyDataChanged();
    resolveFirstQuery?.(viewModel(1));
    await initial;
    assert.strictEqual(queryCount, 1);
    assert.strictEqual(messages[0].type, "dashboard/snapshot");

    await scheduler.advance(1_000);
    assert.strictEqual(queryCount, 2);
    assert.strictEqual(messages[1].type, "dashboard/live-delta");
  });

  test("rejects oversized snapshots deterministically before transport", async () => {
    const oversized = viewModel(1);
    oversized.current.files = largeDimensions(2_000);
    const harness = new ProtocolHarness(oversized);

    await harness.controller.handleMessage(projectRequest());

    assert.strictEqual(harness.messages.length, 1);
    const error = harness.messages[0];
    assert.strictEqual(error.type, "dashboard/error");
    if (error.type !== "dashboard/error") {
      assert.fail("expected an error");
    }
    assert.strictEqual(error.code, "PAYLOAD_TOO_LARGE");
    assert.strictEqual(error.limitBytes, MAX_INITIAL_MESSAGE_BYTES);
    assert.ok((error.actualBytes ?? 0) > MAX_INITIAL_MESSAGE_BYTES);
    assert.strictEqual(error.message, "The dashboard payload exceeded its protocol limit.");
  });

  test("rejects oversized live deltas instead of sending one", async () => {
    const harness = new ProtocolHarness(viewModel(1));
    await harness.controller.handleMessage(projectRequest());
    const oversizedDelta = viewModel(2);
    oversizedDelta.current.files = largeDimensions(400);
    harness.result = oversizedDelta;

    harness.controller.notifyDataChanged();
    await harness.advance(1_000);

    assert.strictEqual(harness.messages.length, 2);
    const error = harness.messages[1];
    assert.strictEqual(error.type, "dashboard/error");
    if (error.type !== "dashboard/error") {
      assert.fail("expected an error");
    }
    assert.strictEqual(error.code, "PAYLOAD_TOO_LARGE");
    assert.strictEqual(error.limitBytes, MAX_DELTA_MESSAGE_BYTES);
    assert.ok((error.actualBytes ?? 0) > MAX_DELTA_MESSAGE_BYTES);
    assert.ok(!harness.messages.some((message) => message.type === "dashboard/live-delta"));
  });

  test("converts invalid input and invalid query results to fixed errors", async () => {
    const harness = new ProtocolHarness(viewModel(1));
    await harness.controller.handleMessage({
      type: "dashboard/run-command",
      command: "delete",
    });
    assert.deepStrictEqual(harness.messages[0], {
      type: "dashboard/error",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      requestId: null,
      view: null,
      code: "INVALID_REQUEST",
      message: "The dashboard request was rejected.",
      limitBytes: null,
      actualBytes: null,
    });

    harness.result = { ...viewModel(2), unexpected: true } as RangeQueryViewModel;
    await harness.controller.handleMessage(projectRequest("request-invalid-result"));
    assert.strictEqual(harness.messages[1].type, "dashboard/error");
    if (harness.messages[1].type === "dashboard/error") {
      assert.strictEqual(harness.messages[1].code, "INVALID_QUERY_RESULT");
      assert.strictEqual(
        harness.messages[1].message,
        "The dashboard query returned an invalid view model.",
      );
    }
  });

  test("strictly validates outbound envelopes and nested view models", () => {
    const valid = {
      type: "dashboard/snapshot",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      requestId: "request-1",
      view: "project",
      data: viewModel(1),
    } as const;
    assert.doesNotThrow(() => assertDashboardResponseMessage(valid));
    assert.throws(() =>
      assertDashboardResponseMessage({ ...valid, command: "open" }),
    );
    assert.throws(() =>
      assertDashboardResponseMessage({
        ...valid,
        data: {
          ...valid.data,
          current: { ...valid.data.current, arbitrary: "content" },
        },
      }),
    );
  });

  test("projects only view-relevant dimensions and omits reconstructable zeros", () => {
    const source = viewModel(1);
    source.current.metrics.activeTimeMs = 1;
    source.current.projects[0].metrics.activeTimeMs = 1;
    source.current.languages[0].activeTimeMs = 1;
    source.current.files = [
      { id: "src/first.ts", activeTimeMs: 4 },
      { id: "src/second.ts", activeTimeMs: 3 },
      { id: "src/third.ts", activeTimeMs: 2 },
      { id: "src/fourth.ts", activeTimeMs: 1 },
    ];
    source.current.tasks = [
      {
        configuredName: "npm: test",
        classification: "test",
        runCount: 2,
        completedRunCount: 2,
        succeededRunCount: 1,
        failedRunCount: 1,
        cancelledRunCount: 0,
        unknownRunCount: 0,
        successRatePercent: 50,
        medianDurationMs: 250,
      },
    ];
    source.current.projects[0].tasks = [...source.current.tasks];

    const quality = projectDashboardViewModel(source, "quality");
    const global = projectDashboardViewModel(source, "global");
    const project = projectDashboardViewModel(source, "project");

    assert.deepStrictEqual(quality.current.days, []);
    assert.deepStrictEqual(quality.current.languages, []);
    assert.deepStrictEqual(quality.current.files, []);
    assert.deepStrictEqual(quality.current.branches, source.current.branches);
    assert.deepStrictEqual(quality.current.tasks, source.current.tasks);
    assert.deepStrictEqual(
      quality.current.projects[0].branches,
      source.current.projects[0].branches,
    );
    assert.deepStrictEqual(
      quality.current.projects[0].tasks,
      source.current.projects[0].tasks,
    );
    assert.deepStrictEqual(quality.current.quarterHours, []);
    assert.deepStrictEqual(global.current.quarterHours, []);
    assert.deepStrictEqual(global.current.projects[0].languages, []);
    assert.deepStrictEqual(global.current.projects[0].files, []);
    assert.deepStrictEqual(global.current.branches, []);
    assert.deepStrictEqual(global.current.tasks, []);
    assert.deepStrictEqual(global.current.languages, [
      { id: "typescript", activeTimeMs: 1 },
    ]);
    assert.deepStrictEqual(global.current.files, source.current.files.slice(0, 3));
    assert.deepStrictEqual(project.current.files, source.current.files);
  });
});

class ProtocolHarness {
  public result: RangeQueryViewModel;
  public readonly messages: DashboardResponseMessage[] = [];
  public readonly messageTimes: number[] = [];
  public readonly queries: Array<{
    request: RangeQueryRequest;
    view: string;
  }> = [];
  public readonly clock = new FakeClock();
  public readonly scheduler = new FakeScheduler(this.clock);
  public readonly controller: DashboardProtocolController;

  constructor(result: RangeQueryViewModel, initiallyVisible = true) {
    this.result = result;
    this.controller = new DashboardProtocolController({
      query: async (request, view) => {
        this.queries.push({
          request: JSON.parse(JSON.stringify(request)) as RangeQueryRequest,
          view,
        });
        return JSON.parse(JSON.stringify(this.result)) as RangeQueryViewModel;
      },
      send: (message) => {
        this.messages.push(message);
        this.messageTimes.push(this.clock.nowMs());
      },
      clock: this.clock,
      scheduler: this.scheduler,
      initiallyVisible,
    });
  }

  public advance(milliseconds: number): Promise<void> {
    return this.scheduler.advance(milliseconds);
  }
}

class FakeClock implements DashboardProtocolClock {
  private current = 0;

  public nowMs(): number {
    return this.current;
  }

  public advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

class FakeScheduler implements DashboardProtocolScheduler {
  private nextId = 1;
  private readonly scheduled = new Map<
    number,
    { dueAt: number; callback: () => Promise<void> }
  >();

  constructor(private readonly clock: FakeClock) {}

  public schedule(callback: () => Promise<void>, delayMs: number): unknown {
    const id = this.nextId++;
    this.scheduled.set(id, {
      dueAt: this.clock.nowMs() + delayMs,
      callback,
    });
    return id;
  }

  public cancel(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }

  public async advance(milliseconds: number): Promise<void> {
    this.clock.advance(milliseconds);
    while (true) {
      const next = [...this.scheduled]
        .filter(([, task]) => task.dueAt <= this.clock.nowMs())
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.dueAt - right.dueAt || leftId - rightId,
        )[0];
      if (!next) {
        return;
      }
      this.scheduled.delete(next[0]);
      await next[1].callback();
    }
  }
}

function projectRequest(requestId = "request-project"): DashboardViewRequestMessage {
  return {
    type: "dashboard/request-view",
    protocolVersion: DASHBOARD_PROTOCOL_VERSION,
    requestId,
    view: "project",
    range: { preset: "7-days", includeComparison: true },
    projectId: "project-alpha",
  };
}

function viewModel(revision: number): RangeQueryViewModel {
  return {
    current: period(metrics()),
    comparison: null,
    comparisonStatus: "current-period-incomplete",
    revision,
  };
}

function changedViewModel(
  revision: number,
  activeTimeMs: number,
): RangeQueryViewModel {
  const value = viewModel(revision);
  value.current.metrics.activeTimeMs = activeTimeMs;
  value.current.days[0].metrics.activeTimeMs = activeTimeMs;
  return value;
}

function period(value: RangeAggregateMetrics): RangePeriodViewModel {
  return {
    range: {
      startLocalDate: "2026-08-01",
      endLocalDate: "2026-08-07",
      localDates: ["2026-08-07"],
      complete: false,
    },
    metrics: JSON.parse(JSON.stringify(value)) as RangeAggregateMetrics,
    days: [
      {
        localDate: "2026-08-07",
        metrics: JSON.parse(JSON.stringify(value)) as RangeAggregateMetrics,
        languages: [{ id: "typescript", activeTimeMs: 0 }],
      },
    ],
    projects: [
      {
        project: { id: "project-alpha", displayName: "Alpha" },
        metrics: JSON.parse(JSON.stringify(value)) as RangeAggregateMetrics,
        languages: [{ id: "typescript", activeTimeMs: 0 }],
        files: [{ id: "src/index.ts", activeTimeMs: 0 }],
        branches: [{ id: "main", activeTimeMs: 0 }],
        tasks: [],
      },
    ],
    languages: [{ id: "typescript", activeTimeMs: 0 }],
    files: [{ id: "src/index.ts", activeTimeMs: 0 }],
    branches: [{ id: "main", activeTimeMs: 0 }],
    tasks: [],
    quarterHours: [
      {
        key: "1786104000000",
        localDate: "2026-08-07",
        label: "12:00",
        utcOffsetMinutes: 120,
        activeTimeMs: 0,
      },
    ],
  };
}

function metrics(): RangeAggregateMetrics {
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
    gitStatus: "disabled",
    gitDirtyFiles: 0,
    gitBranchChanges: 0,
    gitDetectedCommits: 0,
    diagnostics: {
      current: { error: 0, warning: 0, info: 0, hint: 0 },
      introduced: { error: 0, warning: 0, info: 0, hint: 0 },
      resolved: { error: 0, warning: 0, info: 0, hint: 0 },
      peak: { error: 0, warning: 0, info: 0, hint: 0 },
    },
    legacyApproximate: false,
  };
}

function largeDimensions(count: number): Array<{ id: string; activeTimeMs: number }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${String(index).padStart(4, "0")}-${"x".repeat(64)}`,
    activeTimeMs: index,
  }));
}
