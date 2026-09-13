import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173").origin;
const [firstChallenge, lastChallenge] = await Promise.all(
  ["basics.01", "basics.05"].map(async (id) =>
    JSON.parse(
      await readFile(`readiness/challenges/${id}/challenge.json`, "utf8"),
    ),
  ),
);
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const mark = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const visible = (selector) =>
  page.locator(selector).waitFor({ state: "visible" });
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
async function ready() {
  await page.waitForFunction(
    () =>
      (document.querySelector(".toolbar .execute") &&
        !document.querySelector(".toolbar .execute").disabled) ||
      document.querySelector(".error-banner"),
    null,
    { timeout: 45000 },
  );
  assert.equal(
    await page.locator(".error-banner").count(),
    0,
    await page.locator(".error-banner").allTextContents(),
  );
}
async function edit(sql) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}
async function name(value) {
  await visible("dialog input");
  await page.locator("dialog input").fill(value);
  await page
    .locator("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
}
async function library() {
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "My Queries", exact: true })
    .click();
  await visible("dialog");
}
try {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  await ready();
  await page.getByRole("button", { name: "Hide judge", exact: true }).click();
  await menu("File", "New Query");
  await page.waitForFunction(() =>
    document
      .querySelector(".window-title")
      ?.textContent?.includes("untitled.sql"),
  );
  await edit("SELECT 42::BIGINT AS answer;");
  await menu("File", "Save");
  await name("control_query.sql");
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Saved control_query.sql"),
  );
  await menu("File", "Save As");
  await name("control_copy.sql");
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Saved control_copy.sql"),
  );
  mark("File New/Save/Save As preserve distinct documents");
  assert.equal(
    await page.locator(".cm-content").getAttribute("aria-label"),
    "SQL editor — control_copy.sql",
  );
  const outsideSaveIntercepted = await page.evaluate(() => {
    const desktop = document.querySelector(".desktop-icons button");
    desktop.focus();
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    desktop.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(outsideSaveIntercepted, false);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Saved control_copy.sql"),
  );
  mark("Editor names follow Save As; Save shortcut remains scoped to the IDE");
  await menu("Edit", "Select All");
  await menu("Edit", "Copy");
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "SELECT 42::BIGINT AS answer;",
  );
  await menu("Edit", "Cut");
  await page.waitForFunction(
    () => document.querySelector(".cm-content")?.textContent === "",
  );
  await menu("Edit", "Undo");
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("42"),
  );
  await menu("Edit", "Redo");
  await page.waitForFunction(
    () => document.querySelector(".cm-content")?.textContent === "",
  );
  await menu("Edit", "Paste");
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("42"),
  );
  await menu("Edit", "Find");
  await visible(".cm-search");
  await page.locator(".cm-search input").first().fill("42");
  await page.keyboard.press("Escape");
  await menu("Edit", "Replace");
  await visible(".cm-search");
  await page.keyboard.press("Escape");
  await menu("Edit", "Go to Line");
  await name("1");
  await menu("Edit", "Replace");
  await visible(".cm-search");
  await page.locator(".cm-search input[name=search]").fill("42");
  await page.locator(".cm-search input[name=replace]").fill("84");
  await page.locator(".cm-search button[name=replaceAll]").click();
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("84"),
  );
  await page.keyboard.press("Escape");
  mark("Edit clipboard, undo/redo, find/replace text, and Go to Line");
  await library();
  await page
    .getByLabel("Search queries", { exact: true })
    .fill("control_query");
  assert.equal(await page.locator(".library-list article").count(), 1);
  await page
    .locator(".library-list article")
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await name("renamed_query.sql");
  await library();
  await page
    .getByLabel("Search queries", { exact: true })
    .fill("renamed_query");
  await page
    .locator(".library-list article")
    .getByRole("button", { name: "Duplicate", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".library-list article").length === 2,
  );
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
  await visible("dialog");
  assert.equal(await page.locator(".library-list article").count(), 1);
  await page
    .locator(".library-list article")
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".library-list article").length === 0,
  );
  await close();
  mark(
    "Query library search, rename, duplicate, soft delete and identity-preserving restore",
  );
  await menu("File", "Export Practice Backup");
  // Repeat through the actual command with the listener attached before activation.
  const downloadEvent = page.waitForEvent("download");
  await menu("File", "Export Practice Backup");
  const backup = await downloadEvent;
  const backupText = await readFile(await backup.path(), "utf8");
  assert.ok(JSON.parse(backupText));
  const chooserEvent = page.waitForEvent("filechooser");
  await menu("File", "Import Practice Backup");
  const chooser = await chooserEvent;
  await chooser.setFiles({
    name: "practice.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupText),
  });
  await page
    .locator("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Backup imported"),
  );
  mark("Practice backup export and import via desktop controls");
  await menu("File", "Open");
  await visible("dialog");
  const sqlChooserEvent = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import SQL file", exact: true })
    .click();
  const sqlChooser = await sqlChooserEvent;
  await sqlChooser.setFiles({
    name: "imported.sql",
    mimeType: "text/plain",
    buffer: Buffer.from("SELECT 7::BIGINT AS imported;"),
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".window-title")
      ?.textContent?.includes("imported.sql"),
  );
  assert.equal(await page.locator(".run-identity").count(), 0);
  await ready();
  mark("SQL import creates a document without executing it");
  await page
    .getByRole("button", { name: "Filter objects", exact: true })
    .click();
  await page.getByLabel("Filter database objects").fill("order_items");
  assert.equal(await page.locator('[data-context="table"]').count(), 1);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.locator('[role="treeitem"][data-table="orders"]').dblclick();
  await visible("#schema-orders");
  assert.match(
    await page.locator("#schema-orders").textContent(),
    /ordered_at/,
  );
  // The requested heading must reach the top of its own scroll viewport, not
  // merely be somewhere inside it. End-of-content tables cannot scroll further,
  // so accept the closest reachable position while the heading stays visible.
  const placement = (table) =>
    page.evaluate((name) => {
      const section = document.getElementById(`schema-${name}`);
      const view = document.querySelector(".schema-reference");
      if (!section || !view) return null;
      const offset =
        section.getBoundingClientRect().top - view.getBoundingClientRect().top;
      return {
        offset,
        atEnd: view.scrollTop >= view.scrollHeight - view.clientHeight - 1,
        insideView: offset >= -1 && offset < view.clientHeight,
      };
    }, table);
  // Navigation waits one tick plus one frame, so poll rather than sample once.
  const anchored = async (table) => {
    await page
      .waitForFunction(
        (name) => {
          const section = document.getElementById(`schema-${name}`);
          const view = document.querySelector(".schema-reference");
          if (!section || !view) return false;
          const offset =
            section.getBoundingClientRect().top -
            view.getBoundingClientRect().top;
          const atEnd =
            view.scrollTop >= view.scrollHeight - view.clientHeight - 1;
          return (
            offset >= -1 && offset < view.clientHeight && (offset < 4 || atEnd)
          );
        },
        table,
        { timeout: 5000 },
      )
      .catch(async () => {
        assert.fail(
          `${table} heading never reached the schema viewport start: ${JSON.stringify(await placement(table))}`,
        );
      });
  };
  await anchored("orders");
  // Keyboard navigation uses the same path, and a later request wins.
  await page.locator('[role="treeitem"][data-table="payments"]').focus();
  await page.keyboard.press("Enter");
  await visible("#schema-payments");
  await anchored("payments");
  await page.locator('[role="treeitem"][data-table="orders"]').dblclick();
  await page.locator('[role="treeitem"][data-table="categories"]').dblclick();
  await anchored("categories");
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector('[role="treeitem"][data-table="categories"]')
          ?.getAttribute("aria-selected") === "true",
    ),
    true,
    "the last requested table stays selected",
  );
  await page
    .getByRole("button", { name: "Object Explorer actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  assert.equal(await page.locator('[data-context="table"]').count(), 0);
  await page
    .getByRole("button", { name: "Object Explorer actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Show all", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh schema", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Schema refreshed"),
  );
  mark(
    "Explorer filter, table schema, expand/collapse and real metadata refresh",
  );
  await page
    .getByRole("button", { name: "Hide Object Explorer", exact: true })
    .click();
  assert.equal(await page.locator(".explorer").count(), 0);
  await menu("View", "Object Explorer");
  await page
    .getByRole("button", { name: "Goal panel actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse content", exact: true })
    .click();
  assert.equal(await page.locator(".goal-content").count(), 0);
  await page
    .getByRole("button", { name: "Expand content", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide Goal panel", exact: true })
    .click();
  await menu("View", "Goal / Skill Details");
  await menu("View", "Reset Layout");
  mark("Pane visibility, collapse/expand, and layout reset");
  await page.getByRole("tab", { name: "imported.sql *", exact: true }).click();
  await ready();
  for (const [command, label] of [
    ["Results", "Results"],
    ["Messages", "Messages"],
    ["Execution Plan", "Execution plan"],
    ["Judge Notes", "Patchouli’s notes"],
  ]) {
    await menu("View", command);
    assert.equal(
      await page
        .getByRole("tab", { name: new RegExp("^" + label) })
        .getAttribute("aria-selected"),
      "true",
    );
  }
  await menu("Query", "Parse");
  await page.waitForFunction(() =>
    document.querySelector(".parser-info")?.textContent?.includes("Syntax OK"),
  );
  await menu("Query", "Show Plan");
  await page.waitForFunction(
    () => document.querySelector(".plan-view pre")?.textContent?.length > 0,
    null,
    { timeout: 45000 },
  );
  await edit(
    "SELECT i::BIGINT AS id, i::DECIMAL(18,2) AS amount, CASE WHEN i=0 THEN NULL WHEN i=1 THEN '' ELSE i::VARCHAR END AS text FROM range(1000) t(i);",
  );
  await page.locator(".cm-content").press("F5");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".result-tools")
        ?.textContent?.includes("1,000 rows"),
    null,
    { timeout: 45000 },
  );
  assert.equal(
    await page.getByRole("grid").getAttribute("aria-rowcount"),
    "1001",
  );
  assert.ok(
    (await page.locator(".grid-row").count()) < 1000,
    "Large results must use bounded rendering",
  );
  await page.locator("#result-cell-0-2").click();
  await page.getByRole("button", { name: "Copy cell", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "NULL",
  );
  await page.getByRole("grid").focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "Copy cell", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "");
  await page.getByRole("grid").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Copy cell", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "1.00",
  );
  await page.getByRole("grid").focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForFunction(
    () =>
      document
        .querySelector("[role=grid]")
        ?.getAttribute("aria-activedescendant") === "result-cell-999-2",
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("PageDown");
  await page
    .getByRole("button", { name: "Accessible table (50 rows)", exact: true })
    .click();
  assert.equal(await page.locator(".result-panel tbody tr").count(), 50);
  await page.getByRole("button", { name: "Last", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Next", exact: true }).isDisabled(),
    true,
  );
  await page.locator("#table-cell-950-0").focus();
  await page.keyboard.press("ControlOrMeta+End");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "table-cell-999-2",
  );
  await page.keyboard.press("PageUp");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "table-cell-949-2",
  );
  await page.getByRole("button", { name: "First", exact: true }).click();
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    "readiness/evidence/application/accessible-results.txt",
    await page.locator(".result-panel").ariaSnapshot(),
  );
  await page.getByRole("button", { name: "Virtual grid", exact: true }).click();
  mark(
    "F5 executes; virtual and paginated grids navigate and copy exact decimals, NULL and empty text",
  );
  await page
    .getByRole("slider", { name: "Editor and results splitter" })
    .focus();
  const oldHeight = await page
    .getByRole("slider", { name: "Editor and results splitter", exact: true })
    .inputValue();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    Number(
      await page
        .getByRole("slider", {
          name: "Editor and results splitter",
          exact: true,
        })
        .inputValue(),
    ),
    Number(oldHeight) + 10,
  );
  mark("Result tabs, explicit Parse/Show Plan, keyboard splitter");
  await menu("Skills", "Skill Map");
  assert.equal(await page.locator(".skill-node").count(), 13);
  await page.getByLabel("Map zoom", { exact: true }).selectOption("150");
  await page.locator("#skill-map-rec").click();
  assert.equal(
    await page.locator("#skill-map-rec").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator(".objectives li").count(), 5);
  assert.equal(await page.locator(".objectives button:disabled").count(), 5);
  await page.locator("#skill-map-rec").focus();
  await page.keyboard.press("Home");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "skill-map-basics",
  );
  assert.equal(await page.locator(".objectives button:enabled").count(), 5);
  await page
    .locator(".objectives button")
    .filter({
      hasText: lastChallenge.challengeId,
    })
    .click();
  await ready();
  assert.equal(
    await page.locator(".cm-content").innerText(),
    lastChallenge.starterSql,
  );
  const lastDocumentId = await page
    .locator('[data-context="query-tab"][aria-selected="true"]')
    .getAttribute("data-document-id");
  await edit("SELECT 505::BIGINT AS independent_draft;");
  await menu("Skills", "Skill Map");
  await page.locator("#skill-map-rec").click();
  await menu("Skills", "Current Skill");
  assert.equal(
    await page.locator("#skill-map-basics").getAttribute("aria-pressed"),
    "true",
  );
  await menu("Skills", "Open Next Challenge");
  await ready();
  assert.equal(
    await page.locator(".cm-content").innerText(),
    firstChallenge.starterSql,
  );
  assert.notEqual(
    await page
      .locator('[data-context="query-tab"][aria-selected="true"]')
      .getAttribute("data-document-id"),
    lastDocumentId,
  );
  await menu("Skills", "Current Skill");
  await page
    .locator(".objectives button")
    .filter({
      hasText: lastChallenge.challengeId,
    })
    .click();
  await ready();
  assert.equal(
    await page
      .locator('[data-context="query-tab"][aria-selected="true"]')
      .getAttribute("data-document-id"),
    lastDocumentId,
  );
  assert.equal(
    await page.locator(".cm-content").innerText(),
    "SELECT 505::BIGINT AS independent_draft;",
  );
  mark(
    "Thirteen-skill map, locked requirements, five selectable basics objectives, keyboard navigation, current skill, next challenge and independent drafts",
  );
  await menu("View", "Judge");
  await visible("#judge-window");
  await page.getByRole("button", { name: "Hush", exact: true }).click();
  await page.getByRole("button", { name: "Hide judge", exact: true }).click();
  await page.locator(".judge-task").click();
  assert.equal(
    await page
      .getByRole("button", { name: "Resume commentary", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "Resume commentary", exact: true })
    .click();
  const title = page.locator(".judge-title");
  const box = await title.boundingBox();
  await page.mouse.move(box.x + 70, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y - 60);
  await page.mouse.up();
  const moved = await page.locator("#judge-window").boundingBox();
  assert.ok(moved.x < box.x || moved.y < box.y);
  await menu("Window", "Move Judge");
  const startX = await page
    .locator("#judge-window")
    .evaluate((e) => e.getBoundingClientRect().x);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .locator("#judge-window")
      .evaluate((e) => e.getBoundingClientRect().x),
    startX + 10,
  );
  await page.getByRole("button", { name: "Dock judge", exact: true }).click();
  await visible("#judge-docked");
  await page.getByRole("button", { name: "Float judge", exact: true }).click();
  await visible("#judge-window");
  await page
    .getByRole("button", { name: "Show diagnostics", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("tab", { name: /^Patchouli’s notes/ })
      .getAttribute("aria-selected"),
    "true",
  );
  await menu("Window", "Reset Judge Position and Size");
  await page.getByRole("button", { name: "Hide judge", exact: true }).click();
  mark(
    "Judge drag, keyboard move, float/dock/hide, persistent hush and diagnostics",
  );
  await menu("Tools", "Settings");
  await visible("dialog");
  await page
    .getByRole("combobox", { name: /^Editor font size/ })
    .selectOption("14");
  await page.getByRole("combobox", { name: /^Indentation/ }).selectOption("4");
  await page.getByLabel("Wrap SQL lines", { exact: true }).check();
  await page.getByLabel("Hush unsolicited commentary", { exact: true }).check();
  await page
    .getByLabel("Announce current diagnostic summaries", { exact: true })
    .check();
  await close();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".cm-editor")).fontSize ===
      "14px",
  );
  mark("Settings apply editor and judge preferences");
  await menu("Tools", "Storage");
  await visible("dialog");
  assert.match(await page.locator("dialog").textContent(), /IndexedDB/);
  await page
    .getByRole("button", { name: "Request persistent storage", exact: true })
    .click();
  await close();
  for (const item of [
    "Keyboard Shortcuts",
    "Challenge Rules",
    "Asset Credits",
    "About",
  ]) {
    await menu("Help", item);
    await visible("dialog");
    await close();
  }
  const docsRequest = context.waitForEvent("request", (r) =>
    /^https:\/\/duckdb.org\/docs/.test(r.url()),
  );
  const popupEvent = page.waitForEvent("popup");
  await menu("Help", "DuckDB Docs");
  const popup = await popupEvent;
  assert.equal((await docsRequest).url(), "https://duckdb.org/docs/");
  await popup.close();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Leaderboard", exact: true })
    .click();
  await visible("dialog");
  assert.equal(
    await page.locator("dialog .library-list article").count(),
    0,
    "Execute must not invent ranked attempts",
  );
  await close();
  mark("Storage, help, credits, external documentation link and local records");
  await page.getByRole("button", { name: "Minimize IDE", exact: true }).click();
  assert.equal(await page.locator(".ide").count(), 0);
  await page.locator("#app-task").click();
  await visible(".ide");
  await page
    .getByRole("button", { name: "Maximize or restore IDE", exact: true })
    .click();
  assert.equal(await page.locator(".ide.maximized").count(), 1);
  await page
    .getByRole("button", { name: "Maximize or restore IDE", exact: true })
    .click();
  await page.getByRole("button", { name: "Show desktop", exact: true }).click();
  assert.equal(await page.locator(".ide").count(), 0);
  await page.getByRole("button", { name: "Show desktop", exact: true }).click();
  await visible(".ide");
  await page.getByRole("button", { name: "Close IDE", exact: true }).click();
  await page.locator(".ide").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page
    .locator(".start-menu")
    .getByRole("button", { name: "SQL Grind", exact: true })
    .click();
  await visible(".ide");
  mark(
    "IDE minimize/maximize/close, taskbar restoration, Show Desktop and Start",
  );
  await page.getByRole("menuitem", { name: "File", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "menu-Edit",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "menu-Edit",
  );
  await page.keyboard.press("F6");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.hasAttribute("data-region"),
    ),
    true,
  );
  await menu("View", "Reading Layout");
  await page.setViewportSize({ width: 320, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Reading layout must not overflow the 320px viewport",
  );
  await menu("Help", "About");
  await visible("dialog");
  const rect = await page.locator("dialog").boundingBox();
  assert.ok(rect.width <= 320);
  await close();
  await mkdir("readiness/evidence/application", { recursive: true });
  await page.screenshot({
    path: "readiness/evidence/application/reading-layout.png",
    fullPage: true,
  });
  mark("Menu keyboard, F6 regions, 320px reading layout and dialog reflow");
  assert.deepEqual(errors, []);
  await writeFile(
    "readiness/evidence/application/controls-smoke.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        checks,
        errors,
        pass: true,
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  console.log("FAIL", String(error));
  console.log(
    "STATUS",
    await page.locator(".status-message").allTextContents(),
  );
  await mkdir("readiness/evidence/application", { recursive: true });
  await page
    .screenshot({
      path: "readiness/evidence/application/controls-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
