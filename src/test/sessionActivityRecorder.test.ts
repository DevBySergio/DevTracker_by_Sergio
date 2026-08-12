import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { SessionActivityRecorder } from "../persistence/SessionActivityRecorder";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";
import { nodeFileSystem } from "../platform/ports";
import { RangeQueryEngine } from "../queries/RangeQueryEngine";
import { RangeQueryService } from "../queries/RangeQueryService";

suite("SessionActivityRecorder", () => {
  let temporaryDirectory: string;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-session-recorder-"),
    );
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("persists enriched tracking slices into the active host session", async () => {
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
    const session = await store.startSession("instance-test");
    const recorder = new SessionActivityRecorder({
      store,
      sessionId: session.id,
      createIntervalId: () => "interval-test",
    });

    recorder.recordActivityInterval({
      projectId: "project-test",
      localDate: "2026-08-07",
      documentId: null,
      languageId: "typescript",
      startedAt: now,
      endedAt: now + 1_000,
      monotonicStartedAt: 10,
      monotonicEndedAt: 1_010,
      lastInteractionAt: now,
    });
    await recorder.flush();

    assert.deepStrictEqual(
      (await store.getActiveSession(session.id)).intervals,
      [
        {
          schemaVersion: SCHEMA_VERSION,
          id: "interval-test",
          sessionId: session.id,
          projectId: "project-test",
          documentId: null,
          languageId: "typescript",
          startedAt: now,
          endedAt: now + 1_000,
          monotonicStartedAt: 10,
          monotonicEndedAt: 1_010,
          lastInteractionAt: now,
        },
      ],
    );
    const rollup = await store.readDailyRollup(
      "project-test",
      "2026-08-07",
    );
    assert.strictEqual(rollup.activeTimeMs, 1_000);
    assert.deepStrictEqual(rollup.activeTimeByLanguageMs, {
      typescript: 1_000,
    });
    assert.deepStrictEqual(rollup.activeTimeByDocumentMs, {});
    assert.strictEqual(
      Object.values(rollup.activeTimeByQuarterHourMs).reduce(
        (total, duration) => total + duration,
        0,
      ),
      1_000,
    );
  });

  test("normalizes real fractional clock boundaries and exposes active time after reload", async () => {
    const now = new Date(2026, 7, 7, 12, 0, 0).getTime();
    const clock = { now: () => new Date(now), nowMs: () => now };
    const store = new SessionStoreV2({
      storagePath: temporaryDirectory,
      clock,
      fileSystem: nodeFileSystem,
      createId: (prefix) => `${prefix}-fractional`,
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
    const session = await store.startSession("instance-fractional");
    const recorder = new SessionActivityRecorder({
      store,
      sessionId: session.id,
      createIntervalId: () => "interval-fractional",
    });

    recorder.recordActivityInterval({
      projectId: "project-test",
      localDate: "2026-08-07",
      documentId: "src/index.ts",
      languageId: "typescript",
      startedAt: now + 0.25,
      endedAt: now + 1_000.75,
      monotonicStartedAt: 10.25,
      monotonicEndedAt: 1_010.75,
      lastInteractionAt: now,
    });
    await recorder.flush();

    const interval = (await store.getActiveSession(session.id)).intervals[0];
    assert.strictEqual(interval.startedAt, now);
    assert.strictEqual(interval.endedAt, now + 1_001);
    assert.strictEqual(interval.monotonicStartedAt, 10);
    assert.strictEqual(interval.monotonicEndedAt, 1_011);

    const reloaded = new SessionStoreV2({
      storagePath: temporaryDirectory,
      clock,
      fileSystem: nodeFileSystem,
    });
    await reloaded.initialize();
    const query = new RangeQueryService(
      reloaded,
      new RangeQueryEngine(clock),
    );
    const view = await query.query({ preset: "today" });

    assert.strictEqual(view.current.metrics.activeTimeMs, 1_001);
    assert.deepStrictEqual(view.current.languages, [
      { id: "typescript", activeTimeMs: 1_001 },
    ]);
    assert.deepStrictEqual(view.current.files, [
      { id: "src/index.ts", activeTimeMs: 1_001 },
    ]);
  });
});
