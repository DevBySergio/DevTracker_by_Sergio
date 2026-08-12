import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SCHEMA_VERSION } from "../domain/schemaV2";
import { nodeFileSystem } from "../platform/ports";
import { SessionGitMetricsRecorder } from "../persistence/SessionGitMetricsRecorder";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";

suite("SessionGitMetricsRecorder", () => {
  test("persists current Git state and additive repository transitions", async () => {
    const storagePath = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-git-recorder-"),
    );
    const now = new Date(2026, 7, 12, 12, 0, 0).getTime();
    const store = new SessionStoreV2({
      storagePath,
      clock: { now: () => new Date(now), nowMs: () => now },
      fileSystem: nodeFileSystem,
    });
    try {
      await store.initialize();
      await store.upsertProjectIdentity({
        schemaVersion: SCHEMA_VERSION,
        id: "project-git",
        canonicalUri: "file:///workspace/git",
        displayName: "git",
        scheme: "file",
        authority: null,
        createdAt: now,
        updatedAt: now,
      });
      const recorder = new SessionGitMetricsRecorder(store);
      recorder.recordGitMetrics({
        projectId: "project-git",
        localDate: "2026-08-12",
        status: "available",
        dirtyFiles: 3,
        branchChanges: 1,
        detectedCommits: 0,
      });
      recorder.recordGitMetrics({
        projectId: "project-git",
        localDate: "2026-08-12",
        status: "available",
        dirtyFiles: 1,
        branchChanges: 0,
        detectedCommits: 1,
      });
      await recorder.flush();

      const rollup = await store.readDailyRollup("project-git", "2026-08-12");
      assert.strictEqual(rollup.gitStatus, "available");
      assert.strictEqual(rollup.gitDirtyFiles, 1);
      assert.strictEqual(rollup.gitBranchChanges, 1);
      assert.strictEqual(rollup.gitDetectedCommits, 1);
    } finally {
      await store.flush();
      fs.rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
