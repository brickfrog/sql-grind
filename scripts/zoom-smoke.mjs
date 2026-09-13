import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173").origin;
const dir = await mkdtemp(join(tmpdir(), "sql-grind-zoom-"));
await writeFile(
  join(dir, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "SQL Grind browser-zoom verification",
    version: "1.0",
    permissions: ["tabs"],
    background: { service_worker: "worker.js" },
  }),
);
await writeFile(
  join(dir, "worker.js"),
  "chrome.runtime.onInstalled.addListener(() => {});",
);
let context;
const evidence = {
  date: new Date().toISOString(),
  zoom: [],
  checks: [],
  errors: [],
};
try {
  context = await chromium.launchPersistentContext(join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: null,
    args: [
      `--disable-extensions-except=${dir}`,
      `--load-extension=${dir}`,
      "--window-size=1440,960",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const page = context.pages()[0];
  page.on("pageerror", (e) => evidence.errors.push(String(e)));
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
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
    (await page.locator(".error-banner").allTextContents()).join("\n"),
  );
  const judgeBeforeFocus = await page.locator("#judge-window").boundingBox();
  await page.getByRole("button", { name: "Submit", exact: true }).focus();
  assert.deepEqual(
    await page.locator("#judge-window").boundingBox(),
    judgeBeforeFocus,
  );
  evidence.checks.push("Keyboard focus does not reposition the floating judge");
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  async function menu(group, name) {
    await page.getByRole("menuitem", { name: group, exact: true }).click();
    await page
      .getByRole("menuitem", { name, exact: true })
      .or(page.getByRole("menuitemcheckbox", { name, exact: true }))
      .click();
  }
  const base = await page.evaluate(() => ({
    width: innerWidth,
    dpr: devicePixelRatio,
  }));
  for (const zoom of [1, 1.25, 2, 4]) {
    const actual = await worker.evaluate(
      async ({ origin, zoom }) => {
        const tab = (await chrome.tabs.query({})).find((t) =>
          t.url?.startsWith(origin),
        );
        if (!tab?.id) throw Error("Application tab unavailable");
        await chrome.tabs.setZoom(tab.id, zoom);
        return chrome.tabs.getZoom(tab.id);
      },
      { origin, zoom },
    );
    assert.ok(Math.abs(actual - zoom) < 1e-9);
    await page.waitForFunction(
      ({ base, zoom }) => Math.abs(devicePixelRatio - base.dpr * zoom) < 0.02,
      { base, zoom },
    );
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }));
    assert.ok(Math.abs(dimensions.width - base.width / zoom) < 3);
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
      await page.getByRole("menuitem", { name: group, exact: true }).focus();
      await page.keyboard.press("ArrowDown");
      if (await page.locator(".menu-popup button:enabled").count())
        await page.keyboard.press("End");
      await page.waitForFunction(() => {
        const r = document.activeElement.getBoundingClientRect();
        return (
          r.x >= 0 &&
          r.y >= 0 &&
          r.right <= innerWidth + 1 &&
          r.bottom <= innerHeight + 1
        );
      });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "menu-" + group,
      );
    }
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const startButtons = page.locator(".start-menu button");
    for (let i = 0; i < (await startButtons.count()); i++) {
      await startButtons.nth(i).focus();
      assert.ok(
        await startButtons.nth(i).evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        }),
      );
    }
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await menu("Help", "About");
    const dialog = page.locator("dialog");
    await dialog.waitFor();
    assert.ok(
      await dialog.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width <= innerWidth &&
          r.height <= innerHeight &&
          r.left >= 0 &&
          r.top >= 0
        );
      }),
    );
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      assert.ok(
        await dialog.evaluate((e) => e.contains(document.activeElement)),
      );
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await menu("View", "Reading Layout");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Reading Layout must reflow at real browser zoom",
    );
    await menu("Skills", "Skill Map");
    assert.equal(await page.locator(".linear-skills > li").count(), 13);
    await mkdir("readiness/evidence/application", { recursive: true });
    await page
      .locator(".ide")
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    const captureSession = await context.newCDPSession(page);
    const capture = await captureSession.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(
      `readiness/evidence/application/zoom-${zoom * 100}.png`,
      Buffer.from(capture.data, "base64"),
    );
    await captureSession.detach();
    await menu("View", "Reading Layout");
    evidence.zoom.push({
      zoom,
      actualBrowserZoom: actual,
      ...dimensions,
      menus: "all eight reachable by keyboard",
      start: "all destinations reachable",
      dialog: "fits and traps focus",
      reading: "no horizontal page overflow",
    });
    console.log("PASS real browser zoom", zoom * 100);
  }
  await worker.evaluate(async (origin) => {
    const t = (await chrome.tabs.query({})).find((t) =>
      t.url?.startsWith(origin),
    );
    await chrome.tabs.setZoom(t.id, 1);
  }, origin);
  await menu("View", "Reset Layout");
  await menu("Skills", "Open Next Challenge");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByRole("menuitem", { name: "File", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(
    await page
      .getByRole("menuitem", { name: "Edit", exact: true })
      .evaluate((e) => getComputedStyle(e).outlineStyle),
    "none",
  );
  await page.screenshot({
    path: "readiness/evidence/application/forced-colors.png",
    fullPage: true,
  });
  await writeFile(
    "readiness/evidence/application/accessibility-tree.txt",
    await page.locator("body").ariaSnapshot(),
  );
  evidence.checks.push(
    "Forced colors retains focus; reduced-motion mode retains controls",
    "Native accessibility tree captured; actual assistive-technology conformance is not claimed",
    "Chromium has no native text-only zoom; editor font enlargement is covered separately",
  );
  assert.deepEqual(evidence.errors, []);
  await writeFile(
    "readiness/evidence/application/zoom-smoke.json",
    JSON.stringify({ ...evidence, pass: true }, null, 2) + "\n",
  );
} catch (e) {
  console.error(e);
  if (context) {
    await mkdir("readiness/evidence/application", { recursive: true });
    await context
      .pages()[0]
      ?.screenshot({
        path: "readiness/evidence/application/zoom-failure.png",
        fullPage: true,
      })
      .catch(() => {});
  }
  throw e;
} finally {
  await context?.close();
  await rm(dir, { recursive: true, force: true });
}
