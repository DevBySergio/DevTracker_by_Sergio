import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { SessionDailyMetricsRecorder } from "../persistence/SessionDailyMetricsRecorder";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";
import { SchemaValidationError } from "../persistence/schemaV2Validation";
import { nodeFileSystem } from "../platform/ports";

suite("SessionDailyMetricsRecorder", () => {
  let temporaryDirectory: string;
  const now = new Date(2026, 7, 7, 12, 0, 0).getTime();

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-daily-metrics-"),
    );
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("persists exact editor, save, switch, and flow metrics", async () => {
    const store = await createStore();
    const recorder = new SessionDailyMetricsRecorder(store);
    const scope = { projectId: "project-test", localDate: "2026-08-07" };

    recorder.recordEditActivity({
      ...scope,
      insertedCharacters: 12,
      removedCharacters: 3,
      largeEditEvents: 1,
      insertedLineBreaksApprox: 2,
      removedLineBreaksApprox: 1,
    });
    recorder.recordSave(scope);
    recorder.recordContextSwitch({ ...scope, projectSwitch: true });
    recorder.recordFlowBlock(scope);
    recorder.recordFlowActiveTime({ ...scope, durationMs: 1_000 });
    recorder.recordFlowActiveTime({ ...scope, durationMs: 500 });
    recorder.closeFlow(scope);
    await recorder.flush();

    const rollup = await store.readDailyRollup(
      scope.projectId,
      scope.localDate,
    );
    assert.strictEqual(rollup.editEvents, 1);
    assert.strictEqual(rollup.insertedCharacters, 12);
    assert.strictEqual(rollup.removedCharacters, 3);
    assert.strictEqual(rollup.largeEditEvents, 1);
    assert.strictEqual(rollup.insertedLineBreaksApprox, 2);
    assert.strictEqual(rollup.removedLineBreaksApprox, 1);
    assert.strictEqual(rollup.saveEvents, 1);
    assert.strictEqual(rollup.fileSwitchEvents, 1);
    assert.strictEqual(rollup.projectSwitchEvents, 1);
    assert.strictEqual(rollup.flowBlockCount, 1);
    assert.strictEqual(rollup.flowActiveMs, 1_500);
    assert.strictEqual(rollup.longestFlowActiveMs, 1_500);
  });

  test("rejects invalid deltas at the persistence boundary", async () => {
    const store = await createStore();
    assert.throws(
      () => store.applyDailyMetricDelta("project-test", "2026-08-07", {
        activeTimeMs: 0.5,
      }),
      SchemaValidationError,
    );
    await assert.rejects(
      store.applyDailyMetricDelta("project-test", "2026-08-07", {
        activeTimeByDocumentMs: { "../secret.ts": 1 },
      }),
      SchemaValidationError,
    );
  });

  async function createStore(): Promise<SessionStoreV2> {
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
    return store;
  }
});
