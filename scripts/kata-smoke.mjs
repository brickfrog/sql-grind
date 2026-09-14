import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Katas carry no published expectation, so nothing in the content pipeline can
 * catch a mis-authored drill. This suite is that check: every variation's
 * reference is executed in its own dataset variant and compared against its own
 * authored contract, which is the only thing standing between a broken kata and
 * telling a learner their correct answer is wrong. It then drives the real
 * drill surface, and proves the check can fail.
 */
const appUrl = new URL(process.env.APP_URL ?? "http://127.0.0.1:5176");
const origin = appUrl.origin;
const evidencePath = "readiness/evidence/application/kata-smoke.json";
const checks = [];
let browser, context, page, currentCheck;
const startedAt = new Date().toISOString();

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
/** Runs one kata request through the production coordinator. */
async function drill(pattern, variation, sql) {
  return page.evaluate(
    async ([patternId, variationId, sqlText]) => {
      const proof = window.kataProof;
      const pattern = proof.patterns.find((p) => p.patternId === patternId);
      const variation = pattern.variations.find(
        (v) => v.variationId === variationId,
      );
      await proof.engine.configure(proof.catalog, pattern.datasetId);
      const value = await proof.engine.run({
        id: crypto.randomUUID(),
        documentId: `kata:${patternId}/${variationId}`,
        revision: 0,
        sql: sqlText,
        kind: "kata",
        domain: "challenge",
        hintLevel: 0,
        challenge: null,
        datasetId: pattern.datasetId,
        kata: {
          patternId,
          variationId,
          variantId: variation.variantId,
          reference: variation.reference,
          output: variation.output,
        },
      });
      return {
        outcome: value.outcome,
        correctness: value.correctness,
        message: value.message,
        rows: value.result?.count ?? null,
        columns: value.result?.columns.map((column) => column.name) ?? null,
      };
    },
    [pattern, variation, sql],
  );
}

try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ serviceWorkers: "block" });
  page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const pageErrors = [];
  page.on("pageerror", (error) =>
    pageErrors.push({ message: String(error), check: currentCheck }),
  );
  await page.goto(new URL("/", origin).href);
  await page.waitForSelector("#document-tabs", { timeout: 90_000 });

  // The engine module is imported directly, as engine-smoke does: the drill
  // content and the coordinator are exercised without the UI in the way.
  await page.evaluate(async () => {
    const { EngineCoordinator } = await import("/src/lib/engine.ts");
    const { ChallengeCatalog } = await import("/src/lib/challenges.ts");
    const { kataPatterns } = await import("/src/lib/kata-content.ts");
    const catalog = await ChallengeCatalog.load();
    window.kataProof = {
      engine: new EngineCoordinator(() => {}),
      catalog,
      patterns: structuredClone(kataPatterns),
    };
  });
  const patterns = await page.evaluate(() =>
    window.kataProof.patterns.map((pattern) => ({
      patternId: pattern.patternId,
      skillId: pattern.skillId,
      datasetId: pattern.datasetId,
      variations: pattern.variations.map((variation) => ({
        variationId: variation.variationId,
        variantId: variation.variantId,
        // Held in Node: the page is reloaded before the UI phase, which
        // discards the injected harness.
        reference: variation.reference,
      })),
    })),
  );

  await check("every authored kata pattern validates and is unique", () => {
    assert.ok(patterns.length >= 6, "at least six patterns ship");
    const ids = patterns.map((pattern) => pattern.patternId);
    assert.equal(new Set(ids).size, ids.length);
    const variations = patterns.flatMap((pattern) => pattern.variations.length);
    assert.ok(
      variations.every((count) => count >= 3),
      "every pattern offers at least three variations",
    );
    return { patterns: ids, variations };
  });
  await check(
    "a malformed drill asset is reported, not fatal, and thin patterns are rejected",
    async () => {
      const result = await page.evaluate(async () => {
        const { validateKata } = await import("/src/lib/challenges.ts");
        const { kataContentErrors } = await import("/src/lib/kata-content.ts");
        const reject = (input) => {
          try {
            validateKata(input);
            return null;
          } catch (error) {
            return String(error.message);
          }
        };
        const sound = {
          patternId: "x",
          title: "x",
          skillId: "basics",
          why: "x",
          datasetId: "commerce-practice",
          variations: [],
        };
        const variation = {
          variationId: "a",
          prompt: "p",
          variantId: "seed-20240907",
          reference: "SELECT 1 AS one",
          output: {
            columns: [{ name: "one", type: "BIGINT", nullable: false }],
            ordering: [],
          },
        };
        return {
          // Loading is non-fatal: the application itself must survive a broken
          // drill asset, so the surface reports rejections instead.
          shippedErrors: [...kataContentErrors],
          tooFew: reject({
            ...sound,
            variations: [variation, { ...variation, variationId: "b" }],
          }),
          duplicateVariation: reject({
            ...sound,
            variations: [variation, variation, variation],
          }),
          badContract: reject({
            ...sound,
            variations: [0, 1, 2].map((index) => ({
              ...variation,
              variationId: `v${index}`,
              output: {
                columns: [
                  { name: "one", type: "TIMESTAMPTZ", nullable: false },
                ],
                ordering: [],
              },
            })),
          }),
        };
      });
      assert.deepEqual(
        result.shippedErrors,
        [],
        "every shipped drill asset loads",
      );
      assert.match(result.tooFew, /at least three variations/);
      assert.match(result.duplicateVariation, /Duplicate kata variation/);
      assert.match(result.badContract, /Invalid output type/);
      return result;
    },
  );

  await check(
    "every kata skill id names a real curriculum skill and dataset variant",
    async () => {
      const known = await page.evaluate(async () => {
        const { catalog } = window.kataProof;
        const datasets = {};
        for (const pattern of window.kataProof.patterns) {
          const dataset = await catalog.dataset(pattern.datasetId);
          datasets[pattern.datasetId] = {
            previewVariant: dataset.previewVariant,
            variants: Object.keys(dataset.variants),
          };
        }
        return {
          skills: catalog.curriculum.skills.map((skill) => skill.id),
          datasets,
        };
      });
      for (const pattern of patterns) {
        assert.ok(
          known.skills.includes(pattern.skillId),
          `kata ${pattern.patternId} names unknown skill ${pattern.skillId}`,
        );
        const dataset = known.datasets[pattern.datasetId];
        assert.ok(dataset, `kata ${pattern.patternId} names unknown dataset`);
        for (const variation of pattern.variations)
          assert.ok(
            dataset.variants.includes(variation.variantId),
            `kata ${pattern.patternId}/${variation.variationId} names unknown variant ${variation.variantId}`,
          );
      }
      return known.datasets;
    },
  );

  // The core content check. Running the authored reference as the learner's
  // answer must pass: that proves the reference executes, returns rows, and
  // agrees with its own authored contract on names, types, nullability,
  // duplicates and required ordering.
  for (const pattern of patterns)
    for (const variation of pattern.variations)
      await check(
        `${pattern.patternId}/${variation.variationId}: reference agrees with its own contract`,
        async () => {
          const value = await drill(
            pattern.patternId,
            variation.variationId,
            variation.reference,
          );
          assert.equal(value.outcome, "complete", value.message);
          assert.equal(value.correctness, "correct", value.message);
          assert.ok(
            value.rows > 0,
            "an empty reference would grade every answer as a row-count miss",
          );
          return value;
        },
      );

  await check("a wrong answer is graded incorrect, not accepted", async () => {
    const value = await drill(
      "anti-join",
      "customers-without-orders",
      "SELECT customer_id, customer_name FROM customers ORDER BY customer_id",
    );
    assert.equal(value.outcome, "complete", value.message);
    assert.equal(value.correctness, "incorrect");
    assert.match(value.message, /rows/);
    return value;
  });

  await check(
    "an inner join cannot fake an anti-join, and NOT IN with NULLs is caught",
    async () => {
      const inner = await drill(
        "anti-join",
        "customers-without-orders",
        "SELECT c.customer_id, c.customer_name FROM customers c JOIN orders o ON o.customer_id = c.customer_id ORDER BY c.customer_id",
      );
      assert.equal(inner.correctness, "incorrect");
      const wrongColumns = await drill(
        "anti-join",
        "customers-without-orders",
        "SELECT c.customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id) ORDER BY c.customer_id",
      );
      assert.equal(wrongColumns.correctness, "incorrect");
      assert.match(wrongColumns.message, /columns/i);
      return { inner: inner.message, wrongColumns: wrongColumns.message };
    },
  );

  await check(
    "required ordering is enforced only where the contract names it",
    async () => {
      // dedupe-by-key orders by customer_id, so reversing it must fail.
      const reversed = await drill(
        "dedupe-by-key",
        "latest-order-per-customer",
        "SELECT customer_id, order_id FROM (SELECT o.customer_id, o.order_id, ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.ordered_at DESC, o.order_id DESC) AS rn FROM orders o) ranked WHERE rn = 1 ORDER BY customer_id DESC",
      );
      assert.equal(reversed.correctness, "incorrect");
      // null-logic/count-star-versus-column names no ordering key and returns
      // a single row, so an unordered answer is still correct.
      const unordered = await drill(
        "null-logic",
        "count-star-versus-column",
        "SELECT count(*)::BIGINT AS total_rows, count(email)::BIGINT AS with_email FROM customers",
      );
      assert.equal(unordered.correctness, "correct", unordered.message);
      return { reversed: reversed.message, unordered: unordered.message };
    },
  );

  await check(
    "both classes of mis-authored contract report a content error, never an incorrect answer",
    async () => {
      // A kata has no published expectation, so these two mistakes are the
      // ones nothing else can catch: a contract naming columns the reference
      // does not return, and a contract claiming an order the reference does
      // not produce. A check that cannot fail proves nothing, so both are
      // falsified deliberately here.
      //
      // The ordering case needs a multi-row reference: row order cannot be
      // violated by a single row, so falsifying it against a one-row drill
      // would assert nothing.
      const value = await page.evaluate(async () => {
        const proof = window.kataProof;
        const pattern = proof.patterns.find((p) => p.patternId === "anti-join");
        await proof.engine.configure(proof.catalog, pattern.datasetId);
        const attempt = async (variationId, output) => {
          const variation = pattern.variations.find(
            (entry) => entry.variationId === variationId,
          );
          const result = await proof.engine.run({
            id: crypto.randomUUID(),
            documentId: "kata:falsified",
            revision: 0,
            sql: variation.reference,
            kind: "kata",
            domain: "challenge",
            hintLevel: 0,
            challenge: null,
            datasetId: pattern.datasetId,
            kata: {
              patternId: "anti-join",
              variationId: variation.variationId,
              variantId: variation.variantId,
              reference: variation.reference,
              output,
            },
          });
          return {
            outcome: result.outcome,
            correctness: result.correctness,
            message: result.message,
            rows: result.result?.count ?? null,
          };
        };
        return {
          // The reference returns customer_name, not a column called total.
          wrongColumns: await attempt("customers-without-orders", {
            columns: [
              { name: "customer_id", type: "BIGINT", nullable: false },
              { name: "total", type: "BIGINT", nullable: false },
            ],
            ordering: [
              { column: "customer_id", direction: "ASC", nulls: "LAST" },
            ],
          }),
          // 545 rows ordered by order_id ascending, so a descending claim is
          // a violation the comparator can actually observe.
          wrongOrdering: await attempt("orders-without-succeeded-payment", {
            columns: [{ name: "order_id", type: "BIGINT", nullable: false }],
            ordering: [
              { column: "order_id", direction: "DESC", nulls: "LAST" },
            ],
          }),
        };
      });
      for (const [label, result] of Object.entries(value)) {
        assert.equal(
          result.outcome,
          "engine-error",
          `${label}: ${result.message}`,
        );
        assert.equal(
          result.correctness,
          "not-evaluated",
          `${label} must not be reported as a wrong answer`,
        );
        assert.match(result.message, /Content error: Kata anti-join/, label);
        assert.match(result.message, /disagrees with its own contract/, label);
      }
      return value;
    },
  );

  await check("a kata target on a non-kata run is refused", async () => {
    const value = await page.evaluate(async () => {
      const proof = window.kataProof;
      const pattern = proof.patterns.find((p) => p.patternId === "anti-join");
      const variation = pattern.variations[0];
      await proof.engine.configure(proof.catalog, pattern.datasetId);
      const result = await proof.engine.run({
        id: crypto.randomUUID(),
        documentId: "kata:misuse",
        revision: 0,
        sql: "SELECT 1 AS one",
        kind: "execute",
        domain: "challenge",
        hintLevel: 0,
        challenge: null,
        datasetId: pattern.datasetId,
        kata: {
          patternId: "anti-join",
          variationId: variation.variationId,
          variantId: variation.variantId,
          reference: variation.reference,
          output: variation.output,
        },
      });
      return { outcome: result.outcome, message: result.message };
    });
    assert.equal(value.outcome, "engine-error");
    assert.match(value.message, /kata target belongs to a kata run/);
    return value;
  });

  // The surface. Everything above bypasses the UI, so the drill loop, its
  // schedule and its persistence are exercised through the real application.
  await check(
    "the desktop icon opens the drill list with a due count",
    async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#document-tabs", { timeout: 90_000 });
      await page
        .locator(".desktop-icon", { hasText: "Katas" })
        .first()
        .click({ clickCount: 2 });
      const dialog = page.locator("dialog");
      await dialog
        .getByText(/repetition drills/i)
        .first()
        .waitFor();
      const due = await dialog
        .getByText(/drills due now/)
        .first()
        .innerText();
      const totalVariations = patterns.reduce(
        (total, pattern) => total + pattern.variations.length,
        0,
      );
      assert.match(
        due,
        new RegExp(
          `${totalVariations} drills due now across ${patterns.length} patterns`,
        ),
        "an unpractised profile has every drill due",
      );
      const articles = await dialog.locator(".library-list article").count();
      assert.equal(articles, patterns.length);
      return { due, articles };
    },
  );

  await check(
    "a passing drill advances the schedule and survives a reload",
    async () => {
      const dialog = page.locator("dialog");
      await dialog
        .locator("article", { hasText: "Anti-join" })
        .getByRole("button", { name: "Start drill" })
        .click();
      const prompt = await dialog.locator(".kata-prompt").innerText();
      assert.match(prompt, /never placed an order/);
      // An unpractised profile always starts with the first unseen variation,
      // which the prompt assertion above pins.
      const reference = patterns
        .find((entry) => entry.patternId === "anti-join")
        .variations.find(
          (entry) => entry.variationId === "customers-without-orders",
        ).reference;
      await dialog.locator(".kata-editor .cm-content").click();
      await page.keyboard.insertText(reference);
      await dialog.getByRole("button", { name: "Check drill" }).click();
      const feedback = dialog.locator(".kata-feedback");
      await feedback.waitFor();
      await page.waitForFunction(
        () =>
          !!document
            .querySelector(".kata-feedback")
            ?.className.includes("kata-pass"),
        null,
        { timeout: 120_000 },
      );
      const message = await feedback.innerText();
      assert.match(message, /matches the authored reference/);
      const stored = await page.evaluate(async () => {
        const { openPracticeStore } = await import("/src/lib/storage.ts");
        const store = await openPracticeStore(
          () => {},
          () => {},
        );
        try {
          return (await store.load()).katas;
        } finally {
          store.close();
        }
      });
      assert.equal(stored.records.length, 1);
      const [record] = stored.records;
      assert.equal(record.patternId, "anti-join");
      assert.equal(record.streak, 1);
      assert.equal(record.attempts, 1);
      assert.equal(record.passes, 1);
      assert.equal(record.lastOutcome, "pass");
      assert.ok(
        record.dueAt - record.lastAt === 86_400_000,
        "a first pass schedules one day out",
      );
      // The schedule is persistent state, not view state.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#document-tabs", { timeout: 90_000 });
      await page
        .locator(".desktop-icon", { hasText: "Katas" })
        .first()
        .click({ clickCount: 2 });
      const after = page.locator("dialog");
      const due = await after
        .getByText(/drills due now/)
        .first()
        .innerText();
      const remaining =
        patterns.reduce((total, entry) => total + entry.variations.length, 0) -
        1;
      assert.match(
        due,
        new RegExp(`${remaining} drills due now`),
        "a passed drill leaves the due count one lower",
      );
      const antiJoin = await after
        .locator("article", { hasText: "Anti-join" })
        .locator(".kata-meta")
        .innerText();
      const antiJoinTotal = patterns.find(
        (entry) => entry.patternId === "anti-join",
      ).variations.length;
      assert.match(
        antiJoin,
        new RegExp(`${antiJoinTotal - 1} of ${antiJoinTotal} due`),
        "the practised variation is no longer due for its own pattern",
      );
      return { message, record, due, antiJoin };
    },
  );

  await check(
    "nothing due still offers the drill, with recall disclaimed",
    async () => {
      // Passing every drill in one sitting must not leave a surface that looks
      // broken until tomorrow, so due-ness recommends rather than gates.
      const dialog = page.locator("dialog");
      const article = dialog.locator("article", { hasText: "Anti-join" });
      const antiJoin = patterns.find(
        (entry) => entry.patternId === "anti-join",
      );
      const passed = [];
      // One variation was already passed above; drill the pattern out.
      for (
        let remaining = antiJoin.variations.length - 1;
        remaining > 0;
        remaining--
      ) {
        await article.getByRole("button", { name: "Start drill" }).click();
        const prompt = await dialog.locator(".kata-prompt").innerText();
        const meta = await dialog.locator(".kata-meta").first().innerText();
        const variation = antiJoin.variations.find((entry) =>
          meta.includes(entry.variationId),
        );
        assert.ok(variation, `no variation named in ${meta}`);
        await dialog.locator(".kata-editor .cm-content").click();
        await page.keyboard.insertText(variation.reference);
        await dialog.getByRole("button", { name: "Check drill" }).click();
        await page.waitForFunction(
          () => !!document.querySelector(".kata-feedback.kata-pass"),
          null,
          { timeout: 180_000 },
        );
        passed.push(variation.variationId);
        await dialog.getByRole("button", { name: "Back to patterns" }).click();
        void prompt;
      }
      const status = await article.locator(".kata-meta").innerText();
      assert.match(
        status,
        /0 of 3 due/,
        "the pattern is fully scheduled ahead",
      );
      const label = await article.locator("button").first().innerText();
      assert.equal(label, "Drill early");
      await article.getByRole("button", { name: "Drill early" }).click();
      await dialog.locator(".kata-prompt").waitFor();
      const notice = await dialog.locator(".kata-feedback").innerText();
      assert.match(notice, /does not measure recall/);
      await dialog.getByRole("button", { name: "Back to patterns" }).click();
      return { passed, status, notice };
    },
  );

  await check("a missed drill returns immediately", async () => {
    const dialog = page.locator("dialog");
    await dialog
      .locator("article", { hasText: "Absent, blank, and present" })
      .getByRole("button", { name: "Start drill" })
      .click();
    await dialog.locator(".kata-editor .cm-content").click();
    await page.keyboard.insertText("SELECT 1 AS wrong");
    await dialog.getByRole("button", { name: "Check drill" }).click();
    await page.waitForFunction(
      () =>
        !!document
          .querySelector(".kata-feedback")
          ?.className.includes("kata-miss"),
      null,
      { timeout: 120_000 },
    );
    const message = await dialog.locator(".kata-feedback").innerText();
    const stored = await page.evaluate(async () => {
      const { openPracticeStore } = await import("/src/lib/storage.ts");
      const store = await openPracticeStore(
        () => {},
        () => {},
      );
      try {
        return (await store.load()).katas;
      } finally {
        store.close();
      }
    });
    const record = stored.records.find(
      (entry) => entry.patternId === "null-logic",
    );
    assert.equal(record.streak, 0);
    assert.equal(record.passes, 0);
    assert.equal(record.lastOutcome, "miss");
    assert.equal(record.dueAt, record.lastAt, "a miss is due immediately");
    return { message, record };
  });

  await check(
    "drills never touch challenge progression or the skill map",
    async () => {
      const state = await page.evaluate(async () => {
        const { openPracticeStore } = await import("/src/lib/storage.ts");
        const store = await openPracticeStore(
          () => {},
          () => {},
        );
        try {
          const profile = await store.load();
          return {
            attempts: profile.attempts.length,
            // The application opens basics.01 on first load, so a document
            // existing proves nothing; a document belonging to a drill would.
            kataDocuments: profile.documents.filter(
              (document) =>
                document.id.startsWith("kata:") || /kata/i.test(document.name),
            ).length,
            completed: Object.keys(profile.hints).length,
            katas: profile.katas.records.length,
          };
        } finally {
          store.close();
        }
      });
      assert.equal(
        state.attempts,
        0,
        "a drill must not write a graded attempt",
      );
      assert.equal(
        state.kataDocuments,
        0,
        "a drill must not create a saved document",
      );
      assert.equal(
        state.completed,
        0,
        "a drill must not record hint or completion progress",
      );
      // Three anti-join passes and one null-logic miss have been recorded.
      assert.equal(state.katas, 4);
      return state;
    },
  );

  await check("the drill schedule survives a backup round trip", async () => {
    const result = await page.evaluate(async () => {
      const { openPracticeStore } = await import("/src/lib/storage.ts");
      const open = () =>
        openPracticeStore(
          () => {},
          () => {},
        );
      let store = await open();
      let backup, before;
      try {
        backup = await store.exportBackup();
        before = (await store.load()).katas;
      } finally {
        store.close();
      }
      // A fresh profile is a deleted database, which is what an import on a
      // new device actually restores into. There is no clear() API.
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("sql-grind-practice");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("delete blocked"));
      });
      store = await open();
      try {
        const fresh = (await store.load()).katas;
        await store.importBackup(backup);
        const after = (await store.load()).katas;
        return { before, fresh, after };
      } finally {
        store.close();
      }
    });
    assert.equal(
      result.fresh.records.length,
      0,
      "a fresh profile has no drill history",
    );
    const order = (records) =>
      [...records].sort((a, b) => a.variationId.localeCompare(b.variationId));
    assert.deepEqual(
      order(result.after.records),
      order(result.before.records),
      "an imported backup restores the drill schedule exactly",
    );
    return {
      before: result.before.records.length,
      after: result.after.records.length,
    };
  });

  assert.deepEqual(pageErrors, [], "the drill surface logged a page error");
} finally {
  const status = checks.every((entry) => entry.outcome === "pass")
    ? "passed"
    : "failed";
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        suite: "kata-smoke",
        appURL: appUrl.href,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  await context?.close();
  await browser?.close();
  console.log(
    JSON.stringify(
      { status, checks: checks.length, evidence: evidencePath },
      null,
      2,
    ),
  );
  if (status !== "passed") process.exitCode = 1;
}
