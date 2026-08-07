import { RangeAnalyticsQueryService } from "../application/ports";
import { RangeQueryRequest, RangeQueryViewModel } from "../domain/rangeQuery";
import { Clock } from "../platform/ports";
import { ExportDataSource } from "./ExportService";

export interface DailyRollupHistoryBoundsReader {
  getDailyRollupDateBounds(): Promise<{
    startLocalDate: string;
    endLocalDate: string;
  } | null>;
}

export class RangeExportDataSource implements ExportDataSource {
  public constructor(
    private readonly ranges: RangeAnalyticsQueryService,
    private readonly history: DailyRollupHistoryBoundsReader,
    private readonly clock: Clock,
  ) {}

  public queryRange(request: RangeQueryRequest): Promise<RangeQueryViewModel> {
    return this.ranges.query(request);
  }

  public async queryCompleteHistory(): Promise<RangeQueryViewModel> {
    const bounds = await this.history.getDailyRollupDateBounds();
    if (!bounds) {
      return this.ranges.query({ preset: "today" });
    }
    return this.ranges.query({
      preset: "custom",
      startLocalDate: bounds.startLocalDate,
      endLocalDate: minLocalDate(
        bounds.endLocalDate,
        localDateKey(this.clock.now()),
      ),
    });
  }
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minLocalDate(left: string, right: string): string {
  return left < right ? left : right;
}
