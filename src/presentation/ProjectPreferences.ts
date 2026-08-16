import {
  ProjectPreference,
  ProjectPreferences,
  normalizeProjectPreference,
} from "../webview/projectsModel";

const STORAGE_KEY = "devtracker.projectPreferences.v1";
const MAX_ALIAS_LENGTH = 80;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface ProjectPreferenceStorage {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SetProjectPreferenceMessage {
  type: "dashboard/set-project-preference";
  protocolVersion: number;
  projectId: string;
  preference: ProjectPreference;
}

export class ProjectPreferencesStore {
  constructor(private readonly storage: ProjectPreferenceStorage) {}

  public getAll(): ProjectPreferences {
    const candidate = this.storage.get<unknown>(STORAGE_KEY, {});
    if (!isRecord(candidate)) {
      return {};
    }
    const result: Record<string, ProjectPreference> = {};
    Object.entries(candidate).forEach(([projectId, value]) => {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isRecord(value)) {
        return;
      }
      result[projectId] = normalizeProjectPreference({
        alias: validStoredAlias(value.alias),
        archived: value.archived === true,
        excluded: value.excluded === true,
      });
    });
    return result;
  }

  public async set(
    projectId: string,
    preference: ProjectPreference,
  ): Promise<ProjectPreferences> {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new Error("Invalid project preference id");
    }
    const current = { ...this.getAll() };
    const normalized = normalizeProjectPreference(preference);
    if (
      normalized.alias === null &&
      !normalized.archived &&
      !normalized.excluded
    ) {
      delete current[projectId];
    } else {
      current[projectId] = normalized;
    }
    await this.storage.update(STORAGE_KEY, current);
    return current;
  }
}

export function parseSetProjectPreferenceMessage(
  value: unknown,
  protocolVersion: number,
): SetProjectPreferenceMessage | null {
  if (!isRecord(value) || value.type !== "dashboard/set-project-preference") {
    return null;
  }
  if (!hasExactKeys(value, ["type", "protocolVersion", "projectId", "preference"])) {
    return null;
  }
  if (
    value.protocolVersion !== protocolVersion ||
    typeof value.projectId !== "string" ||
    !PROJECT_ID_PATTERN.test(value.projectId) ||
    !isRecord(value.preference) ||
    !hasExactKeys(value.preference, ["alias", "archived", "excluded"]) ||
    !validAlias(value.preference.alias) ||
    typeof value.preference.archived !== "boolean" ||
    typeof value.preference.excluded !== "boolean"
  ) {
    return null;
  }
  return {
    type: "dashboard/set-project-preference",
    protocolVersion,
    projectId: value.projectId,
    preference: normalizeProjectPreference({
      alias: value.preference.alias,
      archived: value.preference.archived,
      excluded: value.preference.excluded,
    }),
  };
}

function validAlias(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && value.length <= MAX_ALIAS_LENGTH);
}

function validStoredAlias(value: unknown): string | null {
  return validAlias(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    expected.slice().sort().every((key, index) => key === keys[index]);
}
