import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ActivityInterval,
  ProjectIdentity,
  SCHEMA_VERSION,
  SchemaMetadataV2,
  TrackingSession,
  createEmptyDailyRollup,
} from "../domain/schemaV2";
import { SessionStoreV2 } from "../persistence/SessionStoreV2";
import {
  SchemaValidationError,
  assertActivityInterval,
  assertDailyRollup,
  assertDocumentIdentity,
  assertProjectIdentity,
  assertSchemaMetadata,
  assertTrackingSession,
} from "../persistence/schemaV2Validation";
import { Clock, FileSystemAdapter, nodeFileSystem } from "../platform/ports";

suite("Schema v2", () => {
  let tempDirectory: string;
  let storagePath: string;
  let nowMs: number;
  let nextId: number;
  let clock: Clock;
  let stores: SessionStoreV2[];

  setup(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "devtracker-v2-"));
    storagePath = path.join(tempDirectory, "global-storage", "v2");
    nowMs = Date.UTC(2026, 7, 7, 10, 0, 0);
    nextId = 0;
    stores = [];
    clock = {
      now: () => new Date(nowMs),
      nowMs: () => nowMs,
    };
  });

  teardown(async () => {
    await Promise.all(
      stores.map(async (store) => {
        try {
          await store.flush();
        } catch {
          // A failure-path test may deliberately leave its first flush failed.
        }
      }),
    );
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test("creates protected schema-v2 areas using only async filesystem APIs", async () => {
    const store = createStore(asyncOnlyFileSystem());
    const metadata = await store.initialize();

    assert.strictEqual(metadata.schemaVersion, SCHEMA_VERSION);
    assert.ok(fs.existsSync(path.join(storagePath, "sessions", "active")));
    assert.ok(fs.existsSync(path.join(storagePath, "sessions", "completed")));
    assert.ok(fs.existsSync(path.join(storagePath, "rollups")));
    assert.ok(!fs.existsSync(path.join(storagePath, "metadata", "schema.json")));
    assert.deepStrictEqual(store.getPersistenceHealth(), {
      status: "pending",
      pendingWrites: 1,
      lastSuccessfulWriteAt: null,
      lastError: null,
    });

    await store.flush();

    assert.ok(fs.existsSync(path.join(storagePath, "metadata", "schema.json")));
    assert.deepStrictEqual(await store.listSessions(), []);
    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(storagePath).mode & 0o777, 0o700);
      assert.strictEqual(
        fs.statSync(path.join(storagePath, "metadata", "schema.json")).mode &
          0o777,
        0o600,
      );
    }
  });

  test("keeps sessions independent and completes a session whose active write is queued", async () => {
    const store = createStore();
    await store.initialize();
    await store.flush();

    const first = await store.startSession();
    const second = await store.startSession();

    assert.notStrictEqual(first.instanceId, second.instanceId);
    assert.notStrictEqual(first.id, second.id);
    assert.strictEqual(store.getPersistenceHealth().pendingWrites, 2);
    assert.ok(!fs.existsSync(activeSessionPath(first.id)));
    assert.ok(!fs.existsSync(activeSessionPath(second.id)));

    nowMs += 1000;
    const completed = await store.completeSession(first.id);

    assert.strictEqual(completed.state, "completed");
    assert.strictEqual(completed.endedAt, nowMs);
    assert.strictEqual(store.getPersistenceHealth().pendingWrites, 2);
    assert.deepStrictEqual(await store.getCompletedSession(first.id), completed);
    await assert.rejects(store.getActiveSession(first.id), { code: "ENOENT" });

    await store.flush();

    assert.ok(!fs.existsSync(activeSessionPath(first.id)));
    assert.ok(fs.existsSync(completedSessionPath(first.id)));
    assert.ok(fs.existsSync(activeSessionPath(second.id)));
    assert.strictEqual((await store.getActiveSession(second.id)).state, "active");
    assert.strictEqual(store.getPersistenceHealth().pendingWrites, 0);
    assert.strictEqual(
      fs.readdirSync(path.dirname(completedSessionPath(first.id))).some(
        (name) => name.endsWith(".tmp"),
      ),
      false,
    );
  });

  test("lists queued local and deterministic other-host disk sessions", async () => {
    const store = createStore();
    await store.initialize();
    await store.flush();
    const queued = await store.startSession("instance-local");
    const diskActive: TrackingSession = {
      schemaVersion: SCHEMA_VERSION,
      id: "session-a-external",
      instanceId: "instance-external-a",
      state: "active",
      startedAt: nowMs - 2000,
      updatedAt: nowMs - 1000,
      endedAt: null,
      intervals: [],
    };
    const diskCompleted: TrackingSession = {
      schemaVersion: SCHEMA_VERSION,
      id: "session-z-external",
      instanceId: "instance-external-z",
      state: "completed",
      startedAt: nowMs - 4000,
      updatedAt: nowMs - 3000,
      endedAt: nowMs - 3000,
      intervals: [],
    };
    fs.writeFileSync(
      activeSessionPath(diskActive.id),
      JSON.stringify(diskActive),
    );
    fs.writeFileSync(
      completedSessionPath(diskCompleted.id),
      JSON.stringify(diskCompleted),
    );

    const sessions = await store.listSessions();

    assert.deepStrictEqual(
      sessions.map((session) => session.id),
      [queued.id, diskActive.id, diskCompleted.id].sort(),
    );
    assert.deepStrictEqual(
      sessions.find((session) => session.id === queued.id),
      queued,
    );
    assert.ok(!fs.existsSync(activeSessionPath(queued.id)));
  });

  test("rejects conflicting active and completed disk records", async () => {
    const store = createStore();
    await store.initialize();
    await store.flush();
    const active: TrackingSession = {
      schemaVersion: SCHEMA_VERSION,
      id: "session-conflict",
      instanceId: "instance-external",
      state: "active",
      startedAt: nowMs,
      updatedAt: nowMs,
      endedAt: null,
      intervals: [],
    };
    const completed: TrackingSession = {
      ...active,
      state: "completed",
      updatedAt: nowMs + 1,
      endedAt: nowMs + 1,
    };
    fs.writeFileSync(activeSessionPath(active.id), JSON.stringify(active));
    fs.writeFileSync(
      completedSessionPath(completed.id),
      JSON.stringify(completed),
    );
    await store.getActiveSession(active.id);

    await assert.rejects(
      store.listSessions(),
      /conflicting duplicate session id session-conflict/,
    );
  });

  test("coalesces metadata, active-session, and rollup updates by record", async () => {
    const store = createStore();
    await store.initialize();
    await store.flush();

    const project = createProject();
    await store.upsertProjectIdentity(project);
    await store.upsertProjectIdentity({
      ...project,
      displayName: "alpha-final",
      updatedAt: nowMs + 1,
    });

    const session = await store.startSession("instance-alpha");
    await store.appendInterval(
      session.id,
      createInterval(session.id, project.id, "interval-1", 0),
    );
    await store.appendInterval(
      session.id,
      createInterval(session.id, project.id, "interval-2", 1000),
    );

    const rollup = createEmptyDailyRollup(project.id, "2026-08-07", nowMs);
    await store.writeDailyRollup(rollup);
    const finalRollup = {
      ...rollup,
      activeTimeMs: 2000,
      activeTimeByLanguageMs: { typescript: 2000 },
      updatedAt: nowMs + 2,
    };
    await store.writeDailyRollup(finalRollup);

    assert.strictEqual(store.getPersistenceHealth().pendingWrites, 3);
    assert.strictEqual(
      (await store.getProjectIdentity(project.id))?.displayName,
      "alpha-final",
    );
    assert.strictEqual((await store.getActiveSession(session.id)).intervals.length, 2);
    assert.deepStrictEqual(
      await store.readDailyRollup(project.id, "2026-08-07"),
      finalRollup,
    );

    await store.flush();

    const metadataOnDisk = readJson<SchemaMetadataV2>(
      path.join(storagePath, "metadata", "schema.json"),
    );
    const sessionOnDisk = readJson<TrackingSession>(activeSessionPath(session.id));
    assert.strictEqual(metadataOnDisk.projects[project.id].displayName, "alpha-final");
    assert.strictEqual(sessionOnDisk.intervals.length, 2);
    assert.deepStrictEqual(
      readJson(path.join(storagePath, "rollups", project.id, "2026-08-07.json")),
      finalRollup,
    );
    assert.strictEqual(store.getPersistenceHealth().status, "idle");
    assert.strictEqual(store.getPersistenceHealth().lastSuccessfulWriteAt, nowMs);
  });

  test("retains failed writes for retry and exposes persistence health", async () => {
    let failNextSessionWrite = false;
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      writeFile: async (filePath, data, options) => {
        if (failNextSessionWrite && data.includes('"state": "active"')) {
          failNextSessionWrite = false;
          throw new Error("disk temporarily unavailable");
        }
        await nodeFileSystem.writeFile(filePath, data, options);
      },
    };
    const store = createStore(fileSystem);
    await store.initialize();
    await store.flush();

    failNextSessionWrite = true;
    const session = await store.startSession("instance-alpha");
    await assert.rejects(store.flush(), /disk temporarily unavailable/);

    assert.deepStrictEqual(store.getPersistenceHealth(), {
      status: "failed",
      pendingWrites: 1,
      lastSuccessfulWriteAt: nowMs,
      lastError: "disk temporarily unavailable",
    });
    assert.ok(!fs.existsSync(activeSessionPath(session.id)));

    nowMs += 1000;
    await store.flush();

    assert.ok(fs.existsSync(activeSessionPath(session.id)));
    assert.deepStrictEqual(store.getPersistenceHealth(), {
      status: "idle",
      pendingWrites: 0,
      lastSuccessfulWriteAt: nowMs,
      lastError: null,
    });
  });

  test("compacts expired completed-session detail while retaining aggregates and live sessions", async () => {
    const store = createStore();
    const project = createProject();
    await store.upsertProjectIdentity(project);
    const oldSession = await store.startSession("instance-old");
    nowMs += 1000;
    const oldCompleted = await store.completeSession(oldSession.id);
    const rollup = createEmptyDailyRollup(project.id, "2026-08-07", nowMs);
    rollup.activeTimeMs = 1000;
    await store.writeDailyRollup(rollup);
    await store.flush();

    nowMs += 10 * 24 * 60 * 60 * 1000;
    const recentSession = await store.startSession("instance-recent");
    nowMs += 1000;
    await store.completeSession(recentSession.id);
    const activeSession = await store.startSession("instance-active");

    assert.strictEqual(
      await store.compactCompletedSessions(oldCompleted.endedAt!),
      1,
    );
    await store.flush();

    assert.ok(!fs.existsSync(completedSessionPath(oldSession.id)));
    assert.deepStrictEqual(
      (await store.listSessions()).map((session) => session.id).sort(),
      [activeSession.id, recentSession.id].sort(),
    );
    assert.deepStrictEqual(
      await store.readDailyRollup(project.id, "2026-08-07"),
      rollup,
    );
  });

  test("stores validated intervals and daily rollups for registered projects", async () => {
    const store = createStore();
    const project = createProject();
    await store.upsertProjectIdentity(project);
    const session = await store.startSession("instance-alpha");
    const interval = createInterval(
      session.id,
      project.id,
      "interval-alpha",
      0,
    );

    const updatedSession = await store.appendInterval(session.id, interval);
    assert.deepStrictEqual(updatedSession.intervals, [interval]);

    const rollup = createEmptyDailyRollup(project.id, "2026-08-07", nowMs);
    rollup.activeTimeMs = 1000;
    rollup.activeTimeByLanguageMs.typescript = 1000;
    await store.writeDailyRollup(rollup);

    assert.deepStrictEqual(
      await store.readDailyRollup(project.id, "2026-08-07"),
      rollup,
    );
    await store.flush();
    assert.ok(
      fs.existsSync(
        path.join(storagePath, "rollups", project.id, "2026-08-07.json"),
      ),
    );
    if (process.platform !== "win32") {
      assert.strictEqual(
        fs.statSync(
          path.join(storagePath, "rollups", project.id, "2026-08-07.json"),
        ).mode & 0o777,
        0o600,
      );
      assert.strictEqual(
        fs.statSync(path.join(storagePath, "rollups", project.id)).mode & 0o777,
        0o700,
      );
    }
  });

  test("reads exact rollup keys and exposes an in-process delta revision", async () => {
    const store = createStore();
    const project = createProject();
    await store.upsertProjectIdentity(project);
    assert.deepStrictEqual(await store.listProjectIdentities(), [project]);
    assert.deepStrictEqual(
      await store.readDailyRollups([project.id], ["2026-08-07"]),
      [],
    );
    assert.strictEqual(await store.getDailyRollupDateBounds(), null);
    assert.strictEqual(store.getRollupRevision(), 0);

    const rollup = createEmptyDailyRollup(project.id, "2026-08-07", nowMs);
    await store.writeDailyRollup(rollup);
    assert.strictEqual(store.getRollupRevision(), 1);
    assert.deepStrictEqual(
      await store.readDailyRollups(
        [project.id],
        ["2026-08-06", "2026-08-07"],
      ),
      [rollup],
    );
    await store.writeDailyRollup(rollup);
    assert.strictEqual(store.getRollupRevision(), 1);
    await store.writeDailyRollup({ ...rollup, activeTimeMs: 1 });
    assert.strictEqual(store.getRollupRevision(), 2);
    await store.writeDailyRollup({
      ...rollup,
      localDate: "2026-07-01",
      updatedAt: nowMs + 1,
    });
    assert.deepStrictEqual(await store.getDailyRollupDateBounds(), {
      startLocalDate: "2026-07-01",
      endLocalDate: "2026-08-07",
    });
  });

  test("replaces diagnostic buckets and derives the daily diagnostic rollup", async () => {
    const store = createStore();
    const project = createProject();
    await store.upsertProjectIdentity(project);
    const firstStart = nowMs;
    const firstReplacement = {
      bucketStartedAt: firstStart,
      bucketEndedAt: firstStart + 15 * 60 * 1000,
      observedAt: firstStart + 2000,
      diagnostics: {
        current: { error: 2, warning: 1, info: 0, hint: 0 },
        introduced: { error: 1, warning: 0, info: 0, hint: 0 },
        resolved: { error: 0, warning: 1, info: 0, hint: 0 },
        peak: { error: 3, warning: 2, info: 0, hint: 0 },
      },
    };
    await store.applyDiagnosticBucket(
      project.id,
      "2026-08-07",
      {
        ...firstReplacement,
        observedAt: firstStart + 1000,
        diagnostics: {
          current: { error: 1, warning: 2, info: 0, hint: 0 },
          introduced: { error: 0, warning: 0, info: 0, hint: 0 },
          resolved: { error: 0, warning: 0, info: 0, hint: 0 },
          peak: { error: 1, warning: 2, info: 0, hint: 0 },
        },
      },
    );
    await store.applyDiagnosticBucket(
      project.id,
      "2026-08-07",
      firstReplacement,
    );
    const secondStart = firstReplacement.bucketEndedAt;
    await store.applyDiagnosticBucket(project.id, "2026-08-07", {
      bucketStartedAt: secondStart,
      bucketEndedAt: secondStart + 15 * 60 * 1000,
      observedAt: secondStart + 1000,
      diagnostics: {
        current: { error: 1, warning: 0, info: 1, hint: 0 },
        introduced: { error: 0, warning: 0, info: 1, hint: 0 },
        resolved: { error: 1, warning: 1, info: 0, hint: 0 },
        peak: { error: 2, warning: 1, info: 1, hint: 0 },
      },
    });

    const rollup = await store.readDailyRollup(project.id, "2026-08-07");
    assert.strictEqual(Object.keys(rollup.diagnosticBuckets).length, 2);
    assert.deepStrictEqual(rollup.diagnostics, {
      current: { error: 1, warning: 0, info: 1, hint: 0 },
      introduced: { error: 1, warning: 0, info: 1, hint: 0 },
      resolved: { error: 1, warning: 2, info: 0, hint: 0 },
      peak: { error: 3, warning: 2, info: 1, hint: 0 },
    });
  });

  test("strictly rejects extra fields and invalid record relationships", async () => {
    const project = createProject();
    const interval: ActivityInterval = {
      schemaVersion: SCHEMA_VERSION,
      id: "interval-alpha",
      sessionId: "session-alpha",
      projectId: project.id,
      documentId: null,
      languageId: null,
      // A backward wall-clock shift can put the accepted interaction after
      // the interval's wall boundaries; monotonic duration remains valid.
      lastInteractionAt: nowMs + 10,
      startedAt: nowMs,
      endedAt: nowMs + 1,
      monotonicStartedAt: 10,
      monotonicEndedAt: 11,
    };
    const session: TrackingSession = {
      schemaVersion: SCHEMA_VERSION,
      id: "session-alpha",
      instanceId: "instance-alpha",
      state: "active",
      startedAt: nowMs,
      updatedAt: nowMs,
      endedAt: null,
      intervals: [interval],
    };
    const metadata: SchemaMetadataV2 = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowMs,
      updatedAt: nowMs,
      projects: { [project.id]: project },
    };
    const rollup = createEmptyDailyRollup(project.id, "2026-08-07", nowMs);

    assert.deepStrictEqual(assertProjectIdentity(project), project);
    const document = {
      schemaVersion: SCHEMA_VERSION,
      id: "document-alpha",
      canonicalUri: "file:///workspace/alpha/src/index.ts",
      projectId: project.id,
      scheme: "file",
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    assert.deepStrictEqual(assertDocumentIdentity(document), document);
    assert.deepStrictEqual(assertActivityInterval(interval), interval);
    assert.deepStrictEqual(
      assertActivityInterval({ ...interval, documentId: "src/index.ts" }),
      { ...interval, documentId: "src/index.ts" },
    );
    assert.deepStrictEqual(assertTrackingSession(session), session);
    assert.deepStrictEqual(assertSchemaMetadata(metadata), metadata);
    assert.deepStrictEqual(assertDailyRollup(rollup), rollup);

    assert.throws(
      () => assertProjectIdentity({ ...project, unexpected: true }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertDocumentIdentity({ ...document, absolutePath: "/secret" }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertActivityInterval({ ...interval, endedAt: nowMs - 1 }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertActivityInterval({ ...interval, lastInteractionAt: -1 }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertActivityInterval({ ...interval, documentId: "../secret" }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertTrackingSession({ ...session, endedAt: nowMs }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertSchemaMetadata({ ...metadata, extra: null }),
      SchemaValidationError,
    );
    assert.throws(
      () => assertDailyRollup({ ...rollup, activeTimeMs: -1 }),
      SchemaValidationError,
    );

    const store = createStore();
    await assert.rejects(
      store.getActiveSession("../outside"),
      SchemaValidationError,
    );
  });

  function createStore(
    fileSystem: FileSystemAdapter = nodeFileSystem,
  ): SessionStoreV2 {
    const store = new SessionStoreV2({
      storagePath,
      clock,
      fileSystem,
      createId: (prefix) => `${prefix}-${++nextId}`,
    });
    stores.push(store);
    return store;
  }

  function createProject(): ProjectIdentity {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: "project-alpha",
      canonicalUri: "file:///workspace/alpha",
      displayName: "alpha",
      scheme: "file",
      authority: null,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
  }

  function createInterval(
    sessionId: string,
    projectId: string,
    id: string,
    offsetMs: number,
  ): ActivityInterval {
    return {
      schemaVersion: SCHEMA_VERSION,
      id,
      sessionId,
      projectId,
      documentId: "document-alpha",
      languageId: "typescript",
      lastInteractionAt: nowMs + offsetMs,
      startedAt: nowMs + offsetMs,
      endedAt: nowMs + offsetMs + 1000,
      monotonicStartedAt: 100 + offsetMs,
      monotonicEndedAt: 1100 + offsetMs,
    };
  }

  function activeSessionPath(sessionId: string): string {
    return path.join(
      storagePath,
      "sessions",
      "active",
      `${sessionId}.json`,
    );
  }

  function completedSessionPath(sessionId: string): string {
    return path.join(
      storagePath,
      "sessions",
      "completed",
      `${sessionId}.json`,
    );
  }

  function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  }

  function asyncOnlyFileSystem(): FileSystemAdapter {
    const unexpectedSyncCall = (): never => {
      throw new Error("SessionStoreV2 used a synchronous filesystem API");
    };
    return {
      ...nodeFileSystem,
      existsSync: unexpectedSyncCall,
      mkdirSync: unexpectedSyncCall,
      readFileSync: unexpectedSyncCall,
      writeFileSync: unexpectedSyncCall,
      renameSync: unexpectedSyncCall,
      openSync: unexpectedSyncCall,
      writeSync: unexpectedSyncCall,
      closeSync: unexpectedSyncCall,
      unlinkSync: unexpectedSyncCall,
      statSync: unexpectedSyncCall,
      chmodSync: unexpectedSyncCall,
      realpathSync: unexpectedSyncCall,
    };
  }
});
