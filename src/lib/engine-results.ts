import { DataType, Table, type RecordBatch, type Schema } from "apache-arrow";
import {
  sameIdentity,
  validateIdentity,
  validateOutput,
  type ContentIdentity,
  type OutputColumn,
  type OutputContract,
} from "./challenges";
import type { ResultHandle } from "./types";

export const MAX_ROWS = 100_000;
export const MAX_BYTES = 32 * 1024 * 1024;
export class EngineFailure extends Error {
  constructor(
    public outcome: "cancelled" | "timeout" | "result-limit" | "engine-error",
    message: string,
  ) {
    super(message);
  }
}
export interface TypedField {
  name: string;
  type: string;
  scale?: number;
  precision?: number;
}
export interface TypedAnswer {
  fields: TypedField[];
  rows: (string | null)[][];
  complete?: boolean;
}
export interface ExpectedResultIdentity {
  identity: ContentIdentity;
  datasetId: string;
  variantId: string;
}

export function fieldsOf(schema: Schema): TypedField[] {
  return schema.fields.map((field) => {
    const type = field.type as typeof field.type & {
      scale?: number;
      precision?: number;
    };
    return {
      name: field.name,
      type: String(type),
      scale: type.scale,
      precision: type.precision,
    };
  });
}

const SQL_TYPES: Readonly<Record<string, string>> = {
  Null: "NULL",
  Bool: "BOOLEAN",
  Int8: "TINYINT",
  Int16: "SMALLINT",
  Int32: "INTEGER",
  Int64: "BIGINT",
  Uint8: "UTINYINT",
  Uint16: "USMALLINT",
  Uint32: "UINTEGER",
  Uint64: "UBIGINT",
  Float16: "FLOAT16",
  Float32: "FLOAT",
  Float64: "DOUBLE",
  Utf8: "VARCHAR",
  LargeUtf8: "VARCHAR",
  Binary: "BLOB",
  LargeBinary: "BLOB",
  "Date32<DAY>": "DATE",
  "Date64<MILLISECOND>": "DATE",
  "Timestamp<SECOND>": "TIMESTAMP_S",
  "Timestamp<MILLISECOND>": "TIMESTAMP_MS",
  "Timestamp<MICROSECOND>": "TIMESTAMP",
  "Timestamp<NANOSECOND>": "TIMESTAMP_NS",
};

function sqlTypeName(type: string): string {
  if (Object.hasOwn(SQL_TYPES, type)) return SQL_TYPES[type];
  const decimal = /^Decimal\[(\d+)e([+-]?\d+)\]$/.exec(type);
  if (decimal) return `DECIMAL(${decimal[1]},${Number(decimal[2])})`;
  if (
    /^Timestamp<(?:SECOND|MILLISECOND|MICROSECOND|NANOSECOND), .+>$/.test(type)
  )
    return "TIMESTAMP WITH TIME ZONE";
  if (/^Time(?:32|64)</.test(type)) return "TIME";
  if (type.startsWith("Interval<")) return "INTERVAL";
  if (type.startsWith("FixedSizeBinary[")) return "BLOB";
  return type;
}

function sqlType(type: DataType): string {
  if (DataType.isDictionary(type)) return sqlType(type.dictionary);
  if (DataType.isList(type)) return `${sqlType(type.valueType)}[]`;
  if (DataType.isFixedSizeList(type))
    return `${sqlType(type.valueType)}[${type.listSize}]`;
  if (DataType.isStruct(type) || DataType.isUnion(type)) {
    const fields = type.children.map(
      (field) => `"${field.name.replaceAll('"', '""')}" ${sqlType(field.type)}`,
    );
    return `${DataType.isStruct(type) ? "STRUCT" : "UNION"}(${fields.join(", ")})`;
  }
  if (DataType.isMap(type)) {
    const [key, value] = type.children[0].type.children;
    return `MAP(${sqlType(key.type)}, ${sqlType(value.type)})`;
  }
  return sqlTypeName(String(type));
}

function decimal(value: Uint32Array, scale: number): string {
  let n = 0n;
  for (let i = value.length - 1; i >= 0; i--)
    n = (n << 32n) + BigInt(value[i] >>> 0);
  if (value[value.length - 1] >>> 31) n -= 1n << BigInt(value.length * 32);
  const sign = n < 0n ? "-" : "";
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, "0");
  return (
    sign +
    (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits)
  );
}
function displayValue(value: unknown): string {
  if (typeof value === "object")
    return JSON.stringify(value, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  return String(value);
}
export function cell(value: unknown, field: TypedField): string | null {
  if (value == null) return null;
  if (field.type.startsWith("Decimal"))
    return decimal(value as Uint32Array, field.scale ?? 0);
  if (field.type === "Date32<DAY>" || field.type === "Date64<MILLISECOND>")
    return new Date(value as number).toISOString().split("T")[0];
  return displayValue(value);
}

export class ArrowResult implements ResultHandle {
  readonly columns: TypedField[];
  readonly fields: TypedField[];
  readonly count: number;
  private readonly table: Table;
  constructor(schema: Schema, batches: RecordBatch[]) {
    this.table = new Table(schema, batches);
    this.fields = fieldsOf(schema);
    this.columns = this.fields.map((field, i) => ({
      ...field,
      type: sqlType(schema.fields[i].type),
    }));
    this.count = this.table.numRows;
  }
  getRow(index: number): (string | null)[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return [];
    return this.fields.map((field, column) =>
      cell(this.table.getChildAt(column)!.get(index), field),
    );
  }
}

// Account backing buffers, including dictionaries and nested children. Buffer slices
// retain their whole backing allocation; counting byteLength of the slice is unsafe.
export function batchBuffers(batch: RecordBatch): Set<ArrayBufferLike> {
  const buffers = new Set<ArrayBufferLike>();
  const seen = new Set<object>();
  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      buffers.add(value.buffer);
      return;
    }
    if (
      value instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        value instanceof SharedArrayBuffer)
    ) {
      buffers.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const data = value as {
      buffers?: unknown;
      children?: unknown;
      dictionary?: unknown;
      data?: unknown;
    };
    visit(data.buffers);
    visit(data.children);
    visit(data.dictionary);
    visit(data.data);
  }
  visit(batch.data);
  return buffers;
}

function diagnosticText(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function unmatchedColumns(fields: TypedField[], other: TypedField[]): string {
  const available = new Map<string, number>();
  for (const field of other)
    available.set(field.name, (available.get(field.name) ?? 0) + 1);
  const examples: string[] = [];
  let count = 0;
  for (const field of fields) {
    const remaining = available.get(field.name) ?? 0;
    if (remaining) available.set(field.name, remaining - 1);
    else {
      count++;
      if (examples.length < 4)
        examples.push(JSON.stringify(diagnosticText(field.name)));
    }
  }
  if (!count) return "";
  return examples.join(", ") + (count > 4 ? ` (and ${count - 4} more)` : "");
}

function contentFailure(detail: string): never {
  throw new EngineFailure(
    "engine-error",
    `The authored expected result is invalid: ${detail}`,
  );
}

function checkedContract(contract: OutputContract): OutputContract {
  try {
    return validateOutput(contract);
  } catch {
    return contentFailure("malformed output contract.");
  }
}

function contractFields(contract: OutputContract): TypedField[] {
  return contract.columns.map((column) => ({
    name: column.name,
    type:
      column.type === "DECIMAL"
        ? `Decimal[${column.precision}e+${column.scale}]`
        : {
            BIGINT: "Int64",
            VARCHAR: "Utf8",
            DATE: "Date32<DAY>",
            BOOLEAN: "Bool",
          }[column.type],
    ...(column.type === "DECIMAL"
      ? { precision: column.precision, scale: column.scale }
      : {}),
  }));
}

function matchesType(column: OutputColumn, field: TypedField): boolean {
  if (column.type === "DECIMAL") {
    const match = /^Decimal\[(\d+)e([+-]?\d+)\]$/.exec(field.type);
    return (
      !!match &&
      field.scale === column.scale &&
      Number(match[2]) === column.scale
    );
  }
  return sqlTypeName(field.type) === column.type;
}

function scalarValid(
  value: unknown,
  column: OutputColumn,
): value is string | null {
  if (value === null) return column.nullable;
  if (typeof value !== "string") return false;
  switch (column.type) {
    case "VARCHAR":
      return true;
    case "BOOLEAN":
      return value === "true" || value === "false";
    case "BIGINT": {
      if (value.length > 20 || !/^(?:0|-?[1-9]\d*)$/.test(value)) return false;
      const integer = BigInt(value);
      return (
        integer >= -9223372036854775808n && integer <= 9223372036854775807n
      );
    }
    case "DECIMAL": {
      const scale = column.scale!;
      if (value.length > column.precision! + 3) return false;
      if (
        scale
          ? !/^-?(?:0|[1-9]\d*)\.\d+$/.test(value) ||
            value.length - value.indexOf(".") - 1 !== scale
          : !/^(?:0|-?[1-9]\d*)$/.test(value)
      )
        return false;
      const integer = BigInt(value.replace(".", ""));
      if (integer === 0n && value.startsWith("-")) return false;
      return (
        (integer < 0n ? -integer : integer).toString().length <=
        column.precision!
      );
    }
    case "DATE": {
      if (!/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().split("T")[0] === value
      );
    }
  }
}

// DuckDB's default text order is Unicode code-point order, not locale or UTF-16 order.
function textOrder(a: string, b: string): number {
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const left = a.codePointAt(i)!,
      right = b.codePointAt(j)!;
    if (left !== right) return left < right ? -1 : 1;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}

function scalarOrder(a: string, b: string, type: OutputColumn["type"]): number {
  if (a === b) return 0;
  if (type === "BIGINT" || type === "DECIMAL") {
    const left = BigInt(type === "DECIMAL" ? a.replace(".", "") : a);
    const right = BigInt(type === "DECIMAL" ? b.replace(".", "") : b);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (type === "DATE") {
    const left = new Date(`${a}T00:00:00.000Z`).getTime();
    const right = new Date(`${b}T00:00:00.000Z`).getTime();
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return textOrder(a, b);
}

interface OrderingKey {
  index: number;
  type: OutputColumn["type"];
  direction: "ASC" | "DESC";
  nulls: "FIRST" | "LAST";
}

function orderingKeys(contract: OutputContract): OrderingKey[] {
  return contract.ordering.map((key) => {
    const index = contract.columns.findIndex(
      (column) => column.name === key.column,
    );
    return { ...key, index, type: contract.columns[index].type };
  });
}

function rowsOrdered(
  previous: (string | null)[],
  current: (string | null)[],
  keys: OrderingKey[],
): boolean {
  for (const key of keys) {
    const left = previous[key.index],
      right = current[key.index];
    if (left === right) continue;
    if (left === null || right === null)
      return left === null ? key.nulls === "FIRST" : key.nulls === "LAST";
    const order = scalarOrder(left, right, key.type);
    if (order) return key.direction === "ASC" ? order < 0 : order > 0;
  }
  return true;
}

export function compare(
  expected: TypedAnswer | ArrowResult,
  actual: TypedAnswer | ArrowResult,
  contract: OutputContract,
): { pass: boolean; reason?: string } {
  checkedContract(contract);
  const fields = contractFields(contract);
  if (!(expected instanceof ArrowResult) && expected.complete === false)
    return contentFailure("incomplete expected result.");
  if (!(actual instanceof ArrowResult) && actual.complete === false)
    return { pass: false, reason: "The result is incomplete." };
  if (
    expected.fields.length !== fields.length ||
    expected.fields.some(
      (field, i) =>
        field.name !== fields[i].name ||
        !matchesType(contract.columns[i], field),
    )
  )
    return contentFailure("expected columns do not match the output contract.");
  const count =
    expected instanceof ArrowResult ? expected.count : expected.rows.length;
  const actualCount =
    actual instanceof ArrowResult ? actual.count : actual.rows.length;
  const foundFields = actual.fields;
  const nameMismatch = fields.findIndex(
    (field, i) => field.name !== foundFields[i]?.name,
  );
  if (fields.length !== foundFields.length || nameMismatch !== -1) {
    const missing = unmatchedColumns(fields, foundFields);
    const unexpected = unmatchedColumns(foundFields, fields);
    if (missing || unexpected)
      return {
        pass: false,
        reason: [
          `Expected ${fields.length} columns, received ${foundFields.length}.`,
          missing ? `Missing columns: ${missing}.` : "",
          unexpected ? `Unexpected columns: ${unexpected}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    return {
      pass: false,
      reason: `Wrong column order at position ${nameMismatch + 1}: expected ${JSON.stringify(diagnosticText(fields[nameMismatch].name))}, received ${JSON.stringify(diagnosticText(foundFields[nameMismatch].name))}.`,
    };
  }
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i],
      found = foundFields[i];
    if (!matchesType(contract.columns[i], found))
      return {
        pass: false,
        reason: `Column ${i + 1} (${JSON.stringify(diagnosticText(field.name))}): expected ${diagnosticText(sqlTypeName(field.type))}, received ${diagnosticText(sqlTypeName(found.type))}.${contract.columns[i].type === "DECIMAL" ? " Decimal precision can differ. The scale must match exactly." : ""}`,
      };
  }
  if (count !== actualCount)
    return {
      pass: false,
      reason: `Expected ${count} rows, received ${actualCount}. Duplicate rows count separately.`,
    };
  const bag = new Map<string, number>();
  const keys = orderingKeys(contract);
  let previousExpected: (string | null)[] | undefined;
  for (let i = 0; i < count; i++) {
    const row =
      expected instanceof ArrowResult ? expected.getRow(i) : expected.rows[i];
    if (
      row.length !== fields.length ||
      fields.some(
        (_, column) => !scalarValid(row[column], contract.columns[column]),
      )
    )
      return contentFailure(`invalid scalar or row width at row ${i + 1}.`);
    if (previousExpected && !rowsOrdered(previousExpected, row, keys))
      return contentFailure(
        `rows ${i} and ${i + 1} violate the declared ordering.`,
      );
    previousExpected = row;
    const key = JSON.stringify(row);
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  let previous: (string | null)[] | undefined;
  for (let i = 0; i < actualCount; i++) {
    const row =
      actual instanceof ArrowResult ? actual.getRow(i) : actual.rows[i];
    if (
      row.length !== fields.length ||
      fields.some(
        (_, column) => row[column] !== null && typeof row[column] !== "string",
      )
    )
      return {
        pass: false,
        reason: `Row ${i + 1} has an invalid scalar encoding or column count.`,
      };
    const key = JSON.stringify(row),
      remaining = bag.get(key) ?? 0;
    if (!remaining)
      return {
        pass: false,
        reason: `Row ${i + 1} has a different exact value, NULL, or duplicate multiplicity.`,
      };
    if (remaining === 1) bag.delete(key);
    else bag.set(key, remaining - 1);
    if (previous && !rowsOrdered(previous, row, keys))
      return {
        pass: false,
        reason: `Rows ${i} and ${i + 1} violate the declared ordering. Rows with equal ordering keys can appear in any order.`,
      };
    previous = row;
  }
  return {
    pass: bag.size === 0,
    ...(bag.size ? { reason: "Expected rows are missing." } : {}),
  };
}

export function validateExpected(
  input: unknown,
  contract: OutputContract,
  expectedIdentity: ExpectedResultIdentity,
): TypedAnswer {
  checkedContract(contract);
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return contentFailure("an object is required.");
    return value as Record<string, unknown>;
  }
  const value = object(input);
  try {
    validateIdentity(value.identity);
    validateIdentity(expectedIdentity.identity);
  } catch {
    return contentFailure("malformed content identity.");
  }
  if (
    value.formatVersion !== "typed-result-v1" ||
    !sameIdentity(
      value.identity as ContentIdentity,
      expectedIdentity.identity,
    ) ||
    typeof expectedIdentity.datasetId !== "string" ||
    !expectedIdentity.datasetId.trim() ||
    typeof expectedIdentity.variantId !== "string" ||
    !expectedIdentity.variantId.trim() ||
    value.datasetId !== expectedIdentity.datasetId ||
    value.variantId !== expectedIdentity.variantId
  )
    return contentFailure("format or content identity mismatch.");
  if (
    value.complete !== true ||
    !Number.isSafeInteger(value.rowCount) ||
    (value.rowCount as number) < 0 ||
    (value.rowCount as number) > MAX_ROWS ||
    !Array.isArray(value.rows) ||
    value.rows.length !== value.rowCount ||
    !Array.isArray(value.columns) ||
    value.columns.length !== contract.columns.length
  )
    return contentFailure("incomplete result or invalid row/column counts.");
  const columns = checkedContract({
    columns: value.columns as OutputColumn[],
    ordering: [],
  }).columns;
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i],
      declared = contract.columns[i];
    if (
      column.name !== declared.name ||
      column.type !== declared.type ||
      column.scale !== declared.scale
    )
      return contentFailure(
        `column ${i + 1} does not match the output contract.`,
      );
  }
  const rows: (string | null)[][] = [];
  const keys = orderingKeys(contract);
  for (const item of value.rows) {
    if (!Array.isArray(item) || item.length !== columns.length)
      return contentFailure(`invalid width at row ${rows.length + 1}.`);
    for (let i = 0; i < columns.length; i++) {
      // Nullability metadata does not affect equality. The declared value contract does.
      if (
        !scalarValid(item[i], contract.columns[i]) ||
        (item[i] !== null && !scalarValid(item[i], columns[i]))
      )
        return contentFailure(
          `invalid scalar at row ${rows.length + 1}, column ${i + 1}.`,
        );
    }
    const row = item as (string | null)[];
    if (rows.length && !rowsOrdered(rows[rows.length - 1], row, keys))
      return contentFailure(
        `rows ${rows.length} and ${rows.length + 1} violate the declared ordering.`,
      );
    rows.push(row);
  }
  return {
    fields: contractFields({ columns, ordering: [] }),
    rows,
    complete: true,
  };
}
