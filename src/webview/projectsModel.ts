import {
  RangeDimensionValue,
  RangePeriodViewModel,
  RangeProjectViewModel,
} from "../domain/rangeQuery";

export interface ProjectPreference {
  alias: string | null;
  archived: boolean;
  excluded: boolean;
}

export type ProjectPreferences = Readonly<Record<string, ProjectPreference>>;
export type ProjectSort = "activity" | "name" | "recent" | "trend";

export interface ProjectsViewOptions {
  search: string;
  sort: ProjectSort;
  showManaged: boolean;
}

export interface ProjectListItem {
  id: string;
  canonicalName: string;
  displayName: string;
  discriminator: string;
  activeTimeMs: number;
  activityTrendPercent: number | null;
  lastActiveLocalDate: string | null;
  editVolume: number;
  languages: readonly RangeDimensionValue[];
  files: readonly RangeDimensionValue[];
  preference: ProjectPreference;
}

export interface ProjectsViewModel {
  projects: readonly ProjectListItem[];
  visibleProjects: readonly ProjectListItem[];
  activeProjectCount: number;
  managedProjectCount: number;
}

const DEFAULT_PREFERENCE: ProjectPreference = Object.freeze({
  alias: null,
  archived: false,
  excluded: false,
});

export function buildProjectsViewModel(
  period: RangePeriodViewModel,
  preferences: ProjectPreferences,
  options: ProjectsViewOptions,
): ProjectsViewModel {
  const duplicateNames = duplicateNameCounts(period.projects);
  const projects = period.projects.map((project) =>
    projectItem(project, preferences[project.project.id], duplicateNames),
  );
  const query = options.search.trim().toLocaleLowerCase();
  const visibleProjects = projects
    .filter((project) =>
      (options.showManaged ||
        (!project.preference.archived && !project.preference.excluded)) &&
      (query.length === 0 || searchableText(project).includes(query)),
    )
    .sort(projectComparator(options.sort));
  return Object.freeze({
    projects: Object.freeze(projects),
    visibleProjects: Object.freeze(visibleProjects),
    activeProjectCount: projects.filter(
      (project) =>
        project.activeTimeMs > 0 &&
        !project.preference.archived &&
        !project.preference.excluded,
    ).length,
    managedProjectCount: projects.filter(
      (project) => project.preference.archived || project.preference.excluded,
    ).length,
  });
}

export function normalizeProjectPreference(
  value: Partial<ProjectPreference> | undefined,
): ProjectPreference {
  const alias = typeof value?.alias === "string" && value.alias.trim().length > 0
    ? value.alias.trim()
    : null;
  return Object.freeze({
    alias,
    archived: value?.archived === true,
    excluded: value?.excluded === true,
  });
}

function projectItem(
  source: RangeProjectViewModel,
  preferenceValue: ProjectPreference | undefined,
  duplicateNames: ReadonlyMap<string, number>,
): ProjectListItem {
  const preference = normalizeProjectPreference(preferenceValue);
  const canonicalName = source.project.displayName;
  const duplicate = (duplicateNames.get(canonicalName.toLocaleLowerCase()) ?? 0) > 1;
  return Object.freeze({
    id: source.project.id,
    canonicalName,
    displayName: preference.alias ?? canonicalName,
    discriminator: duplicate || preference.alias !== null
      ? shortProjectId(source.project.id)
      : "",
    activeTimeMs: source.metrics.activeTimeMs,
    activityTrendPercent: source.activityTrendPercent ?? null,
    lastActiveLocalDate: source.lastActiveLocalDate ?? null,
    editVolume:
      source.metrics.insertedCharacters + source.metrics.removedCharacters,
    languages: Object.freeze(source.languages.slice(0, 5)),
    files: Object.freeze(source.files.slice(0, 8)),
    preference,
  });
}

function duplicateNameCounts(
  projects: readonly RangeProjectViewModel[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  projects.forEach(({ project }) => {
    const key = project.displayName.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

function searchableText(project: ProjectListItem): string {
  return `${project.displayName}\0${project.canonicalName}\0${project.id}`
    .toLocaleLowerCase();
}

function projectComparator(sort: ProjectSort) {
  return (left: ProjectListItem, right: ProjectListItem): number => {
    if (sort === "activity") {
      return right.activeTimeMs - left.activeTimeMs || compareNames(left, right);
    }
    if (sort === "recent") {
      return (right.lastActiveLocalDate ?? "").localeCompare(
        left.lastActiveLocalDate ?? "",
      ) || compareNames(left, right);
    }
    if (sort === "trend") {
      return (right.activityTrendPercent ?? Number.NEGATIVE_INFINITY) -
        (left.activityTrendPercent ?? Number.NEGATIVE_INFINITY) ||
        compareNames(left, right);
    }
    return compareNames(left, right);
  };
}

function compareNames(left: ProjectListItem, right: ProjectListItem): number {
  return left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id);
}

function shortProjectId(projectId: string): string {
  return projectId.length <= 8
    ? projectId
    : `${projectId.slice(0, 4)}…${projectId.slice(-4)}`;
}
