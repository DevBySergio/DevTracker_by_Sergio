import {
  DashboardQueryService,
  DashboardSnapshot,
  TrackingReader,
} from "../application/ports";

export class DevTrackerQueries implements DashboardQueryService {
  constructor(private readonly store: TrackingReader) {}

  public getSnapshot(projectPath?: string): DashboardSnapshot {
    const session = this.store.getSessionState();
    return {
      session,
      project: projectPath
        ? this.store.getProjectData(projectPath)
        : undefined,
      projects: this.store.getAllProjects(),
      dailyGoalSeconds: this.store.getDailyGoal(),
      weeklyGoalSeconds: this.store.getWeeklyGoal(),
      todayTotalSeconds: this.store.getTodayTotalSeconds(),
      persistence: this.store.getPersistenceHealth(),
      trackingStatus: session.trackingStatus,
      lastUpdatedAt: session.lastUpdatedAt,
      fileSwitchesPerActiveHour: calculateSwitchesPerActiveHour(
        session.fileSwitchEvents,
        session.seconds * 1000,
      ),
    };
  }
}

export function calculateSwitchesPerActiveHour(
  fileSwitchEvents: number,
  activeTimeMs: number,
): number | null {
  if (activeTimeMs <= 0) {
    return null;
  }
  return fileSwitchEvents / (activeTimeMs / 3_600_000);
}
