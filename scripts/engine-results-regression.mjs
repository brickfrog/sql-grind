import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  Bool,
  DateDay,
  Field,
  Int64,
  Interval,
  IntervalUnit,
  RecordBatch,
  Schema,
  Table,
  Time,
  TimeUnit,
  Timestamp,
  Utf8,
  makeData,
  vectorFromArray,
} from "apache-arrow";

// Exercise the production TypeScript module without starting a SQL worker.
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { ArrowResult, EngineFailure, cell, compare, validateExpected } =
    await server.ssrLoadModule("/src/lib/engine-results.ts");
  const identity = {
    challengeId: "regression.01",
    bundleVersion: "regression-bundle-v1",
    challengeVersion: "regression-v1",
    datasetVersion: "regression-data-v1",
    assessmentVersion: "exact-v1",
    engineVersion: "v1.5.4",
  };
  const envelope = { identity, datasetId: "regression", variantId: "boundary" };
  const columns = [
    {
      name: "amount",
      type: "DECIMAL",
      precision: 38,
      scale: 2,
      nullable: true,
    },
    { name: "id", type: "BIGINT", nullable: false },
    { name: "label", type: "VARCHAR", nullable: true },
    { name: "day", type: "DATE", nullable: false },
    { name: "flag", type: "BOOLEAN", nullable: false },
    { name: "extra", type: "VARCHAR", nullable: false },
  ];
  const contract = {
    columns,
    ordering: [
      { column: "amount", direction: "DESC", nulls: "FIRST" },
      { column: "id", direction: "ASC", nulls: "LAST" },
    ],
  };
  const rows = [
    [null, "-9223372036854775808", null, "2024-02-29", "false", ""],
    [
      "12345678901234567890.12",
      "9007199254740992",
      "A",
      "2024-03-01",
      "true",
      "",
    ],
    [
      "12345678901234567890.12",
      "9007199254740993",
      "B",
      "2024-03-01",
      "true",
      "",
    ],
    [
      "12345678901234567890.12",
      "9007199254740993",
      "C",
      "2024-03-01",
      "false",
      "",
    ],
    ["12345678901234567890.11", "10", "D", "2024-03-02", "true", ""],
    ["-2.00", "10", "D", "2024-03-02", "true", ""],
    ["-10.00", "10", "D", "2024-03-02", "true", ""],
    ["-10.00", "10", "D", "2024-03-02", "true", ""],
  ];
  function asset(output = contract, values = rows) {
    return {
      formatVersion: "typed-result-v1",
      ...structuredClone(envelope),
      columns: structuredClone(output.columns),
      complete: true,
      rowCount: values.length,
      rows: structuredClone(values),
    };
  }
  const expected = validateExpected(asset(), contract, envelope);
  function compared(
    name,
    change,
    pass,
    output = contract,
    baseline = expected,
  ) {
    const candidate = structuredClone(baseline);
    change(candidate);
    assert.equal(compare(baseline, candidate, output).pass, pass, name);
  }
  function malformed(name, change, output = contract) {
    const input = asset(output);
    change(input);
    assert.throws(
      () => validateExpected(input, output, envelope),
      (error) =>
        error instanceof EngineFailure && error.outcome === "engine-error",
      name,
    );
  }
  // The verdict alone was covered; the wording was not, and the wording is what
  // the learner acts on. A row-set mismatch used to say only "expected 9 rows;
  // returned 11" and "row 4 has a different exact value, NULL, or duplicate
  // multiplicity" — a location without a cause, against a grading variant the
  // learner cannot query. These pin the cause and the location.
  function reasoned(name, change, pattern, output = contract) {
    const candidate = structuredClone(expected);
    change(candidate);
    const verdict = compare(expected, candidate, output);
    assert.equal(verdict.pass, false, name);
    assert.match(verdict.reason, pattern, `${name}: ${verdict.reason}`);
    // Nothing in the message may disclose a scalar that exists only in the
    // expected result: the column name, the learner's own value and the
    // multiplicity are theirs already, while the expected value is the answer.
    // Values are emitted through JSON.stringify, so the quoted form is what is
    // searched for. A bare substring test would need a length floor to avoid
    // matching "10" inside "Row 10", and that floor would permanently exempt
    // the one-character labels — exactly the column most likely to leak.
    const returned = new Set(
      candidate.rows.flat().filter((value) => typeof value === "string"),
    );
    const withheld = expected.rows
      .flat()
      .filter((value) => typeof value === "string" && !returned.has(value));
    for (const value of withheld)
      assert.equal(
        verdict.reason.includes(JSON.stringify(value)),
        false,
        `${name} disclosed the expected value ${value}: ${verdict.reason}`,
      );
    return { reason: verdict.reason, withheld };
  }

  // An extra row is the boundary case: a half-open interval read as closed
  // returns one row too many, and the learner needs to know which one.
  reasoned(
    "an extra row is named with its own ordering key",
    (x) => {
      x.rows.splice(4, 0, [
        "12345678901234567890.12",
        "9007199254740994",
        "Z",
        "2024-03-05",
        "true",
        "",
      ]);
    },
    /^Row 5 is not in the expected result\. No expected row has "amount".*"id".*9007199254740994.*admits too much/s,
  );
  // A wrong value in an otherwise correct row must name the column.
  reasoned(
    "a wrong value names the column and the learner's own value",
    (x) => {
      x.rows[4][2] = "WRONG";
    },
    /Row 5 differs from the expected row with the same ordering keys in column 3 "label" \(you returned "WRONG"\)/,
  );
  // NULL against a value is the other half of the reported ambiguity.
  reasoned(
    "a NULL in place of a value is named as NULL",
    (x) => {
      x.rows[4][2] = null;
    },
    /column 3 "label" \(you returned NULL\)/,
  );
  // Equal ordering keys are allowed, and the ranking challenges are built on
  // ties. Rows 3 and 4 share both keys, and row 4 is the closer peer, so taking
  // the first key match would blame the flag column as well as the label — a
  // difference the learner never made.
  const tied = reasoned(
    "a tied ordering key blames only the columns that actually differ",
    (x) => {
      x.rows[3][2] = "X";
    },
    /Row 4 differs from the expected row with the same ordering keys in column 3 "label" \(you returned "X"\)\. Values/,
  );
  assert.equal(
    /flag/.test(tied.reason),
    false,
    `a tied peer's unrelated column must not be blamed: ${tied.reason}`,
  );

  // Duplicate multiplicity was the third possibility folded into one message.
  // The copy keeps the declared descending order, so the multiplicity fault is
  // what the comparator reaches rather than an ordering fault.
  reasoned(
    "a duplicated row reports both multiplicities",
    (x) => {
      x.rows[5] = [...x.rows[6]];
    },
    /Row 8 repeats 3 times; the expected result contains that exact row 2 times/,
  );
  // A missing row cannot be described without disclosing it, so the count is
  // reported and the cause is named.
  reasoned(
    "a missing row reports the count and the usual cause",
    (x) => {
      x.rows.splice(4, 1);
    },
    /^Every row you returned is expected, but one expected row is missing\..*filter, the join or the grouping drops it/s,
  );
  // The non-disclosure guard above is only meaningful where the expected result
  // actually holds a value the learner never returned. Replacing an ordering
  // key does exactly that: the expected amount for that row disappears from the
  // candidate, and the message must locate the row without ever printing it.
  const guarded = reasoned(
    "a wrong ordering key is located without disclosing the expected value",
    (x) => {
      x.rows[4][0] = "-1.00";
    },
    /Row 5 is not in the expected result\. No expected row has "amount" \(you returned "-1.00"\), "id" \(you returned "10"\)/,
  );
  assert.ok(
    guarded.withheld.includes("12345678901234567890.11"),
    "the expected-only amount must be in the withheld set for the guard to mean anything",
  );
  // Replacing a key leaves the counts equal, so there is no surplus to blame a
  // loose filter for. The message ends at the identity clause: a query can drop
  // rows and admit a wrong one at the same time, so no cause can be named from
  // the counts alone. The filter theory used to be appended to every unmatched
  // row regardless of direction.
  assert.match(
    guarded.reason,
    /No expected row has "amount" \(you returned "-1\.00"\), "id" \(you returned "10"\)\.$/,
    `an unmatched row without a surplus ends at the fault it can locate: ${guarded.reason}`,
  );

  compared("typed exact results", () => {}, true);
  compared(
    "equal-key peers may swap",
    (x) => {
      [x.rows[2], x.rows[3]] = [x.rows[3], x.rows[2]];
    },
    true,
  );
  compared(
    "large integer tie-break remains exact",
    (x) => {
      [x.rows[1], x.rows[2]] = [x.rows[2], x.rows[1]];
    },
    false,
  );
  compared(
    "decimal ordering does not round",
    (x) => {
      [x.rows[3], x.rows[4]] = [x.rows[4], x.rows[3]];
    },
    false,
  );
  compared(
    "negative decimal order is numeric",
    (x) => {
      [x.rows[5], x.rows[6]] = [x.rows[6], x.rows[5]];
    },
    false,
  );
  compared(
    "NULL placement is independent of DESC",
    (x) => {
      x.rows.push(x.rows.shift());
    },
    false,
  );
  compared(
    "duplicate loss",
    (x) => {
      x.rows.pop();
    },
    false,
  );
  compared(
    "same-count duplicate replacement",
    (x) => {
      x.rows[7] = [...x.rows[5]];
    },
    false,
  );
  compared(
    "NULL is not text",
    (x) => {
      x.rows[0][2] = "NULL";
    },
    false,
  );
  compared(
    "exact strings are not normalized",
    (x) => {
      x.rows[1][2] = "a";
    },
    false,
  );
  compared(
    "decimal scale cannot change",
    (x) => {
      x.fields[0].scale = 3;
      x.fields[0].type = "Decimal[38e+3]";
    },
    false,
  );
  compared(
    "decimal precision may differ",
    (x) => {
      x.fields[0].precision = 30;
      x.fields[0].type = "Decimal[30e+2]";
    },
    true,
  );
  compared(
    "integer type cannot narrow",
    (x) => {
      x.fields[1].type = "Int32";
    },
    false,
  );
  compared(
    "float cannot replace decimal",
    (x) => {
      x.fields[0].type = "Float64";
    },
    false,
  );
  compared(
    "columns cannot reorder",
    (x) => {
      [x.fields[1], x.fields[2]] = [x.fields[2], x.fields[1]];
    },
    false,
  );
  compared(
    "incomplete output never passes",
    (x) => {
      x.complete = false;
    },
    false,
  );
  compared(
    "unordered output remains a multiset",
    (x) => {
      x.rows.reverse();
    },
    true,
    { columns, ordering: [] },
  );

  for (const key of Object.keys(identity))
    malformed(`identity mismatch: ${key}`, (x) => {
      x.identity[key] += "-old";
    });
  malformed("missing identity", (x) => {
    delete x.identity;
  });
  malformed("wrong dataset", (x) => {
    x.datasetId = "other";
  });
  malformed("wrong variant", (x) => {
    x.variantId = "other";
  });
  malformed("wrong format", (x) => {
    x.formatVersion = "typed-result-v2";
  });
  malformed("missing completion", (x) => {
    delete x.complete;
  });
  malformed("incomplete asset", (x) => {
    x.complete = false;
  });
  malformed("false row count", (x) => {
    x.rowCount--;
  });
  malformed("fractional row count", (x) => {
    x.rowCount = 1.5;
  });
  malformed("row width", (x) => {
    x.rows[0].pop();
  });
  malformed("duplicate columns", (x) => {
    x.columns[2].name = "id";
  });
  malformed("wrong column type", (x) => {
    x.columns[1].type = "INTEGER";
  });
  malformed("missing nullability", (x) => {
    delete x.columns[1].nullable;
  });
  malformed("invalid decimal metadata", (x) => {
    x.columns[0].scale = 39;
  });
  malformed("decimal overflow", (x) => {
    x.columns[0].precision = 18;
  });
  malformed("number instead of scalar string", (x) => {
    x.rows[1][1] = 9007199254740992;
  });
  malformed("integer overflow", (x) => {
    x.rows[1][1] = "9223372036854775808";
  });
  malformed("noncanonical integer", (x) => {
    x.rows[1][1] = "01";
  });
  malformed("decimal exponent", (x) => {
    x.rows[1][0] = "1e2";
  });
  malformed("wrong scalar scale", (x) => {
    x.rows[1][0] = "1.0";
  });
  malformed("negative zero", (x) => {
    x.rows[1][0] = "-0.00";
  });
  malformed("impossible date", (x) => {
    x.rows[1][3] = "2024-02-30";
  });
  malformed("boolean must be encoded text", (x) => {
    x.rows[1][4] = true;
  });
  malformed("boolean must use lowercase", (x) => {
    x.rows[1][4] = "TRUE";
  });
  malformed("required value cannot be NULL", (x) => {
    x.rows[1][1] = null;
  });
  malformed("expected ordering", (x) => {
    x.rows.reverse();
  });
  const metadataOnly = asset();
  metadataOnly.columns[0].nullable = false;
  assert.deepEqual(
    validateExpected(metadataOnly, contract, envelope).rows,
    rows,
    "nullability metadata does not override the declared value contract",
  );
  const narrower = asset();
  narrower.columns[0].precision = 30;
  assert.deepEqual(validateExpected(narrower, contract, envelope).rows, rows);
  const empty = validateExpected(asset(contract, []), contract, envelope);
  assert.equal(compare(empty, empty, contract).pass, true, "zero-row results");
  assert.throws(
    () =>
      validateExpected(
        asset(),
        {
          columns,
          ordering: [{ column: "missing", direction: "ASC", nulls: "LAST" }],
        },
        envelope,
      ),
    EngineFailure,
  );

  for (const [type, values] of [
    ["BIGINT", ["-10", "-2", "9007199254740992", "9007199254740993", null]],
    ["DATE", ["2023-12-31", "2024-02-29", "2024-03-01", null]],
    ["BOOLEAN", ["false", "true", null]],
    ["VARCHAR", ["", "A", "a", "\ue000", "\u{10000}", null]],
  ]) {
    const output = {
      columns: [{ name: "value", type, nullable: true }],
      ordering: [{ column: "value", direction: "ASC", nulls: "LAST" }],
    };
    const answer = validateExpected(
      asset(
        output,
        values.map((value) => [value]),
      ),
      output,
      envelope,
    );
    compared(`${type} typed ordering`, () => {}, true, output, answer);
    compared(
      `${type} reversed ordering`,
      (x) => {
        x.rows.reverse();
      },
      false,
      output,
      answer,
    );
  }

  const table = new Table({
    id: vectorFromArray([9007199254740993n, 9223372036854775807n], new Int64()),
    label: vectorFromArray([null, "NULL"], new Utf8()),
    day: vectorFromArray(
      [new Date("2024-02-29Z"), new Date("2024-03-01Z")],
      new DateDay(),
    ),
    flag: vectorFromArray([false, true], new Bool()),
  });
  const arrow = new ArrowResult(table.schema, table.batches);
  const arrowOutput = {
    columns: [
      { name: "id", type: "BIGINT", nullable: false },
      { name: "label", type: "VARCHAR", nullable: true },
      { name: "day", type: "DATE", nullable: false },
      { name: "flag", type: "BOOLEAN", nullable: false },
    ],
    ordering: [{ column: "id", direction: "ASC", nulls: "LAST" }],
  };
  const arrowExpected = validateExpected(
    asset(arrowOutput, [
      ["9007199254740993", null, "2024-02-29", "false"],
      ["9223372036854775807", "NULL", "2024-03-01", "true"],
    ]),
    arrowOutput,
    envelope,
  );
  assert.equal(
    compare(arrowExpected, arrow, arrowOutput).pass,
    true,
    "actual Arrow decoding",
  );
  assert.equal(
    compare(arrow, arrow, arrowOutput).pass,
    true,
    "Arrow reference input",
  );
  assert.equal(
    cell(new Uint32Array([0xffffff85, 0xffffffff, 0xffffffff, 0xffffffff]), {
      name: "money",
      type: "Decimal[38e+2]",
      scale: 2,
      precision: 38,
    }),
    "-1.23",
  );
  // Temporal decoding. Arrow's own getters convert raw integers to Number
  // milliseconds and compute an interval stride of 1 + unit, so these values
  // are decoded from the original record-batch buffers instead.
  function validityBitmap(valid) {
    const bitmap = new Uint8Array((valid.length + 7) >> 3);
    valid.forEach((ok, i) => {
      if (ok) bitmap[i >> 3] |= 1 << i % 8;
    });
    return bitmap;
  }
  function nullProps(valid) {
    if (!valid) return {};
    return {
      nullBitmap: validityBitmap(valid),
      nullCount: valid.filter((ok) => !ok).length,
    };
  }
  // Four Int32 words per row: months, days, low nanoseconds, high nanoseconds.
  function intervalColumn(rows, valid) {
    const words = new Int32Array(rows.length * 4);
    rows.forEach(([months, days, nanos], index) => {
      const base = index * 4;
      const value = BigInt(nanos);
      words[base] = months;
      words[base + 1] = days;
      words[base + 2] = Number(value & 0xffffffffn) | 0;
      words[base + 3] = Number(value >> 32n);
    });
    return makeData({
      type: new Interval(IntervalUnit.MONTH_DAY_NANO),
      length: rows.length,
      data: words,
      ...nullProps(valid),
    });
  }
  function bigColumn(type, values, valid) {
    return makeData({
      type,
      length: values.length,
      data: BigInt64Array.from(values.map(BigInt)),
      ...nullProps(valid),
    });
  }
  function decoded(children) {
    const batches = children.map(
      (columns) => new RecordBatch(Object.fromEntries(columns)),
    );
    const schema = new Schema(
      children[0].map(([name, data]) =>
        Field.new({ name, type: data.type, nullable: true }),
      ),
    );
    const handle = new ArrowResult(schema, batches);
    return {
      handle,
      rows: Array.from({ length: handle.count }, (_, i) => handle.getRow(i)),
    };
  }

  const constant = decoded([
    [["iv", intervalColumn(Array.from({ length: 5 }, () => [0, 3, 0n]))]],
  ]);
  assert.deepEqual(
    constant.rows,
    Array.from({ length: 5 }, () => ["3 days"]),
    "constant interval decodes identically in every row",
  );

  const intervals = decoded([
    [
      [
        "iv",
        intervalColumn(
          [
            [1, 2, 10_800_000_000_000n],
            [-5, 0, 0n],
            [0, 0, 0n],
            [-1, 2, -10_800_000_000_000n],
            [13, 0, 4_500_000_000n],
            [0, 0, 0n],
            [0, 0, -1n],
          ],
          [true, true, true, true, true, false, true],
        ),
      ],
    ],
  ]);
  assert.deepEqual(
    intervals.rows,
    [
      ["1 month 2 days 03:00:00"],
      ["-5 months"],
      ["00:00:00"],
      ["-1 month 2 days -03:00:00"],
      ["13 months 00:00:04.5"],
      [null],
      ["-00:00:00.000000001"],
    ],
    "each interval row keeps its own months, days, and signed time",
  );

  const micro = new Timestamp(TimeUnit.MICROSECOND);
  const stamps = decoded([
    [
      [
        "ts",
        bigColumn(micro, [
          1_709_296_496_123_456n,
          -1n,
          0n,
          9223372036854775807n,
          -9223372036854775807n,
          9_223_372_036_854_775_000n,
        ]),
      ],
      [
        "tstz",
        bigColumn(new Timestamp(TimeUnit.MICROSECOND, "UTC"), [
          1_709_296_496_123_456n,
          -1n,
          0n,
          1n,
          -62_135_596_800_000_000n,
          253_402_300_799_999_999n,
        ]),
      ],
      [
        "nanos",
        bigColumn(new Timestamp(TimeUnit.NANOSECOND), [
          1_709_296_496_123_456_789n,
          -1n,
          0n,
          1n,
          -1_000_000_000n,
          123_456_789n,
        ]),
      ],
      [
        "secs",
        bigColumn(new Timestamp(TimeUnit.SECOND), [
          1_709_296_496n,
          -1n,
          0n,
          1n,
          -62_135_596_800n,
          253_402_300_799n,
        ]),
      ],
      [
        "millis",
        bigColumn(new Timestamp(TimeUnit.MILLISECOND), [
          1_709_296_496_123n,
          -1n,
          0n,
          1n,
          -1n,
          -2n,
        ]),
      ],
    ],
  ]);
  assert.deepEqual(
    stamps.rows,
    [
      [
        "2024-03-01 12:34:56.123456",
        "2024-03-01 12:34:56.123456+00:00",
        "2024-03-01 12:34:56.123456789",
        "2024-03-01 12:34:56",
        "2024-03-01 12:34:56.123",
      ],
      [
        "1969-12-31 23:59:59.999999",
        "1969-12-31 23:59:59.999999+00:00",
        "1969-12-31 23:59:59.999999999",
        "1969-12-31 23:59:59",
        "1969-12-31 23:59:59.999",
      ],
      [
        "1970-01-01 00:00:00",
        "1970-01-01 00:00:00+00:00",
        "1970-01-01 00:00:00",
        "1970-01-01 00:00:00",
        "1970-01-01 00:00:00",
      ],
      [
        "infinity",
        "1970-01-01 00:00:00.000001+00:00",
        "1970-01-01 00:00:00.000000001",
        "1970-01-01 00:00:01",
        "1970-01-01 00:00:00.001",
      ],
      [
        "-infinity",
        "0001-01-01 00:00:00+00:00",
        "1969-12-31 23:59:59",
        "0001-01-01 00:00:00",
        "1969-12-31 23:59:59.999",
      ],
      [
        "+294247-01-10 04:00:54.775",
        "9999-12-31 23:59:59.999999+00:00",
        "1970-01-01 00:00:00.123456789",
        "9999-12-31 23:59:59",
        "1969-12-31 23:59:59.998",
      ],
    ],
    "timestamps keep their declared unit, sentinels, and out-of-Date range",
  );

  const times = decoded([
    [
      [
        "wide",
        bigColumn(new Time(TimeUnit.MICROSECOND, 64), [
          30_600_000_000n,
          0n,
          86_399_999_999n,
        ]),
      ],
      [
        "narrow",
        makeData({
          type: new Time(TimeUnit.SECOND, 32),
          length: 3,
          data: Int32Array.from([30_600, 0, 86_399]),
        }),
      ],
    ],
  ]);
  assert.deepEqual(
    times.rows,
    [
      ["08:30:00", "08:30:00"],
      ["00:00:00", "00:00:00"],
      ["23:59:59.999999", "23:59:59"],
    ],
    "time values carry no epoch date and keep declared precision",
  );

  // Two batches, nulls straddling both the batch and the null-bitmap byte
  // boundary, read forward and then in reverse.
  const spanning = decoded([
    [
      [
        "iv",
        intervalColumn(
          [
            [0, 1, 0n],
            [0, 2, 0n],
            [0, 3, 0n],
            [0, 4, 0n],
            [0, 5, 0n],
          ],
          [true, true, false, true, true],
        ),
      ],
      [
        "ts",
        bigColumn(
          micro,
          [0n, 1_000_000n, 2_000_000n, 3_000_000n, 4_000_000n],
          [true, false, true, true, true],
        ),
      ],
    ],
    [
      [
        "iv",
        intervalColumn(
          [
            [0, 6, 0n],
            [0, 7, 0n],
            [0, 8, 0n],
            [0, 9, 0n],
            [0, 10, 0n],
            [0, 11, 0n],
            [0, 12, 0n],
          ],
          [true, true, true, false, true, true, true],
        ),
      ],
      [
        "ts",
        bigColumn(
          micro,
          [
            5_000_000n,
            6_000_000n,
            7_000_000n,
            8_000_000n,
            9_000_000n,
            10_000_000n,
            11_000_000n,
          ],
          [true, true, true, true, true, true, false],
        ),
      ],
    ],
  ]);
  const spanningExpected = [
    ["1 day", "1970-01-01 00:00:00"],
    ["2 days", null],
    [null, "1970-01-01 00:00:02"],
    ["4 days", "1970-01-01 00:00:03"],
    ["5 days", "1970-01-01 00:00:04"],
    ["6 days", "1970-01-01 00:00:05"],
    ["7 days", "1970-01-01 00:00:06"],
    ["8 days", "1970-01-01 00:00:07"],
    [null, "1970-01-01 00:00:08"],
    ["10 days", "1970-01-01 00:00:09"],
    ["11 days", "1970-01-01 00:00:10"],
    ["12 days", null],
  ];
  assert.equal(spanning.handle.count, 12);
  assert.deepEqual(
    spanning.rows,
    spanningExpected,
    "record-batch and null-bitmap boundaries decode in forward order",
  );
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) =>
      spanning.handle.getRow(11 - i),
    ).reverse(),
    spanningExpected,
    "the same rows decode in reverse access order",
  );

  console.log(
    "PASS exact comparator typed values, ordering, identity, malformed assets, Arrow decoding, and temporal decoding",
  );
} finally {
  await server.close();
}
