import * as assert from "assert";
import { DailyRollupRangeReader } from "../application/ports";
import { RangeQueryRequest } from "../domain/rangeQuery";
import {
  DailyRollup,
  ProjectIdentity,
  SCHEMA_VERSION,
  createEmptyDailyRollup,
} from "../domain/schemaV2";
import { Clock } from "../platform/ports";
import { RangeQueryEngine } from "../queries/RangeQueryEngine";
import { RangeQueryService } from "../queries/RangeQueryService";

suite("RangeQueryEngine", () => {
  const now = new Date(2026, 7, 7, 12, 0, 0);
  const clock: Clock = { now: () => now, nowMs: () => now.getTime() };

  test("aggregates requested dimensions and zero-fills days and quarter hours", () => {
    const engine = new RangeQueryEngine(clock);
    const alpha = project("project-alpha", "Alpha");
    const beta = project("project-beta", "Beta");
    engine.setProjectIdentities([beta, alpha]);
    const alphaDay = rollup(alpha.id, "2026-08-05", 1200);
    alphaDay.editEvents = 2;
    alphaDay.activeTimeByLanguageMs = { typescript: 1000, json: 200 };
    alphaDay.activeTimeByDocumentMs = { "src/index.ts": 1200 };
    const bucketKey = String(new Date(2026, 7, 5, 9, 0).getTime());
    alphaDay.activeTimeByQuarterHourMs = { [bucketKey]: 1200 };
    alphaDay.diagnostics.current.error = 3;
    alphaDay.diagnostics.peak.error = 3;
    alphaDay.gitStatus = "available";
    alphaDay.gitBranchChanges = 1;
    alphaDay.activeTimeByGitBranchMs = { main: 1200 };
    const laterAlpha = rollup(alpha.id, "2026-08-07", 300);
    laterAlpha.diagnostics.current.error = 1;
    laterAlpha.diagnostics.resolved.error = 2;
    laterAlpha.diagnostics.peak.error = 3;
    laterAlpha.gitStatus = "available";
    laterAlpha.gitDirtyFiles = 3;
    laterAlpha.gitBranchChanges = 2;
    laterAlpha.gitDetectedCommits = 1;
    laterAlpha.activeTimeByGitBranchMs = { "feature/git": 300 };
    const betaDay = rollup(beta.id, "2026-08-05", 500);
    betaDay.activeTimeByLanguageMs = { typescript: 500 };
    betaDay.activeTimeByDocumentMs = { "README.md": 500 };
    engine.applyDelta({ upsert: [alphaDay, laterAlpha, betaDay] });

    const result = engine.query({ preset: "7-days" });

    assert.deepStrictEqual(result.current.range.localDates, [
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    assert.strictEqual(result.current.days.length, 7);
    assert.strictEqual(result.current.days[0].metrics.activeTimeMs, 0);
    assert.deepStrictEqual(result.current.days[0].languages, []);
    assert.deepStrictEqual(result.current.days[4].languages, [
      { id: "typescript", activeTimeMs: 1500 },
      { id: "json", activeTimeMs: 200 },
    ]);
    assert.strictEqual(result.current.metrics.activeTimeMs, 2000);
    assert.strictEqual(result.current.metrics.editEvents, 2);
    assert.strictEqual(result.current.metrics.diagnostics.current.error, 1);
    assert.strictEqual(result.current.metrics.diagnostics.resolved.error, 2);
    assert.strictEqual(result.current.metrics.diagnostics.peak.error, 3);
    assert.strictEqual(result.current.metrics.gitStatus, "available");
    assert.strictEqual(result.current.metrics.gitDirtyFiles, 3);
    assert.strictEqual(result.current.metrics.gitBranchChanges, 3);
    assert.strictEqual(result.current.metrics.gitDetectedCommits, 1);
    assert.deepStrictEqual(result.current.languages, [
      { id: "typescript", activeTimeMs: 1500 },
      { id: "json", activeTimeMs: 200 },
    ]);
    assert.deepStrictEqual(result.current.files, [
      { id: "src/index.ts", activeTimeMs: 1200 },
      { id: "README.md", activeTimeMs: 500 },
    ]);
    assert.deepStrictEqual(result.current.branches, [
      { id: "main", activeTimeMs: 1200 },
      { id: "feature/git", activeTimeMs: 300 },
    ]);
    assert.deepStrictEqual(
      result.current.projects.map(({ project, metrics }) => ({
        id: project.id,
        activeTimeMs: metrics.activeTimeMs,
      })),
      [
        { id: alpha.id, activeTimeMs: 1500 },
        { id: beta.id, activeTimeMs: 500 },
      ],
    );
    assert.deepStrictEqual(
      result.current.projects.map((entry) => ({
        id: entry.project.id,
        lastActiveLocalDate: entry.lastActiveLocalDate,
        activityTrendPercent: entry.activityTrendPercent,
      })),
      [
        {
          id: alpha.id,
          lastActiveLocalDate: "2026-08-07",
          activityTrendPercent: 100,
        },
        {
          id: beta.id,
          lastActiveLocalDate: "2026-08-05",
          activityTrendPercent: 100,
        },
      ],
    );
    assert.strictEqual(result.current.quarterHours.length, 7 * 96);
    assert.strictEqual(
      result.current.quarterHours.find(({ key }) => key === bucketKey)
        ?.activeTimeMs,
      1200,
    );
  });

  test("normalizes presets, clamps future ends, and rejects invalid future starts", () => {
    const engine = new RangeQueryEngine(clock);
    assert.strictEqual(engine.normalize({ preset: "today" }).current.localDates.length, 1);
    assert.strictEqual(engine.normalize({ preset: "7-days" }).current.localDates.length, 7);
    assert.strictEqual(engine.normalize({ preset: "30-days" }).current.localDates.length, 30);
    assert.strictEqual(engine.normalize({ preset: "90-days" }).current.localDates.length, 90);
    assert.strictEqual(
      engine.normalize({ preset: "year" }).current.startLocalDate,
      "2026-01-01",
    );
    assert.deepStrictEqual(
      engine.normalize({
        preset: "custom",
        startLocalDate: "2026-08-05",
        endLocalDate: "2027-01-01",
      }).current.localDates,
      ["2026-08-05", "2026-08-06", "2026-08-07"],
    );
    assert.throws(
      () =>
        engine.normalize({
          preset: "custom",
          startLocalDate: "2026-08-08",
          endLocalDate: "2026-08-09",
        }),
      /future/,
    );
    assert.throws(
      () =>
        engine.normalize({
          preset: "custom",
          startLocalDate: "2026-02-30",
          endLocalDate: "2026-03-01",
        }),
      /Invalid local date/,
    );
  });

  test("aggregates task success rate and median by configured task and class", () => {
    const engine = new RangeQueryEngine(clock);
    const alpha = project("project-alpha", "Alpha");
    engine.setProjectIdentities([alpha]);
    const first = rollup(alpha.id, "2026-08-06", 0);
    first.taskRuns = [
      {
        configuredName: "npm: test",
        classification: "test",
        durationMs: 100,
        result: "succeeded",
      },
      {
        configuredName: "npm: test",
        classification: "test",
        durationMs: 300,
        result: "failed",
      },
    ];
    const second = rollup(alpha.id, "2026-08-07", 0);
    second.taskRuns = [
      {
        configuredName: "npm: test",
        classification: "test",
        durationMs: 50,
        result: "cancelled",
      },
      {
        configuredName: "compile",
        classification: "build",
        durationMs: 10,
        result: "unknown",
      },
    ];
    engine.applyDelta({ upsert: [first, second] });

    const result = engine.query({ preset: "7-days" });
    assert.deepStrictEqual(result.current.tasks, [
      {
        configuredName: "compile",
        classification: "build",
        runCount: 1,
        completedRunCount: 0,
        succeededRunCount: 0,
        failedRunCount: 0,
        cancelledRunCount: 0,
        unknownRunCount: 1,
        successRatePercent: null,
        medianDurationMs: null,
      },
      {
        configuredName: "npm: test",
        classification: "test",
        runCount: 3,
        completedRunCount: 2,
        succeededRunCount: 1,
        failedRunCount: 1,
        cancelledRunCount: 1,
        unknownRunCount: 0,
        successRatePercent: 50,
        medianDurationMs: 200,
      },
    ]);
    assert.deepStrictEqual(result.current.projects[0].tasks, result.current.tasks);
  });

  test("compares equal complete periods and refuses an incomplete comparison", () => {
    const engine = new RangeQueryEngine(clock);
    const alpha = project("project-alpha", "Alpha");
    engine.setProjectIdentities([alpha]);
    engine.applyDelta({
      upsert: [
        rollup(alpha.id, "2026-07-29", 100),
        rollup(alpha.id, "2026-07-30", 200),
        rollup(alpha.id, "2026-07-31", 300),
        rollup(alpha.id, "2026-08-01", 400),
        rollup(alpha.id, "2026-08-02", 500),
        rollup(alpha.id, "2026-08-03", 600),
      ],
    });
    const complete = engine.query({
      preset: "custom",
      startLocalDate: "2026-08-01",
      endLocalDate: "2026-08-03",
      includeComparison: true,
    });
    assert.strictEqual(complete.comparisonStatus, "available");
    assert.deepStrictEqual(complete.comparison?.range.localDates, [
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    assert.strictEqual(complete.current.metrics.activeTimeMs, 1500);
    assert.strictEqual(complete.comparison?.metrics.activeTimeMs, 600);

    const incomplete = engine.query({
      preset: "today",
      includeComparison: true,
    });
    assert.strictEqual(
      incomplete.comparisonStatus,
      "current-period-incomplete",
    );
    assert.strictEqual(incomplete.comparison, null);
  });

  test("keeps the latest diagnostic snapshot instead of summing history", () => {
    const engine = new RangeQueryEngine(clock);
    const alpha = project("project-alpha", "Alpha");
    engine.setProjectIdentities([alpha]);
    const earlier = rollup(alpha.id, "2026-08-05", 100);
    earlier.diagnostics.current = {
      error: 3,
      warning: 2,
      info: 0,
      hint: 0,
    };
    earlier.diagnostics.peak = { ...earlier.diagnostics.current };
    const later = rollup(alpha.id, "2026-08-07", 100);
    later.diagnostics.current = {
      error: 1,
      warning: 4,
      info: 0,
      hint: 0,
    };
    later.diagnostics.introduced.warning = 2;
    later.diagnostics.resolved.error = 2;
    later.diagnostics.peak = {
      error: 3,
      warning: 4,
      info: 0,
      hint: 0,
    };
    engine.applyDelta({ upsert: [earlier, later] });

    const diagnostics = engine.query({ preset: "7-days" }).current.metrics
      .diagnostics;
    assert.deepStrictEqual(diagnostics.current, {
      error: 1,
      warning: 4,
      info: 0,
      hint: 0,
    });
    assert.deepStrictEqual(diagnostics.introduced, {
      error: 0,
      warning: 2,
      info: 0,
      hint: 0,
    });
    assert.deepStrictEqual(diagnostics.resolved, {
      error: 2,
      warning: 0,
      info: 0,
      hint: 0,
    });
    assert.deepStrictEqual(diagnostics.peak, {
      error: 3,
      warning: 4,
      info: 0,
      hint: 0,
    });
  });

  test("serves cached ranges and invalidates them from rollup deltas", () => {
    const engine = new RangeQueryEngine(clock);
    const alpha = project("project-alpha", "Alpha");
    engine.setProjectIdentities([alpha]);
    engine.applyDelta({ upsert: [rollup(alpha.id, "2026-08-07", 100)] });
    engine.query({ preset: "today" });
    const afterFirst = engine.getStats();
    engine.query({ preset: "today" });
    const afterCached = engine.getStats();
    assert.strictEqual(afterCached.cacheHits, afterFirst.cacheHits + 1);
    assert.strictEqual(afterCached.recordLookups, afterFirst.recordLookups);

    engine.applyDelta({ upsert: [rollup(alpha.id, "2026-08-07", 250)] });
    const updated = engine.query({ preset: "today" });
    assert.strictEqual(updated.current.metrics.activeTimeMs, 250);
    assert.strictEqual(engine.getStats().cacheMisses, afterFirst.cacheMisses + 1);
  });

  test("indexes lookups by the selected range instead of traversing history", () => {
    const engine = new RangeQueryEngine(clock);
    const alpha = project("project-alpha", "Alpha");
    engine.setProjectIdentities([alpha]);
    const history: DailyRollup[] = [];
    for (let day = 1; day <= 365; day += 1) {
      const date = new Date(Date.UTC(2025, 0, day));
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      history.push(rollup(alpha.id, key, 1));
    }
    history.push(rollup(alpha.id, "2026-08-07", 10));
    engine.applyDelta({ upsert: history });
    const before = engine.getStats().recordLookups;
    engine.query({ preset: "today" });
    assert.strictEqual(engine.getStats().recordLookups - before, 1);
  });

  test("loads only exact range keys and reuses them until the store revision changes", async () => {
    const alpha = project("project-alpha", "Alpha");
    const reader = new RecordingReader([alpha], [
      rollup(alpha.id, "2026-08-07", 100),
    ]);
    const service = new RangeQueryService(reader, new RangeQueryEngine(clock));
    const request: RangeQueryRequest = { preset: "today" };

    assert.strictEqual((await service.query(request)).current.metrics.activeTimeMs, 100);
    await service.query(request);
    assert.strictEqual(reader.reads.length, 1);
    assert.deepStrictEqual(reader.reads[0], {
      projectIds: [alpha.id],
      localDates: ["2026-08-07"],
    });

    reader.replace([rollup(alpha.id, "2026-08-07", 250)]);
    assert.strictEqual((await service.query(request)).current.metrics.activeTimeMs, 250);
    assert.strictEqual(reader.reads.length, 2);
  });

  function project(id: string, displayName: string): ProjectIdentity {
    return {
      schemaVersion: SCHEMA_VERSION,
      id,
      canonicalUri: `file:///workspace/${displayName.toLowerCase()}`,
      displayName,
      scheme: "file",
      authority: null,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    };
  }

  function rollup(
    projectId: string,
    localDate: string,
    activeTimeMs: number,
  ): DailyRollup {
    const value = createEmptyDailyRollup(projectId, localDate, now.getTime());
    value.activeTimeMs = activeTimeMs;
    return value;
  }
});

class RecordingReader implements DailyRollupRangeReader {
  public readonly reads: Array<{
    projectIds: string[];
    localDates: string[];
  }> = [];
  private revision = 1;

  constructor(
    private readonly projects: ProjectIdentity[],
    private rollups: DailyRollup[],
  ) {}

  public async listProjectIdentities(): Promise<ProjectIdentity[]> {
    return this.projects;
  }

  public async readDailyRollups(
    projectIds: readonly string[],
    localDates: readonly string[],
  ): Promise<DailyRollup[]> {
    this.reads.push({ projectIds: [...projectIds], localDates: [...localDates] });
    return this.rollups.filter(
      (rollup) =>
        projectIds.includes(rollup.projectId) &&
        localDates.includes(rollup.localDate),
    );
  }

  public getRollupRevision(): number {
    return this.revision;
  }

  public replace(values: DailyRollup[]): void {
    this.rollups = values;
    this.revision += 1;
  }
}
