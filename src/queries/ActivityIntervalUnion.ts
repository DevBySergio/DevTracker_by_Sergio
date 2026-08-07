import { ActivityInterval, TrackingSession } from "../domain/schemaV2";

export interface AttributedActivitySlice {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  lastInteractionAt: number;
  instanceId: string;
  sessionId: string;
  intervalId: string;
  projectId: string;
  documentId: string | null;
  languageId: string | null;
  concurrentInstances: number;
}

export interface ActivityIntervalUnionResult {
  /** Union duration across every extension-host instance. */
  globalActiveTimeMs: number;
  /** The same deduplicated duration to compare once against a global goal. */
  goalActiveTimeMs: number;
  /** Union duration during which at least two instances were active. */
  overlapTimeMs: number;
  maxConcurrentInstances: number;
  activeTimeByProjectMs: Record<string, number>;
  activeTimeByLanguageMs: Record<string, number>;
  unattributedLanguageTimeMs: number;
  slices: AttributedActivitySlice[];
}

export class ActivityIntervalUnionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityIntervalUnionError";
  }
}

interface OwnedInterval extends ActivityInterval {
  instanceId: string;
}

/**
 * Produces one global timeline from independently persisted host sessions.
 * The latest persisted accepted interaction owns an overlap slice; periodic
 * interval boundaries are never treated as human interactions.
 */
export function unionActivityIntervals(
  sessions: readonly TrackingSession[],
): ActivityIntervalUnionResult {
  const intervals = collectUniqueIntervals(sessions);
  const boundaries = [...new Set(
    intervals.flatMap((interval) => [interval.startedAt, interval.endedAt]),
  )].sort((left, right) => left - right);
  const slices: AttributedActivitySlice[] = [];
  const byProject = new Map<string, number>();
  const byLanguage = new Map<string, number>();
  let globalActiveTimeMs = 0;
  let overlapTimeMs = 0;
  let maxConcurrentInstances = 0;
  let unattributedLanguageTimeMs = 0;

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startedAt = boundaries[index];
    const endedAt = boundaries[index + 1];
    if (endedAt <= startedAt) {
      continue;
    }

    const active = intervals.filter(
      (interval) =>
        interval.startedAt < endedAt && interval.endedAt > startedAt,
    );
    if (active.length === 0) {
      continue;
    }

    active.sort(compareAttributionPriority);
    const winner = active[0];
    const durationMs = endedAt - startedAt;
    const concurrentInstances = new Set(
      active.map((interval) => interval.instanceId),
    ).size;
    globalActiveTimeMs = safeSum(
      globalActiveTimeMs,
      durationMs,
      "global active time",
    );
    maxConcurrentInstances = Math.max(
      maxConcurrentInstances,
      concurrentInstances,
    );
    if (concurrentInstances > 1) {
      overlapTimeMs = safeSum(overlapTimeMs, durationMs, "overlap time");
    }
    increment(byProject, winner.projectId, durationMs, "project active time");
    if (winner.languageId === null) {
      unattributedLanguageTimeMs = safeSum(
        unattributedLanguageTimeMs,
        durationMs,
        "unattributed language time",
      );
    } else {
      increment(
        byLanguage,
        winner.languageId,
        durationMs,
        "language active time",
      );
    }

    appendSlice(slices, {
      startedAt,
      endedAt,
      durationMs,
      lastInteractionAt: winner.lastInteractionAt,
      instanceId: winner.instanceId,
      sessionId: winner.sessionId,
      intervalId: winner.id,
      projectId: winner.projectId,
      documentId: winner.documentId,
      languageId: winner.languageId,
      concurrentInstances,
    });
  }

  return {
    globalActiveTimeMs,
    goalActiveTimeMs: globalActiveTimeMs,
    overlapTimeMs,
    maxConcurrentInstances,
    activeTimeByProjectMs: sortedRecord(byProject),
    activeTimeByLanguageMs: sortedRecord(byLanguage),
    unattributedLanguageTimeMs,
    slices,
  };
}

function collectUniqueIntervals(
  sessions: readonly TrackingSession[],
): OwnedInterval[] {
  const sessionInstances = new Map<string, string>();
  const intervals = new Map<string, OwnedInterval>();

  for (const session of sessions) {
    if (!session.instanceId) {
      throw new ActivityIntervalUnionError(
        `Session ${session.id} has no instanceId`,
      );
    }
    const knownInstance = sessionInstances.get(session.id);
    if (knownInstance && knownInstance !== session.instanceId) {
      throw new ActivityIntervalUnionError(
        `Session ${session.id} is associated with multiple instances`,
      );
    }
    sessionInstances.set(session.id, session.instanceId);

    for (const interval of session.intervals) {
      if (interval.sessionId !== session.id) {
        throw new ActivityIntervalUnionError(
          `Interval ${interval.id} does not belong to session ${session.id}`,
        );
      }
      if (
        !Number.isSafeInteger(interval.startedAt) ||
        !Number.isSafeInteger(interval.endedAt) ||
        !Number.isSafeInteger(interval.lastInteractionAt) ||
        interval.startedAt < 0 ||
        interval.lastInteractionAt < 0 ||
        interval.endedAt < interval.startedAt
      ) {
        throw new ActivityIntervalUnionError(
          `Interval ${interval.id} has invalid wall-clock boundaries`,
        );
      }
      if (interval.startedAt === interval.endedAt) {
        continue;
      }

      const key = `${session.id}\u0000${interval.id}`;
      const owned: OwnedInterval = {
        ...interval,
        instanceId: session.instanceId,
      };
      const existing = intervals.get(key);
      if (existing && intervalFingerprint(existing) !== intervalFingerprint(owned)) {
        throw new ActivityIntervalUnionError(
          `Interval ${interval.id} has conflicting duplicate records`,
        );
      }
      if (!existing) {
        intervals.set(key, owned);
      }
    }
  }

  return [...intervals.values()];
}

/** Lower sort position means a higher attribution priority. */
function compareAttributionPriority(
  left: OwnedInterval,
  right: OwnedInterval,
): number {
  if (left.lastInteractionAt !== right.lastInteractionAt) {
    return right.lastInteractionAt - left.lastInteractionAt;
  }
  if (
    left.instanceId === right.instanceId &&
    left.monotonicStartedAt !== right.monotonicStartedAt
  ) {
    return right.monotonicStartedAt - left.monotonicStartedAt;
  }
  return (
    left.instanceId.localeCompare(right.instanceId) ||
    left.sessionId.localeCompare(right.sessionId) ||
    left.id.localeCompare(right.id) ||
    left.projectId.localeCompare(right.projectId) ||
    (left.languageId ?? "").localeCompare(right.languageId ?? "") ||
    (left.documentId ?? "").localeCompare(right.documentId ?? "")
  );
}

function appendSlice(
  slices: AttributedActivitySlice[],
  candidate: AttributedActivitySlice,
): void {
  const previous = slices[slices.length - 1];
  if (
    previous &&
    previous.endedAt === candidate.startedAt &&
    previous.lastInteractionAt === candidate.lastInteractionAt &&
    previous.instanceId === candidate.instanceId &&
    previous.sessionId === candidate.sessionId &&
    previous.intervalId === candidate.intervalId &&
    previous.projectId === candidate.projectId &&
    previous.documentId === candidate.documentId &&
    previous.languageId === candidate.languageId &&
    previous.concurrentInstances === candidate.concurrentInstances
  ) {
    previous.endedAt = candidate.endedAt;
    previous.durationMs = safeSum(
      previous.durationMs,
      candidate.durationMs,
      "attributed slice",
    );
    return;
  }
  slices.push(candidate);
}

function increment(
  values: Map<string, number>,
  key: string,
  amount: number,
  description: string,
): void {
  values.set(key, safeSum(values.get(key) ?? 0, amount, description));
}

function safeSum(left: number, right: number, description: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new ActivityIntervalUnionError(`${description} exceeds safe limits`);
  }
  return sum;
}

function sortedRecord(values: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...values.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function intervalFingerprint(interval: OwnedInterval): string {
  return JSON.stringify([
    interval.instanceId,
    interval.lastInteractionAt,
    interval.schemaVersion,
    interval.id,
    interval.sessionId,
    interval.projectId,
    interval.documentId,
    interval.languageId,
    interval.startedAt,
    interval.endedAt,
    interval.monotonicStartedAt,
    interval.monotonicEndedAt,
  ]);
}
