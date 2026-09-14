import {
  validateKata,
  type KataPattern,
  type KataVariation,
} from "./challenges";

/**
 * Repetition state for one variation. Katas are the only time-scheduled
 * surface in the application: challenge progression is derived from content
 * identity and completions alone, so nothing here may write to it.
 */
export interface KataRecord {
  patternId: string;
  variationId: string;
  /** Consecutive passes. A miss returns it to zero. */
  streak: number;
  attempts: number;
  passes: number;
  lastOutcome: "pass" | "miss";
  lastElapsedMs: number;
  lastAt: number;
  dueAt: number;
}
export interface KataProgress {
  records: KataRecord[];
}

const DAY = 86_400_000;
/**
 * Interval by streak length. A miss schedules immediately, so a shape stays in
 * front of the learner until it is produced without help. The last interval
 * repeats for longer streaks rather than growing without bound: a drill that
 * comes back in a year is a drill that was silently dropped.
 */
export const KATA_INTERVALS_MS = [DAY, 3 * DAY, 7 * DAY, 21 * DAY] as const;
/** Consecutive passes after which a variation is considered retained. */
export const KATA_RETAINED_STREAK = KATA_INTERVALS_MS.length;

export function emptyKataProgress(): KataProgress {
  return { records: [] };
}
export function validateKataProgress(
  value: unknown,
): asserts value is KataProgress {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Kata progress must be an object.");
  const progress = value as Record<string, unknown>;
  if (!Array.isArray(progress.records))
    throw new Error("Kata progress records must be a list.");
  for (const item of progress.records) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("A kata record must be an object.");
    const record = item as Record<string, unknown>;
    for (const key of ["patternId", "variationId"])
      if (typeof record[key] !== "string" || !record[key])
        throw new Error(`A kata record needs ${key}.`);
    for (const key of [
      "streak",
      "attempts",
      "passes",
      "lastElapsedMs",
      "lastAt",
      "dueAt",
    ])
      if (!Number.isFinite(record[key]) || (record[key] as number) < 0)
        throw new Error(`A kata record needs a nonnegative ${key}.`);
    if (record.lastOutcome !== "pass" && record.lastOutcome !== "miss")
      throw new Error("A kata outcome is pass or miss.");
    if ((record.passes as number) > (record.attempts as number))
      throw new Error("A kata cannot pass more often than it was attempted.");
  }
  const keys = progress.records.map(
    (record: KataRecord) => `${record.patternId}/${record.variationId}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error("Duplicate kata record.");
}

export function findKataRecord(
  progress: KataProgress,
  patternId: string,
  variationId: string,
): KataRecord | undefined {
  return progress.records.find(
    (record) =>
      record.patternId === patternId && record.variationId === variationId,
  );
}
/**
 * Folds one graded attempt into the schedule. Pure: the caller persists the
 * returned progress, so a failed write cannot leave the schedule ahead of
 * storage.
 *
 * `scheduled` is false when the learner drilled a variation that was not due.
 * Such a pass is recorded but advances nothing: spacing is the whole claim a
 * streak makes, so four clicks in two minutes must not mark a shape retained.
 * A miss still resets, whenever it happens — failing is evidence of not
 * knowing regardless of when it was asked.
 */
export function recordKataAttempt(
  progress: KataProgress,
  patternId: string,
  variationId: string,
  pass: boolean,
  elapsedMs: number,
  now: number,
  scheduled = true,
): KataProgress {
  const previous = findKataRecord(progress, patternId, variationId);
  const early = pass && !scheduled;
  const streak = early
    ? (previous?.streak ?? 0)
    : pass
      ? (previous?.streak ?? 0) + 1
      : 0;
  const interval =
    KATA_INTERVALS_MS[
      Math.min(Math.max(streak, 1), KATA_INTERVALS_MS.length) - 1
    ];
  const next: KataRecord = {
    patternId,
    variationId,
    streak,
    attempts: (previous?.attempts ?? 0) + 1,
    passes: (previous?.passes ?? 0) + (pass ? 1 : 0),
    lastOutcome: pass ? "pass" : "miss",
    lastElapsedMs: Math.max(0, Math.round(elapsedMs)),
    lastAt: now,
    dueAt: early
      ? (previous?.dueAt ?? now + interval)
      : pass
        ? now + interval
        : now,
  };
  return {
    records: [
      ...progress.records.filter(
        (record) =>
          record.patternId !== patternId || record.variationId !== variationId,
      ),
      next,
    ],
  };
}

export function kataDue(
  progress: KataProgress,
  patternId: string,
  variation: KataVariation,
  now: number,
): boolean {
  const record = findKataRecord(progress, patternId, variation.variationId);
  return !record || record.dueAt <= now;
}
/**
 * The variation to drill next: never practised first, then the one due
 * longest. Returns null only when every variation is scheduled ahead.
 */
export function nextKataVariation(
  pattern: KataPattern,
  progress: KataProgress,
  now: number,
): KataVariation | null {
  const unseen = pattern.variations.find(
    (variation) =>
      !findKataRecord(progress, pattern.patternId, variation.variationId),
  );
  if (unseen) return unseen;
  const due = pattern.variations
    .map((variation) => ({
      variation,
      record: findKataRecord(
        progress,
        pattern.patternId,
        variation.variationId,
      )!,
    }))
    .filter((entry) => entry.record.dueAt <= now)
    .sort((a, b) => a.record.dueAt - b.record.dueAt);
  return due.length ? due[0].variation : null;
}
export interface KataStatus {
  due: number;
  retained: number;
  total: number;
  nextDueAt: number | null;
}
export function kataStatus(
  pattern: KataPattern,
  progress: KataProgress,
  now: number,
): KataStatus {
  let due = 0,
    retained = 0,
    nextDueAt: number | null = null;
  for (const variation of pattern.variations) {
    const record = findKataRecord(
      progress,
      pattern.patternId,
      variation.variationId,
    );
    if (!record || record.dueAt <= now) due++;
    else if (nextDueAt === null || record.dueAt < nextDueAt)
      nextDueAt = record.dueAt;
    if (record && record.streak >= KATA_RETAINED_STREAK) retained++;
  }
  return { due, retained, total: pattern.variations.length, nextDueAt };
}
