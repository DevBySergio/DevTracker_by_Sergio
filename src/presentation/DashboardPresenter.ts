import * as vscode from "vscode";
import {
  DashboardPresentation,
  DashboardSnapshot,
  RangeAnalyticsQueryService,
} from "../application/ports";
import { Clock } from "../platform/ports";
import { ReportPanel } from "../ReportPanel";
import { buildDashboardShellModel } from "./DashboardShellModel";
import { ProjectPreferencesStore } from "./ProjectPreferences";

const DEFAULT_DAILY_GOAL_SECONDS = 14400;

export interface DashboardPresenterOptions {
  extensionUri: vscode.Uri;
  rangeQueries: RangeAnalyticsQueryService;
  clock: Clock;
  projectPreferences: ProjectPreferencesStore;
  resolveProjectId(projectPath: string): string | undefined;
  fileDetailAvailable(): boolean;
}

export class DashboardPresenter implements DashboardPresentation {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(private readonly options: DashboardPresenterOptions) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = "devtracker.showStats";
  }

  public update(snapshot: DashboardSnapshot): void {
    const sessionSeconds = snapshot.session.seconds;
    const formatted = this.formatClock(sessionSeconds);
    const goalSeconds =
      snapshot.dailyGoalSeconds > 0
        ? snapshot.dailyGoalSeconds
        : DEFAULT_DAILY_GOAL_SECONDS;
    const progressPercent = Math.min(
      100,
      Math.floor((snapshot.todayTotalSeconds / goalSeconds) * 100),
    );
    const tracking = this.formatTrackingStatus(snapshot.trackingStatus);

    this.statusBarItem.text = `${tracking.icon} ${formatted} · ${tracking.label}`;
    const persistence = this.formatPersistence(snapshot);
    const lastUpdate = new Date(snapshot.lastUpdatedAt).toLocaleString();
    const switchRate =
      snapshot.fileSwitchesPerActiveHour === null
        ? "unavailable (no active time)"
        : `${snapshot.fileSwitchesPerActiveHour.toFixed(1)}/active hour`;
    const currentFlow = this.formatClock(
      snapshot.session.currentFlowActiveMs / 1000,
    );
    this.statusBarItem.tooltip = `Tracking: ${tracking.label}\nLast update: ${lastUpdate}\nCurrent session: ${formatted}\nCurrent flow: ${currentFlow}\nFile switches: ${snapshot.session.fileSwitchEvents}\nProject switches: ${snapshot.session.projectSwitchEvents}\nFile switches per active hour: ${switchRate}\nTotal today: ${Math.floor(snapshot.todayTotalSeconds / 60)} min\nDaily goal: ${progressPercent}%\nPersistence: ${persistence}`;
    this.statusBarItem.show();

    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel.updateTrackingStatus(
        snapshot.trackingStatus,
        snapshot.lastUpdatedAt,
        snapshot.dailyGoalSeconds > 0
          ? snapshot.dailyGoalSeconds
          : DEFAULT_DAILY_GOAL_SECONDS,
        this.options.fileDetailAvailable(),
      );
      ReportPanel.currentPanel.notifyDataChanged();
    }
  }

  public open(snapshot: DashboardSnapshot): void {
    const shell = buildDashboardShellModel(
      snapshot,
      this.options.resolveProjectId,
    );

    ReportPanel.createOrShow({
      extensionUri: this.options.extensionUri,
      queryService: this.options.rangeQueries,
      clock: this.options.clock,
      currentProjectId: shell.currentProjectId,
      projects: shell.projects,
      dailyGoalSeconds: snapshot.dailyGoalSeconds > 0
        ? snapshot.dailyGoalSeconds
        : DEFAULT_DAILY_GOAL_SECONDS,
      trackingStatus: snapshot.trackingStatus,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      fileDetailAvailable: this.options.fileDetailAvailable(),
      projectPreferences: this.options.projectPreferences,
    });
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }

  private formatClock(seconds: number): string {
    const wholeSeconds = Math.floor(seconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  private formatPersistence(snapshot: DashboardSnapshot): string {
    const { status, pendingWrites } = snapshot.persistence;
    if (status === "failed") {
      return `failed (${pendingWrites} pending)`;
    }
    if (pendingWrites > 0) {
      return `${status} (${pendingWrites} pending)`;
    }
    return status;
  }

  private formatTrackingStatus(status: DashboardSnapshot["trackingStatus"]): {
    icon: string;
    label: string;
  } {
    switch (status) {
      case "active":
        return { icon: "$(record)", label: "Tracking" };
      case "paused":
        return { icon: "$(debug-pause)", label: "Paused" };
      case "unfocused":
        return { icon: "$(circle-slash)", label: "Unfocused" };
      case "inactive":
        return { icon: "$(watch)", label: "Inactive" };
    }
  }
}
