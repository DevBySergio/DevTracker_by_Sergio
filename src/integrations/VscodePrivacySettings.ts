import { randomBytes } from "crypto";
import * as vscode from "vscode";
import {
  TrackingDocumentPrivacyDecision,
  TrackingPrivacyPolicy,
} from "../application/ports";
import {
  PrivacyPolicy,
  PrivacySettings,
  sanitizePrivacySettings,
} from "../privacy";

const HASH_SALT_SECRET_KEY = "devtracker.fileIdentityHashSalt";

export class VscodePrivacySettings implements TrackingPrivacyPolicy {
  private settings: PrivacySettings;
  private policy: PrivacyPolicy;

  private constructor(private readonly hashSalt: string) {
    this.settings = sanitizePrivacySettings(undefined).settings;
    this.policy = new PrivacyPolicy({
      settings: this.settings,
      hashSalt: this.hashSalt,
    });
    this.reload();
  }

  public static async create(
    secrets: vscode.SecretStorage,
  ): Promise<VscodePrivacySettings> {
    let hashSalt = await secrets.get(HASH_SALT_SECRET_KEY);
    if (!hashSalt) {
      hashSalt = randomBytes(32).toString("hex");
      await secrets.store(HASH_SALT_SECRET_KEY, hashSalt);
    }
    return new VscodePrivacySettings(hashSalt);
  }

  public reload(): void {
    const configuration = vscode.workspace.getConfiguration("devtracker");
    const sanitized = sanitizePrivacySettings({
      projectExclusionGlobs: configuration.get("projectExclusionGlobs"),
      documentExclusionGlobs: configuration.get("documentExclusionGlobs"),
      detailedDataRetentionDays: configuration.get(
        "detailedDataRetentionDays",
      ),
      fileIdentityMode: configuration.get("fileIdentityMode"),
      gitTrackingEnabled: configuration.get("gitTrackingEnabled"),
      debugTrackingEnabled: configuration.get("debugTrackingEnabled"),
      taskTrackingEnabled: configuration.get("taskTrackingEnabled"),
    });
    this.settings = sanitized.settings;
    this.policy = new PrivacyPolicy({
      settings: this.settings,
      hashSalt: this.hashSalt,
    });
    sanitized.issues.forEach((issue) => {
      console.warn(`DevTracker ignored invalid ${issue.key}: ${issue.message}`);
    });
  }

  public evaluateDocument(
    projectPath: string,
    documentPath: string,
  ): TrackingDocumentPrivacyDecision {
    return this.policy.evaluateDocument(projectPath, documentPath);
  }

  public isProjectExcluded(projectPath: string): boolean {
    return this.policy.isProjectExcluded(projectPath);
  }

  public isGitTrackingEnabled(): boolean {
    return this.settings.gitTrackingEnabled;
  }

  public isDebugTrackingEnabled(): boolean {
    return this.settings.debugTrackingEnabled;
  }

  public isTaskTrackingEnabled(): boolean {
    return this.settings.taskTrackingEnabled;
  }

  public isFileDetailAvailable(): boolean {
    return this.settings.fileIdentityMode !== "none";
  }

  public getDetailedDataRetentionDays(): number {
    return this.settings.detailedDataRetentionDays;
  }
}
