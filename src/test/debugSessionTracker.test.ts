import * as assert from "assert";
import { Clock } from "../platform/ports";
import { DebugSessionTracker } from "../tracking/DebugSessionTracker";

suite("DebugSessionTracker", () => {
  test("unions nested sessions and attributes concurrent time once", () => {
    const clock = new FakeClock(new Date(2026, 7, 7, 10, 0, 0).getTime());
    const tracker = new DebugSessionTracker({
      clock,
      privacyEnabled: true,
    });

    assert.deepStrictEqual(
      tracker.startSession({ id: "parent", projectId: "project-a" }),
      [],
    );
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-a", 1_000)]);

    tracker.startSession({ id: "child", projectId: "project-a" });
    clock.advance(1_000);
    assert.deepStrictEqual(
      tracker.tick(),
      [elapsed("project-a", 1_000)],
      "nested sessions in one project must not double elapsed time",
    );

    tracker.startSession({ id: "parallel", projectId: "project-b" });
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-b", 1_000)]);

    tracker.setActiveSession("parent");
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-a", 1_000)]);
    tracker.terminateSession("parent");
    assert.deepStrictEqual(tracker.getActiveSessionIds(), ["child", "parallel"]);

    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-b", 1_000)]);
    tracker.terminateSession("parallel");
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-a", 1_000)]);

  });

  test("records human active time separately from debug elapsed time", () => {
    const clock = new FakeClock(new Date(2026, 7, 7, 10, 0, 0).getTime());
    const tracker = new DebugSessionTracker({
      clock,
      privacyEnabled: true,
    });
    tracker.startSession({ id: "session-a", projectId: "project-debug" });

    const updates = tracker.recordActiveTime("project-editor", [
      activeSlice("2026-08-07", 600.4),
      activeSlice("2026-08-07", 399.6),
      activeSlice("2026-08-08", 250),
    ]);

    assert.deepStrictEqual(updates, [
      {
        projectId: "project-editor",
        localDate: "2026-08-07",
        debugElapsedMs: 0,
        debugActiveTimeMs: 1_000,
      },
      {
        projectId: "project-editor",
        localDate: "2026-08-08",
        debugElapsedMs: 0,
        debugActiveTimeMs: 250,
      },
    ]);
  });

  test("honors opt-in and explicit pause without retroactive collection", () => {
    const clock = new FakeClock(new Date(2026, 7, 7, 10, 0, 0).getTime());
    const tracker = new DebugSessionTracker({ clock });
    tracker.startSession({ id: "session-a", projectId: "project-a" });

    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), []);
    assert.deepStrictEqual(tracker.setPrivacyEnabled(true), []);
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-a", 1_000)]);

    assert.deepStrictEqual(tracker.setPaused(true), []);
    clock.advance(2_000);
    assert.deepStrictEqual(tracker.tick(), []);
    assert.deepStrictEqual(tracker.setPaused(false), []);
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.tick(), [elapsed("project-a", 1_000)]);

    assert.deepStrictEqual(tracker.setPrivacyEnabled(false), []);
    clock.advance(1_000);
    assert.deepStrictEqual(tracker.stopAll(), []);
    assert.deepStrictEqual(tracker.getActiveSessionIds(), []);
  });

  test("splits monotonic elapsed time at local midnight", () => {
    const clock = new FakeClock(
      new Date(2026, 7, 7, 23, 59, 59, 500).getTime(),
    );
    const tracker = new DebugSessionTracker({
      clock,
      privacyEnabled: true,
    });
    tracker.startSession({ id: "session-a", projectId: "project-a" });

    clock.advance(1_000);

    assert.deepStrictEqual(tracker.tick(), [
      elapsed("project-a", 500, "2026-08-07"),
      elapsed("project-a", 500, "2026-08-08"),
    ]);
  });

  test("uses monotonic duration when the wall clock moves backward", () => {
    const clock = new FakeClock(new Date(2026, 7, 7, 10, 0, 0).getTime());
    const tracker = new DebugSessionTracker({
      clock,
      privacyEnabled: true,
    });
    tracker.startSession({ id: "session-a", projectId: "project-a" });

    clock.advanceWithWallChange(1_000, -60 * 60 * 1_000);

    assert.deepStrictEqual(tracker.tick(), [elapsed("project-a", 1_000)]);
  });

  function elapsed(
    projectId: string,
    debugElapsedMs: number,
    localDate = "2026-08-07",
  ) {
    return {
      projectId,
      localDate,
      debugElapsedMs,
      debugActiveTimeMs: 0,
    };
  }

  function activeSlice(localDateKey: string, durationMs: number) {
    return {
      localDateKey,
      durationMs,
      startedAt: 0,
      endedAt: durationMs,
      monotonicStartedAt: 0,
      monotonicEndedAt: durationMs,
      lastInteractionAt: 0,
    };
  }
});

class FakeClock implements Clock {
  private monotonicMs = 0;

  constructor(private wallMs: number) {}

  public now(): Date {
    return new Date(this.wallMs);
  }

  public nowMs(): number {
    return this.wallMs;
  }

  public monotonicNowMs(): number {
    return this.monotonicMs;
  }

  public advance(milliseconds: number): void {
    this.wallMs += milliseconds;
    this.monotonicMs += milliseconds;
  }

  public advanceWithWallChange(
    monotonicMilliseconds: number,
    wallMilliseconds: number,
  ): void {
    this.wallMs += wallMilliseconds;
    this.monotonicMs += monotonicMilliseconds;
  }
}
