import {
  RangeDayViewModel,
  RangeDimensionValue,
  RangePeriodViewModel,
  RangeQuarterHourBucket,
} from "../domain/rangeQuery";

export type InsightPrecision = "exact-configured-duration" | "derived";

export interface InsightMetadata {
  readonly formula: string;
  readonly precision: InsightPrecision;
  readonly unavailableWhen: string;
}

export interface Insight<T> {
  readonly value: T | null;
  readonly metadata: InsightMetadata;
}

export interface DistributionValue {
  readonly id: string;
  readonly activeTimeMs: number;
  readonly sharePercent: number;
}

export interface FourWeekBaselineValue {
  readonly medianActiveTimeMs: number;
  readonly weeksUsed: readonly {
    startLocalDate: string;
    endLocalDate: string;
    activeTimeMs: number;
  }[];
}

export interface MostActiveHourValue {
  readonly localDate: string;
  readonly label: string;
  readonly utcOffsetMinutes: number;
  readonly activeTimeMs: number;
  readonly startedAt: number;
}

export interface FocusProfile {
  readonly topThreeFileSharePercent: Insight<number>;
  readonly fileSwitchesPerActiveHour: Insight<number>;
  readonly typicalFlowActiveMs: Insight<number>;
}

export interface PersonalInsightsInput {
  readonly period: RangePeriodViewModel;
  readonly weeklyPeriod?: RangePeriodViewModel;
  readonly dailyGoalMs?: number | null;
  readonly weeklyGoalMs?: number | null;
  readonly selectedLocalDate?: string;
  readonly todayLocalDate?: string;
  readonly previousCompleteWeeks?: readonly RangePeriodViewModel[];
  readonly fileDetailAvailable?: boolean;
}

export interface PersonalInsights {
  readonly dailyGoalMs: Insight<number>;
  readonly weeklyGoalMs: Insight<number>;
  readonly dailyGoalCompletionPercent: Insight<number>;
  readonly weeklyGoalCompletionPercent: Insight<number>;
  readonly activeDays: Insight<number>;
  readonly streakDays: Insight<number>;
  readonly fourWeekActiveTimeBaseline: Insight<FourWeekBaselineValue>;
  readonly focusProfile: FocusProfile;
  readonly projectDistribution: Insight<readonly DistributionValue[]>;
  readonly languageDistribution: Insight<readonly DistributionValue[]>;
  readonly fileDistribution: Insight<readonly DistributionValue[]>;
  readonly mostActiveHour: Insight<MostActiveHourValue>;
  readonly timeDistributionSummary: Insight<string>;
  readonly fragmentationSummary: Insight<string>;
}

const HOUR_MS = 60 * 60 * 1000;

export function buildPersonalInsights(
  input: PersonalInsightsInput,
): PersonalInsights {
  const { period } = input;
  const weeklyPeriod = input.weeklyPeriod ?? period;
  const selectedLocalDate =
    input.selectedLocalDate ?? period.range.endLocalDate;
  const todayLocalDate = input.todayLocalDate ?? period.range.endLocalDate;
  assertLocalDate(selectedLocalDate);
  assertLocalDate(todayLocalDate);
  const selectedDay = period.days.find(
    (day) => day.localDate === selectedLocalDate,
  );
  if (!selectedDay) {
    throw new Error("selectedLocalDate must belong to the queried period");
  }

  const dailyGoal = validGoal(input.dailyGoalMs);
  const weeklyGoal = validGoal(input.weeklyGoalMs);
  const fileDetailAvailable = input.fileDetailAvailable ?? true;
  const activeDays = calculateActiveDays(period.days);
  const streakDays = calculateActiveDayStreak(
    period.days,
    selectedLocalDate,
    todayLocalDate,
  );
  const weeklyScope = isCalendarWeekScope(weeklyPeriod, todayLocalDate);
  const weeklyBaseline = calculateFourWeekActiveTimeBaseline(
    input.previousCompleteWeeks ?? [],
    weeklyPeriod.range.startLocalDate,
  );
  const topThreeFileShare = fileDetailAvailable
    ? calculateTopThreeShare(period.files, period.metrics.activeTimeMs)
    : null;
  const switchRate = ratePerActiveHour(
    period.metrics.fileSwitchEvents,
    period.metrics.activeTimeMs,
  );
  const typicalFlow =
    period.metrics.flowBlockCount > 0
      ? Math.round(
          period.metrics.flowActiveMs / period.metrics.flowBlockCount,
        )
      : null;

  return {
    dailyGoalMs: insight(
      dailyGoal,
      "validated configured dailyGoalMs",
      "exact-configured-duration",
      "The configured goal is absent, non-integer, non-positive, or outside the safe integer range.",
    ),
    weeklyGoalMs: insight(
      weeklyGoal,
      "validated configured weeklyGoalMs",
      "exact-configured-duration",
      "The configured goal is absent, non-integer, non-positive, or outside the safe integer range.",
    ),
    dailyGoalCompletionPercent: insight(
      goalCompletionPercent(selectedDay.metrics.activeTimeMs, dailyGoal),
      "min(100, selectedDay.activeTimeMs / dailyGoalMs * 100)",
      "derived",
      "The daily goal is absent or invalid.",
    ),
    weeklyGoalCompletionPercent: insight(
      weeklyScope
        ? goalCompletionPercent(weeklyPeriod.metrics.activeTimeMs, weeklyGoal)
        : null,
      "min(100, calendarWeek.activeTimeMs / weeklyGoalMs * 100)",
      "derived",
      "The weekly goal is absent or invalid, or the query is not a complete calendar week or current week-to-date.",
    ),
    activeDays: insight(
      activeDays,
      "count(days where activeTimeMs > 0)",
      "derived",
      "Never unavailable; an empty or inactive range returns zero.",
    ),
    streakDays: insight(
      streakDays,
      "consecutive local days with activeTimeMs > 0 ending at min(selectedLocalDate, todayLocalDate)",
      "derived",
      "Never unavailable; a non-active selected day returns zero.",
    ),
    fourWeekActiveTimeBaseline: insight(
      weeklyBaseline,
      "median(activeTimeMs of the four latest prior complete Monday-Sunday weeks with data)",
      "derived",
      "Fewer than two of the four prior complete weeks contain positive active time.",
    ),
    focusProfile: {
      topThreeFileSharePercent: insight(
        topThreeFileShare,
        "sum(activeTimeMs of three most active retained documents) / totalActiveTimeMs * 100",
        "derived",
        "File detail is disabled or total active time is zero.",
      ),
      fileSwitchesPerActiveHour: insight(
        switchRate,
        "fileSwitchEvents / (activeTimeMs / 3,600,000)",
        "derived",
        "Total active time is zero.",
      ),
      typicalFlowActiveMs: insight(
        typicalFlow,
        "round(flowActiveMs / flowBlockCount) to the nearest millisecond",
        "derived",
        "No flow block was observed.",
      ),
    },
    projectDistribution: distributionInsight(
      period.projects.map((project) => ({
        id: project.project.id,
        activeTimeMs: project.metrics.activeTimeMs,
      })),
      period.metrics.activeTimeMs,
      "project",
    ),
    languageDistribution: distributionInsight(
      period.languages,
      period.metrics.activeTimeMs,
      "language",
    ),
    fileDistribution: fileDetailAvailable
      ? distributionInsight(period.files, period.metrics.activeTimeMs, "file")
      : insight<readonly DistributionValue[]>(
          null,
          "document.activeTimeMs / totalActiveTimeMs * 100",
          "derived",
          "File detail is disabled.",
        ),
    mostActiveHour: insight(
      calculateMostActiveHour(period.quarterHours),
      "sum(activeTimeMs of quarter-hour buckets within each local hour); choose the greatest, breaking ties by earliest wall bucket",
      "derived",
      "No local hour contains positive active time.",
    ),
    timeDistributionSummary: insight(
      `Active time was recorded on ${activeDays} of ${period.days.length} selected local days.`,
      "format(activeDays, selectedLocalDays)",
      "derived",
      "Never unavailable.",
    ),
    fragmentationSummary: insight(
      switchRate === null
        ? `${period.metrics.fileSwitchEvents} confirmed file switches were recorded; no active-time rate is available.`
        : `${period.metrics.fileSwitchEvents} confirmed file switches were recorded (${formatDecimal(switchRate)} per active hour).`,
      "format(fileSwitchEvents, fileSwitchesPerActiveHour)",
      "derived",
      "Never unavailable; the rate is described as unavailable when active time is zero.",
    ),
  };
}

export function goalCompletionPercent(
  activeTimeMs: number,
  goalMs: number | null | undefined,
): number | null {
  assertNonNegativeSafeInteger(activeTimeMs, "activeTimeMs");
  const valid = validGoal(goalMs);
  return valid === null
    ? null
    : Math.min(100, (activeTimeMs / valid) * 100);
}

export function calculateActiveDays(
  days: readonly RangeDayViewModel[],
): number {
  return days.reduce((count, day) => {
    assertNonNegativeSafeInteger(day.metrics.activeTimeMs, "activeTimeMs");
    return count + (day.metrics.activeTimeMs > 0 ? 1 : 0);
  }, 0);
}

export function calculateActiveDayStreak(
  days: readonly RangeDayViewModel[],
  selectedLocalDate: string,
  todayLocalDate: string,
): number {
  assertLocalDate(selectedLocalDate);
  assertLocalDate(todayLocalDate);
  const byDate = new Map<string, number>();
  days.forEach((day) => {
    assertLocalDate(day.localDate);
    assertNonNegativeSafeInteger(day.metrics.activeTimeMs, "activeTimeMs");
    if (byDate.has(day.localDate)) {
      throw new Error(`Duplicate day ${day.localDate}`);
    }
    byDate.set(day.localDate, day.metrics.activeTimeMs);
  });

  let cursor =
    selectedLocalDate > todayLocalDate ? todayLocalDate : selectedLocalDate;
  let streak = 0;
  while ((byDate.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addCalendarDays(cursor, -1);
  }
  return streak;
}

export function calculateFourWeekActiveTimeBaseline(
  weeks: readonly RangePeriodViewModel[],
  beforeLocalDate: string,
): FourWeekBaselineValue | null {
  assertLocalDate(beforeLocalDate);
  const priorFour = weeks
    .filter(
      (week) =>
        week.range.endLocalDate < beforeLocalDate &&
        isCompleteCalendarWeek(week),
    )
    .sort((left, right) =>
      right.range.endLocalDate.localeCompare(left.range.endLocalDate),
    )
    .filter(
      (week, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.range.startLocalDate === week.range.startLocalDate,
        ) === index,
    )
    .slice(0, 4);
  priorFour.forEach((week) =>
    assertNonNegativeSafeInteger(week.metrics.activeTimeMs, "activeTimeMs"),
  );
  const eligible = priorFour.filter((week) => week.metrics.activeTimeMs > 0);
  if (eligible.length < 2) {
    return null;
  }

  const sortedValues = eligible
    .map((week) => week.metrics.activeTimeMs)
    .sort((left, right) => left - right);
  const midpoint = Math.floor(sortedValues.length / 2);
  const median =
    sortedValues.length % 2 === 1
      ? sortedValues[midpoint]
      : Math.round(
          sortedValues[midpoint - 1] +
            (sortedValues[midpoint] - sortedValues[midpoint - 1]) / 2,
        );
  return {
    medianActiveTimeMs: median,
    weeksUsed: eligible.map((week) => ({
      startLocalDate: week.range.startLocalDate,
      endLocalDate: week.range.endLocalDate,
      activeTimeMs: week.metrics.activeTimeMs,
    })),
  };
}

export function calculateTopThreeShare(
  files: readonly RangeDimensionValue[],
  totalActiveTimeMs: number,
): number | null {
  assertNonNegativeSafeInteger(totalActiveTimeMs, "totalActiveTimeMs");
  if (totalActiveTimeMs === 0) {
    return null;
  }
  const topThree = [...files]
    .map((file) => {
      assertNonNegativeSafeInteger(file.activeTimeMs, "file.activeTimeMs");
      return file.activeTimeMs;
    })
    .sort((left, right) => right - left)
    .slice(0, 3)
    .reduce((total, value) => total + value, 0);
  return (topThree / totalActiveTimeMs) * 100;
}

export function ratePerActiveHour(
  eventCount: number,
  activeTimeMs: number,
): number | null {
  assertNonNegativeSafeInteger(eventCount, "eventCount");
  assertNonNegativeSafeInteger(activeTimeMs, "activeTimeMs");
  return activeTimeMs === 0
    ? null
    : eventCount / (activeTimeMs / HOUR_MS);
}

export function calculateMostActiveHour(
  quarterHours: readonly RangeQuarterHourBucket[],
): MostActiveHourValue | null {
  const hours = new Map<
    string,
    MostActiveHourValue
  >();
  quarterHours.forEach((bucket) => {
    assertLocalDate(bucket.localDate);
    assertNonNegativeSafeInteger(bucket.activeTimeMs, "bucket.activeTimeMs");
    const startedAt = Number(bucket.key);
    if (!Number.isSafeInteger(startedAt)) {
      throw new Error("Quarter-hour bucket key must be a safe timestamp");
    }
    const match = /^(\d{2}):\d{2} (UTC[+-]\d{2}:\d{2})$/.exec(
      bucket.label,
    );
    if (!match) {
      throw new Error(`Invalid quarter-hour label ${bucket.label}`);
    }
    const key = `${bucket.localDate}\0${match[1]}\0${bucket.utcOffsetMinutes}`;
    const existing = hours.get(key);
    if (existing) {
      hours.set(key, {
        ...existing,
        activeTimeMs: safeAdd(
          existing.activeTimeMs,
          bucket.activeTimeMs,
          "hour.activeTimeMs",
        ),
        startedAt: Math.min(existing.startedAt, startedAt),
      });
    } else {
      hours.set(key, {
        localDate: bucket.localDate,
        label: `${match[1]}:00 ${match[2]}`,
        utcOffsetMinutes: bucket.utcOffsetMinutes,
        activeTimeMs: bucket.activeTimeMs,
        startedAt,
      });
    }
  });
  return (
    [...hours.values()]
      .filter((hour) => hour.activeTimeMs > 0)
      .sort(
        (left, right) =>
          right.activeTimeMs - left.activeTimeMs ||
          left.startedAt - right.startedAt,
      )[0] ?? null
  );
}

function distributionInsight(
  values: readonly RangeDimensionValue[],
  totalActiveTimeMs: number,
  dimension: "project" | "language" | "file",
): Insight<readonly DistributionValue[]> {
  assertNonNegativeSafeInteger(totalActiveTimeMs, "totalActiveTimeMs");
  if (totalActiveTimeMs === 0) {
    return insight<readonly DistributionValue[]>(
      null,
      `${dimension}.activeTimeMs / totalActiveTimeMs * 100`,
      "derived",
      "Total active time is zero.",
    );
  }
  return insight(
    values.map((value) => {
      assertNonNegativeSafeInteger(
        value.activeTimeMs,
        `${dimension}.activeTimeMs`,
      );
      return {
        id: value.id,
        activeTimeMs: value.activeTimeMs,
        sharePercent: (value.activeTimeMs / totalActiveTimeMs) * 100,
      };
    }),
    `${dimension}.activeTimeMs / totalActiveTimeMs * 100`,
    "derived",
    "Total active time is zero.",
  );
}

function isCalendarWeekScope(
  period: RangePeriodViewModel,
  todayLocalDate: string,
): boolean {
  const dates = period.range.localDates;
  if (
    dates.length === 0 ||
    dates[0] !== period.range.startLocalDate ||
    dates[dates.length - 1] !== period.range.endLocalDate ||
    dayOfWeek(period.range.startLocalDate) !== 1 ||
    dates.length > 7
  ) {
    return false;
  }
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index] !== addCalendarDays(dates[index - 1], 1)) {
      return false;
    }
  }
  return (
    dates.length === 7 && dayOfWeek(period.range.endLocalDate) === 0
  ) || period.range.endLocalDate === todayLocalDate;
}

function isCompleteCalendarWeek(period: RangePeriodViewModel): boolean {
  return (
    period.range.complete &&
    period.range.localDates.length === 7 &&
    period.range.localDates[0] === period.range.startLocalDate &&
    period.range.localDates[6] === period.range.endLocalDate &&
    dayOfWeek(period.range.startLocalDate) === 1 &&
    dayOfWeek(period.range.endLocalDate) === 0 &&
    period.range.localDates.every(
      (date, index) =>
        date === addCalendarDays(period.range.startLocalDate, index),
    )
  );
}

function validGoal(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : null;
}

function insight<T>(
  value: T | null,
  formula: string,
  precision: InsightPrecision,
  unavailableWhen: string,
): Insight<T> {
  return { value, metadata: { formula, precision, unavailableWhen } };
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function safeAdd(left: number, right: number, name: string): number {
  const total = left + right;
  assertNonNegativeSafeInteger(total, name);
  return total;
}

function assertLocalDate(value: string): void {
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

function dayOfWeek(localDate: string): number {
  assertLocalDate(localDate);
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addCalendarDays(localDate: string, amount: number): string {
  assertLocalDate(localDate);
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
