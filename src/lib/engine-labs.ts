import type { ContentIdentity } from "./challenges";
import { admit, tokens } from "./engine-diagnostics";
import { normalizeProfile, type NormalizedProfile } from "./engine-profile";

export type LabKind =
  | "cardinality"
  | "pushdown"
  | "preaggregation"
  | "index"
  | "selectivity";
export type SqlSlot = "primary" | "secondary" | "create" | "drop";
export type Reported = "reported" | "not-reported";
export type AccessPath = "index" | "sequential" | "not-reported";
export type LowerMedian = "primary" | "secondary" | "equal";
export interface TimingSummary {
  median: number;
  mad: number;
  samples: number[];
}
export type LabDocument =
  | { kind: "cardinality"; report: { outputRows?: string; scanRows?: string } }
  | {
      kind: "pushdown";
      secondarySql: string;
      report: { primary?: Reported; secondary?: Reported };
    }
  | {
      kind: "preaggregation";
      report: { lower?: LowerMedian; exceedsMad?: boolean };
    }
  | {
      kind: "index";
      createSql: string;
      dropSql: string;
      report: { accessPath?: AccessPath };
    }
  | {
      kind: "selectivity";
      secondarySql: string;
      report: {
        lower?: LowerMedian;
        exceedsMad?: boolean;
        primary?: TimingSummary;
        secondary?: TimingSummary;
      };
    };

export function extractProfile(result: {
  count: number;
  getRow(index: number): (string | null)[];
}): unknown {
  for (let index = 0; index < result.count; index++) {
    for (const cell of result.getRow(index)) {
      if (typeof cell === "string" && cell.trim().startsWith("{")) {
        const profile: unknown = JSON.parse(cell);
        normalizeProfile(profile);
        return profile;
      }
    }
  }
  throw new Error("The engine did not return a JSON profile.");
}

export function scanRows(profile: NormalizedProfile): string {
  const leaves = profile.scans.filter((scan) => scan.leaf);
  if (!leaves.length || leaves.some((scan) => scan.rowsScanned === undefined))
    return "not-reported";
  return leaves
    .reduce((sum, scan) => sum + BigInt(scan.rowsScanned!), 0n)
    .toString();
}
export function filterReported(profile: NormalizedProfile): Reported {
  return profile.scans.some((scan) => scan.filters !== undefined)
    ? "reported"
    : "not-reported";
}
export function accessPath(profile: NormalizedProfile): AccessPath {
  // EXPLAIN ANALYZE can qualify the table with its catalog and schema.
  const scans = profile.scans.filter(
    (scan) =>
      scan.table === "lookup_orders" || scan.table?.endsWith(".lookup_orders"),
  );
  if (scans.some((scan) => scan.accessPath === "index")) return "index";
  if (scans.length && scans.every((scan) => scan.accessPath === "sequential"))
    return "sequential";
  return "not-reported";
}
const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function summarizeTiming(samples: number[]): TimingSummary {
  if (
    samples.length !== 9 ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error(
      "The comparison needs nine complete timing samples for each query.",
    );
  const center = median(samples);
  return {
    median: center,
    mad: median(samples.map((value) => Math.abs(value - center))),
    samples: [...samples],
  };
}
export function timingAnswer(
  primary: TimingSummary,
  secondary: TimingSummary,
): { lower: LowerMedian; exceedsMad: boolean } {
  return {
    lower:
      primary.median < secondary.median
        ? "primary"
        : primary.median > secondary.median
          ? "secondary"
          : "equal",
    exceedsMad:
      Math.abs(primary.median - secondary.median) > primary.mad + secondary.mad,
  };
}

export interface LabBinding {
  identity: ContentIdentity;
  datasetId: string;
  variantId: string;
  sqlHashes: Partial<Record<SqlSlot, string>>;
}
export interface LabFixture {
  variantId: string;
  slot: "primary" | "secondary";
  pass: boolean;
  reason?: string;
}
export interface LabMeasurement {
  count: number;
  profile: NormalizedProfile;
}
export interface IndexCatalogEntry {
  index_name: string;
  schema_name: string;
  table_name: string;
  is_unique: boolean;
  is_primary: boolean;
  expressions: string;
}
export interface IndexSequenceEvidence {
  indexName: string;
  before: IndexCatalogEntry[];
  created: IndexCatalogEntry[];
  dropped: IndexCatalogEntry[];
  beforePass: boolean;
  indexedPass: boolean;
  afterPass: boolean;
}
export interface LabEvidence {
  kind: LabKind;
  binding: LabBinding;
  fixtures: LabFixture[];
  primary: LabMeasurement;
  secondary?: LabMeasurement;
  timing?: { primary: TimingSummary; secondary: TimingSummary };
  index?: IndexSequenceEvidence;
}
export interface LabRequest {
  identity: ContentIdentity;
  datasetId: string;
  previewVariant: string;
  gradingVariants: string[];
  sql: string;
  document: LabDocument;
  /** The verified authored baseline for preaggregation, not learner-controlled SQL. */
  baselineSql?: string;
}
const identityFields = [
  "challengeId",
  "bundleVersion",
  "challengeVersion",
  "datasetVersion",
  "assessmentVersion",
  "engineVersion",
] as const;
export async function sqlHash(sql: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sql),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function labQueries(
  request: LabRequest,
): Partial<Record<SqlSlot, string>> {
  const document = request.document;
  const queries: Partial<Record<SqlSlot, string>> = { primary: request.sql };
  if (document.kind === "pushdown" || document.kind === "selectivity")
    queries.secondary = document.secondarySql;
  if (document.kind === "preaggregation") {
    if (!request.baselineSql)
      throw new Error("The verified baseline SQL is missing.");
    queries.secondary = request.baselineSql;
  }
  if (document.kind === "index") {
    queries.create = document.createSql;
    queries.drop = document.dropSql;
  }
  return queries;
}
export async function labBinding(request: LabRequest): Promise<LabBinding> {
  const sqlHashes: Partial<Record<SqlSlot, string>> = {};
  await Promise.all(
    Object.entries(labQueries(request)).map(async ([slot, sql]) => {
      sqlHashes[slot as SqlSlot] = await sqlHash(sql);
    }),
  );
  return {
    identity: { ...request.identity },
    datasetId: request.datasetId,
    variantId: request.previewVariant,
    sqlHashes,
  };
}
export async function evidenceMatches(
  request: LabRequest,
  evidence: LabEvidence,
): Promise<boolean> {
  const expected = await labBinding(request),
    actual = evidence.binding;
  return (
    evidence.kind === request.document.kind &&
    identityFields.every(
      (field) => expected.identity[field] === actual.identity[field],
    ) &&
    expected.datasetId === actual.datasetId &&
    expected.variantId === actual.variantId &&
    Object.keys(expected.sqlHashes).length ===
      Object.keys(actual.sqlHashes).length &&
    Object.entries(expected.sqlHashes).every(
      ([slot, hash]) => actual.sqlHashes[slot as SqlSlot] === hash,
    )
  );
}

/** Token admission limits the command grammar before DuckDB parses the statement. */
export function admitIndexCommand(
  sql: string,
  operation: "create" | "drop",
  expectedName?: string,
): { sql: string; indexName: string } {
  const admitted = admit(sql, "sandbox"),
    parts = tokens(admitted);
  const keyword = (index: number, text: string) =>
    parts[index]?.text === text && !parts[index].quoted;
  const identifier = (index: number): string | undefined => {
    const token = parts[index];
    if (!token) return undefined;
    if (token.quoted)
      return token.text.startsWith('"')
        ? token.text.slice(1, -1).replaceAll('""', '"').toLowerCase()
        : undefined;
    return /^[A-Z_][A-Z_0-9]*$/.test(token.text)
      ? token.text.toLowerCase()
      : undefined;
  };
  const name = identifier(2);
  const valid =
    operation === "create"
      ? parts.length === 8 &&
        keyword(0, "CREATE") &&
        keyword(1, "INDEX") &&
        keyword(3, "ON") &&
        identifier(4) === "lookup_orders" &&
        keyword(5, "(") &&
        identifier(6) === "customer_id" &&
        keyword(7, ")")
      : parts.length === 3 &&
        keyword(0, "DROP") &&
        keyword(1, "INDEX") &&
        name === expectedName;
  if (!valid || !name)
    throw new Error(
      operation === "create"
        ? "Create one non-unique index on lookup_orders(customer_id)."
        : "Drop the index that this lab created.",
    );
  return { sql: admitted, indexName: name };
}
function createdIndexValid(
  created: IndexCatalogEntry[],
  indexName: string,
): boolean {
  if (created.length !== 1) return false;
  const index = created[0];
  return (
    index.index_name.toLowerCase() === indexName &&
    index.schema_name === "main" &&
    index.table_name === "lookup_orders" &&
    index.is_unique === false &&
    index.is_primary === false &&
    /^\[\s*(?:customer_id|"customer_id"|'customer_id')\s*\]$/i.test(
      index.expressions,
    )
  );
}
export function indexSequenceValid(sequence: IndexSequenceEvidence): boolean {
  return (
    sequence.before.length === 0 &&
    sequence.dropped.length === 0 &&
    sequence.beforePass &&
    sequence.indexedPass &&
    sequence.afterPass &&
    createdIndexValid(sequence.created, sequence.indexName)
  );
}

export async function validateLabEvidence(
  request: LabRequest,
  evidence: LabEvidence,
): Promise<{ pass: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  if (!(await evidenceMatches(request, evidence)))
    reasons.push(
      "The SQL or content changed. Measure the current queries again.",
    );
  const secondary =
    request.document.kind === "pushdown" ||
    request.document.kind === "preaggregation" ||
    request.document.kind === "selectivity";
  const slots = secondary
    ? (["primary", "secondary"] as const)
    : (["primary"] as const);
  if (
    !request.gradingVariants.length ||
    new Set(request.gradingVariants).size !== request.gradingVariants.length
  )
    reasons.push("The grading variants are invalid.");
  for (const variant of request.gradingVariants)
    for (const slot of slots) {
      const checks = evidence.fixtures.filter(
        (check) => check.variantId === variant && check.slot === slot,
      );
      if (checks.length !== 1 || !checks[0].pass)
        reasons.push(`The ${slot} query must pass ${variant}.`);
    }
  const document = request.document;
  if (document.kind === "cardinality") {
    if (document.report.outputRows !== String(evidence.primary.count))
      reasons.push("The output row count does not match the complete result.");
    if (document.report.scanRows !== scanRows(evidence.primary.profile))
      reasons.push("The scan row report does not match the leaf scan metrics.");
  } else if (document.kind === "pushdown") {
    if (
      document.report.primary !== filterReported(evidence.primary.profile) ||
      !evidence.secondary ||
      document.report.secondary !== filterReported(evidence.secondary.profile)
    )
      reasons.push("The filter reports do not match the profiles.");
  } else if (document.kind === "index") {
    if (!evidence.index || !indexSequenceValid(evidence.index))
      reasons.push(
        "Complete the CREATE, probe, and DROP sequence in the disposable sandbox.",
      );
    if (document.report.accessPath !== accessPath(evidence.primary.profile))
      reasons.push("The access path report does not match the scan profile.");
  } else {
    if (!evidence.timing || !evidence.secondary)
      reasons.push(
        "Both queries need complete profiles and nine timing pairs.",
      );
    else {
      const primary = summarizeTiming(evidence.timing.primary.samples),
        secondaryTiming = summarizeTiming(evidence.timing.secondary.samples);
      const answer = timingAnswer(primary, secondaryTiming);
      if (
        document.report.lower !== answer.lower ||
        document.report.exceedsMad !== answer.exceedsMad
      )
        reasons.push(
          "The comparison report does not match the median and MAD measurements.",
        );
      if (document.kind === "selectivity") {
        for (const [reported, measured] of [
          [document.report.primary, primary],
          [document.report.secondary, secondaryTiming],
        ] as const)
          if (
            !reported ||
            reported.median !== measured.median ||
            reported.mad !== measured.mad
          )
            reasons.push(
              "Select the measured median and MAD values into the report.",
            );
      }
    }
  }
  return { pass: reasons.length === 0, reasons };
}

export interface LabQueryMeasurement {
  complete: boolean;
  count: number;
  profile: unknown;
}
export interface IndexLabSession {
  /** Trusted catalog query: SELECT index_name,schema_name,table_name,is_unique,is_primary,expressions FROM duckdb_indexes(). */
  catalog(): Promise<IndexCatalogEntry[]>;
  command(sql: string): Promise<void>;
  check(sql: string): Promise<boolean>;
  measure(sql: string): Promise<LabQueryMeasurement>;
  close(): Promise<void>;
}
/** All methods use the coordinator's admission, Work cancellation, limits, and fresh workers. */
export interface LabHost {
  /** Verify the reference against its typed expected asset before comparing the learner. Throw on content/engine errors. */
  check(
    sql: string,
    variantId: string,
    slot: "primary" | "secondary",
  ): Promise<{ pass: boolean; reason?: string }>;
  /** Execute a complete SELECT for count, then a separate EXPLAIN ANALYZE for profile. Never use the wrapper count. */
  measure(sql: string, variantId: string): Promise<LabQueryMeasurement>;
  /** One warmup per query, nine alternating pairs total. Bootstrap and profiles are outside the timed samples. */
  timedPair(
    primary: string,
    secondary: string,
    variantId: string,
    pair: number,
  ): Promise<{ primary: number; secondary: number }>;
  /** A fresh index-lab database only. Register its worker with cancellation and navigation cleanup before resolving. */
  openIndex(variantId: string): Promise<IndexLabSession>;
}
function measured(value: LabQueryMeasurement): LabMeasurement {
  if (!value.complete || !Number.isSafeInteger(value.count) || value.count < 0)
    throw new Error("The query did not return a complete result.");
  return { count: value.count, profile: normalizeProfile(value.profile) };
}

/** Produces measurements only. A submission separately checks the current report with validateLabEvidence. */
export async function runLab(
  host: LabHost,
  request: LabRequest,
): Promise<LabEvidence> {
  // Capture every editable value before the first await. The caller owns the document/revision on the result.
  request = {
    ...request,
    identity: { ...request.identity },
    gradingVariants: [...request.gradingVariants],
    document: structuredClone(request.document),
  };
  const queries = labQueries(request),
    primary = admit(queries.primary!, "challenge");
  const secondary =
    queries.secondary === undefined
      ? undefined
      : admit(queries.secondary, "challenge");
  const binding = await labBinding(request),
    fixtures: LabFixture[] = [];
  if (!request.gradingVariants.length)
    throw new Error("The lab has no grading variants.");
  if (request.document.kind === "index") {
    if (
      request.datasetId !== "index-lab" ||
      request.gradingVariants.length !== 1 ||
      request.gradingVariants[0] !== request.previewVariant
    )
      throw new Error("The index lab requires its isolated dataset.");
    const create = admitIndexCommand(queries.create!, "create"),
      drop = admitIndexCommand(queries.drop!, "drop", create.indexName);
    const session = await host.openIndex(request.previewVariant);
    try {
      const before = await session.catalog();
      if (before.length)
        throw new Error("The disposable sandbox already contains an index.");
      const beforePass = await session.check(primary);
      await session.command(create.sql);
      const created = await session.catalog();
      if (!createdIndexValid(created, create.indexName))
        throw new Error(
          "The index catalog does not match the requested index.",
        );
      const indexedPass = await session.check(primary),
        measurement = measured(await session.measure(primary));
      await session.command(drop.sql);
      const dropped = await session.catalog(),
        afterPass = await session.check(primary);
      const index = {
        indexName: create.indexName,
        before,
        created,
        dropped,
        beforePass,
        indexedPass,
        afterPass,
      };
      fixtures.push({
        variantId: request.previewVariant,
        slot: "primary",
        pass: indexSequenceValid(index),
      });
      return { kind: "index", binding, fixtures, primary: measurement, index };
    } finally {
      await session.close();
    }
  }
  for (const variantId of request.gradingVariants) {
    fixtures.push({
      variantId,
      slot: "primary",
      ...(await host.check(primary, variantId, "primary")),
    });
    if (secondary !== undefined)
      fixtures.push({
        variantId,
        slot: "secondary",
        ...(await host.check(secondary, variantId, "secondary")),
      });
  }
  if (fixtures.some((fixture) => !fixture.pass))
    throw new Error(
      "The queries must pass every grading variant before measurement.",
    );
  const evidence: LabEvidence = {
    kind: request.document.kind,
    binding,
    fixtures,
    primary: measured(await host.measure(primary, request.previewVariant)),
  };
  if (secondary !== undefined)
    evidence.secondary = measured(
      await host.measure(secondary, request.previewVariant),
    );
  if (
    request.document.kind === "preaggregation" ||
    request.document.kind === "selectivity"
  ) {
    const primarySamples: number[] = [],
      secondarySamples: number[] = [];
    for (let pair = 0; pair < 9; pair++) {
      const sample = await host.timedPair(
        primary,
        secondary!,
        request.previewVariant,
        pair,
      );
      primarySamples.push(sample.primary);
      secondarySamples.push(sample.secondary);
    }
    evidence.timing = {
      primary: summarizeTiming(primarySamples),
      secondary: summarizeTiming(secondarySamples),
    };
  }
  return evidence;
}
