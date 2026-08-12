import { randomUUID } from "crypto";
import {
  ActivityIntervalObservation,
  ActivityIntervalSink,
} from "../application/ports";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { SessionStoreV2 } from "./SessionStoreV2";

export interface SessionActivityRecorderOptions {
  store: SessionStoreV2;
  sessionId: string;
  createIntervalId?: () => string;
}

/**
 * Bridges synchronous tracking transitions to the asynchronous per-session
 * store. Append failures are retained and surfaced at the next lifecycle
 * flush without preventing later observations from being attempted.
 */
export class SessionActivityRecorder implements ActivityIntervalSink {
  private readonly store: SessionStoreV2;
  private readonly sessionId: string;
  private readonly createIntervalId: () => string;
  private tail: Promise<void> = Promise.resolve();
  private firstFailure: unknown;

  constructor(options: SessionActivityRecorderOptions) {
    this.store = options.store;
    this.sessionId = options.sessionId;
    this.createIntervalId =
      options.createIntervalId ?? (() => `interval-${randomUUID()}`);
  }

  public recordActivityInterval(value: ActivityIntervalObservation): void {
    const snapshot = this.normalize(value);
    if (snapshot.endedAt === snapshot.startedAt) {
      return;
    }
    this.tail = this.tail
      .then(async () => {
        await this.store.appendInterval(this.sessionId, {
          schemaVersion: SCHEMA_VERSION,
          id: this.createIntervalId(),
          sessionId: this.sessionId,
          projectId: snapshot.projectId,
          documentId: snapshot.documentId,
          languageId: snapshot.languageId,
          startedAt: snapshot.startedAt,
          endedAt: snapshot.endedAt,
          monotonicStartedAt: snapshot.monotonicStartedAt,
          monotonicEndedAt: snapshot.monotonicEndedAt,
          lastInteractionAt: snapshot.lastInteractionAt,
        });
        const durationMs = snapshot.endedAt - snapshot.startedAt;
        await this.store.applyDailyMetricDelta(
          snapshot.projectId,
          snapshot.localDate,
          {
            activeTimeMs: durationMs,
            activeTimeByLanguageMs:
              snapshot.languageId === null
                ? {}
                : { [snapshot.languageId]: durationMs },
            activeTimeByDocumentMs:
              snapshot.documentId === null
                ? {}
                : { [snapshot.documentId]: durationMs },
            activeTimeByQuarterHourMs: this.quarterHourDurations(
              snapshot.startedAt,
              snapshot.endedAt,
            ),
            activeTimeByGitBranchMs:
              snapshot.gitBranch === null
                ? {}
                : { [snapshot.gitBranch]: durationMs },
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

    const appendFailure = this.firstFailure;
    this.firstFailure = undefined;
    if (appendFailure !== undefined) {
      throw appendFailure;
    }
    if (storeFailure !== undefined) {
      throw storeFailure;
    }
  }

  private normalize(
    value: ActivityIntervalObservation,
  ): ActivityIntervalObservation {
    return {
      ...value,
      startedAt: this.integerBoundary(value.startedAt, "startedAt"),
      endedAt: this.integerBoundary(value.endedAt, "endedAt"),
      monotonicStartedAt: this.integerBoundary(
        value.monotonicStartedAt,
        "monotonicStartedAt",
      ),
      monotonicEndedAt: this.integerBoundary(
        value.monotonicEndedAt,
        "monotonicEndedAt",
      ),
      lastInteractionAt: this.integerBoundary(
        value.lastInteractionAt,
        "lastInteractionAt",
      ),
    };
  }

  private integerBoundary(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative finite number`);
    }
    const rounded = Math.round(value);
    if (!Number.isSafeInteger(rounded)) {
      throw new Error(`${name} exceeds the safe integer range`);
    }
    return rounded;
  }

  private quarterHourDurations(
    startedAt: number,
    endedAt: number,
  ): Record<string, number> {
    const durations: Record<string, number> = {};
    let cursor = startedAt;
    while (cursor < endedAt) {
      const date = new Date(cursor);
      const bucketStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        Math.floor(date.getMinutes() / 15) * 15,
      ).getTime();
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setMinutes(bucketEnd.getMinutes() + 15);
      const sliceEnd = Math.min(endedAt, bucketEnd.getTime());
      durations[String(bucketStart)] =
        (durations[String(bucketStart)] ?? 0) + sliceEnd - cursor;
      cursor = sliceEnd;
    }
    return durations;
  }
}
