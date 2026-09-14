import type { Skill } from "./catalog";

export interface ContentIdentity {
  challengeId: string;
  bundleVersion: string;
  challengeVersion: string;
  datasetVersion: string;
  assessmentVersion: string;
  engineVersion: string;
}
export interface OutputColumn {
  name: string;
  type: "BIGINT" | "VARCHAR" | "DATE" | "BOOLEAN" | "DECIMAL";
  nullable: boolean;
  precision?: number;
  scale?: number;
}
export interface OutputContract {
  columns: OutputColumn[];
  ordering: {
    column: string;
    direction: "ASC" | "DESC";
    nulls: "FIRST" | "LAST";
  }[];
}
export interface ChallengeDefinition {
  challengeId: string;
  skillId: string;
  displayNumber: string;
  version: string;
  bundleVersion: string;
  assessmentVersion: string;
  title: string;
  brief: string;
  instructions: string[];
  datasetId: string;
  starterSql: string;
  starterExplanation: string;
  hints: {
    level: 1 | 2 | 3;
    kind: "concept" | "structure" | "boundary";
    text: string;
  }[];
  // Optional machine-checked assertions about the graded data. The publisher
  // runs each one so authored prose cannot drift from the dataset.
  dataClaims?: {
    variant: string;
    sql: string;
    equals: string;
    claim: string;
  }[];
  output: OutputContract;
  reference: string;
  expected: Record<string, string>;
  assessment:
    | { kind: "exact" }
    | {
        kind: "plan-lab";
        lab:
          | "cardinality"
          | "pushdown"
          | "preaggregation"
          | "index"
          | "selectivity";
        secondaryStarterSql?: string;
        secondaryReference?: string;
        secondaryExpected?: Record<string, string>;
      }
    | { kind: "reconciliation"; truth: Record<string, string> };
}
export interface DatasetDefinition {
  id: string;
  version: string;
  tables: string[];
  schema: string;
  previewVariant: string;
  gradingVariants: string[];
  variants: Record<
    string,
    { bootstrap: string[]; parquet?: { table: string; asset: string }[] }
  >;
}
export interface ChallengeSummary {
  challengeId: string;
  path: string;
  title: string;
  brief: string;
  displayNumber: string;
  identity: ContentIdentity;
}
export interface CurriculumSkill {
  id: string;
  label: string;
  brief: string;
  requires: string[];
  x: number;
  y: number;
  requiredChallengeIds: string[];
  definitions: ChallengeSummary[];
}
export interface Curriculum {
  version: string;
  skills: CurriculumSkill[];
  datasets: { id: string; path: string }[];
}
/**
 * A kata is a repetition drill, not graded content: it carries no identity, no
 * published expectation and no manifest entry, so it can never award or revoke
 * a challenge completion. Correctness is decided at runtime by executing the
 * authored reference beside the learner's SQL in one dataset variant and
 * comparing both against this authored contract — the same comparator, the
 * same ordering policy, and the same five column types as a challenge.
 */
export interface KataVariation {
  variationId: string;
  prompt: string;
  variantId: string;
  reference: string;
  output: OutputContract;
}
export interface KataPattern {
  patternId: string;
  title: string;
  skillId: string;
  /** Why the shape is worth drilling, shown before the first prompt. */
  why: string;
  datasetId: string;
  variations: KataVariation[];
}

export interface LoadedChallenge {
  definition: ChallengeDefinition;
  dataset: DatasetDefinition;
  identity: ContentIdentity;
}
export const IDENTITY_KEYS = [
  "challengeId",
  "bundleVersion",
  "challengeVersion",
  "datasetVersion",
  "assessmentVersion",
  "engineVersion",
] as const;
export function sameIdentity(
  a: ContentIdentity | null | undefined,
  b: ContentIdentity | null | undefined,
): boolean {
  return !!a && !!b && IDENTITY_KEYS.every((key) => a[key] === b[key]);
}
export function identityKey(identity: ContentIdentity): string {
  return JSON.stringify(IDENTITY_KEYS.map((key) => identity[key]));
}
export function contentIdentity(
  definition: ChallengeDefinition,
  dataset: DatasetDefinition,
  engineVersion = "v1.5.4",
): ContentIdentity {
  return {
    challengeId: definition.challengeId,
    bundleVersion: definition.bundleVersion,
    challengeVersion: definition.version,
    datasetVersion: dataset.version,
    assessmentVersion: definition.assessmentVersion,
    engineVersion,
  };
}
function fail(message: string): never {
  throw new Error(`Content error: ${message}`);
}
function record(input: unknown, label: string): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(`${label} must be an object.`);
  return input as Record<string, any>;
}
function text(input: unknown, label: string): asserts input is string {
  if (typeof input !== "string" || !input.trim())
    fail(`${label} must be nonempty text.`);
}
function strings(
  input: unknown,
  label: string,
  nonempty = true,
): asserts input is string[] {
  if (!Array.isArray(input) || (nonempty && !input.length))
    fail(`${label} must be a nonempty list.`);
  input.forEach((value) => text(value, label));
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`Duplicate ${label}.`);
}
export function assetPath(input: unknown): asserts input is string {
  text(input, "Asset path");
  if (
    !input.startsWith("/") ||
    input.startsWith("//") ||
    /[\\?#]/.test(input) ||
    input.split("/").some((segment) => segment === ".." || segment === ".") ||
    decodeURIComponent(input) !== input
  )
    fail(`Unsafe asset path ${input}.`);
}
/**
 * Deployment prefix for fetching a manifest asset. Manifest paths stay
 * root-absolute identities — they are hashed and validated as written — so a
 * subpath deployment (a GitHub project page at /<repo>/) only changes the URL
 * used to fetch them. BASE_URL is "/" at a site root.
 */
export function assetUrl(path: string): string {
  assetPath(path);
  return import.meta.env.BASE_URL.replace(/\/+$/, "") + path;
}
export function validateIdentity(input: unknown): ContentIdentity {
  const value = record(input, "Identity");
  for (const key of IDENTITY_KEYS) text(value[key], key);
  return value as ContentIdentity;
}
export function validateOutput(input: unknown): OutputContract {
  const value = record(input, "Output contract");
  if (
    !Array.isArray(value.columns) ||
    !value.columns.length ||
    !Array.isArray(value.ordering)
  )
    fail("Output columns and ordering are required.");
  for (const item of value.columns) {
    const column = record(item, "Output column");
    text(column.name, "Column name");
    if (
      !["BIGINT", "VARCHAR", "DATE", "BOOLEAN", "DECIMAL"].includes(
        column.type,
      ) ||
      typeof column.nullable !== "boolean"
    )
      fail("Invalid output type or nullability.");
    if (column.type === "DECIMAL") {
      if (
        !Number.isInteger(column.precision) ||
        column.precision < 1 ||
        column.precision > 38 ||
        !Number.isInteger(column.scale) ||
        column.scale < 0 ||
        column.scale > column.precision
      )
        fail("Invalid decimal precision or scale.");
    } else if (column.precision !== undefined || column.scale !== undefined)
      fail("Only decimals have precision and scale.");
  }
  const names = value.columns.map((column: OutputColumn) => column.name);
  unique(names, "output column");
  for (const item of value.ordering) {
    const key = record(item, "Ordering key");
    if (
      !names.includes(key.column) ||
      !["ASC", "DESC"].includes(key.direction) ||
      !["FIRST", "LAST"].includes(key.nulls)
    )
      fail("Invalid ordering key.");
  }
  unique(
    value.ordering.map((key: OutputContract["ordering"][number]) => key.column),
    "ordering key",
  );
  return value as OutputContract;
}
function assetMap(input: unknown, label: string): void {
  const value = record(input, label);
  if (!Object.keys(value).length) fail(`${label} cannot be empty.`);
  Object.values(value).forEach(assetPath);
}
export function validateChallenge(input: unknown): ChallengeDefinition {
  const value = record(input, "Challenge");
  for (const key of [
    "challengeId",
    "skillId",
    "displayNumber",
    "version",
    "bundleVersion",
    "assessmentVersion",
    "title",
    "brief",
    "datasetId",
    "starterSql",
    "starterExplanation",
  ])
    text(value[key], key);
  strings(value.instructions, "Instructions");
  assetPath(value.reference);
  assetMap(value.expected, "Expected assets");
  validateOutput(value.output);
  if (!Array.isArray(value.hints) || value.hints.length !== 3)
    fail("Exactly three hints are required.");
  value.hints.forEach((input: unknown, index: number) => {
    const hint = record(input, "Hint");
    if (
      hint.level !== index + 1 ||
      hint.kind !== ["concept", "structure", "boundary"][index]
    )
      fail("Hints must have ordered levels and kinds.");
    text(hint.text, "Hint text");
  });
  const assessment = record(value.assessment, "Assessment");
  if (assessment.kind === "reconciliation")
    assetMap(assessment.truth, "Truth assets");
  else if (assessment.kind === "plan-lab") {
    if (
      ![
        "cardinality",
        "pushdown",
        "preaggregation",
        "index",
        "selectivity",
      ].includes(assessment.lab)
    )
      fail("Unknown plan lab.");
    if (assessment.secondaryStarterSql !== undefined)
      text(assessment.secondaryStarterSql, "Secondary starter");
    if (assessment.secondaryReference !== undefined)
      assetPath(assessment.secondaryReference);
    if (assessment.secondaryExpected !== undefined)
      assetMap(assessment.secondaryExpected, "Secondary expected assets");
  } else if (assessment.kind !== "exact") fail("Unknown assessment kind.");
  if (value.dataClaims !== undefined) {
    if (!Array.isArray(value.dataClaims) || !value.dataClaims.length)
      fail("Data claims must be a non-empty array when present.");
    for (const input of value.dataClaims) {
      const claim = record(input, "Data claim");
      for (const key of ["variant", "sql", "equals", "claim"])
        text(claim[key], `Data claim ${key}`);
    }
  }
  return value as ChallengeDefinition;
}
export function validateKata(input: unknown): KataPattern {
  const value = record(input, "Kata");
  for (const key of ["patternId", "title", "skillId", "why", "datasetId"])
    text(value[key], key);
  if (!Array.isArray(value.variations) || !value.variations.length)
    fail("A kata needs at least one variation.");
  for (const item of value.variations) {
    const variation = record(item, "Kata variation");
    for (const key of ["variationId", "prompt", "variantId", "reference"])
      text(variation[key], `Kata ${key}`);
    validateOutput(variation.output);
  }
  unique(
    value.variations.map((v: KataVariation) => v.variationId),
    "kata variation",
  );
  return value as KataPattern;
}
export function validateDataset(input: unknown): DatasetDefinition {
  const value = record(input, "Dataset");
  text(value.id, "Dataset ID");
  text(value.version, "Dataset version");
  strings(value.tables, "Tables");
  unique(value.tables, "table");
  if (value.tables.some((table: string) => !/^[a-z][a-z0-9_]*$/.test(table)))
    fail("Unsafe table identifier.");
  assetPath(value.schema);
  text(value.previewVariant, "Preview variant");
  strings(value.gradingVariants, "Grading variants");
  unique(value.gradingVariants, "grading variant");
  const variants = record(value.variants, "Variants");
  if (
    ![value.previewVariant, ...value.gradingVariants].every((id) =>
      Object.hasOwn(variants, id),
    )
  )
    fail("Missing dataset variant.");
  for (const input of Object.values(variants)) {
    const variant = record(input, "Variant");
    strings(variant.bootstrap, "Bootstrap", false);
    variant.bootstrap.forEach(assetPath);
    if (variant.parquet !== undefined) {
      if (!Array.isArray(variant.parquet)) fail("Invalid parquet list.");
      for (const input of variant.parquet) {
        const entry = record(input, "Parquet entry");
        if (!value.tables.includes(entry.table))
          fail("Parquet table is not in dataset.");
        assetPath(entry.asset);
      }
      unique(
        variant.parquet.map((entry: { table: string }) => entry.table),
        "parquet table",
      );
    }
  }
  return value as DatasetDefinition;
}
export function validateCurriculum(input: unknown): Curriculum {
  const value = record(input, "Curriculum");
  text(value.version, "Curriculum version");
  if (
    !Array.isArray(value.skills) ||
    !value.skills.length ||
    !Array.isArray(value.datasets) ||
    !value.datasets.length
  )
    fail("Skills and datasets are required.");
  const challengeIds: string[] = [];
  for (const input of value.skills) {
    const skill = record(input, "Skill");
    for (const key of ["id", "label", "brief"]) text(skill[key], key);
    strings(skill.requires, "Prerequisites", false);
    unique(skill.requires, "prerequisite");
    if (!Number.isFinite(skill.x) || !Number.isFinite(skill.y))
      fail("Invalid map coordinates.");
    strings(skill.requiredChallengeIds, "Required challenge IDs");
    unique(skill.requiredChallengeIds, "required challenge");
    if (
      skill.requiredChallengeIds.length !== 5 ||
      !Array.isArray(skill.definitions) ||
      skill.definitions.length !== 5
    )
      fail("Each skill requires five definitions.");
    const ids = skill.definitions.map((input: unknown) => {
      const def = record(input, "Definition entry");
      for (const key of ["challengeId", "title", "brief", "displayNumber"])
        text(def[key], key);
      assetPath(def.path);
      const identity = record(def.identity, "Content identity");
      if (
        Object.keys(identity).length !== IDENTITY_KEYS.length ||
        Object.keys(identity).some(
          (key) =>
            !IDENTITY_KEYS.includes(key as (typeof IDENTITY_KEYS)[number]),
        )
      )
        fail("Content identity must contain exactly six version fields.");
      for (const key of IDENTITY_KEYS) text(identity[key], key);
      if (identity.challengeId !== def.challengeId)
        fail("Summary challenge identity mismatch.");
      return def.challengeId;
    });
    if (JSON.stringify(ids) !== JSON.stringify(skill.requiredChallengeIds))
      fail("Definition order must match required challenge order.");
    challengeIds.push(...ids);
  }
  unique(challengeIds, "challenge ID");
  const skills = new Map<string, CurriculumSkill>(
    value.skills.map((s: CurriculumSkill) => [s.id, s]),
  );
  if (skills.size !== value.skills.length) fail("Duplicate skill ID.");
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) fail("Prerequisite cycle.");
    if (visited.has(id)) return;
    const skill = skills.get(id);
    if (!skill) fail(`Unknown prerequisite ${id}.`);
    visiting.add(id);
    skill.requires.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  skills.forEach((skill) => visit(skill.id));
  for (const input of value.datasets) {
    const dataset = record(input, "Dataset entry");
    text(dataset.id, "Dataset ID");
    assetPath(dataset.path);
  }
  unique(
    value.datasets.map((d: { id: string }) => d.id),
    "dataset ID",
  );
  return value as Curriculum;
}

interface Asset {
  path: string;
  bytes: number;
  sha256: string;
}
/** One verified publication snapshot. Cached bytes never cross manifest identities. */
export class VerifiedAssets {
  private readonly cache = new Map<string, Promise<Uint8Array>>();
  private constructor(
    readonly identity: string,
    private readonly assets: Map<string, Asset>,
  ) {}
  static async load(signal?: AbortSignal): Promise<VerifiedAssets> {
    const response = await this.fetchLocal("/bundle/assets.json", signal);
    const bytes = await response.arrayBuffer();
    const manifest = record(
      JSON.parse(new TextDecoder().decode(bytes)),
      "Asset manifest",
    );
    if (!Array.isArray(manifest.files)) fail("Invalid manifest files.");
    const assets = new Map<string, Asset>();
    for (const input of manifest.files) {
      const asset = record(input, "Manifest entry");
      assetPath(asset.path);
      if (
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0 ||
        typeof asset.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        assets.has(asset.path)
      )
        fail("Invalid or duplicate manifest entry.");
      assets.set(asset.path, asset as Asset);
    }
    return new VerifiedAssets(await sha256(bytes), assets);
  }
  private static async fetchLocal(
    path: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    assetPath(path);
    const response = await fetch(assetUrl(path), {
      signal: signal ?? AbortSignal.timeout(30_000),
      credentials: "same-origin",
      redirect: "error",
      cache: "no-cache",
    });
    if (!response.ok) fail(`Cannot load ${path}: HTTP ${response.status}.`);
    return response;
  }
  has(path: string): boolean {
    return this.assets.has(path);
  }
  require(path: string): void {
    if (!this.has(path)) fail(`Manifest does not identify ${path}.`);
  }
  bytes(path: string): Promise<Uint8Array> {
    this.require(path);
    let pending = this.cache.get(path);
    if (!pending) {
      pending = (async () => {
        const asset = this.assets.get(path)!;
        const bytes = await (
          await VerifiedAssets.fetchLocal(path)
        ).arrayBuffer();
        if (
          bytes.byteLength !== asset.bytes ||
          (await sha256(bytes)) !== asset.sha256
        )
          fail(`Integrity check failed for ${path}.`);
        return new Uint8Array(bytes);
      })().catch((error) => {
        this.cache.delete(path);
        throw error;
      });
      this.cache.set(path, pending);
    }
    return pending;
  }
  async text(path: string): Promise<string> {
    return new TextDecoder().decode(await this.bytes(path));
  }
  async json(path: string): Promise<unknown> {
    return JSON.parse(await this.text(path));
  }
}
export async function sha256(input: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export class ChallengeCatalog {
  private readonly challenges = new Map<string, Promise<LoadedChallenge>>();
  private readonly datasets = new Map<string, Promise<DatasetDefinition>>();
  private constructor(
    readonly assets: VerifiedAssets,
    readonly curriculum: Curriculum,
  ) {}
  static async load(): Promise<ChallengeCatalog> {
    const assets = await VerifiedAssets.load();
    const curriculum = validateCurriculum(
      await assets.json("/bundle/curriculum.json"),
    );
    for (const skill of curriculum.skills)
      skill.definitions.forEach((def) => assets.require(def.path));
    curriculum.datasets.forEach((dataset) => assets.require(dataset.path));
    return new ChallengeCatalog(assets, curriculum);
  }
  dataset(id: string): Promise<DatasetDefinition> {
    const entry = this.curriculum.datasets.find((dataset) => dataset.id === id);
    if (!entry)
      return Promise.reject(new Error(`Content error: Unknown dataset ${id}.`));
    let pending = this.datasets.get(id);
    if (!pending) {
      pending = (async () => {
        const dataset = validateDataset(await this.assets.json(entry.path));
        if (dataset.id !== id) fail("Dataset identity mismatch.");
        this.assets.require(dataset.schema);
        Object.values(dataset.variants).forEach((variant) => {
          variant.bootstrap.forEach((path) => this.assets.require(path));
          variant.parquet?.forEach((entry) => this.assets.require(entry.asset));
        });
        return dataset;
      })().catch((error) => {
        this.datasets.delete(id);
        throw error;
      });
      this.datasets.set(id, pending);
    }
    return pending;
  }
  load(id: string): Promise<LoadedChallenge> {
    const skill = this.curriculum.skills.find((skill) =>
      skill.requiredChallengeIds.includes(id),
    );
    const entry = skill?.definitions.find((entry) => entry.challengeId === id);
    if (!entry || !skill)
      return Promise.reject(
        new Error(`Content error: Unknown challenge ${id}.`),
      );
    let pending = this.challenges.get(id);
    if (!pending) {
      pending = (async () => {
        const definition = validateChallenge(
          await this.assets.json(entry.path),
        );
        if (definition.challengeId !== id || definition.skillId !== skill.id)
          fail("Challenge identity mismatch.");
        const dataset = await this.dataset(definition.datasetId);
        const identity = contentIdentity(definition, dataset);
        if (
          definition.title !== entry.title ||
          definition.brief !== entry.brief ||
          definition.displayNumber !== entry.displayNumber ||
          !sameIdentity(identity, entry.identity)
        )
          fail("Challenge summary does not match its definition and dataset.");
        this.assets.require(definition.reference);
        const maps = [definition.expected];
        if (definition.assessment.kind === "reconciliation")
          maps.push(definition.assessment.truth);
        if (definition.assessment.kind === "plan-lab") {
          if (definition.assessment.secondaryReference)
            this.assets.require(definition.assessment.secondaryReference);
          if (definition.assessment.secondaryExpected)
            maps.push(definition.assessment.secondaryExpected);
        }
        for (const map of maps) {
          if (
            Object.keys(map).some((id) => !Object.hasOwn(dataset.variants, id))
          )
            fail("Unknown expected variant.");
          for (const id of dataset.gradingVariants) {
            if (!map[id]) fail(`Missing assessment asset for ${id}.`);
            this.assets.require(map[id]);
          }
        }
        return {
          definition,
          dataset,
          identity,
        };
      })().catch((error) => {
        this.challenges.delete(id);
        throw error;
      });
      this.challenges.set(id, pending);
    }
    return pending;
  }
  skills(): Skill[] {
    return this.curriculum.skills.map((skill) => ({
      id: skill.id,
      label: skill.label,
      description: skill.brief,
      requires: skill.requires,
      x: skill.x,
      y: skill.y,
      objectives: skill.definitions.map((summary) => ({
        id: summary.challengeId,
        title: summary.title,
        description: summary.brief,
        challengeId: summary.challengeId,
      })),
    }));
  }
}
