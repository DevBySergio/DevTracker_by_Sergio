import { PrivacySettings } from "./PrivacySettings";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type DetailedDataRetentionAction =
  | "retain-detail"
  | "compact-detail";

export interface DetailedDataRetentionDecision {
  readonly action: DetailedDataRetentionAction;
  readonly detailedDataCutoffMs: number;
  /** Aggregate daily rollups are never removed by detailed-data retention. */
  readonly retainAggregateRollup: true;
}

export function detailedDataCutoffMs(
  nowMs: number,
  retentionDays: number,
): number {
  assertTimestamp(nowMs, "nowMs");
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 0) {
    throw new Error("retentionDays must be a non-negative safe integer");
  }
  const retentionMs = retentionDays * DAY_MS;
  if (!Number.isSafeInteger(retentionMs)) {
    throw new Error("retentionDays exceeds the safe timestamp range");
  }
  return nowMs - retentionMs;
}

/**
 * Detail ending exactly at the cutoff is compacted. Aggregate rollups remain
 * available regardless of the detail decision.
 */
export function decideDetailedDataRetention(
  detailEndedAt: number,
  nowMs: number,
  settings: Pick<PrivacySettings, "detailedDataRetentionDays">,
): DetailedDataRetentionDecision {
  assertTimestamp(detailEndedAt, "detailEndedAt");
  const cutoff = detailedDataCutoffMs(
    nowMs,
    settings.detailedDataRetentionDays,
  );
  return {
    action: detailEndedAt <= cutoff ? "compact-detail" : "retain-detail",
    detailedDataCutoffMs: cutoff,
    retainAggregateRollup: true,
  };
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}
