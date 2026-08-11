export type DashboardActionName =
  | "export"
  | "settings"
  | "open-data"
  | "reset";

export interface DashboardActionCommand {
  command: string;
  args: readonly unknown[];
}

const ACTION_COMMANDS: Readonly<Record<DashboardActionName, DashboardActionCommand>> =
  Object.freeze({
    export: { command: "devtracker.exportJson", args: Object.freeze([]) },
    settings: {
      command: "workbench.action.openSettings",
      args: Object.freeze(["@ext:DevBySergio.DevTrackerBySergio"]),
    },
    "open-data": {
      command: "devtracker.openDataFolder",
      args: Object.freeze([]),
    },
    reset: { command: "devtracker.resetData", args: Object.freeze([]) },
  });

/** Maps the webview's fixed action vocabulary to an extension-host command. */
export function dashboardActionCommand(
  value: unknown,
): DashboardActionCommand | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return null;
  }
  if (value.type !== "dashboard/action" || typeof value.action !== "string") {
    return null;
  }
  if (!isDashboardActionName(value.action)) {
    return null;
  }
  return ACTION_COMMANDS[value.action];
}

function isDashboardActionName(value: string): value is DashboardActionName {
  return Object.prototype.hasOwnProperty.call(ACTION_COMMANDS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
