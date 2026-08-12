import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { SessionDebugMetricsRecorder } from "../persistence/SessionDebugMetricsRecorder";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";
import { nodeFileSystem } from "../platform/ports";

suite("SessionDebugMetricsRecorder", () => {
  let temporaryDirectory: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-debug-recorder-"),
    );
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("persists aggregate debug durations without session configuration", async () => {
    const now = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const store = new SessionStoreV2({
      storagePath: temporaryDirectory,
      clock: { now: () => new Date(now), nowMs: () => now },
      fileSystem: nodeFileSystem,
      createId: (prefix) => `${prefix}-test`,
    });
    await store.initialize();
    await store.upsertProjectIdentity({
      schemaVersion: SCHEMA_VERSION,
      id: "project-test",
      canonicalUri: "file:///workspace/test",
      displayName: "test",
      scheme: "file",
      authority: null,
      createdAt: now,
      updatedAt: now,
    });
    const recorder = new SessionDebugMetricsRecorder(store);

    recorder.recordDebugMetrics({
      projectId: "project-test",
      localDate: "2026-08-07",
      debugElapsedMs: 1_500,
      debugActiveTimeMs: 0,
    });
    recorder.recordDebugMetrics({
      projectId: "project-test",
      localDate: "2026-08-07",
      debugElapsedMs: 0,
      debugActiveTimeMs: 750,
    });
    await recorder.flush();

    const rollup = await store.readDailyRollup(
      "project-test",
      "2026-08-07",
    );
    assert.strictEqual(rollup.debugElapsedMs, 1_500);
    assert.strictEqual(rollup.debugActiveTimeMs, 750);
    const serialized = JSON.stringify(rollup);
    assert.ok(!serialized.includes("configuration"));
    assert.ok(!serialized.includes("arguments"));
    assert.ok(!serialized.includes("session-a"));
  });

  test("rejects empty or unsafe aggregate mutations", async () => {
    const now = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const store = new SessionStoreV2({
      storagePath: temporaryDirectory,
      clock: { now: () => new Date(now), nowMs: () => now },
      fileSystem: nodeFileSystem,
    });
    await store.initialize();

    assert.throws(
      () => store.addDebugMetrics("project-test", "2026-08-07", 0, 0),
      /at least one duration must be positive/,
    );
    assert.throws(
      () => store.addDebugMetrics("../private", "2026-08-07", 1, 0),
      /unsafe/,
    );
  });
});
