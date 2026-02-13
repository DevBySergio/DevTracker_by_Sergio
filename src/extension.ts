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

  // --- COMANDOS ---
  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.showStats", () => {
      openPanel(context.extensionUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.setDailyGoal", async () => {
      const input = await vscode.window.showInputBox({
        title: "DevTracker: Meta Diaria",
        prompt:
          "Introduce tu objetivo diario en minutos (ej: 240 para 4 horas).",
        placeHolder: "240",
        ignoreFocusOut: true,
        validateInput: (text) => {
          const num = Number(text);
          return isNaN(num) || num <= 0
            ? "Por favor, introduce un número válido mayor a 0."
            : null;
        },
      });

      if (input) {
        const minutes = parseInt(input, 10);
        const hours = minutes / 60;

        if (typeof dataManager.setDailyGoal === "function") {
          dataManager.setDailyGoal(hours);
          vscode.window.showInformationMessage(
            `Meta diaria actualizada a ${minutes} minutos.`,
          );
          updateState();
        } else {
          vscode.window.showErrorMessage(
            "Error: DataManager no inicializado correctamente.",
          );
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.exportCSV", async () => {
      const uri = await vscode.window.showSaveDialog({
        filters: { CSV: ["csv"] },
        saveLabel: "Exportar DevTracker Data",
      });
      if (uri) {
        try {
          require("fs").writeFileSync(uri.fsPath, dataManager.generateCSV());
          vscode.window.showInformationMessage(
            `Datos exportados: ${uri.fsPath}`,
          );
        } catch (error: any) {
          vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
      }
    }),
  );

  // --- EVENT LISTENERS ---
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

// --- FUNCIONES INTERNAS ---

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

  // 1. Formateo del tiempo de SESIÓN ACTUAL (visual)
  const sessionSeconds = sData.seconds;
  const h = Math.floor(sessionSeconds / 3600);
  const m = Math.floor((sessionSeconds % 3600) / 60);
  const s = sessionSeconds % 60;
  const formatted = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;

  // 2. Cálculo del PROGRESO DIARIO (usando tiempo acumulado real)
  let progressPercent = 0;
  let goalSeconds = 14400; // Default 4h
  let todayTotalSeconds = 0;

  try {
    if (typeof dataManager.getDailyGoal === "function")
      goalSeconds = dataManager.getDailyGoal();
    if (typeof dataManager.getTodayTotalSeconds === "function") {
      todayTotalSeconds = dataManager.getTodayTotalSeconds();
    } else {
      todayTotalSeconds = sessionSeconds; // Fallback
    }

    if (!goalSeconds || goalSeconds <= 0) goalSeconds = 14400;
    progressPercent = Math.min(
      100,
      Math.floor((todayTotalSeconds / goalSeconds) * 100),
    );
  } catch (e) {
    console.error("Error calculando meta:", e);
  }

  const icon = progressPercent >= 100 ? "$(check)" : "$(watch)";

  statusBarItem.text = `${icon} ${formatted}`;
  statusBarItem.tooltip = `Sesión actual: ${formatted}\nTotal hoy: ${Math.floor(todayTotalSeconds / 60)} min\nMeta diaria: ${progressPercent}%`;
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
      "DevTracker: Empieza a programar para ver datos.",
    );
  }
}
