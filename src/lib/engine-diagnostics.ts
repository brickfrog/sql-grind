import type { Diagnostic, ParseResult, SchemaTable } from "./types";
import { EngineFailure } from "./engine-results";
import { normalizeProfile } from "./engine-profile";

type Node = Record<string, unknown>;
function record(value: unknown): Node {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Node)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export interface Token {
  text: string;
  from: number;
  to: number;
  quoted: boolean;
}
export function byteToUtf16(sql: string, position: number): number | null {
  if (!Number.isSafeInteger(position) || position < 0) return null;
  let bytes = 0,
    index = 0;
  for (const character of sql) {
    if (bytes === position) return index;
    if (bytes > position) return null;
    const code = character.codePointAt(0)!;
    bytes += code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1;
    index += character.length;
  }
  return bytes === position ? index : null;
}
function codePointToUtf16(sql: string, position: number): number | null {
  if (!Number.isSafeInteger(position) || position < 0) return null;
  let index = 0;
  for (const character of sql) {
    if (position === 0) return index;
    position--;
    index += character.length;
  }
  return position === 0 ? index : null;
}

// Statement extraction is deliberately independent of json_serialize_sql: DuckDB
// can execute read statements (notably PIVOT) that its JSON serializer cannot emit.
export function tokens(sql: string): Token[] {
  const output: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const from = i,
      char = sql[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth)
        throw new EngineFailure("engine-error", "Unclosed SQL comment.");
      continue;
    }
    if (char === "'" || char === '"') {
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === char) {
          if (sql[i + 1] === char) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        // DuckDB E'...' strings also accept backslash escapes.
        if (
          sql[i] === "\\" &&
          char === "'" &&
          /[eE]/.test(sql[from - 1] ?? "") &&
          (from < 2 || !/[\w$]/.test(sql[from - 2]))
        )
          i += 2;
        else i++;
      }
      if (!closed)
        throw new EngineFailure("engine-error", "Unclosed quoted SQL value.");
      output.push({ text: sql.slice(from, i), from, to: i, quoted: true });
      continue;
    }
    if (char === "$") {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0)
          throw new EngineFailure(
            "engine-error",
            "Unclosed dollar-quoted SQL value.",
          );
        i = end + tag.length;
        output.push({ text: sql.slice(from, i), from, to: i, quoted: true });
        continue;
      }
    }
    if (/[\p{L}\p{N}_$]/u.test(char)) {
      i++;
      while (i < sql.length && /[\p{L}\p{N}_$]/u.test(sql[i])) i++;
    } else i++;
    output.push({
      text: sql.slice(from, i).toUpperCase(),
      from,
      to: i,
      quoted: false,
    });
  }
  return output;
}
export function admit(sql: string, domain: "challenge" | "sandbox"): string {
  const parsed = tokens(sql);
  if (!parsed.length)
    throw new EngineFailure("engine-error", "Enter one SQL statement.");
  const semicolon = parsed.findIndex(
    (token) => token.text === ";" && !token.quoted,
  );
  if (semicolon >= 0 && semicolon !== parsed.length - 1)
    throw new EngineFailure("engine-error", "Run one statement at a time.");
  const end = semicolon >= 0 ? parsed.pop()!.from : sql.length;
  if (!parsed.length)
    throw new EngineFailure("engine-error", "Enter one SQL statement.");
  const read = [
    "SELECT",
    "WITH",
    "VALUES",
    "FROM",
    "TABLE",
    "PIVOT",
    "UNPIVOT",
  ];
  let start = 0;
  if (parsed[0].text === "WITH" && !parsed[0].quoted) {
    start = 1;
    if (parsed[start]?.text === "RECURSIVE") start++;
    const groupEnd = (opening: number): number => {
      if (parsed[opening]?.text !== "(" || parsed[opening].quoted)
        throw new EngineFailure(
          "engine-error",
          "Cannot extract this WITH statement under the local read policy.",
        );
      let depth = 1,
        cursor = opening + 1;
      for (; cursor < parsed.length && depth; cursor++) {
        if (parsed[cursor].quoted) continue;
        if (parsed[cursor].text === "(") depth++;
        else if (parsed[cursor].text === ")") depth--;
      }
      if (depth)
        throw new EngineFailure(
          "engine-error",
          "Cannot extract an unfinished WITH statement.",
        );
      return cursor;
    };
    for (;;) {
      start++; // CTE identifier.
      if (parsed[start]?.text === "(") start = groupEnd(start);
      if (parsed[start]?.text === "USING" && parsed[start + 1]?.text === "KEY")
        start = groupEnd(start + 2);
      if (parsed[start]?.text !== "AS" || parsed[start].quoted)
        throw new EngineFailure(
          "engine-error",
          "Cannot extract this WITH statement under the local read policy.",
        );
      start++;
      if (parsed[start]?.text === "NOT") start++;
      if (parsed[start]?.text === "MATERIALIZED") start++;
      const opening = start;
      start = groupEnd(start);
      const cteStart = parsed[opening + 1];
      if (!cteStart || cteStart.quoted || !read.includes(cteStart.text))
        throw new EngineFailure(
          "engine-error",
          "CTEs must contain read queries in this application.",
        );
      if (parsed[start]?.text !== ",") break;
      start++;
    }
  }
  const first = parsed[start];
  if (!first)
    throw new EngineFailure(
      "engine-error",
      "The WITH statement needs a final read query.",
    );
  const indexWrite =
    domain === "sandbox" &&
    start === 0 &&
    !first.quoted &&
    ((first.text === "CREATE" &&
      (parsed[1]?.text === "INDEX" ||
        (parsed[1]?.text === "UNIQUE" && parsed[2]?.text === "INDEX"))) ||
      (first.text === "DROP" && parsed[1]?.text === "INDEX"));
  if (first.quoted || (!read.includes(first.text) && !indexWrite))
    throw new EngineFailure(
      "engine-error",
      domain === "sandbox"
        ? "The sandbox permits one read query or CREATE/DROP INDEX statement."
        : "Challenges permit one read query. Use the separate sandbox for schema-changing SQL.",
    );
  return sql.slice(0, end).trim();
}
function range(
  sql: string,
  location: unknown,
  expected?: string,
): { from: number; to: number } {
  const from = byteToUtf16(sql, Number(location));
  if (from == null || from >= sql.length) return { from: 0, to: 0 };
  const token = tokens(sql).find((token) => token.from === from);
  if (
    !token ||
    (expected && token.text.toLowerCase() !== expected.toLowerCase())
  )
    return { from: 0, to: 0 };
  return { from, to: token.to };
}
export function analyze(
  input: unknown,
  sql: string,
  revision: number,
  elapsedMs: number,
  schema: SchemaTable[],
): ParseResult {
  const ast = record(input);
  if (typeof ast.error !== "boolean")
    throw new Error("Invalid JSON parser response.");
  if (ast.error) {
    if (typeof ast.error_message !== "string")
      throw new Error("Invalid JSON parser error response.");
    const unsupported =
      ast.error_type === "not implemented" ||
      ast.error_message.includes("Only SELECT statements");
    if (unsupported)
      return {
        revision,
        valid: null,
        diagnostics: [],
        elapsedMs,
        coverage:
          "Structural diagnostics unavailable for this statement. This is not a syntax rejection; execution uses the independent read-statement policy.",
      };
    // Parser-error positions count Unicode code points; AST locations use bytes.
    const offset = codePointToUtf16(sql, Number(ast.position));
    return {
      revision,
      valid: false,
      elapsedMs,
      diagnostics: [
        {
          ruleId: "SQL",
          severity: "error",
          message: ast.error_message,
          revision,
          from: offset ?? 0,
          to:
            offset == null
              ? 0
              : Math.min(
                  sql.length,
                  offset + ((sql.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1),
                ),
        },
      ],
    };
  }
  if (!Array.isArray(ast.statements))
    throw new Error("Invalid JSON parser statement response.");
  const diagnostics: Diagnostic[] = [];
  const sourceTokens = tokens(sql);
  let unsupported = false;
  const known = new Map(
    schema.map((table) => [table.name.toLowerCase(), table]),
  );
  function projectionRange(expression: Node): { from: number; to: number } {
    const position = byteToUtf16(sql, Number(expression.query_location));
    const index = sourceTokens.findIndex((token) => token.from === position);
    let token = sourceTokens[index];
    // Qualified STAR locations point at the relation, not the expansion token.
    // Walk lexical tokens so comments, whitespace, and quoted names stay intact.
    if (token && expression.relation_name) {
      const name = token.quoted
        ? token.text.startsWith('"')
          ? token.text.slice(1, -1).replaceAll('""', '"')
          : null
        : token.text;
      if (
        name?.toLowerCase() !==
          String(expression.relation_name).toLowerCase() ||
        sourceTokens[index + 1]?.text !== "." ||
        sourceTokens[index + 1]?.quoted
      )
        return { from: 0, to: 0 };
      token = sourceTokens[index + 2];
    }
    return token && !token.quoted && token.text === "*"
      ? { from: token.from, to: token.to }
      : { from: 0, to: 0 };
  }
  function inspectScope(node: Node, ctes: Set<string>): void {
    const local = new Set(ctes);
    for (const entry of list(record(node.cte_map).map)) {
      const key = record(entry).key;
      if (typeof key === "string") local.add(key.toLowerCase());
    }
    const relations: { alias: string; table: string; node: Node }[] = [];
    const edges: [number, number][] = [];
    const conditions: unknown[] = [];
    let supported = true;
    function source(value: unknown): number[] {
      const ref = record(value);
      if (ref.type === "EMPTY") return [];
      if (ref.type === "BASE_TABLE" && typeof ref.table_name === "string") {
        const table = ref.table_name.toLowerCase();
        if (
          local.has(table) ||
          !known.has(table) ||
          ref.at_clause ||
          (ref.schema_name && ref.schema_name !== "main") ||
          ref.catalog_name
        )
          supported = false;
        const index = relations.length;
        relations.push({
          alias: String(ref.alias || ref.table_name).toLowerCase(),
          table,
          node: ref,
        });
        return [index];
      }
      if (ref.type === "JOIN") {
        const left = source(ref.left),
          right = source(ref.right);
        const form = ref.ref_type ?? ref.joinref_type;
        if (form === "CROSS") {
          // The pinned AST labels comma products CROSS too. Only an explicit
          // CROSS JOIN token at this join's location expresses intentionality.
          const position = byteToUtf16(sql, Number(ref.query_location));
          const index = sourceTokens.findIndex(
            (token) => token.from === position,
          );
          if (
            index >= 0 &&
            !sourceTokens[index].quoted &&
            sourceTokens[index].text.toUpperCase() === "CROSS" &&
            sourceTokens[index + 1]?.text.toUpperCase() === "JOIN"
          ) {
            for (const a of left) for (const b of right) edges.push([a, b]);
          }
        } else if (
          !["REGULAR", "IMPLICIT"].includes(String(form)) ||
          !["INNER", "LEFT", "RIGHT", "FULL"].includes(String(ref.join_type)) ||
          list(ref.using_columns).length
        )
          supported = false;
        if (ref.condition) conditions.push(ref.condition);
        return [...left, ...right];
      }
      supported = false;
      return [];
    }
    source(node.from_table);
    if (new Set(relations.map((ref) => ref.alias)).size !== relations.length)
      supported = false;
    function resolve(value: unknown): number | null {
      const expression = record(value);
      if (expression.class !== "COLUMN_REF") return null;
      const names = list(expression.column_names);
      if (!names.every((name): name is string => typeof name === "string")) {
        supported = false;
        return null;
      }
      if (names.length === 2) {
        const index = relations.findIndex(
          (ref) =>
            ref.alias === names[0].toLowerCase() &&
            known
              .get(ref.table)
              ?.columns.some(
                (column) =>
                  column.name.toLowerCase() === names[1].toLowerCase(),
              ),
        );
        if (index < 0) supported = false;
        return index < 0 ? null : index;
      }
      if (names.length === 1) {
        const matches = relations
          .map((ref, i) =>
            known
              .get(ref.table)
              ?.columns.some(
                (column) =>
                  column.name.toLowerCase() === names[0].toLowerCase(),
              )
              ? i
              : -1,
          )
          .filter((i) => i >= 0);
        if (matches.length !== 1) {
          supported = false;
          return null;
        }
        return matches[0];
      }
      supported = false;
      return null;
    }
    function predicate(value: unknown): void {
      if (value == null) return;
      const expression = record(value);
      if (
        expression.class === "CONJUNCTION" &&
        expression.type === "CONJUNCTION_AND"
      ) {
        for (const child of list(expression.children)) predicate(child);
        return;
      }
      if (
        expression.class === "COMPARISON" &&
        [
          "COMPARE_EQUAL",
          "COMPARE_NOTEQUAL",
          "COMPARE_LESSTHAN",
          "COMPARE_GREATERTHAN",
          "COMPARE_LESSTHANOREQUALTO",
          "COMPARE_GREATERTHANOREQUALTO",
          "COMPARE_NOT_DISTINCT_FROM",
        ].includes(String(expression.type))
      ) {
        const left = record(expression.left),
          right = record(expression.right);
        if (
          (left.class !== "COLUMN_REF" && left.class !== "CONSTANT") ||
          (right.class !== "COLUMN_REF" && right.class !== "CONSTANT")
        ) {
          supported = false;
          return;
        }
        const a = resolve(left),
          b = resolve(right);
        if (a != null && b != null && a !== b) edges.push([a, b]);
        return;
      }
      supported = false;
    }
    conditions.forEach(predicate);
    predicate(node.where_clause);
    function hasSubquery(value: unknown): boolean {
      if (!value || typeof value !== "object") return false;
      if (record(value).class === "SUBQUERY") return true;
      return Object.values(value).some(hasSubquery);
    }
    if (hasSubquery(node.select_list) || hasSubquery(node.where_clause))
      supported = false;
    if (!supported) unsupported = true;
    if (supported && relations.length > 1) {
      const connected = new Set([0]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [a, b] of edges)
          if (connected.has(a) !== connected.has(b)) {
            connected.add(a);
            connected.add(b);
            changed = true;
          }
      }
      for (let i = 1; i < relations.length; i++)
        if (!connected.has(i)) {
          const ref = relations[i];
          diagnostics.push({
            ruleId: "J001",
            severity: "warning",
            revision,
            message: `No supported relationship connects ${ref.alias} (${ref.table}) to ${relations[0].alias} (${relations[0].table}). Explicit CROSS JOIN records intentional combinations.`,
            ...range(sql, ref.node.query_location, ref.table),
            evidence:
              "Current JSON AST relation graph; no measured row count or correctness claim.",
          });
        }
    }
    for (const value of list(node.select_list)) {
      const expression = record(value);
      if (expression.class !== "STAR") continue;
      diagnostics.push({
        ruleId: "J002",
        severity: "style",
        revision,
        message:
          "Name the projected columns to make this query's interface explicit.",
        ...projectionRange(expression),
        evidence:
          "SELECT-list expansion wildcard in the current JSON AST; no speed claim.",
      });
    }
    for (const value of Object.values(node)) descend(value, local);
  }
  function descend(value: unknown, ctes: Set<string>): void {
    if (!value || typeof value !== "object") return;
    const node = record(value);
    if (typeof node.type === "string" && node.type.endsWith("_NODE")) {
      if (node.type === "SELECT_NODE") inspectScope(node, ctes);
      else {
        unsupported = true;
        for (const child of Object.values(node)) descend(child, ctes);
      }
      return;
    }
    for (const child of Object.values(value)) descend(child, ctes);
  }
  for (const statement of ast.statements)
    descend(record(statement).node, new Set());
  return {
    revision,
    valid: true,
    diagnostics,
    elapsedMs,
    coverage: unsupported
      ? "J001 coverage excludes unresolved CTE/derived/correlated, OR, USING, NATURAL, lateral, and unsupported predicate scopes. J002 is style only. J003 requires a measured profile."
      : "Current JSON AST: supported relationship scopes and projection wildcards. J003 requires a measured profile.",
  };
}
export function scanDiagnostics(
  profile: unknown,
  revision: number,
): Diagnostic[] {
  const scans = new Map<
    string,
    { path: string; projections?: unknown; rows?: number; filters?: string }[]
  >();
  for (const scan of normalizeProfile(profile).scans) {
    if (scan.table === undefined) continue;
    const items = scans.get(scan.table) ?? [];
    items.push({
      path: scan.path,
      ...(scan.projections !== undefined ? { projections: scan.projections } : {}),
      ...(scan.rowsScanned !== undefined ? { rows: scan.rowsScanned } : {}),
      ...(scan.filters !== undefined ? { filters: scan.filters } : {}),
    });
    scans.set(scan.table, items);
  }
  return [...scans]
    .filter(([, nodes]) => nodes.length > 1)
    .map(([source, nodes]) => ({
      ruleId: "J003",
      severity: "information",
      revision,
      from: 0,
      to: 0,
      message: `The measured plan contains ${nodes.length} scans of ${source}. Compare their projections and filters.`,
      evidence: `Separate EXPLAIN ANALYZE execution, not the timed samples. Local scan nodes: ${JSON.stringify(nodes)}`,
    }));
}
