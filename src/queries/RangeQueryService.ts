import {
  DailyRollupRangeReader,
  RangeAnalyticsQueryService,
} from "../application/ports";
import {
  RangeQueryRequest,
  RangeQueryViewModel,
} from "../domain/rangeQuery";
import { RangeQueryEngine } from "./RangeQueryEngine";

/** Loads exact range keys and delegates pure aggregation to the indexed engine. */
export class RangeQueryService implements RangeAnalyticsQueryService {
  private readonly loadedScopes = new Map<string, number>();

  constructor(
    private readonly reader: DailyRollupRangeReader,
    private readonly engine: RangeQueryEngine,
  ) {}

  public async query(request: RangeQueryRequest): Promise<RangeQueryViewModel> {
    const projects = await this.reader.listProjectIdentities();
    this.engine.setProjectIdentities(projects);
    const normalized = this.engine.normalize(request);
    const projectIds = normalized.projectIds ?? projects.map(({ id }) => id);
    const localDates = [
      ...normalized.current.localDates,
      ...(normalized.comparison?.localDates ?? []),
    ];
    const revision = this.reader.getRollupRevision();
    const scopeKey = JSON.stringify({ projectIds, localDates });
    if (this.loadedScopes.get(scopeKey) !== revision) {
      const rollups = await this.reader.readDailyRollups(
        projectIds,
        localDates,
      );
      this.engine.replaceScope(projectIds, localDates, rollups);
      this.loadedScopes.set(scopeKey, revision);
    }
    return this.engine.query(request);
  }
}
