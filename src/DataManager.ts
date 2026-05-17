import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface LanguageData {
  name: string;
  seconds: number;
}

export interface DayData {
  date: string;
  seconds: number;
  keystrokes: number;
  linesAdded: number;
  linesDeleted: number;
  languages: { [key: string]: LanguageData };
  hours: { [hour: string]: number };
  files: { [filePath: string]: number };
  editEvents: number;
  pasteEvents: number;
  filesTouched: { [filePath: string]: number };
  saves: number;
  focusSeconds: number;
  idleSeconds: number;
  debugSeconds: number;
  diagnosticsBySeverity: DiagnosticsBySeverity;
  contextSwitches: number;
  branches: { [branch: string]: number };
  gitDirtyFiles: number;
  flow: FlowData;
}

export interface ProjectData {
  name: string;
  path: string;
  days: { [date: string]: DayData };
}

export interface GlobalData {
  projects: { [path: string]: ProjectData };
  dailyGoal: number;
}

export interface SessionState {
  startTime: number;
  seconds: number;
  keystrokes: number;
  linesAdded: number;
  linesDeleted: number;
  languages: { [key: string]: number };
  editEvents: number;
  pasteEvents: number;
  filesTouched: { [filePath: string]: number };
  saves: number;
  focusSeconds: number;
  idleSeconds: number;
  debugSeconds: number;
  diagnosticsBySeverity: DiagnosticsBySeverity;
  contextSwitches: number;
  branches: { [branch: string]: number };
  gitDirtyFiles: number;
  flow: FlowData;
}

export interface DiagnosticsBySeverity {
  error: number;
  warning: number;
  info: number;
  hint: number;
}

export interface FlowData {
  count: number;
  totalSeconds: number;
  longestSeconds: number;
  currentSeconds: number;
}

export interface DataManagerOptions {
  dataPath?: string;
  now?: () => Date;
}

interface PendingDelta {
  projects: { [path: string]: ProjectData };
  dailyGoal?: number;
}

interface SnapshotDayData extends DayData {
  diagnosticsUpdated?: boolean;
  gitDirtyFilesUpdated?: boolean;
}

const DEFAULT_DAILY_GOAL_SECONDS = 14400;
const LOCK_STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 5000;
const FLOW_BREAK_MS = 120000;

export class DataManager {
  private readonly dataPath: string;
  private readonly lockPath: string;
  private readonly now: () => Date;
  private currentData: GlobalData;
  private sessionState: SessionState;
  private pendingDelta: PendingDelta = { projects: {} };
  private lastFlowTick = 0;

  constructor(options: DataManagerOptions = {}) {
    const folderPath = options.dataPath
      ? path.dirname(options.dataPath)
      : path.join(os.homedir(), ".devtracker");

    this.dataPath = options.dataPath ?? path.join(folderPath, "data.json");
    this.lockPath = `${this.dataPath}.lock`;
    this.now = options.now ?? (() => new Date());

    if (!fs.existsSync(folderPath)) {
      try {
        fs.mkdirSync(folderPath, { recursive: true });
      } catch (e) {
        console.error("Error creando directorio de datos:", e);
      }
    }

    this.currentData = this.loadDataFromDisk();

    this.sessionState = {
      startTime: Date.now(),
      seconds: 0,
      keystrokes: 0,
      linesAdded: 0,
      linesDeleted: 0,
      languages: {},
      editEvents: 0,
      pasteEvents: 0,
      filesTouched: {},
      saves: 0,
      focusSeconds: 0,
      idleSeconds: 0,
      debugSeconds: 0,
      diagnosticsBySeverity: this.createEmptyDiagnostics(),
      contextSwitches: 0,
      branches: {},
      gitDirtyFiles: 0,
      flow: this.createEmptyFlow(),
    };
  }

  private loadDataFromDisk(): GlobalData {
    const defaultData: GlobalData = {
      dailyGoal: DEFAULT_DAILY_GOAL_SECONDS,
      projects: {},
    };

    if (!fs.existsSync(this.dataPath)) {
      return defaultData;
    }

    try {
      const raw = fs.readFileSync(this.dataPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<GlobalData>;

      if (parsed.dailyGoal === undefined) {
        parsed.dailyGoal = DEFAULT_DAILY_GOAL_SECONDS;
      }
      if (!parsed.projects) {
        parsed.projects = {};
      }

      return parsed as GlobalData;
    } catch (error) {
      console.error("Error leyendo data.json:", error);
      return defaultData;
    }
  }

  public saveData(): void {
    try {
      this.withFileLock(() => {
        const latestData = this.loadDataFromDisk();
        const mergedData = this.mergeDelta(latestData, this.pendingDelta);
        const tempPath = `${this.dataPath}.${process.pid}.${Date.now()}.tmp`;

        fs.writeFileSync(tempPath, JSON.stringify(mergedData, null, 2));
        fs.renameSync(tempPath, this.dataPath);

        this.currentData = mergedData;
        this.pendingDelta = { projects: {} };
      });
    } catch (e) {
      console.error("Error guardando datos:", e);
    }
  }

  private withFileLock<T>(operation: () => T): T {
    const startedAt = Date.now();
    let fd: number | undefined;

    while (fd === undefined) {
      try {
        fd = fs.openSync(this.lockPath, "wx");
        fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}`);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "EEXIST") {
          throw error;
        }

        this.removeStaleLock();

        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for data lock: ${this.lockPath}`);
        }

        this.sleep(50);
      }
    }

    try {
      return operation();
    } finally {
      fs.closeSync(fd);
      try {
        fs.unlinkSync(this.lockPath);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  private removeStaleLock(): void {
    try {
      const stat = fs.statSync(this.lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(this.lockPath);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private sleep(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    const view = new Int32Array(buffer);
    Atomics.wait(view, 0, 0, ms);
  }

  private mergeDelta(baseData: GlobalData, delta: PendingDelta): GlobalData {
    const merged = this.cloneGlobalData(baseData);

    if (delta.dailyGoal !== undefined) {
      merged.dailyGoal = delta.dailyGoal;
    }

    Object.values(delta.projects).forEach((deltaProject) => {
      const project = this.ensureProject(
        merged,
        deltaProject.path,
        deltaProject.name,
      );

      Object.values(deltaProject.days).forEach((deltaDay) => {
        const day = this.ensureDay(project, deltaDay.date);
        day.seconds += deltaDay.seconds;
        day.keystrokes += deltaDay.keystrokes;
        day.linesAdded += deltaDay.linesAdded;
        day.linesDeleted += deltaDay.linesDeleted;
        day.editEvents += deltaDay.editEvents;
        day.pasteEvents += deltaDay.pasteEvents;
        day.saves += deltaDay.saves;
        day.focusSeconds += deltaDay.focusSeconds;
        day.idleSeconds += deltaDay.idleSeconds;
        day.debugSeconds += deltaDay.debugSeconds;
        day.contextSwitches += deltaDay.contextSwitches;
        const snapshotDay = deltaDay as SnapshotDayData;
        if (snapshotDay.gitDirtyFilesUpdated) {
          day.gitDirtyFiles = deltaDay.gitDirtyFiles;
        }
        day.flow.count += deltaDay.flow.count;
        day.flow.totalSeconds += deltaDay.flow.totalSeconds;
        if (deltaDay.flow.currentSeconds > 0) {
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

    return merged;
  }

  private cloneGlobalData(data: GlobalData): GlobalData {
    return JSON.parse(JSON.stringify(data)) as GlobalData;
  }

  private normalizePath(p: string): string {
    return path.normalize(p).toLowerCase();
  }

  private getLocalDateKey(): string {
    const date = this.now();
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");

    return `${year}-${month}-${day}`;
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
    relativeFilePath: string,
    seconds: number,
    branch = "No branch",
  ): void {
    const startsNewFlow =
      this.sessionState.flow.currentSeconds === 0 ||
      this.now().getTime() - this.lastFlowTick > FLOW_BREAK_MS;

    this.sessionState.seconds += seconds;
    this.sessionState.focusSeconds += seconds;
    this.sessionState.languages[languageId] =
      (this.sessionState.languages[languageId] || 0) + seconds;
    this.sessionState.filesTouched[relativeFilePath] =
      (this.sessionState.filesTouched[relativeFilePath] || 0) + 1;
    this.sessionState.branches[branch] =
      (this.sessionState.branches[branch] || 0) + seconds;
    this.incrementFlow(this.sessionState.flow, seconds, startsNewFlow);

    this.addTimeToData(
      this.currentData,
      projectPath,
      languageId,
      relativeFilePath,
      seconds,
      branch,
      startsNewFlow,
    );
    this.addTimeToData(
      this.pendingDelta,
      projectPath,
      languageId,
      relativeFilePath,
      seconds,
      branch,
      startsNewFlow,
    );
  }

  private addTimeToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    languageId: string,
    relativeFilePath: string,
    seconds: number,
    branch: string,
    startsNewFlow: boolean,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.seconds += seconds;
    day.focusSeconds += seconds;

    const hour = this.now().getHours().toString();
    day.hours[hour] = (day.hours[hour] || 0) + seconds;

    if (!day.languages[languageId]) {
      day.languages[languageId] = { name: languageId, seconds: 0 };
    }
    day.languages[languageId].seconds += seconds;

    day.files[relativeFilePath] = (day.files[relativeFilePath] || 0) + seconds;
    day.filesTouched[relativeFilePath] =
      (day.filesTouched[relativeFilePath] || 0) + 1;
    day.branches[branch] = (day.branches[branch] || 0) + seconds;
    this.incrementFlow(day.flow, seconds, startsNewFlow);
  }

  private incrementFlow(
    flow: FlowData,
    seconds: number,
    startsNewFlow: boolean,
  ): void {
    const now = this.now().getTime();
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
    count: number,
    relativeFilePath: string,
    isPaste: boolean,
  ): void {
    this.sessionState.keystrokes += count;
    this.sessionState.editEvents += 1;
    this.sessionState.filesTouched[relativeFilePath] =
      (this.sessionState.filesTouched[relativeFilePath] || 0) + 1;
    if (isPaste) {
      this.sessionState.pasteEvents += 1;
    }

    this.addEditActivityToData(
      this.currentData,
      projectPath,
      count,
      relativeFilePath,
      isPaste,
    );
    this.addEditActivityToData(
      this.pendingDelta,
      projectPath,
      count,
      relativeFilePath,
      isPaste,
    );
  }

  public addKeystrokes(projectPath: string, count: number): void {
    this.addEditActivity(projectPath, count, "unknown", false);
  }

  private addEditActivityToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    count: number,
    relativeFilePath: string,
    isPaste: boolean,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.keystrokes += count;
    day.editEvents += 1;
    day.filesTouched[relativeFilePath] =
      (day.filesTouched[relativeFilePath] || 0) + 1;
    if (isPaste) {
      day.pasteEvents += 1;
    }
  }

  public addLines(projectPath: string, added: number, deleted: number): void {
    if (added === 0 && deleted === 0) {
      return;
    }

    this.sessionState.linesAdded += added;
    this.sessionState.linesDeleted += deleted;

    this.addLinesToData(this.currentData, projectPath, added, deleted);
    this.addLinesToData(this.pendingDelta, projectPath, added, deleted);
  }

  private addLinesToData(
    data: GlobalData | PendingDelta,
    projectPath: string,
    added: number,
    deleted: number,
  ): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.linesAdded += added;
    day.linesDeleted += deleted;
  }

  public addSave(projectPath: string): void {
    this.sessionState.saves += 1;
    this.addSaveToData(this.currentData, projectPath);
    this.addSaveToData(this.pendingDelta, projectPath);
  }

  private addSaveToData(data: GlobalData | PendingDelta, projectPath: string): void {
    const day = this.getTodayPersistentData(data, projectPath);
    day.saves += 1;
  }

  public addIdleSeconds(projectPath: string, seconds: number): void {
    this.sessionState.idleSeconds += seconds;
    this.addIdleSecondsToData(this.currentData, projectPath, seconds);
    this.addIdleSecondsToData(this.pendingDelta, projectPath, seconds);
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
    this.saveData();
  }

  public getDailyGoal(): number {
    return this.currentData.dailyGoal || DEFAULT_DAILY_GOAL_SECONDS;
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
    const project = this.ensureProject(data, projectPath);
    return this.ensureDay(project, this.getLocalDateKey());
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
        pasteEvents: 0,
        filesTouched: {},
        saves: 0,
        focusSeconds: 0,
        idleSeconds: 0,
        debugSeconds: 0,
        diagnosticsBySeverity: this.createEmptyDiagnostics(),
        contextSwitches: 0,
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
        "LinesAdded",
        "LinesDeleted",
        "EditVolume",
        "EditEvents",
        "PasteEvents",
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
          safeDay.linesAdded.toString(),
          safeDay.linesDeleted.toString(),
          (safeDay.keystrokes || 0).toString(),
          safeDay.editEvents.toString(),
          safeDay.pasteEvents.toString(),
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
