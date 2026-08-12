import {
  DailyContextSwitchObservation,
  DailyEditMetricObservation,
  DailyEventMetricObservation,
  DailyFlowMetricObservation,
  DailyMetricSink,
} from "../application/ports";
import { SessionStoreV2 } from "./SessionStoreV2";

/** Serializes exact editor and flow events into schema-v2 daily rollups. */
export class SessionDailyMetricsRecorder implements DailyMetricSink {
  private tail: Promise<void> = Promise.resolve();
  private firstFailure: unknown;
  private readonly currentFlowMs = new Map<string, number>();

  constructor(private readonly store: SessionStoreV2) {}

  public recordEditActivity(value: DailyEditMetricObservation): void {
    this.enqueue(value, {
      editEvents: 1,
      insertedCharacters: value.insertedCharacters,
      removedCharacters: value.removedCharacters,
      largeEditEvents: value.largeEditEvents,
      insertedLineBreaksApprox: value.insertedLineBreaksApprox,
      removedLineBreaksApprox: value.removedLineBreaksApprox,
    });
  }

  public recordSave(value: DailyEventMetricObservation): void {
    this.enqueue(value, { saveEvents: 1 });
  }

  public recordContextSwitch(value: DailyContextSwitchObservation): void {
    this.enqueue(value, {
      fileSwitchEvents: 1,
      projectSwitchEvents: value.projectSwitch ? 1 : 0,
    });
  }

  public recordFlowBlock(value: DailyEventMetricObservation): void {
    this.currentFlowMs.set(this.key(value), 0);
    this.enqueue(value, { flowBlockCount: 1 });
  }

  public recordFlowActiveTime(value: DailyFlowMetricObservation): void {
    const key = this.key(value);
    const current = (this.currentFlowMs.get(key) ?? 0) + value.durationMs;
    this.currentFlowMs.set(key, current);
    this.enqueue(value, {
      flowActiveMs: value.durationMs,
      longestFlowActiveMs: current,
    });
  }

  public closeFlow(value: DailyEventMetricObservation): void {
    this.currentFlowMs.delete(this.key(value));
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

  private enqueue(
    value: DailyEventMetricObservation,
    delta: Parameters<SessionStoreV2["applyDailyMetricDelta"]>[2],
  ): void {
    const projectId = value.projectId;
    const localDate = value.localDate;
    this.tail = this.tail
      .then(() =>
        this.store.applyDailyMetricDelta(projectId, localDate, delta),
      )
      .then(
        () => undefined,
        (error) => {
          this.firstFailure ??= error;
        },
      );
  }

  private key(value: DailyEventMetricObservation): string {
    return `${value.projectId}\0${value.localDate}`;
  }
}
