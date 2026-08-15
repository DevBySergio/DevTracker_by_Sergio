export type DashboardShellView = "today" | "project" | "quality" | "global";
export type DashboardShellRange =
  | "7-days"
  | "30-days"
  | "90-days"
  | "year"
  | "custom";

export interface DashboardShellState {
  view: DashboardShellView;
  range: DashboardShellRange;
  projectId: string | null;
  customStartLocalDate: string | null;
  customEndLocalDate: string | null;
}

export function restoreDashboardState(
  value: unknown,
  fallbackProjectId: string | null,
  availableProjectIds: readonly string[],
): DashboardShellState {
  const record = isRecord(value) ? value : {};
  const view = isView(record.view) ? record.view : "today";
  const requestedRange = normalizeRange(record.range);
  const customStartLocalDate = safeLocalDate(record.customStartLocalDate);
  const customEndLocalDate = safeLocalDate(record.customEndLocalDate);
  const range = requestedRange === "custom" &&
      (!customStartLocalDate || !customEndLocalDate ||
        customStartLocalDate > customEndLocalDate)
    ? "7-days"
    : requestedRange;
  const available = new Set(availableProjectIds);
  const restoredProjectId = safeProjectId(record.projectId);
  const projectId = restoredProjectId &&
      (available.size === 0 || available.has(restoredProjectId))
    ? restoredProjectId
    : fallbackProjectId;
  return {
    view,
    range,
    projectId,
    customStartLocalDate,
    customEndLocalDate,
  };
}

function isView(value: unknown): value is DashboardShellView {
  return value === "today" || value === "project" ||
    value === "quality" || value === "global";
}

function normalizeRange(value: unknown): DashboardShellRange {
  if (value === "week") {
    return "7-days";
  }
  if (value === "month") {
    return "30-days";
  }
  if (value === "all") {
    return "90-days";
  }
  return value === "7-days" || value === "30-days" ||
      value === "90-days" || value === "year" || value === "custom"
    ? value
    : "7-days";
}

function safeProjectId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

function safeLocalDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
