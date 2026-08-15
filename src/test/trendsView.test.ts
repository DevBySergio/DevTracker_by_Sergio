import * as assert from "assert";
import {
  RangeAggregateMetrics,
  RangePeriodViewModel,
} from "../domain/rangeQuery";
import { buildTrendsViewModel } from "../webview/trendsModel";

suite("TrendsView", () => {
  test("builds empty days, comparison, heat levels, flow, goals, and streaks", () => {
    const current = period(
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"],
      [
        day("2026-08-01", 3_600_000, 2, 4),
        day("2026-08-03", 7_200_000, 3, 6),
        day("2026-08-04", 3_600_000, 1, 1),
      ],
    );
    const comparison = period(
      ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"],
      [day("2026-07-28", 7_200_000, 1, 1)],
    );

    const model = buildTrendsViewModel(
      current,
      comparison,
      "available",
      3_600,
    );

    assert.strictEqual(model.days.length, 4);
    assert.deepStrictEqual(model.days.map((value) => value.activeTimeMs), [
      3_600_000,
      0,
      7_200_000,
      3_600_000,
    ]);
    assert.deepStrictEqual(model.days.map((value) => value.heatLevel), [3, 0, 5, 3]);
    assert.strictEqual(model.days[0].fileSwitchesPerActiveHour, 4);
    assert.strictEqual(model.days[1].fileSwitchesPerActiveHour, null);
    assert.strictEqual(model.activeDays, 3);
    assert.strictEqual(model.consistencyPercent, 75);
    assert.strictEqual(model.goalDays, 3);
    assert.strictEqual(model.goalCompletionRatePercent, 75);
    assert.strictEqual(model.currentStreakDays, 2);
    assert.strictEqual(model.longestStreakDays, 2);
    assert.strictEqual(model.comparisonActiveTimeMs, 7_200_000);
    assert.strictEqual(model.comparisonDeltaPercent, 100);
  });

  test("builds per-day language evolution and safe unavailable states", () => {
    const current = period(
      ["2026-08-01", "2026-08-02", "2026-08-03"],
      [
        day("2026-08-01", 3_000, 0, 0, [dimension("typescript", 2_000)]),
        day("2026-08-03", 4_000, 0, 0, [
          dimension("typescript", 1_000),
          dimension("json", 3_000),
        ]),
      ],
      [dimension("typescript", 3_000), dimension("json", 3_000)],
    );

    const model = buildTrendsViewModel(
      current,
      null,
      "current-period-incomplete",
      0,
    );

    assert.deepStrictEqual(model.languages, [
      {
        id: "typescript",
        totalActiveTimeMs: 3_000,
        dailyActiveTimeMs: [2_000, 0, 1_000],
      },
      {
        id: "json",
        totalActiveTimeMs: 3_000,
        dailyActiveTimeMs: [0, 0, 3_000],
      },
    ]);
    assert.strictEqual(model.comparisonDeltaPercent, null);
    assert.strictEqual(model.goalCompletionRatePercent, null);
    assert.ok(model.days.every((value) => value.goalCompletionPercent === null));
  });
});

function period(
  localDates: string[],
  days: RangePeriodViewModel["days"],
  languages: RangePeriodViewModel["languages"] = [],
): RangePeriodViewModel {
  return {
    range: {
      startLocalDate: localDates[0],
      endLocalDate: localDates[localDates.length - 1],
      localDates,
      complete: true,
    },
    metrics: metrics(days.reduce((total, value) => total + value.metrics.activeTimeMs, 0)),
    days,
    projects: [],
    languages,
    files: [],
    branches: [],
    tasks: [],
    quarterHours: [],
  };
}

function day(
  localDate: string,
  activeTimeMs: number,
  flowBlockCount: number,
  fileSwitchEvents: number,
  languages: RangePeriodViewModel["languages"] = [],
): RangePeriodViewModel["days"][number] {
  return {
    localDate,
    metrics: metrics(activeTimeMs, { flowBlockCount, fileSwitchEvents }),
    languages,
  };
}

function dimension(id: string, activeTimeMs: number) {
  return { id, activeTimeMs };
}

function metrics(
  activeTimeMs: number,
  overrides: Partial<RangeAggregateMetrics> = {},
): RangeAggregateMetrics {
  return {
    activeTimeMs,
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
    ...overrides,
  };
}
