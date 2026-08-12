import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DailyRollup, ProjectIdentity, SCHEMA_VERSION } from "../domain/schemaV2";
import { Clock } from "../platform/ports";
import {
  LegacyMigration,
  LegacyMigrationRecoveryError,
  LegacyMigrationTarget,
  LegacyProjectDescriptor,
} from "../persistence/LegacyMigration";
import { nodeFileSystem } from "../platform/ports";

suite("LegacyMigration", () => {
  let tempDirectory: string;
  let legacyDataPath: string;
  let backupDirectory: string;
  let nowMs: number;
  let clock: Clock;

  setup(() => {
    tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-migration-"),
    );
    legacyDataPath = path.join(tempDirectory, ".devtracker", "data.json");
    backupDirectory = path.join(tempDirectory, "global-storage", "v2", "backups");
    nowMs = Date.UTC(2026, 7, 7, 12, 0, 0);
    clock = {
      now: () => new Date(nowMs),
      nowMs: () => nowMs,
    };
  });

  teardown(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test("returns clean evidence when the legacy source does not exist", async () => {
    const target = new RecordingTarget();
    const result = await createMigration(target).migrate();

    assert.deepStrictEqual(result, {
      status: "not-found",
      source: "none",
      importedFrom: null,
      backupPath: null,
      quarantinePath: null,
      recoveredFromBackupPath: null,
      projectsFound: 0,
      projectsImported: 0,
      daysFound: 0,
      rollupsWritten: 0,
      collisionsAggregated: 0,
    });
    assert.strictEqual(target.projects.size, 0);
    assert.strictEqual(target.rollups.size, 0);
    assert.strictEqual(target.flushCount, 0);
    assert.ok(!fs.existsSync(backupDirectory));
  });

  test("backs up bytes before mapping all conservatively reconstructable totals", async () => {
    const target = new RecordingTarget();
    const data = completeData();
    const raw = `  ${JSON.stringify(data, null, 2)}\n\n`;
    writeLegacy(raw);

    const result = await createMigration(target).migrate();

    assert.strictEqual(result.status, "migrated");
    assert.strictEqual(result.source, "original");
    assert.strictEqual(result.importedFrom, legacyDataPath);
    assert.ok(result.backupPath);
    assert.strictEqual(fs.readFileSync(result.backupPath, "utf8"), raw);
    assert.strictEqual(fs.readFileSync(legacyDataPath, "utf8"), raw);
    assert.strictEqual(result.quarantinePath, null);
    assert.strictEqual(result.projectsFound, 1);
    assert.strictEqual(result.projectsImported, 1);
    assert.strictEqual(result.daysFound, 1);
    assert.strictEqual(result.rollupsWritten, 1);
    assert.strictEqual(result.collisionsAggregated, 0);
    assert.strictEqual(target.flushCount, 1);

    const rollup = onlyRollup(target);
    assert.strictEqual(rollup.activeTimeMs, 90_500);
    assert.strictEqual(rollup.debugElapsedMs, 30_250);
    assert.strictEqual(rollup.debugActiveTimeMs, 0);
    assert.strictEqual(rollup.editEvents, 8);
    assert.strictEqual(rollup.insertedCharacters, 0);
    assert.strictEqual(rollup.removedCharacters, 0);
    assert.strictEqual(rollup.largeEditEvents, 2);
    assert.strictEqual(rollup.insertedLineBreaksApprox, 4);
    assert.strictEqual(rollup.removedLineBreaksApprox, 3);
    assert.strictEqual(rollup.saveEvents, 5);
    assert.strictEqual(rollup.fileSwitchEvents, 6);
    assert.strictEqual(rollup.projectSwitchEvents, 0);
    assert.strictEqual(rollup.flowBlockCount, 2);
    assert.strictEqual(rollup.flowActiveMs, 80_500);
    assert.strictEqual(rollup.longestFlowActiveMs, 50_250);
    assert.deepStrictEqual(rollup.diagnostics.current, {
      error: 1,
      warning: 2,
      info: 3,
      hint: 4,
    });
    assert.deepStrictEqual(rollup.diagnostics.introduced, {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
    });
    assert.deepStrictEqual(rollup.diagnostics.resolved, {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
    });
    assert.deepStrictEqual(rollup.diagnostics.peak, rollup.diagnostics.current);
    assert.deepStrictEqual(rollup.activeTimeByLanguageMs, {
      typescript: 70_250,
    });
    assert.deepStrictEqual(rollup.activeTimeByDocumentMs, {});
    assert.deepStrictEqual(rollup.activeTimeByQuarterHourMs, {});
    assert.strictEqual(rollup.legacyApproximate, true);

    assert.ok(result.normalizedData);
    assert.strictEqual(
      result.normalizedData.projects["/workspace/alpha"].days["2026-08-07"]
        .keystrokes,
      12,
    );
    result.normalizedData.dailyGoal = 1;
    assert.strictEqual(data.dailyGoal, 14_400);

    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(backupDirectory).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(result.backupPath).mode & 0o777, 0o600);
    }
  });

  test("normalizes partial historical day records without inventing detail", async () => {
    const target = new RecordingTarget();
    writeLegacy(
      JSON.stringify({
        projects: {
          "/workspace/legacy": {
            name: "legacy",
            path: "/workspace/legacy",
            days: {
              "2026-08-06": {
                date: "2026-08-06",
                seconds: 15,
                languages: {},
                hours: {},
                files: {},
              },
            },
          },
        },
      }),
    );

    const result = await createMigration(target).migrate();
    const day =
      result.normalizedData?.projects["/workspace/legacy"].days["2026-08-06"];

    assert.strictEqual(result.normalizedData?.dailyGoal, 14_400);
    assert.strictEqual(day?.focusSeconds, 15);
    assert.strictEqual(day?.editEvents, 0);
    assert.deepStrictEqual(day?.diagnosticsBySeverity, {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
    });
    const rollup = onlyRollup(target);
    assert.strictEqual(rollup.activeTimeMs, 15_000);
    assert.strictEqual(rollup.insertedCharacters, 0);
    assert.deepStrictEqual(rollup.activeTimeByDocumentMs, {});
    assert.deepStrictEqual(rollup.activeTimeByQuarterHourMs, {});
    assert.strictEqual(rollup.legacyApproximate, true);
  });

  test("strictly rejects invalid roots, projects, days, maps, dates, and numbers", async () => {
    const target = new RecordingTarget();
    const invalidSources: Array<[string, string]> = [
      ['{"projects":[]}', "projects: expected an object"],
      [
        JSON.stringify({
          projects: {
            alpha: { name: "alpha", path: "/alpha", days: [] },
          },
        }),
        "projects.alpha.days: expected an object",
      ],
      [
        JSON.stringify({
          projects: {
            alpha: {
              name: "alpha",
              path: "/alpha",
              days: { "2026-02-30": { date: "2026-02-30" } },
            },
          },
        }),
        "invalid calendar date",
      ],
      [
        JSON.stringify({
          projects: {
            alpha: {
              name: "alpha",
              path: "/alpha",
              days: {
                "2026-08-07": {
                  date: "2026-08-07",
                  languages: [],
                },
              },
            },
          },
        }),
        "languages: expected an object",
      ],
      [
        JSON.stringify({
          projects: {
            alpha: {
              name: "alpha",
              path: "/alpha",
              days: {
                "2026-08-07": {
                  date: "2026-08-07",
                  seconds: -1,
                },
              },
            },
          },
        }),
        "expected a non-negative finite number",
      ],
      ['{"dailyGoal":1e400,"projects":{}}', "non-negative finite number"],
      ['{"projects":{},"unexpected":true}', "unexpected keys [unexpected]"],
    ];

    for (const [raw, message] of invalidSources) {
      writeLegacy(raw);
      await assert.rejects(
        createMigration(target).migrate(),
        (error: unknown) =>
          error instanceof LegacyMigrationRecoveryError &&
          error.message.includes(message),
      );
      assert.strictEqual(fs.readFileSync(legacyDataPath, "utf8"), raw);
    }

    assert.strictEqual(target.projects.size, 0);
    assert.strictEqual(target.rollups.size, 0);
    const quarantines = fs.readdirSync(path.join(backupDirectory, "quarantine"));
    assert.strictEqual(quarantines.length, invalidSources.length);
  });

  test("quarantines corrupt input and recovers the most recent valid backup", async () => {
    const firstTarget = new RecordingTarget();
    const firstData = completeData();
    firstData.projects["/workspace/alpha"].days["2026-08-07"].focusSeconds = 10;
    writeLegacy(JSON.stringify(firstData));
    const first = await createMigration(firstTarget).migrate();

    nowMs += 1000;
    const secondTarget = new RecordingTarget();
    const secondData = completeData();
    secondData.projects["/workspace/alpha"].days["2026-08-07"].focusSeconds = 20;
    writeLegacy(JSON.stringify(secondData));
    const second = await createMigration(secondTarget).migrate();

    nowMs += 1000;
    const corruptRaw = '{"projects":{"broken":';
    writeLegacy(corruptRaw);
    const recoveryTarget = new RecordingTarget();
    const recovered = await createMigration(recoveryTarget).migrate();

    assert.strictEqual(first.status, "migrated");
    assert.strictEqual(recovered.status, "recovered");
    assert.strictEqual(recovered.source, "backup");
    assert.strictEqual(recovered.importedFrom, second.backupPath);
    assert.strictEqual(recovered.recoveredFromBackupPath, second.backupPath);
    assert.notStrictEqual(recovered.importedFrom, first.backupPath);
    assert.ok(recovered.quarantinePath);
    assert.strictEqual(
      fs.readFileSync(recovered.quarantinePath, "utf8"),
      corruptRaw,
    );
    assert.strictEqual(fs.readFileSync(legacyDataPath, "utf8"), corruptRaw);
    assert.strictEqual(onlyRollup(recoveryTarget).activeTimeMs, 20_000);
    assert.strictEqual(
      recovered.normalizedData?.projects["/workspace/alpha"].days[
        "2026-08-07"
      ].focusSeconds,
      20,
    );
  });

  test("aggregates identity collisions deterministically and reruns idempotently", async () => {
    const target = new RecordingTarget();
    const alphaDay = completeDay("2026-08-07");
    alphaDay.focusSeconds = 10;
    alphaDay.languages.typescript.seconds = 10;
    alphaDay.diagnosticsBySeverity.error = 1;
    alphaDay.flow.longestSeconds = 8;
    const betaDay = completeDay("2026-08-07");
    betaDay.focusSeconds = 20;
    betaDay.languages.typescript.seconds = 20;
    betaDay.diagnosticsBySeverity.error = 3;
    betaDay.flow.longestSeconds = 12;
    const raw = JSON.stringify({
      dailyGoal: 14_400,
      projects: {
        zeta: { name: "zeta", path: "/workspace/zeta", days: { "2026-08-07": betaDay } },
        alpha: { name: "alpha", path: "/workspace/alpha", days: { "2026-08-07": alphaDay } },
      },
    });
    writeLegacy(raw);
    const collidingIdentity = (descriptor: LegacyProjectDescriptor): ProjectIdentity => ({
      schemaVersion: SCHEMA_VERSION,
      id: "project-shared",
      canonicalUri: "file:///workspace/shared",
      displayName: descriptor.displayName,
      scheme: "file",
      authority: null,
      createdAt: nowMs,
      updatedAt: nowMs,
    });

    const first = await createMigration(target, collidingIdentity).migrate();
    const firstRollup = onlyRollup(target);
    const firstSnapshot = JSON.stringify(firstRollup);
    const second = await createMigration(target, collidingIdentity).migrate();

    assert.strictEqual(first.projectsFound, 2);
    assert.strictEqual(first.projectsImported, 1);
    assert.strictEqual(first.daysFound, 2);
    assert.strictEqual(first.rollupsWritten, 1);
    assert.strictEqual(first.collisionsAggregated, 1);
    assert.strictEqual(second.collisionsAggregated, 1);
    assert.strictEqual(target.projects.size, 1);
    assert.strictEqual(target.rollups.size, 1);
    assert.strictEqual(target.projects.get("project-shared")?.displayName, "alpha");
    assert.strictEqual(onlyRollup(target).activeTimeMs, 30_000);
    assert.strictEqual(
      onlyRollup(target).activeTimeByLanguageMs.typescript,
      30_000,
    );
    assert.strictEqual(onlyRollup(target).diagnostics.current.error, 3);
    assert.strictEqual(onlyRollup(target).diagnostics.peak.error, 3);
    assert.strictEqual(onlyRollup(target).longestFlowActiveMs, 12_000);
    assert.strictEqual(JSON.stringify(onlyRollup(target)), firstSnapshot);
    assert.strictEqual(target.flushCount, 2);
  });

  test("uses a durable completion marker instead of overwriting newer v2 metrics", async () => {
    const target = new RecordingTarget();
    writeLegacy(JSON.stringify(completeData()));
    const completionMarkerPath = path.join(
      tempDirectory,
      "global-storage",
      "v2",
      "metadata",
      "legacy-v1-complete.json",
    );
    const options = {
      legacyDataPath,
      backupDirectory,
      completionMarkerPath,
      clock,
      fileSystem: nodeFileSystem,
      target,
      createProjectIdentity: createIdentity,
    };

    const first = await new LegacyMigration(options).migrate();
    onlyRollup(target).activeTimeMs += 5_000;
    const second = await new LegacyMigration(options).migrate();

    assert.strictEqual(first.status, "migrated");
    assert.strictEqual(second.status, "already-migrated");
    assert.strictEqual(second.source, "original");
    assert.strictEqual(second.importedFrom, legacyDataPath);
    assert.strictEqual(onlyRollup(target).activeTimeMs, 95_500);
    assert.strictEqual(target.flushCount, 1);
    assert.ok(fs.existsSync(completionMarkerPath));
    assert.strictEqual(
      fs.readdirSync(backupDirectory).filter((name) => name.startsWith("legacy-data-"))
        .length,
      1,
    );
  });

  function createMigration(
    target: LegacyMigrationTarget,
    identityFactory: (
      descriptor: LegacyProjectDescriptor,
    ) => ProjectIdentity = createIdentity,
  ): LegacyMigration {
    return new LegacyMigration({
      legacyDataPath,
      backupDirectory,
      clock,
      fileSystem: nodeFileSystem,
      target,
      createProjectIdentity: identityFactory,
    });
  }

  function createIdentity(descriptor: LegacyProjectDescriptor): ProjectIdentity {
    const suffix = path.basename(descriptor.path).replace(/[^A-Za-z0-9._-]/g, "-");
    return {
      schemaVersion: SCHEMA_VERSION,
      id: `project-${suffix}`,
      canonicalUri: `file://${descriptor.path}`,
      displayName: descriptor.displayName,
      scheme: "file",
      authority: null,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
  }

  function writeLegacy(raw: string): void {
    fs.mkdirSync(path.dirname(legacyDataPath), { recursive: true });
    fs.writeFileSync(legacyDataPath, raw);
  }

  function completeData(): ReturnType<typeof JSON.parse> {
    return {
      dailyGoal: 14_400,
      projects: {
        "/workspace/alpha": {
          name: "alpha",
          path: "/workspace/alpha",
          days: { "2026-08-07": completeDay("2026-08-07") },
        },
      },
    };
  }

  function completeDay(date: string) {
    return {
      date,
      seconds: 100.75,
      keystrokes: 12,
      linesAdded: 4,
      linesDeleted: 3,
      languages: {
        typescript: { name: "typescript", seconds: 70.25 },
      },
      hours: { "12": 90.5 },
      files: { "src/index.ts": 60 },
      editEvents: 8,
      pasteEvents: 2,
      filesTouched: { "src/index.ts": 7 },
      saves: 5,
      focusSeconds: 90.5,
      idleSeconds: 11,
      debugSeconds: 30.25,
      diagnosticsBySeverity: { error: 1, warning: 2, info: 3, hint: 4 },
      contextSwitches: 6,
      branches: { main: 90.5 },
      gitDirtyFiles: 9,
      flow: {
        count: 2,
        totalSeconds: 80.5,
        longestSeconds: 50.25,
        currentSeconds: 10,
      },
    };
  }

  function onlyRollup(target: RecordingTarget): DailyRollup {
    assert.strictEqual(target.rollups.size, 1);
    return [...target.rollups.values()][0];
  }
});

class RecordingTarget implements LegacyMigrationTarget {
  public readonly projects = new Map<string, ProjectIdentity>();
  public readonly rollups = new Map<string, DailyRollup>();
  public flushCount = 0;

  public async upsertProjectIdentity(project: ProjectIdentity): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  public async writeDailyRollup(rollup: DailyRollup): Promise<void> {
    this.rollups.set(`${rollup.projectId}:${rollup.localDate}`, clone(rollup));
  }

  public async flush(): Promise<void> {
    this.flushCount += 1;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
