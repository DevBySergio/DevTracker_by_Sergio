import * as assert from "assert";
import { Clock } from "../platform/ports";
import {
  ActivityStateMachine,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
} from "../tracking/ActivityStateMachine";

suite("ActivityStateMachine", () => {
  test("moves explicitly through active, paused, and unfocused states", () => {
    const startedAt = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const clock = new FakeClock(startedAt);
    const machine = new ActivityStateMachine({ clock });

    assert.strictEqual(machine.getSnapshot().status, "inactive");
    assert.strictEqual(machine.interact("edit").status, "active");

    clock.advance(2000);
    const paused = machine.pause();
    assert.strictEqual(paused.status, "paused");
    assert.deepStrictEqual(paused.slices, [
      slice("2026-08-07", startedAt, 0, 2000, startedAt),
    ]);

    clock.advance(1000);
    const ignoredSave = machine.interact("save");
    assert.strictEqual(ignoredSave.interactionAccepted, false);
    assert.strictEqual(ignoredSave.status, "paused");
    assert.deepStrictEqual(ignoredSave.slices, []);

    assert.strictEqual(machine.resume().status, "active");
    clock.advance(500);
    const unfocused = machine.setFocused(false);
    assert.strictEqual(unfocused.status, "unfocused");
    assert.deepStrictEqual(unfocused.slices, [
      slice("2026-08-07", startedAt + 3000, 3000, 500, startedAt),
    ]);

    clock.advance(1000);
    assert.strictEqual(machine.interact("active-editor").interactionAccepted, false);
    assert.strictEqual(machine.setFocused(true).status, "active");
  });

  test("accepts edits, saves, editor changes, and debounced selections", () => {
    const clock = new FakeClock(new Date(2026, 7, 7, 12, 0, 0).getTime());
    const machine = new ActivityStateMachine({
      clock,
      selectionDebounceMs: 1000,
    });

    assert.strictEqual(machine.interact("selection").interactionAccepted, true);
    const firstUpdate = machine.getSnapshot().lastUpdatedAt;

    clock.advance(500);
    const debounced = machine.interact("selection");
    assert.strictEqual(debounced.interactionAccepted, false);
    assert.strictEqual(machine.getSnapshot().lastUpdatedAt, firstUpdate);

    assert.strictEqual(machine.interact("edit").interactionAccepted, true);
    assert.strictEqual(machine.interact("save").interactionAccepted, true);
    assert.strictEqual(
      machine.interact("active-editor").interactionAccepted,
      true,
    );

    clock.advance(500);
    assert.strictEqual(machine.interact("selection").interactionAccepted, true);
  });

  test("caps active time at five minutes and emits no unlimited idle time", () => {
    const startedAt = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const clock = new FakeClock(startedAt);
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");

    clock.advance(10 * 60 * 1000);
    const expired = machine.tick();

    assert.strictEqual(expired.status, "inactive");
    assert.strictEqual(expired.lastUpdatedAt, startedAt + 5 * 60 * 1000);
    assert.deepStrictEqual(expired.slices, [
      slice(
        "2026-08-07",
        startedAt,
        0,
        DEFAULT_INACTIVITY_TIMEOUT_MS,
        startedAt,
      ),
    ]);

    clock.advance(24 * 60 * 60 * 1000);
    assert.deepStrictEqual(machine.tick().slices, []);
  });

  test("uses monotonic elapsed time when the wall clock jumps backward", () => {
    const startedAt = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const clock = new FakeClock(startedAt);
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");

    clock.advance(1000);
    machine.tick();

    clock.advance(2000, -60_000);
    const backwardJump = machine.tick();
    assert.deepStrictEqual(backwardJump.slices, [
      slice("2026-08-07", startedAt + 1000, 1000, 2000, startedAt),
    ]);

    const correctedInteractionAt = startedAt - 59_000;
    machine.interact("save");
    clock.advance(500);
    assert.deepStrictEqual(machine.tick().slices, [
      slice(
        "2026-08-07",
        correctedInteractionAt,
        3000,
        500,
        correctedInteractionAt,
      ),
    ]);
  });

  test("attributes pre-interaction slices to the previous interaction", () => {
    const startedAt = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const clock = new FakeClock(startedAt);
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");

    clock.advance(2000);
    const secondInteraction = machine.interact("save");
    assert.deepStrictEqual(secondInteraction.slices, [
      slice("2026-08-07", startedAt, 0, 2000, startedAt),
    ]);

    clock.advance(1000);
    assert.deepStrictEqual(machine.tick().slices, [
      slice(
        "2026-08-07",
        startedAt + 2000,
        2000,
        1000,
        startedAt + 2000,
      ),
    ]);
  });

  test("splits active time at the local midnight boundary", () => {
    const startedAt = new Date(2026, 7, 7, 23, 59, 59, 500).getTime();
    const clock = new FakeClock(startedAt);
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");

    clock.advance(1000);

    assert.deepStrictEqual(machine.tick().slices, [
      slice("2026-08-07", startedAt, 0, 500, startedAt),
      slice("2026-08-08", startedAt + 500, 500, 500, startedAt),
    ]);
  });

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
