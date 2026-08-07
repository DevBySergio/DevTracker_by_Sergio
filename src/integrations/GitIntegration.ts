import * as vscode from "vscode";
import { GitAdapter, GitState } from "../application/ports";
import { Clock } from "../platform/ports";

interface GitRepository {
  rootUri?: vscode.Uri;
  state: {
    HEAD?: { name?: string };
    workingTreeChanges: readonly unknown[];
    indexChanges: readonly unknown[];
    untrackedChanges: readonly unknown[];
  };
}

interface GitApi {
  repositories: readonly GitRepository[];
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

const REFRESH_INTERVAL_MS = 5000;
const DEFAULT_STATE: GitState = {
  branch: "No branch",
  dirtyFiles: 0,
};

export class VscodeGitIntegration implements GitAdapter {
  private currentState: GitState = { ...DEFAULT_STATE };
  private lastRefreshAt = 0;

  constructor(private readonly clock: Clock) {}

  public getCurrentState(): GitState {
    return { ...this.currentState };
  }

  public async refreshIfStale(
    projectPath: string,
  ): Promise<GitState | undefined> {
    const now = this.clock.nowMs();
    if (now - this.lastRefreshAt < REFRESH_INTERVAL_MS) {
      return undefined;
    }

    return this.refresh(projectPath);
  }

  public async refresh(projectPath: string): Promise<GitState> {
    this.lastRefreshAt = this.clock.nowMs();
    try {
      const extension = vscode.extensions.getExtension<GitExtensionExports>(
        "vscode.git",
      );
      if (!extension) {
        return this.setState("Git unavailable", 0);
      }

      const extensionApi = extension.isActive
        ? extension.exports
        : await extension.activate();
      const git = extensionApi.getAPI(1);
      const repository = git.repositories.find(
        (candidate) => candidate.rootUri?.fsPath === projectPath,
      );

      if (!repository) {
        return this.setState("No repository", 0);
      }

      const dirtyFiles =
        repository.state.workingTreeChanges.length +
        repository.state.indexChanges.length +
        repository.state.untrackedChanges.length;

      return this.setState(
        repository.state.HEAD?.name || "Detached HEAD",
        dirtyFiles,
      );
    } catch {
      return this.setState("Git unavailable", 0);
    }
  }

  private setState(branch: string, dirtyFiles: number): GitState {
    this.currentState = { branch, dirtyFiles };
    return this.getCurrentState();
  }
}
