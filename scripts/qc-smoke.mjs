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
  await page.getByRole("button", { name: "Hide judge", exact: true }).click();
  const title = page.locator(".ide-title .window-title");
  await title.dblclick();
  assert.equal(
    await page
      .getByRole("button", { name: "Maximize or restore IDE" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await title.dblclick();
  assert.equal(
    await page
      .getByRole("button", { name: "Maximize or restore IDE" })
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
  await page.getByRole("button", { name: "Judge", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare with Reference", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Hide judge", exact: true }).click();
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
  await page.getByRole("button", { name: "Judge", exact: true }).click();
  await page
    .getByRole("button", { name: "Compare with Reference", exact: true })
    .click();
  await page.locator("dialog[open]").waitFor();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page.locator(".comparison-progress").waitFor();
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
