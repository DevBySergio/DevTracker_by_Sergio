import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { RangeProjectViewModel } from "../../domain/rangeQuery";
import { DevTrackerDevelopmentApi } from "../../extension";

const EXTENSION_ID = "DevBySergio.DevTrackerBySergio";
const EXPECTATION_FILE = ".devtracker-integration-expected.json";
const GIT_PROJECT = "git-project";
const PLAIN_PROJECT = "plain-project";
const TRACKED_TASK = "DevTracker integration test";

interface PersistedExpectation {
  activeTimeMs: number;
  editEvents: number;
  saveEvents: number;
  diagnosticResolvedErrors: number;
  succeededTaskRuns: number;
}

export async function run(): Promise<void> {
  const phase = process.env.DEVTRACKER_INTEGRATION_PHASE;
  const extension =
    vscode.extensions.getExtension<DevTrackerDevelopmentApi>(EXTENSION_ID) ??
    vscode.extensions.all.find(
      (candidate) => candidate.id.toLowerCase() === EXTENSION_ID.toLowerCase(),
    );
  assert.ok(extension, `Extension ${EXTENSION_ID} was not discovered`);

  if (phase === "empty") {
    await testEmptyActivationAndDashboard(extension);
    return;
  }

  const api = (await extension.activate()) as DevTrackerDevelopmentApi;
  assert.ok(api, "Development runtime API was not exposed");
  const folders = vscode.workspace.workspaceFolders ?? [];
  const gitFolder = folders.find((folder) => folder.name === GIT_PROJECT);
  const plainFolder = folders.find((folder) => folder.name === PLAIN_PROJECT);
  assert.ok(gitFolder, `Multi-root folder ${GIT_PROJECT} was not opened`);
  assert.ok(plainFolder, `Multi-root folder ${PLAIN_PROJECT} was not opened`);

  if (phase === "reload") {
    await testReloadAfterDeactivation(api, gitFolder);
    return;
  }
  assert.strictEqual(phase, "record", `Unknown integration phase: ${phase}`);
  await testRealEventsAndPendingDeactivation(api, gitFolder, plainFolder);
}

async function testEmptyActivationAndDashboard(
  extension: vscode.Extension<DevTrackerDevelopmentApi>,
): Promise<void> {
  assert.strictEqual(
    vscode.window.activeTextEditor,
    undefined,
    "The empty phase unexpectedly started with an editor",
  );
  const api = (await extension.activate()) as DevTrackerDevelopmentApi;
  assert.ok(api, "Activation without an editor did not expose the test API");
  const view = await api.query({ preset: "today" });
  view.current.projects.forEach((project) => {
    assert.strictEqual(project.metrics.activeTimeMs, 0);
    assert.strictEqual(project.metrics.editEvents, 0);
    assert.strictEqual(project.metrics.saveEvents, 0);
  });

  await vscode.commands.executeCommand("devtracker.showStats");
  await waitFor(
    () => api.isDashboardOpen(),
    "Dashboard did not open without recent activity",
  );
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  await vscode.workspace
    .getConfiguration("git")
    .update("enabled", false, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace
    .getConfiguration("devtracker")
    .update("gitTrackingEnabled", true, vscode.ConfigurationTarget.Workspace);
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Empty integration workspace was not opened");
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "empty.ts"),
  );
  await vscode.window.showTextDocument(document);
  await waitFor(
    () => api.gitStatus(folder.uri.fsPath) === "unavailable",
    "Disabled built-in Git extension was not reported as unavailable",
  );
}

async function testRealEventsAndPendingDeactivation(
  api: DevTrackerDevelopmentApi,
  gitFolder: vscode.WorkspaceFolder,
  plainFolder: vscode.WorkspaceFolder,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("devtracker");
  await vscode.workspace
    .getConfiguration("git")
    .update("enabled", true, vscode.ConfigurationTarget.Workspace);
  await configuration.update(
    "gitTrackingEnabled",
    true,
    vscode.ConfigurationTarget.Workspace,
  );
  await configuration.update(
    "taskTrackingEnabled",
    true,
    vscode.ConfigurationTarget.Workspace,
  );
  await configuration.update(
    "trackedTasks",
    [{ configuredName: TRACKED_TASK, classification: "test" }],
    vscode.ConfigurationTarget.Workspace,
  );

  const documentUri = vscode.Uri.joinPath(gitFolder.uri, "tracked.ts");
  const secondDocumentUri = vscode.Uri.joinPath(gitFolder.uri, "second.ts");
  const plainDocumentUri = vscode.Uri.joinPath(plainFolder.uri, "plain.ts");
  const document = await vscode.workspace.openTextDocument(documentUri);
  const editor = await vscode.window.showTextDocument(document);
  await delay(100);

  await insert(document, "const first = 1;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  const first = await projectView(api, GIT_PROJECT);
  assert.ok(first.metrics.activeTimeMs >= 1_000, "Active time did not reach the query");
  assert.ok(
    first.metrics.editEvents >= 1,
    `Edit activity did not reach the query: ${JSON.stringify(first)}`,
  );
  assert.ok(
    first.metrics.saveEvents >= 1,
    `Save activity did not reach the query: ${JSON.stringify(first)}`,
  );
  await waitFor(
    () => api.gitStatus(documentUri.fsPath) === "available",
    "Containing Git repository did not become available",
    20_000,
  );

  const selectionChanged = onceEvent(
    vscode.window.onDidChangeTextEditorSelection,
    (event) => event.textEditor.document.uri.toString() === documentUri.toString(),
  );
  editor.selection = new vscode.Selection(0, 0, 0, 1);
  await selectionChanged;
  const beforeSelectionTime = (await projectView(api, GIT_PROJECT)).metrics
    .activeTimeMs;
  await delay(1_100);
  await api.flush();
  assert.ok(
    (await projectView(api, GIT_PROJECT)).metrics.activeTimeMs >
      beforeSelectionTime,
    "Selection activity did not keep active-time tracking live",
  );

  const diagnostics = vscode.languages.createDiagnosticCollection(
    "devtracker-integration",
  );
  try {
    diagnostics.set(documentUri, [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        "integration error",
        vscode.DiagnosticSeverity.Error,
      ),
      new vscode.Diagnostic(
        new vscode.Range(0, 1, 0, 2),
        "integration warning",
        vscode.DiagnosticSeverity.Warning,
      ),
    ]);
    await waitForProject(
      api,
      GIT_PROJECT,
      (project) =>
        project.metrics.diagnostics.current.error === 1 &&
        project.metrics.diagnostics.current.warning === 1,
      "Diagnostic additions did not reach the range query",
    );
    diagnostics.set(documentUri, []);
    await waitForProject(
      api,
      GIT_PROJECT,
      (project) =>
        project.metrics.diagnostics.current.error === 0 &&
        project.metrics.diagnostics.resolved.error >= 1,
      "Diagnostic resolution did not reach the range query",
    );
  } finally {
    diagnostics.dispose();
  }

  await configuration.update(
    "documentExclusionGlobs",
    ["**/tracked.ts"],
    vscode.ConfigurationTarget.Workspace,
  );
  await delay(100);
  const excluded = metricSnapshot(await projectView(api, GIT_PROJECT));
  await insert(document, "const excluded = true;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  assert.deepStrictEqual(
    metricSnapshot(await projectView(api, GIT_PROJECT)),
    excluded,
    "A configuration-excluded document contributed metrics",
  );
  await configuration.update(
    "documentExclusionGlobs",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );

  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
  });
  assert.strictEqual(api.gitStatus(documentUri.fsPath), "available");

  const secondDocument = await vscode.workspace.openTextDocument(secondDocumentUri);
  const editorChanged = onceEvent(
    vscode.window.onDidChangeActiveTextEditor,
    (candidate) => candidate?.document.uri.toString() === secondDocumentUri.toString(),
  );
  await vscode.window.showTextDocument(secondDocument, {
    preview: false,
    preserveFocus: false,
  });
  await editorChanged;
  await insert(secondDocument, "const second = true;\n");
  await delay(1_100);
  await secondDocument.save();

  const plainDocument = await vscode.workspace.openTextDocument(plainDocumentUri);
  const projectEditorChanged = onceEvent(
    vscode.window.onDidChangeActiveTextEditor,
    (candidate) => candidate?.document.uri.toString() === plainDocumentUri.toString(),
  );
  await vscode.window.showTextDocument(plainDocument, {
    preview: false,
    preserveFocus: false,
  });
  await projectEditorChanged;
  await insert(plainDocument, "const plain = true;\n");
  await delay(1_100);
  await plainDocument.save();
  await api.flush();
  const gitProjectId = api.workspaceProjectId(GIT_PROJECT);
  const plainProjectId = api.workspaceProjectId(PLAIN_PROJECT);
  assert.ok(gitProjectId);
  assert.ok(plainProjectId);
  assert.notStrictEqual(gitProjectId, plainProjectId);
  assert.strictEqual(
    api.gitStatus(plainDocumentUri.fsPath),
    "no-repository",
    "Non-repository workspace root did not expose its Git state",
  );
  await runConfiguredTask(plainFolder);
  await api.flush();
  const plainTask = await taskSummary(api, PLAIN_PROJECT);
  assert.strictEqual(plainTask?.runCount, 1);
  assert.strictEqual(plainTask?.succeededRunCount, 1);

  await runConfiguredTask(gitFolder);
  await api.flush();
  const task = await taskSummary(api, GIT_PROJECT);
  assert.strictEqual(task?.runCount, 1);
  assert.strictEqual(task?.succeededRunCount, 1);
  assert.strictEqual(task?.successRatePercent, 100);
  assert.ok(task?.medianDurationMs !== null, "Task duration was not aggregated");

  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand("devtracker.pauseTracking");
  assert.strictEqual(api.trackingStatus(), "paused");
  const paused = metricSnapshot(await projectView(api, GIT_PROJECT));
  await insert(document, "const paused = true;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  assert.deepStrictEqual(
    metricSnapshot(await projectView(api, GIT_PROJECT)),
    paused,
    "Paused tracking accepted editor activity",
  );

  await vscode.commands.executeCommand("devtracker.resumeTracking");
  assert.notStrictEqual(
    api.trackingStatus(),
    "paused",
    "Resume left the activity state machine paused",
  );

  await runConfiguredTask(gitFolder);
  await waitFor(async () => {
    const pendingTask = await taskSummary(api, GIT_PROJECT);
    return pendingTask?.succeededRunCount === 2;
  }, "Second task outcome did not enter the pending in-memory view");
  const pending = await projectView(api, GIT_PROJECT);
  const pendingTask = await taskSummary(api, GIT_PROJECT);
  await writeExpectation(gitFolder, {
    activeTimeMs: pending.metrics.activeTimeMs,
    editEvents: pending.metrics.editEvents,
    saveEvents: pending.metrics.saveEvents,
    diagnosticResolvedErrors: pending.metrics.diagnostics.resolved.error,
    succeededTaskRuns: pendingTask?.succeededRunCount ?? 0,
  });
  // Deliberately return without api.flush(). VS Code must await deactivate(),
  // which completes the session and drains pending writes before process exit.
}

async function testReloadAfterDeactivation(
  api: DevTrackerDevelopmentApi,
  gitFolder: vscode.WorkspaceFolder,
): Promise<void> {
  const expected = await readExpectation(gitFolder);
  const retained = await projectView(api, GIT_PROJECT);
  assert.ok(
    retained.metrics.activeTimeMs >= expected.activeTimeMs,
    "Deactivation lost pending active time",
  );
  assert.ok(
    retained.metrics.editEvents >= expected.editEvents,
    "Deactivation lost the final pending edit",
  );
  assert.ok(
    retained.metrics.saveEvents >= expected.saveEvents,
    "Reload lost persisted save activity",
  );
  assert.ok(
    retained.metrics.diagnostics.resolved.error >=
      expected.diagnosticResolvedErrors,
    "Reload lost persisted diagnostic transitions",
  );
  const retainedTask = await taskSummary(api, GIT_PROJECT);
  assert.strictEqual(
    retainedTask?.succeededRunCount,
    expected.succeededTaskRuns,
  );
  assert.ok(
    retainedTask?.medianDurationMs !== null,
    "Reload lost persisted task duration",
  );
  await api.flush();
}

async function runConfiguredTask(folder: vscode.WorkspaceFolder): Promise<void> {
  const task = new vscode.Task(
    { type: "devtracker-integration" },
    folder,
    TRACKED_TASK,
    "DevTracker integration",
    new vscode.ProcessExecution("/usr/bin/true"),
  );
  const ended = onceEvent(
    vscode.tasks.onDidEndTask,
    (event) => event.execution.task.name === task.name,
  );
  await vscode.tasks.executeTask(task);
  await ended;
}

async function taskSummary(api: DevTrackerDevelopmentApi, displayName: string) {
  const project = await projectView(api, displayName);
  return project.tasks.find((task) => task.configuredName === TRACKED_TASK);
}

async function projectView(
  api: DevTrackerDevelopmentApi,
  displayName: string,
): Promise<RangeProjectViewModel> {
  const view = await api.query({ preset: "today" });
  const projectId = api.workspaceProjectId(displayName);
  assert.ok(projectId, `Workspace identity for ${displayName} was not available`);
  const project = view.current.projects.find(
    (candidate) => candidate.project.id === projectId,
  );
  assert.ok(project, `Project ${displayName} was not present in the query`);
  return project;
}

async function waitForProject(
  api: DevTrackerDevelopmentApi,
  displayName: string,
  predicate: (project: RangeProjectViewModel) => boolean,
  message: string,
  timeoutMs = 10_000,
): Promise<RangeProjectViewModel> {
  let latest: RangeProjectViewModel | undefined;
  await waitFor(async () => {
    await api.flush();
    latest = await projectView(api, displayName);
    return predicate(latest);
  }, message, timeoutMs);
  return latest!;
}

function metricSnapshot(project: RangeProjectViewModel): {
  activeTimeMs: number;
  editEvents: number;
  saveEvents: number;
} {
  return {
    activeTimeMs: project.metrics.activeTimeMs,
    editEvents: project.metrics.editEvents,
    saveEvents: project.metrics.saveEvents,
  };
}

async function insert(
  document: vscode.TextDocument,
  text: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(document.lineCount, 0), text);
  assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
}

function onceEvent<T>(
  event: vscode.Event<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      disposable.dispose();
      reject(new Error("Expected VS Code event was not emitted"));
    }, timeoutMs);
    const disposable = event((value) => {
      if (!predicate(value)) {
        return;
      }
      clearTimeout(timeout);
      disposable.dispose();
      resolve(value);
    });
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) {
      return;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(message);
}

async function writeExpectation(
  folder: vscode.WorkspaceFolder,
  value: PersistedExpectation,
): Promise<void> {
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(folder.uri, EXPECTATION_FILE),
    Buffer.from(JSON.stringify(value), "utf8"),
  );
}

async function readExpectation(
  folder: vscode.WorkspaceFolder,
): Promise<PersistedExpectation> {
  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(folder.uri, EXPECTATION_FILE),
  );
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as PersistedExpectation;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
