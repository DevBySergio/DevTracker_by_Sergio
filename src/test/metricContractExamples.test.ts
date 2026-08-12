import * as assert from "assert";
import type {
  ActivityInterval,
  TrackingSession,
} from "../domain/schemaV2";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import type { RangeAggregateMetrics, RangePeriodViewModel } from "../domain/rangeQuery";
import type { Clock } from "../platform/ports";
import { buildPersonalInsights } from "../queries/PersonalInsights";
import { unionActivityIntervals } from "../queries/ActivityIntervalUnion";
import { ActivityStateMachine } from "../tracking/ActivityStateMachine";
import { DiagnosticsTracker } from "../tracking/DiagnosticsTracker";
import { summarizeEditorEdit } from "../tracking/EditMetrics";

suite("Metric contract numerical examples", () => {
  test("example 1 counts replacement payloads in both directions", () => {
    assert.deepStrictEqual(
      summarizeEditorEdit([
        { text: "abc", rangeLength: 2, removedLineSpan: 0 },
      ]),
      {
        insertedCharacters: 3,
        removedCharacters: 2,
        largeEditEvents: 0,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 0,
      },
    );
  });

  test("example 2 unions overlapping hosts into twelve minutes", () => {
    const result = unionActivityIntervals([
      session("instance-a", "session-a", [
        interval("interval-a", "session-a", "project-a", 0, minutes(10), 0),
      ]),
      session("instance-b", "session-b", [
        interval(
          "interval-b",
          "session-b",
          "project-b",
          minutes(5),
          minutes(12),
          minutes(5),
        ),
      ]),
    ]);

    assert.strictEqual(result.globalActiveTimeMs, minutes(12));
    assert.strictEqual(result.overlapTimeMs, minutes(5));
    assert.deepStrictEqual(result.activeTimeByProjectMs, {
      "project-a": minutes(5),
      "project-b": minutes(7),
    });
  });

  test("example 3 confirms a stable switch at five seconds only", () => {
    const confirmedClock = new FakeClock(Date.UTC(2026, 7, 7, 10));
    const confirmed = new ActivityStateMachine({ clock: confirmedClock });
    confirmed.interact("active-editor", context("file-a"));
    confirmedClock.advance(minutes(1));
    confirmed.interact("active-editor", context("file-b"));
    confirmedClock.advance(4_999);
    assert.deepStrictEqual(confirmed.tick().confirmedContextSwitches, []);
    confirmedClock.advance(1);
    assert.deepStrictEqual(confirmed.tick().confirmedContextSwitches, [
      {
        destinationProjectId: "project-a",
        localDateKey: "2026-08-07",
        fileSwitch: true,
        projectSwitch: false,
      },
    ]);

    const transientClock = new FakeClock(Date.UTC(2026, 7, 7, 10));
    const transient = new ActivityStateMachine({ clock: transientClock });
    transient.interact("active-editor", context("file-a"));
    transientClock.advance(minutes(1));
    transient.interact("active-editor", context("file-b"));
    transientClock.advance(3_000);
    transient.interact("active-editor", context("file-a"));
    transientClock.advance(5_000);
    assert.deepStrictEqual(transient.tick().confirmedContextSwitches, []);
  });

  test("example 4 creates two blocks for a three-minute flow gap", () => {
    const clock = new FakeClock(Date.UTC(2026, 7, 7, 10));
    const machine = new ActivityStateMachine({ clock });
    machine.interact("edit");
    clock.advance(minutes(1));
    machine.interact("save");
    clock.advance(minutes(3));
    const third = machine.interact("edit");

    assert.strictEqual(third.flow.flowBlockCount, 2);
    assert.strictEqual(third.flow.flowActiveMs, minutes(3));
  });

  test("example 5 derives 50 percent goal progress and 87.5 percent concentration", () => {
    const activeTimeMs = seconds(7_200);
    const period = rangePeriod(activeTimeMs, [
      { id: "file-a", activeTimeMs: seconds(3_000) },
      { id: "file-b", activeTimeMs: seconds(2_000) },
      { id: "file-c", activeTimeMs: seconds(1_300) },
      { id: "file-d", activeTimeMs: seconds(900) },
    ]);
    const insights = buildPersonalInsights({
      period,
      dailyGoalMs: seconds(14_400),
    });

    assert.strictEqual(insights.dailyGoalCompletionPercent.value, 50);
    assert.strictEqual(
      insights.focusProfile.topThreeFileSharePercent.value,
      87.5,
    );
  });

  test("example 6 replaces diagnostic snapshots and records deltas and peaks", () => {
    const clock = new FakeClock(Date.UTC(2026, 7, 7, 10));
    const tracker = new DiagnosticsTracker({
      clock,
      minEmissionIntervalMs: 0,
    });
    tracker.observe({
      projects: {
        "project-a": { error: 3, warning: 2, info: 0, hint: 0 },
      },
    });
    clock.advance(1);
    const [update] = tracker.observe({
      projects: {
        "project-a": { error: 1, warning: 4, info: 0, hint: 0 },
      },
    });

    assert.deepStrictEqual(update.diagnostics, {
      current: { error: 1, warning: 4, info: 0, hint: 0 },
      introduced: { error: 0, warning: 2, info: 0, hint: 0 },
      resolved: { error: 2, warning: 0, info: 0, hint: 0 },
      peak: { error: 3, warning: 4, info: 0, hint: 0 },
    });
  });
});

function session(
  instanceId: string,
  id: string,
  intervals: ActivityInterval[],
): TrackingSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
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
  startedAt: number,
  endedAt: number,
  lastInteractionAt: number,
): ActivityInterval {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    sessionId,
    projectId,
    documentId: null,
    languageId: "typescript",
    lastInteractionAt,
    startedAt,
    endedAt,
    monotonicStartedAt: startedAt,
    monotonicEndedAt: endedAt,
  };
}

function rangePeriod(
  activeTimeMs: number,
  files: RangePeriodViewModel["files"],
): RangePeriodViewModel {
  const aggregate = metrics(activeTimeMs);
  return {
    range: {
      startLocalDate: "2026-08-07",
      endLocalDate: "2026-08-07",
      localDates: ["2026-08-07"],
      complete: true,
    },
    metrics: aggregate,
    days: [{ localDate: "2026-08-07", metrics: aggregate }],
    projects: [],
    languages: [],
    files,
    branches: [],
    quarterHours: [],
  };
}

function metrics(activeTimeMs: number): RangeAggregateMetrics {
  return {
    activeTimeMs,
    debugElapsedMs: 0,
    debugActiveTimeMs: 0,
    editEvents: 0,
    insertedCharacters: 0,
    removedCharacters: 0,
    largeEditEvents: 0,
    insertedLineBreaksApprox: 0,
    removedLineBreaksApprox: 0,
    saveEvents: 0,
    fileSwitchEvents: 0,
    projectSwitchEvents: 0,
    flowBlockCount: 0,
    flowActiveMs: 0,
    longestFlowActiveMs: 0,
    gitStatus: "disabled",
    gitDirtyFiles: 0,
    gitBranchChanges: 0,
    gitDetectedCommits: 0,
    diagnostics: {
      current: { error: 0, warning: 0, info: 0, hint: 0 },
      introduced: { error: 0, warning: 0, info: 0, hint: 0 },
      resolved: { error: 0, warning: 0, info: 0, hint: 0 },
      peak: { error: 0, warning: 0, info: 0, hint: 0 },
    },
    legacyApproximate: false,
  };
}

function context(fileId: string): { projectId: string; fileId: string } {
  return { projectId: "project-a", fileId };
}

function minutes(value: number): number {
  return value * 60_000;
}

function seconds(value: number): number {
  return value * 1_000;
}

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
