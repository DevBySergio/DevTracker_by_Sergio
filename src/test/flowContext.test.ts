import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataManager } from "../DataManager";
import { Clock } from "../platform/ports";
import { calculateSwitchesPerActiveHour } from "../queries/DevTrackerQueries";
import {
  ActivityStateMachine,
  EditorActivityContext,
} from "../tracking/ActivityStateMachine";

suite("Flow and context tracking", () => {
  test("starts flow only from accepted interactions and expires at 120 seconds", () => {
    const clock = createClock();
    const machine = new ActivityStateMachine({ clock });

    assert.strictEqual(machine.tick().flow.flowBlockCount, 0);
    machine.pause();
    assert.strictEqual(machine.interact("edit").interactionAccepted, false);
    assert.strictEqual(machine.getSnapshot().flow.flowBlockCount, 0);

    machine.resume();
    const started = machine.interact("edit");
    assert.strictEqual(started.flow.flowBlockCount, 1);
    assert.strictEqual(started.flowBlockStartedAtLocalDateKey, "2026-08-07");

    clock.advance(119_999);
    const beforeDeadline = machine.tick();
    assert.strictEqual(beforeDeadline.flow.currentFlowActiveMs, 119_999);

    clock.advance(1);
    const expired = machine.tick();
    assert.strictEqual(expired.status, "active");
    assert.strictEqual(expired.flow.currentFlowActiveMs, 0);
    assert.strictEqual(expired.flow.flowActiveMs, 120_000);
    assert.strictEqual(totalDuration(expired.flowSlices), 1);

    clock.advance(1000);
    const activeWithoutFlow = machine.tick();
    assert.strictEqual(totalDuration(activeWithoutFlow.slices), 1000);
    assert.deepStrictEqual(activeWithoutFlow.flowSlices, []);
  });

  test("closes flow at midnight and starts a new block on the next interaction", () => {
    const startedAt = new Date(2026, 7, 7, 23, 59, 59, 500).getTime();
    const clock = new FakeClock(startedAt);
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");

    clock.advance(1000);
    const midnight = machine.tick();

    assert.deepStrictEqual(midnight.slices, [
      slice("2026-08-07", startedAt, 0, 500, startedAt),
      slice("2026-08-08", startedAt + 500, 500, 500, startedAt),
    ]);
    assert.deepStrictEqual(midnight.flowSlices, [
      slice("2026-08-07", startedAt, 0, 500, startedAt),
    ]);
    assert.strictEqual(midnight.flow.currentFlowActiveMs, 0);

    const restarted = machine.interact("save");
    assert.strictEqual(restarted.flow.flowBlockCount, 2);
    assert.strictEqual(
      restarted.flowBlockStartedAtLocalDateKey,
      "2026-08-08",
    );
  });

  test("pause closes flow and resume waits for another interaction", () => {
    const clock = createClock();
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");

    clock.advance(10_000);
    assert.strictEqual(machine.tick().flow.currentFlowActiveMs, 10_000);
    const paused = machine.pause();
    assert.strictEqual(paused.flow.currentFlowActiveMs, 0);
    assert.strictEqual(paused.flow.flowActiveMs, 10_000);
    assert.deepStrictEqual(paused.flowSlices, []);
    assert.strictEqual(paused.flowClosedAtLocalDateKey, "2026-08-07");

    machine.resume();
    clock.advance(10_000);
    const resumedWithoutInteraction = machine.tick();
    assert.strictEqual(totalDuration(resumedWithoutInteraction.slices), 10_000);
    assert.deepStrictEqual(resumedWithoutInteraction.flowSlices, []);

    const restarted = machine.interact("save");
    assert.strictEqual(restarted.flow.flowBlockCount, 2);
  });

  test("rejects transient file candidates and confirms stable file and project switches", () => {
    const clock = createClock();
    const machine = new ActivityStateMachine({ clock });
    const fileA = context("project-a", "file-a");
    const fileB = context("project-a", "file-b");
    const projectB = context("project-b", "file-c");

    machine.interact("active-editor", fileA);
    clock.advance(1000);
    machine.interact("active-editor", fileB);
    clock.advance(3000);
    const returned = machine.interact("active-editor", fileA);
    assert.deepStrictEqual(returned.confirmedContextSwitches, []);

    clock.advance(10_000);
    assert.deepStrictEqual(machine.tick().confirmedContextSwitches, []);

    machine.interact("active-editor", fileB);
    clock.advance(4999);
    assert.deepStrictEqual(machine.tick().confirmedContextSwitches, []);
    clock.advance(1);
    assert.deepStrictEqual(machine.tick().confirmedContextSwitches, [
      {
        destinationProjectId: "project-a",
        localDateKey: "2026-08-07",
        fileSwitch: true,
        projectSwitch: false,
      },
    ]);

    machine.interact("active-editor", projectB);
    clock.advance(5000);
    assert.deepStrictEqual(machine.tick().confirmedContextSwitches, [
      {
        destinationProjectId: "project-b",
        localDateKey: "2026-08-07",
        fileSwitch: true,
        projectSwitch: true,
      },
    ]);
  });

  test("cancels an unconfirmed switch when tracking pauses", () => {
    const clock = createClock();
    const machine = new ActivityStateMachine({ clock });
    machine.interact("active-editor", context("project-a", "file-a"));
    machine.interact("active-editor", context("project-a", "file-b"));

    clock.advance(3000);
    machine.pause();
    clock.advance(10_000);
    machine.resume();

    assert.deepStrictEqual(machine.tick().confirmedContextSwitches, []);
  });

  test("closes persisted current flow on focus loss and context exclusion", () => {
    const clock = createClock();
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");
    clock.advance(1000);
    machine.tick();

    const unfocused = machine.setFocused(false);
    assert.deepStrictEqual(unfocused.flowSlices, []);
    assert.strictEqual(unfocused.flow.currentFlowActiveMs, 0);
    assert.strictEqual(unfocused.flowClosedAtLocalDateKey, "2026-08-07");

    machine.setFocused(true);
    machine.interact("edit");
    clock.advance(1000);
    machine.tick();

    const excluded = machine.clearContext();
    assert.deepStrictEqual(excluded.flowSlices, []);
    assert.strictEqual(excluded.flow.currentFlowActiveMs, 0);
    assert.strictEqual(excluded.flowClosedAtLocalDateKey, "2026-08-07");
  });

  test("calculates file switches per active hour and returns null at zero", () => {
    assert.strictEqual(calculateSwitchesPerActiveHour(4, 0), null);
    assert.strictEqual(
      calculateSwitchesPerActiveHour(4, 30 * 60 * 1000),
      8,
    );
  });

  test("persists precise flow and confirmed switch fields while retaining legacy fields", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flow-context-"));
    const dataPath = path.join(directory, "data.json");
    const clock = createClock();
    const manager = new DataManager({
      dataPath,
      clock,
      debounceMs: 60_000,
    });

    try {
      manager.addTime(
        "/workspace/alpha",
        "typescript",
        "src/a.ts",
        10,
        "main",
        "2026-08-07",
        false,
      );
      manager.recordFlowBlock("/workspace/alpha", "2026-08-07");
      manager.addFlowActiveTime(
        "/workspace/alpha",
        10_000,
        "2026-08-07",
      );
      manager.setCurrentFlowForDay(
        "/workspace/alpha",
        10_000,
        "2026-08-07",
      );
      manager.setCurrentFlowMetrics({
        flowBlockCount: 1,
        flowActiveMs: 10_000,
        longestFlowActiveMs: 10_000,
        currentFlowActiveMs: 10_000,
      });
      manager.addConfirmedContextSwitch(
        "/workspace/alpha",
        true,
        "2026-08-07",
      );
      await manager.flush();

      manager.setCurrentFlowForDay(
        "/workspace/alpha",
        0,
        "2026-08-07",
      );
      manager.setCurrentFlowMetrics({
        flowBlockCount: 1,
        flowActiveMs: 10_000,
        longestFlowActiveMs: 10_000,
        currentFlowActiveMs: 0,
      });
      await manager.flush();

      const restored = new DataManager({ dataPath, clock });
      const day =
        restored.getProjectData("/workspace/alpha").days["2026-08-07"];
      assert.strictEqual(day.fileSwitchEvents, 1);
      assert.strictEqual(day.projectSwitchEvents, 1);
      assert.strictEqual(day.contextSwitches, 1);
      assert.strictEqual(day.flowBlockCount, 1);
      assert.strictEqual(day.flowActiveMs, 10_000);
      assert.strictEqual(day.longestFlowActiveMs, 10_000);
      assert.strictEqual(day.currentFlowActiveMs, 0);
      assert.strictEqual(day.flow.count, 1);
      assert.strictEqual(day.flow.totalSeconds, 10);
      assert.strictEqual(day.flow.currentSeconds, 0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function createClock(): FakeClock {
    return new FakeClock(new Date(2026, 7, 7, 12, 0, 0).getTime());
  }

  function context(
    projectId: string,
    fileId: string,
  ): EditorActivityContext {
    return { projectId, fileId };
  }

  function totalDuration(slices: { durationMs: number }[]): number {
    return slices.reduce((total, slice) => total + slice.durationMs, 0);
  }

  function slice(
    localDateKey: string,
    startedAt: number,
    monotonicStartedAt: number,
    durationMs: number,
    lastInteractionAt: number,
  ) {
    return {
      localDateKey,
      durationMs,
      startedAt,
      endedAt: startedAt + durationMs,
      monotonicStartedAt,
      monotonicEndedAt: monotonicStartedAt + durationMs,
      lastInteractionAt,
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

  public advance(monotonicMs: number, wallMs = monotonicMs): void {
    this.monotonicMs += monotonicMs;
    this.wallMs += wallMs;
  }
}
