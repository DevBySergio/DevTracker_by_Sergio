export interface DashboardProjectSource {
  name: string;
  path: string;
}

export interface DashboardShellProject {
  id: string;
  displayName: string;
}

export interface DashboardShellModel {
  currentProjectId: string | null;
  projects: readonly DashboardShellProject[];
}

/** Builds a stable initial project choice without consulting the active editor. */
export function buildDashboardShellModel(
  source: {
    project?: DashboardProjectSource;
    projects: readonly DashboardProjectSource[];
  },
  resolveProjectId: (projectPath: string) => string | undefined,
): DashboardShellModel {
  const projects = new Map<string, DashboardShellProject>();
  source.projects.forEach((project) => {
    const id = resolveProjectId(project.path);
    if (id && !projects.has(id)) {
      projects.set(id, { id, displayName: project.name });
    }
  });

  const activeProjectId = source.project
    ? resolveProjectId(source.project.path)
    : undefined;
  if (activeProjectId && source.project && !projects.has(activeProjectId)) {
    projects.set(activeProjectId, {
      id: activeProjectId,
      displayName: source.project.name,
    });
  }

  return {
    currentProjectId: activeProjectId ?? projects.keys().next().value ?? null,
    projects: Object.freeze([...projects.values()]),
  };
}
