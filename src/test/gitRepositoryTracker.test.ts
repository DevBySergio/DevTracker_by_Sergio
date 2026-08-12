import * as assert from "assert";
import { GitRepositoryTracker } from "../integrations/GitRepositoryTracker";

suite("GitRepositoryTracker", () => {
  test("reports explicit disabled, unavailable, and no-repository states", () => {
    const tracker = new GitRepositoryTracker("linux");

    assert.strictEqual(tracker.getState("/workspace/file.ts").status, "disabled");
    tracker.setMode("unavailable");
    assert.strictEqual(
      tracker.getState("/workspace/file.ts").status,
      "unavailable",
    );
    tracker.setMode("available");
    assert.strictEqual(
      tracker.getState("/workspace/file.ts").status,
      "no-repository",
    );
  });

  test("keeps repositories independent and selects the most specific root", () => {
    const tracker = new GitRepositoryTracker("linux");
    tracker.setMode("available");
    tracker.observeRepository({
      repositoryUri: "file:///workspace",
      rootPath: "/workspace",
      branch: "main",
      headCommit: "a",
      dirtyResourceUris: [
        "file:///workspace/src/a.ts",
        "file:///workspace/src/a.ts",
        "file:///workspace/src/b.ts",
      ],
    });
    tracker.observeRepository({
      repositoryUri: "file:///workspace/packages/nested",
      rootPath: "/workspace/packages/nested",
      branch: "feature/nested",
      headCommit: "b",
      dirtyResourceUris: [],
    });

    assert.deepStrictEqual(tracker.getState("/workspace/src/a.ts"), {
      status: "available",
      repositoryUri: "file:///workspace",
      repositoryRootPath: "/workspace",
      branch: "main",
      headCommit: "a",
      dirtyFiles: 2,
    });
    assert.strictEqual(
      tracker.getState("/workspace/packages/nested/src/index.ts").branch,
      "feature/nested",
    );
    assert.strictEqual(
      tracker.getState("/workspace-other/file.ts").status,
      "no-repository",
    );
  });

  test("emits branch and commit transitions once per repository snapshot", () => {
    const tracker = new GitRepositoryTracker("linux");
    const changes: Array<{ branchChanged: boolean; commitDetected: boolean }> = [];
    tracker.onDidChange(({ branchChanged, commitDetected }) => {
      changes.push({ branchChanged, commitDetected });
    });
    tracker.setMode("available");
    const observe = (
      branch: string,
      headCommit: string,
      commitEvent = false,
    ): void => {
      tracker.observeRepository({
        repositoryUri: "file:///workspace",
        rootPath: "/workspace",
        branch,
        headCommit,
        dirtyResourceUris: [],
        commitEvent,
      });
    };

    observe("main", "a");
    observe("main", "a");
    observe("feature/git", "a");
    observe("feature/git", "b");
    observe("feature/git", "b", true);
    observe("feature/git", "b", true);

    assert.deepStrictEqual(changes, [
      { branchChanged: false, commitDetected: false },
      { branchChanged: true, commitDetected: false },
      { branchChanged: false, commitDetected: true },
    ]);
  });
});
