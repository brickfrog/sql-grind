import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

/**
 * A challenge declares its output contract by hand: column names, order, SQL
 * types and, for DECIMAL, precision and scale. The grader only ever compares
 * scale (engine-results.ts matchesType), so a false precision is invisible to
 * grading and still shown to the learner as the type they must produce. This
 * suite is the check that closes that gap: every challenge's own reference is
 * executed against its own dataset in the real engine, and the fields DuckDB
 * actually returns are compared against the declaration, precision included.
 * The published expectation files carry the same column block, so they are
 * compared too: a declaration fixed in one file and not the other is the exact
 * drift this catches.
 *
 * Challenge paths are resolved through curriculum.json the way the application
 * resolves them, never by globbing readiness/challenges: window.03 is published
 * from readiness/challenge-07.json and directory globbing would silently skip
 * it.
 */
const appUrl = new URL(process.env.APP_URL ?? "http://127.0.0.1:5176");
const origin = appUrl.origin;
const evidencePath = "readiness/evidence/application/shape-smoke.json";
const checks = [];
const errors = [];
const browserErrors = [];
const blockedRequests = [];
let browser, context, page, currentCheck;
const startedAt = new Date().toISOString();

async function bounded(promise, name, timeout = 120_000) {
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
async function check(name, operation) {
  currentCheck = name;
  const start = performance.now();
  try {
    const details = await operation();
    checks.push({
      name,
      outcome: "pass",
      wallMs: performance.now() - start,
      details,
    });
    console.log("PASS", name);
    return details;
  } catch (error) {
    checks.push({
      name,
      outcome: "fail",
      wallMs: performance.now() - start,
      error: String(error),
    });
    console.log("FAIL", name);
    throw error;
  } finally {
    currentCheck = undefined;
  }
}
/** The declaration as the engine would have to report it, for diffing. */
function declared(column) {
  return column.type === "DECIMAL"
    ? {
        name: column.name,
        type: `DECIMAL(${column.precision},${column.scale})`,
        precision: column.precision,
        scale: column.scale,
      }
    : { name: column.name, type: column.type };
}
/** One engine field reduced to the same shape. */
function observed(field) {
  return field.type.startsWith("DECIMAL(")
    ? {
        name: field.name,
        type: field.type,
        precision: field.precision,
        scale: field.scale,
      }
    : { name: field.name, type: field.type };
}
/** Runs one challenge's reference through the production coordinator. */
function execute(entry) {
  return bounded(
    page.evaluate(async (entry) => {
      const proof = window.shapeProof;
      await proof.engine.configure(proof.catalog, entry.datasetId);
      const value = await proof.engine.run({
        id: `shape-smoke-${++proof.revision}`,
        documentId: `shape:${entry.challengeId}`,
        revision: proof.revision,
        sql: entry.sql,
        kind: "execute",
        domain: "challenge",
        hintLevel: 0,
        challenge: null,
        datasetId: entry.datasetId,
      });
      return {
        outcome: value.outcome,
        message: value.message,
        rows: value.result?.count ?? null,
        complete: value.result ? value.result.count >= 0 : false,
        fields:
          value.result?.columns.map((column) => ({
            name: column.name,
            type: column.type,
            precision: column.precision ?? null,
            scale: column.scale ?? null,
          })) ?? null,
      };
    }, entry),
    `${entry.challengeId} reference`,
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
    // No application UI mounts here: only the exported production coordinator
    // owns workers, so 65 references run without the workbench competing.
    if (url.pathname === "/__shape_smoke__")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Contract shape smoke</title>",
      });
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(60_000);
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
  await page.goto(new URL("/__shape_smoke__", origin).href);
  await bounded(
    page.evaluate(async () => {
      const { EngineCoordinator } = await import("/src/lib/engine.ts");
      const { ChallengeCatalog } = await import("/src/lib/challenges.ts");
      window.shapeProof = {
        engine: new EngineCoordinator(() => {}),
        catalog: await ChallengeCatalog.load(),
        revision: 0,
      };
    }),
    "production module import",
  );

  const resolved = await bounded(
    page.evaluate(async () => {
      const { catalog } = window.shapeProof;
      const out = [];
      for (const skill of catalog.curriculum.skills)
        for (const definition of skill.definitions) {
          const loaded = await catalog.load(definition.challengeId);
          const expected = [];
          for (const [variantId, path] of Object.entries(
            loaded.definition.expected,
          ))
            expected.push({
              variantId,
              path,
              columns: (await catalog.assets.json(path)).columns,
            });
          out.push({
            challengeId: definition.challengeId,
            skillId: skill.id,
            path: definition.path,
            datasetId: loaded.dataset.id,
            columns: structuredClone(loaded.definition.output.columns),
            sql: await catalog.assets.text(loaded.definition.reference),
            expected,
          });
        }
      return out;
    }),
    "curriculum resolution",
  );
  await check(
    "every curriculum challenge resolves to a published definition",
    () => {
      const entries = resolved;
      assert.ok(entries.length >= 60, "the curriculum publishes 60+ exercises");
      const ids = entries.map((entry) => entry.challengeId);
      assert.equal(new Set(ids).size, ids.length, "challenge ids are unique");
      for (const entry of entries) {
        assert.ok(entry.sql.trim(), `${entry.challengeId} has a reference`);
        assert.ok(
          entry.columns.length,
          `${entry.challengeId} declares columns`,
        );
        assert.ok(
          entry.expected.length,
          `${entry.challengeId} publishes an expectation`,
        );
      }
      return {
        challenges: ids,
        datasets: [...new Set(entries.map((entry) => entry.datasetId))],
        // Recorded because a challenge outside the directory convention is
        // invisible to path globbing and must stay visible to review.
        offConvention: entries
          .filter(
            (entry) =>
              entry.path !==
              `/bundle/challenges/${entry.challengeId}/challenge.json`,
          )
          .map((entry) => ({
            challengeId: entry.challengeId,
            path: entry.path,
          })),
      };
    },
  );

  const decimals = [];
  // Datasets are grouped so the engine reopens once per dataset instead of
  // once per challenge; configure() is a no-op while the selection holds.
  const byDataset = new Map();
  for (const entry of resolved) {
    if (!byDataset.has(entry.datasetId)) byDataset.set(entry.datasetId, []);
    byDataset.get(entry.datasetId).push(entry);
  }

  // Each challenge is checked to completion instead of aborting the suite:
  // a wrong declaration is a content defect, and a content pass has to report
  // every one of them in a single run, not the alphabetically first.
  const mismatched = [];
  for (const [datasetId, group] of byDataset)
    for (const entry of group)
      try {
        await check(
          `${entry.challengeId} declares the shape its reference returns in ${datasetId}`,
          async () => {
            const value = await execute(entry);
            assert.equal(
              value.outcome,
              "complete",
              `${entry.challengeId}: ${value.message}`,
            );
            const wanted = entry.columns.map(declared);
            const found = value.fields.map(observed);
            assert.deepEqual(
              found,
              wanted,
              `${entry.challengeId} declares a shape the engine does not return`,
            );
            for (const expectation of entry.expected)
              assert.deepEqual(
                expectation.columns.map(declared),
                wanted,
                `${entry.challengeId} expectation ${expectation.variantId} declares a different shape than challenge.json`,
              );
            for (const column of entry.columns)
              if (column.type === "DECIMAL")
                decimals.push({
                  challengeId: entry.challengeId,
                  column: column.name,
                  precision: column.precision,
                  scale: column.scale,
                });
            return {
              datasetId,
              rows: value.rows,
              columns: found,
              expectations: entry.expected.map(
                (expectation) => expectation.variantId,
              ),
            };
          },
        );
      } catch (error) {
        mismatched.push({
          challengeId: entry.challengeId,
          error: String(error),
        });
        console.error(String(error));
      }

  await check("every published output contract matches engine truth", () => {
    assert.ok(
      !mismatched.length,
      `${mismatched.length} challenge(s) declare a shape the engine does not return: ${mismatched.map((entry) => entry.challengeId).join(", ")}`,
    );
    return { verified: resolved.length, decimalColumns: decimals.length };
  });

  await check("no page error was logged while executing references", () => {
    const fatal = browserErrors.filter((event) => event.kind === "pageerror");
    assert.deepEqual(fatal, []);
    assert.deepEqual(
      blockedRequests,
      [],
      "a reference run requested an external dependency",
    );
    return { decimalColumns: decimals };
  });
} catch (error) {
  errors.push({
    check: currentCheck,
    message: String(error),
    stack: error?.stack,
  });
  console.error("FAIL", currentCheck ?? "shape smoke setup", error);
} finally {
  if (page && !page.isClosed())
    await page
      .evaluate(() => window.shapeProof?.engine.dispose())
      .catch((error) =>
        errors.push({ check: "cleanup", message: String(error) }),
      );
  await context?.close();
  await browser?.close();
  const status =
    errors.length === 0 && checks.every((entry) => entry.outcome === "pass")
      ? "passed"
      : "failed";
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        suite: "shape-smoke",
        appURL: appUrl.href,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        checks,
        errors,
        browserErrors,
        blockedRequests,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { status, checks: checks.length, evidence: evidencePath },
      null,
      2,
    ),
  );
  if (status !== "passed") process.exitCode = 1;
}
