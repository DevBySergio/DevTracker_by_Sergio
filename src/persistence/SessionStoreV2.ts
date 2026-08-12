import { randomUUID } from "crypto";
import * as path from "path";
import {
  ActivityInterval,
  DailyRollup,
  DiagnosticRollup,
  DiagnosticTimeBucket,
  ProjectIdentity,
  SCHEMA_VERSION,
  SchemaMetadataV2,
  TrackingSession,
  createEmptyDailyRollup,
} from "../domain/schemaV2";
import { PersistenceHealth } from "../domain/types";
import { GitTrackingStatus } from "../domain/git";
import { Clock, FileSystemAdapter } from "../platform/ports";
import { AsyncWriteQueue } from "./AsyncWriteQueue";
import {
  SchemaValidationError,
  assertActivityInterval,
  assertDailyRollup,
  assertDiagnosticTimeBucket,
  assertProjectIdentity,
  assertSchemaMetadata,
  assertTaskRunRecord,
  assertTrackingSession,
} from "./schemaV2Validation";
import { TaskRunRecord } from "../domain/tasks";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_DIAGNOSTIC_BUCKETS_PER_DAILY_ROLLUP = 96;
const RANGE_READ_CONCURRENCY = 32;

export interface SessionStoreV2Options {
  storagePath: string;
  clock: Clock;
  fileSystem: FileSystemAdapter;
  createId?: (prefix: "instance" | "session") => string;
}

export interface DailyRollupDateBounds {
  startLocalDate: string;
  endLocalDate: string;
}

export interface DailyRollupMetricDelta {
  activeTimeMs?: number;
  editEvents?: number;
  insertedCharacters?: number;
  removedCharacters?: number;
  largeEditEvents?: number;
  insertedLineBreaksApprox?: number;
  removedLineBreaksApprox?: number;
  saveEvents?: number;
  fileSwitchEvents?: number;
  projectSwitchEvents?: number;
  flowBlockCount?: number;
  flowActiveMs?: number;
  longestFlowActiveMs?: number;
  gitStatus?: GitTrackingStatus;
  gitDirtyFiles?: number;
  gitBranchChanges?: number;
  gitDetectedCommits?: number;
  activeTimeByLanguageMs?: Readonly<Record<string, number>>;
  activeTimeByDocumentMs?: Readonly<Record<string, number>>;
  activeTimeByQuarterHourMs?: Readonly<Record<string, number>>;
  activeTimeByGitBranchMs?: Readonly<Record<string, number>>;
}

/**
 * Async schema-v2 persistence with a write-through in-memory view. Mutations
 * are visible immediately while their durable writes are coalesced by record.
 */
export class SessionStoreV2 {
  private readonly storagePath: string;
  private readonly metadataDirectory: string;
  private readonly activeSessionsDirectory: string;
  private readonly completedSessionsDirectory: string;
  private readonly rollupsDirectory: string;
  private readonly metadataPath: string;
  private readonly clock: Clock;
  private readonly fileSystem: FileSystemAdapter;
  private readonly createId: (prefix: "instance" | "session") => string;
  private readonly writes: AsyncWriteQueue;
  private initialization: Promise<SchemaMetadataV2> | undefined;
  private metadata: SchemaMetadataV2 | undefined;
  private metadataOperations: Promise<void> = Promise.resolve();
  private readonly sessionOperations = new Map<string, Promise<void>>();
  private readonly rollupOperations = new Map<string, Promise<void>>();
  private readonly activeSessions = new Map<string, TrackingSession>();
  private readonly completedSessions = new Map<string, TrackingSession>();
  private readonly authoritativeSessionIds = new Set<string>();
  private readonly deletedSessionIds = new Set<string>();
  private readonly rollups = new Map<string, DailyRollup>();
  private rollupRevision = 0;

  constructor(options: SessionStoreV2Options) {
    this.storagePath = options.storagePath;
    this.metadataDirectory = path.join(this.storagePath, "metadata");
    this.activeSessionsDirectory = path.join(
      this.storagePath,
      "sessions",
      "active",
    );
    this.completedSessionsDirectory = path.join(
      this.storagePath,
      "sessions",
      "completed",
    );
    this.rollupsDirectory = path.join(this.storagePath, "rollups");
    this.metadataPath = path.join(this.metadataDirectory, "schema.json");
    this.clock = options.clock;
    this.fileSystem = options.fileSystem;
    this.createId =
      options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.writes = new AsyncWriteQueue({
      clock: this.clock,
      debounceMs: 10_000,
    });
  }

  public async initialize(): Promise<SchemaMetadataV2> {
    if (!this.initialization) {
      this.initialization = this.initializeStorage().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }

    return this.clone(await this.initialization);
  }

  public createInstanceId(): string {
    const instanceId = this.createId("instance");
    this.requireSafeStorageKey(instanceId, "instance id");
    return instanceId;
  }

  public async startSession(
    instanceId = this.createInstanceId(),
  ): Promise<TrackingSession> {
    await this.initialize();
    this.requireSafeStorageKey(instanceId, "instance id");
    const sessionId = this.createId("session");
    this.requireSafeStorageKey(sessionId, "session id");
    const now = this.clock.nowMs();
    const session = assertTrackingSession({
      schemaVersion: SCHEMA_VERSION,
      id: sessionId,
      instanceId,
      state: "active",
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      intervals: [],
    });

    this.deletedSessionIds.delete(sessionId);
    this.completedSessions.delete(sessionId);
    this.cacheActiveSession(session);
    return this.clone(session);
  }

  public async getActiveSession(sessionId: string): Promise<TrackingSession> {
    this.requireSafeStorageKey(sessionId, "session id");
    if (
      this.completedSessions.has(sessionId) ||
      this.deletedSessionIds.has(sessionId)
    ) {
      throw this.fileNotFound(this.activeSessionPath(sessionId));
    }

    const cached = this.activeSessions.get(sessionId);
    if (cached) {
      return this.clone(cached);
    }

    const session = await this.readAndValidate(
      this.activeSessionPath(sessionId),
      "TrackingSession",
      assertTrackingSession,
    );
    this.activeSessions.set(sessionId, this.clone(session));
    return this.clone(session);
  }

  public async getCompletedSession(
    sessionId: string,
  ): Promise<TrackingSession> {
    this.requireSafeStorageKey(sessionId, "session id");
    if (this.deletedSessionIds.has(sessionId)) {
      throw this.fileNotFound(this.completedSessionPath(sessionId));
    }
    const cached = this.completedSessions.get(sessionId);
    if (cached) {
      return this.clone(cached);
    }

    const session = await this.readAndValidate(
      this.completedSessionPath(sessionId),
      "TrackingSession",
      assertTrackingSession,
    );
    this.completedSessions.set(sessionId, this.clone(session));
    return this.clone(session);
  }

  public async listSessions(): Promise<TrackingSession[]> {
    await this.initialize();

    // Cached records are the authoritative view for this store because their
    // latest writes may still be queued and the corresponding disk file stale.
    const cached = this.cachedSessionSnapshot();
    const cachedIds = new Set(
      [...this.authoritativeSessionIds].filter((sessionId) =>
        cached.has(sessionId),
      ),
    );
    this.deletedSessionIds.forEach((sessionId) => cachedIds.add(sessionId));
    const disk = new Map<string, TrackingSession>();
    const [activeNames, completedNames] = await Promise.all([
      this.fileSystem.readdir(this.activeSessionsDirectory),
      this.fileSystem.readdir(this.completedSessionsDirectory),
    ]);

    await this.readSessionDirectory(
      this.activeSessionsDirectory,
      activeNames,
      "active",
      cachedIds,
      disk,
    );
    await this.readSessionDirectory(
      this.completedSessionsDirectory,
      completedNames,
      "completed",
      cachedIds,
      disk,
    );

    // Capture mutations that completed while asynchronous directory reads
    // were in flight and replace their older disk snapshots.
    for (const [sessionId, session] of this.cachedSessionSnapshot()) {
      if (this.authoritativeSessionIds.has(sessionId)) {
        disk.set(sessionId, session);
      }
    }
    return [...disk.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((session) => this.clone(session));
  }

  /**
   * Removes completed session detail at or before the cutoff. Daily aggregate
   * rollups are intentionally stored separately and remain untouched.
   */
  public async compactCompletedSessions(cutoffMs: number): Promise<number> {
    if (!Number.isSafeInteger(cutoffMs) || cutoffMs < 0) {
      throw new Error("cutoffMs must be a non-negative safe integer");
    }
    await this.initialize();
    await this.writes.flush();
    const candidates = (await this.listSessions()).filter(
      (session) =>
        session.state === "completed" &&
        session.endedAt !== null &&
        session.endedAt <= cutoffMs,
    );

    candidates.forEach((session) => {
      this.activeSessions.delete(session.id);
      this.completedSessions.delete(session.id);
      this.authoritativeSessionIds.add(session.id);
      this.deletedSessionIds.add(session.id);
      this.writes.enqueue(this.sessionWriteKey(session.id), async () => {
        await this.unlinkIfPresent(this.completedSessionPath(session.id));
        await this.unlinkIfPresent(this.activeSessionPath(session.id));
      });
    });
    return candidates.length;
  }

  public appendInterval(
    sessionId: string,
    value: ActivityInterval,
  ): Promise<TrackingSession> {
    this.requireSafeStorageKey(sessionId, "session id");
    return this.runSessionOperation(sessionId, async () => {
      const interval = this.clone(assertActivityInterval(value));
      if (interval.sessionId !== sessionId) {
        throw new SchemaValidationError(
          "ActivityInterval",
          "sessionId does not match the target session",
        );
      }

      const metadata = await this.readMetadata();
      if (!metadata.projects[interval.projectId]) {
        throw new SchemaValidationError(
          "ActivityInterval",
          `unknown projectId ${interval.projectId}`,
        );
      }

      const session = await this.getActiveSession(sessionId);
      if (session.intervals.some((existing) => existing.id === interval.id)) {
        throw new SchemaValidationError(
          "ActivityInterval",
          `duplicate interval id ${interval.id}`,
        );
      }
      session.intervals.push(interval);
      session.updatedAt = this.clock.nowMs();
      const updated = assertTrackingSession(session);
      this.cacheActiveSession(updated);
      return this.clone(updated);
    });
  }

  public completeSession(sessionId: string): Promise<TrackingSession> {
    this.requireSafeStorageKey(sessionId, "session id");
    return this.runSessionOperation(sessionId, async () => {
      const session = await this.getActiveSession(sessionId);
      const now = this.clock.nowMs();
      session.state = "completed";
      session.updatedAt = now;
      session.endedAt = now;
      const completed = assertTrackingSession(session);
      const snapshot = this.clone(completed);

      this.activeSessions.delete(sessionId);
      this.completedSessions.set(sessionId, snapshot);
      this.authoritativeSessionIds.add(sessionId);
      this.writes.enqueue(this.sessionWriteKey(sessionId), async () => {
        await this.atomicWriteJson(
          this.completedSessionPath(sessionId),
          snapshot,
        );
        await this.unlinkIfPresent(this.activeSessionPath(sessionId));
      });
      return this.clone(completed);
    });
  }

  public async readMetadata(): Promise<SchemaMetadataV2> {
    await this.initialize();
    return this.clone(this.metadata as SchemaMetadataV2);
  }

  public upsertProjectIdentity(
    value: ProjectIdentity,
  ): Promise<SchemaMetadataV2> {
    const project = this.clone(assertProjectIdentity(value));
    return this.runMetadataOperation(async () => {
      const metadata = await this.readMetadata();
      metadata.projects[project.id] = project;
      metadata.updatedAt = this.clock.nowMs();
      const updated = assertSchemaMetadata(metadata);
      this.cacheMetadata(updated);
      return this.clone(updated);
    });
  }

  public async getProjectIdentity(
    projectId: string,
  ): Promise<ProjectIdentity | undefined> {
    this.requireSafeStorageKey(projectId, "project id");
    const project = (await this.readMetadata()).projects[projectId];
    return project ? this.clone(project) : undefined;
  }

  public async listProjectIdentities(): Promise<ProjectIdentity[]> {
    const metadata = await this.readMetadata();
    return Object.values(metadata.projects)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((project) => this.clone(project));
  }

  public getRollupRevision(): number {
    return this.rollupRevision;
  }

  /** Reads only explicit project/date keys; missing rollups are omitted. */
  public async readDailyRollups(
    projectIds: readonly string[],
    localDates: readonly string[],
  ): Promise<DailyRollup[]> {
    const projects = [...new Set(projectIds)].sort();
    const dates = [...new Set(localDates)].sort();
    projects.forEach((projectId) =>
      this.requireSafeStorageKey(projectId, "project id"),
    );
    dates.forEach((localDate) => this.requireLocalDateKey(localDate));
    const keys = dates.flatMap((localDate) =>
      projects.map((projectId) => ({ projectId, localDate })),
    );
    const values: DailyRollup[] = [];
    for (let index = 0; index < keys.length; index += RANGE_READ_CONCURRENCY) {
      const batch = keys.slice(index, index + RANGE_READ_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ({ projectId, localDate }) => {
          try {
            return await this.readDailyRollup(projectId, localDate);
          } catch (error) {
            if (this.hasErrorCode(error, "ENOENT")) {
              return undefined;
            }
            throw error;
          }
        }),
      );
      results.forEach((value) => {
        if (value) {
          values.push(value);
        }
      });
    }
    return values;
  }

  /** Scans only rollup file names for an explicit complete-history request. */
  public async getDailyRollupDateBounds(): Promise<DailyRollupDateBounds | null> {
    await this.initialize();
    const dates = new Set(
      [...this.rollups.values()].map((rollup) => rollup.localDate),
    );
    const projects = await this.listProjectIdentities();
    await Promise.all(
      projects.map(async (project) => {
        let names: string[];
        try {
          names = await this.fileSystem.readdir(
            path.join(this.rollupsDirectory, project.id),
          );
        } catch (error) {
          if (this.hasErrorCode(error, "ENOENT")) {
            return;
          }
          throw error;
        }
        names.forEach((name) => {
          const match = /^(\d{4}-\d{2}-\d{2})\.json$/u.exec(name);
          if (!match) {
            return;
          }
          try {
            this.requireLocalDateKey(match[1]);
            dates.add(match[1]);
          } catch {
            // Non-record files do not define history bounds. Record reads
            // remain strict and will surface malformed data when requested.
          }
        });
      }),
    );
    const ordered = [...dates].sort();
    return ordered.length === 0
      ? null
      : {
          startLocalDate: ordered[0],
          endLocalDate: ordered[ordered.length - 1],
        };
  }

  public async writeDailyRollup(value: DailyRollup): Promise<DailyRollup> {
    const rollup = this.clone(assertDailyRollup(value));
    return this.runRollupOperation(
      rollup.projectId,
      rollup.localDate,
      () => this.writeDailyRollupRecord(rollup),
    );
  }

  public applyDailyMetricDelta(
    projectId: string,
    localDate: string,
    value: DailyRollupMetricDelta,
  ): Promise<DailyRollup> {
    this.requireSafeStorageKey(projectId, "project id");
    this.requireLocalDateKey(localDate);
    const delta = this.validateDailyMetricDelta(value);
    return this.runRollupOperation(projectId, localDate, async () => {
      let rollup: DailyRollup;
      try {
        rollup = await this.readDailyRollup(projectId, localDate);
      } catch (error) {
        if (!this.hasErrorCode(error, "ENOENT")) {
          throw error;
        }
        rollup = createEmptyDailyRollup(
          projectId,
          localDate,
          this.clock.nowMs(),
        );
      }

      const additiveFields = [
        "activeTimeMs",
        "editEvents",
        "insertedCharacters",
        "removedCharacters",
        "largeEditEvents",
        "insertedLineBreaksApprox",
        "removedLineBreaksApprox",
        "saveEvents",
        "fileSwitchEvents",
        "projectSwitchEvents",
        "flowBlockCount",
        "flowActiveMs",
        "gitBranchChanges",
        "gitDetectedCommits",
      ] as const;
      additiveFields.forEach((field) => {
        rollup[field] = this.addMetricDuration(
          rollup[field],
          delta[field] ?? 0,
          field,
          "DailyMetricDelta",
        );
      });
      rollup.longestFlowActiveMs = Math.max(
        rollup.longestFlowActiveMs,
        delta.longestFlowActiveMs ?? 0,
      );
      if (delta.gitStatus !== undefined) {
        rollup.gitStatus = delta.gitStatus;
      }
      if (delta.gitDirtyFiles !== undefined) {
        rollup.gitDirtyFiles = delta.gitDirtyFiles;
      }
      this.mergeMetricMap(
        rollup.activeTimeByLanguageMs,
        delta.activeTimeByLanguageMs,
        "activeTimeByLanguageMs",
      );
      this.mergeMetricMap(
        rollup.activeTimeByDocumentMs,
        delta.activeTimeByDocumentMs,
        "activeTimeByDocumentMs",
      );
      this.mergeMetricMap(
        rollup.activeTimeByQuarterHourMs,
        delta.activeTimeByQuarterHourMs,
        "activeTimeByQuarterHourMs",
      );
      this.mergeMetricMap(
        rollup.activeTimeByGitBranchMs,
        delta.activeTimeByGitBranchMs,
        "activeTimeByGitBranchMs",
      );
      rollup.updatedAt = this.clock.nowMs();
      return this.writeDailyRollupRecord(rollup);
    });
  }

  public applyDiagnosticBucket(
    projectId: string,
    localDate: string,
    value: DiagnosticTimeBucket,
  ): Promise<DailyRollup> {
    this.requireSafeStorageKey(projectId, "project id");
    this.requireLocalDateKey(localDate);
    const bucket = this.clone(assertDiagnosticTimeBucket(value));
    return this.runRollupOperation(projectId, localDate, async () => {
      let rollup: DailyRollup;
      try {
        rollup = await this.readDailyRollup(projectId, localDate);
      } catch (error) {
        if (!this.hasErrorCode(error, "ENOENT")) {
          throw error;
        }
        rollup = createEmptyDailyRollup(
          projectId,
          localDate,
          this.clock.nowMs(),
        );
      }

      rollup.diagnosticBuckets[String(bucket.bucketStartedAt)] = bucket;
      Object.keys(rollup.diagnosticBuckets)
        .map(Number)
        .sort((left, right) => right - left)
        .slice(MAX_DIAGNOSTIC_BUCKETS_PER_DAILY_ROLLUP)
        .forEach((expiredBucket) => {
          delete rollup.diagnosticBuckets[String(expiredBucket)];
        });
      rollup.diagnostics = this.aggregateDiagnosticBuckets(
        Object.values(rollup.diagnosticBuckets),
      );
      rollup.updatedAt = this.clock.nowMs();
      return this.writeDailyRollupRecord(rollup);
    });
  }

  public addDebugMetrics(
    projectId: string,
    localDate: string,
    debugElapsedMs: number,
    debugActiveTimeMs: number,
  ): Promise<DailyRollup> {
    this.requireSafeStorageKey(projectId, "project id");
    this.requireLocalDateKey(localDate);
    this.requireMetricDuration(debugElapsedMs, "debugElapsedMs");
    this.requireMetricDuration(debugActiveTimeMs, "debugActiveTimeMs");
    if (debugElapsedMs === 0 && debugActiveTimeMs === 0) {
      throw new SchemaValidationError(
        "DebugMetrics",
        "at least one duration must be positive",
      );
    }
    return this.runRollupOperation(projectId, localDate, async () => {
      let rollup: DailyRollup;
      try {
        rollup = await this.readDailyRollup(projectId, localDate);
      } catch (error) {
        if (!this.hasErrorCode(error, "ENOENT")) {
          throw error;
        }
        rollup = createEmptyDailyRollup(
          projectId,
          localDate,
          this.clock.nowMs(),
        );
      }
      rollup.debugElapsedMs = this.addMetricDuration(
        rollup.debugElapsedMs,
        debugElapsedMs,
        "debugElapsedMs",
      );
      rollup.debugActiveTimeMs = this.addMetricDuration(
        rollup.debugActiveTimeMs,
        debugActiveTimeMs,
        "debugActiveTimeMs",
      );
      rollup.updatedAt = this.clock.nowMs();
      return this.writeDailyRollupRecord(rollup);
    });
  }

  public addTaskRun(
    projectId: string,
    localDate: string,
    value: TaskRunRecord,
  ): Promise<DailyRollup> {
    this.requireSafeStorageKey(projectId, "project id");
    this.requireLocalDateKey(localDate);
    const taskRun = this.clone(assertTaskRunRecord(value));
    return this.runRollupOperation(projectId, localDate, async () => {
      let rollup: DailyRollup;
      try {
        rollup = await this.readDailyRollup(projectId, localDate);
      } catch (error) {
        if (!this.hasErrorCode(error, "ENOENT")) {
          throw error;
        }
        rollup = createEmptyDailyRollup(
          projectId,
          localDate,
          this.clock.nowMs(),
        );
      }
      rollup.taskRuns.push(taskRun);
      rollup.updatedAt = this.clock.nowMs();
      return this.writeDailyRollupRecord(rollup);
    });
  }

  private async writeDailyRollupRecord(
    value: DailyRollup,
  ): Promise<DailyRollup> {
    const rollup = this.clone(assertDailyRollup(value));
    const metadata = await this.readMetadata();
    if (!metadata.projects[rollup.projectId]) {
      throw new SchemaValidationError(
        "DailyRollup",
        `unknown projectId ${rollup.projectId}`,
      );
    }

    const key = this.rollupWriteKey(rollup.projectId, rollup.localDate);
    const snapshot = this.clone(rollup);
    const existing = this.rollups.get(key);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(snapshot)) {
      this.rollupRevision += 1;
    }
    this.rollups.set(key, snapshot);
    this.writes.enqueue(key, async () => {
      await this.ensureDirectory(
        path.join(this.rollupsDirectory, snapshot.projectId),
      );
      await this.atomicWriteJson(
        this.rollupPath(snapshot.projectId, snapshot.localDate),
        snapshot,
      );
    });
    return this.clone(rollup);
  }

  public async readDailyRollup(
    projectId: string,
    localDate: string,
  ): Promise<DailyRollup> {
    this.requireSafeStorageKey(projectId, "project id");
    this.requireLocalDateKey(localDate);
    const key = this.rollupWriteKey(projectId, localDate);
    const cached = this.rollups.get(key);
    if (cached) {
      return this.clone(cached);
    }

    const rollup = await this.readAndValidate(
      this.rollupPath(projectId, localDate),
      "DailyRollup",
      assertDailyRollup,
    );
    this.rollups.set(key, this.clone(rollup));
    return this.clone(rollup);
  }

  public flush(): Promise<void> {
    return this.writes.flush();
  }

  public getPersistenceHealth(): PersistenceHealth {
    return this.writes.getHealth();
  }

  private async initializeStorage(): Promise<SchemaMetadataV2> {
    await Promise.all([
      this.ensureDirectory(this.storagePath),
      this.ensureDirectory(this.metadataDirectory),
      this.ensureDirectory(this.activeSessionsDirectory),
      this.ensureDirectory(this.completedSessionsDirectory),
      this.ensureDirectory(this.rollupsDirectory),
    ]);

    try {
      const metadata = await this.readAndValidate(
        this.metadataPath,
        "SchemaMetadataV2",
        assertSchemaMetadata,
      );
      await this.restrictFile(this.metadataPath);
      this.metadata = this.clone(metadata);
      return metadata;
    } catch (error) {
      if (!this.hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }

    const now = this.clock.nowMs();
    const metadata: SchemaMetadataV2 = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      projects: {},
    };
    this.cacheMetadata(metadata);
    return metadata;
  }

  private cacheMetadata(value: SchemaMetadataV2): void {
    const metadata = this.clone(assertSchemaMetadata(value));
    this.metadata = metadata;
    this.writes.enqueue("metadata", async () => {
      await this.atomicWriteJson(this.metadataPath, metadata);
    });
  }

  private cacheActiveSession(value: TrackingSession): void {
    const session = this.clone(assertTrackingSession(value));
    this.activeSessions.set(session.id, session);
    this.authoritativeSessionIds.add(session.id);
    this.writes.enqueue(this.sessionWriteKey(session.id), async () => {
      await this.atomicWriteJson(this.activeSessionPath(session.id), session);
    });
  }

  private cachedSessionSnapshot(): Map<string, TrackingSession> {
    const sessions = new Map<string, TrackingSession>();
    for (const session of this.activeSessions.values()) {
      this.addUniqueSession(sessions, session);
    }
    for (const session of this.completedSessions.values()) {
      this.addUniqueSession(sessions, session);
    }
    return sessions;
  }

  private async readSessionDirectory(
    directoryPath: string,
    names: readonly string[],
    expectedState: TrackingSession["state"],
    cachedIds: ReadonlySet<string>,
    sessions: Map<string, TrackingSession>,
  ): Promise<void> {
    const jsonNames = names
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
    for (const name of jsonNames) {
      const sessionId = name.slice(0, -".json".length);
      this.requireSafeStorageKey(sessionId, "session file name");
      if (cachedIds.has(sessionId)) {
        continue;
      }

      let session: TrackingSession;
      try {
        session = await this.readAndValidate(
          path.join(directoryPath, name),
          "TrackingSession",
          assertTrackingSession,
        );
      } catch (error) {
        if (this.hasErrorCode(error, "ENOENT")) {
          continue;
        }
        throw error;
      }
      if (session.id !== sessionId) {
        throw new SchemaValidationError(
          "TrackingSession",
          `id ${session.id} does not match file name ${name}`,
        );
      }
      if (session.state !== expectedState) {
        throw new SchemaValidationError(
          "TrackingSession",
          `${session.id} has state ${session.state} in ${expectedState} directory`,
        );
      }
      this.addUniqueSession(sessions, session);
    }
  }

  private addUniqueSession(
    sessions: Map<string, TrackingSession>,
    value: TrackingSession,
  ): void {
    const session = this.clone(assertTrackingSession(value));
    const existing = sessions.get(session.id);
    if (existing && this.sessionFingerprint(existing) !== this.sessionFingerprint(session)) {
      throw new SchemaValidationError(
        "TrackingSession",
        `conflicting duplicate session id ${session.id}`,
      );
    }
    if (!existing) {
      sessions.set(session.id, session);
    }
  }

  private sessionFingerprint(session: TrackingSession): string {
    return JSON.stringify([
      session.schemaVersion,
      session.id,
      session.instanceId,
      session.state,
      session.startedAt,
      session.updatedAt,
      session.endedAt,
      session.intervals.map((interval) => [
        interval.schemaVersion,
        interval.id,
        interval.sessionId,
        interval.projectId,
        interval.documentId,
        interval.languageId,
        interval.lastInteractionAt,
        interval.startedAt,
        interval.endedAt,
        interval.monotonicStartedAt,
        interval.monotonicEndedAt,
      ]),
    ]);
  }

  private activeSessionPath(sessionId: string): string {
    return path.join(this.activeSessionsDirectory, `${sessionId}.json`);
  }

  private completedSessionPath(sessionId: string): string {
    return path.join(this.completedSessionsDirectory, `${sessionId}.json`);
  }

  private rollupPath(projectId: string, localDate: string): string {
    this.requireSafeStorageKey(projectId, "project id");
    this.requireLocalDateKey(localDate);
    return path.join(this.rollupsDirectory, projectId, `${localDate}.json`);
  }

  private sessionWriteKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private rollupWriteKey(projectId: string, localDate: string): string {
    return `rollup:${projectId}:${localDate}`;
  }

  private async ensureDirectory(directoryPath: string): Promise<void> {
    await this.fileSystem.mkdir(directoryPath, {
      recursive: true,
      mode: DIRECTORY_MODE,
    });
    await this.restrictDirectory(directoryPath);
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await this.fileSystem.writeFile(
        temporaryPath,
        `${JSON.stringify(value, null, 2)}\n`,
        { mode: FILE_MODE },
      );
      await this.restrictFile(temporaryPath);
      await this.fileSystem.rename(temporaryPath, filePath);
      await this.restrictFile(filePath);
    } catch (error) {
      await this.unlinkIfPresent(temporaryPath);
      throw error;
    }
  }

  private async readAndValidate<T>(
    filePath: string,
    recordName: string,
    validate: (value: unknown) => T,
  ): Promise<T> {
    let value: unknown;
    try {
      value = JSON.parse(await this.fileSystem.readFile(filePath, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new SchemaValidationError(recordName, "invalid JSON");
      }
      throw error;
    }
    return validate(value);
  }

  private async restrictDirectory(directoryPath: string): Promise<void> {
    if (process.platform !== "win32") {
      await this.fileSystem.chmod(directoryPath, DIRECTORY_MODE);
    }
  }

  private async restrictFile(filePath: string): Promise<void> {
    if (process.platform !== "win32") {
      await this.fileSystem.chmod(filePath, FILE_MODE);
    }
  }

  private async unlinkIfPresent(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch (error) {
      if (!this.hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }

  private runMetadataOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.metadataOperations.then(operation);
    this.metadataOperations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runSessionOperation<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionOperations.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.sessionOperations.set(sessionId, tail);
    void tail.then(() => {
      if (this.sessionOperations.get(sessionId) === tail) {
        this.sessionOperations.delete(sessionId);
      }
    });
    return result;
  }

  private runRollupOperation<T>(
    projectId: string,
    localDate: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = this.rollupWriteKey(projectId, localDate);
    const previous = this.rollupOperations.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.rollupOperations.set(key, tail);
    void tail.then(() => {
      if (this.rollupOperations.get(key) === tail) {
        this.rollupOperations.delete(key);
      }
    });
    return result;
  }

  private requireMetricDuration(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SchemaValidationError(
        "DebugMetrics",
        `${name} must be a non-negative safe integer`,
      );
    }
  }

  private addMetricDuration(
    left: number,
    right: number,
    name: string,
    recordName = "DebugMetrics",
  ): number {
    const value = left + right;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SchemaValidationError(
        recordName,
        `${name} must be a non-negative safe integer`,
      );
    }
    return value;
  }

  private validateDailyMetricDelta(
    value: DailyRollupMetricDelta,
  ): DailyRollupMetricDelta {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SchemaValidationError(
        "DailyMetricDelta",
        "expected an object",
      );
    }
    const allowed = new Set([
      "activeTimeMs",
      "editEvents",
      "insertedCharacters",
      "removedCharacters",
      "largeEditEvents",
      "insertedLineBreaksApprox",
      "removedLineBreaksApprox",
      "saveEvents",
      "fileSwitchEvents",
      "projectSwitchEvents",
      "flowBlockCount",
      "flowActiveMs",
      "longestFlowActiveMs",
      "gitStatus",
      "gitDirtyFiles",
      "gitBranchChanges",
      "gitDetectedCommits",
      "activeTimeByLanguageMs",
      "activeTimeByDocumentMs",
      "activeTimeByQuarterHourMs",
      "activeTimeByGitBranchMs",
    ]);
    const extra = Object.keys(value).filter((key) => !allowed.has(key));
    if (extra.length > 0) {
      throw new SchemaValidationError(
        "DailyMetricDelta",
        `unexpected keys [${extra.join(", ")}]`,
      );
    }
    Object.entries(value).forEach(([key, candidate]) => {
      if (key === "gitStatus") {
        if (
          candidate !== "disabled" &&
          candidate !== "unavailable" &&
          candidate !== "no-repository" &&
          candidate !== "available"
        ) {
          throw new SchemaValidationError(
            "DailyMetricDelta",
            "gitStatus is invalid",
          );
        }
        return;
      }
      if (key.startsWith("activeTimeBy")) {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate)
        ) {
          throw new SchemaValidationError(
            "DailyMetricDelta",
            `${key} must be an object`,
          );
        }
        Object.entries(candidate).forEach(([mapKey, amount]) => {
          if (mapKey.length === 0) {
            throw new SchemaValidationError(
              "DailyMetricDelta",
              `${key} contains an empty key`,
            );
          }
          this.requireDailyMetricValue(amount, `${key}.${mapKey}`);
        });
        return;
      }
      this.requireDailyMetricValue(candidate, key);
    });
    return this.clone(value);
  }

  private requireDailyMetricValue(value: unknown, name: string): void {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new SchemaValidationError(
        "DailyMetricDelta",
        `${name} must be a non-negative safe integer`,
      );
    }
  }

  private mergeMetricMap(
    target: Record<string, number>,
    delta: Readonly<Record<string, number>> | undefined,
    name: string,
  ): void {
    Object.entries(delta ?? {}).forEach(([key, amount]) => {
      target[key] = this.addMetricDuration(
        target[key] ?? 0,
        amount,
        `${name}.${key}`,
        "DailyMetricDelta",
      );
    });
  }

  private aggregateDiagnosticBuckets(
    values: readonly DiagnosticTimeBucket[],
  ): DiagnosticRollup {
    const severities = ["error", "warning", "info", "hint"] as const;
    const buckets = [...values].sort(
      (left, right) => left.bucketStartedAt - right.bucketStartedAt,
    );
    const empty = () => ({ error: 0, warning: 0, info: 0, hint: 0 });
    const result: DiagnosticRollup = {
      current: empty(),
      introduced: empty(),
      resolved: empty(),
      peak: empty(),
    };

    buckets.forEach((bucket) => {
      result.current = { ...bucket.diagnostics.current };
      severities.forEach((severity) => {
        const introduced =
          result.introduced[severity] +
          bucket.diagnostics.introduced[severity];
        const resolved =
          result.resolved[severity] + bucket.diagnostics.resolved[severity];
        if (!Number.isSafeInteger(introduced) || !Number.isSafeInteger(resolved)) {
          throw new SchemaValidationError(
            "DailyRollup",
            `diagnostic ${severity} count overflow`,
          );
        }
        result.introduced[severity] = introduced;
        result.resolved[severity] = resolved;
        result.peak[severity] = Math.max(
          result.peak[severity],
          bucket.diagnostics.peak[severity],
        );
      });
    });
    return result;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private fileNotFound(filePath: string): Error {
    return Object.assign(new Error(`ENOENT: no such file, open '${filePath}'`), {
      code: "ENOENT",
    });
  }

  private hasErrorCode(error: unknown, code: string): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === code
    );
  }

  private requireSafeStorageKey(value: string, name: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
      throw new SchemaValidationError(name, "contains unsafe path characters");
    }
  }

  private requireLocalDateKey(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new SchemaValidationError("local date", "expected YYYY-MM-DD");
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new SchemaValidationError("local date", "invalid calendar date");
    }
  }
}
