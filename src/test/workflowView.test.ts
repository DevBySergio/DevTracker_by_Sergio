import * as assert from "assert";
import {
  RangeAggregateMetrics,
  RangePeriodViewModel,
} from "../domain/rangeQuery";
import { buildWorkflowViewModel } from "../webview/workflowModel";

suite("WorkflowView", () => {
  test("presents descriptive diagnostics, edits, saves, and available integrations", () => {
    const period = createPeriod();
    period.metrics.activeTimeMs = 3_600_000;
    period.metrics.insertedCharacters = 120;
    period.metrics.removedCharacters = 30;
    period.metrics.saveEvents = 6;
    period.metrics.diagnostics = {
      current: severity(2, 3, 1, 0),
      introduced: severity(4, 1, 0, 0),
      resolved: severity(2, 2, 0, 1),
      peak: severity(5, 4, 2, 1),
    };
    period.metrics.gitStatus = "available";
    period.metrics.gitDirtyFiles = 2;
    period.metrics.gitBranchChanges = 1;
    period.metrics.gitDetectedCommits = 3;
    period.metrics.debugElapsedMs = 90_000;
    period.metrics.debugActiveTimeMs = 45_000;
    period.branches = [{ id: "feature/workflow", activeTimeMs: 600_000 }];
    period.tasks = [{
      configuredName: "test",
      classification: "test",
      runCount: 2,
      completedRunCount: 2,
      succeededRunCount: 1,
      failedRunCount: 1,
      cancelledRunCount: 0,
      unknownRunCount: 0,
      successRatePercent: 50,
      medianDurationMs: 2_000,
    }];

    const workflow = buildWorkflowViewModel(period, {
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      configuredTaskCount: 1,
    });

    assert.deepStrictEqual(workflow.diagnostics.totals, {
      current: 6,
      introduced: 5,
      resolved: 5,
      peak: 12,
    });
    assert.strictEqual(workflow.editVolume, 150);
    assert.strictEqual(workflow.saveEvents, 6);
    assert.strictEqual(workflow.savesPerActiveHour, 6);
    assert.strictEqual(workflow.git.state, "available");
    assert.strictEqual(workflow.debug.state, "available");
    assert.strictEqual(workflow.tasks.state, "available");
  });

  test("distinguishes disabled, unavailable, setup-required, and no-data states", () => {
    const period = createPeriod();

    const disabled = buildWorkflowViewModel(period, {
      gitTrackingEnabled: false,
      debugTrackingEnabled: false,
      taskTrackingEnabled: false,
      configuredTaskCount: 0,
    });
    assert.strictEqual(disabled.git.state, "disabled");
    assert.strictEqual(disabled.debug.state, "disabled");
    assert.strictEqual(disabled.tasks.state, "disabled");
    assert.strictEqual(disabled.savesPerActiveHour, null);

    period.metrics.gitStatus = "unavailable";
    const enabled = buildWorkflowViewModel(period, {
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      configuredTaskCount: 0,
    });
    assert.strictEqual(enabled.git.state, "unavailable");
    assert.strictEqual(enabled.debug.state, "no-data");
    assert.strictEqual(enabled.tasks.state, "setup-required");

    const noProject = buildWorkflowViewModel(period, {
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      configuredTaskCount: 1,
    }, false);
    assert.strictEqual(noProject.git.state, "unavailable");
    assert.strictEqual(noProject.debug.state, "unavailable");
    assert.strictEqual(noProject.tasks.state, "unavailable");

    period.metrics.gitStatus = "no-repository";
    const noRepository = buildWorkflowViewModel(period, {
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      configuredTaskCount: 1,
    });
    assert.strictEqual(noRepository.git.state, "no-repository");
    assert.strictEqual(noRepository.tasks.state, "no-data");
  });

  function createPeriod(): RangePeriodViewModel {
    return {
      range: {
        startLocalDate: "2026-08-11",
        endLocalDate: "2026-08-17",
        localDates: ["2026-08-11", "2026-08-17"],
        complete: false,
      },
      metrics: metrics(),
      days: [],
      projects: [],
      languages: [],
      files: [],
      branches: [],
      tasks: [],
      quarterHours: [],
    };
  }

  function metrics(): RangeAggregateMetrics {
    return {
      activeTimeMs: 0,
      debugElapsedMs: 0,
      debugActiveTimeMs: 0,
      editEvents: 0,
      insertedCharacters: 0,
      removedCharacters: 0,
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
        current: severity(),
        introduced: severity(),
        resolved: severity(),
        peak: severity(),
      },
      legacyApproximate: false,
    };
  }

  function severity(error = 0, warning = 0, info = 0, hint = 0) {
    return { error, warning, info, hint };
  }
});
