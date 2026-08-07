import { randomUUID } from "crypto";
import * as path from "path";
import {
  DailyRollup,
  ProjectIdentity,
  createEmptyDailyRollup,
} from "../domain/schemaV2";
import {
  DayData,
  DiagnosticsBySeverity,
  FlowData,
  GlobalData,
  LanguageData,
  ProjectData,
} from "../domain/types";
import { Clock, FileSystemAdapter } from "../platform/ports";
import {
  assertDailyRollup,
  assertProjectIdentity,
} from "./schemaV2Validation";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_DAILY_GOAL_SECONDS = 14_400;
const BACKUP_PREFIX = "legacy-data-";

type JsonRecord = Record<string, unknown>;

export interface LegacyProjectDescriptor {
  legacyKey: string;
  path: string;
  displayName: string;
}

export type LegacyProjectIdentityFactory = (
  project: Readonly<LegacyProjectDescriptor>,
) => ProjectIdentity | Promise<ProjectIdentity>;

/** A deliberately narrow subset of SessionStoreV2 used by migration. */
export interface LegacyMigrationTarget {
  upsertProjectIdentity(project: ProjectIdentity): Promise<unknown>;
  writeDailyRollup(rollup: DailyRollup): Promise<unknown>;
  flush(): Promise<void>;
}

export interface LegacyMigrationOptions {
  legacyDataPath: string;
  backupDirectory: string;
  quarantineDirectory?: string;
  clock: Clock;
  fileSystem: FileSystemAdapter;
  target: LegacyMigrationTarget;
  createProjectIdentity: LegacyProjectIdentityFactory;
}

export type LegacyMigrationStatus = "not-found" | "migrated" | "recovered";
export type LegacyMigrationSource = "none" | "original" | "backup";

export interface LegacyMigrationResult {
  status: LegacyMigrationStatus;
  source: LegacyMigrationSource;
  /** Exact original or backup path whose validated payload was imported. */
  importedFrom: string | null;
  backupPath: string | null;
  quarantinePath: string | null;
  recoveredFromBackupPath: string | null;
  projectsFound: number;
  projectsImported: number;
  daysFound: number;
  rollupsWritten: number;
  collisionsAggregated: number;
  /** Validated compatibility snapshot; callers receive an isolated clone. */
  normalizedData?: GlobalData;
}

export class LegacyMigrationValidationError extends Error {
  constructor(location: string, reason: string) {
    super(`Invalid legacy data at ${location}: ${reason}`);
    this.name = "LegacyMigrationValidationError";
  }
}

export class LegacyMigrationRecoveryError extends Error {
  public readonly backupPath: string;
  public readonly quarantinePath: string;

  constructor(
    reason: string,
    backupPath: string,
    quarantinePath: string,
  ) {
    super(`Legacy data is corrupt and no valid backup was found: ${reason}`);
    this.name = "LegacyMigrationRecoveryError";
    this.backupPath = backupPath;
    this.quarantinePath = quarantinePath;
  }
}

interface PreparedMigration {
  projects: ProjectIdentity[];
  rollups: DailyRollup[];
  projectsFound: number;
  daysFound: number;
  collisionsAggregated: number;
}

interface RecoveredBackup {
  path: string;
  data: GlobalData;
}

/**
 * Imports the immutable v1 snapshot into schema v2. Every attempt first makes
 * an exact textual copy of the source; corrupt input is quarantined and only a
 * separately validated backup can be used for recovery.
 */
export class LegacyMigration {
  private readonly legacyDataPath: string;
  private readonly backupDirectory: string;
  private readonly quarantineDirectory: string;
  private readonly clock: Clock;
  private readonly fileSystem: FileSystemAdapter;
  private readonly target: LegacyMigrationTarget;
  private readonly createProjectIdentity: LegacyProjectIdentityFactory;

  constructor(options: LegacyMigrationOptions) {
    this.legacyDataPath = options.legacyDataPath;
    this.backupDirectory = options.backupDirectory;
    this.quarantineDirectory =
      options.quarantineDirectory ?? path.join(this.backupDirectory, "quarantine");
    this.clock = options.clock;
    this.fileSystem = options.fileSystem;
    this.target = options.target;
    this.createProjectIdentity = options.createProjectIdentity;
  }

  public async migrate(): Promise<LegacyMigrationResult> {
    let rawSource: string;
    try {
      rawSource = await this.fileSystem.readFile(this.legacyDataPath, "utf8");
    } catch (error) {
      if (this.errorCode(error) === "ENOENT") {
        return this.emptyResult();
      }
      throw error;
    }

    await this.ensureDirectory(this.backupDirectory);
    const backupPath = path.join(
      this.backupDirectory,
      this.artifactName(BACKUP_PREFIX),
    );
    await this.atomicWriteText(backupPath, rawSource);

    let data: GlobalData;
    let importedFrom = this.legacyDataPath;
    let quarantinePath: string | null = null;
    let recoveredFromBackupPath: string | null = null;
    let source: LegacyMigrationSource = "original";
    let status: LegacyMigrationStatus = "migrated";

    try {
      data = this.parseAndNormalize(rawSource);
    } catch (error) {
      await this.ensureDirectory(this.quarantineDirectory);
      quarantinePath = path.join(
        this.quarantineDirectory,
        this.artifactName("corrupt-legacy-data-"),
      );
      await this.atomicWriteText(quarantinePath, rawSource);

      const recovered = await this.findMostRecentValidBackup();
      if (!recovered) {
        throw new LegacyMigrationRecoveryError(
          this.errorMessage(error),
          backupPath,
          quarantinePath,
        );
      }

      data = recovered.data;
      importedFrom = recovered.path;
      recoveredFromBackupPath = recovered.path;
      source = "backup";
      status = "recovered";
    }

    const prepared = await this.prepare(data);
    for (const project of prepared.projects) {
      await this.target.upsertProjectIdentity(project);
    }
    for (const rollup of prepared.rollups) {
      await this.target.writeDailyRollup(rollup);
    }
    await this.target.flush();

    return {
      status,
      source,
      importedFrom,
      backupPath,
      quarantinePath,
      recoveredFromBackupPath,
      projectsFound: prepared.projectsFound,
      projectsImported: prepared.projects.length,
      daysFound: prepared.daysFound,
      rollupsWritten: prepared.rollups.length,
      collisionsAggregated: prepared.collisionsAggregated,
      normalizedData: this.clone(data),
    };
  }

  private emptyResult(): LegacyMigrationResult {
    return {
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
    };
  }

  private async prepare(data: GlobalData): Promise<PreparedMigration> {
    const projects = new Map<string, ProjectIdentity>();
    const rollups = new Map<string, DailyRollup>();
    const entries = Object.entries(data.projects).sort(
      ([leftKey, left], [rightKey, right]) =>
        this.projectSortKey(leftKey, left).localeCompare(
          this.projectSortKey(rightKey, right),
        ),
    );
    let daysFound = 0;

    for (const [legacyKey, project] of entries) {
      const identity = assertProjectIdentity(
        await this.createProjectIdentity({
          legacyKey,
          path: project.path,
          displayName: project.name,
        }),
      );
      const existingIdentity = projects.get(identity.id);
      if (
        existingIdentity &&
        existingIdentity.canonicalUri !== identity.canonicalUri
      ) {
        throw new LegacyMigrationValidationError(
          `projects.${legacyKey}`,
          `identity factory reused ${identity.id} for different canonical URIs`,
        );
      }
      if (!existingIdentity) {
        projects.set(identity.id, this.clone(identity));
      }

      for (const [localDate, day] of Object.entries(project.days).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        daysFound += 1;
        const incoming = this.toDailyRollup(identity.id, localDate, day);
        const key = `${identity.id}:${localDate}`;
        const existing = rollups.get(key);
        rollups.set(
          key,
          existing ? this.mergeRollups(existing, incoming) : incoming,
        );
      }
    }

    return {
      projects: [...projects.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      rollups: [...rollups.values()].sort((left, right) =>
        `${left.projectId}:${left.localDate}`.localeCompare(
          `${right.projectId}:${right.localDate}`,
        ),
      ),
      projectsFound: entries.length,
      daysFound,
      collisionsAggregated: daysFound - rollups.size,
    };
  }

  private toDailyRollup(
    projectId: string,
    localDate: string,
    day: DayData,
  ): DailyRollup {
    const rollup = createEmptyDailyRollup(
      projectId,
      localDate,
      this.clock.nowMs(),
    );
    rollup.activeTimeMs = this.secondsToMilliseconds(
      day.focusSeconds,
      `${localDate}.focusSeconds`,
    );
    rollup.debugElapsedMs = this.secondsToMilliseconds(
      day.debugSeconds,
      `${localDate}.debugSeconds`,
    );
    // V1 cannot reconstruct the active/debug interval intersection.
    rollup.debugActiveTimeMs = 0;
    rollup.editEvents = day.editEvents;
    // V1 keystrokes cannot be split into inserted and removed UTF-16 units.
    rollup.insertedCharacters = 0;
    rollup.removedCharacters = 0;
    rollup.largeEditEvents = day.pasteEvents;
    rollup.insertedLineBreaksApprox = day.linesAdded;
    rollup.removedLineBreaksApprox = day.linesDeleted;
    rollup.saveEvents = day.saves;
    rollup.fileSwitchEvents = day.fileSwitchEvents ?? day.contextSwitches;
    // V1 did not distinguish cross-project from file transitions.
    rollup.projectSwitchEvents = day.projectSwitchEvents ?? 0;
    rollup.flowBlockCount = day.flowBlockCount ?? day.flow.count;
    rollup.flowActiveMs =
      day.flowActiveMs ??
      this.secondsToMilliseconds(
        day.flow.totalSeconds,
        `${localDate}.flow.totalSeconds`,
      );
    rollup.longestFlowActiveMs =
      day.longestFlowActiveMs ??
      this.secondsToMilliseconds(
        day.flow.longestSeconds,
        `${localDate}.flow.longestSeconds`,
      );
    rollup.diagnostics.current = this.clone(day.diagnosticsBySeverity);
    // Only the latest v1 snapshot is known; deltas cannot be reconstructed.
    rollup.diagnostics.peak = this.clone(day.diagnosticsBySeverity);
    rollup.activeTimeByLanguageMs = Object.fromEntries(
      Object.entries(day.languages)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([languageId, language]) => [
          languageId,
          this.secondsToMilliseconds(
            language.seconds,
            `${localDate}.languages.${languageId}.seconds`,
          ),
        ]),
    );
    // V1 file paths are not privacy-safe document IDs, and hourly samples
    // cannot be assigned to quarter-hours without manufacturing precision.
    rollup.activeTimeByDocumentMs = {};
    rollup.activeTimeByQuarterHourMs = {};
    rollup.legacyApproximate = true;
    return assertDailyRollup(rollup);
  }

  private mergeRollups(
    left: DailyRollup,
    right: DailyRollup,
  ): DailyRollup {
    const merged = this.clone(left);
    const additive: Array<keyof DailyRollup> = [
      "activeTimeMs",
      "debugElapsedMs",
      "debugActiveTimeMs",
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
    ];
    for (const field of additive) {
      const leftValue = merged[field];
      const rightValue = right[field];
      if (typeof leftValue !== "number" || typeof rightValue !== "number") {
        throw new Error(`Unexpected non-numeric rollup field ${field}`);
      }
      (merged[field] as number) = this.safeSum(
        leftValue,
        rightValue,
        `rollup.${field}`,
      );
    }
    merged.longestFlowActiveMs = Math.max(
      merged.longestFlowActiveMs,
      right.longestFlowActiveMs,
    );
    for (const severity of ["error", "warning", "info", "hint"] as const) {
      merged.diagnostics.current[severity] = Math.max(
        merged.diagnostics.current[severity],
        right.diagnostics.current[severity],
      );
      merged.diagnostics.peak[severity] = Math.max(
        merged.diagnostics.peak[severity],
        right.diagnostics.peak[severity],
      );
    }
    merged.activeTimeByLanguageMs = this.mergeNumericMaps(
      merged.activeTimeByLanguageMs,
      right.activeTimeByLanguageMs,
      "activeTimeByLanguageMs",
    );
    merged.updatedAt = Math.max(merged.updatedAt, right.updatedAt);
    merged.legacyApproximate = true;
    return assertDailyRollup(merged);
  }

  private parseAndNormalize(raw: string): GlobalData {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LegacyMigrationValidationError("root", "invalid JSON");
    }

    const root = this.requireRecord(parsed, "root");
    this.requireAllowedKeys(root, "root", ["dailyGoal", "projects"]);
    const projects = this.requireRecord(root.projects, "projects");
    const normalizedProjects = Object.fromEntries(
      Object.entries(projects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => {
          this.requireNonEmptyString(key, `projects key`);
          return [key, this.normalizeProject(value, `projects.${key}`)];
        }),
    );

    return {
      dailyGoal:
        root.dailyGoal === undefined
          ? DEFAULT_DAILY_GOAL_SECONDS
          : this.requireDurationSeconds(root.dailyGoal, "dailyGoal"),
      projects: normalizedProjects,
    };
  }

  private normalizeProject(value: unknown, location: string): ProjectData {
    const project = this.requireRecord(value, location);
    this.requireAllowedKeys(project, location, ["name", "path", "days"]);
    const name = this.requireNonEmptyString(project.name, `${location}.name`);
    const projectPath = this.requireNonEmptyString(
      project.path,
      `${location}.path`,
    );
    const days = this.requireRecord(project.days, `${location}.days`);
    const normalizedDays = Object.fromEntries(
      Object.entries(days)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, day]) => [
          date,
          this.normalizeDay(day, date, `${location}.days.${date}`),
        ]),
    );
    return { name, path: projectPath, days: normalizedDays };
  }

  private normalizeDay(
    value: unknown,
    dateKey: string,
    location: string,
  ): DayData {
    this.requireLocalDate(dateKey, `${location} key`);
    const day = this.requireRecord(value, location);
    this.requireAllowedKeys(day, location, [
      "date",
      "seconds",
      "keystrokes",
      "linesAdded",
      "linesDeleted",
      "languages",
      "hours",
      "files",
      "editEvents",
      "pasteEvents",
      "filesTouched",
      "saves",
      "focusSeconds",
      "idleSeconds",
      "debugSeconds",
      "diagnosticsBySeverity",
      "contextSwitches",
      "fileSwitchEvents",
      "projectSwitchEvents",
      "flowBlockCount",
      "flowActiveMs",
      "longestFlowActiveMs",
      "currentFlowActiveMs",
      "branches",
      "gitDirtyFiles",
      "flow",
    ]);
    const date = this.requireString(day.date, `${location}.date`);
    this.requireLocalDate(date, `${location}.date`);
    if (date !== dateKey) {
      throw new LegacyMigrationValidationError(
        `${location}.date`,
        "does not match its day-map key",
      );
    }

    const seconds = this.optionalDuration(day.seconds, `${location}.seconds`);
    const normalizedDay: DayData = {
      date,
      seconds,
      keystrokes: this.optionalCounter(
        day.keystrokes,
        `${location}.keystrokes`,
      ),
      linesAdded: this.optionalCounter(
        day.linesAdded,
        `${location}.linesAdded`,
      ),
      linesDeleted: this.optionalCounter(
        day.linesDeleted,
        `${location}.linesDeleted`,
      ),
      languages: this.normalizeLanguages(
        day.languages,
        `${location}.languages`,
      ),
      hours: this.normalizeNumericMap(
        day.hours,
        `${location}.hours`,
        "duration",
      ),
      files: this.normalizeNumericMap(
        day.files,
        `${location}.files`,
        "duration",
      ),
      editEvents: this.optionalCounter(
        day.editEvents,
        `${location}.editEvents`,
      ),
      pasteEvents: this.optionalCounter(
        day.pasteEvents,
        `${location}.pasteEvents`,
      ),
      filesTouched: this.normalizeNumericMap(
        day.filesTouched,
        `${location}.filesTouched`,
        "counter",
      ),
      saves: this.optionalCounter(day.saves, `${location}.saves`),
      focusSeconds:
        day.focusSeconds === undefined
          ? seconds
          : this.requireDurationSeconds(
              day.focusSeconds,
              `${location}.focusSeconds`,
            ),
      idleSeconds: this.optionalDuration(
        day.idleSeconds,
        `${location}.idleSeconds`,
      ),
      debugSeconds: this.optionalDuration(
        day.debugSeconds,
        `${location}.debugSeconds`,
      ),
      diagnosticsBySeverity: this.normalizeDiagnostics(
        day.diagnosticsBySeverity,
        `${location}.diagnosticsBySeverity`,
      ),
      contextSwitches: this.optionalCounter(
        day.contextSwitches,
        `${location}.contextSwitches`,
      ),
      branches: this.normalizeNumericMap(
        day.branches,
        `${location}.branches`,
        "duration",
      ),
      gitDirtyFiles: this.optionalCounter(
        day.gitDirtyFiles,
        `${location}.gitDirtyFiles`,
      ),
      flow: this.normalizeFlow(day.flow, `${location}.flow`),
    };
    this.copyOptionalCounter(
      day,
      normalizedDay,
      "fileSwitchEvents",
      location,
    );
    this.copyOptionalCounter(
      day,
      normalizedDay,
      "projectSwitchEvents",
      location,
    );
    this.copyOptionalCounter(day, normalizedDay, "flowBlockCount", location);
    this.copyOptionalCounter(day, normalizedDay, "flowActiveMs", location);
    this.copyOptionalCounter(
      day,
      normalizedDay,
      "longestFlowActiveMs",
      location,
    );
    this.copyOptionalCounter(
      day,
      normalizedDay,
      "currentFlowActiveMs",
      location,
    );
    return normalizedDay;
  }

  private copyOptionalCounter(
    source: JsonRecord,
    target: DayData,
    field:
      | "fileSwitchEvents"
      | "projectSwitchEvents"
      | "flowBlockCount"
      | "flowActiveMs"
      | "longestFlowActiveMs"
      | "currentFlowActiveMs",
    location: string,
  ): void {
    if (source[field] !== undefined) {
      target[field] = this.requireCounter(
        source[field],
        `${location}.${field}`,
      );
    }
  }

  private normalizeLanguages(
    value: unknown,
    location: string,
  ): Record<string, LanguageData> {
    if (value === undefined) {
      return {};
    }
    const languages = this.requireRecord(value, location);
    return Object.fromEntries(
      Object.entries(languages)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, candidate]) => {
          this.requireNonEmptyString(key, `${location} key`);
          const language = this.requireRecord(candidate, `${location}.${key}`);
          this.requireAllowedKeys(language, `${location}.${key}`, [
            "name",
            "seconds",
          ]);
          const name = this.requireNonEmptyString(
            language.name,
            `${location}.${key}.name`,
          );
          if (name !== key) {
            throw new LegacyMigrationValidationError(
              `${location}.${key}.name`,
              "does not match its language-map key",
            );
          }
          return [
            key,
            {
              name,
              seconds: this.requireDurationSeconds(
                language.seconds,
                `${location}.${key}.seconds`,
              ),
            },
          ];
        }),
    );
  }

  private normalizeDiagnostics(
    value: unknown,
    location: string,
  ): DiagnosticsBySeverity {
    if (value === undefined) {
      return { error: 0, warning: 0, info: 0, hint: 0 };
    }
    const diagnostics = this.requireRecord(value, location);
    this.requireAllowedKeys(diagnostics, location, [
      "error",
      "warning",
      "info",
      "hint",
    ]);
    return {
      error: this.optionalCounter(diagnostics.error, `${location}.error`),
      warning: this.optionalCounter(
        diagnostics.warning,
        `${location}.warning`,
      ),
      info: this.optionalCounter(diagnostics.info, `${location}.info`),
      hint: this.optionalCounter(diagnostics.hint, `${location}.hint`),
    };
  }

  private normalizeFlow(value: unknown, location: string): FlowData {
    if (value === undefined) {
      return {
        count: 0,
        totalSeconds: 0,
        longestSeconds: 0,
        currentSeconds: 0,
      };
    }
    const flow = this.requireRecord(value, location);
    this.requireAllowedKeys(flow, location, [
      "count",
      "totalSeconds",
      "longestSeconds",
      "currentSeconds",
    ]);
    return {
      count: this.optionalCounter(flow.count, `${location}.count`),
      totalSeconds: this.optionalDuration(
        flow.totalSeconds,
        `${location}.totalSeconds`,
      ),
      longestSeconds: this.optionalDuration(
        flow.longestSeconds,
        `${location}.longestSeconds`,
      ),
      currentSeconds: this.optionalDuration(
        flow.currentSeconds,
        `${location}.currentSeconds`,
      ),
    };
  }

  private normalizeNumericMap(
    value: unknown,
    location: string,
    kind: "duration" | "counter",
  ): Record<string, number> {
    if (value === undefined) {
      return {};
    }
    const map = this.requireRecord(value, location);
    return Object.fromEntries(
      Object.entries(map)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, amount]) => {
          this.requireNonEmptyString(key, `${location} key`);
          return [
            key,
            kind === "duration"
              ? this.requireDurationSeconds(amount, `${location}.${key}`)
              : this.requireCounter(amount, `${location}.${key}`),
          ];
        }),
    );
  }

  private optionalDuration(value: unknown, location: string): number {
    return value === undefined
      ? 0
      : this.requireDurationSeconds(value, location);
  }

  private optionalCounter(value: unknown, location: string): number {
    return value === undefined ? 0 : this.requireCounter(value, location);
  }

  private requireDurationSeconds(value: unknown, location: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new LegacyMigrationValidationError(
        location,
        "expected a non-negative finite number",
      );
    }
    if (!Number.isSafeInteger(Math.round(value * 1000))) {
      throw new LegacyMigrationValidationError(location, "duration is too large");
    }
    return value;
  }

  private requireCounter(value: unknown, location: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new LegacyMigrationValidationError(
        location,
        "expected a non-negative safe integer",
      );
    }
    return value as number;
  }

  private requireRecord(value: unknown, location: string): JsonRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new LegacyMigrationValidationError(location, "expected an object");
    }
    return value as JsonRecord;
  }

  private requireAllowedKeys(
    value: JsonRecord,
    location: string,
    allowedKeys: readonly string[],
  ): void {
    const allowed = new Set(allowedKeys);
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) {
      throw new LegacyMigrationValidationError(
        location,
        `unexpected keys [${unexpected.sort().join(", ")}]`,
      );
    }
  }

  private requireString(value: unknown, location: string): string {
    if (typeof value !== "string") {
      throw new LegacyMigrationValidationError(location, "expected a string");
    }
    return value;
  }

  private requireNonEmptyString(value: unknown, location: string): string {
    const stringValue = this.requireString(value, location);
    if (stringValue.trim().length === 0) {
      throw new LegacyMigrationValidationError(location, "must not be empty");
    }
    return stringValue;
  }

  private requireLocalDate(value: string, location: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new LegacyMigrationValidationError(
        location,
        "expected YYYY-MM-DD",
      );
    }
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new LegacyMigrationValidationError(location, "invalid calendar date");
    }
  }

  private secondsToMilliseconds(value: number, location: string): number {
    const milliseconds = Math.round(value * 1000);
    if (!Number.isSafeInteger(milliseconds)) {
      throw new LegacyMigrationValidationError(location, "duration is too large");
    }
    return milliseconds;
  }

  private mergeNumericMaps(
    left: Record<string, number>,
    right: Record<string, number>,
    location: string,
  ): Record<string, number> {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return Object.fromEntries(
      keys.map((key) => [
        key,
        this.safeSum(left[key] ?? 0, right[key] ?? 0, `${location}.${key}`),
      ]),
    );
  }

  private safeSum(left: number, right: number, location: string): number {
    const total = left + right;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new LegacyMigrationValidationError(location, "numeric total overflow");
    }
    return total;
  }

  private async findMostRecentValidBackup(): Promise<RecoveredBackup | null> {
    const names = await this.fileSystem.readdir(this.backupDirectory);
    const candidates = await Promise.all(
      names
        .filter(
          (name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(".json"),
        )
        .map(async (name) => {
          const filePath = path.join(this.backupDirectory, name);
          try {
            const stat = await this.fileSystem.stat(filePath);
            return {
              filePath,
              name,
              mtimeMs: stat.mtimeMs,
              artifactTime: this.backupArtifactTime(name),
            };
          } catch {
            return null;
          }
        }),
    );
    candidates.sort((left, right) => {
      if (!left) {
        return 1;
      }
      if (!right) {
        return -1;
      }
      return (
        right.mtimeMs - left.mtimeMs ||
        right.artifactTime - left.artifactTime ||
        right.name.localeCompare(left.name)
      );
    });

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      try {
        const raw = await this.fileSystem.readFile(candidate.filePath, "utf8");
        return {
          path: candidate.filePath,
          data: this.parseAndNormalize(raw),
        };
      } catch {
        // Continue until the newest semantically valid and readable backup.
      }
    }
    return null;
  }

  private async atomicWriteText(filePath: string, value: string): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await this.fileSystem.writeFile(temporaryPath, value, { mode: FILE_MODE });
      await this.restrictFile(temporaryPath);
      await this.fileSystem.rename(temporaryPath, filePath);
      await this.restrictFile(filePath);
    } catch (error) {
      await this.unlinkIfPresent(temporaryPath);
      throw error;
    }
  }

  private async ensureDirectory(directoryPath: string): Promise<void> {
    await this.fileSystem.mkdir(directoryPath, {
      recursive: true,
      mode: DIRECTORY_MODE,
    });
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
      if (this.errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }

  private artifactName(prefix: string): string {
    return `${prefix}${this.clock.nowMs()}-${randomUUID()}.json`;
  }

  private backupArtifactTime(name: string): number {
    const match = /^legacy-data-(\d+)-/.exec(name);
    return match ? Number(match[1]) : 0;
  }

  private projectSortKey(key: string, project: ProjectData): string {
    return `${project.path}\u0000${project.name}\u0000${key}`;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private errorCode(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | undefined)?.code;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
