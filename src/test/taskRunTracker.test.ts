import * as assert from "assert";
import { Clock } from "../platform/ports";
import { TaskRunTracker } from "../tracking/TaskRunTracker";

suite("TaskRunTracker", () => {
  test("records only an explicitly configured task with monotonic duration", () => {
    const clock = new MutableClock(new Date(2026, 7, 12, 9, 0, 0), 100);
    const tracker = new TaskRunTracker(clock);
    tracker.configure(true, [
      { configuredName: "npm: test", classification: "test" },
    ]);

    assert.strictEqual(
      tracker.start({
        id: "execution-ignored",
        projectId: "project-alpha",
        observedName: "npm: build",
      }),
      false,
    );
    assert.strictEqual(
      tracker.start({
        id: "execution-test",
        projectId: "project-alpha",
        observedName: "npm: test",
      }),
      true,
    );
    clock.advance(1_250);
    tracker.recordProcessEnd("execution-test", 0);

    assert.deepStrictEqual(tracker.end("execution-test"), {
      projectId: "project-alpha",
      localDate: "2026-08-12",
      configuredName: "npm: test",
      classification: "test",
      durationMs: 1_250,
      result: "succeeded",
    });
  });

  test("keeps failed, cancelled, and unknown process outcomes distinct", () => {
    const clock = new MutableClock(new Date(2026, 7, 12, 9, 0, 0), 0);
    const tracker = new TaskRunTracker(clock);
    tracker.configure(true, [
      { configuredName: "compile", classification: "build" },
    ]);

    assert.strictEqual(run(tracker, clock, "failed", 2)?.result, "failed");
    assert.strictEqual(
      run(tracker, clock, "cancelled", undefined)?.result,
      "cancelled",
    );
    assert.strictEqual(run(tracker, clock, "unknown")?.result, "unknown");
  });

  test("drops in-flight tasks across pause and privacy configuration changes", () => {
    const clock = new MutableClock(new Date(2026, 7, 12, 9, 0, 0), 0);
    const tracker = new TaskRunTracker(clock);
    const rule = { configuredName: "compile", classification: "build" } as const;
    tracker.configure(true, [rule]);
    tracker.start({
      id: "execution-pause",
      projectId: "project-alpha",
      observedName: "compile",
    });
    tracker.setPaused(true);
    assert.strictEqual(tracker.end("execution-pause"), null);
    assert.deepStrictEqual(tracker.getActiveExecutionIds(), []);

    tracker.setPaused(false);
    tracker.start({
      id: "execution-disable",
      projectId: "project-alpha",
      observedName: "compile",
    });
    tracker.configure(false, [rule]);
    assert.strictEqual(tracker.end("execution-disable"), null);
    assert.strictEqual(
      tracker.start({
        id: "execution-disabled",
        projectId: "project-alpha",
        observedName: "compile",
      }),
      false,
    );
  });

  function run(
    tracker: TaskRunTracker,
    clock: MutableClock,
    id: string,
    exitCode?: number,
  ) {
    tracker.start({
      id,
      projectId: "project-alpha",
      observedName: "compile",
    });
    clock.advance(10);
    if (arguments.length === 4) {
      tracker.recordProcessEnd(id, exitCode);
    }
    return tracker.end(id);
  }
});

class MutableClock implements Clock {
  constructor(
    private wall: Date,
    private monotonicMs: number,
  ) {}

  public now(): Date {
    return new Date(this.wall);
  }

  public nowMs(): number {
    return this.wall.getTime();
  }

  public monotonicNowMs(): number {
    return this.monotonicMs;
  }

  public advance(durationMs: number): void {
    this.wall = new Date(this.wall.getTime() + durationMs);
    this.monotonicMs += durationMs;
  }
}
