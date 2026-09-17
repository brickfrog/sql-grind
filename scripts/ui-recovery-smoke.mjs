import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173").origin;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const checks = [],
  errors = [];
let brokenAsset = true;
// A corrupt authored asset and an unreachable engine asset are different
// faults: the first is content, the second is the SQL runtime. The banner has
// to name the right one, so each is injectable on its own.
let brokenEngine = false;
// A single unreadable challenge is a third, narrower fault: the curriculum and
// the engine are both fine, so only that challenge may be lost.
let brokenChallenge = "";
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (brokenAsset && url.pathname === "/bundle/schema.sql")
    return route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "-- INJECTED corrupt local asset",
    });
  if (
    brokenChallenge &&
    url.pathname === `/bundle/challenges/${brokenChallenge}/challenge.json`
  )
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"INJECTED":"corrupt challenge"}',
    });
  if (brokenEngine && /duckdb-browser.*worker.*\.js$/.test(url.pathname))
    return route.abort("failed");
  return route.continue();
});
await context.addInitScript(() => {
  window.failDraftWrites = false;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (window.failDraftWrites && this.name === "drafts")
      throw new DOMException(
        "INJECTED browser quota failure",
        "QuotaExceededError",
      );
    return put.apply(this, args);
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
async function menu(p, group, name) {
  await p.getByRole("menuitem", { name: group, exact: true }).click();
  await p
    .getByRole("menuitem", { name, exact: true })
    .or(p.getByRole("menuitemcheckbox", { name, exact: true }))
    .click();
}
async function edit(p, sql) {
  await p.locator(".cm-content").click();
  await p.locator(".cm-content").press("ControlOrMeta+a");
  await p.keyboard.insertText(sql);
}
async function exportSql(p) {
  const event = p.waitForEvent("download");
  await menu(p, "File", "Export SQL");
  return readFile(await (await event).path(), "utf8");
}
async function ready(p) {
  await p.waitForFunction(
    () =>
      document.querySelector(".toolbar .execute") &&
      !document.querySelector(".toolbar .execute").disabled,
    null,
    { timeout: 45000 },
  );
  assert.equal(
    await p.locator(".error-banner").count(),
    0,
    (await p.locator(".error-banner").allTextContents()).join("\n"),
  );
}
const mark = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
try {
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Retry content", exact: true })
    .waitFor();
  const assetBanner = await page.locator(".error-banner").textContent();
  assert.match(assetBanner, /hash|checksum|integrity/i);
  assert.match(assetBanner, /Content unavailable/);
  assert.equal(await page.locator(".run-identity").count(), 0);
  brokenAsset = false;
  await page
    .getByRole("button", { name: "Retry content", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  mark(
    "INJECTED corrupt asset is rejected; visible Retry content restores verified runtime",
  );
  // The same banner serves both faults, so the heading and the retry label are
  // the only things telling a reader which subsystem to look at. An aborted
  // engine asset must not be announced as missing curriculum.
  brokenEngine = true;
  await page.reload();
  await page
    .getByRole("button", { name: "Reload SQL engine", exact: true })
    .waitFor({ timeout: 90000 });
  const engineBanner = await page.locator(".error-banner").textContent();
  assert.match(engineBanner, /SQL engine unavailable/);
  assert.doesNotMatch(engineBanner, /Content unavailable/);
  assert.equal(
    await page
      .getByRole("button", { name: "Retry content", exact: true })
      .count(),
    0,
    "an engine fault offered a content retry",
  );
  // The operation error bar carries its own "Retry engine" and is a separate
  // block, so both banners can be open together and a shared accessible name
  // would be ambiguous to a locator and to a screen reader. Only one banner is
  // open here, so this pins the label this banner contributes rather than the
  // collision itself; scoped to the banners because unrelated duplicates, like
  // two launchers for one destination, act alike and are not a hazard.
  const names = await page
    .locator(".error-banner button:visible")
    .evaluateAll((nodes) =>
      nodes
        .map(
          (node) => node.getAttribute("aria-label") ?? node.textContent.trim(),
        )
        .filter((name) => /retry|reload/i.test(name)),
    );
  assert.deepEqual(names, ["Reload SQL engine"]);
  brokenEngine = false;
  await page
    .getByRole("button", { name: "Reload SQL engine", exact: true })
    .click();
  await ready(page);
  mark(
    "INJECTED unreachable engine asset names the SQL engine uniquely, and Reload SQL engine restores it",
  );
  await edit(page, "SELECT 42::BIGINT AS saved;");
  await menu(page, "File", "Save");
  await page.locator("dialog input").fill("shared.sql");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Saved shared.sql"),
  );
  await page.evaluate(() => (window.failDraftWrites = true));
  await edit(page, "SELECT 43::BIGINT AS unsaved;");
  await page
    .getByRole("button", { name: "Retry save / storage", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".window-title").textContent(),
    /shared.sql \*/,
  );
  assert.equal(await exportSql(page), "SELECT 43::BIGINT AS unsaved;");
  await page.evaluate(() => (window.failDraftWrites = false));
  await page
    .getByRole("button", { name: "Retry save / storage", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".window-title")
        ?.textContent?.includes("shared.sql *"),
  );
  await page.locator(".error-banner").waitFor({ state: "hidden" });
  assert.doesNotMatch(
    await page.locator(".window-title").textContent(),
    /shared.sql \*/,
  );
  await page.reload();
  await ready(page);
  assert.equal(await exportSql(page), "SELECT 43::BIGINT AS unsaved;");
  mark(
    "INJECTED quota failure exposes dirty state and SQL export; Retry save commits exact SQL across reload",
  );
  const other = await context.newPage();
  other.on("pageerror", (e) => errors.push(String(e)));
  await other.goto(origin);
  await ready(other);
  await edit(other, "SELECT 200::BIGINT AS other_tab;");
  await menu(other, "File", "Save");
  await other.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Saved shared.sql"),
  );
  await edit(page, "SELECT 100::BIGINT AS this_tab;");
  await page
    .getByRole("button", { name: "Open recovered copy", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Refresh library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open recovered copy", exact: true })
    .waitFor();
  assert.equal(await exportSql(page), "SELECT 100::BIGINT AS this_tab;");
  await edit(page, "SELECT 101::BIGINT AS latest_local_edit;");
  await page
    .getByRole("button", { name: "Open recovered copy", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Recovered copy opened"),
  );
  assert.equal(
    await exportSql(page),
    "SELECT 101::BIGINT AS latest_local_edit;",
  );
  assert.equal(await exportSql(other), "SELECT 200::BIGINT AS other_tab;");
  await page.reload();
  await ready(page);
  assert.equal(
    await exportSql(page),
    "SELECT 101::BIGINT AS latest_local_edit;",
  );
  await page
    .locator(".desktop-icons")
    .getByRole("button", { name: "My Queries", exact: true })
    .click();
  await page.locator("dialog").waitFor();
  const original = page.locator(".library-list article").filter({
    has: page.getByRole("heading", { name: /^shared.sql Saved query/ }),
  });
  const exported = page.waitForEvent("download");
  await original
    .getByRole("button", { name: "Export SQL", exact: true })
    .click();
  assert.equal(
    await readFile(await (await exported).path(), "utf8"),
    "SELECT 200::BIGINT AS other_tab;",
  );
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  mark(
    "Real two-tab conflict survives Refresh library; recovery includes subsequent edits and preserves winner across reload",
  );
  await menu(page, "View", "Object Explorer");
  await menu(page, "View", "Goal / Skill Details");
  await menu(page, "Skills", "Skill Map");
  await page.locator("#skill-map-rec").click();
  await menu(page, "Tools", "Settings");
  await page
    .getByRole("combobox", { name: /^Editor font size/ })
    .selectOption("16");
  // The theme has to repaint, not just store a string: assert a real computed
  // colour changes, and that the choice survives the reload below.
  const lightInk = await page.evaluate(
    () => getComputedStyle(document.body).color,
  );
  await page.getByRole("combobox", { name: /^Theme/ }).selectOption("dark");
  await page.waitForFunction(
    (before) => getComputedStyle(document.body).color !== before,
    lightInk,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await page.getByLabel("Hush unsolicited commentary", { exact: true }).check();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await menu(page, "File", "Close Window");
  await page.locator(".ide").waitFor({ state: "hidden" });
  await page.reload();
  await ready(page);
  assert.equal(await page.locator(".explorer").count(), 0);
  assert.equal(await page.locator(".goal").count(), 0);
  await menu(page, "Skills", "Skill Map");
  assert.equal(
    await page.locator("#skill-map-rec").getAttribute("aria-pressed"),
    "true",
  );
  await menu(page, "Tools", "Settings");
  assert.equal(
    await page
      .getByRole("combobox", { name: /^Editor font size/ })
      .inputValue(),
    "16",
  );
  assert.equal(
    await page.getByRole("combobox", { name: /^Theme/ }).inputValue(),
    "dark",
    "the chosen theme must survive a reload",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  assert.equal(
    await page
      .getByLabel("Hush unsolicited commentary", { exact: true })
      .isChecked(),
    true,
  );
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  mark(
    "Close flushes panel layout, selected skill and preferences; reload restores committed state",
  );
  // A single unreadable challenge is the one fault that leaves the curriculum,
  // the engine and every other challenge intact. It used to be a dead end: a
  // banner quoting a bundle path, navigation that did nothing, and a workbench
  // that spun on "Loading schema…" forever. Each of those is asserted here.
  await menu(page, "View", "Object Explorer");
  await menu(page, "View", "Goal / Skill Details");
  // Expanding a skill in the tree is itself a deliberate move to the map, so
  // the two clicks are kept apart: only the challenge click is under test.
  const expandBasics = async () => {
    if (!(await page.locator(".challenge-row").count()))
      await page.locator(".tree-row.level2", { hasText: "SQL basics" }).click();
  };
  const openFromTree = (id) =>
    page.locator(".challenge-row", { hasText: id }).click();
  await expandBasics();
  await openFromTree("basics.02");
  await ready(page);
  // A QC pass reported the challenge rows' accessible names arriving empty,
  // because the text sits in a child span. They do not: a per-node partial AX
  // tree gives "basics.01 Customer identities Available" for the first row.
  // Asked through getByRole rather than read back from the DOM on purpose —
  // the DOM proves the markup, not the name the platform derives from it, and
  // that derivation is the whole claim.
  //
  // The role is treeitem, not button. Querying button returned zero and looked
  // exactly like the reported defect, which is worth stating: the empty result
  // was the wrong role, not a missing name.
  const rowCount = await page.locator(".challenge-row").count();
  assert.ok(
    rowCount >= 5,
    `the challenge tree exposed ${rowCount} rows, so naming was not tested`,
  );
  for (const id of ["basics.01", "basics.02", "basics.03"])
    assert.equal(
      await page.getByRole("treeitem", { name: new RegExp(id) }).count(),
      1,
      `no tree item exposes an accessible name containing ${id}`,
    );
  brokenChallenge = "basics.02";
  await page.reload();
  const banner = page.locator(".error-banner");
  await banner.waitFor({ timeout: 60000 });
  const bannerText = (await banner.innerText()).replace(/\s+/g, " ");
  assert.match(bannerText, /Content unavailable/);
  assert.match(
    bannerText,
    /Challenge basics\.02 · Paid reporting year could not be loaded/,
    "the banner must name the challenge a learner recognises",
  );
  assert.doesNotMatch(
    bannerText,
    /\/bundle\//,
    "a bundle path is not something a learner can act on",
  );
  assert.doesNotMatch(
    bannerText,
    /Content error:/,
    "the prefix that routes this banner is not learner-facing copy",
  );
  // announce() writes the same sentence to the status bar and to the Messages
  // log. The status bar cannot be sampled reliably — Svelte batches updates, so
  // a value replaced in the same task never paints — but the log keeps every
  // announcement verbatim, and it is the same string a screen reader would
  // read from role=status. The routing token must appear in neither.
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  const logged = await page.locator(".message-list").innerText();
  assert.match(
    logged,
    /Challenge basics\.02 · Paid reporting year could not be loaded/,
    "the failure was never announced",
  );
  // Announcements are timestamped; the loader's own words are kept on a plain
  // `id · detail` line for whoever is debugging the bundle, and that line is
  // allowed to carry the prefix. What must never carry it is the sentence a
  // learner is shown and a screen reader reads.
  assert.deepEqual(
    logged
      .split("\n")
      .filter((line) => /^\d?\d:\d\d:\d\d/.test(line.trim()))
      .filter((line) => /Content error:/.test(line)),
    [],
    "the routing token reached an announcement",
  );
  // The engine and its dataset never depended on that file, so every readiness
  // indicator must resolve instead of waiting for a load that is not coming.
  await page.waitForFunction(
    () =>
      /Local data · [1-9]/.test(
        document.querySelector(".explorer-footer")?.textContent ?? "",
      ),
    null,
    { timeout: 60000 },
  );
  assert.equal(
    await page.locator(".tree-empty", { hasText: "Loading schema" }).count(),
    0,
    "the schema tree must not spin when only one challenge failed",
  );
  assert.doesNotMatch(
    await page.locator(".status-message").innerText(),
    /Loading local practice data and DuckDB/,
  );
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  const log = await page.locator(".message-list").innerText();
  assert.match(
    log,
    /basics\.02 · .*Integrity check failed/,
    "the technical detail stays available in the message log",
  );
  assert.match(
    await page.locator(".goal-content").innerText(),
    /could not be loaded/,
    "the Goal panel must not call a broken challenge a scratch query",
  );
  const skip = page.getByRole("button", {
    name: /^Continue with basics\.03 · Literal email states$/,
  });
  assert.ok(await skip.count(), "no live next step was offered");
  await skip.first().click();
  await ready(page);
  assert.match(await page.locator(".window-title").innerText(), /basics\.03/);
  // Opening the broken challenge from the tree explains itself and leaves the
  // learner on the document they already had.
  await expandBasics();
  await page
    .locator("#document-tabs [role=tab]", { hasText: "basics.03" })
    .click();
  await openFromTree("basics.02");
  await banner.waitFor();
  assert.match((await banner.innerText()).replace(/\s+/g, " "), /basics\.02/);
  assert.match(
    await page.locator(".window-title").innerText(),
    /basics\.03/,
    "a failed open must not move the learner somewhere else",
  );
  brokenChallenge = "";
  await page
    .getByRole("button", { name: "Retry content", exact: true })
    .click();
  await ready(page);
  assert.match(await page.locator(".window-title").innerText(), /basics\.02/);
  mark(
    "INJECTED unreadable challenge names the challenge, keeps the workbench loaded, offers a challenge that works, and recovers on retry",
  );
  assert.deepEqual(errors, []);
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    "readiness/evidence/application/ui-recovery-smoke.json",
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
      path: "readiness/evidence/application/ui-recovery-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
