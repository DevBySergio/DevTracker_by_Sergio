import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataManager, GlobalData } from "../DataManager";
import { FileSystemAdapter, nodeFileSystem } from "../platform/ports";
import { DevTrackerQueries } from "../queries/DevTrackerQueries";

suite("DataManager", () => {
  let tempDir: string;
  let dataPath: string;
  let now: Date;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "devtracker-test-"));
    dataPath = path.join(tempDir, "data.json");
    now = new Date(2026, 4, 18, 23, 30, 0);
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("merges saves from multiple managers tracking different projects", async () => {
    const first = createManager();
    const second = createManager();

    first.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    second.addTime("/workspace/beta", "javascript", "src/b.js", 20);

    await first.saveData();
    await second.saveData();

    const data = readData();
    assert.strictEqual(
      data.projects[path.normalize("/workspace/alpha").toLowerCase()].days[
        "2026-05-18"
      ].seconds,
      10,
    );
    assert.strictEqual(
      data.projects[path.normalize("/workspace/beta").toLowerCase()].days[
        "2026-05-18"
      ].seconds,
      20,
    );
  });

  test("sums overlapping saves instead of overwriting the same project day", async () => {
    const first = createManager();
    const second = createManager();

    first.addTime(
      "/workspace/alpha",
      "typescript",
      "src/a.ts",
      10,
      "main",
      undefined,
      true,
      "document-a",
    );
    first.addEditActivity("/workspace/alpha", {
      insertedCharacters: 5,
      removedCharacters: 1,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 2,
      removedLineBreaksApprox: 1,
    });

    second.addTime(
      "/workspace/alpha",
      "typescript",
      "src/a.ts",
      20,
      "main",
      undefined,
      true,
      "document-a",
    );
    second.addEditActivity("/workspace/alpha", {
      insertedCharacters: 7,
      removedCharacters: 2,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 3,
      removedLineBreaksApprox: 2,
    });

    await first.saveData();
    await second.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.seconds, 30);
    assert.strictEqual(day.insertedCharacters, 12);
    assert.strictEqual(day.removedCharacters, 3);
    assert.strictEqual(day.insertedLineBreaksApprox, 5);
    assert.strictEqual(day.removedLineBreaksApprox, 3);
    assert.strictEqual(day.languages.typescript.seconds, 30);
    assert.strictEqual(day.activeTimeByDocumentMs?.["document-a"], 30_000);
    assert.strictEqual(Object.keys(day.activeTimeByDocumentMs || {}).length, 1);
    assert.strictEqual(day.keystrokes, 0);
    assert.strictEqual(day.linesAdded, 0);
    assert.strictEqual(day.files["src/a.ts"], undefined);
  });

  test("tracks workflow metrics alongside existing counters", async () => {
    const manager = createManager();

    manager.addTime(
      "/workspace/alpha",
      "typescript",
      "src/a.ts",
      10,
      "main",
      undefined,
      true,
      "document-a",
    );
    manager.addEditActivity("/workspace/alpha", {
      insertedCharacters: 120,
      removedCharacters: 5,
      largeEditEvents: 1,
      insertedLineBreaksApprox: 4,
      removedLineBreaksApprox: 2,
    });
    manager.addSave("/workspace/alpha");
    manager.addContextSwitch("/workspace/alpha");
    manager.addDebugSeconds("/workspace/alpha", 5);
    manager.addIdleSeconds("/workspace/alpha", 3);
    manager.setDiagnostics("/workspace/alpha", {
      error: 1,
      warning: 2,
      info: 3,
      hint: 4,
    });
    manager.setGitDirtyFiles("/workspace/alpha", 6);
    await manager.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.focusSeconds, 10);
    assert.strictEqual(day.editEvents, 1);
    assert.strictEqual(day.insertedCharacters, 120);
    assert.strictEqual(day.removedCharacters, 5);
    assert.strictEqual(day.largeEditEvents, 1);
    assert.strictEqual(day.insertedLineBreaksApprox, 4);
    assert.strictEqual(day.removedLineBreaksApprox, 2);
    assert.strictEqual(day.activeTimeByDocumentMs?.["document-a"], 10_000);
    assert.strictEqual(day.pasteEvents, 0);
    assert.deepStrictEqual(day.filesTouched, {});
    assert.strictEqual(day.saves, 1);
    assert.strictEqual(day.contextSwitches, 1);
    assert.strictEqual(day.debugSeconds, 5);
    assert.strictEqual(day.idleSeconds, 3);
    assert.strictEqual(day.diagnosticsBySeverity.error, 1);
    assert.strictEqual(day.diagnosticsBySeverity.warning, 2);
    assert.strictEqual(day.gitDirtyFiles, 6);
    assert.strictEqual(day.branches.main, 10);
  });

  test("keeps active-file time independent from edit events and unique files", async () => {
    const manager = createManager();
    const addActiveTime = (seconds: number, documentId: string): void => {
      manager.addTime(
        "/workspace/alpha",
        "typescript",
        "src/a.ts",
        seconds,
        "main",
        undefined,
        false,
        documentId,
      );
    };

    addActiveTime(1, "document-a");
    manager.addEditActivity("/workspace/alpha", {
      insertedCharacters: 1,
      removedCharacters: 0,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 0,
      removedLineBreaksApprox: 0,
    });
    addActiveTime(2, "document-a");
    manager.addEditActivity("/workspace/alpha", {
      insertedCharacters: 0,
      removedCharacters: 1,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 0,
      removedLineBreaksApprox: 0,
    });
    addActiveTime(3, "document-b");
    await manager.flush();

    const session = manager.getSessionState();
    assert.deepStrictEqual(session.activeTimeByDocumentMs, {
      "document-a": 3_000,
      "document-b": 3_000,
    });
    assert.strictEqual(Object.keys(session.activeTimeByDocumentMs).length, 2);
    assert.strictEqual(session.editEvents, 2);
    assert.strictEqual(session.keystrokes, 0);
    assert.deepStrictEqual(session.filesTouched, {});

    const day =
      readData().projects[path.normalize("/workspace/alpha")].days[
        "2026-05-18"
      ];
    assert.deepStrictEqual(day.activeTimeByDocumentMs, {
      "document-a": 3_000,
      "document-b": 3_000,
    });
    assert.strictEqual(day.editEvents, 2);
    assert.deepStrictEqual(day.filesTouched, {});
  });

  test("keeps snapshot metrics when unrelated activity is merged later", async () => {
    const first = createManager();

    first.setDiagnostics("/workspace/alpha", {
      error: 1,
      warning: 2,
      info: 0,
      hint: 0,
    });
    first.setGitDirtyFiles("/workspace/alpha", 4);
    await first.saveData();

    const second = createManager();
    second.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    await second.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.diagnosticsBySeverity.error, 1);
    assert.strictEqual(day.diagnosticsBySeverity.warning, 2);
    assert.strictEqual(day.gitDirtyFiles, 4);
    assert.strictEqual(day.seconds, 10);
  });

  test("extends the current flow across periodic saves", async () => {
    const manager = createManager();

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    await manager.saveData();
    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 5);
    await manager.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.flow.count, 1);
    assert.strictEqual(day.flow.currentSeconds, 15);
    assert.strictEqual(day.flow.longestSeconds, 15);
  });

  test("adds defaults when reading legacy day records", () => {
    const key = path.normalize("/workspace/legacy").toLowerCase();
    const legacyData = {
      dailyGoal: 14400,
      projects: {
        [key]: {
          name: "legacy",
          path: "/workspace/legacy",
          days: {
            "2026-05-18": {
              date: "2026-05-18",
              seconds: 15,
              keystrokes: 2,
              linesAdded: 1,
              linesDeleted: 3,
              languages: {},
              hours: {},
              files: {},
              pasteEvents: 2,
            },
          },
        },
      },
    };
    fs.writeFileSync(dataPath, JSON.stringify(legacyData));

    const manager = createManager();
    const day = manager.getProjectData("/workspace/legacy").days["2026-05-18"];

    assert.strictEqual(day.focusSeconds, 15);
    assert.strictEqual(day.editEvents, 0);
    assert.strictEqual(day.pasteEvents, 2);
    assert.strictEqual(day.insertedCharacters, 0);
    assert.strictEqual(day.removedCharacters, 0);
    assert.strictEqual(day.largeEditEvents, 2);
    assert.strictEqual(day.insertedLineBreaksApprox, 1);
    assert.strictEqual(day.removedLineBreaksApprox, 3);
    assert.deepStrictEqual(day.activeTimeByDocumentMs, {});
    assert.deepStrictEqual(day.filesTouched, {});
    assert.strictEqual(day.saves, 0);
    assert.strictEqual(day.diagnosticsBySeverity.error, 0);
    assert.strictEqual(day.flow.count, 0);
  });

  test("keeps latest explicit daily goal while merging pending activity", async () => {
    const first = createManager();
    const second = createManager();

    first.setDailyGoal(6);
    await first.flush();
    second.addTime("/workspace/beta", "javascript", "src/b.js", 20);
    await second.saveData();

    const data = readData();
    assert.strictEqual(data.dailyGoal, 21600);
    assert.strictEqual(
      data.projects[path.normalize("/workspace/beta").toLowerCase()].days[
        "2026-05-18"
      ].seconds,
      20,
    );
  });

  test("persists and clears the optional weekly goal", async () => {
    const manager = createManager();

    manager.setWeeklyGoal(20);
    await manager.flush();
    assert.strictEqual(manager.getWeeklyGoal(), 72_000);
    assert.strictEqual(readData().weeklyGoal, 72_000);

    manager.setWeeklyGoal(null);
    await manager.flush();
    assert.strictEqual(manager.getWeeklyGoal(), null);
    assert.strictEqual(readData().weeklyGoal, undefined);
  });

  test("uses local calendar date keys instead of UTC date keys", async () => {
    now = new Date(2026, 4, 18, 0, 30, 0);
    const manager = createManager();

    manager.addTime("/workspace/local", "typescript", "src/index.ts", 1);
    await manager.saveData();

    const days =
      readData().projects[path.normalize("/workspace/local").toLowerCase()]
        .days;

    assert.ok(days["2026-05-18"]);
    assert.strictEqual(days["2026-05-17"], undefined);
  });

  test("preserves path case on case-sensitive platforms", async () => {
    if (process.platform === "win32") {
      return;
    }
    const manager = createManager();

    manager.addTime("/Workspace/App", "typescript", "src/a.ts", 1);
    manager.addTime("/workspace/App", "typescript", "src/b.ts", 1);
    await manager.saveData();

    assert.strictEqual(Object.keys(readData().projects).length, 2);
  });

  test("writes valid JSON atomically and clears temporary files", async () => {
    const manager = createManager();

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    await manager.saveData();

    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(dataPath, "utf8")));
    assert.deepStrictEqual(
      fs.readdirSync(tempDir).filter((file) => file.endsWith(".tmp")),
      [],
    );
  });

  test("accepts injected clock and filesystem adapters", async () => {
    let dataWrites = 0;
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      writeFile: async (filePath, data) => {
        dataWrites += 1;
        await nodeFileSystem.writeFile(filePath, data);
      },
    };
    const manager = new DataManager({
      dataPath,
      clock: {
        now: () => now,
        nowMs: () => now.getTime(),
      },
      fileSystem,
    });

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    await manager.saveData();

    assert.strictEqual(manager.getSessionState().startTime, now.getTime());
    assert.strictEqual(dataWrites, 1);
  });

  test("debounces mutations and coalesces them into one queued write", async () => {
    let dataWrites = 0;
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      writeFile: async (filePath, data) => {
        dataWrites += 1;
        await nodeFileSystem.writeFile(filePath, data);
      },
    };
    const manager = new DataManager({
      dataPath,
      clock: {
        now: () => now,
        nowMs: () => now.getTime(),
      },
      fileSystem,
      debounceMs: 20,
    });

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    manager.addEditActivity("/workspace/alpha", {
      insertedCharacters: 2,
      removedCharacters: 1,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 0,
      removedLineBreaksApprox: 0,
    });
    manager.addSave("/workspace/alpha");

    assert.strictEqual(fs.existsSync(dataPath), false);
    assert.deepStrictEqual(manager.getPersistenceHealth(), {
      status: "pending",
      pendingWrites: 1,
      lastSuccessfulWriteAt: null,
      lastError: null,
    });

    await waitFor(() => fs.existsSync(dataPath));
    await manager.flush();

    assert.strictEqual(dataWrites, 1);
    assert.strictEqual(
      readData().projects[path.normalize("/workspace/alpha")].days[
        "2026-05-18"
      ].seconds,
      10,
    );
    assert.strictEqual(manager.getPersistenceHealth().status, "idle");
  });

  test("retains failed deltas for retry and exposes persistence health", async () => {
    let shouldFail = true;
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      writeFile: async (filePath, data) => {
        if (shouldFail) {
          throw new Error("synthetic write failure");
        }
        await nodeFileSystem.writeFile(filePath, data);
      },
    };
    const manager = new DataManager({
      dataPath,
      clock: {
        now: () => now,
        nowMs: () => now.getTime(),
      },
      fileSystem,
      debounceMs: 60_000,
    });

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    await assert.rejects(() => manager.flush(), /synthetic write failure/);
    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 5);

    assert.deepStrictEqual(manager.getPersistenceHealth(), {
      status: "failed",
      pendingWrites: 1,
      lastSuccessfulWriteAt: null,
      lastError: "synthetic write failure",
    });
    assert.strictEqual(
      manager.getProjectData("/workspace/alpha").days["2026-05-18"].seconds,
      15,
    );

    shouldFail = false;
    await manager.flush();

    assert.strictEqual(
      readData().projects[path.normalize("/workspace/alpha")].days[
        "2026-05-18"
      ].seconds,
      15,
    );
    assert.deepStrictEqual(manager.getPersistenceHealth(), {
      status: "idle",
      pendingWrites: 0,
      lastSuccessfulWriteAt: now.getTime(),
      lastError: null,
    });
  });

  test("seeds a separate compatibility snapshot without mutating the input", async () => {
    const initialData = createInitialData(15);
    const manager = new DataManager({
      dataPath,
      clock: {
        now: () => now,
        nowMs: () => now.getTime(),
      },
      initialData,
    });

    initialData.projects[path.normalize("/workspace/legacy")].days[
      "2026-05-18"
    ].seconds = 999;
    await manager.flush();

    assert.strictEqual(
      readData().projects[path.normalize("/workspace/legacy")].days[
        "2026-05-18"
      ].seconds,
      15,
    );
  });

  test("does not duplicate a concurrent compatibility seed", async () => {
    const initialData = createInitialData(15);
    const first = new DataManager({ dataPath, initialData });
    const second = new DataManager({ dataPath, initialData });

    await first.flush();
    await second.flush();

    assert.strictEqual(
      readData().projects[path.normalize("/workspace/legacy")].days[
        "2026-05-18"
      ].seconds,
      15,
    );
  });

  test("waits for a legacy lock without blocking the event loop", async () => {
    const manager = createManager();
    const lockPath = `${dataPath}.lock`;
    let timerRan = false;
    fs.writeFileSync(lockPath, "other manager");

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 1);
    setTimeout(() => {
      timerRan = true;
      fs.unlinkSync(lockPath);
    }, 10);

    await manager.saveData();

    assert.strictEqual(timerRan, true);
    assert.strictEqual(
      readData().projects[path.normalize("/workspace/alpha")].days[
        "2026-05-18"
      ].seconds,
      1,
    );
  });

  test("builds dashboard snapshots through the query boundary", async () => {
    const manager = createManager();
    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    const queries = new DevTrackerQueries(manager);

    const snapshot = queries.getSnapshot("/workspace/alpha");

    assert.strictEqual(snapshot.session.seconds, 10);
    assert.strictEqual(snapshot.project?.name, "alpha");
    assert.strictEqual(snapshot.projects.length, 1);
    assert.strictEqual(snapshot.dailyGoalSeconds, 14400);
    assert.strictEqual(snapshot.todayTotalSeconds, 10);
    await manager.flush();
  });

  test("escapes CSV cells", async () => {
    const manager = createManager();

    manager.addTime('/workspace/project "quoted"', "typescript", "src/a.ts", 1);
    const csv = manager.generateCSV();

    assert.match(csv, /"project ""quoted"""/);
    assert.match(csv, /"FocusSeconds"/);
    assert.match(csv, /"InsertedCharacters"/);
    assert.doesNotMatch(csv, /"PasteEvents"/);
    await manager.flush();
  });

  function createManager(): DataManager {
    return new DataManager({
      dataPath,
      clock: {
        now: () => now,
        nowMs: () => now.getTime(),
      },
    });
  }

  function readData(): GlobalData {
    return JSON.parse(fs.readFileSync(dataPath, "utf8")) as GlobalData;
  }

  function createInitialData(seconds: number): GlobalData {
    const projectPath = "/workspace/legacy";
    return {
      dailyGoal: 14_400,
      projects: {
        [path.normalize(projectPath)]: {
          name: "legacy",
          path: projectPath,
          days: {
            "2026-05-18": {
              date: "2026-05-18",
              seconds,
              keystrokes: 0,
              linesAdded: 0,
              linesDeleted: 0,
              languages: {},
              hours: {},
              files: {},
              editEvents: 0,
              pasteEvents: 0,
              filesTouched: {},
              saves: 0,
              focusSeconds: seconds,
              idleSeconds: 0,
              debugSeconds: 0,
              diagnosticsBySeverity: {
                error: 0,
                warning: 0,
                info: 0,
                hint: 0,
              },
              contextSwitches: 0,
              branches: {},
              gitDirtyFiles: 0,
              flow: {
                count: 0,
                totalSeconds: 0,
                longestSeconds: 0,
                currentSeconds: 0,
              },
            },
          },
        },
      },
    };
  }

  async function waitFor(
    condition: () => boolean,
    timeoutMs = 1000,
  ): Promise<void> {
    const startedAt = Date.now();
    while (!condition()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out waiting for condition");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
});
