import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const checks = [];
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const mark = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function menu(group, item) {
  await page.getByRole("menuitem", { name: group, exact: true }).click();
  await page
    .getByRole("menuitem", { name: item, exact: true })
    .or(page.getByRole("menuitemcheckbox", { name: item, exact: true }))
    .click();
}
async function drag(selector, dx, dy) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box);
  const x = box.x + Math.min(35, box.width / 2),
    y = box.y + Math.min(12, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}
try {
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:4173");
  await page.waitForFunction(
    () =>
      document.querySelector(".toolbar .execute") &&
      !document.querySelector(".toolbar .execute").disabled,
    null,
    { timeout: 45000 },
  );
  let rect = await page.locator("#judge-window").boundingBox();
  await drag("#judge-window .judge-title", -350, -400);
  let moved = await page.locator("#judge-window").boundingBox();
  assert.ok(Math.abs(moved.x - (rect.x - 350)) < 2);
  assert.ok(Math.abs(moved.y - (rect.y - 400)) < 2);
  rect = moved;
  await drag("#judge-window .judge-title", 70, 80);
  moved = await page.locator("#judge-window").boundingBox();
  assert.ok(Math.abs(moved.x - (rect.x + 70)) < 2);
  assert.ok(Math.abs(moved.y - (rect.y + 80)) < 2);
  assert.equal(await page.evaluate(() => getSelection().toString()), "");
  assert.equal(await page.locator("body.pointer-dragging").count(), 0);
  mark(
    "Repeated judge drags preserve pointer offset without jumping or selecting text",
  );
  // Drag-resize grip: growing to 1.5× keeps the top-left corner fixed, and the
  // move clamps use the scaled window, not 360×210.
  {
    const size = page.viewportSize();
    await page.setViewportSize({ width: 1920, height: 1080 });
    const before = await page.locator("#judge-window").boundingBox();
    const grip = await page
      .locator("#judge-window .judge-resize")
      .boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2 + before.width / 2,
      grip.y + grip.height / 2 + before.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    const scaled = await page.locator("#judge-window").boundingBox();
    assert.equal(Math.round(scaled.width), 540, "grip drag reaches 1.5×");
    assert.ok(Math.abs(scaled.x - before.x) < 2, "top-left stays anchored");
    assert.ok(Math.abs(scaled.y - before.y) < 2, "top-left stays anchored");
    await page.locator("#judge-window .judge-resize").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .locator("#judge-window .judge-resize")
        .getAttribute("aria-valuenow"),
      "140",
      "arrow keys step the size",
    );
    await page.keyboard.press("ArrowUp");
    await drag("#judge-window .judge-title", 3000, 3000);
    const corner = await page.locator("#judge-window").boundingBox();
    assert.equal(Math.round(corner.x + corner.width), 1920, "right clamp");
    assert.equal(
      Math.round(corner.y + corner.height),
      1080 - 32,
      "bottom clamp above the taskbar",
    );
    await drag("#judge-window .judge-title", -3000, -3000);
    await page.setViewportSize(size);
    moved = await page.locator("#judge-window").boundingBox();
  }
  mark(
    "Judge grip resizes by pointer and keyboard; scaled drags clamp to the viewport edges",
  );
  // Window drags land exactly where the pointer goes, and the desktop fits the
  // viewport without scrollbars. The application has no zoom of its own; native
  // browser zoom is covered by scripts/zoom-smoke.mjs.
  {
    // Park the judge in the corner so it does not cover the menu bar.
    await drag("#judge-window .judge-title", 3000, 3000);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= window.innerHeight &&
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      "the desktop does not overflow the viewport",
    );
    const before = await page.locator("#judge-window").boundingBox();
    await drag("#judge-window .judge-title", -120, -80);
    const after = await page.locator("#judge-window").boundingBox();
    assert.ok(Math.abs(after.x - (before.x - 120)) < 2, "drag x");
    assert.ok(Math.abs(after.y - (before.y - 80)) < 2, "drag y");
    await drag("#judge-window .judge-title", 120, 80);
    // Context menus are appended to <body>; they must open under the pointer.
    const editorBox = await page.locator(".cm-content").boundingBox();
    await page.mouse.click(editorBox.x + 40, editorBox.y + 20, {
      button: "right",
    });
    const contextBox = await page.locator('[role="menu"]').last().boundingBox();
    assert.ok(Math.abs(contextBox.x - (editorBox.x + 40)) < 3, "context x");
    assert.ok(Math.abs(contextBox.y - (editorBox.y + 20)) < 3, "context y");
    await page.keyboard.press("Escape");
    // Judge docking and goal floating are independent: the docked judge rides
    // in the goal panel wherever it lives, and floating or docking one never
    // silently toggles the other.
    await menu("Window", "Dock / Float Patchouli");
    assert.equal(await page.locator("#judge-docked").count(), 1);
    const documentArea = await page.locator(".document-area").boundingBox();
    await menu("Window", "Dock / Float Goal");
    const goal = await page.locator("#goal-window").boundingBox();
    assert.ok(goal, "goal pops out as a floating window");
    assert.equal(await page.locator("#goal-panel").count(), 0);
    assert.equal(
      await page.locator("#goal-window #judge-docked").count(),
      1,
      "the docked judge follows the goal panel out",
    );
    const widerArea = await page.locator(".document-area").boundingBox();
    assert.ok(
      widerArea.width > documentArea.width + 200,
      "the grid releases the goal column when the panel floats",
    );
    // Float the judge back out: the goal must stay floating, so its header
    // button keeps offering Dock, not Pop out.
    await page
      .getByRole("button", { name: "Float Patchouli", exact: true })
      .click();
    assert.equal(await page.locator("#judge-window").count(), 1);
    assert.equal(
      await page.locator("#goal-window").count(),
      1,
      "docking the judge back out leaves the goal floating",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Dock Goal panel", exact: true })
        .count(),
      1,
      "the floating goal still offers Dock, not Pop out",
    );
    await page
      .getByRole("button", { name: "Show desktop", exact: true })
      .click();
    assert.equal(
      await page.locator("#goal-window").count(),
      0,
      "Show Desktop hides the floating goal",
    );
    await page
      .getByRole("button", { name: "Show desktop", exact: true })
      .click();
    assert.equal(await page.locator("#goal-window").count(), 1);
    await drag("#goal-window .goal-title", -200, 100);
    const movedGoal = await page.locator("#goal-window").boundingBox();
    assert.ok(Math.abs(movedGoal.x - (goal.x - 200)) < 2, "goal drag x");
    assert.ok(Math.abs(movedGoal.y - (goal.y + 100)) < 2, "goal drag y");
    const grip = await page.locator("#goal-window .goal-resize").boundingBox();
    await page.mouse.move(grip.x + 7, grip.y + 7);
    await page.mouse.down();
    await page.mouse.move(grip.x + 107, grip.y + 57, { steps: 8 });
    await page.mouse.up();
    const resized = await page.locator("#goal-window").boundingBox();
    assert.ok(
      Math.abs(resized.width - movedGoal.width - 100) < 2,
      "goal grip w",
    );
    assert.ok(
      Math.abs(resized.height - movedGoal.height - 50) < 2,
      "goal grip h",
    );
    await page
      .getByRole("button", { name: "Dock Goal panel", exact: true })
      .click();
    assert.equal(await page.locator("#goal-panel").count(), 1, "goal docks");
    // The grip changed the shared goal width; put it back for later checks.
    await page
      .getByRole("slider", { name: "Goal panel width", exact: true })
      .fill("280");
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).zoom),
      "1",
      "the application never applies a zoom of its own",
    );
    moved = await page.locator("#judge-window").boundingBox();
  }
  mark(
    "Window drags are pointer-accurate with no application zoom; the Goal panel pops out, moves, resizes, and docks",
  );
  // Below the 1100-pixel desktop minimum the IDE must reflow into Reading
  // Layout rather than scroll the page sideways. Saved floating geometry and
  // judge zoom stay on disk and return when the window widens again.
  {
    const desktop = page.viewportSize();
    await page.locator("#judge-window .judge-resize").waitFor();
    const grip = await page
      .locator("#judge-window .judge-resize")
      .boundingBox();
    await page.mouse.move(grip.x + 7, grip.y + 7);
    await page.mouse.down();
    await page.mouse.move(grip.x + 500, grip.y + 300, { steps: 10 });
    await page.mouse.up();
    const zoomedJudge = await page.locator("#judge-window").boundingBox();
    assert.ok(zoomedJudge.width > 400, "the judge is scaled above 1×");
    await menu("Window", "Dock / Float Goal");
    assert.equal(await page.locator("#goal-window").count(), 1);
    const floatedGoal = await page.locator("#goal-window").boundingBox();
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
    for (const width of [1099, 720, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(
        () => !!document.querySelector(".desktop.reading"),
      );
      assert.ok(
        (await fits()) <= 1,
        `no horizontal page overflow at ${width} pixels`,
      );
      assert.equal(
        await page.locator("#goal-window").count(),
        0,
        `the floated goal rejoins document flow at ${width} pixels`,
      );
      assert.equal(
        await page.locator("#goal-panel").count(),
        1,
        `the goal stays visible in flow at ${width} pixels`,
      );
      assert.equal(
        await page.locator("#judge-window .judge-resize").count(),
        0,
        `the judge grip is withdrawn at ${width} pixels`,
      );
      assert.equal(
        await page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector("#judge-window"),
            ).getPropertyValue("--judge-zoom") || "1",
        ),
        "1",
        `the judge renders at 1× in Reading Layout at ${width} pixels`,
      );
      assert.equal(
        await page
          .getByRole("menuitemcheckbox", {
            name: "Reading Layout",
            exact: true,
          })
          .count(),
        0,
        "the menu is closed between resizes",
      );
    }
    // Narrow interaction: edit and execute SQL, open a dialog, read results.
    await page.setViewportSize({ width: 720, height: 900 });
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("SELECT 5::BIGINT AS narrow");
    await page.getByRole("button", { name: "Execute", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector(".toolbar .execute").disabled,
      null,
      { timeout: 60000 },
    );
    assert.match(
      await page.locator(".result-tools span").first().textContent(),
      /1 row · 1 column/,
    );
    await menu("Help", "Keyboard Shortcuts");
    assert.ok(
      (await fits()) <= 1,
      "a dialog at 720 pixels adds no horizontal page overflow",
    );
    await page.keyboard.press("Escape");
    await menu("Skills", "Skill Map");
    await page
      .getByRole("list", { name: "Skills in prerequisite order" })
      .waitFor();
    assert.ok(
      (await fits()) <= 1,
      "the linear skill list at 720 pixels adds no horizontal page overflow",
    );
    await page
      .getByRole("tab", { name: /\.sql(?: \*)?$/ })
      .first()
      .click();
    // Widening restores the desktop and the saved floating presentation.
    await page.setViewportSize(desktop);
    await page.waitForFunction(
      () => !document.querySelector(".desktop.reading"),
    );
    const restoredGoal = await page.locator("#goal-window").boundingBox();
    assert.ok(
      Math.abs(restoredGoal.x - floatedGoal.x) < 2 &&
        Math.abs(restoredGoal.y - floatedGoal.y) < 2 &&
        Math.abs(restoredGoal.width - floatedGoal.width) < 2,
      "the floated goal returns to its saved position and size",
    );
    const restoredJudge = await page.locator("#judge-window").boundingBox();
    assert.ok(
      Math.abs(restoredJudge.width - zoomedJudge.width) < 2,
      "the judge returns to its saved zoom",
    );
    // The explicit preference is independent of the automatic reflow.
    await menu("View", "Reading Layout");
    assert.equal(await page.locator(".desktop.reading").count(), 1);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.setViewportSize(desktop);
    assert.equal(
      await page.locator(".desktop.reading").count(),
      1,
      "resizing never clears the explicit Reading Layout preference",
    );
    await menu("View", "Reading Layout");
    assert.equal(await page.locator(".desktop.reading").count(), 0);
    await page
      .getByRole("button", { name: "Dock Goal panel", exact: true })
      .click();
    await page
      .getByRole("slider", { name: "Goal panel width", exact: true })
      .fill("280");
    await page.locator("#judge-window .judge-resize").waitFor();
    const reset = await page
      .locator("#judge-window .judge-resize")
      .boundingBox();
    await page.mouse.move(reset.x + 7, reset.y + 7);
    await page.mouse.down();
    await page.mouse.move(reset.x - 500, reset.y - 300, { steps: 10 });
    await page.mouse.up();
  }
  mark(
    "Narrow windows reflow into Reading Layout without horizontal page overflow, and widening restores saved floating geometry",
  );
  moved = await page.locator("#judge-window").boundingBox();
  await drag("#judge-window .judge-title", 4 - moved.x, 4 - moved.y);
  const parkedJudge = await page.locator("#judge-window").boundingBox();
  await page.locator(".cm-content").focus();
  assert.deepEqual(
    await page.locator("#judge-window").boundingBox(),
    parkedJudge,
  );
  assert.equal(
    await page.evaluate(
      () => !!document.elementFromPoint(160, 57)?.closest("#judge-window"),
    ),
    true,
  );
  await page.screenshot({
    path: "readiness/evidence/application/judge-layering.png",
  });
  mark(
    "Editor focus leaves Patchouli stationary; her text paints above the IDE menus",
  );
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  const originalIde = await page.locator(".ide").boundingBox();
  await drag(".ide-title", -40, 35);
  const movedIde = await page.locator(".ide").boundingBox();
  assert.equal(Math.round(movedIde.x), Math.round(originalIde.x - 40));
  assert.equal(Math.round(movedIde.y), Math.round(originalIde.y + 35));
  assert.equal(await page.evaluate(() => getSelection().toString()), "");
  await page
    .getByRole("button", { name: "Maximize or restore Workbench" })
    .click();
  assert.equal((await page.locator(".ide").boundingBox()).x, 0);
  await page
    .getByRole("button", { name: "Maximize or restore Workbench" })
    .click();
  assert.deepEqual(await page.locator(".ide").boundingBox(), movedIde);
  await page.mouse.move(0, 0);
  const chrome = await page
    .locator(".ide-title .window-controls button")
    .evaluateAll((elements) =>
      elements.map((e) => ({
        width: e.offsetWidth,
        height: e.offsetHeight,
        color: getComputedStyle(e).color,
        background: getComputedStyle(e).backgroundColor,
      })),
    );
  assert.equal(chrome.length, 3);
  assert.deepEqual(chrome[0], chrome[1]);
  assert.deepEqual(chrome[1], chrome[2]);
  assert.equal(chrome[1].width, 24);
  const selectedTable = page.locator(".tree-row.selected").first();
  await selectedTable.hover();
  assert.equal(
    await selectedTable.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(10, 36, 106)",
  );
  assert.equal(
    await selectedTable.evaluate((e) => getComputedStyle(e).color),
    "rgb(255, 255, 255)",
  );
  mark(
    "Main window drags and restores its position; controls match; selected explorer hover retains contrast",
  );
  // Every enabled button looks clickable. A resize handle is the one honest
  // exception: it names itself Resize and shows a resize cursor instead.
  const wrongCursors = await page
    .locator("button:enabled")
    .evaluateAll((elements) =>
      elements
        .filter((e) => {
          const cursor = getComputedStyle(e).cursor;
          if (!e.getBoundingClientRect().width || cursor === "pointer")
            return false;
          return !(
            /^Resize /.test(e.getAttribute("aria-label") ?? "") &&
            /-resize$/.test(cursor)
          );
        })
        .map((e) => ({
          text: e.textContent,
          cursor: getComputedStyle(e).cursor,
        })),
    );
  assert.deepEqual(wrongCursors, []);
  const editorStyle = await page.locator(".cm-content").evaluate((e) => ({
    color: getComputedStyle(e).color,
    font: getComputedStyle(e).fontFamily,
  }));
  assert.equal(editorStyle.color, "rgb(17, 17, 17)");
  assert.match(editorStyle.font, /DejaVu Sans Mono/);
  mark(
    "Enabled buttons use pointer cursors; editor uses dark text and a stronger monospace face",
  );
  await drag('[aria-label="Object Explorer width"]', 60, 0);
  await drag('[aria-label="Goal panel width"]', -40, 0);
  assert.equal(
    Math.round((await page.locator(".explorer").boundingBox()).width),
    280,
  );
  assert.equal(
    Math.round((await page.locator(".goal").boundingBox()).width),
    320,
  );
  await page
    .getByRole("slider", { name: "Object Explorer width", exact: true })
    .press("ArrowRight");
  assert.equal(
    Math.round((await page.locator(".explorer").boundingBox()).width),
    290,
  );
  await menu("File", "Close Window");
  await page.locator(".ide").waitFor({ state: "hidden" });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector(".toolbar .execute") &&
      !document.querySelector(".toolbar .execute").disabled,
    null,
    { timeout: 45000 },
  );
  assert.equal(
    Math.round((await page.locator(".explorer").boundingBox()).width),
    290,
  );
  assert.equal(
    Math.round((await page.locator(".goal").boundingBox()).width),
    320,
  );
  await menu("View", "Reset Layout");
  assert.equal(
    Math.round((await page.locator(".explorer").boundingBox()).width),
    220,
  );
  assert.equal(
    Math.round((await page.locator(".goal").boundingBox()).width),
    280,
  );
  mark(
    "Both sidebars resize by pointer and keyboard, survive reload, and reset to defaults",
  );
  await menu("File", "New Query");
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("SELECT 222 AS retained;");
  await page
    .getByRole("tab", { name: /basics\.01\.sql/ })
    .click({ button: "middle" });
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.document-tabs [role="tab"]')].some((e) =>
        e.textContent.includes("basics.01.sql"),
      ),
  );
  assert.match(await page.locator(".cm-content").innerText(), /222/);
  await page
    .getByRole("tab", { name: /untitled.sql/ })
    .click({ button: "middle" });
  await page.getByText("No open SQL document", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Skill Map.dag", exact: true }).click();
  await page
    .getByRole("tab", { name: "Skill Map.dag", exact: true })
    .click({ button: "middle" });
  assert.equal(
    await page.getByRole("tab", { name: "Skill Map.dag", exact: true }).count(),
    0,
  );
  await page
    .getByRole("tab", { name: "schema.ref", exact: true })
    .click({ button: "middle" });
  assert.equal(await page.locator('.document-tabs [role="tab"]').count(), 0);
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "Skill Map", exact: true })
    .click();
  await page.getByRole("tab", { name: "Skill Map.dag", exact: true }).waitFor();
  await menu("File", "New Query");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page
    .getByText("How to trigger Patchouli’s notes", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open example in a new tab", exact: true })
    .click();
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".diagnostic").length >= 2,
  );
  const notes = await page.locator(".diagnostic").allTextContents();
  assert.ok(notes.some((note) => note.includes("J001")));
  assert.ok(notes.some((note) => note.includes("J002")));
  await page.locator(".diagnostic").first().click();
  assert.equal(
    await page
      .locator(".cm-content")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  mark(
    "Middle click closes active and inactive SQL/map/schema tabs; special tabs reopen normally",
  );
  mark(
    "Notes help opens a separate example; Parse produces real J001/J002 notes and source navigation",
  );
  // A syntax error was reported in four places and marked in none of them.
  // The line itself must carry the report: a gutter marker on the failing
  // line, and an underline covering the token the parser rejected rather than
  // its first character.
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText("SELCT 1 AS x FROM customers;");
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-lint-marker").length > 0,
    null,
    { timeout: 45000 },
  );
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll(".cm-lintRange-error")].map(
        (node) => node.textContent,
      ),
    ),
    ["SELCT"],
    "the rejected token must be underlined, not just its first character",
  );
  mark("A syntax error marks its own line in the gutter and under the token");
  // Column names are what a learner forgets and what the grader is strict
  // about, yet a bare prefix completed nothing: lang-sql offers columns only
  // for a qualified prefix or a single default table. The tables named in the
  // statement being written must contribute their columns, ranked above the
  // dialect keywords that share those prefixes.
  async function completionsAt(head, tail) {
    await page.locator(".cm-content").press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.insertText(head + tail);
    for (let index = 0; index < tail.length; index++)
      await page.keyboard.press("ArrowLeft");
    // One real keystroke opens the completion at the caret.
    await page.keyboard.press("Backspace");
    await page.keyboard.type(head.slice(-1));
    await page.waitForTimeout(600);
    const options = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-tooltip-autocomplete li")].map(
        (node) => ({
          label: node.querySelector(".cm-completionLabel")?.textContent ?? "",
          detail: node.querySelector(".cm-completionDetail")?.textContent ?? "",
        }),
      ),
    );
    await page.keyboard.press("Escape");
    return options;
  }
  const whereColumns = await completionsAt(
    "SELECT * FROM customers WHERE customer_",
    "",
  );
  assert.deepEqual(
    whereColumns.map((option) => option.label),
    ["customer_id", "customer_name"],
    "a bare column prefix must complete the columns of the table in scope",
  );
  assert.equal(whereColumns[0].detail, "customers");
  // A column of a joined table is offered once, naming every table that has
  // it, so an ambiguous reference is visible before the engine rejects it.
  const joined = await completionsAt(
    "SELECT customer_",
    " FROM orders JOIN customers ON orders.customer_id = customers.customer_id",
  );
  assert.equal(joined[0].label, "customer_id");
  assert.equal(joined[0].detail, "orders, customers");
  // Columns rank above the keywords sharing the prefix, and scope is the
  // statement: a table named in a different statement contributes nothing.
  const sameStatement = await completionsAt("SELECT order", " FROM orders");
  assert.deepEqual(
    sameStatement.slice(0, 2).map((option) => option.label),
    ["order_id", "ordered_at"],
  );
  const otherStatement = await completionsAt(
    "SELECT 1 FROM orders; SELECT order",
    " FROM customers",
  );
  assert.equal(
    otherStatement.some((option) => option.detail === "orders"),
    false,
    "a table named in another statement must not contribute its columns",
  );
  mark("Columns of the tables in scope complete from a bare prefix");

  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText("SELECT 42 AS answer;");
  await page.locator(".toolbar .execute").click();
  await page.locator(".grid-row").first().waitFor({ timeout: 45000 });
  const resultStyle = await page
    .locator(".grid-row > div")
    .last()
    .evaluate((e) => ({
      font: getComputedStyle(e).fontFamily,
      color: getComputedStyle(e).color,
      selected: e.classList.contains("selected"),
    }));
  assert.match(resultStyle.font, /DejaVu Sans Mono/);
  assert.equal(
    resultStyle.color,
    resultStyle.selected ? "rgb(255, 255, 255)" : "rgb(17, 17, 17)",
  );
  mark(
    "Real result cells use the darker monospace typography with readable selection",
  );
  await page.screenshot({
    path: "readiness/evidence/application/interaction-updates.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "readiness/evidence/application/interaction-smoke.json",
    JSON.stringify(
      { date: new Date().toISOString(), checks, editorStyle, notes, errors },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
