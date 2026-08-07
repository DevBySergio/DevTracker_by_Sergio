import * as assert from "assert";
import { DiagnosticsBySeverity } from "../domain/types";
import { Clock } from "../platform/ports";
import {
  DiagnosticsAggregateObservation,
  DiagnosticsTracker,
  DiagnosticsTrackerValidationError,
} from "../tracking/DiagnosticsTracker";

suite("DiagnosticsTracker", () => {
  test("processes every affected project in one aggregate observation", () => {
    const clock = new FakeClock(60_000);
    const tracker = createTracker(clock);

    const updates = tracker.observe({
      projects: {
        "project-b": counts(0, 2, 1, 0),
        "project-a": counts(1, 0, 0, 3),
      },
    });

    assert.deepStrictEqual(
      updates.map((update) => update.projectId),
      ["project-a", "project-b"],
    );
    assert.deepStrictEqual(
      tracker.getProjectState("project-a")?.diagnostics,
      rollup(counts(1, 0, 0, 3), zero(), zero(), counts(1, 0, 0, 3)),
    );
    assert.deepStrictEqual(
      tracker.getProjectState("project-b")?.diagnostics,
      rollup(counts(0, 2, 1, 0), zero(), zero(), counts(0, 2, 1, 0)),
    );
  });

  test("computes introduced, resolved, and per-severity peak deltas", () => {
    const clock = new FakeClock(60_000);
    const tracker = createTracker(clock);
    tracker.observe({ projects: { "project-a": counts(2, 3, 0, 1) } });

    clock.advance(100);
    const [update] = tracker.observe({
      projects: { "project-a": counts(5, 1, 2, 0) },
    });

    const expected = rollup(
      counts(5, 1, 2, 0),
      counts(3, 0, 2, 0),
      counts(0, 2, 0, 1),
      counts(5, 3, 2, 1),
    );
    assert.deepStrictEqual(update.diagnostics, expected);
    assert.deepStrictEqual(
      tracker.getProjectState("project-a")?.diagnostics,
      expected,
    );
  });

  test("turns complete removal into resolved counts and a zero current snapshot", () => {
    const clock = new FakeClock(60_000);
    const tracker = createTracker(clock);
    tracker.observe({ projects: { "project-a": counts(2, 1, 3, 4) } });

    clock.advance(100);
    const [removed] = tracker.observe({
      projects: { "project-a": zero() },
    });

    assert.deepStrictEqual(
      removed.diagnostics,
      rollup(zero(), zero(), counts(2, 1, 3, 4), counts(2, 1, 3, 4)),
    );
    assert.deepStrictEqual(
      tracker.getProjectState("project-a")?.diagnostics.current,
      zero(),
    );
  });

  test("rate-limits emissions while coalescing every intermediate delta", () => {
    const clock = new FakeClock(60_000);
    const tracker = new DiagnosticsTracker({
      clock,
      bucketMs: 60_000,
      minEmissionIntervalMs: 1_000,
      maxBucketsPerProject: 4,
    });
    assert.strictEqual(
      tracker.observe({ projects: { "project-a": counts(1) } }).length,
      1,
    );

    clock.advance(100);
    assert.deepStrictEqual(
      tracker.observe({ projects: { "project-a": counts(2) } }),
      [],
    );
    clock.advance(100);
    assert.deepStrictEqual(
      tracker.observe({ projects: { "project-a": counts(4) } }),
      [],
    );
    clock.advance(800);
    const [coalesced] = tracker.observe({
      projects: { "project-a": counts(4) },
    });

    assert.deepStrictEqual(coalesced.diagnostics.current, counts(4));
    assert.deepStrictEqual(coalesced.diagnostics.introduced, counts(3));
    assert.deepStrictEqual(coalesced.diagnostics.resolved, zero());
    assert.deepStrictEqual(coalesced.diagnostics.peak, counts(4));
    assert.deepStrictEqual(tracker.flush(), []);
  });

  test("replaces bucket current snapshots and carries prior state into a new bucket peak", () => {
    const clock = new FakeClock(0);
    const tracker = new DiagnosticsTracker({
      clock,
      bucketMs: 1_000,
      minEmissionIntervalMs: 0,
      maxBucketsPerProject: 4,
    });
    tracker.observe({ projects: { "project-a": counts(3) } });

    clock.advance(1_500);
    const [newBucket] = tracker.observe({
      projects: { "project-a": counts(1) },
    });
    assert.deepStrictEqual(newBucket.diagnostics.current, counts(1));
    assert.deepStrictEqual(newBucket.diagnostics.resolved, counts(2));
    assert.deepStrictEqual(newBucket.diagnostics.peak, counts(3));

    clock.advance(100);
    const [replacement] = tracker.observe({
      projects: { "project-a": counts(2) },
    });
    const buckets = tracker.getBucketUpdates("project-a");

    assert.strictEqual(buckets.length, 2);
    assert.strictEqual(replacement.bucketStartedAt, newBucket.bucketStartedAt);
    assert.deepStrictEqual(replacement.diagnostics.current, counts(2));
    assert.deepStrictEqual(replacement.diagnostics.introduced, counts(1));
    assert.deepStrictEqual(replacement.diagnostics.resolved, counts(2));
    assert.deepStrictEqual(buckets[1], replacement);
  });

  test("bounds retained temporal bucket volume per project", () => {
    const clock = new FakeClock(0);
    const tracker = new DiagnosticsTracker({
      clock,
      bucketMs: 1_000,
      minEmissionIntervalMs: 0,
      maxBucketsPerProject: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      tracker.observe({ projects: { "project-a": counts(index) } });
      clock.advance(1_000);
    }

    assert.deepStrictEqual(
      tracker
        .getBucketUpdates("project-a")
        .map((update) => update.bucketStartedAt),
      [2_000, 3_000, 4_000],
    );
    assert.deepStrictEqual(
      tracker.getProjectState("project-a")?.diagnostics.current,
      counts(4),
    );
  });

  test("serializes counts and timestamps only and rejects payload detail", () => {
    const clock = new FakeClock(60_000);
    const tracker = createTracker(clock);
    const [update] = tracker.observe({
      projects: { "project-a": counts(1, 2, 3, 4) },
    });
    const serialized = JSON.stringify(update);

    assert.deepStrictEqual(Object.keys(update), [
      "projectId",
      "bucketStartedAt",
      "bucketEndedAt",
      "observedAt",
      "diagnostics",
    ]);
    assert.ok(!serialized.includes("message"));
    assert.ok(!serialized.includes("source"));
    assert.ok(!serialized.includes("content"));
    assert.ok(!serialized.includes("secret text"));

    const unsafe = {
      projects: {
        "project-a": {
          ...counts(1),
          message: "secret text",
        },
      },
    } as unknown as DiagnosticsAggregateObservation;
    assert.throws(
      () => tracker.observe(unsafe),
      DiagnosticsTrackerValidationError,
    );
  });

  function createTracker(clock: Clock): DiagnosticsTracker {
    return new DiagnosticsTracker({
      clock,
      bucketMs: 60_000,
      minEmissionIntervalMs: 0,
      maxBucketsPerProject: 4,
    });
  }

  function counts(
    error: number,
    warning = 0,
    info = 0,
    hint = 0,
  ): DiagnosticsBySeverity {
    return { error, warning, info, hint };
  }

  function zero(): DiagnosticsBySeverity {
    return counts(0);
  }

  function rollup(
    current: DiagnosticsBySeverity,
    introduced: DiagnosticsBySeverity,
    resolved: DiagnosticsBySeverity,
    peak: DiagnosticsBySeverity,
  ) {
    return { current, introduced, resolved, peak };
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
}
