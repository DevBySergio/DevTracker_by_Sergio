import {
  RangeComparisonStatus,
  RangeDimensionValue,
  RangePeriodViewModel,
} from "../domain/rangeQuery";

export interface TrendDayViewModel {
  readonly localDate: string;
  readonly activeTimeMs: number;
  readonly flowBlockCount: number;
  readonly fileSwitchesPerActiveHour: number | null;
  readonly goalCompletionPercent: number | null;
  readonly goalReached: boolean;
  readonly heatLevel: number;
}

export interface TrendLanguageSeries {
  readonly id: string;
  readonly totalActiveTimeMs: number;
  readonly dailyActiveTimeMs: readonly number[];
}

export interface TrendsViewModel {
  readonly rangeLabel: string;
  readonly days: readonly TrendDayViewModel[];
  readonly activeTimeMs: number;
  readonly comparisonActiveTimeMs: number | null;
  readonly comparisonDeltaPercent: number | null;
  readonly comparisonStatus: RangeComparisonStatus;
  readonly activeDays: number;
  readonly consistencyPercent: number;
  readonly goalDays: number;
  readonly goalEligibleDays: number;
  readonly goalCompletionRatePercent: number | null;
  readonly currentStreakDays: number;
  readonly longestStreakDays: number;
  readonly languages: readonly TrendLanguageSeries[];
}

export function buildTrendsViewModel(
  current: RangePeriodViewModel,
  comparison: RangePeriodViewModel | null,
  comparisonStatus: RangeComparisonStatus,
  dailyGoalSeconds: number,
): TrendsViewModel {
  const observedDays = new Map(current.days.map((day) => [day.localDate, day]));
  const dailyGoalMs = dailyGoalSeconds > 0 ? dailyGoalSeconds * 1_000 : null;
  const activeTimes = current.range.localDates.map((localDate) =>
    observedDays.get(localDate)?.metrics.activeTimeMs ?? 0
  );
  const maximumActiveTimeMs = Math.max(0, ...activeTimes);
  const days = current.range.localDates.map((localDate, index) => {
    const observed = observedDays.get(localDate);
    const activeTimeMs = activeTimes[index];
    const activeHours = activeTimeMs / 3_600_000;
    return {
      localDate,
      activeTimeMs,
      flowBlockCount: observed?.metrics.flowBlockCount ?? 0,
      fileSwitchesPerActiveHour: activeHours > 0
        ? (observed?.metrics.fileSwitchEvents ?? 0) / activeHours
        : null,
      goalCompletionPercent: dailyGoalMs === null
        ? null
        : (activeTimeMs / dailyGoalMs) * 100,
      goalReached: dailyGoalMs !== null && activeTimeMs >= dailyGoalMs,
      heatLevel: maximumActiveTimeMs > 0 && activeTimeMs > 0
        ? Math.max(1, Math.ceil((activeTimeMs / maximumActiveTimeMs) * 5))
        : 0,
    };
  });
  const activeDays = days.filter((day) => day.activeTimeMs > 0).length;
  const goalDays = days.filter((day) => day.goalReached).length;
  const goalEligibleDays = dailyGoalMs === null ? 0 : days.length;
  const streaks = calculateStreaks(days.map((day) => day.activeTimeMs > 0));

  return {
    rangeLabel: current.range.startLocalDate === current.range.endLocalDate
      ? current.range.startLocalDate
      : `${current.range.startLocalDate} – ${current.range.endLocalDate}`,
    days,
    activeTimeMs: current.metrics.activeTimeMs,
    comparisonActiveTimeMs: comparison?.metrics.activeTimeMs ?? null,
    comparisonDeltaPercent: comparison === null
      ? null
      : percentageChange(
        current.metrics.activeTimeMs,
        comparison.metrics.activeTimeMs,
      ),
    comparisonStatus,
    activeDays,
    consistencyPercent: days.length === 0 ? 0 : (activeDays / days.length) * 100,
    goalDays,
    goalEligibleDays,
    goalCompletionRatePercent: goalEligibleDays === 0
      ? null
      : (goalDays / goalEligibleDays) * 100,
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    languages: buildLanguageSeries(current, observedDays),
  };
}

function buildLanguageSeries(
  period: RangePeriodViewModel,
  observedDays: ReadonlyMap<string, RangePeriodViewModel["days"][number]>,
): TrendLanguageSeries[] {
  return period.languages
    .filter((language) => language.activeTimeMs > 0)
    .slice(0, 5)
    .map((language) => ({
      id: language.id,
      totalActiveTimeMs: language.activeTimeMs,
      dailyActiveTimeMs: period.range.localDates.map((localDate) =>
        activeTimeForLanguage(observedDays.get(localDate)?.languages, language.id)
      ),
    }));
}

function activeTimeForLanguage(
  languages: readonly RangeDimensionValue[] | undefined,
  languageId: string,
): number {
  return languages?.find((language) => language.id === languageId)
    ?.activeTimeMs ?? 0;
}

function percentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / previous) * 100;
}

function calculateStreaks(activeDays: readonly boolean[]): {
  current: number;
  longest: number;
} {
  let running = 0;
  let longest = 0;
  activeDays.forEach((active) => {
    running = active ? running + 1 : 0;
    longest = Math.max(longest, running);
  });
  return { current: running, longest };
}
