import {
  GitMetricObservation,
  GitMetricSink,
} from "../application/ports";
import { SessionStoreV2 } from "./SessionStoreV2";

/** Serializes Git snapshots and transition counters into daily rollups. */
export class SessionGitMetricsRecorder implements GitMetricSink {
  private tail: Promise<void> = Promise.resolve();
  private firstFailure: unknown;

  public constructor(private readonly store: SessionStoreV2) {}

  public recordGitMetrics(value: GitMetricObservation): void {
    const snapshot = { ...value };
    this.tail = this.tail
      .then(async () => {
        await this.store.applyDailyMetricDelta(
          snapshot.projectId,
          snapshot.localDate,
          {
            gitStatus: snapshot.status,
            gitDirtyFiles: snapshot.dirtyFiles,
            gitBranchChanges: snapshot.branchChanges,
            gitDetectedCommits: snapshot.detectedCommits,
          },
        );
      })
      .then(
        () => undefined,
        (error) => {
          this.firstFailure ??= error;
        },
      );
  }

  public async flush(): Promise<void> {
    await this.tail;
    let storeFailure: unknown;
    try {
      await this.store.flush();
    } catch (error) {
      storeFailure = error;
    }
    const recordFailure = this.firstFailure;
    this.firstFailure = undefined;
    if (recordFailure !== undefined) {
      throw recordFailure;
    }
    if (storeFailure !== undefined) {
      throw storeFailure;
    }
  }
}
