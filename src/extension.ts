import * as vscode from "vscode";
import * as fs from "fs";
import { DataManager, DiagnosticsBySeverity } from "./DataManager";
import { ReportPanel } from "./ReportPanel";

let dataManager: DataManager;
let statusBarItem: vscode.StatusBarItem;
let trackingInterval: NodeJS.Timeout | undefined;
let saveInterval: NodeJS.Timeout | undefined;
let lastActivityTime = 0;
let lastKnownProject: string | undefined;
let lastActiveDocumentKey: string | undefined;
let isWindowFocused = true;
let isDebugging = false;
let currentGitBranch = "No branch";
let currentGitDirtyFiles = 0;
let lastGitRefresh = 0;
const INACTIVITY_THRESHOLD_SECONDS = 300;
const PASTE_CHARACTER_THRESHOLD = 80;
const GIT_REFRESH_INTERVAL_MS = 5000;

export function activate(context: vscode.ExtensionContext) {
  dataManager = new DataManager();

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "devtracker.showStats";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.showStats", () => {
      openPanel(context.extensionUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.setDailyGoal", async () => {
      const input = await vscode.window.showInputBox({
        title: "DevTracker: Meta Diaria",
        prompt: "Enter your daily goal in minutes (e.g: 240 for 4 hours).",
        placeHolder: "240",
        ignoreFocusOut: true,
        validateInput: (text) => {
          const num = Number(text);
          return isNaN(num) || num <= 0
            ? "Please enter a valid number greater than 0."
            : null;
        },
      });

      if (input) {
        const minutes = parseInt(input, 10);
        const hours = minutes / 60;

        if (typeof dataManager.setDailyGoal === "function") {
          dataManager.setDailyGoal(hours);
          vscode.window.showInformationMessage(
            `Daily goal updated to ${minutes} minutes.`,
          );
          updateState();
        } else {
          vscode.window.showErrorMessage(
            "Error: DataManager not initialized correctly.",
          );
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.exportCSV", async () => {
      const uri = await vscode.window.showSaveDialog({
        filters: { CSV: ["csv"] },
        saveLabel: "Export DevTracker Data",
      });
      if (uri) {
        try {
          fs.writeFileSync(uri.fsPath, dataManager.generateCSV());
          vscode.window.showInformationMessage(`Exported data: ${uri.fsPath}`);
        } catch (error: any) {
          vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(onActivity),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(onActiveTextEditorChanged),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(onDocumentChange),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(onDocumentSave),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      isWindowFocused = state.focused;
      if (state.focused) {
        onActivity();
      }
      updateState();
    }),
  );
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      updateDiagnosticsFromUris(event.uris);
    }),
  );
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(() => {
      isDebugging = true;
      updateState();
    }),
  );
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(() => {
      isDebugging = false;
      updateState();
    }),
  );

  startTracking();

  saveInterval = setInterval(() => {
    dataManager.saveData();
  }, 30000);

  updateState();
  onActiveTextEditorChanged(vscode.window.activeTextEditor);
}

export function deactivate() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
  }
  if (saveInterval) {
    clearInterval(saveInterval);
  }
  if (dataManager) {
    dataManager.saveData();
  }
}

function onActivity() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) {
    return;
  }

  lastActivityTime = Date.now();
  lastKnownProject = folder.uri.fsPath;
}

function onActiveTextEditorChanged(editor: vscode.TextEditor | undefined) {
  if (!editor || editor.document.uri.scheme !== "file") {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) {
    return;
  }

  const documentKey = editor.document.uri.toString();
  if (lastActiveDocumentKey && lastActiveDocumentKey !== documentKey) {
    dataManager.addContextSwitch(folder.uri.fsPath);
  }

  lastActiveDocumentKey = documentKey;
  lastActivityTime = Date.now();
  lastKnownProject = folder.uri.fsPath;
  updateDiagnosticsForProject(folder.uri.fsPath);
  void refreshGitState(folder.uri.fsPath);
  updateState();
}

function onDocumentChange(event: vscode.TextDocumentChangeEvent) {
  if (event.document.uri.scheme !== "file") {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(event.document.uri);
  if (!folder) {
    return;
  }

  lastActivityTime = Date.now();
  lastKnownProject = folder.uri.fsPath;

  const pPath = folder.uri.fsPath;
  const relativeFile = vscode.workspace.asRelativePath(event.document.uri, false);

  if (event.contentChanges.length > 0) {
    const changedCharacters = event.contentChanges.reduce((total, change) => {
      return total + Math.max(change.text.length, change.rangeLength);
    }, 0);
    const isPaste = event.contentChanges.some((change) => {
      const insertedLines = change.text.split("\n").length - 1;
      return (
        change.text.length >= PASTE_CHARACTER_THRESHOLD || insertedLines >= 4
      );
    });

    dataManager.addEditActivity(
      pPath,
      Math.max(1, changedCharacters),
      relativeFile,
      isPaste,
    );
  }

  let added = 0,
    deleted = 0;
  for (const change of event.contentChanges) {
    const newLines = change.text.split("\n").length - 1;
    if (newLines > 0) {
      added += newLines;
    }

    const rangeLines = change.range.end.line - change.range.start.line;
    if (rangeLines > 0) {
      deleted += rangeLines;
    }
  }

  if (added > 0 || deleted > 0) {
    dataManager.addLines(pPath, added, deleted);
  }

  updateState();
}

function onDocumentSave(document: vscode.TextDocument) {
  if (document.uri.scheme !== "file") {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return;
  }

  lastActivityTime = Date.now();
  lastKnownProject = folder.uri.fsPath;
  dataManager.addSave(folder.uri.fsPath);
  updateDiagnosticsForProject(folder.uri.fsPath);
  void refreshGitState(folder.uri.fsPath);
  updateState();
}

function startTracking() {
  trackingInterval = setInterval(() => {
    const now = Date.now();
    if (
      lastActivityTime > 0 &&
      isWindowFocused &&
      (now - lastActivityTime) / 1000 < INACTIVITY_THRESHOLD_SECONDS
    ) {
      const editor = vscode.window.activeTextEditor;
      let projectToTrack: string | undefined = undefined;
      let lang = "unknown";
      let relativeFile = "unknown";

      if (editor && editor.document.uri.scheme === "file") {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
          projectToTrack = folder.uri.fsPath;
          lang = editor.document.languageId;

          relativeFile = vscode.workspace.asRelativePath(
            editor.document.uri,
            false,
          );
        }
      }

      if (projectToTrack) {
        lastKnownProject = projectToTrack;
        maybeRefreshGitState(projectToTrack);
        dataManager.addTime(
          projectToTrack,
          lang,
          relativeFile,
          1,
          currentGitBranch,
        );
        dataManager.setGitDirtyFiles(projectToTrack, currentGitDirtyFiles);
        if (isDebugging) {
          dataManager.addDebugSeconds(projectToTrack, 1);
        }
      }
      updateState();
    } else if (lastKnownProject && !isWindowFocused) {
      dataManager.addIdleSeconds(lastKnownProject, 1);
      updateState();
    }
  }, 1000);
}

function maybeRefreshGitState(projectPath: string) {
  const now = Date.now();
  if (now - lastGitRefresh < GIT_REFRESH_INTERVAL_MS) {
    return;
  }

  lastGitRefresh = now;
  void refreshGitState(projectPath);
}

async function refreshGitState(projectPath: string): Promise<void> {
  try {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) {
      currentGitBranch = "Git unavailable";
      currentGitDirtyFiles = 0;
      dataManager.setGitDirtyFiles(projectPath, currentGitDirtyFiles);
      return;
    }

    const extensionApi = gitExtension.isActive
      ? gitExtension.exports
      : await gitExtension.activate();
    const git = extensionApi.getAPI(1);
    const repository = git.repositories.find((repo: any) => {
      return repo.rootUri?.fsPath === projectPath;
    });

    if (!repository) {
      currentGitBranch = "No repository";
      currentGitDirtyFiles = 0;
      dataManager.setGitDirtyFiles(projectPath, currentGitDirtyFiles);
      return;
    }

    currentGitBranch = repository.state.HEAD?.name || "Detached HEAD";
    currentGitDirtyFiles =
      repository.state.workingTreeChanges.length +
      repository.state.indexChanges.length +
      repository.state.untrackedChanges.length;
    dataManager.setGitDirtyFiles(projectPath, currentGitDirtyFiles);
  } catch {
    currentGitBranch = "Git unavailable";
    currentGitDirtyFiles = 0;
    dataManager.setGitDirtyFiles(projectPath, currentGitDirtyFiles);
  }
}

function updateDiagnosticsFromUris(uris: readonly vscode.Uri[]) {
  const projectPaths = new Set<string>();

  uris.forEach((uri) => {
    if (uri.scheme !== "file") {
      return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      projectPaths.add(folder.uri.fsPath);
    }
  });

  projectPaths.forEach((projectPath) => updateDiagnosticsForProject(projectPath));
  updateState();
}

function updateDiagnosticsForProject(projectPath: string) {
  const diagnostics: DiagnosticsBySeverity = {
    error: 0,
    warning: 0,
    info: 0,
    hint: 0,
  };

  vscode.languages.getDiagnostics().forEach(([uri, entries]) => {
    if (uri.scheme !== "file") {
      return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || folder.uri.fsPath !== projectPath) {
      return;
    }

    entries.forEach((diagnostic) => {
      switch (diagnostic.severity) {
        case vscode.DiagnosticSeverity.Error:
          diagnostics.error += 1;
          break;
        case vscode.DiagnosticSeverity.Warning:
          diagnostics.warning += 1;
          break;
        case vscode.DiagnosticSeverity.Information:
          diagnostics.info += 1;
          break;
        case vscode.DiagnosticSeverity.Hint:
          diagnostics.hint += 1;
          break;
      }
    });
  });

  dataManager.setDiagnostics(projectPath, diagnostics);
}

function updateState() {
  const sData = dataManager.getSessionState();

  const sessionSeconds = sData.seconds;
  const h = Math.floor(sessionSeconds / 3600);
  const m = Math.floor((sessionSeconds % 3600) / 60);
  const s = sessionSeconds % 60;
  const formatted = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;

  let progressPercent = 0;
  let goalSeconds = 14400;
  let todayTotalSeconds = 0;

  try {
    if (typeof dataManager.getDailyGoal === "function") {
      goalSeconds = dataManager.getDailyGoal();
    }
    if (typeof dataManager.getTodayTotalSeconds === "function") {
      todayTotalSeconds = dataManager.getTodayTotalSeconds();
    } else {
      todayTotalSeconds = sessionSeconds;
    }

    if (!goalSeconds || goalSeconds <= 0) {
      goalSeconds = 14400;
    }
    progressPercent = Math.min(
      100,
      Math.floor((todayTotalSeconds / goalSeconds) * 100),
    );
  } catch (e) {
    console.error("Error calculating goal:", e);
  }

  const icon = progressPercent >= 100 ? "$(check)" : "$(watch)";

  statusBarItem.text = `${icon} ${formatted}`;
  statusBarItem.tooltip = `Current session: ${formatted}\nTotal today: ${Math.floor(todayTotalSeconds / 60)} min\nDaily goal: ${progressPercent}%`;
  statusBarItem.show();

  if (ReportPanel.currentPanel && lastKnownProject) {
    ReportPanel.currentPanel.sendUpdate(
      sData,
      dataManager.getProjectData(lastKnownProject),
      dataManager.getAllProjects(),
      goalSeconds,
    );
  }
}

function openPanel(extensionUri: vscode.Uri) {
  let goalSafe = 14400;
  try {
    goalSafe = dataManager.getDailyGoal ? dataManager.getDailyGoal() : 14400;
  } catch {}

  if (lastKnownProject) {
    ReportPanel.createOrShow(
      extensionUri,
      dataManager.getSessionState(),
      dataManager.getProjectData(lastKnownProject),
      dataManager.getAllProjects(),
      goalSafe,
      lastKnownProject,
    );
  } else {
    vscode.window.showWarningMessage(
      "DevTracker: Start programming to view data.",
    );
  }
}
