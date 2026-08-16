import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { DataManager } from "./DataManager";
import { DataManagementService, DataResetError } from "./persistence/DataManagementService";
import { VscodeGitIntegration } from "./integrations/GitIntegration";
import { VscodePrivacySettings } from "./integrations/VscodePrivacySettings";
import { UriIdentityService } from "./identity/UriIdentityService";
import { WorkspaceIdentityRegistrar } from "./integrations/WorkspaceIdentityRegistrar";
import {
  nodeFileSystem,
  systemClock,
  systemIntervalScheduler,
} from "./platform/ports";
import { SessionStoreV2 } from "./persistence/SessionStoreV2";
import { SessionActivityRecorder } from "./persistence/SessionActivityRecorder";
import { SessionDailyMetricsRecorder } from "./persistence/SessionDailyMetricsRecorder";
import { SessionDebugMetricsRecorder } from "./persistence/SessionDebugMetricsRecorder";
import { SessionGitMetricsRecorder } from "./persistence/SessionGitMetricsRecorder";
import { SessionTaskMetricsRecorder } from "./persistence/SessionTaskMetricsRecorder";
import { SessionDiagnosticsRecorder } from "./persistence/SessionDiagnosticsRecorder";
import {
  LegacyMigration,
  LegacyMigrationResult,
} from "./persistence/LegacyMigration";
import { DashboardPresenter } from "./presentation/DashboardPresenter";
import { ProjectPreferencesStore } from "./presentation/ProjectPreferences";
import { ReportPanel } from "./ReportPanel";
import { DevTrackerQueries } from "./queries/DevTrackerQueries";
import { RangeQueryEngine } from "./queries/RangeQueryEngine";
import { RangeQueryService } from "./queries/RangeQueryService";
import { TrackingController } from "./tracking/TrackingController";
import { DiagnosticsTracker } from "./tracking/DiagnosticsTracker";
import { detailedDataCutoffMs } from "./privacy";
import { TrackingStatus } from "./domain/types";
import { ExportService } from "./export/ExportService";
import { RangeExportDataSource } from "./export/RangeExportDataSource";
import { VscodeExportCommands } from "./export/VscodeExportCommands";
import { RangeQueryRequest, RangeQueryViewModel } from "./domain/rangeQuery";
import { GitTrackingStatus } from "./domain/git";

let deactivateExtension: (() => Promise<void>) | undefined;

export interface DevTrackerDevelopmentApi {
  flush(): Promise<void>;
  query(request: RangeQueryRequest): Promise<RangeQueryViewModel>;
  isDashboardOpen(): boolean;
  gitStatus(resourcePath: string): GitTrackingStatus;
  workspaceProjectId(displayName: string): string | undefined;
  trackingStatus(): TrackingStatus;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<DevTrackerDevelopmentApi | undefined> {
  const storagePath = vscode.Uri.joinPath(context.globalStorageUri, "v2").fsPath;
  const sessionStore = new SessionStoreV2({
    storagePath,
    clock: systemClock,
    fileSystem: nodeFileSystem,
  });
  await sessionStore.initialize();
  const privacy = await VscodePrivacySettings.create(context.secrets);
  const identityService = new UriIdentityService({
    clock: systemClock,
    fileSystem: nodeFileSystem,
  });
  const migration = new LegacyMigration({
    legacyDataPath: path.join(os.homedir(), ".devtracker", "data.json"),
    backupDirectory: path.join(storagePath, "backups"),
    completionMarkerPath: path.join(
      storagePath,
      "metadata",
      "legacy-v1-complete.json",
    ),
    clock: systemClock,
    fileSystem: nodeFileSystem,
    target: sessionStore,
    createProjectIdentity: async ({ path: projectPath, displayName }) => {
      const uri = {
        scheme: "file",
        authority: "",
        path: projectPath,
        fsPath: projectPath,
      };
      const candidate = identityService.createProjectIdentity(uri, displayName);
      const existing = await sessionStore.getProjectIdentity(candidate.id);
      return identityService.createProjectIdentity(uri, displayName, existing);
    },
  });
  let migrationResult: LegacyMigrationResult | undefined;
  try {
    migrationResult = await migration.migrate();
    if (migrationResult.status === "recovered") {
      void vscode.window.showWarningMessage(
        "DevTracker recovered v1 history from a validated local backup. The original corrupt file was left unchanged.",
      );
    }
  } catch (error) {
    console.error("DevTracker v1 migration failed:", error);
    void vscode.window.showErrorMessage(
      "DevTracker could not migrate the existing v1 history. The original file was left unchanged; new activity will use separate extension storage.",
    );
  }

  const compactDetailedSessionData = async (): Promise<void> => {
    const cutoff = Math.max(
      0,
      detailedDataCutoffMs(
        systemClock.nowMs(),
        privacy.getDetailedDataRetentionDays(),
      ),
    );
    await sessionStore.compactCompletedSessions(cutoff);
    await sessionStore.flush();
  };
  try {
    await compactDetailedSessionData();
  } catch (error) {
    console.error("DevTracker detailed-data retention failed:", error);
    void vscode.window.showWarningMessage(
      "DevTracker could not compact expired session detail. Existing local data was left unchanged.",
    );
  }

  const store = new DataManager({
    dataPath: path.join(storagePath, "compatibility", "data.json"),
    initialData: migrationResult?.normalizedData,
    clock: systemClock,
    fileSystem: nodeFileSystem,
  });
  const queries = new DevTrackerQueries(store);
  const rangeQueries = new RangeQueryService(
    sessionStore,
    new RangeQueryEngine(systemClock),
  );
  const git = new VscodeGitIntegration();
  const presentation = new DashboardPresenter({
    extensionUri: context.extensionUri,
    rangeQueries,
    clock: systemClock,
    projectPreferences: new ProjectPreferencesStore(context.globalState),
    resolveProjectId: (projectPath) => {
      const folder = vscode.workspace.workspaceFolders?.find(
        (candidate) => candidate.uri.fsPath === projectPath,
      );
      const projectUri = folder?.uri ?? vscode.Uri.file(projectPath);
      return identityService.createProjectIdentity(
        {
          scheme: projectUri.scheme,
          authority: projectUri.authority,
          path: projectUri.path,
          fsPath: projectUri.fsPath,
        },
        folder?.name ?? path.basename(projectPath) ?? projectPath,
      ).id;
    },
    fileDetailAvailable: () => privacy.isFileDetailAvailable(),
  });
  const activeSession = await sessionStore.startSession();
  const activityIntervals = new SessionActivityRecorder({
    store: sessionStore,
    sessionId: activeSession.id,
  });
  const dailyMetrics = new SessionDailyMetricsRecorder(sessionStore);
  const diagnostics = new DiagnosticsTracker({ clock: systemClock });
  const diagnosticBuckets = new SessionDiagnosticsRecorder(sessionStore);
  const debugMetrics = new SessionDebugMetricsRecorder(sessionStore);
  const gitMetrics = new SessionGitMetricsRecorder(sessionStore);
  const taskMetrics = new SessionTaskMetricsRecorder(sessionStore);
  const controller = new TrackingController({
    store,
    queries,
    git,
    presentation,
    clock: systemClock,
    scheduler: systemIntervalScheduler,
    identityService,
    activityIntervals,
    dailyMetrics,
    debugMetrics,
    taskMetrics,
    gitMetrics,
    diagnostics,
    diagnosticBuckets,
    privacy,
  });

  const workspaceIdentities = new WorkspaceIdentityRegistrar(
    identityService,
    sessionStore,
    privacy,
  );

  await workspaceIdentities.register(context);
  controller.start(context);
  new VscodeExportCommands(
    new ExportService(
      new RangeExportDataSource(rangeQueries, sessionStore, systemClock),
    ),
  ).register(context);

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        controller.dispose();
        await controller.flush();
        await sessionStore.completeSession(activeSession.id);
        await sessionStore.flush();
      })();
    }
    return shutdownPromise;
  };

  deactivateExtension = shutdown;
  const dataManagement = new DataManagementService({
    dataFolderPath: context.globalStorageUri.fsPath,
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("devtracker.openDataFolder", async () => {
      await vscode.env.openExternal(
        vscode.Uri.file(dataManagement.getDataFolderPath()),
      );
    }),
    vscode.commands.registerCommand("devtracker.resetData", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Back up all DevTracker data, then reset the extension's local data? VS Code will reload after a successful reset.",
        { modal: true },
        "Back Up and Reset",
      );
      if (choice !== "Back Up and Reset") {
        return;
      }

      try {
        await shutdown();
        const result = await dataManagement.resetConfirmedData();
        await vscode.window.showInformationMessage(
          `DevTracker data reset. Backup saved at ${result.backupPath}.`,
        );
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      } catch (error) {
        const backup =
          error instanceof DataResetError && error.backupPath
            ? ` Complete backup: ${error.backupPath}.`
            : "";
        void vscode.window.showErrorMessage(
          `DevTracker data reset failed: ${error instanceof Error ? error.message : String(error)}.${backup}`,
        );
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("devtracker")) {
        return;
      }
      privacy.reload();
      controller.refreshPrivacy();
      void compactDetailedSessionData().catch((error) => {
        console.error("DevTracker retention update failed:", error);
        void vscode.window.showWarningMessage(
          "DevTracker could not apply the updated detailed-data retention setting.",
        );
      });
    }),
    {
      dispose: () => {
        void shutdown().catch((error) => {
          console.error("DevTracker shutdown flush failed:", error);
        });
      },
    },
  );

  if (context.extensionMode !== vscode.ExtensionMode.Production) {
    return Object.freeze({
      flush: () => controller.flush(),
      query: (request: RangeQueryRequest) => rangeQueries.query(request),
      isDashboardOpen: () => ReportPanel.currentPanel !== undefined,
      gitStatus: (resourcePath: string) => git.getState(resourcePath).status,
      workspaceProjectId: (displayName: string) => {
        const folder = vscode.workspace.workspaceFolders?.find(
          (candidate) => candidate.name === displayName,
        );
        if (!folder) {
          return undefined;
        }
        return identityService.createProjectIdentity(
          {
            scheme: folder.uri.scheme,
            authority: folder.uri.authority,
            path: folder.uri.path,
            fsPath: folder.uri.fsPath,
          },
          folder.name,
        ).id;
      },
      trackingStatus: () => queries.getSnapshot().trackingStatus,
    });
  }
  return undefined;
}

export function deactivate(): Promise<void> | undefined {
  const shutdown = deactivateExtension;
  deactivateExtension = undefined;
  return shutdown?.();
}
