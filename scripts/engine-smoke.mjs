import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appUrl = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173");
const origin = appUrl.origin;
const evidencePath = "readiness/evidence/application/engine-smoke.json";
const checks = [],
  expectedErrors = [],
  errors = [],
  browserErrors = [],
  blockedRequests = [];
let browser,
  context,
  page,
  reference,
  contentIdentity,
  datasetId,
  revision = 0,
  currentCheck;
const startedAt = new Date().toISOString();
const longSql =
  "SELECT sum(i * j) AS total FROM range(1000000) a(i), range(1000000) b(j)";
const counts = {
  categories: 48,
  customers: 500,
  warehouses: 14,
  products: 240,
  orders: 2000,
  order_items: 8500,
  payments: 2100,
  returns: 126,
};

async function bounded(promise, name, timeout = 90_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`${name} exceeded smoke deadline ${timeout} ms`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function check(name, operation, injected = false) {
  currentCheck = name;
  const start = performance.now();
  try {
    const details = await operation();
    checks.push({
      name,
      outcome: "pass",
      injected,
      wallMs: performance.now() - start,
      details,
    });
    console.log("PASS", name);
    currentCheck = undefined;
    return details;
  } catch (error) {
    checks.push({
      name,
      outcome: "fail",
      injected,
      wallMs: performance.now() - start,
      error: String(error),
    });
    throw error;
  }
}
function request(sql, kind = "execute") {
  const next = ++revision;
  return {
    id: `engine-smoke-${next}`,
    documentId: "engine-smoke-document",
    revision: next,
    sql,
    kind,
    domain: "challenge",
    hintLevel: 0,
    challenge: contentIdentity,
    datasetId,
  };
}
async function run(sql, kind = "execute", timeout = 150_000) {
  const req = request(sql, kind);
  const value = await bounded(
    page.evaluate(
      async (req) =>
        window.engineProof.snapshot(await window.engineProof.engine.run(req)),
      req,
    ),
    req.id,
    timeout,
  );
  assert.equal(value.id, req.id);
  assert.equal(value.documentId, req.documentId);
  assert.deepEqual(value.challenge, req.challenge);
  assert.equal(value.datasetId, req.datasetId);
  assert.equal(value.revision, req.revision);
  return value;
}
function complete(value) {
  assert.equal(value.outcome, "complete", value.message);
  assert.ok(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0);
}
function nonpass(value, outcome, label) {
  assert.equal(value.outcome, outcome, value.message);
  assert.equal(value.correctness, "not-evaluated");
  assert.equal(value.result, null);
  expectedErrors.push({
    name: label,
    outcome: value.outcome,
    message: value.message,
    sqlMs: value.elapsedMs,
  });
}
async function recovery() {
  const value = await run("SELECT 42::BIGINT AS answer");
  complete(value);
  assert.equal(value.correctness, "not-evaluated");
  assert.deepEqual(
    value.result.columns.map(({ name, type }) => ({ name, type })),
    [{ name: "answer", type: "BIGINT" }],
  );
  assert.deepEqual(value.result.rows, [["42"]]);
  return value;
}
async function beginLong() {
  const req = request(longSql);
  await page.evaluate((req) => {
    const p = window.engineProof;
    p.longSettled = false;
    p.longStartedAt = performance.now();
    p.longStatesFrom = p.states.length;
    p.longPromise = p.engine.run(req).then((value) => {
      p.longSettled = true;
      return p.snapshot(value);
    });
  }, req);
  await page.waitForFunction(
    () => {
      const p = window.engineProof;
      return (
        p.longSettled ||
        p.states
          .slice(p.longStatesFrom)
          .some((event) => event.state === "running")
      );
    },
    null,
    { timeout: 45_000 },
  );
  assert.equal(
    await page.evaluate(() => window.engineProof.longSettled),
    false,
    "Long computation ended before the intended intervention",
  );
}
async function finishLong() {
  return bounded(
    page.evaluate(() => window.engineProof.longPromise),
    "long-query outcome",
    20_000,
  );
}

try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blockedRequests.push({
        url: url.href,
        resourceType: route.request().resourceType(),
      });
      return route.abort("blockedbyclient");
    }
    // No application UI mounts here: only the exported production coordinator owns workers.
    if (url.pathname === "/__engine_smoke__")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Engine module smoke</title>",
      });
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("pageerror", (error) =>
    browserErrors.push({
      kind: "pageerror",
      message: String(error),
      check: currentCheck,
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      browserErrors.push({
        kind: "console",
        message: message.text(),
        check: currentCheck,
      });
  });
  await page.goto(new URL("/__engine_smoke__", origin).href);
  await bounded(
    page.evaluate(async () => {
      const { EngineCoordinator } = await import("/src/lib/engine.ts");
      const { ChallengeCatalog } = await import("/src/lib/challenges.ts");
      const catalog = await ChallengeCatalog.load();
      const loaded = await catalog.load("window.03");
      const results = await import("/src/lib/engine-results.ts");
      const diagnostics = await import("/src/lib/engine-diagnostics.ts");
      const states = [];
      const engine = new EngineCoordinator((state, message) => {
        states.push({ state, message, atMs: performance.now() });
        if (state === "transferring" && window.engineProof?.cancelOnTransfer) {
          window.engineProof.cancelOnTransfer = false;
          window.engineProof.transferMessage = message;
          engine.cancel();
        }
      });
      const snapshot = (value) => ({
        ...value,
        result: value.result
          ? {
              columns: value.result.columns,
              count: value.result.count,
              rows: Array.from(
                { length: Math.min(value.result.count, 12) },
                (_, i) => value.result.getRow(i),
              ),
              lastRow: value.result.count
                ? value.result.getRow(value.result.count - 1)
                : null,
            }
          : null,
      });
      window.engineProof = {
        engine,
        states,
        snapshot,
        results,
        diagnostics,
        catalog,
        loaded,
      };
    }),
    "production module import",
  );
  ({ reference, contentIdentity, datasetId } = await page.evaluate(async () => {
    const { catalog, loaded } = window.engineProof;
    return {
      reference: await catalog.assets.text(loaded.definition.reference),
      contentIdentity: loaded.identity,
      datasetId: loaded.dataset.id,
    };
  }));

  await check(
    "initialize restores all eight published table counts",
    async () => {
      const schema = await bounded(
        page.evaluate(() =>
          window.engineProof.engine.configure(
            window.engineProof.catalog,
            window.engineProof.loaded.dataset.id,
          ),
        ),
        "initialize",
        75_000,
      );
      assert.deepEqual(
        Object.fromEntries(schema.map((table) => [table.name, table.count])),
        counts,
      );
      const limits = await page.evaluate(() => ({
        rows: window.engineProof.results.MAX_ROWS,
        bytes: window.engineProof.results.MAX_BYTES,
      }));
      assert.deepEqual(limits, { rows: 100_000, bytes: 32 * 1024 * 1024 });
      const actual = await run(
        Object.keys(counts)
          .map(
            (name) =>
              `SELECT '${name}' AS table_name, count(*)::BIGINT AS n FROM ${name}`,
          )
          .join(" UNION ALL ") + " ORDER BY table_name",
      );
      complete(actual);
      assert.deepEqual(
        Object.fromEntries(
          actual.result.rows.map(([name, n]) => [name, Number(n)]),
        ),
        counts,
      );
      return { schema, limits, actual };
    },
  );

  const parseCases = [
    { name: "reference CTE and window functions", sql: reference, valid: true },
    {
      name: "J001 disconnected comma relations",
      sql: "SELECT count(*) FROM orders o, order_items i",
      valid: true,
      j001: 1,
      j002: 0,
    },
    {
      name: "J001 connected WHERE aliases",
      sql: "SELECT count(*) FROM orders o, order_items i WHERE o.order_id = i.order_id",
      valid: true,
      j001: 0,
      j002: 0,
    },
    {
      name: "J001 connected ON aliases",
      sql: "SELECT count(*) FROM orders o JOIN order_items i ON o.order_id = i.order_id",
      valid: true,
      j001: 0,
    },
    {
      name: "J001 intentional known-table CROSS JOIN",
      sql: "SELECT count(*) FROM orders o CROSS JOIN order_items i",
      valid: true,
      j001: 0,
    },
    {
      name: "intentional generated CROSS JOIN",
      sql: "SELECT count(*) FROM range(2) a CROSS JOIN range(3) b",
      valid: true,
      j001: 0,
    },
    {
      name: "J002 CTE expansion",
      sql: "WITH x AS (SELECT * FROM order_items) SELECT sum(qty) FROM x",
      valid: true,
      j002: 1,
    },
    {
      name: "J002 qualified expansion",
      sql: "SELECT i.* FROM order_items i",
      valid: true,
      j002: 1,
    },
    {
      name: "J002 outer CTE qualified star selects its own token",
      sql: "WITH m AS (\nSELECT o.order_id, o.status\nFROM orders o\n)\nSELECT m.* FROM m LIMIT 5;",
      valid: true,
      j002: 1,
      starAtLast: true,
      selected: "*",
    },
    {
      name: "J002 Unicode qualifier ignores comment wildcard",
      sql: 'SELECT "é😀" /* * */ . * FROM orders AS "é😀"',
      valid: true,
      j002: 1,
      starAtLast: true,
      selected: "*",
    },
    {
      name: "J002 retains independent inner and outer CTE projections",
      sql: "WITH m AS (SELECT * FROM orders) SELECT m.* FROM m",
      valid: true,
      j002: 2,
      selected: "*",
    },
    {
      name: "J002 COUNT wildcard is not expansion",
      sql: "SELECT count(*) FROM order_items",
      valid: true,
      j002: 0,
    },
    {
      name: "J002 multiplication is not expansion",
      sql: "SELECT qty * unit_price FROM order_items",
      valid: true,
      j002: 0,
    },
    {
      name: "Unicode source ranges ignore commented wildcard",
      sql: "/* café 雪 😀 * */ SELECT * FROM orders",
      valid: true,
      j002: 1,
      selected: "*",
    },
    {
      name: "Unicode relationship source range",
      sql: "/* café 雪 😀 */ SELECT count(*) FROM orders o, order_items i",
      valid: true,
      j001: 1,
      selected: "order_items",
    },
    { name: "malformed SELECT", sql: "SELECT FROM WHERE", valid: false },
    {
      name: "malformed Unicode query",
      sql: "SELECT '雪😀' AS label, )",
      valid: false,
      selected: ")",
    },
    {
      name: "OR relationship remains unsupported, not speculative",
      sql: "SELECT count(*) FROM orders o, order_items i WHERE o.order_id = i.order_id OR o.order_id = 1",
      valid: true,
      j001: 0,
    },
  ];
  for (const test of parseCases)
    await check(`parser: ${test.name}`, async () => {
      const rev = ++revision;
      const parsed = await bounded(
        page.evaluate(
          ({ sql, rev }) => window.engineProof.engine.parse(sql, rev),
          { sql: test.sql, rev },
        ),
        test.name,
        15_000,
      );
      assert.equal(parsed.valid, test.valid, JSON.stringify(parsed));
      assert.equal(parsed.revision, rev);
      for (const diagnostic of parsed.diagnostics) {
        assert.equal(diagnostic.revision, rev);
        assert.ok(
          Number.isInteger(diagnostic.from) && Number.isInteger(diagnostic.to),
        );
        assert.ok(
          diagnostic.from >= 0 &&
            diagnostic.to >= diagnostic.from &&
            diagnostic.to <= test.sql.length,
        );
      }
      for (const [key, rule] of [
        ["j001", "J001"],
        ["j002", "J002"],
      ]) {
        if (test[key] !== undefined)
          assert.equal(
            parsed.diagnostics.filter((d) => d.ruleId === rule).length,
            test[key],
            JSON.stringify(parsed),
          );
      }
      if (!test.valid) {
        assert.ok(
          parsed.diagnostics.some(
            (d) => d.ruleId === "SQL" && d.severity === "error",
          ),
        );
        expectedErrors.push({
          name: test.name,
          diagnostics: parsed.diagnostics,
        });
      }
      if (test.starAtLast) {
        const diagnostic = parsed.diagnostics.find((d) => d.ruleId === "J002");
        assert.equal(diagnostic.from, test.sql.lastIndexOf("*"));
        assert.equal(diagnostic.to, diagnostic.from + 1);
      }
      if (test.selected)
        assert.ok(
          parsed.diagnostics.some(
            (d) => test.sql.slice(d.from, d.to) === test.selected,
          ),
          `Expected exact UTF-16 token ${test.selected}: ${JSON.stringify(parsed)}`,
        );
      return { sql: test.sql, ...parsed };
    });

  await check(
    "exact Arrow grid preserves BIGINT, negative DECIMAL and NULL",
    async () => {
      const value = await run(
        "SELECT 9007199254740993::BIGINT AS exact_integer, '-12345678901234567890.12'::DECIMAL(38,2) AS negative_decimal, NULL::VARCHAR AS missing",
      );
      complete(value);
      assert.equal(value.correctness, "not-evaluated");
      assert.deepEqual(value.result.rows, [
        ["9007199254740993", "-12345678901234567890.12", null],
      ]);
      assert.deepEqual(
        value.result.columns.map((c) => c.type),
        ["BIGINT", "DECIMAL(38,2)", "VARCHAR"],
      );
      return value;
    },
  );
  await check(
    "temporal values keep their engine precision and per-row interval components",
    async () => {
      const value = await run(
        `SELECT TIMESTAMP '2026-09-13 08:30:00' AS ts, TIMESTAMPTZ '2026-09-13 08:30:00+00' AS tstz, TIME '08:30:00' AS tm, DATE '2026-09-13' AS day, INTERVAL 3 DAY AS iv, INTERVAL '1 month 2 days 03:00:04.5' AS mixed, TIMESTAMP '2024-03-01 12:34:56.123456' AS micro FROM range(5)`,
      );
      complete(value);
      assert.deepEqual(
        value.result.columns.map((c) => c.type),
        [
          "TIMESTAMP",
          "TIMESTAMP WITH TIME ZONE",
          "TIME",
          "DATE",
          "INTERVAL",
          "INTERVAL",
          "TIMESTAMP",
        ],
      );
      const expected = [
        "2026-09-13 08:30:00",
        "2026-09-13 08:30:00+00:00",
        "08:30:00",
        "2026-09-13",
        "3 days",
        "1 month 2 days 03:00:04.5",
        "2024-03-01 12:34:56.123456",
      ];
      assert.equal(value.result.count, 5);
      for (const row of value.result.rows) assert.deepEqual(row, expected);
      assert.deepEqual(value.result.lastRow, expected);
      return value;
    },
  );
  await check(
    "timestamp infinities and out-of-Date-range instants decode without raw integers",
    async () => {
      const value = await run(
        "SELECT 'infinity'::TIMESTAMP AS hi, '-infinity'::TIMESTAMP AS lo, 'infinity'::DATE AS hiday, TIMESTAMP '9999-12-31 23:59:59.999999' AS far",
      );
      complete(value);
      assert.deepEqual(value.result.rows, [
        ["infinity", "-infinity", "infinity", "9999-12-31 23:59:59.999999"],
      ]);
      return value;
    },
  );
  // A policy rejection must not hide a syntax error, and a parser that accepts
  // a write statement must not grant it admission.
  const admission = [
    [
      "a mistyped statement reports its parser error",
      "SELCT * FRM customers WHERE;",
      /syntax error/i,
    ],
    [
      "a read query with an invalid trailing clause reports its parser error",
      "SELECT customer_id FROM customers WHERE",
      /syntax error/i,
    ],
    [
      "DELETE retains the read-only rejection",
      "DELETE FROM customers;",
      /read-only.*index lab/is,
    ],
    [
      "CREATE TABLE retains the read-only rejection",
      "CREATE TABLE audit_probe(x INT);",
      /read-only.*index lab/is,
    ],
    [
      "two statements retain the distinct one-statement rejection",
      "SELECT 1; SELECT 2;",
      /one statement at a time/i,
    ],
    ["empty input remains distinct", "   \n  ", /Enter one SQL statement/i],
    [
      "an unfinished string reports a lexical error",
      "SELECT 'unfinished",
      /string|quote/i,
    ],
  ];
  for (const [name, sql, pattern] of admission)
    await check(`admission: ${name}`, async () => {
      const value = await run(sql);
      nonpass(value, "engine-error", `admission: ${name}`);
      assert.match(value.message, pattern);
      return value;
    });
  await check(
    "rejected input leaves every learning table unchanged",
    async () => {
      const value = await run(
        Object.keys(counts)
          .map(
            (name) =>
              `SELECT '${name}' AS table_name, count(*)::BIGINT AS n FROM ${name}`,
          )
          .join(" UNION ALL ") + " ORDER BY table_name",
      );
      complete(value);
      assert.deepEqual(
        Object.fromEntries(
          value.result.rows.map(([name, n]) => [name, Number(n)]),
        ),
        counts,
      );
      return value;
    },
  );
  await check(
    "cancelling rejected input returns cancellation, not completion",
    async () => {
      const outcome = await page.evaluate(async (req) => {
        const pending = window.engineProof.engine.run(req);
        window.engineProof.engine.cancel();
        return window.engineProof.snapshot(await pending);
      }, request("CREATE TABLE cancelled_probe(x INT)"));
      assert.equal(outcome.outcome, "cancelled", outcome.message);
      assert.equal(outcome.result, null);
      expectedErrors.push({
        name: "cancel during rejected-input parsing",
        outcome: outcome.outcome,
        message: outcome.message,
      });
      return { outcome, recovered: await recovery() };
    },
  );
  await check(
    "INJECTED parser unavailability retains the read-only rejection",
    async () => {
      // A policy rejection asks the parser whether the SQL is even valid. If
      // that worker cannot start, the rejection must stand rather than being
      // replaced by a worker error.
      const outcome = await page.evaluate(async (req) => {
        const RealWorker = window.Worker;
        let broken = 1;
        window.Worker = class extends RealWorker {
          constructor(...args) {
            if (broken-- > 0)
              throw new Error("INJECTED parser worker spawn failure");
            super(...args);
          }
        };
        try {
          return window.engineProof.snapshot(
            await window.engineProof.engine.run(req),
          );
        } finally {
          window.Worker = RealWorker;
        }
      }, request("DELETE FROM customers"));
      assert.equal(outcome.outcome, "engine-error", outcome.message);
      assert.match(outcome.message, /read-only.*index lab/is);
      assert.doesNotMatch(outcome.message, /INJECTED/);
      expectedErrors.push({
        name: "INJECTED parser spawn failure during a policy rejection",
        outcome: outcome.outcome,
        message: outcome.message,
      });
      return { outcome, recovered: await recovery() };
    },
    true,
  );
  await check("zero rows retain exact schema", async () => {
    const value = await run(
      "SELECT 42::BIGINT AS answer, NULL::DECIMAL(18,2) AS amount WHERE false",
    );
    complete(value);
    assert.equal(value.result.count, 0);
    assert.deepEqual(value.result.rows, []);
    assert.deepEqual(
      value.result.columns.map(({ name, type }) => ({ name, type })),
      [
        { name: "answer", type: "BIGINT" },
        { name: "amount", type: "DECIMAL(18,2)" },
      ],
    );
    return value;
  });
  await check(
    "Valid PIVOT executes despite unsupported serialized AST",
    async () => {
      const value = await run(
        "PIVOT (SELECT 'a' AS k, 42 AS v) ON k USING sum(v)",
      );
      complete(value);
      assert.deepEqual(value.result.rows, [["42"]]);
      return value;
    },
  );
  await check(
    "reference submission passes both complete datasets",
    async () => {
      const value = await run(reference, "submit");
      complete(value);
      assert.equal(value.correctness, "correct");
      assert.equal(value.fixtureResults.length, 2);
      assert.deepEqual(
        value.fixtureResults.map((f) => f.pass),
        [true, true],
      );
      assert.deepEqual(
        value.fixtureResults.map((f) => [f.expectedRows, f.actualRows]),
        [
          [9, 9],
          [36, 36],
        ],
      );
      assert.equal(
        value.elapsedMs,
        value.fixtureResults.reduce((sum, f) => sum + f.elapsedMs, 0),
      );
      return value;
    },
  );
  const projection =
    "SELECT mon, category_id, c_name, revenue, rnk\nFROM ranked";
  assert.ok(
    reference.includes(projection),
    "Published reference final projection changed; update adverse SQL explicitly",
  );
  const adverse = [
    [
      "wrong integer output type",
      reference.replace(
        projection,
        "SELECT mon, category_id::INTEGER AS category_id, c_name, revenue, rnk\nFROM ranked",
      ),
    ],
    [
      "dense rank changes tie multiplicities",
      reference.replace(/\brank\(\)/i, "dense_rank()"),
    ],
    [
      "value-losing integer cast restored to declared decimal",
      reference.replace(
        projection,
        "SELECT mon, category_id, c_name, CAST(CAST(revenue AS BIGINT) AS DECIMAL(38,2)) AS revenue, rnk\nFROM ranked",
      ),
    ],
  ];
  for (const [name, sql] of adverse)
    await check(`submission rejects ${name}`, async () => {
      assert.notEqual(sql, reference);
      const value = await run(sql, "submit");
      complete(value);
      assert.equal(value.correctness, "incorrect");
      assert.equal(value.fixtureResults.length, 2);
      assert.equal(
        value.fixtureResults[0].pass,
        false,
        "Boundary fixture must reject this adverse answer",
      );
      expectedErrors.push({
        name,
        outcome: "incorrect",
        fixtures: value.fixtureResults,
      });
      return { sql, ...value };
    });

  await check(
    "single active operation, independent parser, compute cancellation and recovery",
    async () => {
      await beginLong();
      const competing = await run("SELECT 99::BIGINT AS competing", "submit");
      nonpass(competing, "engine-error", "serialized overlapping Submit");
      assert.match(competing.message, /another operation.*active/i);
      const parseStart = performance.now();
      const rev = ++revision;
      const parsed = await bounded(
        page.evaluate(
          (rev) =>
            window.engineProof.engine.parse(
              "SELECT qty * unit_price FROM order_items",
              rev,
            ),
          rev,
        ),
        "independent parser while computing",
        5_000,
      );
      const parserWallMs = performance.now() - parseStart;
      assert.equal(parsed.valid, true);
      assert.equal(parsed.revision, rev);
      assert.equal(
        await page.evaluate(() => window.engineProof.longSettled),
        false,
        "Parser must finish while execution remains active",
      );
      const cancelledAt = performance.now();
      await page.evaluate(() => window.engineProof.engine.cancel());
      const cancelled = await finishLong();
      const cancellationWallMs = performance.now() - cancelledAt;
      nonpass(cancelled, "cancelled", "cancel long computation");
      assert.ok(
        cancellationWallMs < 5_000,
        `Cancellation took ${cancellationWallMs} ms`,
      );
      return {
        competing,
        parsed,
        parserWallMs,
        cancelled,
        cancellationWallMs,
        recovered: await recovery(),
      };
    },
  );
  await check(
    "cancellation after a real Arrow batch retains no partial result and recovers",
    async () => {
      await page.evaluate(() => {
        window.engineProof.cancelOnTransfer = true;
      });
      const value = await run("SELECT i::BIGINT AS i FROM range(100000) t(i)");
      nonpass(value, "cancelled", "cancel during result transfer");
      const message = await page.evaluate(
        () => window.engineProof.transferMessage,
      );
      const received = Number(
        message.match(/([\d,]+) rows/)[1].replaceAll(",", ""),
      );
      assert.ok(received > 0 && received < 100000);
      return {
        receivedBeforeCancellation: received,
        value,
        recovered: await recovery(),
      };
    },
  );
  await check(
    "100000 rows complete; 100001 rows stop without truncation; recovery",
    async () => {
      const boundary = await run(
        "SELECT i::BIGINT AS i FROM range(100000) t(i)",
      );
      complete(boundary);
      assert.equal(boundary.result.count, 100_000);
      assert.deepEqual(boundary.result.rows[0], ["0"]);
      assert.deepEqual(boundary.result.lastRow, ["99999"]);
      const exceeded = await run(
        "SELECT i::BIGINT AS i FROM range(100001) t(i)",
      );
      nonpass(exceeded, "result-limit", "100001-row result cap");
      return { boundary, exceeded, recovered: await recovery() };
    },
  );
  await check(
    "32 MiB retained-byte cap rejects wide output below the row cap and recovers",
    async () => {
      const value = await run(
        "SELECT repeat('x',1024)||i::VARCHAR AS payload FROM range(40000) t(i)",
      );
      nonpass(value, "result-limit", "wide result byte cap");
      return { requestedRows: 40000, value, recovered: await recovery() };
    },
  );
  await check("published 10-second SQL timeout and recovery", async () => {
    await beginLong();
    const value = await finishLong();
    nonpass(value, "timeout", "10-second SQL deadline");
    assert.match(value.message, /SQL.*10-second/i);
    assert.ok(
      value.elapsedMs >= 9_900 && value.elapsedMs < 15_000,
      `SQL-only elapsed time ${value.elapsedMs} ms`,
    );
    return { sql: longSql, value, recovered: await recovery() };
  });
  await check(
    "real allocation failure at published 512MB limit and recovery",
    async () => {
      const limit = await run(
        "SELECT current_setting('memory_limit') AS memory_limit",
      );
      complete(limit);
      const configured = /^([\d.]+)\s*(B|kB|KB|MB|GB|KiB|MiB|GiB)$/.exec(
        limit.result.rows[0][0],
      );
      assert.ok(configured, "Memory limit must be an observed byte quantity");
      const units = {
        B: 1,
        kB: 1000,
        KB: 1000,
        MB: 1e6,
        GB: 1e9,
        KiB: 1024,
        MiB: 1024 ** 2,
        GiB: 1024 ** 3,
      };
      const configuredBytes = Number(configured[1]) * units[configured[2]];
      assert.ok(
        Math.abs(configuredBytes - 512_000_000) < 200_000,
        `Expected published 512 MB, received ${limit.result.rows[0][0]}`,
      );
      // The aggregate must retain distinct groups and >1 GiB of string payload.
      // No lowered memory setting, fake exception, or external data source is involved.
      const sql =
        "SELECT sum(length(payload[1])) AS retained_bytes FROM (SELECT i, list(repeat('x', 8192)) AS payload FROM range(150000) AS t(i) GROUP BY i)";
      const value = await run(sql);
      nonpass(value, "engine-error", "actual 512MB allocation failure");
      assert.match(
        value.message,
        /out of memory|failed to allocate|allocation failed|memory[^\n]*(?:exhaust|limit)|cannot enlarge memory/i,
        "OOM proof requires an allocation error, not a timeout or output cap",
      );
      return {
        injected: false,
        configuredLimit: limit.result,
        sql,
        value,
        recovered: await recovery(),
      };
    },
  );

  await check(
    "INJECTED fatal execution-worker event settles pending run and recovers",
    async () => {
      await beginLong();
      const injection = await page.evaluate(() => {
        const p = window.engineProof;
        // Explicit fault injection: TypeScript private fields are accessed only here
        // and in the poisoned-candidate check below, never for ordinary assertions.
        const slots = [...p.engine.active.slots].filter(
          (slot) => slot !== p.engine.parser && !slot.dead && slot.conn,
        );
        if (slots.length !== 1)
          throw new Error(
            `Expected one active execution slot, found ${slots.length}`,
          );
        const slot = slots[0];
        slot.worker.dispatchEvent(
          new ErrorEvent("error", {
            message: "Injected fatal execution worker failure",
          }),
        );
        return {
          method: "ErrorEvent dispatched on actual active slot.worker",
          deadAfterEvent: slot.dead,
        };
      });
      const value = await finishLong();
      nonpass(value, "engine-error", "INJECTED worker fatal");
      assert.match(value.message, /Injected fatal execution worker failure/);
      assert.equal(injection.deadAfterEvent, true);
      return { injection, value, recovered: await recovery() };
    },
    true,
  );

  await check(
    "INJECTED candidate bypass poisons actual data, fails grading, next snapshot restores",
    async () => {
      const marker = "-- engine-smoke-injected-candidate";
      const sql = `${marker}\n${reference}`;
      await page.evaluate((marker) => {
        const p = window.engineProof;
        p.poisonEvents = [];
        p.originalQuery = p.engine.query;
        p.engine.query = async function (work, slot, sql, visible) {
          if (sql.startsWith(marker)) {
            if (
              !this.active ||
              this.active !== work ||
              !work.slots.has(slot) ||
              slot === this.parser ||
              !slot.conn ||
              slot.dead
            )
              throw new Error(
                "Injection did not reach a live candidate execution slot",
              );
            const before = await work.wait(
              slot.conn.query(
                "SELECT count(*) AS n FROM orders WHERE status='paid'",
              ),
              slot,
            );
            await work.wait(
              slot.conn.query("UPDATE orders SET status='cancelled'"),
              slot,
            );
            const after = await work.wait(
              slot.conn.query(
                "SELECT count(*) AS n FROM orders WHERE status='paid'",
              ),
              slot,
            );
            p.poisonEvents.push({
              beforePaid: String(before.getChildAt(0).get(0)),
              afterPaid: String(after.getChildAt(0).get(0)),
              method: "actual slot.conn UPDATE bypasses public admission",
            });
          }
          return p.originalQuery.call(this, work, slot, sql, visible);
        };
      }, marker);
      let poisoned;
      try {
        poisoned = await run(sql, "submit");
      } finally {
        await page.evaluate(() => {
          const p = window.engineProof;
          p.engine.query = p.originalQuery;
          delete p.originalQuery;
        });
      }
      const injections = await page.evaluate(
        () => window.engineProof.poisonEvents,
      );
      assert.equal(
        injections.length,
        2,
        "Both candidate snapshots must actually be poisoned",
      );
      for (const event of injections) {
        assert.ok(BigInt(event.beforePaid) > 0n);
        assert.equal(event.afterPaid, "0");
      }
      complete(poisoned);
      assert.equal(poisoned.correctness, "incorrect");
      assert.deepEqual(
        poisoned.fixtureResults.map((f) => f.pass),
        [false, false],
      );
      assert.equal(poisoned.result.count, 0);
      const restored = await run(reference, "submit");
      complete(restored);
      assert.equal(restored.correctness, "correct");
      assert.deepEqual(
        restored.fixtureResults.map((f) => f.pass),
        [true, true],
      );
      expectedErrors.push({
        name: "INJECTED poisoned candidate",
        outcome: "incorrect",
        fixtures: poisoned.fixtureResults,
      });
      return { injections, poisoned, restored };
    },
    true,
  );

  await check(
    "actual vs-reference comparison measures nine alternating isolated pairs",
    async () => {
      const value = await run(reference, "compare", 600_000);
      complete(value);
      assert.equal(value.correctness, "correct");
      assert.deepEqual(
        value.fixtureResults.map((f) => f.pass),
        [true, true],
      );
      assert.equal(value.comparison.pairs, 9);
      for (const name of ["referenceMs", "candidateMs", "ratio"])
        assert.ok(
          Number.isFinite(value.comparison[name]) && value.comparison[name] > 0,
          `${name}: ${value.comparison[name]}`,
        );
      for (const name of ["referenceMad", "candidateMad"])
        assert.ok(
          Number.isFinite(value.comparison[name]) &&
            value.comparison[name] >= 0,
          `${name}: ${value.comparison[name]}`,
        );
      // The comparison now reports summarized scans instead of a raw profile
      // dump, so assert the measured content a learner actually reads.
      for (const name of ["referenceScans", "candidateScans"]) {
        const scans = value.comparison[name];
        assert.ok(
          Array.isArray(scans) && scans.length,
          `${name} must contain actual measured scan operators`,
        );
        assert.ok(
          scans.some(
            (scan) =>
              typeof scan.operator === "string" &&
              scan.operator &&
              Number.isSafeInteger(scan.rowsScanned) &&
              scan.rowsScanned > 0,
          ),
          `${name} must report measured scanned rows: ${JSON.stringify(scans)}`,
        );
        assert.ok(
          scans.every((scan) =>
            ["index", "sequential", "not-reported"].includes(scan.accessPath),
          ),
          `${name} must report a known access path`,
        );
      }
      return value; // Report measured values unchanged; no speed threshold or invented samples.
    },
  );
  await check(
    "document and dataset switch cannot change dispatched identity",
    async () => {
      const captured = await page.evaluate(async (req) => {
        const p = window.engineProof;
        const pending = p.engine.run(req);
        req.challenge.bundleVersion = "mutated-after-dispatch";
        req.documentId = "other-document";
        const other = await p.catalog.load("sets.01");
        await p.engine.configure(p.catalog, other.dataset.id);
        const outcome = p.snapshot(await pending);
        await p.engine.configure(p.catalog, p.loaded.dataset.id);
        return outcome;
      }, request("SELECT 42::BIGINT AS answer"));
      complete(captured);
      assert.deepEqual(captured.challenge, contentIdentity);
      assert.equal(captured.documentId, "engine-smoke-document");
      assert.equal(captured.datasetId, datasetId);
      return captured;
    },
  );
  await check(
    "corrupted selected definition is a persistent content load failure",
    async () => {
      const path = await page.evaluate(
        () =>
          window.engineProof.catalog.curriculum.skills.find(
            (s) => s.id === "basics",
          ).definitions[0].path,
      );
      await context.route(`${origin}${path}`, (route) =>
        route.fulfill({
          contentType: "application/json",
          body: '{"challengeId":"corrupted"}',
        }),
      );
      try {
        const message = await page.evaluate(async () => {
          const { ChallengeCatalog } = await import("/src/lib/challenges.ts");
          try {
            await (await ChallengeCatalog.load()).load("basics.01");
            return null;
          } catch (error) {
            return String(error);
          }
        });
        assert.match(message, /Integrity check failed/);
        return { message };
      } finally {
        await context.unroute(`${origin}${path}`);
      }
    },
  );
  await check(
    "same-origin modules and assets ran without external runtime access",
    async () => {
      assert.deepEqual(
        blockedRequests,
        [],
        "The engine tried to request an external runtime dependency",
      );
      const unexpectedPageErrors = browserErrors.filter(
        (event) => event.kind === "pageerror",
      );
      assert.deepEqual(unexpectedPageErrors, []);
      return { blockedRequests, pageErrors: unexpectedPageErrors };
    },
  );
} catch (error) {
  errors.push({
    check: currentCheck,
    message: String(error),
    stack: error?.stack,
  });
  console.error("FAIL", currentCheck ?? "engine smoke setup", error);
  process.exitCode = 1;
} finally {
  let states = [];
  if (page && !page.isClosed()) {
    try {
      states = await bounded(
        page.evaluate(() => {
          const p = window.engineProof;
          if (!p) return [];
          p.engine.dispose();
          return p.states;
        }),
        "coordinator disposal",
        5_000,
      );
    } catch (error) {
      errors.push({ check: "cleanup", message: String(error) });
      process.exitCode = 1;
    }
  }
  if (context)
    await context.close().catch((error) => {
      errors.push({ check: "context close", message: String(error) });
      process.exitCode = 1;
    });
  if (browser)
    await browser.close().catch((error) => {
      errors.push({ check: "browser close", message: String(error) });
      process.exitCode = 1;
    });
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        origin,
        browser: browser?.version(),
        pass: errors.length === 0,
        checks,
        expectedErrors,
        errors,
        browserErrors,
        blockedRequests,
        states,
      },
      null,
      2,
    ) + "\n",
  );
}
