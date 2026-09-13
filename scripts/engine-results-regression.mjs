import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  Bool,
  DateDay,
  Int64,
  Table,
  Utf8,
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
  console.log(
    "PASS exact comparator typed values, ordering, identity, malformed assets, and Arrow decoding",
  );
} finally {
  await server.close();
}
