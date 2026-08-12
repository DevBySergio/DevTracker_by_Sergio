import * as assert from "assert";
import {
  RangeAggregateMetrics,
  RangeDimensionValue,
  RangePeriodViewModel,
  RangeProjectViewModel,
  RangeQuarterHourBucket,
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";
import {
  Insight,
  buildPersonalInsights,
  calculateActiveDayStreak,
  calculateFourWeekActiveTimeBaseline,
  goalCompletionPercent,
} from "../queries/PersonalInsights";
import { PersonalInsightsService } from "../queries/PersonalInsightsService";

suite("Personal insights", () => {
  test("preserves daily goals and supports calendar week-to-date goals", () => {
    const current = period("2026-08-03", [4_000, 6_000, 8_000], {
      complete: false,
    });
    const result = buildPersonalInsights({
      period: current,
      selectedLocalDate: "2026-08-05",
      todayLocalDate: "2026-08-05",
      dailyGoalMs: 16_000,
      weeklyGoalMs: 36_000,
    });

    assert.strictEqual(result.dailyGoalMs.value, 16_000);
    assert.strictEqual(result.dailyGoalCompletionPercent.value, 50);
    assert.strictEqual(result.weeklyGoalMs.value, 36_000);
    assert.strictEqual(result.weeklyGoalCompletionPercent.value, 50);
    assert.strictEqual(goalCompletionPercent(20_000, 10_000), 100);
  });

  test("returns null completion for absent or invalid goals and rolling weeks", () => {
    const rollingSevenDays = period(
      "2026-08-04",
      [1, 1, 1, 1, 1, 1, 1],
      { complete: false },
    );
    const absent = buildPersonalInsights({
      period: rollingSevenDays,
      todayLocalDate: "2026-08-10",
    });
    assert.strictEqual(absent.dailyGoalMs.value, null);
    assert.strictEqual(absent.dailyGoalCompletionPercent.value, null);
    assert.strictEqual(absent.weeklyGoalMs.value, null);
    assert.strictEqual(absent.weeklyGoalCompletionPercent.value, null);

    for (const invalidGoal of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.strictEqual(goalCompletionPercent(1000, invalidGoal), null);
    }
    const validWeeklyGoalOutsideCalendarScope = buildPersonalInsights({
      period: rollingSevenDays,
      todayLocalDate: "2026-08-10",
      dailyGoalMs: 100,
      weeklyGoalMs: 100,
    });
    assert.strictEqual(
      validWeeklyGoalOutsideCalendarScope.weeklyGoalCompletionPercent.value,
      null,
    );
  });

  test("counts active days and streaks without including future days", () => {
    const current = period(
      "2026-08-01",
      [1000, 1000, 0, 1000, 1000, 1000, 1000],
    );
    const result = buildPersonalInsights({
      period: current,
      selectedLocalDate: "2026-08-06",
      todayLocalDate: "2026-08-06",
    });
    assert.strictEqual(result.activeDays.value, 6);
    assert.strictEqual(result.streakDays.value, 3);
    assert.strictEqual(
      calculateActiveDayStreak(
        current.days,
        "2026-08-07",
        "2026-08-06",
      ),
      3,
    );
  });

  test("uses only the latest four prior complete calendar weeks", () => {
    const weeks = [
      completeWeek("2026-06-29", 900),
      completeWeek("2026-07-13", 300),
      completeWeek("2026-07-27", 100),
      completeWeek("2026-07-06", 500),
      completeWeek("2026-07-20", 0),
      period("2026-07-28", [10, 10, 10, 10, 10, 10, 10], {
        complete: true,
      }),
    ];

    assert.deepStrictEqual(
      calculateFourWeekActiveTimeBaseline(weeks, "2026-08-03"),
      {
        medianActiveTimeMs: 300,
        weeksUsed: [
          {
            startLocalDate: "2026-07-27",
            endLocalDate: "2026-08-02",
            activeTimeMs: 100,
          },
          {
            startLocalDate: "2026-07-13",
            endLocalDate: "2026-07-19",
            activeTimeMs: 300,
          },
          {
            startLocalDate: "2026-07-06",
            endLocalDate: "2026-07-12",
            activeTimeMs: 500,
          },
        ],
      },
    );

    assert.strictEqual(
      calculateFourWeekActiveTimeBaseline(
        [
          completeWeek("2026-07-27", 100),
          completeWeek("2026-07-20", 0),
          completeWeek("2026-07-13", 0),
          completeWeek("2026-07-06", 0),
          completeWeek("2026-06-29", 900),
        ],
        "2026-08-03",
      ),
      null,
    );
  });

  test("uses an even-sample median rounded to the nearest millisecond", () => {
    const baseline = calculateFourWeekActiveTimeBaseline(
      [
        completeWeek("2026-07-27", 100),
        completeWeek("2026-07-20", 201),
        completeWeek("2026-07-13", 300),
        completeWeek("2026-07-06", 400),
      ],
      "2026-08-03",
    );
    assert.strictEqual(baseline?.medianActiveTimeMs, 251);
  });

  test("builds a transparent focus profile without an aggregate score", () => {
    const twoHours = 2 * 60 * 60 * 1000;
    const current = period("2026-08-03", [twoHours], {
      metrics: {
        fileSwitchEvents: 4,
        flowActiveMs: 3_500,
        flowBlockCount: 2,
      },
      files: [
        { id: "a", activeTimeMs: 60 * 60 * 1000 },
        { id: "b", activeTimeMs: 30 * 60 * 1000 },
        { id: "c", activeTimeMs: 15 * 60 * 1000 },
        { id: "d", activeTimeMs: 15 * 60 * 1000 },
      ],
    });
    const profile = buildPersonalInsights({ period: current }).focusProfile;

    assert.strictEqual(profile.topThreeFileSharePercent.value, 87.5);
    assert.strictEqual(profile.fileSwitchesPerActiveHour.value, 2);
    assert.strictEqual(profile.typicalFlowActiveMs.value, 1750);
    assert.strictEqual("score" in profile, false);
  });

  test("keeps disabled and zero-data file insights unavailable", () => {
    const active = period("2026-08-03", [1000], {
      files: [{ id: "secret", activeTimeMs: 1000 }],
    });
    const disabled = buildPersonalInsights({
      period: active,
      fileDetailAvailable: false,
    });
    assert.strictEqual(disabled.focusProfile.topThreeFileSharePercent.value, null);
    assert.strictEqual(disabled.fileDistribution.value, null);

    const empty = buildPersonalInsights({ period: period("2026-08-03", [0]) });
    assert.strictEqual(empty.focusProfile.topThreeFileSharePercent.value, null);
    assert.strictEqual(empty.focusProfile.fileSwitchesPerActiveHour.value, null);
    assert.strictEqual(empty.focusProfile.typicalFlowActiveMs.value, null);
    assert.strictEqual(empty.projectDistribution.value, null);
    assert.strictEqual(empty.languageDistribution.value, null);
  });

  test("reports distributions and fragmentation in neutral terms", () => {
    const current = period("2026-08-03", [4000], {
      metrics: { fileSwitchEvents: 2 },
      projects: [
        project("project-a", 3000),
        project("project-b", 1000),
      ],
      languages: [
        { id: "typescript", activeTimeMs: 2500 },
        { id: "json", activeTimeMs: 1500 },
      ],
    });
    const result = buildPersonalInsights({ period: current });

    assert.deepStrictEqual(result.projectDistribution.value, [
      { id: "project-a", activeTimeMs: 3000, sharePercent: 75 },
      { id: "project-b", activeTimeMs: 1000, sharePercent: 25 },
    ]);
    assert.deepStrictEqual(result.languageDistribution.value, [
      { id: "typescript", activeTimeMs: 2500, sharePercent: 62.5 },
      { id: "json", activeTimeMs: 1500, sharePercent: 37.5 },
    ]);
    const copy = `${result.timeDistributionSummary.value} ${result.fragmentationSummary.value}`;
    assert.match(copy, /Active time was recorded on 1 of 1 selected local days/);
    assert.match(copy, /2 confirmed file switches were recorded/);
    assert.doesNotMatch(
      copy,
      /\b(score|productive|unproductive|good|bad|better|worse)\b/i,
    );
  });

  test("reports the most active local hour with deterministic tie breaking", () => {
    const current = period("2026-08-03", [2000], {
      quarterHours: [
        quarterHour(1000, "09:00 UTC+00:00", 500),
        quarterHour(2000, "09:15 UTC+00:00", 500),
        quarterHour(3000, "10:00 UTC+00:00", 1000),
      ],
    });
    const result = buildPersonalInsights({ period: current });

    assert.deepStrictEqual(result.mostActiveHour.value, {
      localDate: "2026-08-03",
      label: "09:00 UTC+00:00",
      utcOffsetMinutes: 0,
      activeTimeMs: 1000,
      startedAt: 1000,
    });
    assert.strictEqual(
      buildPersonalInsights({ period: period("2026-08-03", [0]) })
        .mostActiveHour.value,
      null,
    );
  });

  test("attaches formula and precision metadata to every insight", () => {
    const result = buildPersonalInsights({
      period: period("2026-08-03", [1000]),
      dailyGoalMs: 2000,
    });
    const insights: Insight<unknown>[] = [
      result.dailyGoalMs,
      result.weeklyGoalMs,
      result.dailyGoalCompletionPercent,
      result.weeklyGoalCompletionPercent,
      result.activeDays,
      result.streakDays,
      result.fourWeekActiveTimeBaseline,
      result.focusProfile.topThreeFileSharePercent,
      result.focusProfile.fileSwitchesPerActiveHour,
      result.focusProfile.typicalFlowActiveMs,
      result.projectDistribution,
      result.languageDistribution,
      result.fileDistribution,
      result.mostActiveHour,
      result.timeDistributionSummary,
      result.fragmentationSummary,
    ];

    insights.forEach((item) => {
      assert.ok(item.metadata.formula.length > 0);
      assert.ok(item.metadata.unavailableWhen.length > 0);
      assert.ok(
        item.metadata.precision === "derived" ||
          item.metadata.precision === "exact-configured-duration",
      );
    });
  });

  test("assembles weekly goals and four complete baselines through range queries", async () => {
    const requests: RangeQueryRequest[] = [];
    const ranges = {
      query: async (request: RangeQueryRequest): Promise<RangeQueryViewModel> => {
        requests.push(request);
        const start = request.preset === "custom"
          ? request.startLocalDate!
          : "2026-08-07";
        const end = request.preset === "custom"
          ? request.endLocalDate!
          : "2026-08-07";
        const count = Math.round(
          (Date.parse(`${end}T00:00:00Z`) -
            Date.parse(`${start}T00:00:00Z`)) /
            86_400_000,
        ) + 1;
        return {
          current: period(start, Array.from({ length: count }, () => 1_000)),
          comparison: null,
          comparisonStatus: "not-requested",
          revision: requests.length,
        };
      },
    };
    const service = new PersonalInsightsService({
      ranges,
      goals: {
        getDailyGoal: () => 2,
        getWeeklyGoal: () => 10,
      },
      clock: {
        now: () => new Date(2026, 7, 7, 12),
        nowMs: () => new Date(2026, 7, 7, 12).getTime(),
      },
      fileDetailAvailable: () => false,
    });

    const result = await service.query({ preset: "today" });

    assert.strictEqual(result.insights.dailyGoalCompletionPercent.value, 50);
    assert.strictEqual(result.insights.weeklyGoalCompletionPercent.value, 50);
    assert.strictEqual(
      result.insights.fourWeekActiveTimeBaseline.value?.medianActiveTimeMs,
      7_000,
    );
    assert.strictEqual(result.insights.fileDistribution.value, null);
    assert.deepStrictEqual(
      requests.slice(1).map((request) => [
        request.startLocalDate,
        request.endLocalDate,
      ]),
      [
        ["2026-08-03", "2026-08-07"],
        ["2026-07-27", "2026-08-02"],
        ["2026-07-20", "2026-07-26"],
        ["2026-07-13", "2026-07-19"],
        ["2026-07-06", "2026-07-12"],
      ],
    );
  });

  function completeWeek(
    startLocalDate: string,
    activeTimeMs: number,
  ): RangePeriodViewModel {
    return period(startLocalDate, [activeTimeMs, 0, 0, 0, 0, 0, 0], {
      complete: true,
    });
  }

  function period(
    startLocalDate: string,
    dailyActiveTimeMs: readonly number[],
    options: {
      complete?: boolean;
      metrics?: Partial<RangeAggregateMetrics>;
      projects?: RangeProjectViewModel[];
      languages?: RangeDimensionValue[];
      files?: RangeDimensionValue[];
      branches?: RangeDimensionValue[];
      quarterHours?: RangeQuarterHourBucket[];
    } = {},
  ): RangePeriodViewModel {
    const localDates = dailyActiveTimeMs.map((_value, index) =>
      addDays(startLocalDate, index),
    );
    const activeTimeMs = dailyActiveTimeMs.reduce(
      (total, value) => total + value,
      0,
    );
    return {
      range: {
        startLocalDate,
        endLocalDate: localDates[localDates.length - 1],
        localDates,
        complete: options.complete ?? true,
      },
      metrics: metrics(activeTimeMs, options.metrics),
      days: localDates.map((localDate, index) => ({
        localDate,
        metrics: metrics(dailyActiveTimeMs[index]),
      })),
      projects: options.projects ?? [],
      languages: options.languages ?? [],
      files: options.files ?? [],
      branches: options.branches ?? [],
      quarterHours: options.quarterHours ?? [],
    };
  }

  function project(id: string, activeTimeMs: number): RangeProjectViewModel {
    return {
      project: { id, displayName: id },
      metrics: metrics(activeTimeMs),
      languages: [],
      files: [],
      branches: [],
    };
  }

  function quarterHour(
    startedAt: number,
    label: string,
    activeTimeMs: number,
  ): RangeQuarterHourBucket {
    return {
      key: String(startedAt),
      localDate: "2026-08-03",
      label,
      utcOffsetMinutes: 0,
      activeTimeMs,
    };
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

  function addDays(localDate: string, amount: number): string {
    const [year, month, day] = localDate.split("-").map(Number);
    const value = new Date(Date.UTC(year, month - 1, day + amount));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
});
