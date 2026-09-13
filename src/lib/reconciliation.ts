import type { TypedAnswer } from "./engine-results";

export type ReconciliationConfidence =
  | "high"
  | "probable"
  | "ambiguous"
  | "missing";
export interface ReconciliationReference {
  refId: string;
  businessUnit: string;
  category: string;
  status: "determinate" | "ambiguous" | "missing";
  groupKey: string | null;
  family?: number;
  source: {
    accountKey: string | null;
    eventDate: string;
    description: string;
    quantity: string;
  };
}
export interface ReconciliationPartner {
  partnerId: string;
  source: {
    accountKey: string | null;
    sourceEventKey: string | null;
    categoryText: string | null;
    dateText: string | null;
    descriptionText: string | null;
    quantity: string;
  };
}
export interface ReconciliationTruthGroup {
  key: string;
  refIds: string[];
  partnerIds: string[];
  family: "singleton" | "split" | "rollup";
}
export interface ReconciliationTruth {
  formatVersion: "reconciliation-truth-v1";
  references: ReconciliationReference[];
  partners: ReconciliationPartner[];
  groups: ReconciliationTruthGroup[];
  replayAliases: Record<string, string>;
}
export interface ReconciliationCounts {
  total: number;
  high: number;
  probable: number;
  ambiguous: number;
  missing: number;
  committed: number;
  correctCommitted: number;
}
export interface ReconciliationPairFacts {
  partnerId: string;
  normalizedDescription: string | null;
  normalizedCategory: string | null;
  parsedDate: string | null;
  accountMatches: boolean;
  descriptionEditDistance: number | null;
  dateDistanceDays: number | null;
  quantityDifference: string;
  categoryMatches: boolean;
  sharedWords: string[];
}
export interface ReconciliationEvidence {
  refId: string;
  confidence: ReconciliationConfidence;
  partnerIds: string[];
  score: string;
  explanation: string;
  reference: ReconciliationReference;
  partners: ReconciliationPartner[];
  facts: ReconciliationPairFacts[];
  truthStatus: ReconciliationReference["status"];
  expectedGroup: ReconciliationTruthGroup | null;
  committedGroupKey: string | null;
  correctCommitment: boolean;
  issues: string[];
}
export interface ReconciliationAssessment {
  kind: "reconciliation";
  pass: boolean;
  errors: string[];
  metrics: {
    committedPrecision: number;
    determinateRecall: number;
    committedCoverage: number;
    highConfidencePrecision: number | null;
    splitRecall: number;
    rollupRecall: number;
    committed: number;
    correctCommitted: number;
    determinate: number;
    high: number;
    incorrectHigh: number;
    recoveredSplitGroups: number;
    splitGroups: number;
    recoveredRollupGroups: number;
    rollupGroups: number;
  };
  counts: ReconciliationCounts;
  byBusinessUnit: Record<string, ReconciliationCounts>;
  byCategory: Record<string, ReconciliationCounts>;
  falseCommitments: string[];
  missingCases: string[];
  ambiguousCases: string[];
  failedGroups: string[];
  evidence: ReconciliationEvidence[];
}

const confidences: Readonly<Record<string, true>> = {
  high: true,
  probable: true,
  ambiguous: true,
  missing: true,
};
const integer = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;
function validId(value: unknown): value is string {
  if (typeof value !== "string" || !integer.test(value)) return false;
  const n = BigInt(value);
  return n >= -9223372036854775808n && n <= 9223372036854775807n;
}
function numericOrder(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}
export function reconciliationGroupKey(
  refIds: readonly string[],
  partnerIds: readonly string[],
): string {
  if (!refIds.every(validId) || !partnerIds.every(validId))
    throw new Error("Invalid reconciliation group ID");
  return `r:${[...refIds].sort(numericOrder).join(",")}|p:${[...partnerIds].sort(numericOrder).join(",")}`;
}

/** Observed pair facts explain decisions without prescribing a capstone scoring formula. */
export function reconciliationPairFacts(
  reference: ReconciliationReference,
  partner: ReconciliationPartner,
): ReconciliationPairFacts {
  const source = partner.source;
  const referenceDescription = reference.source.description
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const normalizedDescription =
    source.descriptionText
      ?.toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim() ?? null;
  const category =
    source.categoryText
      ?.toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim() ?? null;
  const normalizedCategory =
    category === "hw" || category === "hard ware" ? "hardware" : category;
  const referenceCategory = reference.category
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const dateText = source.dateText?.trim() ?? "";
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) iso = dateText;
  else {
    const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateText);
    if (us) iso = `${us[3]}-${us[1]}-${us[2]}`;
    else {
      const named = /^(\d{2}) ([A-Za-z]{3}) (\d{4})$/.exec(dateText);
      if (named) {
        const month =
          [
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
          ].indexOf(named[2].toLowerCase()) + 1;
        if (month)
          iso = `${named[3]}-${String(month).padStart(2, "0")}-${named[1]}`;
      }
    }
  }
  const epoch = iso === null ? NaN : Date.parse(`${iso}T00:00:00Z`);
  const parsedDate =
    Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === iso
      ? iso
      : null;
  let descriptionEditDistance: number | null = null;
  if (referenceDescription && normalizedDescription) {
    const left = [...referenceDescription],
      right = [...normalizedDescription];
    const row = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 1; i <= left.length; i++) {
      let diagonal = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j++) {
        const previous = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
        );
        diagonal = previous;
      }
    }
    descriptionEditDistance = row[right.length];
  }
  const partnerWords = new Set(
    (normalizedDescription ?? "").split(" ").filter(Boolean),
  );
  const sharedWords = [
    ...new Set(
      referenceDescription
        .split(" ")
        .filter((word) => word !== "" && partnerWords.has(word)),
    ),
  ].sort();
  const account = reference.source.accountKey?.trim().toLowerCase() ?? "";
  const difference =
    BigInt(reference.source.quantity) - BigInt(source.quantity);
  return {
    partnerId: partner.partnerId,
    normalizedDescription,
    normalizedCategory,
    parsedDate,
    accountMatches:
      account !== "" && account === source.accountKey?.trim().toLowerCase(),
    descriptionEditDistance,
    dateDistanceDays:
      parsedDate === null
        ? null
        : Math.abs(
            (Date.parse(`${reference.source.eventDate}T00:00:00Z`) - epoch) /
              86400000,
          ),
    quantityDifference: (difference < 0n ? -difference : difference).toString(),
    categoryMatches:
      referenceCategory !== "" && referenceCategory === normalizedCategory,
    sharedWords,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
function textOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
function positiveQuantity(value: unknown): boolean {
  return validId(value) && BigInt(value) > 0n;
}
/** Reject malformed truth as a content error, never a learner failure. */
export function validateReconciliationTruth(
  input: unknown,
): ReconciliationTruth {
  function fail(message: string): never {
    throw new Error(`Invalid reconciliation truth: ${message}`);
  }
  if (
    !record(input) ||
    input.formatVersion !== "reconciliation-truth-v1" ||
    !Array.isArray(input.references) ||
    !Array.isArray(input.partners) ||
    !Array.isArray(input.groups) ||
    !record(input.replayAliases)
  )
    fail("structure");
  const rawReferences = input.references;
  const rawPartners = input.partners;
  const rawGroups = input.groups;
  const replayAliases = input.replayAliases;
  const refIds = new Set<string>();
  for (const r of rawReferences) {
    if (
      !record(r) ||
      !validId(r.refId) ||
      refIds.has(r.refId) ||
      typeof r.businessUnit !== "string" ||
      typeof r.category !== "string" ||
      !["determinate", "ambiguous", "missing"].includes(String(r.status)) ||
      !(r.groupKey === null || typeof r.groupKey === "string") ||
      !record(r.source) ||
      !textOrNull(r.source.accountKey) ||
      typeof r.source.eventDate !== "string" ||
      typeof r.source.description !== "string" ||
      !positiveQuantity(r.source.quantity)
    )
      fail("reference");
    refIds.add(r.refId);
  }
  const partnerIds = new Set<string>();
  for (const p of rawPartners) {
    if (
      !record(p) ||
      !validId(p.partnerId) ||
      partnerIds.has(p.partnerId) ||
      !record(p.source) ||
      !textOrNull(p.source.accountKey) ||
      !textOrNull(p.source.sourceEventKey) ||
      !textOrNull(p.source.categoryText) ||
      !textOrNull(p.source.dateText) ||
      !textOrNull(p.source.descriptionText) ||
      !positiveQuantity(p.source.quantity)
    )
      fail("partner");
    partnerIds.add(p.partnerId);
  }
  for (const [alias, canonical] of Object.entries(replayAliases)) {
    if (
      !validId(alias) ||
      !validId(canonical) ||
      alias === canonical ||
      !partnerIds.has(alias) ||
      !partnerIds.has(canonical) ||
      Object.hasOwn(replayAliases, canonical) ||
      BigInt(alias) < BigInt(canonical)
    )
      fail("replay alias");
    const a = rawPartners.find((p) => p.partnerId === alias).source;
    const b = rawPartners.find((p) => p.partnerId === canonical).source;
    if (
      typeof a.sourceEventKey !== "string" ||
      !a.sourceEventKey.trim() ||
      a.sourceEventKey.trim() !== b.sourceEventKey?.trim() ||
      [
        "accountKey",
        "categoryText",
        "dateText",
        "descriptionText",
        "quantity",
      ].some((k) => a[k] !== b[k])
    )
      fail("conflicting replay payload");
  }
  const groups = new Map<string, ReconciliationTruthGroup>();
  const groupedRefs = new Set<string>();
  const groupedPartners = new Set<string>();
  for (const g of rawGroups) {
    if (
      !record(g) ||
      typeof g.key !== "string" ||
      groups.has(g.key) ||
      !strings(g.refIds) ||
      !strings(g.partnerIds) ||
      !g.refIds.length ||
      !g.partnerIds.length ||
      g.refIds.length > 3 ||
      g.partnerIds.length > 3 ||
      (g.refIds.length > 1 && g.partnerIds.length > 1) ||
      !unique(g.refIds) ||
      !unique(g.partnerIds) ||
      !g.refIds.every((id) => refIds.has(id) && !groupedRefs.has(id)) ||
      !g.partnerIds.every(
        (id) =>
          partnerIds.has(id) &&
          !groupedPartners.has(id) &&
          !Object.hasOwn(replayAliases, id),
      ) ||
      g.key !== reconciliationGroupKey(g.refIds, g.partnerIds) ||
      g.family !==
        (g.refIds.length > 1
          ? "rollup"
          : g.partnerIds.length > 1
            ? "split"
            : "singleton")
    )
      fail("group");
    groups.set(g.key, g as unknown as ReconciliationTruthGroup);
    g.refIds.forEach((id) => groupedRefs.add(id));
    g.partnerIds.forEach((id) => groupedPartners.add(id));
  }
  for (const r of rawReferences) {
    if (r.status === "determinate") {
      if (!groups.get(r.groupKey)?.refIds.includes(r.refId))
        fail("determinate group relationship");
    } else if (r.groupKey !== null || groupedRefs.has(r.refId))
      fail("indeterminate group relationship");
  }
  if (
    !["determinate", "ambiguous", "missing"].every((s) =>
      rawReferences.some((r) => r.status === s),
    ) ||
    !rawGroups.some((g) => g.family === "split") ||
    !rawGroups.some((g) => g.family === "rollup")
  )
    fail("empty rubric denominator");
  return input as unknown as ReconciliationTruth;
}

function emptyCounts(): ReconciliationCounts {
  return {
    total: 0,
    high: 0,
    probable: 0,
    ambiguous: 0,
    missing: 0,
    committed: 0,
    correctCommitted: 0,
  };
}
function countDecision(
  counts: ReconciliationCounts,
  confidence: ReconciliationConfidence,
  correct: boolean,
): void {
  counts.total++;
  counts[confidence]++;
  if (confidence === "high" || confidence === "probable") counts.committed++;
  if (correct) counts.correctCommitted++;
}
interface Decision {
  refId: string;
  partnerIds: string[];
  confidence: ReconciliationConfidence;
  score: string;
  explanation: string;
}
/** The coordinator must supply the complete, untruncated result from every grading variant. */
export function assessReconciliation(
  answer: TypedAnswer & { complete?: boolean },
  input: ReconciliationTruth,
): ReconciliationAssessment {
  const truth = validateReconciliationTruth(input);
  const errors: string[] = [];
  const refs = new Map(truth.references.map((r) => [r.refId, r]));
  const partners = new Map(truth.partners.map((p) => [p.partnerId, p]));
  const groups = new Map(truth.groups.map((g) => [g.key, g]));
  const decisions = new Map<string, Decision>();
  const names = ["ref_id", "partner_ids", "confidence", "score", "explanation"];
  if (answer.complete === false) errors.push("The result is incomplete.");
  if (
    answer.fields.length !== names.length ||
    answer.fields.some(
      (f, i) =>
        f.name !== names[i] ||
        (i === 0
          ? f.type !== "Int64"
          : i === 3
            ? !f.type.startsWith("Decimal[") || f.scale !== 4
            : !["Utf8", "LargeUtf8"].includes(f.type)),
    )
  ) {
    errors.push(
      "Output columns must match the declared names, order, and exact SQL types.",
    );
  } else {
    for (let index = 0; index < answer.rows.length; index++) {
      const row = answer.rows[index];
      const [refId, encodedIds, confidence, score, explanation] = row;
      const label = `Row ${index + 1}`;
      if (
        row.length !== 5 ||
        !validId(refId) ||
        !refs.has(refId) ||
        decisions.has(refId)
      ) {
        errors.push(
          `${label}: unknown, duplicate, or invalid reference identity.`,
        );
        continue;
      }
      if (
        typeof encodedIds !== "string" ||
        typeof confidence !== "string" ||
        !Object.hasOwn(confidences, confidence) ||
        typeof score !== "string" ||
        !/^(?:0\.\d{4}|1\.0000)$/.test(score) ||
        typeof explanation !== "string" ||
        [...explanation].length < 1 ||
        [...explanation].length > 1000
      ) {
        errors.push(
          `${label}: invalid partner array, confidence, score, or explanation.`,
        );
        continue;
      }
      let rawIds: unknown;
      try {
        rawIds = JSON.parse(encodedIds);
      } catch {
        errors.push(`${label}: partner_ids is not valid JSON.`);
        continue;
      }
      if (
        !strings(rawIds) ||
        !rawIds.every((id) => validId(id) && partners.has(id)) ||
        !unique(rawIds)
      ) {
        errors.push(
          `${label}: partner IDs must be unique, existing decimal ID strings.`,
        );
        continue;
      }
      if (confidence === "missing" && rawIds.length !== 0)
        errors.push(
          `${label}: missing decisions must have an empty partner array.`,
        );
      if (
        (confidence === "high" || confidence === "probable") &&
        rawIds.length === 0
      )
        errors.push(
          `${label}: committed decisions require at least one partner.`,
        );
      const canonical = [
        ...new Set(rawIds.map((id) => truth.replayAliases[id] ?? id)),
      ].sort(numericOrder);
      decisions.set(refId, {
        refId,
        partnerIds: canonical,
        confidence: confidence as ReconciliationConfidence,
        score,
        explanation,
      });
    }
  }
  for (const refId of refs.keys())
    if (!decisions.has(refId))
      errors.push(`Reference ${refId} requires exactly one valid decision.`);

  // Connected components, not independently credited links, establish the predicted grain.
  const committed = [...decisions.values()].filter(
    (d) => d.confidence === "high" || d.confidence === "probable",
  );
  const byPartner = new Map<string, string[]>();
  for (const d of committed)
    for (const p of d.partnerIds) {
      const members = byPartner.get(p);
      if (members) members.push(d.refId);
      else byPartner.set(p, [d.refId]);
    }
  const visited = new Set<string>();
  const componentKeys = new Map<string, string>();
  const correct = new Set<string>();
  const recovered = new Set<string>();
  for (const start of committed) {
    if (visited.has(start.refId)) continue;
    const pending = [start.refId];
    const componentRefs: string[] = [];
    const componentPartners = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      componentRefs.push(id);
      for (const p of decisions.get(id)!.partnerIds) {
        if (componentPartners.has(p)) continue;
        componentPartners.add(p);
        for (const peer of byPartner.get(p) ?? [])
          if (!visited.has(peer)) pending.push(peer);
      }
    }
    const key = reconciliationGroupKey(componentRefs, [...componentPartners]);
    for (const id of componentRefs) componentKeys.set(id, key);
    const validShape =
      componentRefs.length <= 3 &&
      componentPartners.size > 0 &&
      componentPartners.size <= 3 &&
      !(componentRefs.length > 1 && componentPartners.size > 1);
    if (!validShape)
      errors.push(
        `Forbidden committed component ${key}: use nonempty one-to-one, one-to-many, or many-to-one groups of at most three members.`,
      );
    const expected = groups.get(key);
    if (
      validShape &&
      expected &&
      componentRefs.every(
        (id) =>
          refs.get(id)!.status === "determinate" &&
          refs.get(id)!.groupKey === key,
      )
    ) {
      recovered.add(key);
      componentRefs.forEach((id) => correct.add(id));
    }
  }
  const counts = emptyCounts();
  const byBusinessUnit: Record<string, ReconciliationCounts> =
    Object.create(null);
  const byCategory: Record<string, ReconciliationCounts> = Object.create(null);
  const evidence: ReconciliationEvidence[] = [];
  const falseCommitments: string[] = [];
  const accountBlocks = new Map<string, ReconciliationPartner[]>();
  for (const partner of truth.partners) {
    const account = partner.source.accountKey?.trim().toLowerCase();
    if (!account) continue;
    const block = accountBlocks.get(account);
    if (block) block.push(partner);
    else accountBlocks.set(account, [partner]);
  }
  let incorrectHigh = 0;
  for (const r of truth.references) {
    const d = decisions.get(r.refId);
    if (!d) continue;
    const isCommitted = d.confidence === "high" || d.confidence === "probable";
    const isCorrect = correct.has(r.refId);
    const issues: string[] = [];
    if (isCommitted && !isCorrect) {
      falseCommitments.push(r.refId);
      issues.push(
        "The committed component does not recover the whole truth group.",
      );
    }
    if (d.confidence === "high" && !isCorrect) incorrectHigh++;
    if (r.status !== "determinate" && d.confidence !== r.status) {
      errors.push(
        `Reference ${r.refId}: truth-${r.status} must be labeled ${r.status}.`,
      );
      issues.push(
        `The source evidence is ${r.status}; no commitment is permitted.`,
      );
    }
    if (r.status === "determinate" && !isCorrect)
      issues.push("The determinate truth group was not recovered.");
    countDecision(counts, d.confidence, isCorrect);
    countDecision(
      (byBusinessUnit[r.businessUnit] ??= emptyCounts()),
      d.confidence,
      isCorrect,
    );
    countDecision(
      (byCategory[r.category] ??= emptyCounts()),
      d.confidence,
      isCorrect,
    );
    const sourcePartners = new Map(
      (
        accountBlocks.get(r.source.accountKey?.trim().toLowerCase() ?? "") ?? []
      ).map((p) => [p.partnerId, p]),
    );
    for (const id of d.partnerIds) sourcePartners.set(id, partners.get(id)!);
    const visiblePartners = [...sourcePartners.values()].sort((a, b) =>
      numericOrder(a.partnerId, b.partnerId),
    );
    evidence.push({
      ...d,
      reference: r,
      partners: visiblePartners,
      truthStatus: r.status,
      expectedGroup: r.groupKey ? groups.get(r.groupKey)! : null,
      committedGroupKey: componentKeys.get(r.refId) ?? null,
      correctCommitment: isCorrect,
      issues,
      facts: visiblePartners.map((partner) =>
        reconciliationPairFacts(r, partner),
      ),
    });
  }
  const determinate = truth.references.filter(
    (r) => r.status === "determinate",
  ).length;
  const splits = truth.groups.filter((g) => g.family === "split");
  const rollups = truth.groups.filter((g) => g.family === "rollup");
  const recoveredSplitGroups = splits.filter((g) =>
    recovered.has(g.key),
  ).length;
  const recoveredRollupGroups = rollups.filter((g) =>
    recovered.has(g.key),
  ).length;
  const metrics = {
    committedPrecision: committed.length ? correct.size / committed.length : 0,
    determinateRecall: correct.size / determinate,
    committedCoverage: committed.length / truth.references.length,
    highConfidencePrecision: counts.high
      ? (counts.high - incorrectHigh) / counts.high
      : null,
    splitRecall: recoveredSplitGroups / splits.length,
    rollupRecall: recoveredRollupGroups / rollups.length,
    committed: committed.length,
    correctCommitted: correct.size,
    determinate,
    high: counts.high,
    incorrectHigh,
    recoveredSplitGroups,
    splitGroups: splits.length,
    recoveredRollupGroups,
    rollupGroups: rollups.length,
  };
  // Integer cross-products avoid rounding at the rubric thresholds.
  if (!committed.length || correct.size * 100 < committed.length * 98)
    errors.push("Committed precision must be at least 0.98.");
  if (correct.size * 100 < determinate * 85)
    errors.push("Determinate-match recall must be at least 0.85.");
  if (incorrectHigh)
    errors.push(
      "High-confidence decisions must contain no incorrect commitment.",
    );
  if (recoveredSplitGroups * 100 < splits.length * 80)
    errors.push("Split-family whole-group recall must be at least 0.80.");
  if (recoveredRollupGroups * 100 < rollups.length * 80)
    errors.push("Rollup-family whole-group recall must be at least 0.80.");
  return {
    kind: "reconciliation",
    pass: errors.length === 0,
    errors,
    metrics,
    counts,
    byBusinessUnit,
    byCategory,
    falseCommitments,
    missingCases: truth.references
      .filter((r) => r.status === "missing")
      .map((r) => r.refId),
    ambiguousCases: truth.references
      .filter((r) => r.status === "ambiguous")
      .map((r) => r.refId),
    failedGroups: truth.groups
      .filter((g) => !recovered.has(g.key))
      .map((g) => g.key),
    evidence,
  };
}

/** Guided stage four reports observed coverage, not outcome recall or calibrated probability. */
export function summarizeGuidedReconciliation(
  answer: TypedAnswer,
  input: ReconciliationTruth,
): {
  counts: ReconciliationCounts;
  committedCoverage: number;
  byBusinessUnit: Record<string, ReconciliationCounts>;
  byCategory: Record<string, ReconciliationCounts>;
} {
  const truth = validateReconciliationTruth(input);
  const refs = new Map(truth.references.map((r) => [r.refId, r]));
  const counts = emptyCounts();
  const byBusinessUnit: Record<string, ReconciliationCounts> =
    Object.create(null);
  const byCategory: Record<string, ReconciliationCounts> = Object.create(null);
  const seen = new Set<string>();
  if (
    ["ref_id", "group_key", "confidence", "score", "margin"].some(
      (name, i) => answer.fields[i]?.name !== name,
    ) ||
    answer.fields.length !== 5
  ) {
    throw new Error("Guided reconciliation columns do not match stage four.");
  }
  for (const row of answer.rows) {
    const [id, , confidence] = row;
    if (
      typeof id !== "string" ||
      !refs.has(id) ||
      seen.has(id) ||
      typeof confidence !== "string" ||
      !Object.hasOwn(confidences, confidence)
    ) {
      throw new Error("Invalid guided reconciliation decision.");
    }
    seen.add(id);
    const r = refs.get(id)!;
    const state = confidence as ReconciliationConfidence;
    countDecision(counts, state, false);
    countDecision(
      (byBusinessUnit[r.businessUnit] ??= emptyCounts()),
      state,
      false,
    );
    countDecision((byCategory[r.category] ??= emptyCounts()), state, false);
  }
  if (seen.size !== refs.size)
    throw new Error("Guided reconciliation output is incomplete.");
  return {
    counts,
    committedCoverage: counts.committed / truth.references.length,
    byBusinessUnit,
    byCategory,
  };
}
