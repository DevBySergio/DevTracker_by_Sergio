import { randomUUID } from "crypto";
import { promises as nodeFs, Stats } from "fs";
import * as path from "path";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RESET_BACKUP_DIRECTORY = "reset-backups";

export interface DataManagementFileSystem {
  mkdir(
    targetPath: string,
    options: { recursive: boolean; mode: number },
  ): Promise<unknown>;
  readdir(targetPath: string): Promise<string[]>;
  lstat(targetPath: string): Promise<Stats>;
  readFile(targetPath: string): Promise<Buffer>;
  writeFile(
    targetPath: string,
    data: Buffer,
    options: { flag: "wx"; mode: number },
  ): Promise<void>;
  readlink(targetPath: string): Promise<string>;
  symlink(target: string, targetPath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(
    targetPath: string,
    options: { recursive: boolean; force: boolean },
  ): Promise<void>;
  chmod(targetPath: string, mode: number): Promise<void>;
}

export const nodeDataManagementFileSystem: DataManagementFileSystem = {
  mkdir: (targetPath, options) => nodeFs.mkdir(targetPath, options),
  readdir: (targetPath) => nodeFs.readdir(targetPath),
  lstat: (targetPath) => nodeFs.lstat(targetPath),
  readFile: (targetPath) => nodeFs.readFile(targetPath),
  writeFile: (targetPath, data, options) =>
    nodeFs.writeFile(targetPath, data, options),
  readlink: (targetPath) => nodeFs.readlink(targetPath),
  symlink: (target, targetPath) => nodeFs.symlink(target, targetPath),
  rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
  rm: (targetPath, options) => nodeFs.rm(targetPath, options),
  chmod: (targetPath, mode) => nodeFs.chmod(targetPath, mode),
};

export interface DataManagementServiceOptions {
  /** Absolute ExtensionContext.globalStorageUri.fsPath. */
  dataFolderPath: string;
  fileSystem?: DataManagementFileSystem;
  now?: () => Date;
  createId?: () => string;
}

export interface DataResetResult {
  dataFolderPath: string;
  backupPath: string;
  removedEntries: number;
}

export type DataResetFailureStage = "backup" | "reset";

/**
 * A reset failure is safe to retry. When `backupPath` is present, the complete
 * pre-reset snapshot was committed and remains available for manual recovery.
 */
export class DataResetError extends Error {
  public readonly stage: DataResetFailureStage;
  public readonly backupPath: string | null;

  constructor(
    stage: DataResetFailureStage,
    message: string,
    backupPath: string | null,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "DataResetError";
    this.stage = stage;
    this.backupPath = backupPath;
  }
}

/**
 * Owns destructive operations below one extension global-storage root.
 * Confirmation deliberately stays outside this class: callers must invoke
 * `resetConfirmedData` only after an explicit confirmation has succeeded.
 */
export class DataManagementService {
  private readonly dataFolderPath: string;
  private readonly backupDirectoryPath: string;
  private readonly fileSystem: DataManagementFileSystem;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private resetOperations: Promise<void> = Promise.resolve();

  constructor(options: DataManagementServiceOptions) {
    if (!path.isAbsolute(options.dataFolderPath)) {
      throw new Error("Data folder path must be absolute");
    }

    const resolvedPath = path.resolve(options.dataFolderPath);
    if (resolvedPath === path.parse(resolvedPath).root) {
      throw new Error("Filesystem root cannot be used as the data folder");
    }

    this.dataFolderPath = resolvedPath;
    this.backupDirectoryPath = this.resolveWithinRoot(
      RESET_BACKUP_DIRECTORY,
    );
    this.fileSystem =
      options.fileSystem ?? nodeDataManagementFileSystem;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  /** The exact absolute path an Open Data Folder command should reveal. */
  public getDataFolderPath(): string {
    return this.dataFolderPath;
  }

  /**
   * Back up and reset active data. This method does not ask for confirmation;
   * the command layer must do that before calling it.
   */
  public resetConfirmedData(): Promise<DataResetResult> {
    const operation = this.resetOperations.then(() => this.performReset());
    this.resetOperations = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performReset(): Promise<DataResetResult> {
    let temporaryBackupPath: string | null = null;
    let backupPath: string | null = null;

    try {
      await this.ensureSafeDirectory(this.dataFolderPath);
      await this.ensureSafeDirectory(this.backupDirectoryPath);

      const artifactStem = this.backupArtifactStem();
      temporaryBackupPath = this.resolveWithinRoot(
        RESET_BACKUP_DIRECTORY,
        `.${artifactStem}.tmp`,
      );
      backupPath = this.resolveWithinRoot(
        RESET_BACKUP_DIRECTORY,
        artifactStem,
      );
      await this.fileSystem.mkdir(temporaryBackupPath, {
        recursive: false,
        mode: DIRECTORY_MODE,
      });
      await this.setPrivateDirectoryMode(temporaryBackupPath);

      const entries = await this.activeEntryNames();
      for (const entryName of entries) {
        await this.copyEntry(
          this.resolveWithinRoot(entryName),
          this.resolveWithinRoot(
            RESET_BACKUP_DIRECTORY,
            path.basename(temporaryBackupPath),
            entryName,
          ),
        );
      }

      await this.fileSystem.rename(temporaryBackupPath, backupPath);
      temporaryBackupPath = null;
      await this.setPrivateDirectoryMode(backupPath);
    } catch (error) {
      if (temporaryBackupPath) {
        await this.bestEffortRemove(temporaryBackupPath);
      }
      throw new DataResetError(
        "backup",
        "DevTracker data was not reset because its backup could not be completed",
        null,
        error,
      );
    }

    try {
      const entries = await this.activeEntryNames();
      for (const entryName of entries) {
        await this.fileSystem.rm(this.resolveWithinRoot(entryName), {
          recursive: true,
          force: true,
        });
      }

      return {
        dataFolderPath: this.dataFolderPath,
        backupPath,
        removedEntries: entries.length,
      };
    } catch (error) {
      throw new DataResetError(
        "reset",
        "DevTracker data reset did not finish; the complete backup was preserved",
        backupPath,
        error,
      );
    }
  }

  private async activeEntryNames(): Promise<string[]> {
    return (await this.fileSystem.readdir(this.dataFolderPath))
      .filter((entryName) => entryName !== RESET_BACKUP_DIRECTORY)
      .sort()
      .map((entryName) => {
        this.requireSafeEntryName(entryName);
        return entryName;
      });
  }

  private async copyEntry(sourcePath: string, targetPath: string): Promise<void> {
    this.requireWithinRoot(sourcePath);
    this.requireWithinRoot(targetPath);
    const sourceStats = await this.fileSystem.lstat(sourcePath);

    if (sourceStats.isDirectory()) {
      await this.fileSystem.mkdir(targetPath, {
        recursive: false,
        mode: DIRECTORY_MODE,
      });
      await this.setPrivateDirectoryMode(targetPath);
      const childNames = (await this.fileSystem.readdir(sourcePath)).sort();
      for (const childName of childNames) {
        this.requireSafeEntryName(childName);
        await this.copyEntry(
          path.join(sourcePath, childName),
          path.join(targetPath, childName),
        );
      }
      return;
    }

    if (sourceStats.isFile()) {
      const bytes = await this.fileSystem.readFile(sourcePath);
      await this.fileSystem.writeFile(targetPath, bytes, {
        flag: "wx",
        mode: FILE_MODE,
      });
      await this.setPrivateFileMode(targetPath);
      return;
    }

    if (sourceStats.isSymbolicLink()) {
      // Preserve the link itself. Never dereference it into an external path.
      const linkTarget = await this.fileSystem.readlink(sourcePath);
      await this.fileSystem.symlink(linkTarget, targetPath);
      return;
    }

    throw new Error(`Unsupported data entry type: ${sourcePath}`);
  }

  private async ensureSafeDirectory(targetPath: string): Promise<void> {
    this.requireRootOrDescendant(targetPath);
    try {
      const stats = await this.fileSystem.lstat(targetPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Data-management path is not a safe directory: ${targetPath}`);
      }
    } catch (error) {
      if (this.errorCode(error) !== "ENOENT") {
        throw error;
      }
      await this.fileSystem.mkdir(targetPath, {
        // Avoid creating any ancestor outside the configured root.
        recursive: false,
        mode: DIRECTORY_MODE,
      });
    }
    await this.setPrivateDirectoryMode(targetPath);
  }

  private backupArtifactStem(): string {
    const timestamp = this.now().toISOString().replace(/[:.]/g, "-");
    const identifier = this.createId().replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!identifier) {
      throw new Error("Backup identifier must contain a safe character");
    }
    return `reset-${timestamp}-${identifier}`;
  }

  private resolveWithinRoot(...segments: string[]): string {
    const resolvedPath = path.resolve(this.dataFolderPath, ...segments);
    this.requireRootOrDescendant(resolvedPath);
    return resolvedPath;
  }

  private requireRootOrDescendant(targetPath: string): void {
    const relativePath = path.relative(this.dataFolderPath, targetPath);
    if (
      relativePath === "" ||
      (!path.isAbsolute(relativePath) && relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`))
    ) {
      return;
    }
    throw new Error(`Path escapes the configured data folder: ${targetPath}`);
  }

  private requireWithinRoot(targetPath: string): void {
    const relativePath = path.relative(this.dataFolderPath, targetPath);
    if (
      relativePath === "" ||
      path.isAbsolute(relativePath) ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`)
    ) {
      throw new Error(`Path must be inside the configured data folder: ${targetPath}`);
    }
  }

  private requireSafeEntryName(entryName: string): void {
    if (
      !entryName ||
      entryName === "." ||
      entryName === ".." ||
      path.basename(entryName) !== entryName
    ) {
      throw new Error(`Unsafe data entry name: ${entryName}`);
    }
  }

  private async setPrivateDirectoryMode(targetPath: string): Promise<void> {
    if (process.platform !== "win32") {
      await this.fileSystem.chmod(targetPath, DIRECTORY_MODE);
    }
  }

  private async setPrivateFileMode(targetPath: string): Promise<void> {
    if (process.platform !== "win32") {
      await this.fileSystem.chmod(targetPath, FILE_MODE);
    }
  }

  private async bestEffortRemove(targetPath: string): Promise<void> {
    try {
      this.requireWithinRoot(targetPath);
      await this.fileSystem.rm(targetPath, { recursive: true, force: true });
    } catch {
      // An incomplete, hidden temp directory is safer than touching active data.
    }
  }

  private errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    return typeof error.code === "string" ? error.code : undefined;
  }
}
