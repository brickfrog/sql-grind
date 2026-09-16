import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173").origin;
const definition = JSON.parse(
  await readFile("readiness/challenges/basics.01/challenge.json", "utf8"),
);
const assetPath = (url) => url.replace(/^\/bundle\//, "readiness/");
const reference = await readFile(assetPath(definition.reference), "utf8");
const curriculum = JSON.parse(
  await readFile("readiness/curriculum.json", "utf8"),
);
const challengeName = `${definition.challengeId}.sql`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
await context.route("**/*", (r) =>
  new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
);
const page = await context.newPage();
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const mark = (name) => {
  checks.push(name);
  console.log("PASS", name);
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
async function activeDocument(value) {
  await page.waitForFunction(
    (name) =>
      document.querySelector(".window-title")?.textContent?.includes(name),
    value,
  );
  await ready();
}
async function menu(group, name) {
  await page.getByRole("menuitem", { name: group, exact: true }).click();
  await page
    .getByRole("menuitem", { name, exact: true })
    .or(page.getByRole("menuitemcheckbox", { name, exact: true }))
    .click();
}
async function close() {
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
}
function tableCounts() {
  return page
    .locator(".tree-row[data-table]")
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.getAttribute("data-table"),
          row.querySelector(".count")?.textContent,
        ]),
      ),
    );
}
async function edit(sql) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}
async function name(value, activate = true) {
  await page.locator("dialog input").fill(value);
  await page
    .locator("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  if (activate) await activeDocument(value);
}
async function run(action = "Execute") {
  await ready();
  const old = await page.locator(".run-identity").allTextContents();
  if (action === "Execute") await page.locator(".toolbar .execute").click();
  else await page.getByRole("button", { name: action, exact: true }).click();
  await page.waitForFunction(
    (old) => {
      const n = document.querySelector(".run-identity")?.textContent;
      return (
        document.querySelector(".error-banner") ||
        (n &&
          n !== old &&
          !document.querySelector(".toolbar .execute")?.disabled)
      );
    },
    old[0] ?? "",
    { timeout: 120000 },
  );
  assert.equal(await page.locator(".error-banner").count(), 0);
}
async function library() {
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "My Queries", exact: true })
    .click();
  await page.locator("dialog").waitFor();
}
async function exportSql() {
  const event = page.waitForEvent("download");
  await menu("File", "Export SQL");
  return readFile(await (await event).path(), "utf8");
}
async function confirm() {
  await page
    .locator("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
}
try {
  await page.goto(origin);
  await ready();
  await activeDocument(challengeName);
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  await edit(reference);
  await page
    .getByRole("button", { name: "Hint (3 left)", exact: true })
    .click();
  await page.locator("dialog").waitFor();
  await close();
  await run("Submit");
  assert.equal(
    await page.locator(".fixture-results li.correct").count(),
    Object.keys(definition.expected).length,
  );
  // First correct basics submission celebrates: confetti, a modal that can be
  // dismissed without leaving the challenge, and a Next action in the panel.
  await page.locator(".celebrate").waitFor();
  assert.ok(
    (await page.locator(".confetti i").count()) > 0,
    "confetti pieces render",
  );
  assert.match(
    await page.locator(".celebrate").innerText(),
    /solved\./,
    "the modal reports the solved challenge in Patchouli's voice",
  );
  await page
    .getByRole("button", { name: "Stay on this challenge", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.match(
    await page.locator(".window-title").innerText(),
    new RegExp(challengeName.replace(".", "\\.")),
    "dismissing the celebration keeps the current challenge open",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Next challenge", exact: true })
      .isEnabled(),
    true,
    "the goal panel offers the next challenge after completion",
  );
  await menu("Skills", "Practice Records");
  await page.locator("dialog").waitFor();
  assert.equal(await page.locator(".library-list article").count(), 1);
  await page
    .getByRole("combobox", { name: /^Correctness/ })
    .selectOption("incorrect");
  assert.equal(await page.locator(".library-list article").count(), 0);
  await page
    .getByRole("combobox", { name: /^Correctness/ })
    .selectOption("correct");
  await page
    .getByRole("combobox", { name: /^Assistance/ })
    .selectOption("unassisted");
  assert.equal(await page.locator(".library-list article").count(), 0);
  await page
    .getByRole("combobox", { name: /^Assistance/ })
    .selectOption("assisted");
  assert.equal(await page.locator(".library-list article").count(), 1);
  const records = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records", exact: true })
    .click();
  await records;
  await page
    .getByRole("button", { name: "Open attempt SQL", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    /attempt_[a-f0-9-]{8}\.sql/.test(
      document.querySelector(".window-title")?.textContent ?? "",
    ),
  );
  await ready();
  assert.equal(
    await page.getByRole("button", { name: "Submit", exact: true }).isEnabled(),
    true,
  );
  assert.equal(await exportSql(), reference);
  await menu("File", "Close Document");
  await activeDocument(challengeName);
  mark("Assisted accepted attempt filters, export and immutable SQL reopening");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "New Query", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".cm-content")?.textContent === "",
  );
  await ready();
  assert.equal(
    await page
      .getByRole("button", { name: "Submit", exact: true })
      .isDisabled(),
    true,
  );
  await edit("SELECT 17::BIGINT AS scratch;");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Parse", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".parser-info")?.textContent?.includes("Syntax OK"),
  );
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await name("scratch.sql");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "My Queries", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: /^Challenge filter/ })
    .selectOption("scratch");
  assert.equal(
    await page.getByRole("heading", { name: /^basics\.01\.sql/ }).count(),
    0,
  );
  await page
    .getByRole("combobox", { name: /^Challenge filter/ })
    .selectOption("challenge");
  assert.equal(
    await page.getByRole("heading", { name: /^basics\.01\.sql/ }).count(),
    1,
  );
  await close();
  const database = page.getByRole("combobox", {
    name: "Database",
    exact: true,
  });
  await database.selectOption("workshop");
  await ready();
  await page.getByRole("treeitem", { name: /^raw_contacts\s/ }).waitFor();
  assert.equal(await exportSql(), "SELECT 17::BIGINT AS scratch;");
  await database.selectOption(definition.datasetId);
  await ready();
  await page.getByRole("treeitem", { name: /^orders\s/ }).waitFor();
  const tablesBefore = await tableCounts();
  // The generic writable sandbox is retired. CREATE/probe/DROP is covered by
  // the real plan.04 UI run; scratch SQL must not mutate this learning dataset.
  await edit("CREATE INDEX smoke_orders_customer ON orders(customer_id);");
  await run();
  assert.equal(
    await page
      .getByRole("tab", { name: "Messages", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("treeitem", { name: /Indexes \/ ART/ }).click();
  await menu("Tools", "Refresh Schema");
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Schema refreshed"),
  );
  assert.equal(
    await page
      .getByRole("treeitem", { name: "smoke_orders_customer", exact: true })
      .count(),
    0,
  );
  const indexProbe =
    "SELECT index_name FROM duckdb_indexes() WHERE index_name = 'smoke_orders_customer';";
  await edit(indexProbe);
  await run();
  assert.equal(await page.locator(".grid-row").count(), 0);
  await menu("Tools", "Reset Index Lab Session");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(await database.inputValue(), definition.datasetId);
  assert.equal(await exportSql(), indexProbe);
  assert.deepEqual(await tableCounts(), tablesBefore);
  await menu("Tools", "Reset Index Lab Session");
  await confirm();
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Index lab session reset"),
  );
  assert.equal(await database.inputValue(), definition.datasetId);
  assert.equal(await exportSql(), indexProbe);
  assert.deepEqual(await tableCounts(), tablesBefore);
  await run();
  assert.equal(await page.locator(".grid-row").count(), 0);
  await page
    .getByRole("tab", { name: /^basics\.01\.sql(?: \*)?$/, exact: true })
    .click();
  await activeDocument(challengeName);
  assert.match(await page.locator(".skill-tag").textContent(), /1\/5/);
  await menu("Tools", "Refresh Schema");
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Schema refreshed"),
  );
  await page.getByRole("treeitem", { name: /^orders\s/ }).click();
  await page
    .getByRole("button", { name: "Open selected schema details", exact: true })
    .click();
  await page.locator("#schema-orders").waitFor();
  await page
    .locator('nav[aria-label="Schema tables"]')
    .getByRole("link", { name: "products", exact: true })
    .click();
  await page.locator("#schema-products").waitFor();
  mark(
    "Toolbar New/Open/Save/Parse, challenge filter, immutable dataset switching, DDL rejection and reset consent preserve SQL and progress",
  );
  for (const id of ["rec", "pivot"]) {
    const skill = curriculum.skills.find((skill) => skill.id === id);
    // Anchored: a locked row's accessible name embeds its blocker's label, so
    // an unanchored label matches every skill that names this one.
    await page
      .getByRole("treeitem", { name: new RegExp(`^${skill.label}`) })
      .click();
    assert.equal(
      await page.locator("#skill-map-" + id).getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator(".objectives button:disabled").count(), 5);
  }
  const prerequisite = curriculum.skills.find((skill) => skill.id === "pivot")
    .requires[0];
  await page.locator(".requirements button").first().click();
  assert.equal(
    await page
      .locator("#skill-map-" + prerequisite)
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.locator(".skill-node").count(),
    curriculum.skills.length,
  );
  for (const skill of curriculum.skills) {
    await page.locator("#skill-map-" + skill.id).click();
    assert.equal(
      await page.locator(".objectives li").count(),
      skill.requiredChallengeIds.length,
    );
    assert.equal(
      await page.locator(".objectives button:disabled").count(),
      skill.id === definition.skillId ? 0 : skill.requiredChallengeIds.length,
    );
  }
  for (const zoom of ["75", "100", "125", "150", "fit"])
    await page.getByLabel("Map zoom", { exact: true }).selectOption(zoom);
  assert.equal(await page.locator(".goal-footer button").isDisabled(), true);
  // Locked skills remain inspectable, but only basics is currently available.
  // Open the fifth basics objective directly; no injected completion or ranking unlock.
  await page.locator("#skill-map-basics").click();
  await page.locator(".objectives button").nth(4).click();
  await activeDocument("basics.05.sql");
  assert.equal(
    await page.getByRole("button", { name: "Submit", exact: true }).isEnabled(),
    true,
  );
  await page.getByRole("treeitem", { name: /^SQL basics/ }).click();
  await page
    .getByRole("treeitem", {
      name: new RegExp(`^${definition.displayNumber.replace(".", "\\.")} `),
    })
    .click();
  await activeDocument(challengeName);
  await edit("SELECT 123::BIGINT AS changed;");
  await menu("Query", "Reset Challenge SQL");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(await exportSql(), "SELECT 123::BIGINT AS changed;");
  await menu("Query", "Reset Challenge SQL");
  await confirm();
  await page.waitForFunction(
    (starter) => document.querySelector(".cm-content")?.textContent === starter,
    definition.starterSql,
  );
  assert.equal(await exportSql(), definition.starterSql);
  mark(
    "Thirteen authored skill details, prerequisite links, zoom, locked objectives, direct basics navigation, and confirmed starter reset",
  );
  await edit("WITH x AS (SELECT * FROM orders o, products p) SELECT * FROM x;");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Parse", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".diagnostic").length >= 2,
  );
  const facts = await page.locator(".diagnostic").allTextContents();
  await page.locator(".diagnostic").first().click();
  assert.equal(
    await page
      .locator(".cm-content")
      .evaluate((e) => e.contains(document.activeElement)),
    true,
  );
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Patchouli", exact: true })
    .click();
  assert.deepEqual(await page.locator(".diagnostic").allTextContents(), facts);
  await page
    .getByRole("button", { name: "Patchouli’s notes ›", exact: true })
    .click();
  assert.deepEqual(await page.locator(".diagnostic").allTextContents(), facts);
  await page.getByRole("button", { name: "Hush", exact: true }).click();
  await edit("SELECT 1::BIGINT AS clean;");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Parse", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".diagnostic").length === 0,
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".cm-content")
      .evaluate((e) => e.contains(document.activeElement)),
    false,
  );
  await edit(reference);
  await page.locator(".goal-compare").click();
  await page.locator("dialog").waitFor();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.locator(".goal-compare").click();
  await confirm();
  // The report has its own tab now. It used to be filed under Execution plan,
  // which meant starting a comparison switched to a tab reading "No plan
  // collected" for the fifteen seconds the nine pairs took, then replaced it
  // with timings that are not a plan.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".plan-view h3").length === 3 &&
      /Paired ratio/.test(
        document.querySelector(".plan-view")?.textContent ?? "",
      ) &&
      !document.querySelector(".toolbar .execute")?.disabled,
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "Comparison", exact: true })
      .getAttribute("aria-selected"),
    "true",
    "a comparison must report under its own tab",
  );
  // Execution plan keeps its own meaning: no plan was collected by comparing.
  await page.getByRole("tab", { name: "Execution plan", exact: true }).click();
  assert.match(
    await page.locator(".plan-view").innerText(),
    /No plan collected/,
  );
  await page.getByRole("tab", { name: "Comparison", exact: true }).click();
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  mark(
    "Diagnostic facts survive hush and re-opening; Notes selects source; Hush does not disable parsing; real plan comparison requires consent",
  );
  await library();
  await page
    .getByRole("combobox", { name: /^Challenge filter/ })
    .selectOption("all");
  await close();
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "New Query", exact: true })
    .click();
  await activeDocument("untitled.sql");
  await edit("SELECT 5::BIGINT AS kept;");
  await menu("File", "Save");
  await name("duplicate_name.sql");
  // Delete the saved copy before slow editor activation settles. A late save
  // must not recreate it or report a false cross-tab conflict.
  await menu("File", "Save As");
  await name("duplicate_name.sql");
  await library();
  await page
    .getByLabel("Search queries", { exact: true })
    .fill("duplicate_name.sql");
  assert.equal(await page.locator(".library-list article").count(), 2);
  await page
    .locator(".library-list article")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".library-list article").length === 1,
  );
  await close();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Recycle Bin", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await name("restored_unique.sql", false);
  await library();
  await page
    .getByLabel("Search queries", { exact: true })
    .fill("restored_unique.sql");
  await page.getByRole("heading", { name: /^restored_unique\.sql/ }).waitFor();
  assert.equal(await page.locator(".library-list article").count(), 1);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".library-list article").length === 0,
  );
  await close();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Recycle Bin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Recycle Bin", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: "Restore", exact: true }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await confirm();
  await page.waitForFunction(
    () =>
      document.querySelector("dialog[open]") &&
      document.querySelectorAll(".library-list article").length === 0,
  );
  assert.equal(await page.locator(".library-list article").count(), 0);
  await close();
  await library();
  await page
    .getByLabel("Search queries", { exact: true })
    .fill("duplicate_name.sql");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".library-list article").length === 0,
  );
  await close();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Recycle Bin", exact: true })
    .click();
  await page.getByRole("button", { name: "Empty Bin", exact: true }).click();
  await confirm();
  await page.waitForFunction(
    () =>
      document.querySelector("dialog[open]") &&
      document.querySelectorAll(".library-list article").length === 0,
  );
  assert.equal(await page.locator(".library-list article").count(), 0);
  await close();
  mark(
    "Restore name collision requests a new name; permanent deletion and Empty Bin require consent",
  );
  await page
    .getByRole("tab", { name: /^basics\.01\.sql(?: \*)?$/, exact: true })
    .click();
  await activeDocument(challengeName);
  await library();
  await page
    .getByLabel("Search queries", { exact: true })
    .fill("duplicate_name");
  assert.equal(await page.locator(".library-list article").count(), 0);
  await close();
  await menu("Skills", "Practice Records");
  await page
    .getByRole("combobox", { name: /^Correctness/ })
    .selectOption("all");
  await page.getByRole("combobox", { name: /^Assistance/ }).selectOption("all");
  assert.equal(await page.locator(".library-list article").count(), 1);
  await page
    .getByRole("button", { name: "Delete attempt", exact: true })
    .click();
  await confirm();
  await page.waitForFunction(
    () =>
      document.querySelector("dialog[open]") &&
      document.querySelectorAll(".library-list article").length === 0,
  );
  assert.equal(await page.locator(".library-list article").count(), 0);
  await close();
  assert.match(await page.locator(".skill-tag").textContent(), /0\/5/);
  mark(
    "Deleting the only accepted attempt recomputes completion without fake mastery",
  );
  for (const selector of [".desktop-icons", ".taskbar"]) {
    const requested = context.waitForEvent(
      "request",
      (r) => r.url() === "https://duckdb.org/docs/",
    );
    const popped = page.waitForEvent("popup");
    await page
      .locator(selector)
      .getByRole("button", {
        name: "DuckDB Docs — opens in a new tab",
        exact: true,
      })
      .click();
    await requested;
    await (await popped).close();
  }
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Schema Reference", exact: true })
    .click();
  await page.locator(".schema-reference").waitFor();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Skill Map", exact: true })
    .click();
  await page.locator(".skill-map").waitFor();
  assert.ok(
    await page
      .locator("time")
      .evaluate((e) => Math.abs(Date.now() - Date.parse(e.dateTime)) < 5000),
  );
  assert.deepEqual(errors, []);
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    "readiness/evidence/application/workflows-smoke.json",
    JSON.stringify(
      { date: new Date().toISOString(), checks, errors, pass: true },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  console.error(
    "STATUS",
    await page.locator(".status-message").allTextContents(),
  );
  console.error("ERROR", await page.locator(".error-banner").allTextContents());
  await mkdir("readiness/evidence/application", { recursive: true });
  await page
    .screenshot({
      path: "readiness/evidence/application/workflows-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
