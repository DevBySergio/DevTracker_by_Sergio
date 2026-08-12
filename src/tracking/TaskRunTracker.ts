import { TaskMetricObservation } from "../application/ports";
import {
  TaskRunResult,
  TrackedTaskConfiguration,
} from "../domain/tasks";
import { Clock } from "../platform/ports";

export interface TaskStartDescriptor {
  id: string;
  projectId: string;
  observedName: string;
}

interface ActiveTaskRun {
  projectId: string;
  configuration: TrackedTaskConfiguration;
  monotonicStartedAt: number;
  exitObserved: boolean;
  exitCode: number | undefined;
}

/**
 * Converts public task lifecycle signals into the narrow persisted contract.
 * It never receives task definitions, commands, variables, terminals, or
 * output, so those values cannot accidentally reach persistence.
 */
export class TaskRunTracker {
  private readonly active = new Map<string, ActiveTaskRun>();
  private configurations = new Map<string, TrackedTaskConfiguration>();
  private enabled = false;
  private paused = false;
  private configurationKey = "";

  constructor(private readonly clock: Clock) {}

  public configure(
    enabled: boolean,
    values: readonly TrackedTaskConfiguration[],
  ): void {
    const key = JSON.stringify({ enabled, values });
    if (key === this.configurationKey) {
      return;
    }
    this.configurationKey = key;
    this.enabled = enabled;
    this.configurations = new Map(
      values.map((value) => [value.configuredName, { ...value }]),
    );
    this.active.clear();
  }

  public setPaused(paused: boolean): void {
    if (paused && !this.paused) {
      this.active.clear();
    }
    this.paused = paused;
  }

  public start(value: TaskStartDescriptor): boolean {
    this.requireSafeId(value.id, "task execution id");
    this.requireSafeId(value.projectId, "project id");
    if (!this.enabled || this.paused || this.active.has(value.id)) {
      return false;
    }
    const configuration = this.configurations.get(value.observedName);
    if (!configuration) {
      return false;
    }
    this.active.set(value.id, {
      projectId: value.projectId,
      configuration: { ...configuration },
      monotonicStartedAt: this.monotonicNowMs(),
      exitObserved: false,
      exitCode: undefined,
    });
    return true;
  }

  public recordProcessEnd(id: string, exitCode: number | undefined): void {
    this.requireSafeId(id, "task execution id");
    if (exitCode !== undefined && !Number.isSafeInteger(exitCode)) {
      throw new Error("Task exit code must be a safe integer when present");
    }
    const active = this.active.get(id);
    if (!active) {
      return;
    }
    active.exitObserved = true;
    active.exitCode = exitCode;
  }

  public end(id: string): TaskMetricObservation | null {
    this.requireSafeId(id, "task execution id");
    const active = this.active.get(id);
    this.active.delete(id);
    if (!active || !this.enabled || this.paused) {
      return null;
    }
    const durationMs = Math.max(
      0,
      Math.round(this.monotonicNowMs() - active.monotonicStartedAt),
    );
    if (!Number.isSafeInteger(durationMs)) {
      throw new Error("Task duration exceeded the safe integer range");
    }
    return {
      projectId: active.projectId,
      localDate: this.localDateKey(this.clock.now()),
      configuredName: active.configuration.configuredName,
      classification: active.configuration.classification,
      durationMs,
      result: this.result(active),
    };
  }

  public stopAll(): void {
    this.active.clear();
  }

  public getActiveExecutionIds(): string[] {
    return [...this.active.keys()].sort();
  }

  private result(value: ActiveTaskRun): TaskRunResult {
    if (!value.exitObserved) {
      return "unknown";
    }
    if (value.exitCode === undefined) {
      return "cancelled";
    }
    return value.exitCode === 0 ? "succeeded" : "failed";
  }

  private monotonicNowMs(): number {
    return this.clock.monotonicNowMs?.() ?? this.clock.nowMs();
  }

  private localDateKey(value: Date): string {
    const pad = (part: number): string => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  private requireSafeId(value: string, name: string): void {
    if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
      throw new Error(`${name} contains unsafe characters`);
    }
  }
}
