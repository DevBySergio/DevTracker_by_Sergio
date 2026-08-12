import * as path from "path";
import {
  GitState,
  GitStateChange,
} from "../application/ports";
import { GitTrackingStatus } from "../domain/git";

export interface DisposableLike {
  dispose(): void;
}

export interface GitRepositoryObservation {
  repositoryUri: string;
  rootPath: string;
  branch: string | null;
  headCommit: string | null;
  dirtyResourceUris: readonly string[];
  commitEvent?: boolean;
}

const STATE_LABELS: Record<Exclude<GitTrackingStatus, "available">, string> = {
  disabled: "Git disabled",
  unavailable: "Git unavailable",
  "no-repository": "No repository",
};

/**
 * Pure repository-scoped Git state. The VS Code adapter owns subscriptions;
 * this class owns selection, deduplication, and transition semantics.
 */
export class GitRepositoryTracker {
  private mode: "disabled" | "unavailable" | "available" = "disabled";
  private readonly states = new Map<string, GitState>();
  private readonly lastDetectedCommit = new Map<string, string>();
  private readonly listeners = new Set<(change: GitStateChange) => void>();

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  public setMode(status: "disabled" | "unavailable" | "available"): void {
    this.mode = status;
    if (status !== "available") {
      this.states.clear();
      this.lastDetectedCommit.clear();
    }
  }

  public observeRepository(value: GitRepositoryObservation): GitStateChange {
    const rootPath = this.normalizePath(value.rootPath);
    const previous = this.states.get(value.repositoryUri);
    const state: GitState = {
      status: "available",
      repositoryUri: value.repositoryUri,
      repositoryRootPath: rootPath,
      branch: value.branch ?? (value.headCommit ? "Detached HEAD" : "Unborn HEAD"),
      headCommit: value.headCommit,
      dirtyFiles: new Set(value.dirtyResourceUris).size,
    };
    this.mode = "available";
    this.states.set(value.repositoryUri, state);
    const commitDetected =
      value.commitEvent === true &&
      state.headCommit !== null &&
      this.lastDetectedCommit.get(value.repositoryUri) !== state.headCommit;
    if (commitDetected) {
      this.lastDetectedCommit.set(value.repositoryUri, state.headCommit!);
    }
    const change: GitStateChange = {
      previous: previous ? { ...previous } : null,
      current: { ...state },
      branchChanged: previous !== undefined && previous.branch !== state.branch,
      commitDetected,
    };
    if (!previous || !this.equalState(previous, state) || commitDetected) {
      this.emit(change);
    }
    return change;
  }

  public removeRepository(repositoryUri: string): void {
    const previous = this.states.get(repositoryUri);
    if (!previous) {
      return;
    }
    this.states.delete(repositoryUri);
    this.lastDetectedCommit.delete(repositoryUri);
    this.emit({
      previous: { ...previous },
      current: this.state("no-repository"),
      branchChanged: false,
      commitDetected: false,
    });
  }

  public getState(resourcePath: string): GitState {
    if (this.mode === "disabled") {
      return this.state("disabled");
    }
    if (this.mode === "unavailable") {
      return this.state("unavailable");
    }
    const resource = this.normalizePath(resourcePath);
    const selected = [...this.states.values()]
      .filter((candidate) => this.contains(candidate.repositoryRootPath!, resource))
      .sort(
        (left, right) =>
          right.repositoryRootPath!.length - left.repositoryRootPath!.length ||
          left.repositoryUri!.localeCompare(right.repositoryUri!),
      )[0];
    return selected ? { ...selected } : this.state("no-repository");
  }

  public onDidChange(listener: (change: GitStateChange) => void): DisposableLike {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public clear(): void {
    this.states.clear();
    this.lastDetectedCommit.clear();
  }

  private emit(change: GitStateChange): void {
    this.listeners.forEach((listener) => listener(change));
  }

  private state(
    status: Exclude<GitTrackingStatus, "available">,
  ): GitState {
    return {
      status,
      repositoryUri: null,
      repositoryRootPath: null,
      branch: STATE_LABELS[status],
      headCommit: null,
      dirtyFiles: 0,
    };
  }

  private normalizePath(value: string): string {
    if (this.platform === "win32") {
      const normalized = value.replace(/\\/gu, "/").replace(/\/$/u, "");
      return normalized.replace(/^([A-Z]):/u, (_match, drive: string) =>
        `${drive.toLowerCase()}:`,
      );
    }
    return path.resolve(value).replace(/\/$/u, "") || path.sep;
  }

  private contains(rootPath: string, resourcePath: string): boolean {
    const separator = this.platform === "win32" ? "/" : path.sep;
    return resourcePath === rootPath || resourcePath.startsWith(`${rootPath}${separator}`);
  }

  private equalState(left: GitState, right: GitState): boolean {
    return (
      left.status === right.status &&
      left.repositoryUri === right.repositoryUri &&
      left.repositoryRootPath === right.repositoryRootPath &&
      left.branch === right.branch &&
      left.dirtyFiles === right.dirtyFiles
    );
  }
}
