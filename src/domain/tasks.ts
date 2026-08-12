export type TaskClassification = "build" | "test";

export type TaskRunResult =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export interface TrackedTaskConfiguration {
  configuredName: string;
  classification: TaskClassification;
}

/**
 * The complete persisted task payload. Keeping this contract deliberately
 * narrow prevents task definitions, commands, variables, and output from
 * entering storage.
 */
export interface TaskRunRecord extends TrackedTaskConfiguration {
  durationMs: number;
  result: TaskRunResult;
}
