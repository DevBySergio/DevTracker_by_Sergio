import * as assert from "assert";
import {
  DAY_MS,
  DEFAULT_DETAILED_DATA_RETENTION_DAYS,
  DEFAULT_PRIVACY_SETTINGS,
  MAX_DETAILED_DATA_RETENTION_DAYS,
  PRIVACY_CONFIGURATION_KEYS,
  PrivacyPolicy,
  PrivacySettings,
  decideDetailedDataRetention,
  detailedDataCutoffMs,
  globMatches,
  sanitizePrivacySettings,
} from "../privacy";

suite("Privacy settings and policy", () => {
  test("uses conservative integration defaults", () => {
    const result = sanitizePrivacySettings(undefined);

    assert.deepStrictEqual(result.settings, DEFAULT_PRIVACY_SETTINGS);
    assert.deepStrictEqual(result.issues, []);
    assert.strictEqual(result.settings.detailedDataRetentionDays, 30);
    assert.strictEqual(result.settings.fileIdentityMode, "relative");
    assert.strictEqual(result.settings.gitTrackingEnabled, false);
    assert.strictEqual(result.settings.debugTrackingEnabled, false);
    assert.strictEqual(result.settings.taskTrackingEnabled, false);
    assert.deepStrictEqual(result.settings.trackedTasks, []);
    assert.deepStrictEqual(PRIVACY_CONFIGURATION_KEYS, {
      projectExclusionGlobs: "devtracker.projectExclusionGlobs",
      documentExclusionGlobs: "devtracker.documentExclusionGlobs",
      detailedDataRetentionDays: "devtracker.detailedDataRetentionDays",
      fileIdentityMode: "devtracker.fileIdentityMode",
      gitTrackingEnabled: "devtracker.gitTrackingEnabled",
      debugTrackingEnabled: "devtracker.debugTrackingEnabled",
      taskTrackingEnabled: "devtracker.taskTrackingEnabled",
      trackedTasks: "devtracker.trackedTasks",
    });
    assert.ok(Object.isFrozen(result.settings));
    assert.ok(Object.isFrozen(result.settings.projectExclusionGlobs));
  });

  test("sanitizes globs and accepts explicit valid settings", () => {
    const result = sanitizePrivacySettings({
      projectExclusionGlobs: [
        " **/private/** ",
        "**\\private\\**",
        "",
        null,
      ],
      documentExclusionGlobs: [".env", " generated\\** "],
      detailedDataRetentionDays: 90,
      fileIdentityMode: "hashed",
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      trackedTasks: [
        { configuredName: "npm: test", classification: "test" },
        { configuredName: "compile", classification: "build" },
      ],
    });

    assert.deepStrictEqual(result.settings, {
      projectExclusionGlobs: ["**/private/**"],
      documentExclusionGlobs: [".env", "generated/**"],
      detailedDataRetentionDays: 90,
      fileIdentityMode: "hashed",
      gitTrackingEnabled: true,
      debugTrackingEnabled: true,
      taskTrackingEnabled: true,
      trackedTasks: [
        { configuredName: "npm: test", classification: "test" },
        { configuredName: "compile", classification: "build" },
      ],
    });
    assert.strictEqual(result.issues.length, 2);
  });

  test("replaces invalid configuration with safe defaults", () => {
    const nonObject = sanitizePrivacySettings([]);
    assert.deepStrictEqual(nonObject.settings, DEFAULT_PRIVACY_SETTINGS);
    assert.strictEqual(nonObject.issues[0].key, "settings");

    const invalid = sanitizePrivacySettings({
      projectExclusionGlobs: "**/private/**",
      documentExclusionGlobs: ["valid", "x".repeat(513), "bad\0glob"],
      detailedDataRetentionDays: 3.5,
      fileIdentityMode: "absolute",
      gitTrackingEnabled: "true",
      debugTrackingEnabled: 1,
      taskTrackingEnabled: null,
      trackedTasks: [
        { configuredName: "", classification: "build" },
        { configuredName: "compile", classification: "other" },
        { configuredName: "compile", classification: "build", command: "x" },
      ],
    });

    assert.deepStrictEqual(invalid.settings, {
      projectExclusionGlobs: [],
      documentExclusionGlobs: ["valid"],
      detailedDataRetentionDays: DEFAULT_DETAILED_DATA_RETENTION_DAYS,
      fileIdentityMode: "relative",
      gitTrackingEnabled: false,
      debugTrackingEnabled: false,
      taskTrackingEnabled: false,
      trackedTasks: [],
    });
    assert.ok(invalid.issues.length >= 8);

    for (const value of [-1, MAX_DETAILED_DATA_RETENTION_DAYS + 1]) {
      assert.strictEqual(
        sanitizePrivacySettings({ detailedDataRetentionDays: value }).settings
          .detailedDataRetentionDays,
        DEFAULT_DETAILED_DATA_RETENTION_DAYS,
      );
    }
  });

  test("matches portable glob stars, double stars, and question marks", () => {
    assert.strictEqual(
      globMatches(
        "/work/app/node_modules/pkg/index.js",
        "**/node_modules/**",
        "posix",
      ),
      true,
    );
    assert.strictEqual(
      globMatches("/work/app/node_modules", "**/node_modules/**", "posix"),
      true,
    );
    assert.strictEqual(
      globMatches("src/a.test.ts", "src/*.test.?s", "posix"),
      true,
    );
    assert.strictEqual(
      globMatches("src/nested/a.test.ts", "src/*.test.?s", "posix"),
      false,
    );
    assert.strictEqual(globMatches("src/.env", ".env", "posix"), true);
    assert.strictEqual(globMatches("src/FILE.ts", "**/file.ts", "posix"), false);
    assert.strictEqual(
      globMatches("C:\\Work\\Private\\a.ts", "c:/work/private/**", "win32"),
      true,
    );
  });

  test("applies project and document exclusions across separators", () => {
    const posix = new PrivacyPolicy({
      settings: settings({
        projectExclusionGlobs: ["**/private-*"],
        documentExclusionGlobs: [".env", "generated/**"],
      }),
      platform: "posix",
    });

    assert.strictEqual(posix.isProjectExcluded("/work/private-client"), true);
    assert.deepStrictEqual(posix.evaluateDocument("/work/app", ".env"), {
      excluded: true,
      documentIdentity: null,
      reason: "document-excluded",
    });
    assert.strictEqual(
      posix.evaluateDocument("/work/app", "/work/app/generated/api.ts").reason,
      "document-excluded",
    );

    const windows = new PrivacyPolicy({
      settings: settings({ projectExclusionGlobs: ["C:/WORK/PRIVATE/**"] }),
      platform: "win32",
    });
    assert.strictEqual(windows.isProjectExcluded("c:\\work\\private"), true);
  });

  test("never permits relative identities to escape the project", () => {
    const posix = new PrivacyPolicy({
      settings: settings({ fileIdentityMode: "relative" }),
      platform: "posix",
    });
    assert.deepStrictEqual(
      posix.evaluateDocument("/work/app", "/work/app/src/../src/index.ts"),
      {
        excluded: false,
        documentIdentity: "src/index.ts",
        reason: null,
      },
    );
    assert.strictEqual(
      posix.evaluateDocument("/work/app", "../secret.txt").reason,
      "outside-project",
    );
    assert.strictEqual(
      posix.evaluateDocument("/work/app", "/work/application/secret.txt")
        .reason,
      "outside-project",
    );

    const windows = new PrivacyPolicy({
      settings: settings({ fileIdentityMode: "relative" }),
      platform: "win32",
    });
    assert.strictEqual(
      windows.evaluateDocument("C:\\Work\\App", "src\\Feature.ts")
        .documentIdentity,
      "src/feature.ts",
    );
    assert.strictEqual(
      windows.evaluateDocument("C:\\Work\\App", "D:\\secret.txt").reason,
      "outside-project",
    );
  });

  test("produces stable salted hashes without leaking paths", () => {
    const hashed = settings({ fileIdentityMode: "hashed" });
    const firstPolicy = new PrivacyPolicy({
      settings: hashed,
      platform: "win32",
      hashSalt: "profile-salt-a",
    });
    const secondPolicy = new PrivacyPolicy({
      settings: hashed,
      platform: "win32",
      hashSalt: "profile-salt-b",
    });

    const first = firstPolicy.evaluateDocument(
      "C:\\Work\\App",
      "C:\\Work\\App\\src\\Secret.ts",
    ).documentIdentity;
    const equivalent = firstPolicy.evaluateDocument(
      "c:/work/app",
      "src/secret.ts",
    ).documentIdentity;
    const differentSalt = secondPolicy.evaluateDocument(
      "C:\\Work\\App",
      "src\\Secret.ts",
    ).documentIdentity;

    assert.strictEqual(first, equivalent);
    assert.notStrictEqual(first, differentSalt);
    assert.match(first || "", /^document-[a-f0-9]{64}$/);
    assert.doesNotMatch(first || "", /work|src|secret/i);
    assert.throws(
      () => new PrivacyPolicy({ settings: hashed, hashSalt: "" }),
      /non-empty salt/,
    );
  });

  test("none mode retains aggregate eligibility without document detail", () => {
    const policy = new PrivacyPolicy({
      settings: settings({ fileIdentityMode: "none" }),
      platform: "posix",
    });

    assert.deepStrictEqual(policy.evaluateDocument("/work/app", "src/index.ts"), {
      excluded: false,
      documentIdentity: null,
      reason: "detail-disabled",
    });
  });

  test("compacts detail deterministically at the retention boundary", () => {
    const nowMs = 100 * DAY_MS;
    const retentionSettings = settings({ detailedDataRetentionDays: 30 });
    const cutoff = 70 * DAY_MS;

    assert.strictEqual(detailedDataCutoffMs(nowMs, 30), cutoff);
    assert.strictEqual(detailedDataCutoffMs(10 * DAY_MS, 30), -20 * DAY_MS);
    assert.deepStrictEqual(
      decideDetailedDataRetention(cutoff, nowMs, retentionSettings),
      {
        action: "compact-detail",
        detailedDataCutoffMs: cutoff,
        retainAggregateRollup: true,
      },
    );
    assert.deepStrictEqual(
      decideDetailedDataRetention(cutoff + 1, nowMs, retentionSettings),
      {
        action: "retain-detail",
        detailedDataCutoffMs: cutoff,
        retainAggregateRollup: true,
      },
    );
    assert.strictEqual(
      decideDetailedDataRetention(nowMs, nowMs, settings({
        detailedDataRetentionDays: 0,
      })).action,
      "compact-detail",
    );
    assert.throws(() => detailedDataCutoffMs(-1, 30), /nowMs/);
    assert.throws(() => detailedDataCutoffMs(nowMs, -1), /retentionDays/);
  });

  function settings(overrides: Record<string, unknown>): PrivacySettings {
    const sanitized = sanitizePrivacySettings(overrides);
    assert.deepStrictEqual(sanitized.issues, []);
    return sanitized.settings;
  }
});
