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
    vscode.commands.registerCommand("devtracker.exportCSV", async () => {
      const uri = await vscode.window.showSaveDialog({
        filters: { CSV: ["csv"] },
      });
      if (uri) {
        require("fs").writeFileSync(uri.fsPath, dataManager.generateCSV());
        vscode.window.showInformationMessage("Datos exportados.");
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
  dataManager.saveData();
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

  if (event.contentChanges.length > 0) dataManager.addKeystrokes(pPath, 1);

  let added = 0,
    deleted = 0;
  for (const change of event.contentChanges) {
    const newLines = change.text.split("\n").length - 1;
    if (newLines > 0) added += newLines;
    const rangeLines = change.range.end.line - change.range.start.line;
    if (rangeLines > 0) deleted += rangeLines;
  }
  if (added > 0 || deleted > 0) dataManager.addLines(pPath, added, deleted);
  updateState();
}

function startTracking() {
  trackingInterval = setInterval(() => {
    const now = Date.now();
    if ((now - lastActivityTime) / 1000 < INACTIVITY_THRESHOLD_SECONDS) {
      const editor = vscode.window.activeTextEditor;
      let projectToTrack: string | undefined = undefined;
      let lang = "unknown";

      if (editor && editor.document.uri.scheme === "file") {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
          projectToTrack = folder.uri.fsPath;
          lang = editor.document.languageId;
        }
      }
      if (projectToTrack) {
        lastKnownProject = projectToTrack;
        dataManager.addTime(projectToTrack, lang, 1);
      }
      updateState();
    }
  }, 1000);
}

function updateState() {
  const sData = dataManager.getSessionState();
  const totalSeconds = sData.seconds;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const formatted =
    `${hours.toString().padStart(2, "0")}:` +
    `${minutes.toString().padStart(2, "0")}:` +
    `${seconds.toString().padStart(2, "0")}`;

  statusBarItem.text = `$(watch) ${formatted}`;
  statusBarItem.show();

  if (ReportPanel.currentPanel && lastKnownProject) {
    ReportPanel.currentPanel.sendUpdate(
      sData,
      dataManager.getProjectData(lastKnownProject),
      dataManager.getAllProjects(),
      dataManager.getDailyGoal(),
    );
  }
}

function openPanel(extensionUri: vscode.Uri) {
  if (lastKnownProject) {
    ReportPanel.createOrShow(
      extensionUri,
      dataManager.getSessionState(),
      dataManager.getProjectData(lastKnownProject),
      dataManager.getAllProjects(),
      dataManager.getDailyGoal(),
      lastKnownProject,
    );
  } else {
    vscode.window.showWarningMessage("Empieza a programar para ver datos.");
  }
}
