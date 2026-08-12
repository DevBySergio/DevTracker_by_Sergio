import {
  ActivityInterval,
  DailyRollup,
  DiagnosticRollup,
  DiagnosticTimeBucket,
  DocumentIdentity,
  ProjectIdentity,
  SCHEMA_VERSION,
  SchemaMetadataV2,
  TrackingSession,
} from "../domain/schemaV2";
import { DiagnosticsBySeverity } from "../domain/types";

type JsonRecord = Record<string, unknown>;

export class SchemaValidationError extends Error {
  constructor(recordName: string, reason: string) {
    super(`Invalid ${recordName}: ${reason}`);
    this.name = "SchemaValidationError";
  }
}

export function assertProjectIdentity(value: unknown): ProjectIdentity {
  const record = requireRecord(value, "ProjectIdentity");
  requireExactKeys(record, "ProjectIdentity", [
    "schemaVersion",
    "id",
    "canonicalUri",
    "displayName",
    "scheme",
    "authority",
    "createdAt",
    "updatedAt",
  ]);
  requireSchemaVersion(record.schemaVersion, "ProjectIdentity");
  requireSafeId(record.id, "ProjectIdentity.id");
  requireNonEmptyString(record.canonicalUri, "ProjectIdentity.canonicalUri");
  requireNonEmptyString(record.displayName, "ProjectIdentity.displayName");
  requireNonEmptyString(record.scheme, "ProjectIdentity.scheme");
  if (record.authority !== null) {
    requireString(record.authority, "ProjectIdentity.authority");
  }
  requireTimestamp(record.createdAt, "ProjectIdentity.createdAt");
  requireTimestamp(record.updatedAt, "ProjectIdentity.updatedAt");

  return record as unknown as ProjectIdentity;
}

export function assertDocumentIdentity(value: unknown): DocumentIdentity {
  const record = requireRecord(value, "DocumentIdentity");
  requireExactKeys(record, "DocumentIdentity", [
    "schemaVersion",
    "id",
    "canonicalUri",
    "projectId",
    "scheme",
    "createdAt",
    "updatedAt",
  ]);
  requireSchemaVersion(record.schemaVersion, "DocumentIdentity");
  requireSafeId(record.id, "DocumentIdentity.id");
  requireNonEmptyString(record.canonicalUri, "DocumentIdentity.canonicalUri");
  requireNullableSafeId(record.projectId, "DocumentIdentity.projectId");
  requireNonEmptyString(record.scheme, "DocumentIdentity.scheme");
  requireTimestamp(record.createdAt, "DocumentIdentity.createdAt");
  requireTimestamp(record.updatedAt, "DocumentIdentity.updatedAt");
  return record as unknown as DocumentIdentity;
}

export function assertActivityInterval(value: unknown): ActivityInterval {
  const record = requireRecord(value, "ActivityInterval");
  requireExactKeys(record, "ActivityInterval", [
    "schemaVersion",
    "id",
    "sessionId",
    "projectId",
    "documentId",
    "languageId",
    "lastInteractionAt",
    "startedAt",
    "endedAt",
    "monotonicStartedAt",
    "monotonicEndedAt",
  ]);
  requireSchemaVersion(record.schemaVersion, "ActivityInterval");
  requireSafeId(record.id, "ActivityInterval.id");
  requireSafeId(record.sessionId, "ActivityInterval.sessionId");
  requireSafeId(record.projectId, "ActivityInterval.projectId");
  requireNullableDocumentIdentity(
    record.documentId,
    "ActivityInterval.documentId",
  );
  requireNullableString(record.languageId, "ActivityInterval.languageId");
  requireTimestamp(
    record.lastInteractionAt,
    "ActivityInterval.lastInteractionAt",
  );
  requireTimestamp(record.startedAt, "ActivityInterval.startedAt");
  requireTimestamp(record.endedAt, "ActivityInterval.endedAt");
  requireNonNegativeInteger(
    record.monotonicStartedAt,
    "ActivityInterval.monotonicStartedAt",
  );
  requireNonNegativeInteger(
    record.monotonicEndedAt,
    "ActivityInterval.monotonicEndedAt",
  );
  if ((record.endedAt as number) < (record.startedAt as number)) {
    fail("ActivityInterval", "endedAt precedes startedAt");
  }
  if (
    (record.monotonicEndedAt as number) <
    (record.monotonicStartedAt as number)
  ) {
    fail("ActivityInterval", "monotonicEndedAt precedes its start");
  }

  return record as unknown as ActivityInterval;
}

export function assertTrackingSession(value: unknown): TrackingSession {
  const record = requireRecord(value, "TrackingSession");
  requireExactKeys(record, "TrackingSession", [
    "schemaVersion",
    "id",
    "instanceId",
    "state",
    "startedAt",
    "updatedAt",
    "endedAt",
    "intervals",
  ]);
  requireSchemaVersion(record.schemaVersion, "TrackingSession");
  requireSafeId(record.id, "TrackingSession.id");
  requireSafeId(record.instanceId, "TrackingSession.instanceId");
  if (record.state !== "active" && record.state !== "completed") {
    fail("TrackingSession", "state must be active or completed");
  }
  requireTimestamp(record.startedAt, "TrackingSession.startedAt");
  requireTimestamp(record.updatedAt, "TrackingSession.updatedAt");
  if (record.endedAt !== null) {
    requireTimestamp(record.endedAt, "TrackingSession.endedAt");
  }
  if (record.state === "active" && record.endedAt !== null) {
    fail("TrackingSession", "an active session cannot have endedAt");
  }
  if (record.state === "completed" && record.endedAt === null) {
    fail("TrackingSession", "a completed session requires endedAt");
  }
  if (!Array.isArray(record.intervals)) {
    fail("TrackingSession", "intervals must be an array");
  }
  const intervalIds = new Set<string>();
  for (const candidate of record.intervals as unknown[]) {
    const interval = assertActivityInterval(candidate);
    if (interval.sessionId !== record.id) {
      fail("TrackingSession", "interval sessionId does not match session id");
    }
    if (intervalIds.has(interval.id)) {
      fail("TrackingSession", `duplicate interval id ${interval.id}`);
    }
    intervalIds.add(interval.id);
  }

  return record as unknown as TrackingSession;
}

export function assertDailyRollup(value: unknown): DailyRollup {
  const source = requireRecord(value, "DailyRollup");
  // Schema-v2 rollups written before Git metrics were introduced remain valid.
  // Defaults are applied during validation so the persisted contract can grow
  // without silently accepting unknown fields.
  const record: JsonRecord = {
    gitStatus: "disabled",
    gitDirtyFiles: 0,
    gitBranchChanges: 0,
    gitDetectedCommits: 0,
    activeTimeByGitBranchMs: {},
    ...source,
  };
  requireExactKeys(record, "DailyRollup", [
    "schemaVersion",
    "projectId",
    "localDate",
    "activeTimeMs",
    "debugElapsedMs",
    "debugActiveTimeMs",
    "editEvents",
    "insertedCharacters",
    "removedCharacters",
    "largeEditEvents",
    "insertedLineBreaksApprox",
    "removedLineBreaksApprox",
    "saveEvents",
    "fileSwitchEvents",
    "projectSwitchEvents",
    "flowBlockCount",
    "flowActiveMs",
    "longestFlowActiveMs",
    "gitStatus",
    "gitDirtyFiles",
    "gitBranchChanges",
    "gitDetectedCommits",
    "diagnostics",
    "diagnosticBuckets",
    "activeTimeByLanguageMs",
    "activeTimeByDocumentMs",
    "activeTimeByQuarterHourMs",
    "activeTimeByGitBranchMs",
    "legacyApproximate",
    "updatedAt",
  ]);
  requireSchemaVersion(record.schemaVersion, "DailyRollup");
  requireSafeId(record.projectId, "DailyRollup.projectId");
  requireLocalDate(record.localDate, "DailyRollup.localDate");
  [
    "activeTimeMs",
    "debugElapsedMs",
    "debugActiveTimeMs",
    "editEvents",
    "insertedCharacters",
    "removedCharacters",
    "largeEditEvents",
    "insertedLineBreaksApprox",
    "removedLineBreaksApprox",
    "saveEvents",
    "fileSwitchEvents",
    "projectSwitchEvents",
    "flowBlockCount",
    "flowActiveMs",
    "longestFlowActiveMs",
    "gitDirtyFiles",
    "gitBranchChanges",
    "gitDetectedCommits",
  ].forEach((key) =>
    requireNonNegativeInteger(record[key], `DailyRollup.${key}`),
  );
  if (
    record.gitStatus !== "disabled" &&
    record.gitStatus !== "unavailable" &&
    record.gitStatus !== "no-repository" &&
    record.gitStatus !== "available"
  ) {
    fail("DailyRollup", "gitStatus is invalid");
  }
  assertDiagnosticRollup(record.diagnostics);
  const diagnosticBuckets = requireRecord(
    record.diagnosticBuckets,
    "DailyRollup.diagnosticBuckets",
  );
  Object.entries(diagnosticBuckets).forEach(([key, bucket]) => {
    if (!/^\d+$/.test(key)) {
      fail("DailyRollup.diagnosticBuckets", `invalid timestamp key ${key}`);
    }
    const validated = assertDiagnosticTimeBucket(bucket);
    if (String(validated.bucketStartedAt) !== key) {
      fail(
        "DailyRollup.diagnosticBuckets",
        `key ${key} does not match bucketStartedAt`,
      );
    }
  });
  requireNumericMap(
    record.activeTimeByLanguageMs,
    "DailyRollup.activeTimeByLanguageMs",
  );
  requireDocumentIdentityNumericMap(
    record.activeTimeByDocumentMs,
    "DailyRollup.activeTimeByDocumentMs",
  );
  requireNumericMap(
    record.activeTimeByQuarterHourMs,
    "DailyRollup.activeTimeByQuarterHourMs",
  );
  requireNumericMap(
    record.activeTimeByGitBranchMs,
    "DailyRollup.activeTimeByGitBranchMs",
  );
  if (typeof record.legacyApproximate !== "boolean") {
    fail("DailyRollup", "legacyApproximate must be boolean");
  }
  requireTimestamp(record.updatedAt, "DailyRollup.updatedAt");

  return record as unknown as DailyRollup;
}

export function assertSchemaMetadata(value: unknown): SchemaMetadataV2 {
  const record = requireRecord(value, "SchemaMetadataV2");
  requireExactKeys(record, "SchemaMetadataV2", [
    "schemaVersion",
    "createdAt",
    "updatedAt",
    "projects",
  ]);
  requireSchemaVersion(record.schemaVersion, "SchemaMetadataV2");
  requireTimestamp(record.createdAt, "SchemaMetadataV2.createdAt");
  requireTimestamp(record.updatedAt, "SchemaMetadataV2.updatedAt");
  const projects = requireRecord(record.projects, "SchemaMetadataV2.projects");
  Object.entries(projects).forEach(([key, candidate]) => {
    requireSafeId(key, "SchemaMetadataV2.projects key");
    const project = assertProjectIdentity(candidate);
    if (project.id !== key) {
      fail("SchemaMetadataV2", `project key ${key} does not match its id`);
    }
  });

  return record as unknown as SchemaMetadataV2;
}

function assertDiagnosticRollup(value: unknown): DiagnosticRollup {
  const record = requireRecord(value, "DiagnosticRollup");
  requireExactKeys(record, "DiagnosticRollup", [
    "current",
    "introduced",
    "resolved",
    "peak",
  ]);
  assertDiagnostics(record.current, "DiagnosticRollup.current");
  assertDiagnostics(record.introduced, "DiagnosticRollup.introduced");
  assertDiagnostics(record.resolved, "DiagnosticRollup.resolved");
  assertDiagnostics(record.peak, "DiagnosticRollup.peak");
  return record as unknown as DiagnosticRollup;
}

export function assertDiagnosticTimeBucket(
  value: unknown,
): DiagnosticTimeBucket {
  const record = requireRecord(value, "DiagnosticTimeBucket");
  requireExactKeys(record, "DiagnosticTimeBucket", [
    "bucketStartedAt",
    "bucketEndedAt",
    "observedAt",
    "diagnostics",
  ]);
  requireTimestamp(
    record.bucketStartedAt,
    "DiagnosticTimeBucket.bucketStartedAt",
  );
  requireTimestamp(record.bucketEndedAt, "DiagnosticTimeBucket.bucketEndedAt");
  requireTimestamp(record.observedAt, "DiagnosticTimeBucket.observedAt");
  if ((record.bucketEndedAt as number) <= (record.bucketStartedAt as number)) {
    fail("DiagnosticTimeBucket", "bucketEndedAt must follow bucketStartedAt");
  }
  if (
    (record.observedAt as number) < (record.bucketStartedAt as number) ||
    (record.observedAt as number) > (record.bucketEndedAt as number)
  ) {
    fail("DiagnosticTimeBucket", "observedAt must fall within the bucket");
  }
  assertDiagnosticRollup(record.diagnostics);
  return record as unknown as DiagnosticTimeBucket;
}

function assertDiagnostics(
  value: unknown,
  recordName: string,
): DiagnosticsBySeverity {
  const record = requireRecord(value, recordName);
  requireExactKeys(record, recordName, ["error", "warning", "info", "hint"]);
  ["error", "warning", "info", "hint"].forEach((key) =>
    requireNonNegativeInteger(record[key], `${recordName}.${key}`),
  );
  return record as unknown as DiagnosticsBySeverity;
}

function requireRecord(value: unknown, name: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(name, "expected an object");
  }
  return value as JsonRecord;
}

function requireExactKeys(
  record: JsonRecord,
  name: string,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(record);
  const missing = expectedKeys.filter((key) => !(key in record));
  const extra = actualKeys.filter((key) => !expected.has(key));
  if (missing.length || extra.length) {
    fail(
      name,
      `keys mismatch; missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
    );
  }
}

function requireSchemaVersion(value: unknown, name: string): void {
  if (value !== SCHEMA_VERSION) {
    fail(name, `schemaVersion must be ${SCHEMA_VERSION}`);
  }
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") {
    fail(name, "expected a string");
  }
}

function requireNonEmptyString(
  value: unknown,
  name: string,
): asserts value is string {
  requireString(value, name);
  if (value.trim().length === 0) {
    fail(name, "must not be empty");
  }
}

function requireSafeId(value: unknown, name: string): asserts value is string {
  requireNonEmptyString(value, name);
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    fail(name, "contains unsafe path characters");
  }
}

function requireNullableSafeId(value: unknown, name: string): void {
  if (value !== null) {
    requireSafeId(value, name);
  }
}

function requireNullableDocumentIdentity(value: unknown, name: string): void {
  if (value !== null) {
    requireDocumentIdentity(value, name);
  }
}

function requireDocumentIdentity(
  value: unknown,
  name: string,
): asserts value is string {
  requireNonEmptyString(value, name);
  if (
    value.length > 4096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(name, "is not a safe project-relative or hashed identity");
  }
}

function requireNullableString(value: unknown, name: string): void {
  if (value !== null) {
    requireString(value, name);
  }
}

function requireTimestamp(value: unknown, name: string): void {
  requireNonNegativeInteger(value, name);
}

function requireNonNegativeInteger(value: unknown, name: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(name, "expected a non-negative safe integer");
  }
}

function requireLocalDate(value: unknown, name: string): void {
  requireString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(name, "expected YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    fail(name, "is not a valid calendar date");
  }
}

function requireNumericMap(value: unknown, name: string): void {
  const record = requireRecord(value, name);
  Object.entries(record).forEach(([key, amount]) => {
    requireNonEmptyString(key, `${name} key`);
    requireNonNegativeInteger(amount, `${name}.${key}`);
  });
}

function requireDocumentIdentityNumericMap(value: unknown, name: string): void {
  const record = requireRecord(value, name);
  Object.entries(record).forEach(([key, amount]) => {
    requireDocumentIdentity(key, `${name} key`);
    requireNonNegativeInteger(amount, `${name}.${key}`);
  });
}

function fail(recordName: string, reason: string): never {
  throw new SchemaValidationError(recordName, reason);
}
