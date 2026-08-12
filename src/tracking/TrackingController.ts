import * as vscode from "vscode";
import {
  ActivityIntervalSink,
  DailyMetricSink,
  DashboardPresentation,
  DashboardQueryService,
  DebugMetricObservation,
  DebugMetricSink,
  DiagnosticBucketSink,
  GitAdapter,
  GitState,
  TrackingStore,
  TrackingPrivacyPolicy,
} from "../application/ports";
import { DiagnosticsBySeverity } from "../domain/types";
import { UriIdentityService } from "../identity/UriIdentityService";
import {
  Clock,
  IntervalScheduler,
} from "../platform/ports";
import {
  ActivityInteraction,
  ActivityStateMachine,
  ActivityStateSnapshot,
  ActivityTransition,
  EditorActivityContext,
} from "./ActivityStateMachine";
import { summarizeEditorEdit } from "./EditMetrics";
import { DiagnosticBucketUpdate, DiagnosticsTracker } from "./DiagnosticsTracker";
import { DebugSessionTracker } from "./DebugSessionTracker";

const TRACKING_INTERVAL_MS = 1000;

interface EditorAttribution {
  projectPath: string;
  projectId: string;
  contextId: string;
  language: string;
  relativeFile: string;
  documentId: string | null;
}

export interface TrackingControllerDependencies {
  store: TrackingStore;
  queries: DashboardQueryService;
  git: GitAdapter;
  presentation: DashboardPresentation;
  clock: Clock;
  scheduler: IntervalScheduler;
  identityService: UriIdentityService;
  activityIntervals: ActivityIntervalSink;
  dailyMetrics: DailyMetricSink;
  debugMetrics: DebugMetricSink;
  diagnostics: DiagnosticsTracker;
  diagnosticBuckets: DiagnosticBucketSink;
  privacy: TrackingPrivacyPolicy;
  activityStateMachine?: ActivityStateMachine;
  debugSessions?: DebugSessionTracker;
}

/**
 * Adapts VS Code commands and events to the application's typed service ports.
 * Mutable extension-host state is owned by this disposable instance.
 */
export class TrackingController implements vscode.Disposable {
  private readonly store: TrackingStore;
  private readonly queries: DashboardQueryService;
  private readonly git: GitAdapter;
  private readonly presentation: DashboardPresentation;
  private readonly clock: Clock;
  private readonly scheduler: IntervalScheduler;
  private readonly activityStateMachine: ActivityStateMachine;
  private readonly identityService: UriIdentityService;
  private readonly activityIntervals: ActivityIntervalSink;
  private readonly dailyMetrics: DailyMetricSink;
  private readonly debugMetrics: DebugMetricSink;
  private readonly debugSessions: DebugSessionTracker;
  private readonly diagnostics: DiagnosticsTracker;
  private readonly diagnosticBuckets: DiagnosticBucketSink;
  private readonly privacy: TrackingPrivacyPolicy;
  private readonly projectIdentityIds = new Map<string, string>();
  private readonly projectPathsById = new Map<string, string>();

  private trackingInterval: NodeJS.Timeout | undefined;
  private lastKnownProject: string | undefined;
  private currentProjectPath: string | undefined;
  private currentProjectId: string | undefined;
  private currentLanguage = "unknown";
  private currentRelativeFile = "unknown";
  private currentDocumentId: string | null = null;
  private disposed = false;

  constructor(dependencies: TrackingControllerDependencies) {
    this.store = dependencies.store;
    this.queries = dependencies.queries;
    this.git = dependencies.git;
    this.presentation = dependencies.presentation;
    this.clock = dependencies.clock;
    this.scheduler = dependencies.scheduler;
    this.identityService = dependencies.identityService;
    this.activityIntervals = dependencies.activityIntervals;
    this.dailyMetrics = dependencies.dailyMetrics;
    this.debugMetrics = dependencies.debugMetrics;
    this.diagnostics = dependencies.diagnostics;
    this.diagnosticBuckets = dependencies.diagnosticBuckets;
    this.privacy = dependencies.privacy;
    this.activityStateMachine =
      dependencies.activityStateMachine ??
      new ActivityStateMachine({ clock: this.clock });
    this.debugSessions =
      dependencies.debugSessions ??
      new DebugSessionTracker({
        clock: this.clock,
        privacyEnabled: this.privacy.isDebugTrackingEnabled(),
      });
    this.syncTrackingState(this.activityStateMachine.getSnapshot());
  }

  public start(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("devtracker.showStats", () => {
        this.openPanel();
      }),
      vscode.commands.registerCommand("devtracker.setDailyGoal", () =>
        this.setDailyGoal(),
      ),
      vscode.commands.registerCommand("devtracker.setWeeklyGoal", () =>
        this.setWeeklyGoal(),
      ),
      vscode.commands.registerCommand("devtracker.pauseTracking", () =>
        this.pause(),
      ),
      vscode.commands.registerCommand("devtracker.resumeTracking", () => {
        this.resume();
      }),
      vscode.window.onDidChangeTextEditorSelection(() =>
        this.onSelectionChanged(),
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        this.onActiveTextEditorChanged(editor),
      ),
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.onDocumentChange(event),
      ),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.onDocumentSave(document),
      ),
      vscode.window.onDidChangeWindowState((state) => {
        this.applyActivityTransition(
          this.activityStateMachine.setFocused(state.focused),
        );
        if (!state.focused) {
          this.flushInBackground("window focus loss");
        }
        this.updateState();
      }),
      vscode.languages.onDidChangeDiagnostics((event) => {
        this.updateDiagnosticsFromUris(event.uris);
      }),
      vscode.debug.onDidStartDebugSession((session) =>
        this.onDebugSessionStarted(session),
      ),
      vscode.debug.onDidChangeActiveDebugSession((session) =>
        this.onActiveDebugSessionChanged(session),
      ),
      vscode.debug.onDidTerminateDebugSession((session) =>
        this.onDebugSessionTerminated(session),
      ),
    );

    this.trackingInterval = this.scheduler.setInterval(
      () => this.trackOneSecond(),
      TRACKING_INTERVAL_MS,
    );
    this.onActiveTextEditorChanged(vscode.window.activeTextEditor);
    if (vscode.debug.activeDebugSession) {
      this.onDebugSessionStarted(vscode.debug.activeDebugSession);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.applyActivityTransition(this.activityStateMachine.pause());
    this.recordDebugMetricUpdates(this.debugSessions.stopAll());
    this.disposed = true;

    if (this.trackingInterval) {
      this.scheduler.clearInterval(this.trackingInterval);
    }
    this.flushInBackground("controller disposal");
    this.presentation.dispose();
  }

  public flush(): Promise<void> {
    this.recordDiagnosticBucketUpdates(this.diagnostics.flush());
    return Promise.all([
      this.store.flush(),
      this.activityIntervals.flush(),
      this.dailyMetrics.flush(),
      this.debugMetrics.flush(),
      this.diagnosticBuckets.flush(),
    ]).then(() => undefined);
  }

  public async pause(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.applyActivityTransition(this.activityStateMachine.pause());
    this.recordDebugMetricUpdates(this.debugSessions.setPaused(true));
    this.updateState();
    await this.flush();
  }

  public resume(): void {
    if (this.disposed) {
      return;
    }
    this.recordDebugMetricUpdates(this.debugSessions.setPaused(false));
    this.applyActivityTransition(this.activityStateMachine.resume());
    this.updateState();
  }

  public refreshPrivacy(): void {
    if (this.disposed) {
      return;
    }
    this.applyActivityTransition(this.activityStateMachine.tick());
    this.recordDebugMetricUpdates(
      this.debugSessions.setPrivacyEnabled(
        this.privacy.isDebugTrackingEnabled(),
      ),
    );
    this.onActiveTextEditorChanged(vscode.window.activeTextEditor);
  }

  private async setDailyGoal(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: "DevTracker: Daily Goal",
      prompt: "Enter your daily goal in minutes (for example, 240 for 4 hours).",
      placeHolder: "240",
      ignoreFocusOut: true,
      validateInput: (text) => {
        const value = Number(text);
        return Number.isNaN(value) || value <= 0
          ? "Please enter a valid number greater than 0."
          : null;
      },
    });

    if (!input) {
      return;
    }

    const minutes = Number.parseInt(input, 10);
    this.store.setDailyGoal(minutes / 60);
    await this.store.flush();
    vscode.window.showInformationMessage(
      `Daily goal updated to ${minutes} minutes.`,
    );
    this.updateState();
  }

  private async setWeeklyGoal(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: "DevTracker: Weekly Goal",
      prompt:
        "Enter an optional weekly goal in minutes, or leave blank to clear it.",
      placeHolder: "1200",
      ignoreFocusOut: true,
      validateInput: (text) => {
        if (text.trim().length === 0) {
          return null;
        }
        const value = Number(text);
        return !Number.isFinite(value) || value <= 0
          ? "Enter a number greater than 0, or leave blank to clear the goal."
          : null;
      },
    });

    if (input === undefined) {
      return;
    }
    if (input.trim().length === 0) {
      this.store.setWeeklyGoal(null);
      await this.store.flush();
      void vscode.window.showInformationMessage("Weekly goal cleared.");
      this.updateState();
      return;
    }

    const minutes = Number(input);
    this.store.setWeeklyGoal(minutes / 60);
    await this.store.flush();
    void vscode.window.showInformationMessage(
      `Weekly goal updated to ${minutes} minutes.`,
    );
    this.updateState();
  }


  private onSelectionChanged(): void {
    const attribution = this.editorAttribution(vscode.window.activeTextEditor);
    if (!attribution) {
      return;
    }

    this.recordInteraction("selection", attribution);
    this.updateState();
  }

  private onActiveTextEditorChanged(
    editor: vscode.TextEditor | undefined,
  ): void {
    const attribution = this.editorAttribution(editor);
    if (!attribution) {
      this.clearCurrentContext();
      this.updateState();
      return;
    }

    this.recordInteraction("active-editor", attribution, {
      fileId: attribution.contextId,
      projectId: attribution.projectId,
    });
    this.updateDiagnosticsForProject(attribution.projectPath);
    this.refreshGitState(attribution.projectPath);
    this.updateState();
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const attribution = this.documentAttribution(event.document);
    if (!attribution) {
      return;
    }

    if (event.contentChanges.length > 0) {
      const transition = this.recordInteraction("edit", attribution, {
        fileId: attribution.contextId,
        projectId: attribution.projectId,
      });
      if (!transition.interactionAccepted) {
        this.updateState();
        return;
      }
      const activity = summarizeEditorEdit(
        event.contentChanges.map((change) => ({
          text: change.text,
          rangeLength: change.rangeLength,
          removedLineSpan: change.range.end.line - change.range.start.line,
        })),
      );
      this.store.addEditActivity(attribution.projectPath, activity);
      this.dailyMetrics.recordEditActivity({
        projectId: attribution.projectId,
        localDate: this.localDateKey(),
        ...activity,
      });
    }

    this.updateState();
  }

  private onDocumentSave(document: vscode.TextDocument): void {
    const attribution = this.documentAttribution(document);
    if (!attribution) {
      return;
    }

    const transition = this.recordInteraction("save", attribution, {
      fileId: attribution.contextId,
      projectId: attribution.projectId,
    });
    if (!transition.interactionAccepted) {
      this.updateState();
      return;
    }
    this.store.addSave(attribution.projectPath);
    this.dailyMetrics.recordSave({
      projectId: attribution.projectId,
      localDate: this.localDateKey(),
    });
    this.updateDiagnosticsForProject(attribution.projectPath);
    this.refreshGitState(attribution.projectPath);
    this.updateState();
  }

  private trackOneSecond(): void {
    this.applyActivityTransition(this.activityStateMachine.tick());
    this.recordDebugMetricUpdates(this.debugSessions.tick());
    this.updateState();
  }

  private recordInteraction(
    interaction: ActivityInteraction,
    attribution: EditorAttribution,
    editorContext?: EditorActivityContext,
  ): ActivityTransition {
    const transition = this.activityStateMachine.interact(
      interaction,
      editorContext,
    );
    this.applyActivityTransition(transition);
    if (transition.interactionAccepted) {
      this.setCurrentAttribution(attribution);
      if (transition.flowBlockStartedAtLocalDateKey) {
        this.store.recordFlowBlock(
          attribution.projectPath,
          transition.flowBlockStartedAtLocalDateKey,
        );
        this.dailyMetrics.recordFlowBlock({
          projectId: attribution.projectId,
          localDate: transition.flowBlockStartedAtLocalDateKey,
        });
      }
    }
    return transition;
  }

  private applyActivityTransition(transition: ActivityTransition): void {
    if (
      transition.slices.length > 0 &&
      this.currentProjectPath &&
      this.currentProjectId
    ) {
      const projectPath = this.currentProjectPath;
      const projectId = this.currentProjectId;
      this.refreshGitStateIfStale(projectPath);
      const gitState = this.privacy.isGitTrackingEnabled()
        ? this.git.getCurrentState()
        : { branch: "Git disabled", dirtyFiles: 0 };
      let totalSeconds = 0;

      transition.slices.forEach((slice) => {
        const seconds = slice.durationMs / 1000;
        totalSeconds += seconds;
        this.activityIntervals.recordActivityInterval({
          projectId,
          localDate: slice.localDateKey,
          documentId: this.currentDocumentId ?? null,
          languageId:
            this.currentLanguage === "unknown" ? null : this.currentLanguage,
          startedAt: slice.startedAt,
          endedAt: slice.endedAt,
          monotonicStartedAt: slice.monotonicStartedAt,
          monotonicEndedAt: slice.monotonicEndedAt,
          lastInteractionAt: slice.lastInteractionAt,
        });
        this.store.addTime(
          projectPath,
          this.currentLanguage,
          this.currentRelativeFile,
          seconds,
          gitState.branch,
          slice.localDateKey,
          false,
          this.currentDocumentId ?? undefined,
        );
      });
      this.store.setGitDirtyFiles(projectPath, gitState.dirtyFiles);
      this.recordDebugMetricUpdates(
        this.debugSessions.recordActiveTime(projectId, transition.slices),
      );
      if (this.debugSessions.isCollecting() && totalSeconds > 0) {
        this.store.addDebugSeconds(projectPath, totalSeconds);
      }
    }

    if (
      (transition.flowSlices.length > 0 ||
        transition.flowClosedAtLocalDateKey) &&
      this.currentProjectPath
    ) {
      const projectPath = this.currentProjectPath;
      const flowDates = new Set<string>();
      transition.flowSlices.forEach((slice) => {
        flowDates.add(slice.localDateKey);
        this.store.addFlowActiveTime(
          projectPath,
          slice.durationMs,
          slice.localDateKey,
        );
        if (this.currentProjectId) {
          this.dailyMetrics.recordFlowActiveTime({
            projectId: this.currentProjectId,
            localDate: slice.localDateKey,
            durationMs: Math.round(slice.durationMs),
          });
        }
      });
      if (transition.flowClosedAtLocalDateKey) {
        flowDates.add(transition.flowClosedAtLocalDateKey);
      }
      const dates = [...flowDates];
      dates.forEach((localDateKey, index) => {
        const isLatestDate = index === dates.length - 1;
        this.store.setCurrentFlowForDay(
          projectPath,
          isLatestDate && !transition.flowClosedAtLocalDateKey
            ? transition.flow.currentFlowActiveMs
            : 0,
          localDateKey,
        );
        if (
          this.currentProjectId &&
          (transition.flowClosedAtLocalDateKey || !isLatestDate)
        ) {
          this.dailyMetrics.closeFlow({
            projectId: this.currentProjectId,
            localDate: localDateKey,
          });
        }
      });
    }

    transition.confirmedContextSwitches.forEach((contextSwitch) => {
      const destinationPath = this.projectPathsById.get(
        contextSwitch.destinationProjectId,
      );
      if (destinationPath) {
        this.store.addConfirmedContextSwitch(
          destinationPath,
          contextSwitch.projectSwitch,
          contextSwitch.localDateKey,
        );
      }
      this.dailyMetrics.recordContextSwitch({
        projectId: contextSwitch.destinationProjectId,
        localDate: contextSwitch.localDateKey,
        projectSwitch: contextSwitch.projectSwitch,
      });
    });

    this.syncTrackingState(transition);
    this.store.setCurrentFlowMetrics(transition.flow);
  }

  private syncTrackingState(snapshot: ActivityStateSnapshot): void {
    this.store.setTrackingStatus(snapshot.status, snapshot.lastUpdatedAt);
  }

  private onDebugSessionStarted(session: vscode.DebugSession): void {
    if (this.disposed) {
      return;
    }
    this.applyActivityTransition(this.activityStateMachine.tick());
    this.recordDebugMetricUpdates(
      this.debugSessions.startSession({
        id: session.id,
        projectId: this.debugProjectId(session),
      }),
    );
    this.updateState();
  }

  private onActiveDebugSessionChanged(
    session: vscode.DebugSession | undefined,
  ): void {
    if (this.disposed) {
      return;
    }
    this.applyActivityTransition(this.activityStateMachine.tick());
    this.recordDebugMetricUpdates(
      this.debugSessions.setActiveSession(session?.id),
    );
    this.updateState();
  }

  private onDebugSessionTerminated(session: vscode.DebugSession): void {
    if (this.disposed) {
      return;
    }
    this.applyActivityTransition(this.activityStateMachine.tick());
    this.recordDebugMetricUpdates(
      this.debugSessions.terminateSession(session.id),
    );
    this.updateState();
  }

  private debugProjectId(session: vscode.DebugSession): string | null {
    const folder = session.workspaceFolder;
    if (!folder) {
      return this.currentProjectId ?? null;
    }
    if (
      folder.uri.scheme === "file" &&
      this.privacy.isProjectExcluded(folder.uri.fsPath)
    ) {
      return null;
    }
    return this.projectIdentityId(folder);
  }

  private recordDebugMetricUpdates(
    updates: readonly DebugMetricObservation[],
  ): void {
    updates.forEach((update) => {
      this.debugMetrics.recordDebugMetrics(update);
    });
  }

  private editorAttribution(
    editor: vscode.TextEditor | undefined,
  ): EditorAttribution | undefined {
    if (!editor) {
      return undefined;
    }
    return this.documentAttribution(editor.document);
  }

  private documentAttribution(
    document: vscode.TextDocument,
  ): EditorAttribution | undefined {
    if (document.uri.scheme !== "file") {
      return undefined;
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      return undefined;
    }

    const decision = this.privacy.evaluateDocument(
      folder.uri.fsPath,
      document.uri.fsPath,
    );
    if (decision.excluded) {
      return undefined;
    }

    const projectId = this.projectIdentityId(folder);
    return {
      projectPath: folder.uri.fsPath,
      projectId,
      contextId: document.uri.toString(),
      language: document.languageId,
      relativeFile: decision.documentIdentity ?? "unknown",
      documentId: decision.documentIdentity,
    };
  }

  private clearCurrentContext(): void {
    this.applyActivityTransition(this.activityStateMachine.clearContext());
    this.currentProjectPath = undefined;
    this.currentProjectId = undefined;
    this.currentLanguage = "unknown";
    this.currentRelativeFile = "unknown";
    this.currentDocumentId = null;
  }

  private setCurrentAttribution(attribution: EditorAttribution): void {
    this.currentProjectPath = attribution.projectPath;
    this.currentProjectId = attribution.projectId;
    this.currentLanguage = attribution.language;
    this.currentRelativeFile = attribution.relativeFile;
    this.currentDocumentId = attribution.documentId;
    this.lastKnownProject = attribution.projectPath;
  }

  private projectIdentityId(folder: vscode.WorkspaceFolder): string {
    const key = folder.uri.toString();
    const existing = this.projectIdentityIds.get(key);
    if (existing) {
      return existing;
    }
    const projectId = this.identityService.createProjectIdentity(
      {
        scheme: folder.uri.scheme,
        authority: folder.uri.authority,
        path: folder.uri.path,
        fsPath: folder.uri.fsPath,
      },
      folder.name,
    ).id;
    this.projectIdentityIds.set(key, projectId);
    this.projectPathsById.set(projectId, folder.uri.fsPath);
    return projectId;
  }

  private localDateKey(): string {
    const date = this.clock.now();
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private refreshGitState(projectPath: string): void {
    if (!this.privacy.isGitTrackingEnabled()) {
      this.store.setGitDirtyFiles(projectPath, 0);
      return;
    }
    void this.git.refresh(projectPath).then((state) => {
      if (this.disposed) {
        return;
      }
      this.recordGitState(projectPath, state);
      this.updateState();
    });
  }

  private refreshGitStateIfStale(projectPath: string): void {
    if (!this.privacy.isGitTrackingEnabled()) {
      return;
    }
    void this.git.refreshIfStale(projectPath).then((state) => {
      if (state && !this.disposed) {
        this.recordGitState(projectPath, state);
        this.updateState();
      }
    });
  }

  private recordGitState(projectPath: string, state: GitState): void {
    this.store.setGitDirtyFiles(projectPath, state.dirtyFiles);
  }

  private updateDiagnosticsFromUris(uris: readonly vscode.Uri[]): void {
    const projects = new Map<string, string>();

    uris.forEach((uri) => {
      if (uri.scheme !== "file") {
        return;
      }

      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (folder && !this.privacy.isProjectExcluded(folder.uri.fsPath)) {
        projects.set(this.projectIdentityId(folder), folder.uri.fsPath);
      }
    });

    this.updateDiagnosticsForProjects(projects);
    this.updateState();
  }

  private updateDiagnosticsForProject(projectPath: string): void {
    if (this.privacy.isProjectExcluded(projectPath)) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.find(
      (candidate) => candidate.uri.fsPath === projectPath,
    );
    if (!folder) {
      return;
    }
    this.updateDiagnosticsForProjects(
      new Map([[this.projectIdentityId(folder), projectPath]]),
    );
  }

  private updateDiagnosticsForProjects(
    projects: ReadonlyMap<string, string>,
  ): void {
    if (projects.size === 0) {
      return;
    }
    const projectIdsByPath = new Map(
      [...projects].map(([projectId, projectPath]) => [projectPath, projectId]),
    );
    const observations: Record<string, DiagnosticsBySeverity> = {};
    projects.forEach((_projectPath, projectId) => {
      observations[projectId] = this.emptyDiagnostics();
    });

    vscode.languages.getDiagnostics().forEach(([uri, entries]) => {
      if (uri.scheme !== "file") {
        return;
      }

      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) {
        return;
      }
      const projectId = projectIdsByPath.get(folder.uri.fsPath);
      if (!projectId) {
        return;
      }
      if (
        this.privacy.evaluateDocument(folder.uri.fsPath, uri.fsPath).excluded
      ) {
        return;
      }

      const diagnostics = observations[projectId];
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

    this.recordDiagnosticBucketUpdates(
      this.diagnostics.observe({ projects: observations }),
    );
    projects.forEach((projectPath, projectId) => {
      const current = this.diagnostics.getProjectState(projectId)?.diagnostics
        .current;
      if (current) {
        this.store.setDiagnostics(projectPath, current);
      }
    });
  }

  private recordDiagnosticBucketUpdates(
    updates: readonly DiagnosticBucketUpdate[],
  ): void {
    updates.forEach((update) => {
      this.diagnosticBuckets.recordDiagnosticBucket(update);
    });
  }

  private emptyDiagnostics(): DiagnosticsBySeverity {
    return { error: 0, warning: 0, info: 0, hint: 0 };
  }

  private updateState(): void {
    if (this.disposed) {
      return;
    }
    this.presentation.update(
      this.queries.getSnapshot(this.lastKnownProject),
    );
  }

  private openPanel(): void {
    this.presentation.open(this.queries.getSnapshot(this.lastKnownProject));
  }

  private flushInBackground(reason: string): void {
    void this.flush().catch((error) => {
      console.error(`DevTracker flush failed after ${reason}:`, error);
    });
  }
}
