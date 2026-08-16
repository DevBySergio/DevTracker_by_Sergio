import * as assert from "assert";
import {
  RangeAggregateMetrics,
  RangePeriodViewModel,
  RangeProjectViewModel,
} from "../domain/rangeQuery";
import { buildProjectsViewModel } from "../webview/projectsModel";

suite("ProjectsView", () => {
  test("searches aliases, distinguishes duplicate names, sorts, and retains managed projects", () => {
    const period = createPeriod([
      project("project-alpha-0001", "Workspace", 3_000, "2026-08-17", 20),
      project("project-beta-0002", "Workspace", 8_000, "2026-08-16", -10),
      project("project-gamma-0003", "Gamma", 5_000, null, null),
    ]);
    const preferences = {
      "project-alpha-0001": {
        alias: "Client Portal",
        archived: false,
        excluded: false,
      },
      "project-beta-0002": {
        alias: null,
        archived: true,
        excluded: false,
      },
    };

    const active = buildProjectsViewModel(period, preferences, {
      search: "",
      sort: "activity",
      showManaged: false,
    });
    assert.deepStrictEqual(
      active.visibleProjects.map(({ id }) => id),
      ["project-gamma-0003", "project-alpha-0001"],
    );
    assert.strictEqual(active.managedProjectCount, 1);
    assert.strictEqual(active.projects[0].displayName, "Client Portal");
    assert.ok(active.projects[0].discriminator.length > 0);
    assert.ok(active.projects[1].discriminator.length > 0);

    const searched = buildProjectsViewModel(period, preferences, {
      search: "client portal",
      sort: "name",
      showManaged: true,
    });
    assert.deepStrictEqual(
      searched.visibleProjects.map(({ id }) => id),
      ["project-alpha-0001"],
    );
  });

  function createPeriod(projects: RangeProjectViewModel[]): RangePeriodViewModel {
    return {
      range: {
        startLocalDate: "2026-08-11",
        endLocalDate: "2026-08-17",
        localDates: ["2026-08-11", "2026-08-17"],
        complete: false,
      },
      metrics: metrics(16_000),
      days: [],
      projects,
      languages: [],
      files: [],
      branches: [],
      tasks: [],
      quarterHours: [],
    };
  }

  function project(
    id: string,
    displayName: string,
    activeTimeMs: number,
    lastActiveLocalDate: string | null,
    activityTrendPercent: number | null,
  ): RangeProjectViewModel {
    return {
      project: { id, displayName },
      metrics: metrics(activeTimeMs),
      lastActiveLocalDate,
      activityTrendPercent,
      languages: [{ id: "typescript", activeTimeMs }],
      files: [{ id: "src/index.ts", activeTimeMs }],
      branches: [],
      tasks: [],
    };
  }

  function metrics(activeTimeMs: number): RangeAggregateMetrics {
    const severity = { error: 0, warning: 0, info: 0, hint: 0 };
    return {
      activeTimeMs,
      debugElapsedMs: 0,
      debugActiveTimeMs: 0,
      editEvents: 1,
      insertedCharacters: 10,
      removedCharacters: 2,
      largeEditEvents: 0,
      insertedLineBreaksApprox: 0,
      removedLineBreaksApprox: 0,
      saveEvents: 0,
      fileSwitchEvents: 0,
      projectSwitchEvents: 0,
      flowBlockCount: 0,
      flowActiveMs: 0,
      longestFlowActiveMs: 0,
      gitStatus: "disabled",
      gitDirtyFiles: 0,
      gitBranchChanges: 0,
      gitDetectedCommits: 0,
      diagnostics: {
        current: { ...severity },
        introduced: { ...severity },
        resolved: { ...severity },
        peak: { ...severity },
      },
      legacyApproximate: false,
    };
  }
});
