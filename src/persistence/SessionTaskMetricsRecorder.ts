import {
  TaskMetricObservation,
  TaskMetricSink,
} from "../application/ports";
import { SessionStoreV2 } from "./SessionStoreV2";

/** Serializes privacy-bounded task outcomes into schema-v2 daily rollups. */
export class SessionTaskMetricsRecorder implements TaskMetricSink {
  private tail: Promise<void> = Promise.resolve();
  private firstFailure: unknown;

  constructor(private readonly store: SessionStoreV2) {}

  public recordTaskRun(value: TaskMetricObservation): void {
    const snapshot = { ...value };
    this.tail = this.tail
      .then(() =>
        this.store.addTaskRun(snapshot.projectId, snapshot.localDate, {
          configuredName: snapshot.configuredName,
          classification: snapshot.classification,
          durationMs: snapshot.durationMs,
          result: snapshot.result,
        }),
      )
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
