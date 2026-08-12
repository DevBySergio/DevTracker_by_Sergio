import * as assert from "assert";
import type {
  RangeAggregateMetrics,
  RangePeriodViewModel,
  RangeQuarterHourBucket,
} from "../domain/rangeQuery";
import { buildOverviewViewModel } from "../webview/overviewModel";

suite("OverviewView", () => {
  test("builds the daily hero, focus profile, distributions, and 96 buckets", () => {
    const model = buildOverviewViewModel(
      period({
        metrics: {
          activeTimeMs: 7_200_000,
          fileSwitchEvents: 4,
          flowBlockCount: 2,
          flowActiveMs: 3_500,
        },
        projects: [
          {
            project: { id: "alpha", displayName: "Alpha" },
            metrics: metrics(5_400_000),
            languages: [],
            files: [],
            branches: [],
          },
          {
            project: { id: "beta", displayName: "Beta" },
            metrics: metrics(1_800_000),
            languages: [],
            files: [],
            branches: [],
          },
        ],
        languages: [
          { id: "typescript", activeTimeMs: 4_800_000 },
          { id: "json", activeTimeMs: 2_400_000 },
        ],
        files: [
          { id: "src/a.ts", activeTimeMs: 3_000_000 },
          { id: "src/b.ts", activeTimeMs: 2_000_000 },
          { id: "src/c.ts", activeTimeMs: 1_300_000 },
          { id: "src/d.ts", activeTimeMs: 900_000 },
        ],
        quarterHours: [
          bucket("1", "09:00 UTC+02:00", 1_000),
          bucket("2", "09:00 UTC+01:00", 500),
          bucket("3", "09:15 UTC+02:00", 2_000),
          bucket("4", "10:00 UTC+02:00", 4_000, "2026-08-10"),
        ],
      }),
      14_400,
      true,
    );

    assert.strictEqual(model.hasActivity, true);
    assert.strictEqual(model.activeTimeMs, 7_200_000);
    assert.strictEqual(model.dailyGoalMs, 14_400_000);
    assert.strictEqual(model.dailyGoalCompletionPercent, 50);
    assert.strictEqual(model.uniqueActiveFiles, 4);
    assert.strictEqual(model.flowBlockCount, 2);
    assert.strictEqual(
      model.focusProfile.topThreeFileSharePercent.value,
      87.5,
    );
    assert.strictEqual(
      model.focusProfile.fileSwitchesPerActiveHour.value,
      2,
    );
    assert.strictEqual(model.focusProfile.typicalFlowActiveMs.value, 1_750);
    assert.match(
      model.focusProfile.topThreeFileSharePercent.metadata.formula,
      /three most active retained documents/,
    );
    assert.deepStrictEqual(
      model.projectDistribution.map(({ label, sharePercent }) => ({
        label,
        sharePercent,
      })),
      [
        { label: "Alpha", sharePercent: 75 },
        { label: "Beta", sharePercent: 25 },
      ],
    );
    assert.deepStrictEqual(
      model.languageDistribution.map(({ label }) => label),
      ["typescript", "json"],
    );
    assert.ok(
      Math.abs(model.languageDistribution[0].sharePercent - 200 / 3) <
        Number.EPSILON * 100,
    );
    assert.ok(
      Math.abs(model.languageDistribution[1].sharePercent - 100 / 3) <
        Number.EPSILON * 100,
    );
    assert.strictEqual(model.timeline.length, 96);
    assert.deepStrictEqual(model.timeline[0], {
      label: "00:00",
      activeTimeMs: 0,
    });
    assert.deepStrictEqual(model.timeline[36], {
      label: "09:00",
      activeTimeMs: 1_500,
    });
    assert.deepStrictEqual(model.timeline[37], {
      label: "09:15",
      activeTimeMs: 2_000,
    });
    assert.deepStrictEqual(model.timeline[95], {
      label: "23:45",
      activeTimeMs: 0,
    });
  });

  test("creates a safe empty model and hides unavailable file details", () => {
    const value = period({ days: [] });
    const model = buildOverviewViewModel(value, 0, false);

    assert.strictEqual(model.hasActivity, false);
    assert.strictEqual(model.dailyGoalMs, null);
    assert.strictEqual(model.dailyGoalCompletionPercent, null);
    assert.strictEqual(model.uniqueActiveFiles, null);
    assert.strictEqual(
      model.focusProfile.topThreeFileSharePercent.value,
      null,
    );
    assert.strictEqual(
      model.focusProfile.fileSwitchesPerActiveHour.value,
      null,
    );
    assert.strictEqual(model.focusProfile.typicalFlowActiveMs.value, null);
    assert.deepStrictEqual(model.projectDistribution, []);
    assert.deepStrictEqual(model.languageDistribution, []);
    assert.strictEqual(model.timeline.length, 96);
    assert.ok(model.timeline.every((item) => item.activeTimeMs === 0));
  });
});

function period(options: {
  metrics?: Partial<RangeAggregateMetrics>;
  days?: RangePeriodViewModel["days"];
  projects?: RangePeriodViewModel["projects"];
  languages?: RangePeriodViewModel["languages"];
  files?: RangePeriodViewModel["files"];
  branches?: RangePeriodViewModel["branches"];
  quarterHours?: RangeQuarterHourBucket[];
} = {}): RangePeriodViewModel {
  const aggregate = metrics(
    options.metrics?.activeTimeMs ?? 0,
    options.metrics,
  );
  return {
    range: {
      startLocalDate: "2026-08-11",
      endLocalDate: "2026-08-11",
      localDates: ["2026-08-11"],
      complete: false,
    },
    metrics: aggregate,
    days: options.days ?? [{ localDate: "2026-08-11", metrics: aggregate }],
    projects: options.projects ?? [],
    languages: options.languages ?? [],
    files: options.files ?? [],
    branches: options.branches ?? [],
    quarterHours: options.quarterHours ?? [],
  };
}

function bucket(
  key: string,
  label: string,
  activeTimeMs: number,
  localDate = "2026-08-11",
): RangeQuarterHourBucket {
  return { key, localDate, label, utcOffsetMinutes: 120, activeTimeMs };
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
