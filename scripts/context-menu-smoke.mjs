import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const mark = (text) => {
  checks.push(text);
  console.log("PASS", text);
};
const popup = page.locator(".context-menu");
const database = page.locator('.tray [data-context="database"]');
const judge = page.locator('.tray [data-context="judge"]');
const editor = page.locator(".cm-content");
async function choose(name) {
  await popup.getByRole("menuitem", { name, exact: true }).click();
}
async function right(target) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".toolbar button")].find(
        (button) => button.textContent.trim() === "Cancel",
      )?.disabled ?? true,
  );
  await target.click({ button: "right" });
  await popup.waitFor();
}
async function clipboard(expected) {
  await page.waitForFunction(
    (value) => navigator.clipboard.readText().then((text) => text === value),
    expected,
  );
}
async function sql(text) {
  await editor.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}
try {
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:4173");
  await database.locator("img").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".toolbar .execute") &&
      !document.querySelector(".toolbar .execute").disabled,
    null,
    { timeout: 45000 },
  );
  const original = await editor.innerText();
  const originalTab = page.locator('[data-context="query-tab"]').first();
  const originalId = await originalTab.getAttribute("data-document-id");
  const initialJudge = await page.locator("#judge-window").boundingBox();
  await right(database);
  const bounds = await popup.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 1440 &&
      bounds.y + bounds.height <= 960,
  );
  assert.equal(
    await popup
      .getByRole("menuitem", { name: "Cancel", exact: true })
      .isDisabled(),
    true,
  );
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent.trim()),
    "Refresh Schema",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await database.evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Shift+F10");
  await choose("Close Workbench");
  await page.locator("main.ide").waitFor({ state: "hidden" });
  await right(database);
  await choose("Open Workbench");
  await editor.waitFor();
  assert.equal(await editor.innerText(), original);
  mark(
    "Tray menu clamps to the viewport, skips disabled commands, restores keyboard focus, and closes/reopens without losing SQL",
  );

  await right(page.locator('[role="treeitem"][data-context="schema"]'));
  assert.equal(
    await popup
      .getByRole("menuitem", { name: "Close Workbench", exact: true })
      .count(),
    0,
  );
  await choose("View Schema");
  await page.locator("#schema-orders").waitFor({ state: "visible" });
  await originalTab.click();
  assert.equal(await editor.innerText(), original);
  mark(
    "Database tree context opens schema details without exposing tray window commands",
  );

  await right(judge);
  await choose("Hush Commentary");
  await page.waitForFunction(() =>
    document.querySelector(".tray-judge").title.includes("hushed"),
  );
  assert.deepEqual(
    await page.locator("#judge-window").boundingBox(),
    initialJudge,
  );
  await right(judge);
  await choose("Hide Patchouli");
  await page.locator("#judge-window").waitFor({ state: "hidden" });
  await right(judge);
  await choose("Show Patchouli");
  await page.locator("#judge-window").waitFor();
  assert.deepEqual(
    await page.locator("#judge-window").boundingBox(),
    initialJudge,
  );
  await right(judge);
  await choose("Dock Patchouli");
  await page.locator("#judge-docked").waitFor();
  await right(database);
  await choose("Close Workbench");
  await right(judge);
  await choose("Hide Patchouli");
  await right(judge);
  await choose("Show Patchouli");
  await page.locator("#judge-docked").waitFor();
  await right(judge);
  await choose("Float Patchouli");
  await page.locator("#judge-window").waitFor();
  mark(
    "Patchouli tray actions honor visibility, hush and explicit docking, including reopening a hidden docked workbench",
  );

  const orders = page.locator('[data-context="table"][data-table="orders"]');
  await right(orders);
  await choose("Select Top 1000 Rows");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".result-tools")
        ?.textContent?.includes("1,000 rows"),
    null,
    { timeout: 45000 },
  );
  assert.match(await editor.innerText(), /FROM "orders"\s+LIMIT 1000;/);
  assert.doesNotMatch(await editor.innerText(), /SELECT\s+\*/);
  const generatedId = await page
    .locator('[data-context="query-tab"][aria-selected="true"]')
    .getAttribute("data-document-id");
  assert.notEqual(generatedId, originalId);
  await originalTab.click();
  assert.equal(await editor.innerText(), original);
  await page.locator(`[data-document-id="${generatedId}"]`).click();
  await right(originalTab);
  await choose("Rename");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await originalTab.evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .locator('[data-context="query-tab"][aria-selected="true"]')
      .getAttribute("data-document-id"),
    generatedId,
  );
  await right(page.locator(`[data-document-id="${generatedId}"]`));
  await choose("Duplicate");
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('[data-context="query-tab"][aria-selected="true"]')
        ?.getAttribute("data-document-id") !== id,
    generatedId,
  );
  const duplicate = page.locator(
    '[data-context="query-tab"][aria-selected="true"]',
  );
  assert.match(await duplicate.innerText(), /copy\.sql/);
  const duplicateId = await duplicate.getAttribute("data-document-id");
  await right(duplicate);
  await choose("Close");
  await page
    .locator(`[data-document-id="${duplicateId}"]`)
    .waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "tab",
  );
  mark(
    "Table selection runs a bounded quoted query in a new tab; context tab actions target the clicked document and preserve drafts",
  );

  await sql(`SELECT * FROM (VALUES
    (1, E'first\\tvalue', 9007199254740993::BIGINT, 12.30::DECIMAL(10,2), NULL::VARCHAR, ''),
    (2, E'line\\n"two"', 9007199254740995::BIGINT, 45.60::DECIMAL(10,2), NULL::VARCHAR, '')
  ) AS data(id, text, big, amount, missing, empty);`);
  await editor.click({ button: "right", position: { x: 30, y: 8 } });
  await choose("Execute");
  await page.waitForFunction(
    () =>
      document.querySelector(".result-tools")?.textContent?.includes("2 rows"),
    null,
    { timeout: 45000 },
  );
  await right(page.locator("#result-cell-1-1"));
  await choose("Copy Cell");
  await clipboard('line\n"two"');
  assert.equal(
    await page
      .locator('[role="grid"]')
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Shift+F10");
  await choose("Copy Row with Headers");
  await clipboard(
    'id\ttext\tbig\tamount\tmissing\tempty\n2\t"line\n""two"""\t9007199254740995\t45.60\tNULL\t',
  );
  await page
    .getByRole("button", {
      name: "Accessible table (50 rows per page)",
      exact: true,
    })
    .click();
  await right(page.locator("#table-cell-0-1"));
  await choose("Copy Row");
  await clipboard('1\t"first\tvalue"\t9007199254740993\t12.30\tNULL\t');
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("#table-cell-0-1")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  mark(
    "Editor execution and both result menus work; row copies preserve escaped TSV, exact integers/decimals, NULL and empty strings",
  );

  await right(database);
  await right(judge);
  assert.equal(await popup.count(), 1);
  assert.equal(await popup.getAttribute("aria-label"), "Patchouli");
  await page.keyboard.press("Tab");
  assert.equal(await popup.count(), 0);
  await right(orders);
  await page.locator(".window-title").click();
  assert.equal(await popup.count(), 0);
  await right(orders);
  await page.setViewportSize({ width: 1280, height: 800 });
  await popup.waitFor({ state: "hidden" });
  assert.equal(await popup.count(), 0);
  await right(judge);
  await popup.screenshot({
    path: "readiness/evidence/application/context-menu-tray.png",
  });
  await page.keyboard.press("Escape");
  await right(orders);
  await page.screenshot({
    path: "readiness/evidence/application/context-menu-table.png",
  });
  mark(
    "Only one context menu remains open; Tab, outside clicks and resize dismiss it",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "readiness/evidence/application/context-menu-smoke.json",
    JSON.stringify(
      { pass: true, browser: browser.version(), checks, errors },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  console.error({
    activeElement: await page
      .evaluate(() => document.activeElement?.outerHTML.slice(0, 400))
      .catch(() => ""),
    status: await page
      .locator(".status-message")
      .innerText()
      .catch(() => ""),
    sql: await editor.innerText().catch(() => ""),
    output: await page
      .locator(".output")
      .innerText()
      .catch(() => ""),
    errors,
  });
  throw error;
} finally {
  await browser.close();
}
