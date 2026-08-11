import * as vscode from "vscode";
import { RangeAnalyticsQueryService } from "./application/ports";
import { Clock } from "./platform/ports";
import { TrackingStatus } from "./domain/types";
import { dashboardActionCommand } from "./presentation/DashboardActions";
import {
  DASHBOARD_PROTOCOL_VERSION,
  DashboardProtocolController,
  projectDashboardViewModel,
} from "./presentation/DashboardProtocol";
import { renderDashboardHtml } from "./webview/template";
import { ENGLISH_STRINGS as EN } from "./webview/strings";

export interface ReportPanelOptions {
  extensionUri: vscode.Uri;
  queryService: RangeAnalyticsQueryService;
  clock: Clock;
  currentProjectId: string | null;
  projects: ReadonlyArray<{ id: string; displayName: string }>;
  dailyGoalSeconds: number;
  trackingStatus: TrackingStatus;
  lastUpdatedAt: number;
  fileDetailAvailable: boolean;
}

export class ReportPanel {
  public static currentPanel: ReportPanel | undefined;
  public static readonly viewType = "devTrackerStats";
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly protocol: DashboardProtocolController;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(options: ReportPanelOptions): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel._panel.reveal();
      ReportPanel.currentPanel.notifyDataChanged();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReportPanel.viewType,
      EN.documentTitle,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(options.extensionUri, "media")],
        retainContextWhenHidden: true,
      },
    );

    ReportPanel.currentPanel = new ReportPanel(panel, options);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    options: ReportPanelOptions,
  ) {
    this._panel = panel;
    this._extensionUri = options.extensionUri;
    this.protocol = new DashboardProtocolController({
      query: async (request, view) =>
        projectDashboardViewModel(
          await options.queryService.query(request),
          view,
        ),
      send: async (message) => {
        await this._panel.webview.postMessage(message);
      },
      clock: options.clock,
      initiallyVisible: panel.visible,
    });

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(
      (event) => {
        void this.protocol.setVisible(event.webviewPanel.visible);
      },
      null,
      this._disposables,
    );
    this._panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        const action = dashboardActionCommand(message);
        if (action) {
          void vscode.commands.executeCommand(action.command, ...action.args);
          return;
        }
        void this.protocol.handleMessage(message);
      },
      null,
      this._disposables,
    );
    this._panel.webview.html = this._getWebviewContent(
      options.currentProjectId,
      options.projects,
      options.dailyGoalSeconds,
      options.trackingStatus,
      options.lastUpdatedAt,
      options.fileDetailAvailable,
    );
  }

  public notifyDataChanged(): void {
    this.protocol.notifyDataChanged();
  }

  public updateTrackingStatus(
    status: TrackingStatus,
    lastUpdatedAt: number,
    dailyGoalSeconds: number,
    fileDetailAvailable: boolean,
  ): void {
    void this._panel.webview.postMessage({
      type: "dashboard/tracking-status",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      status,
      lastUpdatedAt,
      dailyGoalSeconds,
      fileDetailAvailable,
    });
  }

  public dispose() {
    ReportPanel.currentPanel = undefined;
    this.protocol.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getWebviewContent(
    currentProjectId: string | null,
    projects: ReadonlyArray<{ id: string; displayName: string }>,
    dailyGoalSeconds: number,
    trackingStatus: TrackingStatus,
    lastUpdatedAt: number,
    fileDetailAvailable: boolean,
  ): string {
    const webview = this._panel.webview;
    const nonce = getNonce();
    const mediaUri = vscode.Uri.joinPath(this._extensionUri, "media");

    return renderDashboardHtml(
      {
        protocolVersion: DASHBOARD_PROTOCOL_VERSION,
        currentProjectId,
        projects,
        dailyGoalSeconds,
        trackingStatus,
        lastUpdatedAt,
        fileDetailAvailable,
      },
      {
        nonce,
        cspSource: webview.cspSource,
        chartScriptUri: webview.asWebviewUri(
          vscode.Uri.joinPath(mediaUri, "chart.min.js"),
        ).toString(),
        webviewScriptUri: webview.asWebviewUri(
          vscode.Uri.joinPath(mediaUri, "webview.js"),
        ).toString(),
        stylesheetUri: webview.asWebviewUri(
          vscode.Uri.joinPath(mediaUri, "webview.css"),
        ).toString(),
      },
    );
  }
}

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";

  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
