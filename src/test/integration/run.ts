import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { DevTrackerDevelopmentApi } from "../../extension";

const EXTENSION_ID = "DevBySergio.DevTrackerBySergio";

export async function run(): Promise<void> {
  const extension =
    vscode.extensions.getExtension<DevTrackerDevelopmentApi>(EXTENSION_ID) ??
    vscode.extensions.all.find(
      (candidate) => candidate.id.toLowerCase() === EXTENSION_ID.toLowerCase(),
    );
  assert.ok(extension, `Extension ${EXTENSION_ID} was not discovered`);
  const api = (await extension.activate()) as DevTrackerDevelopmentApi;
  assert.ok(api, "Development runtime API was not exposed");

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Integration workspace was not opened");
  if (process.env.DEVTRACKER_INTEGRATION_PHASE === "reload") {
    await api.flush();
    const retained = await projectMetrics(api, folder.name);
    assert.ok(
      retained.activeTimeMs > 5_000,
      "Reload replaced newly tracked active time with the legacy baseline",
    );
    assert.ok(retained.editEvents >= 2, "Reload lost persisted edit activity");
    assert.ok(retained.saveEvents >= 2, "Reload lost persisted save activity");
    return;
  }
  const documentUri = vscode.Uri.joinPath(folder.uri, "tracked.ts");
  const document = await vscode.workspace.openTextDocument(documentUri);
  await vscode.window.showTextDocument(document);
  await delay(100);

  await insert(document, "const first = 1;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  const first = await projectMetrics(api, folder.name);
  assert.ok(first.activeTimeMs >= 1_000, "Active time did not reach the dashboard query");
  assert.ok(first.editEvents >= 1, "Edit activity did not reach the dashboard query");
  assert.ok(first.saveEvents >= 1, "Save activity did not reach the dashboard query");

  await vscode.commands.executeCommand("devtracker.pauseTracking");
  const paused = await projectMetrics(api, folder.name);
  await insert(document, "const paused = true;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  const afterPausedActivity = await projectMetrics(api, folder.name);
  assert.deepStrictEqual(
    afterPausedActivity,
    paused,
    "Paused tracking accepted editor activity",
  );

  await vscode.commands.executeCommand("devtracker.resumeTracking");
  await insert(document, "const resumed = true;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  const resumed = await projectMetrics(api, folder.name);
  assert.ok(resumed.activeTimeMs > paused.activeTimeMs, "Resume did not restart active time");
  assert.ok(resumed.editEvents > paused.editEvents, "Resume did not restart edit tracking");

  const configuration = vscode.workspace.getConfiguration("devtracker");
  await configuration.update(
    "documentExclusionGlobs",
    ["**/tracked.ts"],
    vscode.ConfigurationTarget.Workspace,
  );
  await delay(100);
  const excluded = await projectMetrics(api, folder.name);
  await insert(document, "const excluded = true;\n");
  await delay(1_100);
  await document.save();
  await api.flush();
  assert.deepStrictEqual(
    await projectMetrics(api, folder.name),
    excluded,
    "Excluded document contributed metrics",
  );
  await configuration.update(
    "documentExclusionGlobs",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
}

async function insert(
  document: vscode.TextDocument,
  text: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    document.uri,
    new vscode.Position(document.lineCount, 0),
    text,
  );
  assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
}

async function projectMetrics(
  api: DevTrackerDevelopmentApi,
  displayName: string,
): Promise<{
  activeTimeMs: number;
  editEvents: number;
  saveEvents: number;
}> {
  const view = await api.query({ preset: "today" });
  const project = view.current.projects.find(
    (candidate) => candidate.project.displayName === displayName,
  );
  assert.ok(project, `Project ${displayName} was not present in the dashboard query`);
  return {
    activeTimeMs: project.metrics.activeTimeMs,
    editEvents: project.metrics.editEvents,
    saveEvents: project.metrics.saveEvents,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
