import {
  DebugMetricObservation,
  DebugMetricSink,
} from "../application/ports";
import { SessionStoreV2 } from "./SessionStoreV2";

/** Serializes aggregate-only debug metrics into schema-v2 daily rollups. */
export class SessionDebugMetricsRecorder implements DebugMetricSink {
  private tail: Promise<void> = Promise.resolve();
  private firstFailure: unknown;

  constructor(private readonly store: SessionStoreV2) {}

  public recordDebugMetrics(value: DebugMetricObservation): void {
    const snapshot = { ...value };
    this.tail = this.tail
      .then(() =>
        this.store.addDebugMetrics(
          snapshot.projectId,
          snapshot.localDate,
          snapshot.debugElapsedMs,
          snapshot.debugActiveTimeMs,
        ),
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
