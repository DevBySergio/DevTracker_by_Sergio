import { CurrentFlowMetrics, TrackingStatus } from "../domain/types";
import { Clock } from "../platform/ports";

export type ActivityInteraction =
  | "edit"
  | "selection"
  | "save"
  | "active-editor";

export interface ActiveTimeSlice {
  localDateKey: string;
  durationMs: number;
  /** Wall-clock boundaries projected from the previous observation anchor. */
  startedAt: number;
  endedAt: number;
  /** Exact elapsed-time boundaries from the monotonic clock. */
  monotonicStartedAt: number;
  monotonicEndedAt: number;
  /** Wall time of the accepted interaction authorizing this slice. */
  lastInteractionAt: number;
}

export interface EditorActivityContext {
  fileId: string;
  projectId: string;
}

export interface ConfirmedContextSwitch {
  destinationProjectId: string;
  localDateKey: string;
  fileSwitch: true;
  projectSwitch: boolean;
}

export interface ActivityStateSnapshot {
  status: TrackingStatus;
  lastUpdatedAt: number;
  flow: CurrentFlowMetrics;
}

export interface ActivityTransition extends ActivityStateSnapshot {
  slices: ActiveTimeSlice[];
  flowSlices: ActiveTimeSlice[];
  flowBlockStartedAtLocalDateKey?: string;
  flowClosedAtLocalDateKey?: string;
  confirmedContextSwitches: ConfirmedContextSwitch[];
  interactionAccepted: boolean;
}

export interface ActivityStateMachineOptions {
  clock: Clock;
  inactivityTimeoutMs?: number;
  selectionDebounceMs?: number;
  contextSwitchConfirmationMs?: number;
  flowTimeoutMs?: number;
  initiallyFocused?: boolean;
}

export const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_SELECTION_DEBOUNCE_MS = 1000;
export const DEFAULT_CONTEXT_SWITCH_CONFIRMATION_MS = 5000;
export const DEFAULT_FLOW_TIMEOUT_MS = 120 * 1000;

interface PendingContextSwitch {
  context: EditorActivityContext;
  startedAtMonotonicMs: number;
}

interface AdvanceResult {
  slices: ActiveTimeSlice[];
  flowSlices: ActiveTimeSlice[];
  confirmedContextSwitches: ConfirmedContextSwitch[];
  flowClosedAtLocalDateKey?: string;
}

/**
 * Converts editor interactions and lifecycle changes into bounded active-time
 * slices. Durations always come from a monotonic clock; wall time is used only
 * to assign those durations to local calendar dates.
 */
export class ActivityStateMachine {
  private readonly clock: Clock;
  private readonly inactivityTimeoutMs: number;
  private readonly selectionDebounceMs: number;
  private readonly contextSwitchConfirmationMs: number;
  private readonly flowTimeoutMs: number;
  private focused: boolean;
  private paused = false;
  private status: TrackingStatus;
  private lastInteractionMonotonicMs: number | undefined;
  private lastInteractionWallMs: number | undefined;
  private lastSelectionMonotonicMs: number | undefined;
  private lastObservedMonotonicMs: number;
  private lastObservedWallMs: number;
  private lastUpdatedAt: number;
  private flowOpen = false;
  private lastFlowInteractionMonotonicMs: number | undefined;
  private currentFlowActiveMs = 0;
  private flowActiveMs = 0;
  private longestFlowActiveMs = 0;
  private flowBlockCount = 0;
  private confirmedContext: EditorActivityContext | undefined;
  private pendingContextSwitch: PendingContextSwitch | undefined;

  constructor(options: ActivityStateMachineOptions) {
    this.clock = options.clock;
    this.inactivityTimeoutMs =
      options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.selectionDebounceMs =
      options.selectionDebounceMs ?? DEFAULT_SELECTION_DEBOUNCE_MS;
    this.contextSwitchConfirmationMs =
      options.contextSwitchConfirmationMs ??
      DEFAULT_CONTEXT_SWITCH_CONFIRMATION_MS;
    this.flowTimeoutMs = options.flowTimeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS;
    this.focused = options.initiallyFocused ?? true;

    const now = this.readNow();
    this.lastObservedMonotonicMs = now.monotonicMs;
    this.lastObservedWallMs = now.wallMs;
    this.lastUpdatedAt = now.wallMs;
    this.status = this.focused ? "inactive" : "unfocused";
  }

  public interact(
    interaction: ActivityInteraction,
    editorContext?: EditorActivityContext,
  ): ActivityTransition {
    const now = this.readNow();
    const advanced = this.advance(now.monotonicMs, now.wallMs);
    const monotonicMs = this.lastObservedMonotonicMs;

    if (this.paused || !this.focused) {
      return this.transition(advanced, false);
    }

    if (
      interaction === "selection" &&
      this.lastSelectionMonotonicMs !== undefined &&
      monotonicMs - this.lastSelectionMonotonicMs <
        this.selectionDebounceMs
    ) {
      return this.transition(advanced, false);
    }

    if (interaction === "selection") {
      this.lastSelectionMonotonicMs = monotonicMs;
    }
    this.lastInteractionMonotonicMs = monotonicMs;
    this.lastInteractionWallMs = now.wallMs;
    const flowBlockStarted = !this.flowOpen;
    if (flowBlockStarted) {
      this.flowOpen = true;
      this.currentFlowActiveMs = 0;
      this.flowBlockCount += 1;
    }
    this.lastFlowInteractionMonotonicMs = monotonicMs;
    if (interaction === "active-editor" && editorContext) {
      this.observeEditorContext(editorContext, monotonicMs);
    }
    this.setStatus("active", now.wallMs, true);
    return this.transition(
      advanced,
      true,
      flowBlockStarted ? this.localDateKey(new Date(now.wallMs)) : undefined,
    );
  }

  public tick(): ActivityTransition {
    const now = this.readNow();
    return this.transition(this.advance(now.monotonicMs, now.wallMs), false);
  }

  public pause(): ActivityTransition {
    const now = this.readNow();
    const advanced = this.advance(now.monotonicMs, now.wallMs);
    this.paused = true;
    const flowClosedAtLocalDateKey = this.closeFlowAt(now.wallMs);
    this.pendingContextSwitch = undefined;
    this.setStatus("paused", now.wallMs);
    return this.transition(
      advanced,
      false,
      undefined,
      flowClosedAtLocalDateKey,
    );
  }

  public resume(): ActivityTransition {
    const now = this.readNow();
    const advanced = this.advance(now.monotonicMs, now.wallMs);
    this.paused = false;
    this.setStatus(this.statusFor(this.lastObservedMonotonicMs), now.wallMs);
    return this.transition(advanced, false);
  }

  public setFocused(focused: boolean): ActivityTransition {
    const now = this.readNow();
    const advanced = this.advance(now.monotonicMs, now.wallMs);
    this.focused = focused;
    let flowClosedAtLocalDateKey: string | undefined;
    if (!focused) {
      flowClosedAtLocalDateKey = this.closeFlowAt(now.wallMs);
      this.pendingContextSwitch = undefined;
    }
    this.setStatus(this.statusFor(this.lastObservedMonotonicMs), now.wallMs);
    return this.transition(
      advanced,
      false,
      undefined,
      flowClosedAtLocalDateKey,
    );
  }

  public clearContext(): ActivityTransition {
    const now = this.readNow();
    const advanced = this.advance(now.monotonicMs, now.wallMs);
    this.lastInteractionMonotonicMs = undefined;
    this.lastInteractionWallMs = undefined;
    const flowClosedAtLocalDateKey = this.closeFlowAt(now.wallMs);
    this.pendingContextSwitch = undefined;
    this.setStatus(this.statusFor(this.lastObservedMonotonicMs), now.wallMs);
    return this.transition(
      advanced,
      false,
      undefined,
      flowClosedAtLocalDateKey,
    );
  }

  public getSnapshot(): ActivityStateSnapshot {
    return {
      status: this.status,
      lastUpdatedAt: this.lastUpdatedAt,
      flow: this.flowSnapshot(),
    };
  }

  private advance(monotonicMs: number, wallMs: number): AdvanceResult {
    const boundedMonotonicMs = Math.max(
      monotonicMs,
      this.lastObservedMonotonicMs,
    );
    let activeDurationMs = 0;
    let activeEndMonotonicMs = this.lastObservedMonotonicMs;

    if (
      this.status === "active" &&
      this.lastInteractionMonotonicMs !== undefined
    ) {
      const inactivityDeadline =
        this.lastInteractionMonotonicMs + this.inactivityTimeoutMs;
      activeEndMonotonicMs = Math.min(
        boundedMonotonicMs,
        inactivityDeadline,
      );
      activeDurationMs = Math.max(
        0,
        activeEndMonotonicMs - this.lastObservedMonotonicMs,
      );
    }

    let flowDurationMs = 0;
    let flowClosedAtLocalDateKey: string | undefined;
    if (
      this.status === "active" &&
      this.flowOpen &&
      this.lastFlowInteractionMonotonicMs !== undefined
    ) {
      const flowDeadline =
        this.lastFlowInteractionMonotonicMs + this.flowTimeoutMs;
      const midnightDeadline =
        this.lastObservedMonotonicMs + this.millisecondsUntilLocalMidnight(
          this.lastObservedWallMs,
        );
      const flowEndMonotonicMs = Math.min(
        boundedMonotonicMs,
        activeEndMonotonicMs,
        flowDeadline,
        midnightDeadline,
      );
      flowDurationMs = Math.max(
        0,
        flowEndMonotonicMs - this.lastObservedMonotonicMs,
      );
      this.currentFlowActiveMs += flowDurationMs;
      this.flowActiveMs += flowDurationMs;
      this.longestFlowActiveMs = Math.max(
        this.longestFlowActiveMs,
        this.currentFlowActiveMs,
      );

      if (
        boundedMonotonicMs >= flowDeadline ||
        activeEndMonotonicMs >= midnightDeadline
      ) {
        const flowClosedWallMs =
          this.lastObservedWallMs + flowDurationMs;
        flowClosedAtLocalDateKey = this.localDateKey(
          new Date(
            flowDurationMs > 0 ? flowClosedWallMs - 1 : flowClosedWallMs,
          ),
        );
        this.closeFlow();
      }
    }

    const confirmedContextSwitches = this.confirmContextSwitches(
      boundedMonotonicMs,
    );

    if (
      this.status === "active" &&
      this.lastInteractionMonotonicMs !== undefined &&
      boundedMonotonicMs >=
        this.lastInteractionMonotonicMs + this.inactivityTimeoutMs
    ) {
      this.setStatus(
        "inactive",
        this.lastObservedWallMs + activeDurationMs,
      );
    }

    const slices = this.splitByLocalDate(
      this.lastObservedWallMs,
      this.lastObservedMonotonicMs,
      activeDurationMs,
      this.lastInteractionWallMs,
    );
    const flowSlices = this.splitByLocalDate(
      this.lastObservedWallMs,
      this.lastObservedMonotonicMs,
      flowDurationMs,
      this.lastInteractionWallMs,
    );
    this.lastObservedMonotonicMs = boundedMonotonicMs;
    this.lastObservedWallMs = wallMs;
    return {
      slices,
      flowSlices,
      confirmedContextSwitches,
      flowClosedAtLocalDateKey,
    };
  }

  private statusFor(monotonicMs: number): TrackingStatus {
    if (this.paused) {
      return "paused";
    }
    if (!this.focused) {
      return "unfocused";
    }
    if (
      this.lastInteractionMonotonicMs !== undefined &&
      monotonicMs - this.lastInteractionMonotonicMs <
        this.inactivityTimeoutMs
    ) {
      return "active";
    }
    return "inactive";
  }

  private setStatus(
    status: TrackingStatus,
    updatedAt: number,
    forceUpdate = false,
  ): void {
    if (this.status !== status || forceUpdate) {
      this.status = status;
      this.lastUpdatedAt = updatedAt;
    }
  }

  private transition(
    advanced: AdvanceResult,
    interactionAccepted: boolean,
    flowBlockStartedAtLocalDateKey?: string,
    flowClosedAtLocalDateKey?: string,
  ): ActivityTransition {
    return {
      ...this.getSnapshot(),
      ...advanced,
      flowBlockStartedAtLocalDateKey,
      flowClosedAtLocalDateKey:
        flowClosedAtLocalDateKey ?? advanced.flowClosedAtLocalDateKey,
      interactionAccepted,
    };
  }

  private flowSnapshot(): CurrentFlowMetrics {
    return {
      flowBlockCount: this.flowBlockCount,
      flowActiveMs: this.flowActiveMs,
      longestFlowActiveMs: this.longestFlowActiveMs,
      currentFlowActiveMs: this.flowOpen ? this.currentFlowActiveMs : 0,
    };
  }

  private closeFlow(): void {
    this.flowOpen = false;
    this.lastFlowInteractionMonotonicMs = undefined;
    this.currentFlowActiveMs = 0;
  }

  private closeFlowAt(wallMs: number): string | undefined {
    if (!this.flowOpen) {
      return undefined;
    }
    this.closeFlow();
    return this.localDateKey(new Date(wallMs));
  }

  private observeEditorContext(
    context: EditorActivityContext,
    monotonicMs: number,
  ): void {
    if (!this.confirmedContext) {
      this.confirmedContext = context;
      this.pendingContextSwitch = undefined;
      return;
    }

    if (this.sameContext(context, this.confirmedContext)) {
      this.pendingContextSwitch = undefined;
      return;
    }

    if (this.sameContext(context, this.pendingContextSwitch?.context)) {
      return;
    }

    this.pendingContextSwitch = {
      context,
      startedAtMonotonicMs: monotonicMs,
    };
  }

  private confirmContextSwitches(
    monotonicMs: number,
  ): ConfirmedContextSwitch[] {
    const pending = this.pendingContextSwitch;
    if (
      !pending ||
      !this.confirmedContext ||
      monotonicMs - pending.startedAtMonotonicMs <
        this.contextSwitchConfirmationMs
    ) {
      return [];
    }

    const previous = this.confirmedContext;
    this.confirmedContext = pending.context;
    this.pendingContextSwitch = undefined;
    const confirmationMonotonicMs =
      pending.startedAtMonotonicMs + this.contextSwitchConfirmationMs;
    const confirmationWallMs =
      this.lastObservedWallMs +
      Math.max(
        0,
        confirmationMonotonicMs - this.lastObservedMonotonicMs,
      );

    return [
      {
        destinationProjectId: pending.context.projectId,
        localDateKey: this.localDateKey(new Date(confirmationWallMs)),
        fileSwitch: true,
        projectSwitch: previous.projectId !== pending.context.projectId,
      },
    ];
  }

  private sameContext(
    left: EditorActivityContext,
    right: EditorActivityContext | undefined,
  ): boolean {
    return (
      right !== undefined &&
      left.fileId === right.fileId &&
      left.projectId === right.projectId
    );
  }

  private millisecondsUntilLocalMidnight(wallMs: number): number {
    const date = new Date(wallMs);
    return (
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1,
      ).getTime() - wallMs
    );
  }

  private splitByLocalDate(
    wallStartMs: number,
    monotonicStartMs: number,
    durationMs: number,
    lastInteractionAt: number | undefined,
  ): ActiveTimeSlice[] {
    if (durationMs <= 0 || lastInteractionAt === undefined) {
      return [];
    }

    const slices: ActiveTimeSlice[] = [];
    let wallCursor = wallStartMs;
    let monotonicCursor = monotonicStartMs;
    let remaining = durationMs;

    while (remaining > 0) {
      const date = new Date(wallCursor);
      const nextMidnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1,
      ).getTime();
      const availableToday = Math.max(1, nextMidnight - wallCursor);
      const sliceDuration = Math.min(remaining, availableToday);
      const localDateKey = this.localDateKey(date);
      const previous = slices[slices.length - 1];

      if (
        previous?.localDateKey === localDateKey &&
        previous.endedAt === wallCursor &&
        previous.monotonicEndedAt === monotonicCursor &&
        previous.lastInteractionAt === lastInteractionAt
      ) {
        previous.durationMs += sliceDuration;
        previous.endedAt += sliceDuration;
        previous.monotonicEndedAt += sliceDuration;
      } else {
        slices.push({
          localDateKey,
          durationMs: sliceDuration,
          startedAt: wallCursor,
          endedAt: wallCursor + sliceDuration,
          monotonicStartedAt: monotonicCursor,
          monotonicEndedAt: monotonicCursor + sliceDuration,
          lastInteractionAt,
        });
      }

      wallCursor += sliceDuration;
      monotonicCursor += sliceDuration;
      remaining -= sliceDuration;
    }

    return slices;
  }

  private localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private readNow(): { monotonicMs: number; wallMs: number } {
    return {
      monotonicMs: this.clock.monotonicNowMs?.() ?? this.clock.nowMs(),
      wallMs: this.clock.now().getTime(),
    };
  }
}
