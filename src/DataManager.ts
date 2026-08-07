import * as path from "path";
import * as os from "os";
import {
  CurrentFlowMetrics,
  DayData,
  DiagnosticsBySeverity,
  EditorEditActivity,
  FlowData,
  GlobalData,
  PersistenceHealth,
  ProjectData,
  SessionState,
  TrackingStatus,
} from "./domain/types";
import { AsyncWriteQueue } from "./persistence/AsyncWriteQueue";
import {
  AsyncFileHandle,
  Clock,
  FileSystemAdapter,
  nodeFileSystem,
  systemClock,
} from "./platform/ports";

export type {
  DayData,
  DiagnosticsBySeverity,
  FlowData,
  GlobalData,
  LanguageData,
  ProjectData,
  SessionState,
  TrackingStatus,
} from "./domain/types";

export interface DataManagerOptions {
  dataPath?: string;
  initialData?: GlobalData;
  clock?: Clock;
  fileSystem?: FileSystemAdapter;
  platform?: NodeJS.Platform;
  debounceMs?: number;
  /** @deprecated Prefer `clock`. Retained for v1 test compatibility. */
  now?: () => Date;
}

interface PendingDelta {
  projects: { [path: string]: ProjectData };
  dailyGoal?: number;
  weeklyGoal?: number | null;
}

interface SnapshotDayData extends DayData {
  diagnosticsUpdated?: boolean;
  gitDirtyFilesUpdated?: boolean;
  currentFlowUpdated?: boolean;
}

const DEFAULT_DAILY_GOAL_SECONDS = 14400;
const LOCK_STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 50;
const FLOW_BREAK_MS = 120000;
const LEGACY_DATA_WRITE_KEY = "legacy-data";

export class DataManager {
  private readonly dataPath: string;
  private readonly lockPath: string;
  private readonly clock: Clock;
  private readonly fileSystem: FileSystemAdapter;
  private readonly platform: NodeJS.Platform;
  private readonly writeQueue: AsyncWriteQueue;
  private currentData: GlobalData;
  private sessionState: SessionState;
  private pendingDelta: PendingDelta = { projects: {} };
  private pendingSeedData: GlobalData | undefined;
  private lastFlowTick = 0;
  private writeSequence = 0;

  constructor(options: DataManagerOptions = {}) {
    const folderPath = options.dataPath
      ? path.dirname(options.dataPath)
      : path.join(os.homedir(), ".devtracker");

    this.dataPath = options.dataPath ?? path.join(folderPath, "data.json");
    this.lockPath = `${this.dataPath}.lock`;
    this.clock =
      options.clock ??
      (options.now
        ? {
            now: options.now,
            nowMs: () => options.now!().getTime(),
          }
        : systemClock);
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.platform = options.platform ?? process.platform;
    this.writeQueue = new AsyncWriteQueue({
      clock: this.clock,
      debounceMs: options.debounceMs,
    });

    if (!this.fileSystem.existsSync(folderPath)) {
      try {
        this.fileSystem.mkdirSync(folderPath, { recursive: true });
      } catch (e) {
        console.error("Error creando directorio de datos:", e);
      }
    }

    const targetExists = this.fileSystem.existsSync(this.dataPath);
    this.currentData = targetExists
      ? this.loadDataFromDisk()
      : options.initialData
        ? this.cloneGlobalData(options.initialData)
        : this.createDefaultData();
    this.pendingSeedData =
      !targetExists && options.initialData
        ? this.cloneGlobalData(options.initialData)
        : undefined;

    this.sessionState = {
      startTime: this.clock.nowMs(),
      trackingStatus: "inactive",
      lastUpdatedAt: this.clock.nowMs(),
      seconds: 0,
      keystrokes: 0,
      linesAdded: 0,
      linesDeleted: 0,
      languages: {},
      editEvents: 0,
      insertedCharacters: 0,
      removedCharacters: 0,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 0,
      removedLineBreaksApprox: 0,
      activeTimeByDocumentMs: {},
      pasteEvents: 0,
      filesTouched: {},
      saves: 0,
      focusSeconds: 0,
      idleSeconds: 0,
      debugSeconds: 0,
      diagnosticsBySeverity: this.createEmptyDiagnostics(),
      contextSwitches: 0,
      fileSwitchEvents: 0,
      projectSwitchEvents: 0,
      flowBlockCount: 0,
      flowActiveMs: 0,
      longestFlowActiveMs: 0,
      currentFlowActiveMs: 0,
      branches: {},
      gitDirtyFiles: 0,
      flow: this.createEmptyFlow(),
    };

    if (this.pendingSeedData) {
      this.enqueuePersistence();
    }
  }

  private createDefaultData(): GlobalData {
    return {
      dailyGoal: DEFAULT_DAILY_GOAL_SECONDS,
      projects: {},
    };
  }

  private loadDataFromDisk(): GlobalData {
    if (!this.fileSystem.existsSync(this.dataPath)) {
      return this.createDefaultData();
    }

    try {
      const raw = this.fileSystem.readFileSync(this.dataPath, "utf8");
      return this.parseData(raw);
    } catch (error) {
      console.error("Error leyendo data.json:", error);
      return this.createDefaultData();
    }
  }

  private async loadDataSnapshotAsync(): Promise<{
    data: GlobalData;
    exists: boolean;
  }> {
    try {
      const raw = await this.fileSystem.readFile(this.dataPath, "utf8");
      return { data: this.parseData(raw), exists: true };
    } catch (error) {
      if (this.errorCode(error) === "ENOENT") {
        return { data: this.createDefaultData(), exists: false };
      }
      throw error;
    }
  }

  private parseData(raw: string): GlobalData {
    const parsed = JSON.parse(raw) as Partial<GlobalData>;

    if (parsed.dailyGoal === undefined) {
      parsed.dailyGoal = DEFAULT_DAILY_GOAL_SECONDS;
    }
    if (
      parsed.weeklyGoal !== undefined &&
      (!Number.isSafeInteger(parsed.weeklyGoal) || parsed.weeklyGoal <= 0)
    ) {
      delete parsed.weeklyGoal;
    }
    if (!parsed.projects) {
      parsed.projects = {};
    }

    return parsed as GlobalData;
  }

  public async saveData(): Promise<void> {
    await this.flush();
  }

  public async flush(): Promise<void> {
    do {
      if (this.hasPendingDelta()) {
        this.enqueuePersistence();
      }
      await this.writeQueue.flush();
    } while (this.hasPendingDelta());
  }

  public getPersistenceHealth(): PersistenceHealth {
    return this.writeQueue.getHealth();
  }

  private enqueuePersistence(): void {
    this.writeQueue.enqueue(LEGACY_DATA_WRITE_KEY, () =>
      this.persistPendingDelta(),
    );
  }

  private hasPendingDelta(): boolean {
    return (
      this.pendingDelta.dailyGoal !== undefined ||
      this.pendingDelta.weeklyGoal !== undefined ||
      this.pendingSeedData !== undefined ||
      Object.keys(this.pendingDelta.projects).length > 0
    );
  }

  private async persistPendingDelta(): Promise<void> {
    if (!this.hasPendingDelta()) {
      return;
    }

    const delta = this.pendingDelta;
    const seedData = this.pendingSeedData;
    this.pendingDelta = { projects: {} };
    this.pendingSeedData = undefined;

    try {
      const mergedData = await this.withFileLock(async () => {
        const latest = await this.loadDataSnapshotAsync();
        const baseData =
          !latest.exists && seedData
            ? this.cloneGlobalData(seedData)
            : latest.data;
        const merged = this.mergeDelta(baseData, delta);
        await this.writeAtomically(merged);
        return merged;
      });

      // Mutations can continue while the asynchronous write is in flight.
      // Re-apply those newer deltas so the synchronous read model never moves
      // backwards when a completed disk snapshot becomes the new base.
      this.currentData = this.mergeDelta(mergedData, this.pendingDelta);
    } catch (error) {
      // The detached batch predates anything accumulated during the failed
      // write, so restore it first and preserve newer snapshot-style values.
      this.pendingDelta = this.mergePendingDeltas(delta, this.pendingDelta);
      this.pendingSeedData = this.pendingSeedData ?? seedData;
      throw error;
    }
  }

  private async writeAtomically(data: GlobalData): Promise<void> {
    const tempPath = `${this.dataPath}.${process.pid}.${this.clock.nowMs()}.${this.writeSequence++}.tmp`;

    try {
      await this.fileSystem.writeFile(tempPath, JSON.stringify(data, null, 2));
      await this.fileSystem.rename(tempPath, this.dataPath);
    } catch (error) {
      await this.unlinkIfExists(tempPath);
      throw error;
    }
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = await this.acquireFileLock();

    try {
      return await operation();
    } finally {
      await this.releaseFileLock(lock);
    }
  }

  private async acquireFileLock(): Promise<AsyncFileHandle> {
    const startedAt = Date.now();

    while (true) {
      let lock: AsyncFileHandle;
      try {
        lock = await this.fileSystem.openExclusive(this.lockPath);
      } catch (error) {
        if (this.errorCode(error) !== "EEXIST") {
          throw error;
        }

        await this.removeStaleLock();

        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for data lock: ${this.lockPath}`);
        }

        await this.delay(LOCK_RETRY_MS);
        continue;
      }

      try {
        await lock.writeFile(
          `${process.pid}\n${this.clock.now().toISOString()}`,
        );
        return lock;
      } catch (error) {
        await lock.close().catch(() => undefined);
        await this.unlinkIfExists(this.lockPath);
        throw error;
      }
    }
  }

  private async releaseFileLock(lock: AsyncFileHandle): Promise<void> {
    try {
      await lock.close();
    } catch (error) {
      console.error("Error cerrando el bloqueo de datos:", error);
    }

    try {
      await this.unlinkIfExists(this.lockPath);
    } catch (error) {
      // The atomic rename has already committed by the time this cleanup runs.
      // Reporting a failed write here would retry an additive delta and count it
      // twice, so leave the stale-lock recovery path to clean this up later.
      console.error("Error eliminando el bloqueo de datos:", error);
    }
  }

  private async removeStaleLock(): Promise<void> {
    try {
      const stat = await this.fileSystem.stat(this.lockPath);
      if (this.clock.nowMs() - stat.mtimeMs > LOCK_STALE_MS) {
        await this.fileSystem.unlink(this.lockPath);
      }
    } catch (error) {
      if (this.errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }

  private async unlinkIfExists(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch (error) {
      if (this.errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private errorCode(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | undefined)?.code;
  }

  private mergeDelta(baseData: GlobalData, delta: PendingDelta): GlobalData {
    const merged = this.cloneGlobalData(baseData);

    this.applyDelta(merged, delta);
    return merged;
  }

  private mergePendingDeltas(
    olderDelta: PendingDelta,
    newerDelta: PendingDelta,
  ): PendingDelta {
    const merged: PendingDelta = { projects: {} };
    this.applyDelta(merged, olderDelta);
    this.applyDelta(merged, newerDelta);
    const weeklyGoal =
      newerDelta.weeklyGoal !== undefined
        ? newerDelta.weeklyGoal
        : olderDelta.weeklyGoal;
    if (weeklyGoal !== undefined) {
      merged.weeklyGoal = weeklyGoal;
    }
    this.copySnapshotMarkers(merged, olderDelta);
    this.copySnapshotMarkers(merged, newerDelta);
    return merged;
  }

  private copySnapshotMarkers(
    target: PendingDelta,
    source: PendingDelta,
  ): void {
    Object.values(source.projects).forEach((sourceProject) => {
      const targetProject = this.ensureProject(
        target,
        sourceProject.path,
        sourceProject.name,
      );
      Object.values(sourceProject.days).forEach((sourceDay) => {
        const sourceSnapshot = sourceDay as SnapshotDayData;
        const targetSnapshot = this.ensureDay(
          targetProject,
          sourceDay.date,
        ) as SnapshotDayData;
        targetSnapshot.diagnosticsUpdated =
          targetSnapshot.diagnosticsUpdated ||
          sourceSnapshot.diagnosticsUpdated;
        targetSnapshot.gitDirtyFilesUpdated =
          targetSnapshot.gitDirtyFilesUpdated ||
          sourceSnapshot.gitDirtyFilesUpdated;
        targetSnapshot.currentFlowUpdated =
          targetSnapshot.currentFlowUpdated ||
          sourceSnapshot.currentFlowUpdated;
      });
    });
  }

  private applyDelta(
    merged: GlobalData | PendingDelta,
    delta: PendingDelta,
  ): void {
    if (delta.dailyGoal !== undefined) {
      merged.dailyGoal = delta.dailyGoal;
    }
    if (delta.weeklyGoal !== undefined) {
      if (delta.weeklyGoal === null) {
        delete merged.weeklyGoal;
      } else {
        merged.weeklyGoal = delta.weeklyGoal;
      }
    }

    Object.values(delta.projects).forEach((deltaProject) => {
      const project = this.ensureProject(
        merged,
        deltaProject.path,
        deltaProject.name,
      );

      Object.values(deltaProject.days).forEach((deltaDay) => {
        const day = this.ensureDay(project, deltaDay.date);
        const snapshotDay = deltaDay as SnapshotDayData;
        day.seconds += deltaDay.seconds;
        day.keystrokes += deltaDay.keystrokes;
        day.linesAdded += deltaDay.linesAdded;
        day.linesDeleted += deltaDay.linesDeleted;
        day.editEvents += deltaDay.editEvents;
        day.insertedCharacters =
          (day.insertedCharacters || 0) +
          (deltaDay.insertedCharacters || 0);
        day.removedCharacters =
          (day.removedCharacters || 0) +
          (deltaDay.removedCharacters || 0);
        day.largeEditEvents =
          (day.largeEditEvents || 0) + (deltaDay.largeEditEvents || 0);
        day.insertedLineBreaksApprox =
          (day.insertedLineBreaksApprox || 0) +
          (deltaDay.insertedLineBreaksApprox || 0);
        day.removedLineBreaksApprox =
          (day.removedLineBreaksApprox || 0) +
          (deltaDay.removedLineBreaksApprox || 0);
        Object.entries(deltaDay.activeTimeByDocumentMs || {}).forEach(
          ([documentId, durationMs]) => {
            day.activeTimeByDocumentMs![documentId] =
              (day.activeTimeByDocumentMs![documentId] || 0) + durationMs;
          },
        );
        day.pasteEvents += deltaDay.pasteEvents;
        day.saves += deltaDay.saves;
        day.focusSeconds += deltaDay.focusSeconds;
        day.idleSeconds += deltaDay.idleSeconds;
        day.debugSeconds += deltaDay.debugSeconds;
        day.contextSwitches += deltaDay.contextSwitches;
        day.fileSwitchEvents =
          (day.fileSwitchEvents || 0) + (deltaDay.fileSwitchEvents || 0);
        day.projectSwitchEvents =
          (day.projectSwitchEvents || 0) +
          (deltaDay.projectSwitchEvents || 0);
        day.flowBlockCount =
          (day.flowBlockCount || 0) + (deltaDay.flowBlockCount || 0);
        day.flowActiveMs =
          (day.flowActiveMs || 0) + (deltaDay.flowActiveMs || 0);
        day.longestFlowActiveMs = Math.max(
          day.longestFlowActiveMs || 0,
          deltaDay.longestFlowActiveMs || 0,
        );
        if (snapshotDay.currentFlowUpdated) {
          day.currentFlowActiveMs = deltaDay.currentFlowActiveMs || 0;
          day.flow.currentSeconds = deltaDay.flow.currentSeconds || 0;
        }
        if (snapshotDay.gitDirtyFilesUpdated) {
          day.gitDirtyFiles = deltaDay.gitDirtyFiles;
        }
        day.flow.count += deltaDay.flow.count;
        day.flow.totalSeconds += deltaDay.flow.totalSeconds;
        if (
          !snapshotDay.currentFlowUpdated &&
          deltaDay.flow.currentSeconds > 0
        ) {
          if (deltaDay.flow.count > 0) {
            day.flow.currentSeconds = deltaDay.flow.currentSeconds;
          } else {
            day.flow.currentSeconds += deltaDay.flow.currentSeconds;
          }
        }
        day.flow.longestSeconds = Math.max(
          day.flow.longestSeconds,
          deltaDay.flow.longestSeconds,
          day.flow.currentSeconds,
        );

        Object.values(deltaDay.languages).forEach((language) => {
          if (!day.languages[language.name]) {
            day.languages[language.name] = {
              name: language.name,
              seconds: 0,
            };
          }
          day.languages[language.name].seconds += language.seconds;
        });

        Object.entries(deltaDay.hours).forEach(([hour, seconds]) => {
          day.hours[hour] = (day.hours[hour] || 0) + seconds;
        });

        Object.entries(deltaDay.files).forEach(([filePath, seconds]) => {
          day.files[filePath] = (day.files[filePath] || 0) + seconds;
        });

        Object.entries(deltaDay.filesTouched).forEach(([filePath, touches]) => {
          day.filesTouched[filePath] =
            (day.filesTouched[filePath] || 0) + touches;
        });

        if (snapshotDay.diagnosticsUpdated) {
          day.diagnosticsBySeverity = { ...deltaDay.diagnosticsBySeverity };
        }

        Object.entries(deltaDay.branches).forEach(([branch, seconds]) => {
          day.branches[branch] = (day.branches[branch] || 0) + seconds;
        });
      });
    });
  }

  private cloneGlobalData(data: GlobalData): GlobalData {
    return JSON.parse(JSON.stringify(data)) as GlobalData;
  }

  private normalizePath(p: string): string {
    const normalized = path.normalize(p);
    return this.platform === "win32"
      ? normalized.replace(/^([A-Z]):/, (match) => match.toLowerCase())
      : normalized;
  }

  private getLocalDateKey(): string {
    const date = this.clock.now();
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  private monotonicNowMs(): number {
    return this.clock.monotonicNowMs?.() ?? this.clock.nowMs();
  }

  private createEmptyDiagnostics(): DiagnosticsBySeverity {
    return {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
    };
  }

  private createEmptyFlow(): FlowData {
    return {
      count: 0,
      totalSeconds: 0,
      longestSeconds: 0,
      currentSeconds: 0,
    };
  }

  public addTime(
    projectPath: string,
    languageId: string,
    _relativeFilePath: string,
    seconds: number,
    branch = "No branch",
    localDateKey?: string,
    trackLegacyFlow = true,
    documentId?: string,
  ): void {
    const startsNewFlow =
      trackLegacyFlow &&
      (this.sessionState.flow.currentSeconds === 0 ||
        this.monotonicNowMs() - this.lastFlowTick > FLOW_BREAK_MS);

    this.sessionState.seconds += seconds;
    this.sessionState.focusSeconds += seconds;
    this.sessionState.languages[languageId] =
      (this.sessionState.languages[languageId] || 0) + seconds;
    if (documentId) {
      this.sessionState.activeTimeByDocumentMs[documentId] =
        (this.sessionState.activeTimeByDocumentMs[documentId] || 0) +
        seconds * 1000;
    }
    this.sessionState.branches[branch] =
      (this.sessionState.branches[branch] || 0) + seconds;
    if (trackLegacyFlow) {
      this.incrementFlow(this.sessionState.flow, seconds, startsNewFlow);
    }

    this.addTimeToData(
      this.currentData,
      projectPath,
      languageId,
      seconds,
      branch,
      startsNewFlow,
      localDateKey,
      trackLegacyFlow,
      documentId,
    );
    this.addTimeToData(
      this.pendingDelta,
      projectPath,
      languageId,
      seconds,
      branch,
      startsNewFlow,
      localDateKey,
      trackLegacyFlow,
      documentId,
    );
    this.enqueuePersistence();
  }

  private addTimeToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    languageId: string,
    seconds: number,
    branch: string,
    startsNewFlow: boolean,
    localDateKey?: string,
    trackLegacyFlow = true,
    documentId?: string,
  ): void {
    const day = this.getPersistentData(data, projectPath, localDateKey);
    day.seconds += seconds;
    day.focusSeconds += seconds;

    const hour = this.clock.now().getHours().toString();
    day.hours[hour] = (day.hours[hour] || 0) + seconds;

    if (!day.languages[languageId]) {
      day.languages[languageId] = { name: languageId, seconds: 0 };
    }
    day.languages[languageId].seconds += seconds;

    if (documentId) {
      day.activeTimeByDocumentMs![documentId] =
        (day.activeTimeByDocumentMs![documentId] || 0) + seconds * 1000;
    }
    day.branches[branch] = (day.branches[branch] || 0) + seconds;
    if (trackLegacyFlow) {
      this.incrementFlow(day.flow, seconds, startsNewFlow);
    }
  }

  private incrementFlow(
    flow: FlowData,
    seconds: number,
    startsNewFlow: boolean,
  ): void {
    const now = this.monotonicNowMs();
    const sessionFlow = flow === this.sessionState.flow;

    if (startsNewFlow) {
      flow.currentSeconds = 0;
      flow.count += 1;
    }

    flow.currentSeconds += seconds;
    flow.totalSeconds += seconds;
    flow.longestSeconds = Math.max(flow.longestSeconds, flow.currentSeconds);
    if (sessionFlow) {
      this.lastFlowTick = now;
    }
  }

  public addEditActivity(
    projectPath: string,
    activity: EditorEditActivity,
  ): void {
    this.sessionState.editEvents += 1;
    this.sessionState.insertedCharacters += activity.insertedCharacters;
    this.sessionState.removedCharacters += activity.removedCharacters;
    this.sessionState.largeEditEvents += activity.largeEditEvents;
    this.sessionState.insertedLineBreaksApprox +=
      activity.insertedLineBreaksApprox;
    this.sessionState.removedLineBreaksApprox +=
      activity.removedLineBreaksApprox;

    this.addEditActivityToData(this.currentData, projectPath, activity);
    this.addEditActivityToData(this.pendingDelta, projectPath, activity);
    this.enqueuePersistence();
  }

  private addEditActivityToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    activity: EditorEditActivity,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.editEvents += 1;
    day.insertedCharacters =
      (day.insertedCharacters || 0) + activity.insertedCharacters;
    day.removedCharacters =
      (day.removedCharacters || 0) + activity.removedCharacters;
    day.largeEditEvents =
      (day.largeEditEvents || 0) + activity.largeEditEvents;
    day.insertedLineBreaksApprox =
      (day.insertedLineBreaksApprox || 0) +
      activity.insertedLineBreaksApprox;
    day.removedLineBreaksApprox =
      (day.removedLineBreaksApprox || 0) +
      activity.removedLineBreaksApprox;
  }

  public addSave(projectPath: string): void {
    this.sessionState.saves += 1;
    this.addSaveToData(this.currentData, projectPath);
    this.addSaveToData(this.pendingDelta, projectPath);
    this.enqueuePersistence();
  }

  private addSaveToData(data: GlobalData | PendingDelta, projectPath: string): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.saves += 1;
  }

  public addIdleSeconds(projectPath: string, seconds: number): void {
    this.sessionState.idleSeconds += seconds;
    this.addIdleSecondsToData(this.currentData, projectPath, seconds);
    this.addIdleSecondsToData(this.pendingDelta, projectPath, seconds);
    this.enqueuePersistence();
  }

  private addIdleSecondsToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    seconds: number,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.idleSeconds += seconds;
  }

  public addDebugSeconds(projectPath: string, seconds: number): void {
    this.sessionState.debugSeconds += seconds;
    this.addDebugSecondsToData(this.currentData, projectPath, seconds);
    this.addDebugSecondsToData(this.pendingDelta, projectPath, seconds);
    this.enqueuePersistence();
  }

  private addDebugSecondsToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    seconds: number,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.debugSeconds += seconds;
  }

  public addContextSwitch(projectPath: string): void {
    this.sessionState.contextSwitches += 1;
    this.addContextSwitchToData(this.currentData, projectPath);
    this.addContextSwitchToData(this.pendingDelta, projectPath);
    this.enqueuePersistence();
  }

  public addConfirmedContextSwitch(
    projectPath: string,
    projectSwitch: boolean,
    localDateKey: string,
  ): void {
    this.sessionState.contextSwitches += 1;
    this.sessionState.fileSwitchEvents += 1;
    if (projectSwitch) {
      this.sessionState.projectSwitchEvents += 1;
    }
    this.addConfirmedContextSwitchToData(
      this.currentData,
      projectPath,
      projectSwitch,
      localDateKey,
    );
    this.addConfirmedContextSwitchToData(
      this.pendingDelta,
      projectPath,
      projectSwitch,
      localDateKey,
    );
    this.enqueuePersistence();
  }

  private addConfirmedContextSwitchToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    projectSwitch: boolean,
    localDateKey: string,
  ): void {
    const day = this.getPersistentData(data, projectPath, localDateKey);
    day.contextSwitches += 1;
    day.fileSwitchEvents = (day.fileSwitchEvents || 0) + 1;
    if (projectSwitch) {
      day.projectSwitchEvents = (day.projectSwitchEvents || 0) + 1;
    }
  }

  public recordFlowBlock(
    projectPath: string,
    localDateKey: string,
  ): void {
    this.recordFlowBlockOnData(this.currentData, projectPath, localDateKey);
    this.recordFlowBlockOnData(
      this.pendingDelta,
      projectPath,
      localDateKey,
      true,
    );
    this.enqueuePersistence();
  }

  private recordFlowBlockOnData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    localDateKey: string,
    markSnapshot = false,
  ): void {
    const day = this.getPersistentData(data, projectPath, localDateKey);
    day.flowBlockCount = (day.flowBlockCount || 0) + 1;
    day.flow.count += 1;
    day.flow.currentSeconds = 0;
    day.currentFlowActiveMs = 0;
    if (markSnapshot) {
      (day as SnapshotDayData).currentFlowUpdated = true;
    }
  }

  public addFlowActiveTime(
    projectPath: string,
    durationMs: number,
    localDateKey: string,
  ): void {
    this.addFlowActiveTimeToData(
      this.currentData,
      projectPath,
      durationMs,
      localDateKey,
    );
    this.addFlowActiveTimeToData(
      this.pendingDelta,
      projectPath,
      durationMs,
      localDateKey,
    );
    this.enqueuePersistence();
  }

  private addFlowActiveTimeToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    durationMs: number,
    localDateKey: string,
  ): void {
    const day = this.getPersistentData(data, projectPath, localDateKey);
    day.flowActiveMs = (day.flowActiveMs || 0) + durationMs;
    day.currentFlowActiveMs = (day.currentFlowActiveMs || 0) + durationMs;
    day.longestFlowActiveMs = Math.max(
      day.longestFlowActiveMs || 0,
      day.currentFlowActiveMs,
    );
    const durationSeconds = durationMs / 1000;
    day.flow.totalSeconds += durationSeconds;
    day.flow.currentSeconds += durationSeconds;
    day.flow.longestSeconds = Math.max(
      day.flow.longestSeconds,
      day.flow.currentSeconds,
    );
  }

  public setCurrentFlowForDay(
    projectPath: string,
    currentFlowActiveMs: number,
    localDateKey: string,
  ): void {
    this.setCurrentFlowOnData(
      this.currentData,
      projectPath,
      currentFlowActiveMs,
      localDateKey,
    );
    this.setCurrentFlowOnData(
      this.pendingDelta,
      projectPath,
      currentFlowActiveMs,
      localDateKey,
      true,
    );
    this.enqueuePersistence();
  }

  private setCurrentFlowOnData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    currentFlowActiveMs: number,
    localDateKey: string,
    markSnapshot = false,
  ): void {
    const day = this.getPersistentData(data, projectPath, localDateKey);
    day.currentFlowActiveMs = currentFlowActiveMs;
    day.longestFlowActiveMs = Math.max(
      day.longestFlowActiveMs || 0,
      currentFlowActiveMs,
    );
    day.flow.currentSeconds = currentFlowActiveMs / 1000;
    day.flow.longestSeconds = Math.max(
      day.flow.longestSeconds,
      day.flow.currentSeconds,
    );
    if (markSnapshot) {
      (day as SnapshotDayData).currentFlowUpdated = true;
    }
  }

  public setCurrentFlowMetrics(metrics: CurrentFlowMetrics): void {
    this.sessionState.flowBlockCount = metrics.flowBlockCount;
    this.sessionState.flowActiveMs = metrics.flowActiveMs;
    this.sessionState.longestFlowActiveMs = metrics.longestFlowActiveMs;
    this.sessionState.currentFlowActiveMs = metrics.currentFlowActiveMs;
    this.sessionState.flow = {
      count: metrics.flowBlockCount,
      totalSeconds: metrics.flowActiveMs / 1000,
      longestSeconds: metrics.longestFlowActiveMs / 1000,
      currentSeconds: metrics.currentFlowActiveMs / 1000,
    };
  }

  private addContextSwitchToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.contextSwitches += 1;
  }

  public setDiagnostics(
    projectPath: string,
    diagnostics: DiagnosticsBySeverity,
  ): void {
    this.sessionState.diagnosticsBySeverity = { ...diagnostics };
    this.setDiagnosticsOnData(this.currentData, projectPath, diagnostics);
    this.setDiagnosticsOnData(this.pendingDelta, projectPath, diagnostics, true);
    this.enqueuePersistence();
  }

  private setDiagnosticsOnData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    diagnostics: DiagnosticsBySeverity,
    markSnapshot = false,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.diagnosticsBySeverity = { ...diagnostics };
    if (markSnapshot) {
      (day as SnapshotDayData).diagnosticsUpdated = true;
    }
  }

  public setGitDirtyFiles(projectPath: string, count: number): void {
    this.sessionState.gitDirtyFiles = count;
    this.setGitDirtyFilesOnData(this.currentData, projectPath, count);
    this.setGitDirtyFilesOnData(this.pendingDelta, projectPath, count, true);
    this.enqueuePersistence();
  }

  public setTrackingStatus(
    status: TrackingStatus,
    lastUpdatedAt: number,
  ): void {
    this.sessionState.trackingStatus = status;
    this.sessionState.lastUpdatedAt = lastUpdatedAt;
  }

  private setGitDirtyFilesOnData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    count: number,
    markSnapshot = false,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.gitDirtyFiles = count;
    if (markSnapshot) {
      (day as SnapshotDayData).gitDirtyFilesUpdated = true;
    }
  }

  public setDailyGoal(hours: number): void {
    const seconds = Math.floor(hours * 3600);
    this.currentData.dailyGoal = seconds;
    this.pendingDelta.dailyGoal = seconds;
    this.enqueuePersistence();
  }

  public getDailyGoal(): number {
    return this.currentData.dailyGoal || DEFAULT_DAILY_GOAL_SECONDS;
  }

  public setWeeklyGoal(hours: number | null): void {
    if (hours === null) {
      delete this.currentData.weeklyGoal;
      this.pendingDelta.weeklyGoal = null;
    } else {
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error("Weekly goal hours must be greater than zero");
      }
      const seconds = Math.floor(hours * 3600);
      this.currentData.weeklyGoal = seconds;
      this.pendingDelta.weeklyGoal = seconds;
    }
    this.enqueuePersistence();
  }

  public getWeeklyGoal(): number | null {
    return this.currentData.weeklyGoal ?? null;
  }

  public getTodayTotalSeconds(): number {
    const today = this.getLocalDateKey();
    let total = 0;

    Object.values(this.currentData.projects).forEach((project) => {
      if (project.days[today]) {
        total += project.days[today].seconds;
      }
    });

    return total;
  }

  public getSessionState(): SessionState {
    return this.sessionState;
  }

  public getAllProjects(): ProjectData[] {
    const projects = Object.values(this.currentData.projects);
    projects.forEach((project) => this.ensureProjectDays(project));
    return projects;
  }

  public getProjectData(projectPath: string): ProjectData {
    const project = this.ensureProject(this.currentData, projectPath);
    this.ensureProjectDays(project);
    return project;
  }

  private ensureProjectDays(project: ProjectData): void {
    Object.keys(project.days).forEach((date) => this.ensureDay(project, date));
  }

  private getTodayPersistentData(
    data: GlobalData | PendingDelta,
    projectPath: string,
  ): DayData {
    return this.getPersistentData(data, projectPath);
  }

  private getPersistentData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    localDateKey = this.getLocalDateKey(),
  ): DayData {
    const project = this.ensureProject(data, projectPath);
    return this.ensureDay(project, localDateKey);
  }

  private ensureProject(
    data: GlobalData | PendingDelta,
    projectPath: string,
    projectName = path.basename(projectPath),
  ): ProjectData {
    const key = this.normalizePath(projectPath);

    if (!data.projects[key]) {
      data.projects[key] = {
        name: projectName,
        path: projectPath,
        days: {},
      };
    }

    return data.projects[key];
  }

  private ensureDay(project: ProjectData, date: string): DayData {
    if (!project.days[date]) {
      project.days[date] = {
        date,
        seconds: 0,
        keystrokes: 0,
        linesAdded: 0,
        linesDeleted: 0,
        languages: {},
        hours: {},
        files: {},
        editEvents: 0,
        insertedCharacters: 0,
        removedCharacters: 0,
        largeEditEvents: 0,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 0,
        activeTimeByDocumentMs: {},
        pasteEvents: 0,
        filesTouched: {},
        saves: 0,
        focusSeconds: 0,
        idleSeconds: 0,
        debugSeconds: 0,
        diagnosticsBySeverity: this.createEmptyDiagnostics(),
        contextSwitches: 0,
        fileSwitchEvents: 0,
        projectSwitchEvents: 0,
        flowBlockCount: 0,
        flowActiveMs: 0,
        longestFlowActiveMs: 0,
        currentFlowActiveMs: 0,
        branches: {},
        gitDirtyFiles: 0,
        flow: this.createEmptyFlow(),
      };
    }

    const day = project.days[date];
    day.keystrokes = day.keystrokes || 0;
    day.linesAdded = day.linesAdded || 0;
    day.linesDeleted = day.linesDeleted || 0;
    day.languages = day.languages || {};
    day.hours = day.hours || {};
    day.files = day.files || {};
    day.editEvents = day.editEvents || 0;
    // V1 `keystrokes` cannot be split without inventing precision. The old
    // large-edit and line counters can be retained as explicit approximations.
    day.insertedCharacters = day.insertedCharacters ?? 0;
    day.removedCharacters = day.removedCharacters ?? 0;
    day.largeEditEvents = day.largeEditEvents ?? day.pasteEvents ?? 0;
    day.insertedLineBreaksApprox =
      day.insertedLineBreaksApprox ?? day.linesAdded ?? 0;
    day.removedLineBreaksApprox =
      day.removedLineBreaksApprox ?? day.linesDeleted ?? 0;
    day.activeTimeByDocumentMs = day.activeTimeByDocumentMs || {};
    day.pasteEvents = day.pasteEvents || 0;
    day.filesTouched = day.filesTouched || {};
    day.saves = day.saves || 0;
    day.focusSeconds = day.focusSeconds || day.seconds || 0;
    day.idleSeconds = day.idleSeconds || 0;
    day.debugSeconds = day.debugSeconds || 0;
    day.diagnosticsBySeverity = {
      ...this.createEmptyDiagnostics(),
      ...(day.diagnosticsBySeverity || {}),
    };
    day.contextSwitches = day.contextSwitches || 0;
    day.fileSwitchEvents = day.fileSwitchEvents || 0;
    day.projectSwitchEvents = day.projectSwitchEvents || 0;
    day.flowBlockCount = day.flowBlockCount || 0;
    day.flowActiveMs = day.flowActiveMs || 0;
    day.longestFlowActiveMs = day.longestFlowActiveMs || 0;
    day.currentFlowActiveMs = day.currentFlowActiveMs || 0;
    day.branches = day.branches || {};
    day.gitDirtyFiles = day.gitDirtyFiles || 0;
    day.flow = {
      ...this.createEmptyFlow(),
      ...(day.flow || {}),
    };

    return day;
  }

  public generateCSV(): string {
    const rows = [
      [
        "Project",
        "Date",
        "Seconds",
        "FocusSeconds",
        "IdleSeconds",
        "DebugSeconds",
        "InsertedCharacters",
        "RemovedCharacters",
        "EditEvents",
        "LargeEditEvents",
        "InsertedLineBreaksApprox",
        "RemovedLineBreaksApprox",
        "ActiveFileTimeMs",
        "UniqueActiveFiles",
        "Saves",
        "ContextSwitches",
        "GitDirtyFiles",
        "DiagnosticsError",
        "DiagnosticsWarning",
        "DiagnosticsInfo",
        "DiagnosticsHint",
        "FlowBlocks",
        "LongestFlowSeconds",
      ],
    ];

    Object.values(this.currentData.projects).forEach((project) => {
      Object.values(project.days).forEach((day) => {
        const safeDay = this.ensureDay(project, day.date);
        rows.push([
          project.name,
          safeDay.date,
          safeDay.seconds.toString(),
          safeDay.focusSeconds.toString(),
          safeDay.idleSeconds.toString(),
          safeDay.debugSeconds.toString(),
          (safeDay.insertedCharacters || 0).toString(),
          (safeDay.removedCharacters || 0).toString(),
          safeDay.editEvents.toString(),
          (safeDay.largeEditEvents || 0).toString(),
          (safeDay.insertedLineBreaksApprox || 0).toString(),
          (safeDay.removedLineBreaksApprox || 0).toString(),
          Object.values(safeDay.activeTimeByDocumentMs || {})
            .reduce((total, durationMs) => total + durationMs, 0)
            .toString(),
          Object.keys(safeDay.activeTimeByDocumentMs || {}).length.toString(),
          safeDay.saves.toString(),
          safeDay.contextSwitches.toString(),
          safeDay.gitDirtyFiles.toString(),
          safeDay.diagnosticsBySeverity.error.toString(),
          safeDay.diagnosticsBySeverity.warning.toString(),
          safeDay.diagnosticsBySeverity.info.toString(),
          safeDay.diagnosticsBySeverity.hint.toString(),
          safeDay.flow.count.toString(),
          safeDay.flow.longestSeconds.toString(),
        ]);
      });
    });

    return `${rows.map((row) => row.map(this.escapeCSVCell).join(",")).join("\n")}\n`;
  }

  private escapeCSVCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
