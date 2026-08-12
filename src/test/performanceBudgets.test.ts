import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { performance } from "perf_hooks";
import { RangeQueryRequest, RangeQueryViewModel } from "../domain/rangeQuery";
import { Clock } from "../platform/ports";
import {
  DASHBOARD_PROTOCOL_VERSION,
  DashboardLiveDeltaMessage,
  DashboardSnapshotMessage,
  MAX_DELTA_MESSAGE_BYTES,
  MAX_INITIAL_MESSAGE_BYTES,
  createRangeViewModelDelta,
  measureDashboardMessageBytes,
  projectDashboardViewModel,
} from "../presentation/DashboardProtocol";
import { RangeQueryEngine } from "../queries/RangeQueryEngine";
import {
  LARGE_HISTORY_DAY_COUNT,
  LARGE_HISTORY_END,
  LARGE_HISTORY_PROJECT_COUNT,
  LARGE_HISTORY_ROLLUP_COUNT,
  LARGE_HISTORY_START,
  LargeHistoryFixture,
  createLargeHistoryFixture,
} from "./largeHistoryFixture";

const ELAPSED_BUDGET_MS = {
  activation: 5_000,
  sevenDays: 1_000,
  thirtyDays: 1_500,
  ninetyDays: 2_500,
  allTime: 8_000,
} as const;

interface Measurement {
  name: string;
  elapsedMs: number;
  recordLookups: number;
}

suite("large-history performance budgets", function () {
  this.timeout(60_000);

  const now = new Date(2025, 11, 31, 12, 0, 0);
  const clock: Clock = { now: () => now, nowMs: () => now.getTime() };
  let fixture: LargeHistoryFixture;
  let engine: RangeQueryEngine;
  let activationElapsedMs = 0;
  const measurements: Measurement[] = [];
  const results = new Map<string, RangeQueryViewModel>();

  suiteSetup(() => {
    fixture = createLargeHistoryFixture();
    const startedAt = performance.now();
    engine = new RangeQueryEngine(clock);
    engine.setProjectIdentities(fixture.projects);
    engine.applyDelta({ upsert: fixture.rollups });
    activationElapsedMs = performance.now() - startedAt;
  });

  test("generates the complete deterministic fixture", () => {
    assert.strictEqual(fixture.projects.length, LARGE_HISTORY_PROJECT_COUNT);
    assert.strictEqual(fixture.rollups.length, LARGE_HISTORY_ROLLUP_COUNT);
    assert.strictEqual(LARGE_HISTORY_ROLLUP_COUNT, 54_800);
    assert.strictEqual(fixture.rollups[0].localDate, LARGE_HISTORY_START);
    assert.strictEqual(
      fixture.rollups[fixture.rollups.length - 1].localDate,
      LARGE_HISTORY_END,
    );
  });

  test("hydrates the analytical index within the activation budget", () => {
    assert.ok(
      activationElapsedMs <= ELAPSED_BUDGET_MS.activation,
      `analytical index hydration took ${formatMs(activationElapsedMs)}; budget ${ELAPSED_BUDGET_MS.activation}ms`,
    );
    assert.strictEqual(engine.getStats().revision, 2);
  });

  test("keeps preset and all-time queries within elapsed and lookup budgets", () => {
    measureQuery(
      "7-days",
      { preset: "7-days" },
      7 * LARGE_HISTORY_PROJECT_COUNT,
      ELAPSED_BUDGET_MS.sevenDays,
    );
    measureQuery(
      "30-days",
      { preset: "30-days" },
      30 * LARGE_HISTORY_PROJECT_COUNT,
      ELAPSED_BUDGET_MS.thirtyDays,
    );
    measureQuery(
      "90-days",
      { preset: "90-days" },
      90 * LARGE_HISTORY_PROJECT_COUNT,
      ELAPSED_BUDGET_MS.ninetyDays,
    );
    const allTime = measureQuery(
      "all-time",
      {
        preset: "custom",
        startLocalDate: LARGE_HISTORY_START,
        endLocalDate: LARGE_HISTORY_END,
      },
      LARGE_HISTORY_ROLLUP_COUNT,
      ELAPSED_BUDGET_MS.allTime,
    );
    assert.strictEqual(allTime.current.days.length, LARGE_HISTORY_DAY_COUNT);
  });

  test("bounds the initial payload and sends only a narrow live delta", () => {
    const previous = projectDashboardViewModel(
      requiredResult("90-days"),
      "global",
    );
    const snapshot: DashboardSnapshotMessage = {
      type: "dashboard/snapshot",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      requestId: "performance-snapshot",
      view: "global",
      data: previous,
    };
    assert.strictEqual(
      previous.current.files.length,
      3,
      "the global view only consumes its top-three file distribution",
    );
    const snapshotBytes = measureDashboardMessageBytes(snapshot);
    assert.ok(
      snapshotBytes <= MAX_INITIAL_MESSAGE_BYTES,
      `initial payload was ${snapshotBytes} bytes; budget ${MAX_INITIAL_MESSAGE_BYTES}`,
    );

    const changed = structuredClone(
      fixture.rollups[fixture.rollups.length - LARGE_HISTORY_PROJECT_COUNT],
    );
    const languageId = Object.keys(changed.activeTimeByLanguageMs)[0];
    const documentId = Object.keys(changed.activeTimeByDocumentMs)[0];
    const bucketKey = Object.keys(changed.activeTimeByQuarterHourMs)[0];
    changed.activeTimeMs += 1_000;
    changed.activeTimeByLanguageMs[languageId] += 1_000;
    changed.activeTimeByDocumentMs[documentId] += 1_000;
    changed.activeTimeByQuarterHourMs[bucketKey] += 1_000;
    changed.updatedAt += 1;
    engine.applyDelta({ upsert: [changed] });

    const beforeLookups = engine.getStats().recordLookups;
    const next = projectDashboardViewModel(
      engine.query({ preset: "90-days" }),
      "global",
    );
    assert.strictEqual(
      engine.getStats().recordLookups - beforeLookups,
      90 * LARGE_HISTORY_PROJECT_COUNT,
    );
    const delta = createRangeViewModelDelta(previous, next);
    assert.ok(delta, "the rollup change should produce a live delta");
    const message: DashboardLiveDeltaMessage = {
      type: "dashboard/live-delta",
      protocolVersion: DASHBOARD_PROTOCOL_VERSION,
      requestId: "performance-snapshot",
      view: "global",
      baseRevision: previous.revision,
      revision: next.revision,
      delta,
    };
    const deltaBytes = measureDashboardMessageBytes(message);
    assert.ok(
      deltaBytes <= MAX_DELTA_MESSAGE_BYTES,
      `live delta was ${deltaBytes} bytes; budget ${MAX_DELTA_MESSAGE_BYTES}`,
    );
    assert.strictEqual(delta.current.days?.upsert.length, 1);
    assert.strictEqual(delta.current.days?.remove.length, 0);
    assert.ok(
      !JSON.stringify(message).includes(LARGE_HISTORY_START),
      "a live update must not contain the beginning of the full history",
    );

    console.info(
      `[performance] activation=${formatMs(activationElapsedMs)}; ${measurements
        .map(
          ({ name, elapsedMs, recordLookups }) =>
            `${name}=${formatMs(elapsedMs)}/${recordLookups} lookups`,
        )
        .join("; ")}; snapshot=${snapshotBytes}B; delta=${deltaBytes}B`,
    );
  });

  test("keeps synchronous filesystem calls out of event and protocol handlers", () => {
    const sourceRoot = path.resolve(__dirname, "..", "..");
    const handlerFiles = [
      "src/extension.ts",
      "src/tracking/TrackingController.ts",
      "src/presentation/DashboardProtocol.ts",
      "src/presentation/DashboardPresenter.ts",
      "src/ReportPanel.ts",
      "src/integrations/WorkspaceIdentityRegistrar.ts",
    ];
    const synchronousCalls =
      /\b(?:readFileSync|writeFileSync|appendFileSync|existsSync|mkdirSync|rmSync|unlinkSync|readdirSync|statSync)\s*\(/g;

    handlerFiles.forEach((relativePath) => {
      const source = fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
      assert.deepStrictEqual(
        source.match(synchronousCalls) ?? [],
        [],
        `${relativePath} must not perform synchronous filesystem I/O`,
      );
    });
  });

  function measureQuery(
    name: string,
    request: RangeQueryRequest,
    expectedLookups: number,
    elapsedBudgetMs: number,
  ): RangeQueryViewModel {
    const beforeLookups = engine.getStats().recordLookups;
    const startedAt = performance.now();
    const result = engine.query(request);
    const elapsedMs = performance.now() - startedAt;
    const recordLookups = engine.getStats().recordLookups - beforeLookups;

    assert.strictEqual(recordLookups, expectedLookups);
    assert.ok(
      elapsedMs <= elapsedBudgetMs,
      `${name} query took ${formatMs(elapsedMs)}; budget ${elapsedBudgetMs}ms`,
    );
    measurements.push({ name, elapsedMs, recordLookups });
    results.set(name, result);
    return result;
  }

  function requiredResult(name: string): RangeQueryViewModel {
    const result = results.get(name);
    assert.ok(result, `${name} must be measured before payload checks`);
    return result;
  }
});

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
