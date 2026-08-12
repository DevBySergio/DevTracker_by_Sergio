import {
  DailyRollup,
  ProjectIdentity,
  SCHEMA_VERSION,
  createEmptyDailyRollup,
} from "../domain/schemaV2";

export const LARGE_HISTORY_START = "2023-01-01";
export const LARGE_HISTORY_END = "2025-12-31";
export const LARGE_HISTORY_DAY_COUNT = 1_096;
export const LARGE_HISTORY_PROJECT_COUNT = 50;
export const LARGE_HISTORY_ROLLUP_COUNT =
  LARGE_HISTORY_DAY_COUNT * LARGE_HISTORY_PROJECT_COUNT;

export interface LargeHistoryFixture {
  projects: ProjectIdentity[];
  rollups: DailyRollup[];
}

/**
 * Deterministic three-year history used by the performance regression suite.
 * Every project has one rollup per calendar day, with a deterministic weekday
 * activity pattern. That keeps storage and query cardinality at the full
 * 54,800 records while making protocol payload measurements representative of
 * a sustained working history rather than random input.
 */
export function createLargeHistoryFixture(): LargeHistoryFixture {
  const projects = Array.from(
    { length: LARGE_HISTORY_PROJECT_COUNT },
    (_value, index) => createProject(index),
  );
  const rollups: DailyRollup[] = [];

  forEachLocalDate(LARGE_HISTORY_START, LARGE_HISTORY_END, (localDate) => {
    projects.forEach((project, projectIndex) => {
      rollups.push(createRollup(project.id, projectIndex, localDate));
    });
  });

  return { projects, rollups };
}

function createProject(index: number): ProjectIdentity {
  const suffix = String(index + 1).padStart(2, "0");
  const timestamp = new Date(2023, 0, 1, 12, 0, 0).getTime();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `project-${suffix}`,
    canonicalUri: `file:///fixture/project-${suffix}`,
    displayName: `Project ${suffix}`,
    scheme: "file",
    authority: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createRollup(
  projectId: string,
  projectIndex: number,
  localDate: string,
): DailyRollup {
  const [year, month, day] = localDate.split("-").map(Number);
  const updatedAt = new Date(year, month - 1, day, 12, 0, 0).getTime();
  const bucketKey = String(
    new Date(year, month - 1, day, 9, 0, 0).getTime(),
  );
  const weekday = new Date(year, month - 1, day).getDay();
  const hasActivity = weekday >= 1 && weekday <= 5;
  const activeTimeMs = (projectIndex % 5 + 1) * 60_000;
  const languageId = ["typescript", "javascript", "json", "markdown"]
    [projectIndex % 4];
  const documentId = `src/project-${String(projectIndex + 1).padStart(2, "0")}.ts`;
  const rollup = createEmptyDailyRollup(projectId, localDate, updatedAt);

  if (!hasActivity) {
    return rollup;
  }

  rollup.activeTimeMs = activeTimeMs;
  rollup.editEvents = projectIndex % 7 + 1;
  rollup.insertedCharacters = projectIndex % 11 + 1;
  rollup.removedCharacters = projectIndex % 3;
  rollup.saveEvents = 1;
  rollup.activeTimeByLanguageMs = { [languageId]: activeTimeMs };
  rollup.activeTimeByDocumentMs = { [documentId]: activeTimeMs };
  rollup.activeTimeByQuarterHourMs = { [bucketKey]: activeTimeMs };
  return rollup;
}

function forEachLocalDate(
  start: string,
  end: string,
  visit: (localDate: string) => void,
): void {
  let current = parseUtcDate(start);
  const finalDate = parseUtcDate(end);
  while (current.getTime() <= finalDate.getTime()) {
    visit(formatUtcDate(current));
    current = new Date(
      Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth(),
        current.getUTCDate() + 1,
      ),
    );
  }
}

function parseUtcDate(localDate: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
