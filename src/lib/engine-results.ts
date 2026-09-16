import {
  DataType,
  DateUnit,
  IntervalUnit,
  Table,
  TimeUnit,
  type Data,
  type RecordBatch,
  type Schema,
  type Vector,
} from "apache-arrow";
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
  return displayValue(value);
}

// DuckDB encodes timestamp infinities as the extreme int64 values and date
// infinities as the extreme int32 values. Arrow's own getters convert raw
// integers to Number milliseconds, which loses sub-millisecond digits and
// throws on the sentinels, so every temporal column is decoded from its
// original record-batch buffer instead.
const TIMESTAMP_INFINITY = 9223372036854775807n;
const TIMESTAMP_NEG_INFINITY = -9223372036854775807n;
const DATE_INFINITY = 2147483647;
const DATE_NEG_INFINITY = -2147483647;

const SUBSECOND: Readonly<Record<TimeUnit, bigint>> = {
  [TimeUnit.SECOND]: 1n,
  [TimeUnit.MILLISECOND]: 1_000n,
  [TimeUnit.MICROSECOND]: 1_000_000n,
  [TimeUnit.NANOSECOND]: 1_000_000_000n,
};
const SUBSECOND_DIGITS: Readonly<Record<TimeUnit, number>> = {
  [TimeUnit.SECOND]: 0,
  [TimeUnit.MILLISECOND]: 3,
  [TimeUnit.MICROSECOND]: 6,
  [TimeUnit.NANOSECOND]: 9,
};

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value < 0n && quotient * divisor !== value ? quotient - 1n : quotient;
}

function pad(value: bigint | number, width: number): string {
  return String(value).padStart(width, "0");
}

// Integer proleptic-Gregorian conversion over 400-year eras. JavaScript's Date
// covers a narrower range than DuckDB's timestamps.
function civilFromDays(days: number): { y: number; m: number; d: number } {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPosition = Math.floor((5 * dayOfYear + 2) / 153);
  const d = dayOfYear - Math.floor((153 * monthPosition + 2) / 5) + 1;
  const m = monthPosition + (monthPosition < 10 ? 3 : -9);
  return { y: yearOfEra + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

// ISO 8601 expanded years: four digits inside 0000-9999, otherwise a sign and
// at least six digits. Nonpositive years use astronomical numbering.
function isoYear(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  const sign = year < 0 ? "-" : "+";
  return sign + pad(Math.abs(year), 6);
}

function calendarDate(days: number): string {
  const { y, m, d } = civilFromDays(days);
  return `${isoYear(y)}-${pad(m, 2)}-${pad(d, 2)}`;
}

function fraction(value: bigint, digits: number): string {
  if (!digits || value === 0n) return "";
  const text = pad(value, digits).replace(/0+$/, "");
  return text ? `.${text}` : "";
}

function clockTime(secondsOfDay: bigint, frac: bigint, digits: number): string {
  const hours = secondsOfDay / 3600n;
  const minutes = (secondsOfDay / 60n) % 60n;
  const seconds = secondsOfDay % 60n;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${fraction(frac, digits)}`;
}

type RawDecoder = (data: Data, index: number) => string;

function timestampDecoder(unit: TimeUnit, zoned: boolean): RawDecoder {
  const scale = SUBSECOND[unit];
  const digits = SUBSECOND_DIGITS[unit];
  // DuckDB normalizes zoned timestamps to UTC instants; display them as UTC.
  const suffix = zoned ? "+00:00" : "";
  return (data, index) => {
    const raw = (data.values as BigInt64Array)[index];
    if (raw === TIMESTAMP_INFINITY) return "infinity";
    if (raw === TIMESTAMP_NEG_INFINITY) return "-infinity";
    const seconds = floorDiv(raw, scale);
    const frac = raw - seconds * scale;
    const days = floorDiv(seconds, 86_400n);
    const secondsOfDay = seconds - days * 86_400n;
    return `${calendarDate(Number(days))} ${clockTime(secondsOfDay, frac, digits)}${suffix}`;
  };
}

function timeDecoder(unit: TimeUnit, wide: boolean): RawDecoder {
  const scale = SUBSECOND[unit];
  const digits = SUBSECOND_DIGITS[unit];
  return (data, index) => {
    const raw = wide
      ? (data.values as BigInt64Array)[index]
      : BigInt((data.values as Int32Array)[index]);
    const seconds = floorDiv(raw, scale);
    const frac = raw - seconds * scale;
    return clockTime(seconds, frac, digits);
  };
}

function dateDecoder(unit: DateUnit): RawDecoder {
  if (unit === DateUnit.DAY)
    return (data, index) => {
      const days = (data.values as Int32Array)[index];
      if (days === DATE_INFINITY) return "infinity";
      if (days === DATE_NEG_INFINITY) return "-infinity";
      return calendarDate(days);
    };
  return (data, index) => {
    const millis = (data.values as BigInt64Array)[index];
    return calendarDate(Number(floorDiv(millis, 86_400_000n)));
  };
}

function plural(count: bigint, noun: string): string {
  return `${count} ${count === 1n || count === -1n ? noun : `${noun}s`}`;
}

// Months stay months and days stay days: a month is not a fixed number of days.
// Each component keeps its own sign, exactly as the engine stored it.
function intervalText(months: bigint, days: bigint, nanos: bigint): string {
  const parts: string[] = [];
  if (months) parts.push(plural(months, "month"));
  if (days) parts.push(plural(days, "day"));
  if (nanos) {
    const magnitude = nanos < 0n ? -nanos : nanos;
    const seconds = magnitude / 1_000_000_000n;
    const frac = magnitude % 1_000_000_000n;
    parts.push((nanos < 0n ? "-" : "") + clockTime(seconds, frac, 9));
  }
  return parts.length ? parts.join(" ") : "00:00:00";
}

// Arrow 17 computes an interval stride of 1 + unit, so its MONTH_DAY_NANO
// getter reads three of the four words and drifts across rows. Decode the
// physical words directly and never take an Arrow interval slice or view.
function intervalDecoder(unit: IntervalUnit): RawDecoder {
  if (unit === IntervalUnit.YEAR_MONTH)
    return (data, index) =>
      intervalText(BigInt((data.values as Int32Array)[index]), 0n, 0n);
  if (unit === IntervalUnit.DAY_TIME)
    return (data, index) => {
      const words = data.values as Int32Array;
      return intervalText(
        0n,
        BigInt(words[index * 2]),
        BigInt(words[index * 2 + 1]) * 1_000_000n,
      );
    };
  return (data, index) => {
    const words = data.values as Int32Array;
    const base = index * 4;
    const nanos =
      BigInt(words[base + 3]) * 4_294_967_296n + BigInt(words[base + 2] >>> 0);
    return intervalText(BigInt(words[base]), BigInt(words[base + 1]), nanos);
  };
}

function rawDecoder(type: DataType): RawDecoder | null {
  if (DataType.isTimestamp(type))
    return timestampDecoder(type.unit, Boolean(type.timezone));
  if (DataType.isTime(type))
    return timeDecoder(type.unit, type.bitWidth === 64);
  if (DataType.isDate(type)) return dateDecoder(type.unit);
  if (DataType.isInterval(type)) return intervalDecoder(type.unit);
  return null;
}

export class ArrowResult implements ResultHandle {
  readonly columns: TypedField[];
  readonly fields: TypedField[];
  readonly count: number;
  private readonly table: Table;
  private readonly batches: RecordBatch[];
  // Cumulative first row index of each batch, plus the total row count.
  private readonly starts: number[];
  private readonly decoders: (RawDecoder | null)[];
  private readonly vectors: (Vector | null)[];
  private located = 0;
  constructor(schema: Schema, batches: RecordBatch[]) {
    this.table = new Table(schema, batches);
    this.fields = fieldsOf(schema);
    this.columns = this.fields.map((field, i) => ({
      ...field,
      type: sqlType(schema.fields[i].type),
    }));
    this.count = this.table.numRows;
    this.batches = this.table.batches;
    this.starts = [0];
    for (const batch of this.batches)
      this.starts.push(this.starts[this.starts.length - 1] + batch.numRows);
    this.decoders = schema.fields.map((field) => rawDecoder(field.type));
    this.vectors = this.decoders.map((decoder, column) =>
      decoder ? null : this.table.getChildAt(column),
    );
  }
  // Rows arrive in both directions, so resume from the last located batch
  // instead of rescanning or materializing a string table.
  private locate(index: number): number {
    let batch = this.located;
    if (batch >= this.batches.length || index < this.starts[batch]) batch = 0;
    while (this.starts[batch + 1] <= index) batch++;
    this.located = batch;
    return batch;
  }
  getRow(index: number): (string | null)[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return [];
    const batch = this.locate(index);
    const local = index - this.starts[batch];
    const children = this.batches[batch].data.children;
    return this.fields.map((field, column) => {
      const decoder = this.decoders[column];
      if (!decoder) return cell(this.vectors[column]!.get(index), field);
      const data = children[column];
      return data.getValid(local) ? decoder(data, local) : null;
    });
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

/**
 * Names the expected row that a returned row most plausibly corresponds to, so
 * a mismatch can say *which column* is wrong instead of listing every reason a
 * row can fail. With declared ordering the correspondence is the ordering key,
 * which is what the learner sorted by; without one it is the expected row that
 * differs in the fewest columns. A row sharing nothing with any expected row
 * has no correspondence and is simply not expected.
 *
 * Equal ordering keys are explicitly allowed — the ranking challenges are built
 * on ties — so the keyed branch considers every peer sharing the key and takes
 * the closest of them. Naming a column from an arbitrary tied peer would report
 * a difference the learner did not make.
 */
function nearestExpected(
  row: (string | null)[],
  expectedRows: (string | null)[][],
  keys: OrderingKey[],
): { differing: number[] } | null {
  const differences = (candidate: (string | null)[]) =>
    candidate.reduce<number[]>(
      (found, value, index) =>
        value === row[index] ? found : [...found, index],
      [],
    );
  const candidates = keys.length
    ? expectedRows.filter((candidate) =>
        keys.every((key) => candidate[key.index] === row[key.index]),
      )
    : expectedRows;
  if (keys.length && !candidates.length) return null;
  let best: number[] | null = null;
  for (const candidate of candidates) {
    const differing = differences(candidate);
    // Without an ordering key, a row sharing nothing with a candidate is not a
    // correspondence at all; with one, the shared key is already the evidence.
    if (
      (keys.length || differing.length < row.length) &&
      (!best || differing.length < best.length)
    )
      best = differing;
  }
  return best ? { differing: best } : null;
}

/**
 * Explains an unmatched returned row without disclosing an expected value.
 * The column name, the learner's own value and the multiplicity are all
 * information they already hold; the expected scalar is the answer, and the
 * curriculum reserves boundary guidance for the third hint.
 */
function unmatchedRowReason(
  position: number,
  row: (string | null)[],
  expectedRows: (string | null)[][],
  expectedCounts: Map<string, number>,
  multiplicity: (key: string) => number,
  keys: OrderingKey[],
  fields: TypedField[],
): string {
  const key = JSON.stringify(row);
  const expectedCount = expectedCounts.get(key) ?? 0;
  if (expectedCount) {
    const returned = multiplicity(key);
    return `Row ${position} repeats ${formatTimes(returned)}; the expected result contains that exact row ${formatTimes(expectedCount)}.`;
  }
  const near = nearestExpected(row, expectedRows, keys);
  const describeSelf = (index: number) =>
    `${JSON.stringify(diagnosticText(fields[index].name))} (you returned ${row[index] === null ? "NULL" : JSON.stringify(diagnosticText(row[index]))})`;
  if (!near) {
    const identity = keys.length
      ? ` No expected row has ${keys
          .map((key) => describeSelf(key.index))
          .join(", ")}.`
      : "";
    return `Row ${position} is not in the expected result.${identity} An extra row usually means the filter admits too much.`;
  }
  if (!near.differing.length)
    return `Row ${position} is not in the expected result.`;
  const columns = near.differing
    .slice(0, 3)
    .map((index) => `column ${index + 1} ${describeSelf(index)}`)
    .join(", ");
  const more =
    near.differing.length > 3
      ? ` and ${near.differing.length - 3} further column${near.differing.length - 3 === 1 ? "" : "s"}`
      : "";
  const anchor = keys.length
    ? `the expected row with the same ${keys.length === 1 ? "ordering key" : "ordering keys"}`
    : "its closest expected row";
  return `Row ${position} differs from ${anchor} in ${columns}${more}. Values are compared exactly, and NULL never equals a value.`;
}

function formatTimes(count: number): string {
  return count === 1 ? "once" : `${count} times`;
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
  // A row-count mismatch used to return here, which reported the two counts and
  // nothing else: the learner was told "expected 9, received 11" against a
  // variant they cannot query, with no way to tell which two rows were the
  // extra ones. The row analysis below runs even when the counts differ, so the
  // message names a returned row and the column that makes it wrong. The counts
  // themselves are not repeated here: the scorecard line that carries this
  // reason already prints "expected N rows; returned M" structurally.
  const expectedRows: (string | null)[][] = [];
  const expectedCounts = new Map<string, number>();
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
    expectedRows.push(row);
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }
  const bag = new Map(expectedCounts);
  // Returned rows are streamed rather than collected: a wrong query can return
  // far more rows than the fixture, and only the first unmatched row is ever
  // described. Its multiplicity is counted by re-reading on that failure path.
  const multiplicity = (wanted: string) => {
    let seen = 0;
    for (let i = 0; i < actualCount; i++)
      if (
        JSON.stringify(
          actual instanceof ArrowResult ? actual.getRow(i) : actual.rows[i],
        ) === wanted
      )
        seen++;
    return seen;
  };
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
        reason: unmatchedRowReason(
          i + 1,
          row,
          expectedRows,
          expectedCounts,
          multiplicity,
          keys,
          fields,
        ),
      };
    if (remaining === 1) bag.delete(key);
    else bag.set(key, remaining - 1);
    // Ordering is only checked once the row itself belongs, so a wrong row is
    // never reported as an ordering fault.
    if (previous && !rowsOrdered(previous, row, keys))
      return {
        pass: false,
        reason: `Rows ${i} and ${i + 1} violate the declared ordering. Rows with equal ordering keys can appear in any order.`,
      };
    previous = row;
  }
  // Every returned row belongs, so anything left over is a row the learner did
  // not produce. The count is theirs to know; the missing values are the answer.
  const missing = [...bag.values()].reduce((total, each) => total + each, 0);
  if (missing)
    return {
      pass: false,
      reason: `Every row you returned is expected, but ${missing === 1 ? "one expected row is" : `${missing} expected rows are`} missing. A missing row usually means the filter, the join or the grouping drops it.`,
    };
  // A count mismatch cannot survive to here: the bag holds exactly `count`
  // entries and each surviving returned row consumes one, so a longer result
  // fails a lookup above and a shorter one leaves the leftovers just reported.
  return { pass: true };
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
