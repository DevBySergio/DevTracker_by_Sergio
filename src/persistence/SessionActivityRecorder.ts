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
    const snapshot = { ...value };
    this.tail = this.tail
      .then(() =>
        this.store.appendInterval(this.sessionId, {
          schemaVersion: SCHEMA_VERSION,
          id: this.createIntervalId(),
          sessionId: this.sessionId,
          ...snapshot,
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

    const appendFailure = this.firstFailure;
    this.firstFailure = undefined;
    if (appendFailure !== undefined) {
      throw appendFailure;
    }
    if (storeFailure !== undefined) {
      throw storeFailure;
    }
  }
}
