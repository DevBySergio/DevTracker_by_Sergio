import { DebugMetricObservation } from "../application/ports";
import { Clock } from "../platform/ports";
import { ActiveTimeSlice } from "./ActivityStateMachine";

export interface DebugSessionDescriptor {
  id: string;
  projectId: string | null;
}

export interface DebugSessionTrackerOptions {
  clock: Clock;
  privacyEnabled?: boolean;
}

/**
 * Owns the ephemeral set of debug sessions and emits aggregate-only metrics.
 * No launch configuration, arguments, adapter messages, or source data enter
 * this boundary.
 */
export class DebugSessionTracker {
  private readonly clock: Clock;
  private readonly activeSessionIds = new Set<string>();
  private readonly projectIds = new Map<string, string | null>();
  private readonly startOrder = new Map<string, number>();
  private nextStartOrder = 0;
  private activeSessionId: string | undefined;
  private privacyEnabled: boolean;
  private paused = false;
  private lastObservedMonotonicMs: number;
  private lastObservedWallMs: number;

  constructor(options: DebugSessionTrackerOptions) {
    this.clock = options.clock;
    this.privacyEnabled = options.privacyEnabled ?? false;
    const now = this.readNow();
    this.lastObservedMonotonicMs = now.monotonicMs;
    this.lastObservedWallMs = now.wallMs;
  }

  public startSession(value: DebugSessionDescriptor): DebugMetricObservation[] {
    this.assertSessionId(value.id);
    this.assertProjectId(value.projectId);
    const updates = this.advance();
    if (!this.activeSessionIds.has(value.id)) {
      this.activeSessionIds.add(value.id);
      this.startOrder.set(value.id, this.nextStartOrder++);
    }
    this.projectIds.set(value.id, value.projectId);
    this.activeSessionId = value.id;
    return updates;
  }

  public terminateSession(sessionId: string): DebugMetricObservation[] {
    this.assertSessionId(sessionId);
    const updates = this.advance();
    this.activeSessionIds.delete(sessionId);
    this.projectIds.delete(sessionId);
    this.startOrder.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.latestSessionId();
    }
    return updates;
  }

  public setActiveSession(
    sessionId: string | undefined,
  ): DebugMetricObservation[] {
    if (sessionId !== undefined) {
      this.assertSessionId(sessionId);
    }
    const updates = this.advance();
    this.activeSessionId =
      sessionId !== undefined && this.activeSessionIds.has(sessionId)
        ? sessionId
        : undefined;
    return updates;
  }

  public setPrivacyEnabled(enabled: boolean): DebugMetricObservation[] {
    const updates = this.advance();
    this.privacyEnabled = enabled;
    return updates;
  }

  public setPaused(paused: boolean): DebugMetricObservation[] {
    const updates = this.advance();
    this.paused = paused;
    return updates;
  }

  public tick(): DebugMetricObservation[] {
    return this.advance();
  }

  public stopAll(): DebugMetricObservation[] {
    const updates = this.advance();
    this.activeSessionIds.clear();
    this.projectIds.clear();
    this.startOrder.clear();
    this.activeSessionId = undefined;
    return updates;
  }

  public recordActiveTime(
    projectId: string,
    slices: readonly ActiveTimeSlice[],
  ): DebugMetricObservation[] {
    this.assertProjectId(projectId);
    if (!this.isCollecting()) {
      return [];
    }
    this.associateCurrentSession(projectId);
    const totals = new Map<string, number>();
    slices.forEach((slice) => {
      const durationMs = Math.round(slice.durationMs);
      this.assertDuration(durationMs, "active debug duration");
      if (durationMs === 0) {
        return;
      }
      totals.set(
        slice.localDateKey,
        this.safeAdd(
          totals.get(slice.localDateKey) ?? 0,
          durationMs,
          "active debug duration",
        ),
      );
    });
    return [...totals]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([localDate, debugActiveTimeMs]) => ({
        projectId,
        localDate,
        debugElapsedMs: 0,
        debugActiveTimeMs,
      }));
  }

  public isCollecting(): boolean {
    return (
      this.privacyEnabled && !this.paused && this.activeSessionIds.size > 0
    );
  }

  public getActiveSessionIds(): string[] {
    return [...this.activeSessionIds].sort();
  }

  private advance(): DebugMetricObservation[] {
    const now = this.readNow();
    const monotonicMs = Math.max(
      now.monotonicMs,
      this.lastObservedMonotonicMs,
    );
    const durationMs = monotonicMs - this.lastObservedMonotonicMs;
    const wallStartMs = this.lastObservedWallMs;
    this.lastObservedMonotonicMs = monotonicMs;
    this.lastObservedWallMs = now.wallMs;

    if (!this.isCollecting() || durationMs <= 0) {
      return [];
    }
    const projectId = this.attributedProjectId();
    if (!projectId) {
      return [];
    }
    return this.splitByLocalDate(wallStartMs, durationMs).map(
      ({ localDate, durationMs: debugElapsedMs }) => ({
        projectId,
        localDate,
        debugElapsedMs,
        debugActiveTimeMs: 0,
      }),
    );
  }

  private attributedProjectId(): string | null {
    if (this.activeSessionId) {
      const activeProjectId = this.projectIds.get(this.activeSessionId);
      if (activeProjectId) {
        return activeProjectId;
      }
    }
    const fallback = [...this.activeSessionIds]
      .filter((sessionId) => this.projectIds.get(sessionId) !== null)
      .sort(
        (left, right) =>
          (this.startOrder.get(right) ?? -1) -
          (this.startOrder.get(left) ?? -1),
      )[0];
    return fallback ? (this.projectIds.get(fallback) ?? null) : null;
  }

  private latestSessionId(): string | undefined {
    return [...this.activeSessionIds].sort(
      (left, right) =>
        (this.startOrder.get(right) ?? -1) -
        (this.startOrder.get(left) ?? -1),
    )[0];
  }

  private associateCurrentSession(projectId: string): void {
    const sessionId =
      this.activeSessionId && this.activeSessionIds.has(this.activeSessionId)
        ? this.activeSessionId
        : this.latestSessionId();
    if (sessionId && this.projectIds.get(sessionId) === null) {
      this.projectIds.set(sessionId, projectId);
    }
  }

  private splitByLocalDate(
    wallStartMs: number,
    durationMs: number,
  ): Array<{ localDate: string; durationMs: number }> {
    const values: Array<{ localDate: string; durationMs: number }> = [];
    let wallCursor = wallStartMs;
    let remaining = durationMs;
    while (remaining > 0) {
      const date = new Date(wallCursor);
      const nextMidnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1,
      ).getTime();
      const sliceDuration = Math.min(
        remaining,
        Math.max(1, nextMidnight - wallCursor),
      );
      values.push({
        localDate: this.localDateKey(date),
        durationMs: sliceDuration,
      });
      wallCursor += sliceDuration;
      remaining -= sliceDuration;
    }
    return values;
  }

  private readNow(): { monotonicMs: number; wallMs: number } {
    return {
      monotonicMs: Math.floor(
        this.clock.monotonicNowMs?.() ?? this.clock.nowMs(),
      ),
      wallMs: this.clock.now().getTime(),
    };
  }

  private localDateKey(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  private assertSessionId(value: string): void {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new Error("Debug session id is invalid");
    }
  }

  private assertProjectId(value: string | null): void {
    if (value !== null && !/^[A-Za-z0-9._-]+$/u.test(value)) {
      throw new Error("Debug project id is invalid");
    }
  }

  private assertDuration(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }

  private safeAdd(left: number, right: number, name: string): number {
    const value = left + right;
    this.assertDuration(value, name);
    return value;
  }
}
