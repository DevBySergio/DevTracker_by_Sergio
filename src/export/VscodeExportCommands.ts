import * as vscode from "vscode";
import { ExportScope, ExportService } from "./ExportService";

interface ExportChoice extends vscode.QuickPickItem {
  scope: ExportScope;
}

const EXPORT_CHOICES: readonly ExportChoice[] = [
  choice("Today", "The current local calendar day", {
    kind: "selected-range",
    request: { preset: "today" },
  }),
  choice("Last 7 Days", "Rolling local-day range", {
    kind: "selected-range",
    request: { preset: "7-days" },
  }),
  choice("Last 30 Days", "Rolling local-day range", {
    kind: "selected-range",
    request: { preset: "30-days" },
  }),
  choice("Last 90 Days", "Rolling local-day range", {
    kind: "selected-range",
    request: { preset: "90-days" },
  }),
  choice("Current Year", "From January 1 through today", {
    kind: "selected-range",
    request: { preset: "year" },
  }),
  choice("Complete History", "Every retained daily rollup", {
    kind: "complete-history",
  }),
];

export class VscodeExportCommands {
  public constructor(private readonly service: ExportService) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("devtracker.exportJson", () =>
        this.run("json"),
      ),
      vscode.commands.registerCommand("devtracker.exportDailyCsv", () =>
        this.run("csv"),
      ),
      // Public compatibility alias retained for existing keybindings/scripts.
      vscode.commands.registerCommand("devtracker.exportCSV", () =>
        this.run("csv"),
      ),
    );
  }

  private async run(format: "json" | "csv"): Promise<void> {
    const selected = await vscode.window.showQuickPick(EXPORT_CHOICES, {
      title: `DevTracker: Export ${format.toUpperCase()}`,
      placeHolder: "Choose the retained date range to export",
      ignoreFocusOut: true,
    });
    if (!selected) {
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : { CSV: ["csv"] },
      saveLabel: `Export DevTracker ${format.toUpperCase()}`,
    });
    if (!uri) {
      return;
    }

    try {
      const content = format === "json"
        ? await this.service.exportJson(selected.scope)
        : await this.service.exportDailySummaryCsv(selected.scope);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      void vscode.window.showInformationMessage(
        `DevTracker ${format.toUpperCase()} export saved.`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `DevTracker export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function choice(
  label: string,
  description: string,
  scope: ExportScope,
): ExportChoice {
  return { label, description, scope };
}
