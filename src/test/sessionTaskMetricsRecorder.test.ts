import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";
import { SessionTaskMetricsRecorder } from "../persistence/SessionTaskMetricsRecorder";
import { nodeFileSystem } from "../platform/ports";

suite("SessionTaskMetricsRecorder", () => {
  let temporaryDirectory: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-task-recorder-"),
    );
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("persists only configured name, classification, duration, and result", async () => {
    const now = new Date(2026, 7, 12, 12, 0, 0).getTime();
    const store = new SessionStoreV2({
      storagePath: temporaryDirectory,
      clock: { now: () => new Date(now), nowMs: () => now },
      fileSystem: nodeFileSystem,
    });
    await store.initialize();
    await store.upsertProjectIdentity({
      schemaVersion: SCHEMA_VERSION,
      id: "project-tasks",
      canonicalUri: "file:///workspace/tasks",
      displayName: "tasks",
      scheme: "file",
      authority: null,
      createdAt: now,
      updatedAt: now,
    });
    const recorder = new SessionTaskMetricsRecorder(store);
    recorder.recordTaskRun({
      projectId: "project-tasks",
      localDate: "2026-08-12",
      configuredName: "npm: test",
      classification: "test",
      durationMs: 1_500,
      result: "succeeded",
    });
    await recorder.flush();

    const rollup = await store.readDailyRollup(
      "project-tasks",
      "2026-08-12",
    );
    assert.deepStrictEqual(rollup.taskRuns, [
      {
        configuredName: "npm: test",
        classification: "test",
        durationMs: 1_500,
        result: "succeeded",
      },
    ]);
    const serialized = JSON.stringify(rollup.taskRuns);
    assert.ok(!serialized.includes("command"));
    assert.ok(!serialized.includes("terminal"));
    assert.ok(!serialized.includes("output"));
    assert.ok(!serialized.includes("variable"));
  });

  test("rejects extra task payload fields and invalid outcomes", async () => {
    const now = Date.now();
    const store = new SessionStoreV2({
      storagePath: temporaryDirectory,
      clock: { now: () => new Date(now), nowMs: () => now },
      fileSystem: nodeFileSystem,
    });
    await store.initialize();
    assert.throws(
      () =>
        store.addTaskRun("project-tasks", "2026-08-12", {
          configuredName: "compile",
          classification: "build",
          durationMs: 1,
          result: "invalid",
        } as never),
      /result is invalid/,
    );
    assert.throws(
      () =>
        store.addTaskRun("project-tasks", "2026-08-12", {
          configuredName: "compile",
          classification: "build",
          durationMs: 1,
          result: "succeeded",
          command: "private",
        } as never),
      /unexpected|extra|keys mismatch/,
    );
  });
});
