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
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (brokenAsset && url.pathname === "/bundle/schema.sql")
    return route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "-- INJECTED corrupt local asset",
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
