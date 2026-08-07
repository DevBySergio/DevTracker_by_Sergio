import {
  DiagnosticBucketObservation,
  DiagnosticBucketSink,
} from "../application/ports";
import { DiagnosticTimeBucket } from "../domain/schemaV2";
import { SessionStoreV2 } from "./SessionStoreV2";

/** Serializes diagnostic bucket replacements into schema-v2 daily rollups. */
export class SessionDiagnosticsRecorder implements DiagnosticBucketSink {
  private tail: Promise<void> = Promise.resolve();
  private firstFailure: unknown;

  constructor(private readonly store: SessionStoreV2) {}

  public recordDiagnosticBucket(value: DiagnosticBucketObservation): void {
    const bucket: DiagnosticTimeBucket = {
      bucketStartedAt: value.bucketStartedAt,
      bucketEndedAt: value.bucketEndedAt,
      observedAt: value.observedAt,
      diagnostics: JSON.parse(JSON.stringify(value.diagnostics)),
    };
    const localDate = this.localDateKey(value.bucketStartedAt);
    this.tail = this.tail
      .then(() =>
        this.store.applyDiagnosticBucket(value.projectId, localDate, bucket),
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

  private localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}
