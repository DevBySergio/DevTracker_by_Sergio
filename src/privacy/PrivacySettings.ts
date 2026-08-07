export type FileIdentityMode = "relative" | "hashed" | "none";

export interface PrivacySettings {
  readonly projectExclusionGlobs: readonly string[];
  readonly documentExclusionGlobs: readonly string[];
  readonly detailedDataRetentionDays: number;
  readonly fileIdentityMode: FileIdentityMode;
  readonly gitTrackingEnabled: boolean;
  readonly debugTrackingEnabled: boolean;
  readonly taskTrackingEnabled: boolean;
}

export interface PrivacySettingsIssue {
  readonly key: keyof PrivacySettings | "settings";
  readonly message: string;
}

export interface SanitizedPrivacySettings {
  readonly settings: PrivacySettings;
  readonly issues: readonly PrivacySettingsIssue[];
}

export const DEFAULT_DETAILED_DATA_RETENTION_DAYS = 30;
export const MAX_DETAILED_DATA_RETENTION_DAYS = 3650;
export const MAX_EXCLUSION_GLOBS = 256;
export const MAX_GLOB_LENGTH = 512;

export const PRIVACY_CONFIGURATION_KEYS = Object.freeze({
  projectExclusionGlobs: "devtracker.projectExclusionGlobs",
  documentExclusionGlobs: "devtracker.documentExclusionGlobs",
  detailedDataRetentionDays: "devtracker.detailedDataRetentionDays",
  fileIdentityMode: "devtracker.fileIdentityMode",
  gitTrackingEnabled: "devtracker.gitTrackingEnabled",
  debugTrackingEnabled: "devtracker.debugTrackingEnabled",
  taskTrackingEnabled: "devtracker.taskTrackingEnabled",
} as const);

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = Object.freeze({
  projectExclusionGlobs: Object.freeze([]),
  documentExclusionGlobs: Object.freeze([]),
  detailedDataRetentionDays: DEFAULT_DETAILED_DATA_RETENTION_DAYS,
  fileIdentityMode: "relative",
  gitTrackingEnabled: false,
  debugTrackingEnabled: false,
  taskTrackingEnabled: false,
});

type UnknownRecord = Record<string, unknown>;

/** Converts untrusted configuration values into a complete, immutable model. */
export function sanitizePrivacySettings(
  input: unknown,
): SanitizedPrivacySettings {
  const issues: PrivacySettingsIssue[] = [];
  const source = isRecord(input) ? input : {};
  if (!isRecord(input) && input !== undefined) {
    issues.push({
      key: "settings",
      message: "Expected a settings object; defaults were used.",
    });
  }

  const settings: PrivacySettings = Object.freeze({
    projectExclusionGlobs: sanitizeGlobs(
      source.projectExclusionGlobs,
      "projectExclusionGlobs",
      issues,
    ),
    documentExclusionGlobs: sanitizeGlobs(
      source.documentExclusionGlobs,
      "documentExclusionGlobs",
      issues,
    ),
    detailedDataRetentionDays: sanitizeRetentionDays(
      source.detailedDataRetentionDays,
      issues,
    ),
    fileIdentityMode: sanitizeFileIdentityMode(
      source.fileIdentityMode,
      issues,
    ),
    gitTrackingEnabled: sanitizeBoolean(
      source.gitTrackingEnabled,
      "gitTrackingEnabled",
      issues,
    ),
    debugTrackingEnabled: sanitizeBoolean(
      source.debugTrackingEnabled,
      "debugTrackingEnabled",
      issues,
    ),
    taskTrackingEnabled: sanitizeBoolean(
      source.taskTrackingEnabled,
      "taskTrackingEnabled",
      issues,
    ),
  });

  return { settings, issues: Object.freeze(issues) };
}

function sanitizeGlobs(
  value: unknown,
  key: "projectExclusionGlobs" | "documentExclusionGlobs",
  issues: PrivacySettingsIssue[],
): readonly string[] {
  if (value === undefined) {
    return DEFAULT_PRIVACY_SETTINGS[key];
  }
  if (!Array.isArray(value)) {
    issues.push({ key, message: "Expected an array of glob strings." });
    return DEFAULT_PRIVACY_SETTINGS[key];
  }

  const sanitized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_EXCLUSION_GLOBS)) {
    if (typeof candidate !== "string") {
      issues.push({ key, message: "Ignored a non-string glob." });
      continue;
    }
    const glob = candidate.trim().replace(/\\/g, "/");
    if (
      glob.length === 0 ||
      glob.length > MAX_GLOB_LENGTH ||
      glob.includes("\0")
    ) {
      issues.push({ key, message: "Ignored an empty or invalid glob." });
      continue;
    }
    if (!seen.has(glob)) {
      seen.add(glob);
      sanitized.push(glob);
    }
  }
  if (value.length > MAX_EXCLUSION_GLOBS) {
    issues.push({
      key,
      message: `Only the first ${MAX_EXCLUSION_GLOBS} globs were considered.`,
    });
  }
  return Object.freeze(sanitized);
}

function sanitizeRetentionDays(
  value: unknown,
  issues: PrivacySettingsIssue[],
): number {
  if (value === undefined) {
    return DEFAULT_PRIVACY_SETTINGS.detailedDataRetentionDays;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_DETAILED_DATA_RETENTION_DAYS
  ) {
    issues.push({
      key: "detailedDataRetentionDays",
      message: `Expected an integer from 0 to ${MAX_DETAILED_DATA_RETENTION_DAYS}.`,
    });
    return DEFAULT_PRIVACY_SETTINGS.detailedDataRetentionDays;
  }
  return value;
}

function sanitizeFileIdentityMode(
  value: unknown,
  issues: PrivacySettingsIssue[],
): FileIdentityMode {
  if (value === undefined) {
    return DEFAULT_PRIVACY_SETTINGS.fileIdentityMode;
  }
  if (value === "relative" || value === "hashed" || value === "none") {
    return value;
  }
  issues.push({
    key: "fileIdentityMode",
    message: "Expected relative, hashed, or none.",
  });
  return DEFAULT_PRIVACY_SETTINGS.fileIdentityMode;
}

function sanitizeBoolean(
  value: unknown,
  key:
    | "gitTrackingEnabled"
    | "debugTrackingEnabled"
    | "taskTrackingEnabled",
  issues: PrivacySettingsIssue[],
): boolean {
  if (value === undefined) {
    return DEFAULT_PRIVACY_SETTINGS[key];
  }
  if (typeof value === "boolean") {
    return value;
  }
  issues.push({ key, message: "Expected a boolean." });
  return DEFAULT_PRIVACY_SETTINGS[key];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
