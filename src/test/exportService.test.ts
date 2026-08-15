import * as assert from "assert";
import {
  RangeAggregateMetrics,
  RangePeriodViewModel,
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";
import {
  DevTrackerJsonExportV1,
  encodeCsvCell,
  ExportDataSource,
  ExportService,
  ExportValidationError,
} from "../export/ExportService";
import { RangeExportDataSource } from "../export/RangeExportDataSource";

suite("ExportService", () => {
  test("exports a complete, versioned, deterministic selected-range JSON payload", async () => {
    const source = new RecordingExportDataSource(view(41));
    const service = new ExportService(source);
    const request: RangeQueryRequest = {
      preset: "custom",
      startLocalDate: "2026-08-06",
      endLocalDate: "2026-08-07",
      projectIds: ["project-zeta", "project-alpha"],
      includeComparison: true,
    };

    const first = await service.exportJson({ kind: "selected-range", request });
    const second = await service.exportJson({ kind: "selected-range", request });
    const payload = JSON.parse(first) as DevTrackerJsonExportV1;

    assert.strictEqual(first, second);
    assert.strictEqual(first.endsWith("\n"), true);
    assert.strictEqual(payload.format, "devtracker-json-export");
    assert.strictEqual(payload.formatVersion, 1);
    assert.strictEqual(payload.dataSchemaVersion, 2);
    assert.deepStrictEqual(payload.scope, {
      kind: "selected-range",
      request: {
        preset: "custom",
        startLocalDate: "2026-08-06",
        endLocalDate: "2026-08-07",
        projectIds: ["project-alpha", "project-zeta"],
        includeComparison: true,
      },
    });
    assert.deepStrictEqual(
      payload.data.current.projects.map(({ project }) => project.displayName),
      ["Alpha", "Zeta"],
    );
    assert.deepStrictEqual(
      payload.data.current.days.map(({ localDate }) => localDate),
      ["2026-08-06", "2026-08-07"],
    );
    assert.deepStrictEqual(
      payload.data.current.projects[0].files.map(({ id }) => id),
      ["README.md", "src/index.ts"],
    );
    assert.deepStrictEqual(payload.data.current.metrics, metrics(41));
    assert.strictEqual(payload.data.revision, 9);
    assert.ok(payload.data.comparison);
    assert.ok(
      payload.metricDefinitions.some(
        (definition) =>
          definition.name === "activeTimeMs" &&
          definition.unit === "milliseconds" &&
          definition.precision === "monotonic-duration",
      ),
    );
    assert.ok(
      payload.metricDefinitions.some(
        (definition) =>
          definition.name === "insertedLineBreaksApprox" &&
          definition.precision === "editor-approximation",
      ),
    );
    assert.ok(
      payload.metricDefinitions.some(
        (definition) =>
          definition.name === "diagnostics.current.error" &&
          definition.precision === "current-snapshot",
      ),
    );
    assert.strictEqual(source.rangeRequests.length, 2);
    assert.strictEqual(source.completeHistoryQueries, 0);
  });

  test("uses the injected complete-history query without inventing a range", async () => {
    const source = new RecordingExportDataSource(view(73));
    const payload = JSON.parse(
      await new ExportService(source).exportJson({ kind: "complete-history" }),
    ) as DevTrackerJsonExportV1;

    assert.deepStrictEqual(payload.scope, { kind: "complete-history" });
    assert.strictEqual(payload.data.current.metrics.activeTimeMs, 73);
    assert.strictEqual(source.completeHistoryQueries, 1);
    assert.deepStrictEqual(source.rangeRequests, []);
  });

  test("exports only deterministic daily summaries as safe UTF-8 CSV", async () => {
    const source = new RecordingExportDataSource(view(41));
    const csv = await new ExportService(source).exportDailySummaryCsv({
      kind: "complete-history",
    });
    const lines = csv.slice(1).split("\r\n");

    assert.strictEqual(csv.startsWith("\uFEFF"), true);
    assert.strictEqual(csv.endsWith("\r\n"), true);
    assert.match(lines[0], /^"Local Date","Active Time \(milliseconds\)"/u);
    assert.match(lines[0], /"Inserted Characters \(UTF-16 code units\)"/u);
    assert.match(lines[0], /"Legacy Approximate \(boolean\)"$/u);
    assert.strictEqual(lines.length, 4);
    assert.strictEqual(lines[1].startsWith('"2026-08-06","40"'), true);
    assert.strictEqual(lines[2].startsWith('"2026-08-07","41"'), true);
    assert.strictEqual(lines[1].includes("Alpha"), false);
    assert.strictEqual(lines[1].includes("src/index.ts"), false);
  });

  test("quotes RFC-style cells and neutralizes spreadsheet formula prefixes", () => {
    assert.strictEqual(
      encodeCsvCell('value, "quoted"\r\nnext'),
      '"value, ""quoted""\r\nnext"',
    );
    assert.strictEqual(encodeCsvCell("  =SUM(A1:A2)"), '"\'  =SUM(A1:A2)"');
    assert.strictEqual(encodeCsvCell("\tcommand"), '"\'\tcommand"');
    assert.strictEqual(encodeCsvCell("\rcommand"), '"\'\rcommand"');
    assert.strictEqual(encodeCsvCell("@command"), '"\'@command"');
    assert.strictEqual(encodeCsvCell("-command"), '"\'-command"');
    assert.strictEqual(encodeCsvCell(42), '"42"');
  });

  test("does not serialize unknown fields and rejects absolute path dimensions", async () => {
    const safe = view(41) as RangeQueryViewModel & { token?: string };
    safe.token = "should-not-be-exported";
    (safe.current as RangePeriodViewModel & { secret?: string }).secret =
      "should-not-be-exported";
    const safeJson = await new ExportService(
      new RecordingExportDataSource(safe),
    ).exportJson({ kind: "complete-history" });
    assert.strictEqual(safeJson.includes("should-not-be-exported"), false);

    const unsafe = view(41);
    unsafe.current.files[0].id = "/Users/example/private/source.ts";
    await assert.rejects(
      () =>
        new ExportService(
          new RecordingExportDataSource(unsafe),
        ).exportJson({ kind: "complete-history" }),
      ExportValidationError,
    );
  });

  test("derives complete history from retained rollup bounds", async () => {
    const requests: RangeQueryRequest[] = [];
    const source = new RangeExportDataSource(
      {
        query: async (request) => {
          requests.push(request);
          return view(41);
        },
      },
      {
        getDailyRollupDateBounds: async () => ({
          startLocalDate: "2024-01-02",
          endLocalDate: "2026-08-06",
        }),
      },
      {
        now: () => new Date(2026, 7, 7, 12),
        nowMs: () => new Date(2026, 7, 7, 12).getTime(),
      },
    );

    await source.queryCompleteHistory();

    assert.deepStrictEqual(requests, [
      {
        preset: "custom",
        startLocalDate: "2024-01-02",
        endLocalDate: "2026-08-06",
      },
    ]);
  });
});

class RecordingExportDataSource implements ExportDataSource {
  public readonly rangeRequests: RangeQueryRequest[] = [];
  public completeHistoryQueries = 0;

  public constructor(private readonly result: RangeQueryViewModel) {}

  public async queryRange(
    request: RangeQueryRequest,
  ): Promise<RangeQueryViewModel> {
    this.rangeRequests.push(request);
    return this.result;
  }

  public async queryCompleteHistory(): Promise<RangeQueryViewModel> {
    this.completeHistoryQueries += 1;
    return this.result;
  }
}

function view(activeTimeMs: number): RangeQueryViewModel {
  const current = period(activeTimeMs, ["2026-08-07", "2026-08-06"]);
  const comparison = period(23, ["2026-08-05", "2026-08-04"]);
  return {
    current,
    comparison,
    comparisonStatus: "available",
    revision: 9,
  };
}

function period(
  activeTimeMs: number,
  localDates: readonly [string, string],
): RangePeriodViewModel {
  return {
    range: {
      startLocalDate: localDates[1],
      endLocalDate: localDates[0],
      localDates: [...localDates],
      complete: true,
    },
    metrics: metrics(activeTimeMs),
    days: [
      { localDate: localDates[0], metrics: metrics(activeTimeMs), languages: [] },
      { localDate: localDates[1], metrics: metrics(activeTimeMs - 1), languages: [] },
    ],
    projects: [
      project("project-zeta", "Zeta", activeTimeMs),
      project("project-alpha", "Alpha", activeTimeMs - 1),
    ],
    languages: [
      { id: "typescript", activeTimeMs },
      { id: "json", activeTimeMs: activeTimeMs - 1 },
    ],
    files: [
      { id: "src/index.ts", activeTimeMs },
      { id: "README.md", activeTimeMs: activeTimeMs - 1 },
    ],
    branches: [{ id: "main", activeTimeMs }],
    tasks: [],
    quarterHours: [
      {
        key: "later",
        localDate: localDates[0],
        label: "09:15",
        utcOffsetMinutes: 120,
        activeTimeMs,
      },
      {
        key: "earlier",
        localDate: localDates[1],
        label: "09:00",
        utcOffsetMinutes: 120,
        activeTimeMs: activeTimeMs - 1,
      },
    ],
  };
}

function project(
  id: string,
  displayName: string,
  activeTimeMs: number,
): RangePeriodViewModel["projects"][number] {
  return {
    project: { id, displayName },
    metrics: metrics(activeTimeMs),
    languages: [
      { id: "typescript", activeTimeMs },
      { id: "json", activeTimeMs: activeTimeMs - 1 },
    ],
    files: [
      { id: "src/index.ts", activeTimeMs },
      { id: "README.md", activeTimeMs: activeTimeMs - 1 },
    ],
    branches: [{ id: "main", activeTimeMs }],
    tasks: [],
  };
}

function metrics(activeTimeMs: number): RangeAggregateMetrics {
  return {
    activeTimeMs,
    debugElapsedMs: 2,
    debugActiveTimeMs: 3,
    editEvents: 4,
    insertedCharacters: 5,
    removedCharacters: 6,
    largeEditEvents: 7,
    insertedLineBreaksApprox: 8,
    removedLineBreaksApprox: 9,
    saveEvents: 10,
    fileSwitchEvents: 11,
    projectSwitchEvents: 12,
    flowBlockCount: 13,
    flowActiveMs: 14,
    longestFlowActiveMs: 15,
    gitStatus: "available",
    gitDirtyFiles: 2,
    gitBranchChanges: 1,
    gitDetectedCommits: 1,
    diagnostics: {
      current: { error: 16, warning: 17, info: 18, hint: 19 },
      introduced: { error: 20, warning: 21, info: 22, hint: 23 },
      resolved: { error: 24, warning: 25, info: 26, hint: 27 },
      peak: { error: 28, warning: 29, info: 30, hint: 31 },
    },
    legacyApproximate: true,
  };
}
