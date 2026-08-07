import { Clock } from "../platform/ports";
import { PersistenceHealth } from "../domain/types";

export type { PersistenceHealth, PersistenceStatus } from "../domain/types";

export interface AsyncWriteQueueOptions {
  clock: Clock;
  debounceMs?: number;
  onBackgroundError?: (error: unknown) => void;
}

type PendingWrite = () => Promise<void>;

const DEFAULT_DEBOUNCE_MS = 10_000;

/**
 * Serializes record-level writes and coalesces repeated updates for the same
 * key. Failed work remains queued and is retried without blocking the caller.
 */
export class AsyncWriteQueue {
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private readonly onBackgroundError: (error: unknown) => void;
  private pending = new Map<string, PendingWrite>();
  private timer: NodeJS.Timeout | undefined;
  private activeFlush: Promise<void> | undefined;
  private inFlightWrites = 0;
  private health: PersistenceHealth = {
    status: "idle",
    pendingWrites: 0,
    lastSuccessfulWriteAt: null,
    lastError: null,
  };

  constructor(options: AsyncWriteQueueOptions) {
    this.clock = options.clock;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onBackgroundError =
      options.onBackgroundError ??
      ((error) => console.error("DevTracker persistence error:", error));
  }

  public enqueue(key: string, write: PendingWrite): void {
    this.pending.set(key, write);
    if (this.health.status !== "failed") {
      this.health.status = "pending";
    }
    this.updatePendingCount();
    this.scheduleFlush();
  }

  public async flush(): Promise<void> {
    this.clearTimer();

    if (this.activeFlush) {
      return this.activeFlush;
    }

    this.activeFlush = this.drain();
    try {
      await this.activeFlush;
    } finally {
      this.activeFlush = undefined;
      if (this.pending.size > 0) {
        this.scheduleFlush();
      }
    }
  }

  public getHealth(): PersistenceHealth {
    this.updatePendingCount();
    return { ...this.health };
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0) {
      const batch = [...this.pending.entries()];
      this.pending.clear();
      this.inFlightWrites = batch.length;
      this.health.status = "writing";
      this.health.lastError = null;
      this.updatePendingCount();

      for (let index = 0; index < batch.length; index += 1) {
        try {
          await batch[index][1]();
          this.inFlightWrites -= 1;
          this.updatePendingCount();
        } catch (error) {
          const failedAndUnattempted = batch.slice(index);
          this.inFlightWrites = 0;
          this.pending = new Map([
            ...failedAndUnattempted,
            ...this.pending.entries(),
          ]);
          this.health.status = "failed";
          this.health.lastError = this.errorMessage(error);
          this.updatePendingCount();
          this.scheduleFlush();
          throw error;
        }
      }

      this.health.lastSuccessfulWriteAt = this.clock.nowMs();
    }

    this.health.status = "idle";
    this.health.lastError = null;
    this.updatePendingCount();
  }

  private scheduleFlush(): void {
    if (this.timer || this.activeFlush) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error) => {
        this.onBackgroundError(error);
      });
    }, this.debounceMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private updatePendingCount(): void {
    this.health.pendingWrites = this.pending.size + this.inFlightWrites;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
