export type DashboardShellView = "today" | "project" | "quality" | "global";
export type DashboardShellRange = "today" | "week" | "month" | "all";

export interface DashboardShellState {
  view: DashboardShellView;
  range: DashboardShellRange;
  projectId: string | null;
}

export function restoreDashboardState(
  value: unknown,
  fallbackProjectId: string | null,
  availableProjectIds: readonly string[],
): DashboardShellState {
  const record = isRecord(value) ? value : {};
  const view = isView(record.view) ? record.view : "today";
  const range = isRange(record.range) ? record.range : "week";
  const available = new Set(availableProjectIds);
  const restoredProjectId = safeProjectId(record.projectId);
  const projectId = restoredProjectId &&
      (available.size === 0 || available.has(restoredProjectId))
    ? restoredProjectId
    : fallbackProjectId;
  return { view, range, projectId };
}

function isView(value: unknown): value is DashboardShellView {
  return value === "today" || value === "project" ||
    value === "quality" || value === "global";
}

function isRange(value: unknown): value is DashboardShellRange {
  return value === "today" || value === "week" ||
    value === "month" || value === "all";
}

function safeProjectId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
