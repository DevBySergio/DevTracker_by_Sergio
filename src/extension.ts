import * as vscode from "vscode";
import { DataManager } from "./DataManager";
import { ReportPanel } from "./ReportPanel";

let dataManager: DataManager;
let statusBarItem: vscode.StatusBarItem;
let trackingInterval: NodeJS.Timeout | undefined;
let saveInterval: NodeJS.Timeout | undefined;
let lastActivityTime: number = Date.now();
let lastKnownProject: string | undefined;
const INACTIVITY_THRESHOLD_SECONDS = 300;

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
          require("fs").writeFileSync(uri.fsPath, dataManager.generateCSV());
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
    vscode.window.onDidChangeActiveTextEditor(onActivity),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(onDocumentChange),
  );

  startTracking();

  saveInterval = setInterval(() => {
    dataManager.saveData();
  }, 30000);

  updateState();
}

export function deactivate() {
  if (trackingInterval) clearInterval(trackingInterval);
  if (saveInterval) clearInterval(saveInterval);
  if (dataManager) dataManager.saveData();
}

function onActivity() {
  lastActivityTime = Date.now();
}

function onDocumentChange(event: vscode.TextDocumentChangeEvent) {
  onActivity();
  if (event.document.uri.scheme !== "file") return;

  const folder = vscode.workspace.getWorkspaceFolder(event.document.uri);
  if (!folder) return;

  const pPath = folder.uri.fsPath;

  if (event.contentChanges.length > 0) {
    dataManager.addKeystrokes(pPath, 1);
  }

  let added = 0,
    deleted = 0;
  for (const change of event.contentChanges) {
    const newLines = change.text.split("\n").length - 1;
    if (newLines > 0) added += newLines;

    const rangeLines = change.range.end.line - change.range.start.line;
    if (rangeLines > 0) deleted += rangeLines;
  }

  if (added > 0 || deleted > 0) {
    dataManager.addLines(pPath, added, deleted);
  }

  updateState();
}

function startTracking() {
  trackingInterval = setInterval(() => {
    const now = Date.now();
    if ((now - lastActivityTime) / 1000 < INACTIVITY_THRESHOLD_SECONDS) {
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
        dataManager.addTime(projectToTrack, lang, relativeFile, 1);
      }
      updateState();
    }
  }, 1000);
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
    if (typeof dataManager.getDailyGoal === "function")
      goalSeconds = dataManager.getDailyGoal();
    if (typeof dataManager.getTodayTotalSeconds === "function") {
      todayTotalSeconds = dataManager.getTodayTotalSeconds();
    } else {
      todayTotalSeconds = sessionSeconds;
    }

    if (!goalSeconds || goalSeconds <= 0) goalSeconds = 14400;
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
