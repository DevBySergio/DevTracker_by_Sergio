import * as vscode from "vscode";
import {
  ProjectIdentityRegistry,
  TrackingPrivacyPolicy,
} from "../application/ports";
import { UriIdentityService } from "../identity/UriIdentityService";

export class WorkspaceIdentityRegistrar {
  constructor(
    private readonly identities: UriIdentityService,
    private readonly registry: ProjectIdentityRegistry,
    private readonly privacy?: Pick<TrackingPrivacyPolicy, "isProjectExcluded">,
  ) {}

  public async register(context: vscode.ExtensionContext): Promise<void> {
    await this.registerFolders(vscode.workspace.workspaceFolders ?? []);
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        void this.registerFolders(event.added).catch((error) => {
          console.error("DevTracker workspace identity registration failed:", error);
        });
      }),
    );
  }

  private async registerFolders(
    folders: readonly vscode.WorkspaceFolder[],
  ): Promise<void> {
    for (const folder of folders) {
      if (
        folder.uri.scheme === "file" &&
        this.privacy?.isProjectExcluded(folder.uri.fsPath)
      ) {
        continue;
      }
      const input = {
        scheme: folder.uri.scheme,
        authority: folder.uri.authority,
        path: folder.uri.path,
        fsPath: folder.uri.scheme === "file" ? folder.uri.fsPath : undefined,
      };
      const candidate = this.identities.createProjectIdentity(
        input,
        folder.name,
      );
      const existing = await this.registry.getProjectIdentity(candidate.id);
      await this.registry.upsertProjectIdentity(
        existing
          ? this.identities.createProjectIdentity(input, folder.name, existing)
          : candidate,
      );
    }
  }
}
