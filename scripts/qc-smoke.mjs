import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const checks = [],
  errors = [];
const origin = process.env.APP_URL ?? "http://127.0.0.1:4173";
const definition = JSON.parse(
  await readFile("readiness/challenges/basics.01/challenge.json", "utf8"),
);
const assetPath = (url) => url.replace(/^\/bundle\//, "readiness/");
const reference = await readFile(assetPath(definition.reference), "utf8");
const expected = await Promise.all(
  Object.entries(definition.expected).map(async ([variant, url]) => ({
    variant,
    ...JSON.parse(await readFile(assetPath(url), "utf8")),
  })),
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => errors.push(String(error)));
const mark = (text) => {
  checks.push(text);
  console.log("PASS", text);
};
async function ready() {
  await page.waitForFunction(
    () =>
      (document.querySelector(".toolbar .execute") &&
        !document.querySelector(".toolbar .execute").disabled) ||
      document.querySelector(".error-banner"),
    null,
    { timeout: 45000 },
  );
  assert.equal(await page.locator(".error-banner").count(), 0);
}
async function menu(group, item) {
  await page.getByRole("menuitem", { name: group, exact: true }).click();
  await page
    .getByRole("menuitem", { name: item, exact: true })
    .or(page.getByRole("menuitemcheckbox", { name: item, exact: true }))
    .click();
}
async function edit(sql) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}
async function run(action = "Execute", keyboard = false) {
  const previous = await page.locator(".run-identity").allTextContents();
  if (keyboard) await page.locator(".cm-content").press("F5");
  else await page.getByRole("button", { name: action, exact: true }).click();
  await page.waitForFunction(
    (old) => {
      const identity = document.querySelector(".run-identity")?.textContent;
      return (
        document.querySelector(".error-banner") ||
        (identity &&
          identity !== old &&
          !document.querySelector(".toolbar .execute")?.disabled)
      );
    },
    previous[0] ?? "",
    { timeout: 120000 },
  );
  assert.equal(await page.locator(".error-banner").count(), 0);
}
async function submit() {
  await run("Submit");
  assert.equal(
    await page.locator(".fixture-results li").count(),
    expected.length,
  );
  // A first correct basics submission celebrates; stay on the challenge.
  if (await page.locator(".celebrate").count()) {
    await page
      .getByRole("button", { name: "Stay on this challenge", exact: true })
      .click();
    await page.locator("dialog").waitFor({ state: "hidden" });
  }
}
async function recordCount() {
  await menu("Skills", "Practice Records");
  await page.locator("dialog[open]").waitFor();
  const count = await page.locator(".library-list article").count();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  return count;
}
try {
  // Wide viewports keep the default 1× judge; size is a per-user drag setting.
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await ready();
    for (const name of ["Submit", "Hint (3 left)"]) {
      const button = page.getByRole("button", { name, exact: true });
      assert.equal(
        await button.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.bottom <= innerHeight - 32 &&
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
              e &&
            !e.closest(".goal-content")
          );
        }),
        true,
        `${name} must remain visible and clickable at ${viewport.width}x${viewport.height}`,
      );
    }
  }
  mark(
    "Pinned Hint/Submit are visible and unobstructed with the default floating judge at five desktop sizes",
  );
  await page
    .getByRole("button", { name: "Hint (3 left)", exact: true })
    .click();
  await page.locator("dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Hint (2 left)", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await menu("Query", "Reset Challenge SQL");
  await page.locator("dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("menuitem", { name: "Query", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  mark(
    "Escape closes hints and reset confirmation; focus returns to the persistent opener",
  );
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  const title = page.locator(".ide-title .window-title");
  await title.dblclick();
  assert.equal(
    await page
      .getByRole("button", { name: "Maximize or restore Workbench" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await title.dblclick();
  assert.equal(
    await page
      .getByRole("button", { name: "Maximize or restore Workbench" })
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Execute", exact: true })
      .getAttribute("aria-keyshortcuts"),
    "F5 Control+Enter Meta+Enter",
  );
  mark(
    "Title double-click toggles maximize and its accessible state; Execute has a clean name and shortcuts",
  );
  await edit("SELECT customer_id FROM customers WHERE;");
  await run("Execute", true);
  assert.equal(
    await page
      .getByRole("tab", { name: "Messages", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator(".scorecard dd.correct").count(), 0);
  mark("Keyboard Execute rejects syntax errors without completion credit");
  await page.getByRole("menuitem", { name: "Query", exact: true }).click();
  assert.match(
    await page
      .getByRole("menuitem", { name: "Execute", exact: true })
      .innerText(),
    /F5/,
  );
  await page.keyboard.press("Escape");
  await edit("CREATE TABLE qc_probe AS SELECT 1 AS x;");
  await run();
  assert.equal(
    await page
      .getByRole("tab", { name: "Messages", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await edit(
    "SELECT table_name FROM information_schema.tables WHERE table_name = 'qc_probe';",
  );
  await run();
  assert.equal(await page.locator(".grid-row").count(), 0);
  mark(
    "DDL is rejected without creating a table; Query menu exposes the Execute shortcut",
  );
  await edit("SELECT missing_column FROM customers;");
  await run();
  assert.equal(
    await page
      .getByRole("tab", { name: "Messages", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator(".scorecard dd.correct").count(), 0);
  const cte =
    "WITH m AS (\nSELECT o.order_id, o.status\nFROM orders o\n)\nSELECT m.* FROM m LIMIT 5;";
  await edit(cte);
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".diagnostic")].some(
      (e) => e.textContent.includes("J002") && e.textContent.includes("Ln 5"),
    ),
  );
  await page.locator(".diagnostic").filter({ hasText: "J002" }).click();
  assert.match(await page.locator(".statusbar").innerText(), /Ln 5 Col 11/);
  mark(
    "Qualified CTE wildcard points to the line-five star, not the statement start",
  );
  // Omit a required column and every customer: both shape and counts must fail.
  await edit("SELECT customer_id FROM customers WHERE false;");
  await run();
  await submit();
  assert.equal(await page.locator(".fixture-results li.correct").count(), 0);
  const failures = await page.locator(".fixture-results li").allTextContents();
  for (const fixture of expected) {
    const failure = failures.find((text) => text.includes(fixture.variant));
    assert.ok(failure, `Missing fixture ${fixture.variant}`);
    assert.match(failure, /Missing columns:.*customer_name/s);
    assert.ok(
      failure.includes(`expected ${fixture.rowCount} rows; returned 0`),
    );
  }
  assert.equal(
    await page
      .locator(".scorecard dt")
      .filter({ hasText: /^Datasets checked$/ })
      .evaluate((element) => element.nextElementSibling.textContent.trim()),
    String(expected.length),
  );
  await page.getByRole("button", { name: "Patchouli", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare with Reference", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  await edit(reference);
  await submit();
  assert.equal(
    await page.locator(".fixture-results li.correct").count(),
    expected.length,
  );
  const passes = await page.locator(".fixture-results li").allTextContents();
  for (const fixture of expected) {
    const pass = passes.find((text) => text.includes(fixture.variant));
    assert.ok(
      pass?.includes(
        `expected ${fixture.rowCount} rows; returned ${fixture.rowCount}`,
      ),
    );
  }
  assert.deepEqual(
    await page.locator(".grid-header small").allTextContents(),
    definition.output.columns.map((column) => column.type),
  );
  // DATE and DECIMAL display are independent of the active challenge's contract.
  await edit(
    "SELECT DATE '2024-02-29' AS day, 9007199254740993::BIGINT AS id, 1.23::DECIMAL(38,2) AS amount;",
  );
  await run();
  await page.locator(".grid-row [role=gridcell]").first().waitFor();
  assert.deepEqual(await page.locator(".grid-header small").allTextContents(), [
    "DATE",
    "BIGINT",
    "DECIMAL(38,2)",
  ]);
  assert.deepEqual(
    (await page.locator(".grid-row [role=gridcell]").allTextContents()).map(
      (text) => text.trim(),
    ),
    ["2024-02-29", "9007199254740993", "1.23"],
  );
  await edit(reference);
  const scrollbarWidth = await page
    .locator(".goal-content")
    .evaluate(
      (element) => getComputedStyle(element, "::-webkit-scrollbar").width,
    );
  assert.equal(scrollbarWidth, "16px");
  mark(
    "Grading shows specific missing columns, per-dataset expected/actual counts, and familiar SQL types",
  );
  const attemptsBeforeComparison = await recordCount();
  await page.getByRole("button", { name: "Patchouli", exact: true }).click();
  await page
    .getByRole("button", { name: "Compare with Reference", exact: true })
    .click();
  await page.locator("dialog[open]").waitFor();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page.locator(".comparison-progress").waitFor();
  // The bar is determinate because the pair count is known before the loop
  // starts. It was markup-only until the engine emitted the step it parses.
  const bar = page.locator(".comparison-progress progress");
  assert.equal(await bar.getAttribute("max"), "9");
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".comparison-progress progress")?.value),
    null,
    { timeout: 60000 },
  );
  assert.match(
    await page.locator(".comparison-progress [role='status']").textContent(),
    /Comparison \d+\/9/,
    "the comparison names the pair it is measuring",
  );
  await page
    .getByRole("button", { name: "Cancel comparison", exact: true })
    .click();
  await page
    .locator(".comparison-progress")
    .waitFor({ state: "hidden", timeout: 45000 });
  await ready();
  assert.equal(await recordCount(), attemptsBeforeComparison);
  mark(
    "Comparison requires a correct answer, exposes visible progress and cancellation, and saves no extra attempt",
  );
  // Format SQL is one undoable edit, and it refuses text it cannot parse.
  const typed = "select customer_name,count(*) from orders group by 1";
  await edit(typed);
  await menu("Edit", "Format SQL");
  // CodeMirror renders each line as its own element, so only innerText carries
  // the newlines a reflow produces.
  await page.waitForFunction(
    () => /\n/.test(document.querySelector(".cm-content")?.innerText ?? ""),
    null,
    { timeout: 15000 },
  );
  const formatted = await page.locator(".cm-content").innerText();
  assert.match(formatted, /^SELECT\n {2}customer_name,/);
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+z");
  // One undo, not two: the replacement must not be merged into the typing
  // group that preceded it.
  await page.waitForFunction(
    (text) => document.querySelector(".cm-content")?.innerText?.trim() === text,
    typed,
    { timeout: 15000 },
  );
  await edit("SELECT ((( FROM");
  await menu("Edit", "Format SQL");
  await page.waitForFunction(
    () =>
      /could not be formatted/.test(
        document.querySelector(".status-message")?.textContent ?? "",
      ),
    null,
    { timeout: 15000 },
  );
  assert.equal(
    (await page.locator(".cm-content").innerText()).trim(),
    "SELECT ((( FROM",
    "unparseable SQL is left exactly as the learner wrote it",
  );
  mark("Format SQL reflows as one undo step and refuses unparseable SQL");
  // Go to Line has one implementation: CodeMirror's own panel.
  await edit("SELECT 1;\nSELECT 2;\nSELECT 3;\nSELECT 4;");
  await menu("Edit", "Go to Line");
  await page.locator(".cm-panels .cm-goto-line").waitFor();
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Go to Line never opens a second, app-level prompt",
  );
  await page.keyboard.type("3");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector(".cm-activeLine")?.textContent === "SELECT 3;",
    null,
    { timeout: 15000 },
  );
  mark("Go to Line resolves to the editor's own panel and moves the caret");
  // The documented keys are generated from the menu hints, so they agree.
  await menu("Help", "Keyboard Shortcuts");
  await page.locator("dialog[open]").waitFor();
  const documented = await page
    .locator("dialog .shortcuts dt")
    .allTextContents();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const hint = await page
    .getByRole("menuitem", { name: /Go to Line/ })
    .innerText();
  await page.keyboard.press("Escape");
  assert.ok(
    documented.includes("Ctrl+Alt+G") && hint.includes("Ctrl+Alt+G"),
    "the dialog and the menu advertise the same key",
  );
  mark("Documented shortcuts are generated from the menu accelerator table");

  // A dialog taller than the viewport scrolls its body, not itself: focusing
  // the footer Close used to drag the title and the first rows out of view.
  // Pinned small on purpose: the assertion is about what happens when the list
  // cannot fit, so the viewport must guarantee it does not.
  const priorViewport = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 700 });
  await menu("Help", "Keyboard Shortcuts");
  await page.locator("dialog[open]").waitFor();
  const overflow = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    const first = dialog.querySelector(".shortcuts dt");
    return {
      dialogScroll: dialog.scrollHeight - dialog.clientHeight,
      firstRowTop: first.getBoundingClientRect().top,
      titleTop: dialog.querySelector(".titlebar").getBoundingClientRect().top,
      bodyScrolls:
        dialog.querySelector(".dialog-content").scrollHeight >
        dialog.querySelector(".dialog-content").clientHeight,
    };
  });
  assert.equal(overflow.dialogScroll, 0);
  assert.ok(overflow.bodyScrolls, "the long list scrolls inside the body");
  assert.ok(
    overflow.firstRowTop > overflow.titleTop,
    "the first documented shortcut stays below the title, never scrolled off",
  );
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.setViewportSize(priorViewport);
  // Sorting derives readable SQL instead of reordering the grid in place.
  await edit("SELECT customer_id, customer_name FROM customers ORDER BY 1;");
  await run();
  const firstBefore = await page.locator("#result-cell-0-1").innerText();
  await page.locator("#result-cell-0-1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: /Sort by customer_name Descending/ })
    .click();
  await page.waitForFunction(
    () =>
      /ORDER BY "customer_name" DESC/.test(
        document.querySelector(".cm-content")?.textContent ?? "",
      ),
    null,
    { timeout: 20000 },
  );
  assert.match(
    await page.locator("#document-tabs [aria-selected='true']").innerText(),
    /^sort_customer_name_desc\.sql/,
  );
  assert.equal(
    await page.locator("#result-cell-0-1").count(),
    0,
    "the derived query opens unrun: the grid never shows rows nobody executed",
  );
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.keyboard.press("Escape");
  mark("Grid sorting derives a new query and leaves the displayed rows alone");
  // History records what ran, survives reload, and recall never executes.
  await menu("Query", "Query History");
  await page.locator("dialog[open]").waitFor();
  const recalled = await page
    .locator("dialog .history-sql")
    .first()
    .innerText();
  assert.match(recalled, /FROM customers ORDER BY 1/);
  await page
    .getByRole("button", { name: "Open in new query", exact: true })
    .first()
    .click();
  await page.waitForFunction(
    (text) =>
      document.querySelector(".cm-content")?.textContent?.includes(text),
    "FROM customers ORDER BY 1",
    { timeout: 20000 },
  );
  assert.equal(
    await page.locator(".run-identity").count(),
    0,
    "recalled SQL waits for the learner: it never runs on open",
  );
  assert.equal(firstBefore.length > 0, true);
  mark("Query history recalls executed SQL without running it");
  await page.screenshot({
    path: "readiness/evidence/application/qc-updates.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "readiness/evidence/application/qc-smoke.json",
    JSON.stringify(
      { date: new Date().toISOString(), checks, errors },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
