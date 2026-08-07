import * as assert from "assert";
import {
  ActivityInterval,
  SCHEMA_VERSION,
  TrackingSession,
} from "../domain/schemaV2";
import {
  ActivityIntervalUnionError,
  unionActivityIntervals,
} from "../queries/ActivityIntervalUnion";

suite("ActivityIntervalUnion", () => {
  test("uses the latest human interaction instead of the latest periodic slice start", () => {
    const earlierInteractionLaterSlice = trackingSession(
      "instance-a",
      "session-a",
      [
        interval(
          "interval-a",
          "session-a",
          "project-a",
          "typescript",
          5_000,
          10_000,
          1_000,
        ),
      ],
    );
    const laterInteractionEarlierSlice = trackingSession(
      "instance-b",
      "session-b",
      [
        interval(
          "interval-b-1",
          "session-b",
          "project-b",
          "javascript",
          0,
          4_000,
          0,
        ),
        interval(
          "interval-b-2",
          "session-b",
          "project-b",
          "javascript",
          4_000,
          8_000,
          3_500,
        ),
      ],
    );

    const result = unionActivityIntervals([
      earlierInteractionLaterSlice,
      laterInteractionEarlierSlice,
    ]);

    assert.strictEqual(result.globalActiveTimeMs, 10_000);
    assert.strictEqual(result.goalActiveTimeMs, 10_000);
    assert.strictEqual(result.overlapTimeMs, 3_000);
    assert.strictEqual(result.maxConcurrentInstances, 2);
    assert.deepStrictEqual(result.activeTimeByProjectMs, {
      "project-a": 2_000,
      "project-b": 8_000,
    });
    assert.deepStrictEqual(result.activeTimeByLanguageMs, {
      javascript: 8_000,
      typescript: 2_000,
    });
    assert.deepStrictEqual(
      result.slices.map((slice) => ({
        startedAt: slice.startedAt,
        endedAt: slice.endedAt,
        projectId: slice.projectId,
        lastInteractionAt: slice.lastInteractionAt,
        concurrentInstances: slice.concurrentInstances,
      })),
      [
        {
          startedAt: 0,
          endedAt: 4_000,
          projectId: "project-b",
          lastInteractionAt: 0,
          concurrentInstances: 1,
        },
        {
          startedAt: 4_000,
          endedAt: 5_000,
          projectId: "project-b",
          lastInteractionAt: 3_500,
          concurrentInstances: 1,
        },
        {
          startedAt: 5_000,
          endedAt: 8_000,
          projectId: "project-b",
          lastInteractionAt: 3_500,
          concurrentInstances: 2,
        },
        {
          startedAt: 8_000,
          endedAt: 10_000,
          projectId: "project-a",
          lastInteractionAt: 1_000,
          concurrentInstances: 1,
        },
      ],
    );
  });

  test("unions and attributes three concurrent windows without double counting", () => {
    const result = unionActivityIntervals([
      trackingSession(
        "instance-a",
        "session-a",
        [interval("interval-a", "session-a", "project-a", "typescript", 0, 12_000)],
      ),
      trackingSession(
        "instance-b",
        "session-b",
        [interval("interval-b", "session-b", "project-b", "javascript", 2_000, 10_000)],
      ),
      trackingSession(
        "instance-c",
        "session-c",
        [interval("interval-c", "session-c", "project-c", "python", 5_000, 8_000)],
      ),
    ]);

    assert.strictEqual(result.globalActiveTimeMs, 12_000);
    assert.strictEqual(result.goalActiveTimeMs, 12_000);
    assert.strictEqual(result.overlapTimeMs, 8_000);
    assert.strictEqual(result.maxConcurrentInstances, 3);
    assert.deepStrictEqual(result.activeTimeByProjectMs, {
      "project-a": 4_000,
      "project-b": 5_000,
      "project-c": 3_000,
    });
    assert.deepStrictEqual(result.activeTimeByLanguageMs, {
      javascript: 5_000,
      python: 3_000,
      typescript: 4_000,
    });
    assert.strictEqual(
      Object.values(result.activeTimeByProjectMs).reduce(
        (total, duration) => total + duration,
        0,
      ),
      result.globalActiveTimeMs,
    );
    assert.deepStrictEqual(
      result.slices.map((slice) => [
        slice.startedAt,
        slice.endedAt,
        slice.instanceId,
      ]),
      [
        [0, 2_000, "instance-a"],
        [2_000, 5_000, "instance-b"],
        [5_000, 8_000, "instance-c"],
        [8_000, 10_000, "instance-b"],
        [10_000, 12_000, "instance-a"],
      ],
    );
  });

  test("breaks exact interaction ties by stable instance identity", () => {
    const instanceZ = trackingSession(
      "instance-z",
      "session-z",
      [interval("interval-z", "session-z", "project-z", "zig", 0, 10_000)],
    );
    const instanceA = trackingSession(
      "instance-a",
      "session-a",
      [interval("interval-a", "session-a", "project-a", "ada", 0, 10_000)],
    );

    const forward = unionActivityIntervals([instanceZ, instanceA]);
    const reversed = unionActivityIntervals([instanceA, instanceZ]);

    assert.deepStrictEqual(forward, reversed);
    assert.strictEqual(forward.globalActiveTimeMs, 10_000);
    assert.strictEqual(forward.overlapTimeMs, 10_000);
    assert.deepStrictEqual(forward.activeTimeByProjectMs, {
      "project-a": 10_000,
    });
    assert.deepStrictEqual(forward.activeTimeByLanguageMs, { ada: 10_000 });
    assert.strictEqual(forward.slices[0].instanceId, "instance-a");
  });

  test("accepts interaction wall times after a slice when the clock moved backward", () => {
    const session = trackingSession("instance-a", "session-a", [
      interval(
        "interval-a",
        "session-a",
        "project-a",
        "typescript",
        1_000,
        2_000,
        5_000,
      ),
    ]);

    const result = unionActivityIntervals([session]);

    assert.strictEqual(result.globalActiveTimeMs, 1_000);
    assert.strictEqual(result.slices[0].lastInteractionAt, 5_000);
  });

  test("deduplicates repeated session snapshots across all aggregations", () => {
    const snapshot = trackingSession(
      "instance-a",
      "session-a",
      [
        interval("interval-a", "session-a", "project-a", "typescript", 0, 5_000),
        interval("interval-b", "session-a", "project-a", null, 5_000, 8_000),
      ],
    );

    const result = unionActivityIntervals([snapshot, snapshot]);

    assert.strictEqual(result.globalActiveTimeMs, 8_000);
    assert.strictEqual(result.goalActiveTimeMs, 8_000);
    assert.strictEqual(result.overlapTimeMs, 0);
    assert.strictEqual(result.maxConcurrentInstances, 1);
    assert.deepStrictEqual(result.activeTimeByProjectMs, {
      "project-a": 8_000,
    });
    assert.deepStrictEqual(result.activeTimeByLanguageMs, {
      typescript: 5_000,
    });
    assert.strictEqual(result.unattributedLanguageTimeMs, 3_000);
  });

  test("rejects invalid or conflicting interaction attribution", () => {
    const session = trackingSession("instance-a", "session-a", [
      interval("interval-a", "session-a", "project-a", "typescript", 1_000, 5_000),
    ]);

    assert.throws(
      () =>
        unionActivityIntervals([
          {
            ...session,
            intervals: [
              { ...session.intervals[0], lastInteractionAt: Number.NaN },
            ],
          },
        ]),
      ActivityIntervalUnionError,
    );
    assert.throws(
      () =>
        unionActivityIntervals([
          session,
          {
            ...session,
            intervals: [{ ...session.intervals[0], lastInteractionAt: 500 }],
          },
        ]),
      /conflicting duplicate records/,
    );
  });

  function trackingSession(
    instanceId: string,
    sessionId: string,
    intervals: ActivityInterval[],
  ): TrackingSession {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: sessionId,
      instanceId,
      state: "completed",
      startedAt: Math.min(...intervals.map((value) => value.startedAt)),
      updatedAt: Math.max(...intervals.map((value) => value.endedAt)),
      endedAt: Math.max(...intervals.map((value) => value.endedAt)),
      intervals,
    };
  }

  function interval(
    id: string,
    sessionId: string,
    projectId: string,
    languageId: string | null,
    startedAt: number,
    endedAt: number,
    lastInteractionAt = startedAt,
  ): ActivityInterval {
    return {
      schemaVersion: SCHEMA_VERSION,
      id,
      sessionId,
      projectId,
      documentId: null,
      languageId,
      lastInteractionAt,
      startedAt,
      endedAt,
      monotonicStartedAt: startedAt,
      monotonicEndedAt: endedAt,
    };
  }
});
