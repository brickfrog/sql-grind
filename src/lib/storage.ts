import {
  defaultSettings,
  type Attempt,
  type QueryDocument,
  type Session,
  type Settings,
  type StoredProfile,
} from "./types";
import { sameIdentity, type ContentIdentity } from "./challenges";
import { challengeCompleted } from "./progression";
import {
  sqlHash,
  timingAnswer,
  summarizeTiming,
  validateLabEvidence as assessLabEvidence,
} from "./engine-labs";

const DATABASE = "sql-grind-practice";
const SCHEMA_VERSION = 2;
const STORES = [
  "meta",
  "queries",
  "drafts",
  "attempts",
  "progress",
  "settings",
] as const;
type StoreName = (typeof STORES)[number];
const FORMAT = "sql-grind-practice";
const APPLICATION_VERSION = "0.1.0";
const LEGACY_VERSION_FIELDS = [
  "bundleVersion",
  "challengeVersion",
  "datasetVersion",
  "engineVersion",
];
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_SQL_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

type QueryRecord = Omit<QueryDocument, "updatedAt" | "deletedAt"> & {
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
type LegacyQuery = Omit<QueryRecord, "challenge" | "datasetId" | "lab"> & {
  challengeId?: string;
  bundleVersion: string;
  challengeVersion: string;
  datasetVersion: string;
  engineVersion?: string;
};
type AttemptRecord = Omit<Attempt, "createdAt" | "deletedAt"> & {
  createdAt: string;
  deletedAt?: string;
  documentDeleted: boolean;
};
type LegacyAttempt = Omit<
  AttemptRecord,
  "challenge" | "datasetId" | "assessment" | "deletedAt"
> & {
  challengeId: string;
  bundleVersion: string;
  challengeVersion: string;
  datasetVersion: string;
  engineVersion: string;
  conceptOutcome: "not-evaluated";
};
interface DraftRecord {
  id: string;
  queryId: string;
  sessionId: string;
  document: QueryRecord;
  persistedAt: string;
}
interface ProgressRecord {
  id: string;
  challengeId: string;
  bundleVersion: string;
  hintLevel: number;
  acceptedAttemptId?: string;
  completedAt?: string;
  assistance?: "independent" | "assisted";
  reviewStatus: "recorded" | "historical";
}
interface MetaRecord {
  id: "profile";
  schemaVersion: 2;
  backupFormatVersion: 2;
  installationId: string;
  lastExportAt?: string;
}
type SettingRecord =
  | { id: "preferences"; value: Settings }
  | { id: "session"; value: Session };
interface Payload {
  meta: MetaRecord[];
  queries: QueryRecord[];
  drafts: DraftRecord[];
  attempts: AttemptRecord[];
  progress: ProgressRecord[];
  settings: SettingRecord[];
}

/** All failures carry a stable name and a message suitable for a persistent save-error banner. */
export class PracticeStorageError extends Error {
  constructor(name: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = name;
  }
}
export class DocumentConflictError extends PracticeStorageError {
  constructor(
    public readonly currentDocument: QueryDocument | null,
    public readonly recoveredDocument: QueryDocument,
  ) {
    super(
      "DocumentConflictError",
      "Another tab changed or deleted this query. Your exact draft was saved as a recovered copy; the other version was not replaced. Open My Queries to keep both or choose a version.",
    );
  }
}
function failure(error: unknown): PracticeStorageError {
  if (error instanceof PracticeStorageError) return error;
  const name =
    error instanceof Error || error instanceof DOMException
      ? error.name
      : "StorageError";
  const messages: Record<string, string> = {
    QuotaExceededError:
      "Local storage is full. Your unsaved SQL remains in this tab. Export SQL or a practice backup, open Storage, then explicitly retry. No practice data was deleted.",
    SecurityError:
      "Local practice storage is unavailable in this browser context. Continue in a temporary session and export SQL before closing the tab.",
    InvalidStateError:
      "The practice database connection is closed. Reload this tab before retrying; export unsaved SQL first.",
    VersionError:
      "This practice database was created by a newer SQL Grind version. Open the current application version; this version will not change your data.",
    AbortError:
      "The practice transaction was rolled back. No partial save was committed. Keep this tab open, export unsaved SQL, then retry.",
    UnknownError:
      "The browser could not access local practice storage. Keep this tab open, export unsaved SQL, then retry.",
  };
  return new PracticeStorageError(
    name,
    messages[name] ??
      `Practice storage failed: ${error instanceof Error ? error.message : String(error)}. Keep unsaved work in this tab and export SQL before retrying.`,
    { cause: error },
  );
}
function invalid(message: string): never {
  throw new PracticeStorageError(
    "BackupValidationError",
    `Practice backup rejected: ${message}. No practice data was changed.`,
  );
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
  return promise;
}
function completion(transaction: IDBTransaction): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  transaction.oncomplete = () => resolve();
  transaction.onabort = () =>
    reject(
      transaction.error ??
        new DOMException("Transaction aborted", "AbortError"),
    );
  transaction.onerror = () => {
    /* The abort event owns transaction failure. */
  };
  void promise.catch(() => {});
  return promise;
}
function now(): string {
  return new Date().toISOString();
}
function uid(): string {
  return crypto.randomUUID();
}
function progressId(challengeId: string, bundleVersion: string): string {
  return JSON.stringify([challengeId, bundleVersion]);
}
function toDocument(record: QueryRecord): QueryDocument {
  return {
    id: record.id,
    name: record.name,
    sql: record.sql,
    revision: record.revision,
    version: record.version,
    selection: { ...record.selection },
    scrollTop: record.scrollTop,
    updatedAt: Date.parse(record.updatedAt),
    ...(record.deletedAt === undefined
      ? {}
      : { deletedAt: Date.parse(record.deletedAt) }),
    challenge: record.challenge ? { ...record.challenge } : null,
    datasetId: record.datasetId,
    ...(record.lab === undefined ? {} : { lab: structuredClone(record.lab) }),
    saved: record.saved,
  };
}
function toAttempt(record: AttemptRecord): Attempt {
  return {
    id: record.id,
    documentId: record.documentId,
    revision: record.revision,
    sql: record.sql,
    challenge: { ...record.challenge },
    datasetId: record.datasetId,
    // IDB reads and incoming writes are already detached snapshots.
    ...(record.assessment === undefined
      ? {}
      : { assessment: record.assessment }),
    ...(record.deletedAt === undefined
      ? {}
      : { deletedAt: Date.parse(record.deletedAt) }),
    createdAt: Date.parse(record.createdAt),
    outcome: record.outcome,
    correctness: record.correctness,
    hintLevel: record.hintLevel,
    elapsedMs: record.elapsedMs,
    message: record.message,
  };
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (key) =>
        Object.hasOwn(b, key) &&
        same(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}
function baseProgress(
  challengeId: string,
  bundleVersion: string,
  hintLevel = 0,
): ProgressRecord {
  return {
    id: progressId(challengeId, bundleVersion),
    challengeId,
    bundleVersion,
    hintLevel,
    reviewStatus: "recorded",
  };
}
/** Hint progress uses bundle keys; completion uses full accepted-attempt identities. */
function deriveProgress(
  attempts: AttemptRecord[],
  existing: ProgressRecord[],
): ProgressRecord[] {
  const records = new Map<string, ProgressRecord>();
  for (const p of existing)
    records.set(p.id, {
      ...baseProgress(
        p.challengeId,
        p.bundleVersion,
        Math.max(p.hintLevel, records.get(p.id)?.hintLevel ?? 0),
      ),
      reviewStatus: p.reviewStatus,
    });
  for (const attempt of [...attempts].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    const { challengeId, bundleVersion } = attempt.challenge;
    const id = progressId(challengeId, bundleVersion);
    const p = records.get(id) ?? baseProgress(challengeId, bundleVersion);
    p.hintLevel = Math.max(p.hintLevel, attempt.hintLevel);
    if (attempt.challenge.assessmentVersion === "legacy-assessment-v1")
      p.reviewStatus = "historical";
    if (challengeCompleted(attempt.challenge, [toAttempt(attempt)])) {
      p.acceptedAttemptId = attempt.id;
      p.completedAt = attempt.createdAt;
      p.assistance = attempt.hintLevel ? "assisted" : "independent";
    }
    records.set(id, p);
  }
  return [...records.values()];
}

async function validateAcceptedEvidence(attempt: Attempt): Promise<void> {
  const assessment = attempt.assessment;
  if (!assessment || attempt.correctness !== "correct") return;
  if (assessment.kind === "plan-lab") {
    const { evidence, report } = assessment;
    const hashes = evidence.binding.sqlHashes;
    if (hashes.primary !== (await sqlHash(attempt.sql)))
      invalid("lab evidence does not match the submitted SQL");
    if (
      (report.kind === "pushdown" || report.kind === "selectivity") &&
      hashes.secondary !== (await sqlHash(report.secondarySql))
    )
      invalid("lab evidence does not match the secondary SQL");
    if (
      report.kind === "index" &&
      (hashes.create !== (await sqlHash(report.createSql)) ||
        hashes.drop !== (await sqlHash(report.dropSql)))
    )
      invalid("lab evidence does not match the index commands");
    if (report.kind === "preaggregation") {
      if (
        !evidence.timing ||
        !evidence.fixtures.length ||
        evidence.fixtures.some((fixture) => !fixture.pass)
      )
        invalid("an accepted aggregation lab has incomplete measurements");
      const measured = timingAnswer(
        summarizeTiming(evidence.timing.primary.samples),
        summarizeTiming(evidence.timing.secondary.samples),
      );
      if (
        report.report.lower !== measured.lower ||
        report.report.exceedsMad !== measured.exceedsMad
      )
        invalid("an accepted aggregation report disagrees with measurements");
      return;
    }
    const result = await assessLabEvidence(
      {
        identity: attempt.challenge,
        datasetId: attempt.datasetId,
        previewVariant: evidence.binding.variantId,
        gradingVariants: [
          ...new Set(evidence.fixtures.map((fixture) => fixture.variantId)),
        ],
        sql: attempt.sql,
        document: report,
      },
      evidence,
    );
    if (!result.pass)
      invalid("an accepted lab attempt has invalid evidence or report answers");
  } else {
    const outcomes =
      assessment.kind === "exact"
        ? assessment.fixtures.map((fixture) => fixture.pass)
        : assessment.variants.map((variant) => variant.metrics.pass);
    if (!outcomes.length || outcomes.some((pass) => !pass))
      invalid("an accepted attempt has failed or missing assessment variants");
  }
}

function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("a record is not an object");
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  )
    invalid("a record has missing or unsupported fields");
}
function text(
  value: unknown,
  max = 512,
  empty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!empty && !value.length) ||
    value.length > max ||
    encoder.encode(value).length > max
  )
    invalid(`a string exceeds its ${max}-byte limit or has the wrong type`);
}
function number(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  integer = true,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid("a number is outside its supported range");
}
function bool(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") invalid("a boolean has the wrong type");
}
function oneOf(value: unknown, choices: readonly unknown[]): void {
  if (!choices.includes(value)) invalid("a field has an unsupported value");
}
function date(value: unknown): void {
  text(value, 32);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value)
    invalid("a timestamp is not a UTC ISO timestamp");
}
const IDENTITY_FIELDS = [
  "challengeId",
  "bundleVersion",
  "challengeVersion",
  "datasetVersion",
  "assessmentVersion",
  "engineVersion",
];
function validateIdentity(value: unknown): asserts value is ContentIdentity {
  object(value, IDENTITY_FIELDS);
  for (const key of IDENTITY_FIELDS) text(value[key]);
}
function list(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > 100000)
    invalid("an array is invalid or too large");
}
function stringList(value: unknown, unique = false): asserts value is string[] {
  list(value);
  for (const item of value) text(item, 65536);
  if (unique && new Set(value).size !== value.length)
    invalid("an identifier list contains duplicates");
}
function timing(value: unknown): void {
  object(value, ["median", "mad", "samples"]);
  number(value.median, 0, Number.MAX_SAFE_INTEGER, false);
  number(value.mad, 0, Number.MAX_SAFE_INTEGER, false);
  list(value.samples);
  if (value.samples.length !== 9)
    invalid("a timing measurement must contain nine samples");
  for (const sample of value.samples)
    number(sample, 0, Number.MAX_SAFE_INTEGER, false);
}
function validateLabDocument(value: unknown): void {
  object(value, ["kind", "report"], ["secondarySql", "createSql", "dropSql"]);
  const kind = value.kind;
  oneOf(kind, [
    "cardinality",
    "pushdown",
    "preaggregation",
    "index",
    "selectivity",
  ]);
  const sqlKeys =
    kind === "index"
      ? ["createSql", "dropSql"]
      : kind === "pushdown" || kind === "selectivity"
        ? ["secondarySql"]
        : [];
  object(value, ["kind", "report", ...sqlKeys]);
  for (const key of sqlKeys) text(value[key], MAX_SQL_BYTES, true);
  const fields =
    kind === "cardinality"
      ? ["outputRows", "scanRows"]
      : kind === "pushdown"
        ? ["primary", "secondary"]
        : kind === "index"
          ? ["accessPath"]
          : kind === "selectivity"
            ? ["lower", "exceedsMad", "primary", "secondary"]
            : ["lower", "exceedsMad"];
  object(value.report, [], fields);
  for (const [key, answer] of Object.entries(value.report)) {
    if (key === "outputRows" || key === "scanRows") text(answer, 512, true);
    else if (key === "lower") oneOf(answer, ["primary", "secondary", "equal"]);
    else if (key === "exceedsMad") bool(answer);
    else if (key === "accessPath")
      oneOf(answer, ["index", "sequential", "not-reported"]);
    else if (kind === "pushdown") oneOf(answer, ["reported", "not-reported"]);
    else timing(answer);
  }
}
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 12) invalid("profile projections are too deeply nested");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    text(value, MAX_SQL_BYTES, true);
    return;
  }
  if (typeof value === "number") {
    number(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false);
    return;
  }
  if (!value || typeof value !== "object")
    invalid("profile projections are not JSON data");
  const entries = Object.entries(value);
  if (entries.length > 100000) invalid("profile projections are too large");
  for (const [key, child] of entries) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      invalid("unsafe profile property");
    jsonValue(child, depth + 1);
  }
}
function measurement(value: unknown): void {
  object(value, ["count", "profile"]);
  number(value.count, 0, 100000);
  object(value.profile, ["scans"]);
  list(value.profile.scans);
  for (const scan of value.profile.scans) {
    object(
      scan,
      ["path", "operator", "accessPath", "leaf"],
      ["table", "projections", "rowsScanned", "filters"],
    );
    text(scan.path, 65536);
    text(scan.operator, 65536, true);
    for (const key of ["table", "filters"])
      if (scan[key] !== undefined) text(scan[key], MAX_SQL_BYTES, true);
    if (scan.rowsScanned !== undefined) number(scan.rowsScanned);
    if (scan.projections !== undefined) jsonValue(scan.projections);
    bool(scan.leaf);
    oneOf(scan.accessPath, ["index", "sequential", "not-reported"]);
  }
}
function validateLabEvidence(
  value: unknown,
  identity: ContentIdentity,
  datasetId: unknown,
  accepted: boolean,
): void {
  object(
    value,
    ["kind", "binding", "fixtures", "primary"],
    ["secondary", "timing", "index"],
  );
  oneOf(value.kind, [
    "cardinality",
    "pushdown",
    "preaggregation",
    "index",
    "selectivity",
  ]);
  object(value.binding, ["identity", "datasetId", "variantId", "sqlHashes"]);
  validateIdentity(value.binding.identity);
  text(value.binding.datasetId);
  text(value.binding.variantId);
  if (
    accepted &&
    (!sameIdentity(value.binding.identity, identity) ||
      value.binding.datasetId !== datasetId)
  )
    invalid("lab evidence belongs to different content");
  const paired = ["pushdown", "preaggregation", "selectivity"].includes(
    String(value.kind),
  );
  const slots =
    value.kind === "index"
      ? ["primary", "create", "drop"]
      : paired
        ? ["primary", "secondary"]
        : ["primary"];
  object(value.binding.sqlHashes, slots);
  for (const hash of Object.values(value.binding.sqlHashes)) {
    text(hash, 64);
    if (!/^[a-f0-9]{64}$/.test(hash)) invalid("a SQL hash is malformed");
  }
  list(value.fixtures);
  const fixtures = new Map<string, Set<unknown>>();
  if (!value.fixtures.length) invalid("lab evidence has no grading fixtures");
  for (const fixture of value.fixtures) {
    object(fixture, ["variantId", "slot", "pass"], ["reason"]);
    text(fixture.variantId);
    oneOf(fixture.slot, paired ? ["primary", "secondary"] : ["primary"]);
    bool(fixture.pass);
    const checked = fixtures.get(fixture.variantId) ?? new Set<unknown>();
    if (checked.has(fixture.slot))
      invalid("lab evidence repeats a variant and SQL slot");
    checked.add(fixture.slot);
    fixtures.set(fixture.variantId, checked);
    if (fixture.reason !== undefined) text(fixture.reason, 65536, true);
  }
  if (
    [...fixtures.values()].some((checked) => checked.size !== (paired ? 2 : 1))
  )
    invalid("lab evidence is missing a SQL slot for a variant");
  measurement(value.primary);
  if (paired !== (value.secondary !== undefined))
    invalid("lab measurements do not match the lab kind");
  if (value.secondary !== undefined) measurement(value.secondary);
  if (
    ["preaggregation", "selectivity"].includes(String(value.kind)) !==
    (value.timing !== undefined)
  )
    invalid("lab timing does not match the lab kind");
  if (value.timing !== undefined) {
    object(value.timing, ["primary", "secondary"]);
    timing(value.timing.primary);
    timing(value.timing.secondary);
  }
  if ((value.kind === "index") !== (value.index !== undefined))
    invalid("index evidence does not match the lab kind");
  if (value.index !== undefined) {
    object(value.index, [
      "indexName",
      "before",
      "created",
      "dropped",
      "beforePass",
      "indexedPass",
      "afterPass",
    ]);
    text(value.index.indexName);
    for (const key of ["beforePass", "indexedPass", "afterPass"])
      bool(value.index[key]);
    for (const key of ["before", "created", "dropped"]) {
      const entries = value.index[key];
      list(entries);
      for (const entry of entries) {
        object(entry, [
          "index_name",
          "schema_name",
          "table_name",
          "is_unique",
          "is_primary",
          "expressions",
        ]);
        for (const name of [
          "index_name",
          "schema_name",
          "table_name",
          "expressions",
        ])
          text(entry[name], 65536, true);
        bool(entry.is_unique);
        bool(entry.is_primary);
      }
    }
  }
}
function decimalId(value: unknown): void {
  text(value, 32);
  if (
    !/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value) ||
    BigInt(value) < -(1n << 63n) ||
    BigInt(value) >= 1n << 63n
  )
    invalid("an exact BIGINT identifier is malformed");
}
function nullableText(value: unknown, max = 65536): void {
  if (value !== null) text(value, max, true);
}
function reference(value: unknown): void {
  object(
    value,
    ["refId", "businessUnit", "category", "status", "groupKey", "source"],
    ["family"],
  );
  decimalId(value.refId);
  text(value.businessUnit);
  text(value.category);
  oneOf(value.status, ["determinate", "ambiguous", "missing"]);
  nullableText(value.groupKey);
  if (value.family !== undefined) number(value.family, 1);
  object(value.source, ["accountKey", "eventDate", "description", "quantity"]);
  nullableText(value.source.accountKey);
  text(value.source.eventDate, 32);
  text(value.source.description, 65536, true);
  decimalId(value.source.quantity);
  if (BigInt(String(value.source.quantity)) <= 0n)
    invalid("reference quantity is not positive");
}
function partner(value: unknown): void {
  object(value, ["partnerId", "source"]);
  decimalId(value.partnerId);
  object(value.source, [
    "accountKey",
    "sourceEventKey",
    "categoryText",
    "dateText",
    "descriptionText",
    "quantity",
  ]);
  for (const key of [
    "accountKey",
    "sourceEventKey",
    "categoryText",
    "dateText",
    "descriptionText",
  ])
    nullableText(value.source[key]);
  decimalId(value.source.quantity);
  if (BigInt(String(value.source.quantity)) <= 0n)
    invalid("partner quantity is not positive");
}
function pairFacts(value: unknown): void {
  object(value, [
    "partnerId",
    "normalizedDescription",
    "normalizedCategory",
    "parsedDate",
    "accountMatches",
    "descriptionEditDistance",
    "dateDistanceDays",
    "quantityDifference",
    "categoryMatches",
    "sharedWords",
  ]);
  decimalId(value.partnerId);
  nullableText(value.normalizedDescription);
  nullableText(value.normalizedCategory);
  nullableText(value.parsedDate, 32);
  bool(value.accountMatches);
  for (const key of ["descriptionEditDistance", "dateDistanceDays"])
    if (value[key] !== null) number(value[key]);
  decimalId(value.quantityDifference);
  if (BigInt(String(value.quantityDifference)) < 0n)
    invalid("a quantity difference is negative");
  bool(value.categoryMatches);
  stringList(value.sharedWords, true);
}
function truthGroup(value: unknown): void {
  object(value, ["key", "refIds", "partnerIds", "family"]);
  text(value.key);
  stringList(value.refIds, true);
  stringList(value.partnerIds, true);
  for (const id of [...value.refIds, ...value.partnerIds]) decimalId(id);
  if (
    !value.refIds.length ||
    !value.partnerIds.length ||
    value.refIds.length > 3 ||
    value.partnerIds.length > 3 ||
    (value.refIds.length > 1 && value.partnerIds.length > 1)
  )
    invalid("a truth group has invalid cardinality");
  oneOf(value.family, ["singleton", "split", "rollup"]);
}
function counts(value: unknown): void {
  object(value, [
    "total",
    "high",
    "probable",
    "ambiguous",
    "missing",
    "committed",
    "correctCommitted",
  ]);
  for (const count of Object.values(value)) number(count);
}
function reconciliationMetrics(value: unknown): void {
  object(value, [
    "kind",
    "pass",
    "errors",
    "metrics",
    "counts",
    "byBusinessUnit",
    "byCategory",
    "falseCommitments",
    "missingCases",
    "ambiguousCases",
    "failedGroups",
    "evidence",
  ]);
  oneOf(value.kind, ["reconciliation"]);
  bool(value.pass);
  stringList(value.errors);
  const ratios = [
    "committedPrecision",
    "determinateRecall",
    "committedCoverage",
    "highConfidencePrecision",
    "splitRecall",
    "rollupRecall",
  ];
  object(value.metrics, [
    ...ratios,
    "committed",
    "correctCommitted",
    "determinate",
    "high",
    "incorrectHigh",
    "recoveredSplitGroups",
    "splitGroups",
    "recoveredRollupGroups",
    "rollupGroups",
  ]);
  for (const [key, metric] of Object.entries(value.metrics))
    if (!(key === "highConfidencePrecision" && metric === null))
      number(
        metric,
        0,
        ratios.includes(key) ? 1 : Number.MAX_SAFE_INTEGER,
        !ratios.includes(key),
      );
  counts(value.counts);
  for (const key of ["byBusinessUnit", "byCategory"]) {
    const groups = value[key];
    if (!groups || typeof groups !== "object" || Array.isArray(groups))
      invalid("a count grouping is invalid");
    for (const [label, group] of Object.entries(groups)) {
      text(label, 65536, true);
      counts(group);
    }
  }
  for (const key of [
    "falseCommitments",
    "missingCases",
    "ambiguousCases",
    "failedGroups",
  ])
    stringList(value[key], true);
  list(value.evidence);
  for (const evidence of value.evidence) {
    object(evidence, [
      "refId",
      "confidence",
      "partnerIds",
      "score",
      "explanation",
      "reference",
      "partners",
      "facts",
      "truthStatus",
      "expectedGroup",
      "committedGroupKey",
      "correctCommitment",
      "issues",
    ]);
    decimalId(evidence.refId);
    oneOf(evidence.confidence, ["high", "probable", "ambiguous", "missing"]);
    stringList(evidence.partnerIds, true);
    for (const id of evidence.partnerIds) decimalId(id);
    text(evidence.score, 32);
    text(evidence.explanation, 65536, true);
    reference(evidence.reference);
    list(evidence.partners);
    for (const source of evidence.partners) partner(source);
    list(evidence.facts);
    for (const fact of evidence.facts) pairFacts(fact);
    oneOf(evidence.truthStatus, ["determinate", "ambiguous", "missing"]);
    if (evidence.expectedGroup !== null) truthGroup(evidence.expectedGroup);
    nullableText(evidence.committedGroupKey);
    bool(evidence.correctCommitment);
    stringList(evidence.issues);
  }
}
function validateAssessment(
  value: unknown,
  identity: ContentIdentity,
  datasetId: unknown,
  accepted: boolean,
): void {
  object(value, ["kind"], ["fixtures", "evidence", "report", "variants"]);
  oneOf(value.kind, ["exact", "plan-lab", "reconciliation"]);
  if (value.kind === "exact") {
    object(value, ["kind", "fixtures"]);
    list(value.fixtures);
    for (const fixture of value.fixtures) {
      object(
        fixture,
        ["name", "pass"],
        ["reason", "expectedRows", "actualRows", "elapsedMs"],
      );
      text(fixture.name);
      bool(fixture.pass);
      if (fixture.reason !== undefined) text(fixture.reason, 65536, true);
      for (const key of ["expectedRows", "actualRows", "elapsedMs"])
        if (fixture[key] !== undefined)
          number(fixture[key], 0, Number.MAX_SAFE_INTEGER, key !== "elapsedMs");
    }
  } else if (value.kind === "plan-lab") {
    object(value, ["kind", "evidence", "report"]);
    validateLabDocument(value.report);
    validateLabEvidence(value.evidence, identity, datasetId, accepted);
    object(
      value.report,
      ["kind", "report"],
      ["secondarySql", "createSql", "dropSql"],
    );
    object(
      value.evidence,
      ["kind", "binding", "fixtures", "primary"],
      ["secondary", "timing", "index"],
    );
    if (accepted && value.report.kind !== value.evidence.kind)
      invalid("lab report and measurements have different kinds");
  } else {
    object(value, ["kind", "variants"]);
    list(value.variants);
    const ids = new Set();
    for (const variant of value.variants) {
      object(variant, ["variantId", "metrics"]);
      text(variant.variantId);
      if (ids.has(variant.variantId)) invalid("duplicate assessment variant");
      ids.add(variant.variantId);
      reconciliationMetrics(variant.metrics);
    }
  }
}
function validateSettings(value: unknown): asserts value is Settings {
  // mood and judgeSize were short-lived preferences; stored rows may still
  // carry them. They are tolerated here and dropped by load().
  object(value, Object.keys(defaultSettings), ["layout", "judgeSize", "mood"]);
  number(value.fontSize, 8, 40);
  number(value.indentation, 1, 8);
  for (const key of [
    "hush",
    "wordWrap",
    "readingLayout",
    "announceDiagnostics",
    "judgeVisible",
    "judgeDocked",
  ])
    bool(value[key]);
  if (value.layout !== undefined) {
    object(
      value.layout,
      [
        "showExplorer",
        "showGoal",
        "goalCollapsed",
        "editorHeight",
        "judgeX",
        "judgeY",
        "selectedSkill",
      ],
      [
        "explorerWidth",
        "goalWidth",
        "judgeZoom",
        "viewZoom",
        "goalFloating",
        "goalHeight",
        "goalX",
        "goalY",
      ],
    );
    for (const key of ["showExplorer", "showGoal", "goalCollapsed"])
      bool(value.layout[key]);
    if (value.layout.goalFloating !== undefined)
      bool(value.layout.goalFloating);
    number(value.layout.editorHeight, 120, 650, false);
    for (const key of ["explorerWidth", "goalWidth"])
      if (value.layout[key] !== undefined)
        number(value.layout[key], 180, 480, false);
    if (value.layout.goalHeight !== undefined)
      number(value.layout.goalHeight, 160, 1200, false);
    for (const key of ["judgeX", "judgeY", "goalX", "goalY"])
      if (value.layout[key] !== undefined && value.layout[key] !== null)
        number(value.layout[key], 0, 100000, false);
    if (value.layout.judgeZoom !== undefined)
      number(value.layout.judgeZoom, 0.75, 3, false);
    if (value.layout.viewZoom !== undefined)
      number(value.layout.viewZoom, 0.5, 2, false);
    text(value.layout.selectedSkill);
  }
}
function validateSession(
  value: unknown,
  legacy = false,
): asserts value is Session {
  object(value, ["openIds", "activeId", ...(legacy ? [] : ["openedSkillIds"])]);
  if (!legacy) stringList(value.openedSkillIds, true);
  text(value.activeId, 512, true);
  if (!Array.isArray(value.openIds) || value.openIds.length > 100000)
    invalid("session document identifiers are invalid");
  for (const id of value.openIds) text(id);
  if (
    new Set(value.openIds).size !== value.openIds.length ||
    (value.activeId !== "" && !value.openIds.includes(value.activeId))
  )
    invalid("session active document is not an open document");
}
function validateQuery(
  value: unknown,
  legacy = false,
): asserts value is QueryRecord {
  object(
    value,
    [
      "id",
      "name",
      "sql",
      "revision",
      "version",
      "selection",
      "scrollTop",
      "updatedAt",
      "saved",
      "createdAt",
      ...(legacy
        ? ["bundleVersion", "challengeVersion", "datasetVersion"]
        : ["challenge", "datasetId"]),
    ],
    legacy
      ? ["deletedAt", "challengeId", "engineVersion"]
      : ["deletedAt", "lab"],
  );
  text(value.id);
  text(value.name, 4096);
  text(value.sql, MAX_SQL_BYTES, true);
  number(value.revision);
  number(value.version, 1);
  object(value.selection, ["anchor", "head"]);
  number(value.selection.anchor, 0, value.sql.length);
  number(value.selection.head, 0, value.sql.length);
  number(value.scrollTop, 0, Number.MAX_SAFE_INTEGER, false);
  bool(value.saved);
  date(value.createdAt);
  date(value.updatedAt);
  if (value.deletedAt !== undefined) date(value.deletedAt);
  if (legacy) {
    if (value.challengeId !== undefined) text(value.challengeId);
    for (const key of LEGACY_VERSION_FIELDS)
      if (key !== "engineVersion" || value[key] !== undefined) text(value[key]);
  } else {
    if (value.challenge !== null) validateIdentity(value.challenge);
    text(value.datasetId);
    if (value.lab !== undefined) validateLabDocument(value.lab);
  }
}
function validateAttempt(
  value: unknown,
  legacy = false,
): asserts value is AttemptRecord {
  object(
    value,
    [
      "id",
      "documentId",
      "revision",
      "sql",
      ...(legacy
        ? ["challengeId", "bundleVersion"]
        : ["challenge", "datasetId"]),
      "createdAt",
      "outcome",
      "correctness",
      "hintLevel",
      "elapsedMs",
      "message",
      ...(legacy
        ? [
            "challengeVersion",
            "datasetVersion",
            "engineVersion",
            "conceptOutcome",
          ]
        : []),
      "documentDeleted",
    ],
    legacy ? [] : ["assessment", "deletedAt"],
  );
  for (const key of [
    "id",
    "documentId",
    ...(legacy
      ? [
          "challengeId",
          "bundleVersion",
          "challengeVersion",
          "datasetVersion",
          "engineVersion",
        ]
      : ["datasetId"]),
  ])
    text(value[key]);
  text(value.sql, MAX_SQL_BYTES, true);
  text(value.message, 65536, true);
  number(value.revision);
  number(value.hintLevel, 0, 3);
  number(value.elapsedMs, 0, Number.MAX_SAFE_INTEGER, false);
  date(value.createdAt);
  bool(value.documentDeleted);
  oneOf(value.outcome, [
    "complete",
    "cancelled",
    "timeout",
    "result-limit",
    "engine-error",
  ]);
  oneOf(value.correctness, ["not-evaluated", "correct", "incorrect"]);
  if (legacy) oneOf(value.conceptOutcome, ["not-evaluated"]);
  else {
    validateIdentity(value.challenge);
    if (value.deletedAt !== undefined) date(value.deletedAt);
    if (value.assessment !== undefined)
      validateAssessment(
        value.assessment,
        value.challenge,
        value.datasetId,
        value.correctness === "correct",
      );
  }
  if (value.correctness === "correct" && value.outcome !== "complete")
    invalid("an incomplete attempt claims correctness");
}
function validateProgress(
  value: unknown,
  legacy = false,
): asserts value is ProgressRecord {
  object(
    value,
    [
      "id",
      "challengeId",
      "bundleVersion",
      "hintLevel",
      "reviewStatus",
      ...(legacy ? ["conceptOutcome"] : []),
    ],
    ["acceptedAttemptId", "completedAt", "assistance"],
  );
  text(value.id, 2048);
  text(value.challengeId);
  text(value.bundleVersion);
  number(value.hintLevel, 0, 3);
  if (value.id !== progressId(value.challengeId, value.bundleVersion))
    invalid("a progress identifier does not match its challenge and bundle");
  oneOf(
    value.reviewStatus,
    legacy ? ["preview-no-mastery", "historical"] : ["recorded", "historical"],
  );
  if (legacy) oneOf(value.conceptOutcome, ["not-evaluated"]);
  if (value.acceptedAttemptId !== undefined) {
    text(value.acceptedAttemptId);
    date(value.completedAt);
    oneOf(value.assistance, ["independent", "assisted"]);
  } else if (value.completedAt !== undefined || value.assistance !== undefined)
    invalid("progress claims completion without an attempt");
}
function validatePayload(
  value: unknown,
  legacy = false,
): asserts value is Payload {
  object(value, [...STORES]);
  let total = 0;
  for (const store of STORES) {
    const rows = value[store];
    if (!Array.isArray(rows)) invalid(`${store} is not an array`);
    total += rows.length;
    if (total > 100000) invalid("the total record count exceeds 100,000");
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        ids.has(row.id)
      )
        invalid(`${store} has an invalid or duplicate identifier`);
      ids.add(row.id);
      switch (store) {
        case "queries":
          validateQuery(row, legacy);
          break;
        case "attempts":
          validateAttempt(row, legacy);
          break;
        case "progress":
          validateProgress(row, legacy);
          break;
        case "drafts":
          object(row, [
            "id",
            "queryId",
            "sessionId",
            "document",
            "persistedAt",
          ]);
          text(row.id, 2048);
          text(row.queryId);
          text(row.sessionId);
          date(row.persistedAt);
          validateQuery(row.document, legacy);
          if (row.queryId !== row.document.id)
            invalid("a draft refers to a different document");
          break;
        case "meta":
          object(
            row,
            [
              "id",
              "schemaVersion",
              "backupFormatVersion",
              "installationId",
              ...(legacy ? ["contentVersions"] : []),
            ],
            ["lastExportAt"],
          );
          oneOf(row.id, ["profile"]);
          oneOf(row.schemaVersion, [legacy ? 1 : 2]);
          oneOf(row.backupFormatVersion, [legacy ? 1 : 2]);
          text(row.installationId);
          if (legacy) {
            object(row.contentVersions, LEGACY_VERSION_FIELDS);
            for (const version of Object.values(row.contentVersions))
              text(version);
          }
          if (row.lastExportAt !== undefined) date(row.lastExportAt);
          break;
        case "settings":
          object(row, ["id", "value"]);
          oneOf(row.id, ["preferences", "session"]);
          if (row.id === "preferences") validateSettings(row.value);
          else validateSession(row.value, legacy);
          break;
      }
    }
  }
  const payload = value as unknown as Payload;
  const queries = new Map(payload.queries.map((q) => [q.id, q]));
  const attempts = new Map(payload.attempts.map((a) => [a.id, a]));
  for (const draft of payload.drafts)
    if (!queries.has(draft.queryId)) invalid("a draft has no parent query");
  for (const attempt of payload.attempts)
    if (!queries.has(attempt.documentId) && !attempt.documentDeleted)
      invalid("an attempt has no query or explicit deleted-query marker");
  for (const p of payload.progress) {
    if (!p.acceptedAttemptId) continue;
    const a = attempts.get(p.acceptedAttemptId);
    if (
      !a ||
      a.outcome !== "complete" ||
      a.correctness !== "correct" ||
      (legacy && "challengeId" in a
        ? a.challengeId
        : a.challenge.challengeId) !== p.challengeId ||
      (legacy && "bundleVersion" in a
        ? a.bundleVersion
        : a.challenge.bundleVersion) !== p.bundleVersion ||
      a.deletedAt !== undefined ||
      a.createdAt !== p.completedAt ||
      p.assistance !== (a.hintLevel ? "assisted" : "independent")
    )
      invalid("progress does not match its accepted attempt");
  }
  for (const setting of payload.settings)
    if (setting.id === "session") {
      if (
        setting.value.openIds.some(
          (id) => !queries.has(id) || queries.get(id)!.deletedAt !== undefined,
        )
      )
        invalid("a session refers to a missing or deleted query");
    }
}
function boundedJson(json: string): unknown {
  if (
    typeof json !== "string" ||
    json.length > MAX_BACKUP_BYTES ||
    encoder.encode(json).length > MAX_BACKUP_BYTES
  )
    invalid("the file exceeds 64 MiB");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    invalid("invalid JSON");
  }
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > 20) invalid("nesting exceeds 20 levels");
    if (item.value && typeof item.value === "object") {
      for (const [key, child] of Object.entries(item.value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          invalid("an unsafe property name is present");
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return value;
}
async function digest(payload: string): Promise<string> {
  if (!crypto.subtle)
    throw new PracticeStorageError(
      "StorageUnavailableError",
      "Backup checksums require a secure context. Open SQL Grind on localhost or HTTPS, then retry.",
    );
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function legacyChallengeId(id: string): string {
  return id === "challenge-07" ? "window.03" : id;
}
function historicalIdentity(
  record: Pick<
    LegacyQuery,
    "bundleVersion" | "challengeVersion" | "datasetVersion" | "engineVersion"
  > & { challengeId: string },
): ContentIdentity {
  return {
    challengeId: legacyChallengeId(record.challengeId),
    bundleVersion: record.bundleVersion,
    challengeVersion: record.challengeVersion,
    datasetVersion: record.datasetVersion,
    engineVersion: record.engineVersion ?? "v1.5.4",
    assessmentVersion: "legacy-assessment-v1",
  };
}
function migrateLegacyQuery(record: LegacyQuery): QueryRecord {
  const {
    challengeId,
    bundleVersion,
    challengeVersion,
    datasetVersion,
    engineVersion,
    ...fields
  } = record;
  const challenge =
    challengeId === undefined
      ? null
      : historicalIdentity({
          challengeId,
          bundleVersion,
          challengeVersion,
          datasetVersion,
          engineVersion,
        });
  return {
    ...fields,
    challenge,
    datasetId:
      !challenge || challenge.challengeId === "window.03"
        ? "commerce-ranking"
        : "legacy-unavailable",
  };
}
function migrateV1(input: unknown): Payload {
  validatePayload(input, true);
  // The v1 validator above checks these legacy shapes, not the v2 assertion's nominal type.
  const legacy = input as unknown as {
    meta: (Omit<MetaRecord, "schemaVersion" | "backupFormatVersion"> & {
      schemaVersion: 1;
      backupFormatVersion: 1;
      contentVersions: Record<string, string>;
    })[];
    queries: LegacyQuery[];
    drafts: (Omit<DraftRecord, "document"> & { document: LegacyQuery })[];
    attempts: LegacyAttempt[];
    progress: (Omit<ProgressRecord, "reviewStatus"> & {
      reviewStatus: string;
      conceptOutcome: string;
    })[];
    settings: (
      | { id: "preferences"; value: Settings }
      | { id: "session"; value: Omit<Session, "openedSkillIds"> }
    )[];
  };
  const queries = legacy.queries.map(migrateLegacyQuery);
  const attempts = legacy.attempts.map((record): AttemptRecord => {
    const {
      challengeId,
      bundleVersion,
      challengeVersion,
      datasetVersion,
      engineVersion,
      conceptOutcome: _conceptOutcome,
      ...fields
    } = record;
    const challenge = historicalIdentity({
      challengeId,
      bundleVersion,
      challengeVersion,
      datasetVersion,
      engineVersion,
    });
    return {
      ...fields,
      challenge,
      datasetId:
        challenge.challengeId === "window.03"
          ? "commerce-ranking"
          : "legacy-unavailable",
    };
  });
  const openedSkillIds =
    queries.some((query) => query.challenge?.challengeId === "window.03") ||
    attempts.some((attempt) => attempt.challenge.challengeId === "window.03")
      ? ["window"]
      : [];
  const settings: SettingRecord[] = legacy.settings.map((setting) =>
    setting.id === "preferences"
      ? setting
      : { id: "session", value: { ...setting.value, openedSkillIds } },
  );
  if (
    openedSkillIds.length &&
    !settings.some((setting) => setting.id === "session")
  )
    settings.push({
      id: "session",
      value: { openIds: [], activeId: "", openedSkillIds },
    });
  const result: Payload = {
    meta: legacy.meta.map(({ contentVersions: _contentVersions, ...meta }) => ({
      ...meta,
      schemaVersion: 2,
      backupFormatVersion: 2,
    })),
    queries,
    attempts,
    drafts: legacy.drafts.map((draft) => ({
      ...draft,
      document: migrateLegacyQuery(draft.document),
    })),
    progress: deriveProgress(
      attempts,
      legacy.progress.map((record) => ({
        ...baseProgress(
          legacyChallengeId(record.challengeId),
          record.bundleVersion,
          record.hintLevel,
        ),
        reviewStatus: "historical",
      })),
    ),
    settings,
  };
  validatePayload(result);
  return result;
}

export class PracticeStore {
  private readonly sessionId = uid();
  private channel: BroadcastChannel | null = null;
  private closed = false;
  constructor(
    private readonly database: IDBDatabase,
    private readonly onMessage: (message: string) => void,
    onExternalChange: () => void,
  ) {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(DATABASE);
        this.channel.onmessage = (event) => {
          if (
            event.data?.type === "practice-changed" &&
            event.data.sessionId !== this.sessionId
          )
            onExternalChange();
        };
      } catch {
        this.onMessage(
          "Cross-tab change notifications are unavailable. Version checks still prevent another tab from overwriting your SQL.",
        );
      }
    }
    database.onversionchange = () => {
      this.close();
      this.onMessage(
        "Another SQL Grind tab needs to upgrade practice storage. This connection will close after pending writes finish. Export unsaved SQL, then reload this tab.",
      );
    };
    database.onclose = () => {
      this.closed = true;
      this.onMessage(
        "The browser closed local practice storage. Keep unsaved SQL in this tab, export it, then reload.",
      );
    };
  }
  private async transaction<T>(
    stores: readonly StoreName[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.closed)
      throw failure(new DOMException("Database closed", "InvalidStateError"));
    let transaction: IDBTransaction;
    try {
      transaction = this.database.transaction([...stores], mode);
    } catch (error) {
      throw failure(error);
    }
    const finished = completion(transaction);
    try {
      const result = await work(transaction);
      await finished;
      if (mode === "readwrite") {
        try {
          this.channel?.postMessage({
            type: "practice-changed",
            sessionId: this.sessionId,
          });
        } catch {
          /* A notification failure cannot undo a committed save. */
        }
      }
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already aborted or completed. */
      }
      await finished.catch(() => {});
      throw failure(error);
    }
  }
  private async metadata(transaction: IDBTransaction): Promise<void> {
    const store = transaction.objectStore("meta");
    if (!(await request(store.get("profile"))))
      await request(
        store.put({
          id: "profile",
          schemaVersion: 2,
          backupFormatVersion: 2,
          installationId: uid(),
        } satisfies MetaRecord),
      );
  }
  private async snapshot(transaction: IDBTransaction): Promise<Payload> {
    const values = await Promise.all(
      STORES.map((store) => request(transaction.objectStore(store).getAll())),
    );
    return Object.fromEntries(
      STORES.map((store, index) => [store, values[index]]),
    ) as unknown as Payload;
  }
  private async refreshProgress(transaction: IDBTransaction): Promise<void> {
    const [attempts, previous] = await Promise.all([
      request<AttemptRecord[]>(transaction.objectStore("attempts").getAll()),
      request<ProgressRecord[]>(transaction.objectStore("progress").getAll()),
    ]);
    const store = transaction.objectStore("progress");
    await request(store.clear());
    for (const p of deriveProgress(attempts, previous))
      await request(store.put(p));
  }
  async load(): Promise<StoredProfile> {
    return this.transaction(STORES, "readonly", async (transaction) => {
      const data = await this.snapshot(transaction);
      const preferences = data.settings.find((row) => row.id === "preferences");
      const savedSession = data.settings.find((row) => row.id === "session");
      const hints: Record<string, number> = Object.create(null);
      for (const p of deriveProgress(data.attempts, data.progress))
        hints[p.id] = Math.max(hints[p.id] ?? 0, p.hintLevel);
      const documents = data.queries.map(toDocument);
      const visibleIds = new Set(
        documents.filter((d) => d.deletedAt === undefined).map((d) => d.id),
      );
      const openIds =
        savedSession?.value.openIds.filter((id) => visibleIds.has(id)) ?? [];
      return {
        documents,
        attempts: data.attempts.map(toAttempt),
        hints,
        settings: preferences
          ? (({ judgeSize: _size, mood: _mood, ...rest }) => rest)(
              structuredClone(preferences.value) as Settings & {
                judgeSize?: unknown;
                mood?: unknown;
              },
            )
          : { ...defaultSettings },
        session: {
          openIds,
          activeId:
            savedSession && openIds.includes(savedSession.value.activeId)
              ? savedSession.value.activeId
              : (openIds[0] ?? ""),
          openedSkillIds: [...(savedSession?.value.openedSkillIds ?? [])],
        },
      };
    });
  }
  async saveDocument(
    doc: QueryDocument,
    expectedVersion?: number,
  ): Promise<QueryDocument> {
    const captured = structuredClone(doc);
    const { deletedAt, ...documentFields } = captured;
    if (expectedVersion !== undefined) number(expectedVersion);
    const result = await this.transaction(
      ["meta", "queries", "drafts", "settings"],
      "readwrite",
      async (transaction) => {
        const queries = transaction.objectStore("queries");
        const existing = await request<QueryRecord | undefined>(
          queries.get(captured.id),
        );
        const conflict = existing
          ? expectedVersion === undefined ||
            expectedVersion !== existing.version
          : expectedVersion !== undefined && expectedVersion !== 0;
        const timestamp = now();
        const record: QueryRecord = {
          ...documentFields,
          id: conflict ? uid() : captured.id,
          name: conflict
            ? `${captured.name.slice(0, 900)} (Recovered conflict)`
            : captured.name,
          version: conflict ? 1 : (existing?.version ?? 0) + 1,
          updatedAt: timestamp,
          createdAt: conflict ? timestamp : (existing?.createdAt ?? timestamp),
          ...(deletedAt === undefined
            ? {}
            : { deletedAt: new Date(deletedAt).toISOString() }),
        };
        // Public timestamps are milliseconds; persistent and portable timestamps are ISO UTC.
        if (captured.deletedAt === undefined) delete record.deletedAt;
        if (conflict) {
          delete record.deletedAt;
          record.saved = false;
        }
        validateQuery(record);
        await this.metadata(transaction);
        await request(queries.put(record));
        await request(
          transaction.objectStore("drafts").put({
            id: JSON.stringify([this.sessionId, record.id]),
            queryId: record.id,
            sessionId: this.sessionId,
            document: record,
            persistedAt: timestamp,
          } satisfies DraftRecord),
        );
        if (record.deletedAt !== undefined)
          await this.pruneSession(transaction, new Set([record.id]));
        return {
          document: toDocument(record),
          conflict,
          current: existing ? toDocument(existing) : null,
        };
      },
    );
    if (result.conflict)
      throw new DocumentConflictError(result.current, result.document);
    return result.document;
  }
  async saveSession(session: Session): Promise<void> {
    const captured = structuredClone(session);
    validateSession(captured);
    return this.transaction(
      ["meta", "queries", "settings"],
      "readwrite",
      async (transaction) => {
        const queries = await request<QueryRecord[]>(
          transaction.objectStore("queries").getAll(),
        );
        const ids = new Set(
          queries.filter((q) => q.deletedAt === undefined).map((q) => q.id),
        );
        if (captured.openIds.some((id) => !ids.has(id)))
          throw new PracticeStorageError(
            "SessionConflictError",
            "An open query is not saved or was deleted in another tab. Save its SQL as a new query before saving this session.",
          );
        const previous = await request<
          Extract<SettingRecord, { id: "session" }> | undefined
        >(transaction.objectStore("settings").get("session"));
        captured.openedSkillIds = [
          ...new Set([
            ...(previous?.value.openedSkillIds ?? []),
            ...captured.openedSkillIds,
          ]),
        ];
        await this.metadata(transaction);
        await request(
          transaction
            .objectStore("settings")
            .put({ id: "session", value: captured } satisfies SettingRecord),
        );
      },
    );
  }
  async markSkillOpened(skillId: string): Promise<void> {
    text(skillId);
    return this.transaction(
      ["meta", "settings"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("settings");
        const row = await request<
          Extract<SettingRecord, { id: "session" }> | undefined
        >(store.get("session"));
        const value = row?.value ?? {
          openIds: [],
          activeId: "",
          openedSkillIds: [],
        };
        if (value.openedSkillIds.includes(skillId)) return;
        value.openedSkillIds.push(skillId);
        await this.metadata(transaction);
        await request(
          store.put({ id: "session", value } satisfies SettingRecord),
        );
      },
    );
  }
  async saveSettings(settings: Settings): Promise<void> {
    const captured = structuredClone(settings);
    validateSettings(captured);
    return this.transaction(
      ["meta", "settings"],
      "readwrite",
      async (transaction) => {
        await this.metadata(transaction);
        await request(
          transaction.objectStore("settings").put({
            id: "preferences",
            value: captured,
          } satisfies SettingRecord),
        );
      },
    );
  }
  async revealHint(identity: ContentIdentity, level: number): Promise<void> {
    validateIdentity(identity);
    const { challengeId, bundleVersion } = identity;
    number(level, 0, 3);
    return this.transaction(
      ["meta", "progress"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("progress");
        const p =
          (await request<ProgressRecord | undefined>(
            store.get(progressId(challengeId, bundleVersion)),
          )) ?? baseProgress(challengeId, bundleVersion);
        p.hintLevel = Math.max(p.hintLevel, level);
        await this.metadata(transaction);
        await request(store.put(p));
      },
    );
  }
  async recordAttempt(attempt: Attempt): Promise<void> {
    const captured = structuredClone(attempt);
    const { deletedAt, ...fields } = captured;
    const record: AttemptRecord = {
      ...fields,
      createdAt: new Date(captured.createdAt).toISOString(),
      ...(deletedAt === undefined
        ? {}
        : { deletedAt: new Date(deletedAt).toISOString() }),
      documentDeleted: true,
    };
    validateAttempt(record);
    await validateAcceptedEvidence(captured);
    return this.transaction(
      ["meta", "queries", "attempts", "progress"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("attempts");
        const existing = await request<AttemptRecord | undefined>(
          store.get(captured.id),
        );
        if (existing) {
          if (same(toAttempt(existing), captured)) return;
          throw new PracticeStorageError(
            "AttemptConflictError",
            "This run identifier already has a different immutable attempt. The previous attempt was kept. Retry with a new run identifier.",
          );
        }
        const document = await request<QueryRecord | undefined>(
          transaction.objectStore("queries").get(captured.documentId),
        );
        record.documentDeleted = !document;
        await this.metadata(transaction);
        await request(store.add(record));
        await this.refreshProgress(transaction);
      },
    );
  }
  async deleteAttempt(id: string): Promise<void> {
    text(id);
    return this.transaction(
      ["attempts", "progress"],
      "readwrite",
      async (transaction) => {
        await request(transaction.objectStore("attempts").delete(id));
        await this.refreshProgress(transaction);
      },
    );
  }
  private async markDeleted(id: string, deleted: boolean): Promise<void> {
    return this.transaction(
      ["queries", "drafts", "settings"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("queries");
        const record = await request<QueryRecord | undefined>(store.get(id));
        if (!record)
          throw new PracticeStorageError(
            "DocumentNotFoundError",
            "This query no longer exists. Reload My Queries; unsaved SQL can still be saved under a new identifier.",
          );
        if ((record.deletedAt !== undefined) === deleted) return;
        record.version++;
        record.updatedAt = now();
        if (deleted) record.deletedAt = record.updatedAt;
        else delete record.deletedAt;
        await request(store.put(record));
        const drafts = await request<DraftRecord[]>(
          transaction.objectStore("drafts").getAll(),
        );
        for (const draft of drafts)
          if (draft.queryId === id) {
            if (deleted) draft.document.deletedAt = record.deletedAt;
            else delete draft.document.deletedAt;
            await request(transaction.objectStore("drafts").put(draft));
          }
        if (deleted) await this.pruneSession(transaction, new Set([id]));
      },
    );
  }
  deleteDocument(id: string): Promise<void> {
    return this.markDeleted(id, true);
  }
  restoreDocument(id: string): Promise<void> {
    return this.markDeleted(id, false);
  }
  private async pruneSession(
    transaction: IDBTransaction,
    ids: Set<string>,
  ): Promise<void> {
    const store = transaction.objectStore("settings");
    const session = await request<
      Extract<SettingRecord, { id: "session" }> | undefined
    >(store.get("session"));
    if (!session) return;
    session.value.openIds = session.value.openIds.filter((id) => !ids.has(id));
    if (!session.value.openIds.includes(session.value.activeId))
      session.value.activeId = session.value.openIds[0] ?? "";
    await request(store.put(session));
  }
  private async removeQueries(
    transaction: IDBTransaction,
    ids: Set<string>,
    includeAttempts: boolean,
  ): Promise<void> {
    for (const id of ids)
      await request(transaction.objectStore("queries").delete(id));
    const drafts = await request<DraftRecord[]>(
      transaction.objectStore("drafts").getAll(),
    );
    for (const draft of drafts)
      if (ids.has(draft.queryId))
        await request(transaction.objectStore("drafts").delete(draft.id));
    const attempts = await request<AttemptRecord[]>(
      transaction.objectStore("attempts").getAll(),
    );
    for (const attempt of attempts)
      if (ids.has(attempt.documentId)) {
        if (includeAttempts)
          await request(transaction.objectStore("attempts").delete(attempt.id));
        else {
          attempt.documentDeleted = true;
          await request(transaction.objectStore("attempts").put(attempt));
        }
      }
    await this.pruneSession(transaction, ids);
    await this.refreshProgress(transaction);
  }
  permanentlyDeleteDocument(
    id: string,
    includeAttempts = false,
  ): Promise<void> {
    return this.transaction(
      ["queries", "drafts", "attempts", "progress", "settings"],
      "readwrite",
      (transaction) =>
        this.removeQueries(transaction, new Set([id]), includeAttempts),
    );
  }
  emptyBin(): Promise<void> {
    return this.transaction(
      ["queries", "drafts", "attempts", "progress", "settings"],
      "readwrite",
      async (transaction) => {
        const queries = await request<QueryRecord[]>(
          transaction.objectStore("queries").getAll(),
        );
        await this.removeQueries(
          transaction,
          new Set(
            queries.filter((q) => q.deletedAt !== undefined).map((q) => q.id),
          ),
          false,
        );
      },
    );
  }
  async exportBackup(): Promise<string> {
    const data = await this.transaction(STORES, "readonly", (transaction) =>
      this.snapshot(transaction),
    );
    const exportedAt = now();
    data.progress = deriveProgress(data.attempts, data.progress);
    for (const meta of data.meta) meta.lastExportAt = exportedAt;
    validatePayload(data);
    for (const attempt of data.attempts)
      await validateAcceptedEvidence(toAttempt(attempt));
    const payload = JSON.stringify(data);
    const json = JSON.stringify({
      format: FORMAT,
      formatVersion: 2,
      exportedAt,
      applicationVersion: APPLICATION_VERSION,
      payload,
      sha256: await digest(payload),
    });
    if (encoder.encode(json).length > MAX_BACKUP_BYTES)
      throw new PracticeStorageError(
        "BackupLimitError",
        "This library exceeds the 64 MiB backup limit. Export individual queries as SQL instead. No practice data was changed.",
      );
    await this.transaction(["meta"], "readwrite", async (transaction) => {
      const store = transaction.objectStore("meta");
      const meta = await request<MetaRecord | undefined>(store.get("profile"));
      if (meta) {
        meta.lastExportAt = exportedAt;
        await request(store.put(meta));
      }
    });
    return json;
  }
  async importBackup(json: string): Promise<void> {
    const envelope = boundedJson(json);
    object(
      envelope,
      [
        "format",
        "formatVersion",
        "exportedAt",
        "applicationVersion",
        "payload",
        "sha256",
      ],
      ["contentVersions"],
    );
    oneOf(envelope.format, [FORMAT]);
    oneOf(envelope.formatVersion, [1, 2]);
    object(envelope, [
      "format",
      "formatVersion",
      "exportedAt",
      "applicationVersion",
      "payload",
      "sha256",
      ...(envelope.formatVersion === 1 ? ["contentVersions"] : []),
    ]);
    date(envelope.exportedAt);
    text(envelope.applicationVersion);
    if (envelope.formatVersion === 1) {
      object(envelope.contentVersions, LEGACY_VERSION_FIELDS);
      for (const version of Object.values(envelope.contentVersions))
        text(version);
    }
    text(envelope.payload, MAX_BACKUP_BYTES, true);
    text(envelope.sha256, 64);
    if (
      !/^[a-f0-9]{64}$/.test(envelope.sha256) ||
      (await digest(envelope.payload)) !== envelope.sha256
    )
      invalid("the SHA-256 checksum does not match");
    const parsed = boundedJson(envelope.payload);
    const incoming = envelope.formatVersion === 1 ? migrateV1(parsed) : parsed;
    validatePayload(incoming);
    for (const attempt of incoming.attempts)
      await validateAcceptedEvidence(toAttempt(attempt));
    await this.transaction(STORES, "readwrite", async (transaction) => {
      const local = await this.snapshot(transaction);
      const queries = new Map(local.queries.map((q) => [q.id, q]));
      const attempts = new Map(local.attempts.map((a) => [a.id, a]));
      const drafts = new Map(local.drafts.map((d) => [d.id, d]));
      const queryIds = new Map<string, string>();
      const attemptIds = new Map<string, string>();
      const reserved = new Set(
        [
          ...local.queries,
          ...incoming.queries,
          ...local.attempts,
          ...incoming.attempts,
          ...local.drafts,
          ...incoming.drafts,
        ].map((record) => record.id),
      );
      const newId = () => {
        let id = uid();
        while (reserved.has(id)) id = uid();
        reserved.add(id);
        return id;
      };
      for (const source of incoming.queries) {
        const record = structuredClone(source),
          existing = queries.get(record.id);
        if (existing && !same(existing, record)) {
          record.id = newId();
          record.name = `${record.name.slice(0, 900)} (Imported conflict)`;
        }
        queryIds.set(source.id, record.id);
        queries.set(record.id, record);
      }
      // Historical attempts may outlive their query. Never attach an imported
      // orphan to an unrelated local query that happens to share its old ID.
      for (const source of incoming.attempts)
        if (!queryIds.has(source.documentId) && queries.has(source.documentId))
          queryIds.set(source.documentId, newId());
      for (const source of incoming.attempts) {
        const record = structuredClone(source);
        record.documentId =
          queryIds.get(record.documentId) ?? record.documentId;
        const existing = attempts.get(record.id);
        if (existing && !same(existing, record)) {
          record.id = newId();
          record.message = `${record.message.slice(0, 15000)}\nImported conflict: preserved alongside the local attempt.`;
        }
        attemptIds.set(source.id, record.id);
        attempts.set(record.id, record);
      }
      for (const source of incoming.drafts) {
        const record = structuredClone(source);
        record.queryId = queryIds.get(record.queryId)!;
        record.document.id = record.queryId;
        if (record.queryId !== source.queryId)
          record.document.name = `${record.document.name.slice(0, 900)} (Imported conflict)`;
        const existing = drafts.get(record.id);
        if (existing && !same(existing, record)) record.id = newId();
        drafts.set(record.id, record);
      }
      const progress = [
        ...local.progress,
        ...incoming.progress.map((source) => ({
          ...source,
          ...(source.acceptedAttemptId
            ? { acceptedAttemptId: attemptIds.get(source.acceptedAttemptId)! }
            : {}),
        })),
      ];
      const merged: Payload = {
        meta: local.meta.length ? local.meta : incoming.meta,
        queries: [...queries.values()],
        attempts: [...attempts.values()],
        drafts: [...drafts.values()],
        progress: deriveProgress([...attempts.values()], progress),
        settings: [...local.settings],
      };
      for (const setting of incoming.settings)
        if (
          !merged.settings.some(
            (localSetting) => localSetting.id === setting.id,
          )
        ) {
          if (setting.id === "preferences")
            merged.settings.push(structuredClone(setting));
          else {
            const openIds = setting.value.openIds.map(
              (id) => queryIds.get(id)!,
            );
            merged.settings.push({
              id: "session",
              value: {
                openIds,
                activeId: setting.value.activeId
                  ? queryIds.get(setting.value.activeId)!
                  : "",
                openedSkillIds: [...setting.value.openedSkillIds],
              },
            });
          }
        }
      const mergedSession = merged.settings.find(
        (setting) => setting.id === "session",
      );
      const incomingSession = incoming.settings.find(
        (setting) => setting.id === "session",
      );
      if (mergedSession && incomingSession) {
        mergedSession.value.openedSkillIds = [
          ...new Set([
            ...mergedSession.value.openedSkillIds,
            ...incomingSession.value.openedSkillIds,
          ]),
        ];
        mergedSession.value.openIds = [
          ...new Set([
            ...mergedSession.value.openIds,
            ...incomingSession.value.openIds.map((id) => queryIds.get(id)!),
          ]),
        ];
        if (!mergedSession.value.activeId && incomingSession.value.activeId)
          mergedSession.value.activeId = queryIds.get(
            incomingSession.value.activeId,
          )!;
      }
      validatePayload(merged);
      for (const store of STORES)
        for (const record of merged[store])
          await request(transaction.objectStore(store).put(record));
      await this.metadata(transaction);
    });
  }
  clearPracticeData(): Promise<void> {
    return this.transaction(STORES, "readwrite", async (transaction) => {
      for (const store of STORES)
        await request(transaction.objectStore(store).clear());
    });
  }
  close(): void {
    this.closed = true;
    this.channel?.close();
    this.channel = null;
    this.database.close();
  }
}

export async function openPracticeStore(
  onMessage: (message: string) => void,
  onExternalChange: () => void,
): Promise<PracticeStore> {
  if (typeof indexedDB === "undefined")
    throw new PracticeStorageError(
      "StorageUnavailableError",
      "IndexedDB is unavailable. This is a temporary session: export SQL before closing the tab.",
    );
  const { promise, resolve, reject } = Promise.withResolvers<PracticeStore>();
  let open: IDBOpenDBRequest;
  let settled = false;
  try {
    open = indexedDB.open(DATABASE, SCHEMA_VERSION);
  } catch (error) {
    throw failure(error);
  }
  open.onupgradeneeded = (event) => {
    const database = open.result;
    // Retain every published migration here; never rebuild stores to recover from an error.
    const upgrade = async () => {
      if (event.oldVersion < 1) {
        for (const store of STORES)
          database.createObjectStore(store, { keyPath: "id" });
      } else if (event.oldVersion < 2) {
        const transaction = open.transaction!;
        const rows = await Promise.all(
          STORES.map((store) =>
            request(transaction.objectStore(store).getAll()),
          ),
        );
        const migrated = migrateV1(
          Object.fromEntries(
            STORES.map((store, index) => [store, rows[index]]),
          ),
        );
        for (const store of STORES) {
          await request(transaction.objectStore(store).clear());
          for (const record of migrated[store])
            await request(transaction.objectStore(store).put(record));
        }
      }
    };
    void upgrade().catch((error) => {
      open.transaction?.abort();
      settled = true;
      reject(
        new PracticeStorageError(
          "MigrationError",
          "The practice database upgrade failed and was rolled back. Keep your data intact and use the previous compatible release to export a backup.",
          { cause: error },
        ),
      );
    });
  };
  open.onblocked = () => {
    const error = new PracticeStorageError(
      "StorageBlockedError",
      "Another SQL Grind tab is blocking the practice database upgrade. Close other SQL Grind tabs, then retry opening storage. No data was cleared.",
    );
    settled = true;
    reject(error);
    onMessage(error.message);
  };
  open.onerror = () => {
    if (!settled) {
      settled = true;
      reject(failure(open.error));
    }
  };
  open.onsuccess = () => {
    if (settled) {
      open.result.close();
      return;
    }
    settled = true;
    try {
      resolve(new PracticeStore(open.result, onMessage, onExternalChange));
    } catch (error) {
      open.result.close();
      reject(failure(error));
    }
  };
  return promise;
}
