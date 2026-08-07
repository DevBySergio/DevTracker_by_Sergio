import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { SessionActivityRecorder } from "../persistence/SessionActivityRecorder";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";
import { nodeFileSystem } from "../platform/ports";

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
  });
});
