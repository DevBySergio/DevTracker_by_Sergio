import type { RangePeriodViewModel } from "../domain/rangeQuery";
import type {
  DistributionValue,
  Insight,
} from "../queries/PersonalInsights";
import { buildPersonalInsights } from "../queries/PersonalInsights";

export interface OverviewDistributionValue extends DistributionValue {
  readonly label: string;
}

export interface OverviewTimelineBucket {
  readonly label: string;
  readonly activeTimeMs: number;
}

export interface OverviewViewModel {
  readonly hasActivity: boolean;
  readonly activeTimeMs: number;
  readonly dailyGoalMs: number | null;
  readonly dailyGoalCompletionPercent: number | null;
  readonly uniqueActiveFiles: number | null;
  readonly flowBlockCount: number;
  readonly focusProfile: {
    readonly topThreeFileSharePercent: Insight<number>;
    readonly fileSwitchesPerActiveHour: Insight<number>;
    readonly typicalFlowActiveMs: Insight<number>;
  };
  readonly projectDistribution: readonly OverviewDistributionValue[];
  readonly languageDistribution: readonly OverviewDistributionValue[];
  readonly timeline: readonly OverviewTimelineBucket[];
}

/**
 * Adapts the bounded one-day range projection to the Overview UI. Metric
 * formulas stay delegated to PersonalInsights; this layer only supplies
 * labels, the 96 wall-clock buckets, and presentation-specific availability.
 */
export function buildOverviewViewModel(
  period: RangePeriodViewModel,
  dailyGoalSeconds: number,
  fileDetailAvailable: boolean,
): OverviewViewModel {
  const normalizedPeriod = ensureSelectedDay(period);
  const dailyGoalMs = secondsToMilliseconds(dailyGoalSeconds);
  const insights = buildPersonalInsights({
    period: normalizedPeriod,
    dailyGoalMs,
    selectedLocalDate: normalizedPeriod.range.endLocalDate,
    todayLocalDate: normalizedPeriod.range.endLocalDate,
    fileDetailAvailable,
  });

  return Object.freeze({
    hasActivity: normalizedPeriod.metrics.activeTimeMs > 0,
    activeTimeMs: normalizedPeriod.metrics.activeTimeMs,
    dailyGoalMs,
    dailyGoalCompletionPercent:
      insights.dailyGoalCompletionPercent.value,
    uniqueActiveFiles: fileDetailAvailable
      ? normalizedPeriod.files.filter((file) => file.activeTimeMs > 0).length
      : null,
    flowBlockCount: normalizedPeriod.metrics.flowBlockCount,
    focusProfile: insights.focusProfile,
    projectDistribution: labelDistribution(
      insights.projectDistribution.value,
      new Map(
        normalizedPeriod.projects.map((project) => [
          project.project.id,
          project.project.displayName,
        ]),
      ),
    ),
    languageDistribution: labelDistribution(
      insights.languageDistribution.value,
      new Map(),
    ),
    timeline: quarterHourTimeline(normalizedPeriod),
  });
}

function ensureSelectedDay(
  period: RangePeriodViewModel,
): RangePeriodViewModel {
  if (
    period.days.some(
      (day) => day.localDate === period.range.endLocalDate,
    )
  ) {
    return period;
  }
  return {
    ...period,
    days: [{
      localDate: period.range.endLocalDate,
      metrics: period.metrics,
    }],
  };
}

function secondsToMilliseconds(value: number): number | null {
  const milliseconds = value * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : null;
}

function labelDistribution(
  values: readonly DistributionValue[] | null,
  labels: ReadonlyMap<string, string>,
): readonly OverviewDistributionValue[] {
  return Object.freeze(
    (values ?? [])
      .filter((value) => value.activeTimeMs > 0)
      .map((value) => Object.freeze({
        ...value,
        label: labels.get(value.id) ?? value.id,
      })),
  );
}

function quarterHourTimeline(
  period: RangePeriodViewModel,
): readonly OverviewTimelineBucket[] {
  const totals = new Array<number>(96).fill(0);
  period.quarterHours.forEach((bucket) => {
    if (bucket.localDate !== period.range.endLocalDate) {
      return;
    }
    const match = /^(\d{2}):(\d{2})\b/.exec(bucket.label);
    if (!match) {
      return;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute % 15 !== 0 || minute > 45) {
      return;
    }
    totals[hour * 4 + minute / 15] += bucket.activeTimeMs;
  });
  return Object.freeze(totals.map((activeTimeMs, index) => Object.freeze({
    label: `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
    activeTimeMs,
  })));
}
