import * as vscode from "vscode";
import {
  GitAdapter,
  GitState,
  GitStateChange,
} from "../application/ports";
import {
  GitRepositoryObservation,
  GitRepositoryTracker,
} from "./GitRepositoryTracker";

interface GitChange {
  uri: vscode.Uri;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    readonly onDidChange: vscode.Event<void>;
    readonly HEAD: { name?: string; commit?: string } | undefined;
    readonly workingTreeChanges: readonly GitChange[];
    readonly indexChanges: readonly GitChange[];
    readonly mergeChanges: readonly GitChange[];
    readonly untrackedChanges: readonly GitChange[];
  };
  readonly onDidCommit?: vscode.Event<void>;
  readonly onDidCheckout?: vscode.Event<void>;
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  readonly enabled?: boolean;
  readonly onDidChangeEnablement?: vscode.Event<boolean>;
  getAPI(version: 1): GitApi;
}

/** Event-driven adapter for VS Code's built-in Git extension API. */
export class VscodeGitIntegration implements GitAdapter {
  private readonly tracker = new GitRepositoryTracker();
  private readonly sourceDisposables: vscode.Disposable[] = [];
  private readonly repositoryDisposables = new Map<
    string,
    vscode.Disposable[]
  >();
  private configurationGeneration = 0;
  private enabled = false;
  private disposed = false;

  public async configure(enabled: boolean): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = ++this.configurationGeneration;
    this.enabled = enabled;
    this.disposeBindings();
    if (!enabled) {
      this.tracker.setMode("disabled");
      return;
    }

    this.tracker.setMode("unavailable");
    this.sourceDisposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("git.enabled")) {
          this.reconfigure();
        }
      }),
    );
    if (
      vscode.workspace.getConfiguration("git").get<boolean>("enabled", true) ===
      false
    ) {
      return;
    }
    try {
      const extension = vscode.extensions.getExtension<GitExtensionExports>(
        "vscode.git",
      );
      if (!extension) {
        return;
      }
      const exports = extension.isActive
        ? extension.exports
        : await extension.activate();
      if (!this.isCurrent(generation)) {
        return;
      }
      if (exports.enabled === false) {
        exports.onDidChangeEnablement &&
          this.sourceDisposables.push(
            exports.onDidChangeEnablement(() => this.reconfigure()),
          );
        return;
      }

      const api = exports.getAPI(1);
      if (!this.isCurrent(generation)) {
        return;
      }
      this.tracker.setMode("available");
      api.repositories.forEach((repository) => this.bindRepository(repository));
      this.sourceDisposables.push(
        api.onDidOpenRepository((repository) => this.bindRepository(repository)),
        api.onDidCloseRepository((repository) =>
          this.unbindRepository(repository),
        ),
      );
      if (exports.onDidChangeEnablement) {
        this.sourceDisposables.push(
          exports.onDidChangeEnablement(() => this.reconfigure()),
        );
      }
    } catch {
      if (this.isCurrent(generation)) {
        this.disposeBindings();
        this.tracker.setMode("unavailable");
      }
    }
  }

  public getState(resourcePath: string): GitState {
    return this.tracker.getState(resourcePath);
  }

  public onDidChange(
    listener: (change: GitStateChange) => void,
  ): vscode.Disposable {
    return this.tracker.onDidChange(listener);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.configurationGeneration += 1;
    this.disposeBindings();
    this.tracker.clear();
  }

  private bindRepository(repository: GitRepository): void {
    if (this.disposed || !this.enabled) {
      return;
    }
    const key = repository.rootUri.toString();
    this.repositoryDisposables.get(key)?.forEach((value) => value.dispose());
    const refresh = (): void => this.observe(repository, false);
    const subscriptions = [repository.state.onDidChange(refresh)];
    if (repository.onDidCommit) {
      subscriptions.push(
        repository.onDidCommit(() => this.observe(repository, true)),
      );
    }
    if (repository.onDidCheckout) {
      subscriptions.push(repository.onDidCheckout(refresh));
    }
    this.repositoryDisposables.set(key, subscriptions);
    this.observe(repository, false);
  }

  private unbindRepository(repository: GitRepository): void {
    const key = repository.rootUri.toString();
    this.repositoryDisposables.get(key)?.forEach((value) => value.dispose());
    this.repositoryDisposables.delete(key);
    this.tracker.removeRepository(key);
  }

  private observe(repository: GitRepository, commitEvent: boolean): void {
    const changes = [
      ...repository.state.workingTreeChanges,
      ...repository.state.indexChanges,
      ...repository.state.mergeChanges,
      ...repository.state.untrackedChanges,
    ];
    const observation: GitRepositoryObservation = {
      repositoryUri: repository.rootUri.toString(),
      rootPath: repository.rootUri.fsPath,
      branch: repository.state.HEAD?.name ?? null,
      headCommit: repository.state.HEAD?.commit ?? null,
      dirtyResourceUris: changes.map((change) => change.uri.toString()),
      commitEvent,
    };
    this.tracker.observeRepository(observation);
  }

  private reconfigure(): void {
    void this.configure(this.enabled);
  }

  private isCurrent(generation: number): boolean {
    return (
      !this.disposed &&
      this.enabled &&
      generation === this.configurationGeneration
    );
  }

  private disposeBindings(): void {
    this.sourceDisposables.splice(0).forEach((value) => value.dispose());
    this.repositoryDisposables.forEach((values) =>
      values.forEach((value) => value.dispose()),
    );
    this.repositoryDisposables.clear();
  }
}
