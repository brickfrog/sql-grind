import type { ContentIdentity } from "./challenges";
import type { LabDocument, LabEvidence } from "./engine-labs";
import type { ReconciliationAssessment } from "./reconciliation";

export interface Diagnostic {
  ruleId: string;
  severity: "error" | "warning" | "style" | "information";
  message: string;
  from: number;
  to: number;
  revision: number;
  evidence?: string;
}
export interface ParseResult {
  revision: number;
  valid: boolean | null;
  diagnostics: Diagnostic[];
  elapsedMs: number;
  coverage?: string;
}
export interface Column {
  name: string;
  type: string;
}
export interface ResultHandle {
  columns: Column[];
  count: number;
  getRow(index: number): (string | null)[];
}
export interface SchemaReference {
  column: string;
  table: string;
  toColumn: string;
}
export interface SchemaTable {
  name: string;
  count: number;
  columns: { name: string; type: string; nullable: boolean; key?: string }[];
  definition: string;
  references: SchemaReference[];
}
export type EngineState =
  | "loading"
  | "ready"
  | "initializing"
  | "running"
  | "transferring"
  | "cancelling"
  | "recovering"
  | "error";
export type RunKind = "execute" | "submit" | "plan" | "compare" | "lab";
export interface RunRequest {
  id: string;
  documentId: string;
  revision: number;
  sql: string;
  kind: RunKind;
  domain: "challenge" | "sandbox";
  hintLevel: number;
  challenge: ContentIdentity | null;
  datasetId: string;
  lab?: LabDocument;
  labEvidence?: LabEvidence;
}
export interface RunResult {
  id: string;
  documentId: string;
  revision: number;
  challenge: ContentIdentity | null;
  datasetId: string;
  assessment?:
    | { kind: "exact"; fixtures: NonNullable<RunResult["fixtureResults"]> }
    | { kind: "plan-lab"; evidence: LabEvidence; report: LabDocument }
    | {
        kind: "reconciliation";
        variants: { variantId: string; metrics: ReconciliationAssessment }[];
      };
  outcome:
    | "complete"
    | "cancelled"
    | "timeout"
    | "result-limit"
    | "engine-error";
  correctness: "not-evaluated" | "correct" | "incorrect";
  result: ResultHandle | null;
  elapsedMs: number;
  message: string;
  plan?: string;
  diagnostics: Diagnostic[];
  fixtureResults?: {
    name: string;
    pass: boolean;
    reason?: string;
    expectedRows?: number;
    actualRows?: number;
    elapsedMs?: number;
  }[];
  comparison?: {
    referenceMs: number;
    candidateMs: number;
    referenceMad: number;
    candidateMad: number;
    pairs: number;
    ratio: number;
    ratioMad: number;
    /** Separated so a learner reads work done, not a raw profile dump. */
    referenceScans: ProfileSummary[];
    candidateScans: ProfileSummary[];
  };
}
export interface ProfileSummary {
  operator: string;
  table?: string;
  rowsScanned?: number;
  accessPath: "index" | "sequential" | "not-reported";
  filtered: boolean;
}
export interface QueryDocument {
  id: string;
  name: string;
  sql: string;
  revision: number;
  version: number;
  selection: { anchor: number; head: number };
  scrollTop: number;
  updatedAt: number;
  deletedAt?: number;
  challenge: ContentIdentity | null;
  datasetId: string;
  lab?: LabDocument;
  saved: boolean;
}
export interface Attempt {
  id: string;
  documentId: string;
  revision: number;
  sql: string;
  challenge: ContentIdentity;
  datasetId: string;
  assessment?: RunResult["assessment"];
  createdAt: number;
  outcome: RunResult["outcome"];
  correctness: RunResult["correctness"];
  hintLevel: number;
  elapsedMs: number;
  message: string;
  deletedAt?: number;
}
export interface Settings {
  hush: boolean;
  fontSize: number;
  indentation: number;
  wordWrap: boolean;
  readingLayout: boolean;
  announceDiagnostics: boolean;
  judgeVisible: boolean;
  judgeDocked: boolean;
  layout?: {
    showExplorer: boolean;
    showGoal: boolean;
    goalCollapsed: boolean;
    editorHeight: number;
    explorerWidth?: number;
    goalWidth?: number;
    judgeZoom?: number;
    judgeX: number | null;
    judgeY: number | null;
    goalFloating?: boolean;
    goalHeight?: number;
    goalX?: number | null;
    goalY?: number | null;
    selectedSkill: string;
    mapTabOpen?: boolean;
    schemaTabOpen?: boolean;
    erdTabOpen?: boolean;
  };
}
export interface Session {
  openIds: string[];
  activeId: string;
  openedSkillIds: string[];
  /** Skills opened ahead of their prerequisites. Access only: never completion. */
  exploredSkillIds: string[];
}
export interface StoredProfile {
  documents: QueryDocument[];
  attempts: Attempt[];
  hints: Record<string, number>;
  settings: Settings;
  session: Session;
}
export const defaultSettings: Settings = {
  hush: false,
  fontSize: 12,
  indentation: 2,
  wordWrap: false,
  readingLayout: false,
  announceDiagnostics: false,
  judgeVisible: true,
  judgeDocked: false,
};

// Count labels agree with their number: "1 row", "2 rows", "100,000 rows".
export function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

// One quantity, one rendering. The badge form is dense enough for a map node;
// the long form carries the noun so a screen reader is not left with "3/5".
export function formatProgress(
  done: number,
  total: number,
  noun: string,
  form: "badge" | "long" = "long",
): string {
  return form === "badge"
    ? `${done.toLocaleString()}/${total.toLocaleString()}`
    : `${done.toLocaleString()} of ${formatCount(total, noun)} completed`;
}
