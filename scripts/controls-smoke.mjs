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
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
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
  // One implementation: the menu verb reaches CodeMirror's own panel, so there
  // is no app-level prompt dialog to fill.
  await visible(".cm-panels .cm-goto-line");
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
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
  // A table node expands into the schema it already carries.
  const customers = page.locator('[role="treeitem"][data-table="customers"]');
  await customers.click();
  assert.equal(await customers.getAttribute("aria-expanded"), "true");
  const branch = (name) =>
    page.locator('[role="treeitem"][aria-level="4"]', { hasText: name });
  await branch("Columns").click();
  assert.equal(
    await page
      .locator('[role="treeitem"][aria-level="5"]', {
        hasText: "customer_id BIGINT NOT NULL",
      })
      .count(),
    1,
    "an expanded table lists its typed columns",
  );
  // Scoped: the top-level Views/Macros/Indexes branches print the same words,
  // so the assertion must prove this table's own empty group rendered.
  const indexes = branch("Indexes");
  await indexes.click();
  assert.equal(await indexes.getAttribute("aria-expanded"), "true");
  const emptyGroup = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll(
        '.explorer [role="treeitem"], .explorer .tree-empty',
      ),
    );
    const start = rows.findIndex(
      (row) =>
        row.getAttribute("aria-level") === "4" &&
        row.textContent.includes("Indexes"),
    );
    return start >= 0 && rows[start + 1]?.className === "tree-empty"
      ? rows[start + 1].textContent.trim()
      : null;
  });
  assert.equal(
    emptyGroup,
    "No objects",
    "an expanded table's empty Indexes group says No objects",
  );
  await customers.click();
  assert.equal(await customers.getAttribute("aria-expanded"), "false");
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
  await page.getByRole("tab", { name: "imported.sql", exact: true }).click();
  await ready();
  for (const [command, label] of [
    ["Results", "Results"],
    ["Messages", "Messages"],
    ["Execution Plan", "Execution plan"],
    ["Patchouli’s Notes", "Patchouli’s notes"],
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
    .getByRole("button", {
      name: /Switch to the accessible table/,
      exact: true,
    })
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
  await page
    .getByRole("button", { name: /Switch to the virtual grid/ })
    .click();
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
  // Fit must scale past the old 1.5x ceiling, which is the whole bug. Both of
  // the pane's axes have to exceed the canvas for the ceiling to bind at all:
  // in an ordinary window the map pane is smaller than the graph and Fit
  // correctly scales down, so an assertion there would pass with the cap
  // restored. Hence a tall viewport.
  await page.getByLabel("Map zoom", { exact: true }).selectOption("fit");
  await page.setViewportSize({ width: 2200, height: 2600 });
  // The pane measures itself through a ResizeObserver, so wait for the pane
  // itself to reach its new size — a condition independent of whatever scale
  // Fit then chooses, so restoring the cap fails the assertion below rather
  // than hanging here.
  await page.waitForFunction(
    () => {
      const pane = document.querySelector(".scaled-canvas")?.parentElement;
      return !!pane && pane.getBoundingClientRect().width > 1400;
    },
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(250);
  const fitted = await page.evaluate(() => {
    const canvas = document.querySelector(".scaled-canvas");
    const inner = canvas?.querySelector(".canvas");
    const viewport = canvas?.parentElement;
    if (!canvas || !inner || !viewport) return null;
    const c = canvas.getBoundingClientRect(),
      v = viewport.getBoundingClientRect();
    const naturalWidth = parseFloat(inner.style.width),
      naturalHeight = parseFloat(inner.style.height);
    return {
      // The inner canvas carries its unscaled pixel size as a style, so the
      // ratio of the two is the applied scale.
      scale: c.width / naturalWidth,
      // What an uncapped fit would choose for this pane.
      available: Math.min(v.width / naturalWidth, v.height / naturalHeight),
      contained: c.height <= v.height + 1 && c.width <= v.width + 1,
    };
  });
  assert.ok(
    fitted && fitted.available > 1.6,
    `this viewport must be able to exceed the former ceiling, or the assertion below proves nothing: ${JSON.stringify(fitted)}`,
  );
  assert.ok(
    fitted.scale > 1.6,
    `Fit must scale past the former 1.5x ceiling: ${JSON.stringify(fitted)}`,
  );
  assert.ok(
    fitted.scale <= 3.01,
    `Fit stays bounded so labels do not become cartoonish: ${JSON.stringify(fitted)}`,
  );
  assert.ok(
    fitted.contained,
    `Fit must not overflow its pane: ${JSON.stringify(fitted)}`,
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  // A manual step above the old 150% ceiling must be selectable and applied.
  await page.getByLabel("Map zoom", { exact: true }).selectOption("300");
  assert.ok(
    await page.evaluate(() => {
      const canvas = document.querySelector(".scaled-canvas");
      const viewport = canvas?.parentElement;
      return !!canvas && !!viewport
        ? canvas.getBoundingClientRect().width >
            viewport.getBoundingClientRect().width
        : false;
    }),
    "300% must scale the canvas past its pane",
  );
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
  await menu("View", "Patchouli");
  await visible("#judge-window");
  await page.getByRole("button", { name: "Hush", exact: true }).click();
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
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
  await menu("Window", "Move Patchouli");
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
  await page
    .getByRole("button", { name: "Dock Patchouli", exact: true })
    .click();
  await visible("#judge-docked");
  await page
    .getByRole("button", { name: "Float Patchouli", exact: true })
    .click();
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
  await menu("Window", "Reset Patchouli Position and Size");
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
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
  // The practice loop is edit, run, submit, and Submit was the only step with
  // no key. Assert the mappings reach the same commands the menus use, and
  // that the generated Shortcuts dialog documents them.
  await menu("Help", "Keyboard Shortcuts");
  await visible("dialog");
  const documented = await page.locator("dialog").textContent();
  for (const [key, label] of [
    ["Ctrl+Shift+Enter", "Submit"],
    ["F7", "Parse"],
    ["Ctrl+Shift+H", "Hint"],
    ["F8", "Open Next Challenge"],
  ])
    assert.ok(
      documented.includes(key),
      `Keyboard Shortcuts must document ${key} for ${label}`,
    );
  await close();
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText("SELCT 1 AS broken;");
  await page.keyboard.press("F7");
  await page.waitForFunction(
    () =>
      /[Ss]yntax/.test(
        document.querySelector(".parser-info")?.textContent ?? "",
      ),
    null,
    { timeout: 45000 },
  );
  // Parse checks without running: a rejected statement produces no result.
  assert.equal(await page.locator(".grid-row").count(), 0);
  const hintsBefore = await page.locator(".goal").innerText();
  await page.keyboard.press("ControlOrMeta+Shift+H");
  await page.waitForFunction(
    (before) => document.querySelector(".goal")?.innerText !== before,
    hintsBefore,
    { timeout: 45000 },
  );
  assert.match(await page.locator(".goal").innerText(), /1 of 3/);
  await close();
  mark(
    "Parse and Hint carry keys; the dialog documents all four practice-loop keys",
  );
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
    .getByRole("button", { name: "Practice Records", exact: true })
    .click();
  await visible("dialog");
  assert.equal(
    await page.locator("dialog .library-list article").count(),
    0,
    "Execute must not invent ranked attempts",
  );
  await close();
  mark("Storage, help, credits, external documentation link and local records");
  await page
    .getByRole("button", { name: "Minimize Workbench", exact: true })
    .click();
  assert.equal(await page.locator(".ide").count(), 0);
  await page.locator("#app-task").click();
  await visible(".ide");
  await page
    .getByRole("button", { name: "Maximize or restore Workbench", exact: true })
    .click();
  assert.equal(await page.locator(".ide.maximized").count(), 1);
  await page
    .getByRole("button", { name: "Maximize or restore Workbench", exact: true })
    .click();
  await page.getByRole("button", { name: "Show desktop", exact: true }).click();
  assert.equal(await page.locator(".ide").count(), 0);
  await page.getByRole("button", { name: "Show desktop", exact: true }).click();
  await visible(".ide");
  await page
    .getByRole("button", { name: "Close Workbench", exact: true })
    .click();
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
  // Grouped menus, Alt mnemonics, and a Window menu that lists every open tab.
  for (const group of [
    "File",
    "Edit",
    "View",
    "Query",
    "Skills",
    "Tools",
    "Window",
    "Help",
  ]) {
    await page.getByRole("menuitem", { name: group, exact: true }).click();
    assert.ok(
      (await page.locator('.menu-popup [role="separator"]').count()) > 0,
      `${group} groups its items with separators`,
    );
    await page.keyboard.press("Escape");
  }
  assert.equal(
    await page.locator(".menubar > div > button > u").count(),
    8,
    "every menu title exposes a mnemonic letter",
  );
  await page.keyboard.press("Alt+f");
  await visible(".menu-popup");
  assert.equal(
    await page.evaluate(() =>
      document.querySelector(".menu-popup")?.getAttribute("aria-label"),
    ),
    "File",
  );
  assert.equal(
    await page.evaluate(() =>
      document.querySelector(".menu-popup")?.contains(document.activeElement),
    ),
    true,
    "Alt+F opens File and focuses its first enabled item",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  const windowEntries = await page
    .locator('.menu-popup [role="menuitemradio"]')
    .allTextContents();
  assert.ok(
    windowEntries.some((entry) => entry.includes("Skill Map.dag")) &&
      windowEntries.some((entry) => entry.includes("schema.ref")),
    `Window lists the view tabs: ${windowEntries.join(" | ")}`,
  );
  assert.match(windowEntries[0], /^1/, "open tabs are numbered from one");
  assert.equal(
    await page
      .locator('.menu-popup [role="menuitemradio"][aria-checked="true"]')
      .count(),
    1,
    "exactly one Window entry is marked active",
  );
  assert.equal(
    await page
      .locator(".menu-popup")
      .getByRole("menuitem", { name: "Maximize Workbench", exact: true })
      .count(),
    1,
    "the maximize item names the action it performs",
  );
  // The command key is stable; only the label flips, so activating it must
  // change the wording rather than leave both verbs on screen.
  await page
    .locator(".menu-popup")
    .getByRole("menuitem", { name: "Maximize Workbench", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  assert.equal(
    await page
      .locator(".menu-popup")
      .getByRole("menuitem", { name: "Restore Workbench", exact: true })
      .count(),
    1,
  );
  await page
    .locator(".menu-popup")
    .getByRole("menuitem", { name: "Restore Workbench", exact: true })
    .click();
  // Close All Documents is scoped to SQL documents: the view tabs survive.
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page
    .locator(".menu-popup")
    .getByRole("menuitem", { name: "Close All Documents", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector('.document-tabs [data-context="query-tab"]') &&
      document.querySelector('.document-tabs [data-view="map"]'),
  );
  // Later checks assume an active document, so restore one immediately.
  await menu("File", "New Query");
  await page.waitForFunction(() =>
    document.querySelector('.document-tabs [data-context="query-tab"]'),
  );
  mark("Menu separators, Alt mnemonics and the Window tab list");
  await page.getByRole("menuitem", { name: "File", exact: true }).focus();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "menu-File",
    "arrow navigation starts from the focused File title",
  );
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
  // The desktop keeps a 1100px minimum, and Reading Layout below it is the
  // documented answer (product.md:283). Checked here, with the setting still
  // off, so the switch is genuinely automatic; the suite previously verified
  // only 320px and left the range in between unexamined.
  for (const [width, reading] of [
    [1100, false],
    [1099, true],
    [900, true],
    [700, true],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(
      (expected) => !!document.querySelector(".desktop.reading") === expected,
      reading,
      { timeout: 10000 },
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${width}px must not scroll horizontally`,
    );
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForFunction(() => !document.querySelector(".desktop.reading"));
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
  // Captured here, in the state the filename names: 320 pixels wide with
  // Reading Layout applied. Later blocks widen the viewport and open the
  // diagram, so a capture at the end of the suite would not be a reading
  // layout at all.
  await mkdir("readiness/evidence/application", { recursive: true });
  await page.screenshot({
    path: "readiness/evidence/application/reading-layout.png",
    fullPage: true,
  });
  mark("Menu keyboard, F6 regions, 320px reading layout and dialog reflow");
  // Practice Records showed a raw log of data it already had. Seed attempts
  // with known values and assert the arithmetic exactly, including that an
  // Execute run is not counted as a submission. Seeded last: these rows must
  // not perturb the progression assertions above.
  await page.setViewportSize({ width: 1400, height: 1000 });
  await menu("View", "Reading Layout");
  const seeded = await page.evaluate(async () => {
    const { openPracticeStore } = await import("/src/lib/storage.ts");
    const { ChallengeCatalog } = await import("/src/lib/challenges.ts");
    const catalog = await ChallengeCatalog.load();
    const first = await catalog.load("basics.01");
    const second = await catalog.load("basics.02");
    const store = await openPracticeStore(
      () => {},
      () => {},
    );
    const day = 86_400_000;
    const now = Date.now();
    const rows = [
      // basics.01: failed, then passed with hints revealed.
      {
        id: "summary-1",
        challenge: first.identity,
        correctness: "incorrect",
        hintLevel: 0,
        elapsedMs: 10,
        createdAt: now - day,
      },
      {
        id: "summary-2",
        challenge: first.identity,
        correctness: "correct",
        hintLevel: 2,
        elapsedMs: 6,
        createdAt: now - day + 1000,
      },
      // basics.02: passed on the first graded attempt, unassisted.
      {
        id: "summary-3",
        challenge: second.identity,
        correctness: "correct",
        hintLevel: 0,
        elapsedMs: 2,
        createdAt: now,
      },
      // An Execute run, which is not a submission.
      {
        id: "summary-4",
        challenge: second.identity,
        correctness: "not-evaluated",
        hintLevel: 0,
        elapsedMs: 999,
        createdAt: now,
      },
    ];
    for (const row of rows)
      await store.recordAttempt({
        documentId: "summary-doc",
        revision: 1,
        sql: "SELECT 1",
        datasetId: first.dataset.id,
        outcome: "complete",
        message: "seeded for the records summary",
        ...row,
      });
    store.close();
    return rows.length;
  });
  assert.equal(seeded, 4);
  await page.reload();
  await ready();
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Practice Records", exact: true })
    .click();
  await page.locator("dialog .status-card").first().waitFor();
  const summary = await page.evaluate(() =>
    [...document.querySelectorAll("dialog .status-card")].map((card) =>
      [...card.children].map((node) =>
        node.textContent.trim().replace(/\s+/g, " "),
      ),
    ),
  );
  assert.deepEqual(
    summary[0],
    [
      "Graded submissions",
      "3 across 2 challenges",
      "Correct",
      "2 · 67%",
      "Correct without a hint",
      "1 of 2",
      "Correct on the first graded attempt",
      "1 of 2 challenges",
      "Median engine time, correct attempts",
      "4.0 ms",
      "Days practiced",
      "2 days · 2 days in a row",
    ],
    `records summary must aggregate stored attempts exactly: ${JSON.stringify(summary)}`,
  );
  assert.deepEqual(summary[1], ["SQL basics", "2/3 correct · 67%"]);
  await close();
  mark("Practice Records aggregates stored attempts and excludes Execute runs");
  // The relationship diagram had no coverage at all, which is how its edges
  // could have stopped painting unnoticed: the SVG is aria-hidden, so no
  // accessibility assertion touches it. Assert the pixels.
  await page.locator(".tree-row").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "View Diagram" }).click();
  await page.locator(".table-node").first().waitFor();
  const diagram = await page.evaluate(() => {
    const stroke = (node) => (node ? getComputedStyle(node).stroke : "missing");
    return {
      lineStroke: stroke(document.querySelector(".erd-edge-line")),
      headFill: document.querySelector(".edge-head")
        ? getComputedStyle(document.querySelector(".edge-head")).fill
        : "missing",
      labels: [...document.querySelectorAll(".edge-label")].map((n) =>
        n.textContent.trim(),
      ),
      foreignKeys: [...document.querySelectorAll(".node-fk")].map((n) =>
        n.textContent.trim(),
      ),
      nodes: document.querySelectorAll(".table-node").length,
    };
  });
  // A colour that failed to resolve renders as none or fully transparent, which
  // is exactly what a var() in an SVG presentation attribute produces.
  for (const [name, value] of [
    ["edge stroke", diagram.lineStroke],
    ["arrowhead fill", diagram.headFill],
  ]) {
    assert.ok(
      /^rgb/.test(value),
      `${name} must resolve to a colour, got ${value}`,
    );
    assert.ok(
      !/rgba\(0, 0, 0, 0\)/.test(value),
      `${name} must not be transparent`,
    );
  }
  assert.ok(diagram.labels.length >= 7, "every reference must carry a label");
  for (const label of diagram.labels)
    assert.match(
      label,
      /^[a-z_]+ [1N]:1$/,
      "each edge names its foreign-key column and its cardinality",
    );
  assert.equal(
    diagram.foreignKeys.length,
    diagram.nodes,
    "every table box states its foreign keys",
  );
  assert.ok(
    diagram.foreignKeys.some((text) => /^FK \w/.test(text)),
    `at least one box names a real foreign key: ${JSON.stringify(diagram.foreignKeys)}`,
  );
  mark("Relationship diagram paints edges, cardinality and foreign keys");
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
