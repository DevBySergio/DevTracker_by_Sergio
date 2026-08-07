import * as fs from "fs";

export interface Clock {
  now(): Date;
  nowMs(): number;
  monotonicNowMs?(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
  monotonicNowMs: () => performance.now(),
};

export interface FileSystemAdapter {
  existsSync(filePath: string): boolean;
  mkdirSync(
    directoryPath: string,
    options: { recursive: boolean; mode?: number },
  ): void;
  readFileSync(filePath: string, encoding: "utf8"): string;
  writeFileSync(filePath: string, data: string, options?: { mode?: number }): void;
  renameSync(oldPath: string, newPath: string): void;
  openSync(filePath: string, flags: "wx"): number;
  writeSync(fileDescriptor: number, data: string): number;
  closeSync(fileDescriptor: number): void;
  unlinkSync(filePath: string): void;
  statSync(filePath: string): { mtimeMs: number };
  chmodSync(filePath: string, mode: number): void;
  realpathSync(filePath: string): string;
  mkdir(
    directoryPath: string,
    options: { recursive: boolean; mode?: number },
  ): Promise<void>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  writeFile(
    filePath: string,
    data: string,
    options?: { mode?: number },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  stat(filePath: string): Promise<{ mtimeMs: number }>;
  chmod(filePath: string, mode: number): Promise<void>;
  openExclusive(filePath: string): Promise<AsyncFileHandle>;
  readdir(directoryPath: string): Promise<string[]>;
}

export interface AsyncFileHandle {
  writeFile(data: string): Promise<void>;
  close(): Promise<void>;
}

export const nodeFileSystem: FileSystemAdapter = {
  existsSync: (filePath) => fs.existsSync(filePath),
  mkdirSync: (directoryPath, options) => {
    fs.mkdirSync(directoryPath, options);
  },
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  writeFileSync: (filePath, data, options) => {
    fs.writeFileSync(filePath, data, options);
  },
  renameSync: (oldPath, newPath) => {
    fs.renameSync(oldPath, newPath);
  },
  openSync: (filePath, flags) => fs.openSync(filePath, flags),
  writeSync: (fileDescriptor, data) => fs.writeSync(fileDescriptor, data),
  closeSync: (fileDescriptor) => {
    fs.closeSync(fileDescriptor);
  },
  unlinkSync: (filePath) => {
    fs.unlinkSync(filePath);
  },
  statSync: (filePath) => fs.statSync(filePath),
  chmodSync: (filePath, mode) => {
    fs.chmodSync(filePath, mode);
  },
  realpathSync: (filePath) => fs.realpathSync(filePath),
  mkdir: async (directoryPath, options) => {
    await fs.promises.mkdir(directoryPath, options);
  },
  readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
  writeFile: async (filePath, data, options) => {
    await fs.promises.writeFile(filePath, data, options);
  },
  rename: async (oldPath, newPath) => {
    await fs.promises.rename(oldPath, newPath);
  },
  unlink: async (filePath) => {
    await fs.promises.unlink(filePath);
  },
  stat: async (filePath) => fs.promises.stat(filePath),
  chmod: async (filePath, mode) => {
    await fs.promises.chmod(filePath, mode);
  },
  openExclusive: async (filePath) => fs.promises.open(filePath, "wx"),
  readdir: (directoryPath) => fs.promises.readdir(directoryPath),
};

export interface IntervalScheduler {
  setInterval(callback: () => void, milliseconds: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
}

export const systemIntervalScheduler: IntervalScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (timer) => clearInterval(timer),
};
