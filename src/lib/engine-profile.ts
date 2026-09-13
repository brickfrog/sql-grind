export interface ProfileScan {
  path: string;
  operator: string;
  table?: string;
  projections?: unknown;
  rowsScanned?: number;
  filters?: string;
  accessPath: "index" | "sequential" | "not-reported";
  leaf: boolean;
}

export interface NormalizedProfile {
  scans: ProfileScan[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Missing profiles are execution errors; absent scan metrics stay absent. */
export function normalizeProfile(input: unknown): NormalizedProfile {
  const root = record(typeof input === "string" ? JSON.parse(input) : input);
  if (!root) throw new Error("The engine did not return a usable profile.");
  const scans: ProfileScan[] = [];
  let operators = 0;

  function walk(
    node: Record<string, unknown>,
    path: string,
    wrapper = false,
  ): boolean {
    const children = node.children;
    if (children !== undefined && !Array.isArray(children))
      throw new Error("The profile contains invalid children.");
    const name = node.operator_name ?? node.operator_type;
    const operator = typeof name === "string" ? name.trim() : "";
    if (!operator && (!wrapper || name !== undefined))
      throw new Error("The profile contains an invalid operator.");
    if (operator) operators++;
    if (node.extra_info !== undefined && !record(node.extra_info))
      throw new Error("The profile contains invalid operator details.");

    let descendantScan = false;
    for (const [index, child] of (
      (children as unknown[] | undefined) ?? []
    ).entries()) {
      const value = record(child);
      if (!value) throw new Error("The profile contains an invalid operator.");
      descendantScan =
        walk(value, `${path}.children[${index}]`) || descendantScan;
    }
    const isScan = /SCAN/i.test(operator);
    if (isScan) {
      const extra = record(node.extra_info) ?? {};
      // Cardinality is output from this operator, not the work it scanned.
      const rows = node.operator_rows_scanned;
      const filter = extra.Filters;
      const access = typeof extra.Type === "string" ? extra.Type : operator;
      scans.push({
        path,
        operator,
        leaf: !descendantScan,
        ...(typeof extra.Table === "string" ? { table: extra.Table } : {}),
        ...(extra.Projections !== undefined
          ? { projections: extra.Projections }
          : {}),
        ...(typeof rows === "number" && Number.isSafeInteger(rows) && rows >= 0
          ? { rowsScanned: rows }
          : {}),
        ...(typeof filter === "string" && filter.trim()
          ? { filters: filter }
          : Array.isArray(filter) &&
              filter.length &&
              filter.every((item) => typeof item === "string") &&
              filter.some((item) => item.trim())
            ? { filters: filter.join("\n") }
            : {}),
        accessPath: /index[ _]?scan/i.test(access)
          ? "index"
          : /seq(?:uential)?[ _]?scan/i.test(access)
            ? "sequential"
            : "not-reported",
      });
    }
    return isScan || descendantScan;
  }

  walk(root, "profile", true);
  if (!operators)
    throw new Error("The engine did not return a usable profile.");
  return { scans };
}
