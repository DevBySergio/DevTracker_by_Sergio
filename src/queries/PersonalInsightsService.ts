import { RangeAnalyticsQueryService } from "../application/ports";
import {
  RangePeriodViewModel,
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";
import { Clock } from "../platform/ports";
import {
  PersonalInsights,
  buildPersonalInsights,
} from "./PersonalInsights";

export interface PersonalInsightGoalReader {
  getDailyGoal(): number;
  getWeeklyGoal(): number | null;
}

export interface PersonalInsightsServiceOptions {
  ranges: RangeAnalyticsQueryService;
  goals: PersonalInsightGoalReader;
  clock: Clock;
  fileDetailAvailable(): boolean;
}

export interface PersonalInsightsViewModel {
  range: RangeQueryViewModel;
  insights: PersonalInsights;
}

/** Assembles the independent calendar ranges required by transparent insights. */
export class PersonalInsightsService {
  public constructor(private readonly options: PersonalInsightsServiceOptions) {}

  public async query(
    request: RangeQueryRequest,
  ): Promise<PersonalInsightsViewModel> {
    const range = await this.options.ranges.query(request);
    const todayLocalDate = localDateKey(this.options.clock.now());
    const selectedLocalDate = range.current.range.endLocalDate;
    const weekStart = addCalendarDays(
      selectedLocalDate,
      -(dayOfWeek(selectedLocalDate) + 6) % 7,
    );
    const weekEnd = minLocalDate(
      addCalendarDays(weekStart, 6),
      todayLocalDate,
    );
    const projectIds = request.projectIds
      ? [...request.projectIds]
      : undefined;
    const weeklyRequest: RangeQueryRequest = {
      preset: "custom",
      startLocalDate: weekStart,
      endLocalDate: weekEnd,
      ...(projectIds ? { projectIds } : {}),
    };
    const previousWeekRequests = Array.from({ length: 4 }, (_value, index) => {
      const endLocalDate = addCalendarDays(weekStart, -(index * 7 + 1));
      return {
        preset: "custom" as const,
        startLocalDate: addCalendarDays(endLocalDate, -6),
        endLocalDate,
        ...(projectIds ? { projectIds } : {}),
      };
    });
    const [weekly, ...previousWeeks] = await Promise.all([
      this.options.ranges.query(weeklyRequest),
      ...previousWeekRequests.map((week) => this.options.ranges.query(week)),
    ]);

    return {
      range,
      insights: buildPersonalInsights({
        period: range.current,
        weeklyPeriod: weekly.current,
        selectedLocalDate,
        todayLocalDate,
        previousCompleteWeeks: previousWeeks.map(
          (value): RangePeriodViewModel => value.current,
        ),
        dailyGoalMs: secondsToMilliseconds(this.options.goals.getDailyGoal()),
        weeklyGoalMs: secondsToMilliseconds(
          this.options.goals.getWeeklyGoal(),
        ),
        fileDetailAvailable: this.options.fileDetailAvailable(),
      }),
    };
  }
}

function secondsToMilliseconds(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  const milliseconds = value * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : null;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayOfWeek(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addCalendarDays(localDate: string, amount: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function minLocalDate(left: string, right: string): string {
  return left < right ? left : right;
}
