import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataManager, GlobalData } from "../DataManager";

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

  test("merges saves from multiple managers tracking different projects", () => {
    const first = createManager();
    const second = createManager();

    first.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    second.addTime("/workspace/beta", "javascript", "src/b.js", 20);

    first.saveData();
    second.saveData();

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

  test("sums overlapping saves instead of overwriting the same project day", () => {
    const first = createManager();
    const second = createManager();

    first.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    first.addKeystrokes("/workspace/alpha", 5);
    first.addLines("/workspace/alpha", 2, 1);

    second.addTime("/workspace/alpha", "typescript", "src/a.ts", 20);
    second.addKeystrokes("/workspace/alpha", 7);
    second.addLines("/workspace/alpha", 3, 2);

    first.saveData();
    second.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.seconds, 30);
    assert.strictEqual(day.keystrokes, 12);
    assert.strictEqual(day.linesAdded, 5);
    assert.strictEqual(day.linesDeleted, 3);
    assert.strictEqual(day.languages.typescript.seconds, 30);
    assert.strictEqual(day.files["src/a.ts"], 30);
  });

  test("tracks workflow metrics alongside existing counters", () => {
    const manager = createManager();

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10, "main");
    manager.addEditActivity("/workspace/alpha", 120, "src/a.ts", true);
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
    manager.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.focusSeconds, 10);
    assert.strictEqual(day.editEvents, 1);
    assert.strictEqual(day.pasteEvents, 1);
    assert.strictEqual(day.filesTouched["src/a.ts"], 2);
    assert.strictEqual(day.saves, 1);
    assert.strictEqual(day.contextSwitches, 1);
    assert.strictEqual(day.debugSeconds, 5);
    assert.strictEqual(day.idleSeconds, 3);
    assert.strictEqual(day.diagnosticsBySeverity.error, 1);
    assert.strictEqual(day.diagnosticsBySeverity.warning, 2);
    assert.strictEqual(day.gitDirtyFiles, 6);
    assert.strictEqual(day.branches.main, 10);
  });

  test("keeps snapshot metrics when unrelated activity is merged later", () => {
    const first = createManager();

    first.setDiagnostics("/workspace/alpha", {
      error: 1,
      warning: 2,
      info: 0,
      hint: 0,
    });
    first.setGitDirtyFiles("/workspace/alpha", 4);
    first.saveData();

    const second = createManager();
    second.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    second.saveData();

    const day =
      readData().projects[path.normalize("/workspace/alpha").toLowerCase()]
        .days["2026-05-18"];

    assert.strictEqual(day.diagnosticsBySeverity.error, 1);
    assert.strictEqual(day.diagnosticsBySeverity.warning, 2);
    assert.strictEqual(day.gitDirtyFiles, 4);
    assert.strictEqual(day.seconds, 10);
  });

  test("extends the current flow across periodic saves", () => {
    const manager = createManager();

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    manager.saveData();
    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 5);
    manager.saveData();

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
              linesDeleted: 0,
              languages: {},
              hours: {},
              files: {},
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
    assert.strictEqual(day.pasteEvents, 0);
    assert.deepStrictEqual(day.filesTouched, {});
    assert.strictEqual(day.saves, 0);
    assert.strictEqual(day.diagnosticsBySeverity.error, 0);
    assert.strictEqual(day.flow.count, 0);
  });

  test("keeps latest explicit daily goal while merging pending activity", () => {
    const first = createManager();
    const second = createManager();

    first.setDailyGoal(6);
    second.addTime("/workspace/beta", "javascript", "src/b.js", 20);
    second.saveData();

    const data = readData();
    assert.strictEqual(data.dailyGoal, 21600);
    assert.strictEqual(
      data.projects[path.normalize("/workspace/beta").toLowerCase()].days[
        "2026-05-18"
      ].seconds,
      20,
    );
  });

  test("uses local calendar date keys instead of UTC date keys", () => {
    now = new Date(2026, 4, 18, 0, 30, 0);
    const manager = createManager();

    manager.addTime("/workspace/local", "typescript", "src/index.ts", 1);
    manager.saveData();

    const days =
      readData().projects[path.normalize("/workspace/local").toLowerCase()]
        .days;

    assert.ok(days["2026-05-18"]);
    assert.strictEqual(days["2026-05-17"], undefined);
  });

  test("writes valid JSON atomically and clears temporary files", () => {
    const manager = createManager();

    manager.addTime("/workspace/alpha", "typescript", "src/a.ts", 10);
    manager.saveData();

    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(dataPath, "utf8")));
    assert.deepStrictEqual(
      fs.readdirSync(tempDir).filter((file) => file.endsWith(".tmp")),
      [],
    );
  });

  test("escapes CSV cells", () => {
    const manager = createManager();

    manager.addTime('/workspace/project "quoted"', "typescript", "src/a.ts", 1);
    const csv = manager.generateCSV();

    assert.match(csv, /"project ""quoted"""/);
    assert.match(csv, /"FocusSeconds"/);
  });

  function createManager(): DataManager {
    return new DataManager({
      dataPath,
      now: () => now,
    });
  }

  function readData(): GlobalData {
    return JSON.parse(fs.readFileSync(dataPath, "utf8")) as GlobalData;
  }
});
