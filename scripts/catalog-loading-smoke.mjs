import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:4173").origin;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const allowed = new Set(["basics.01"]);
const definitions = new Set();
const datasets = new Set();
const blocked = [];
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.route("**/bundle/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const definition = path.match(
    /^\/bundle\/challenges\/([^/]+)\/challenge\.json$/,
  );
  const dataset = path.match(/^\/bundle\/datasets\/([^/]+)\/dataset\.json$/);
  if (definition) definitions.add(definition[1]);
  if (dataset) datasets.add(dataset[1]);
  if (
    (definition && !allowed.has(definition[1])) ||
    (dataset && dataset[1] !== "commerce-practice") ||
    path === "/bundle/challenge-07.json"
  ) {
    blocked.push(path);
    await route.abort();
  } else await route.continue();
});
async function ready() {
  await Promise.race([
    page
      .locator(".toolbar .execute:not([disabled])")
      .waitFor({ timeout: 60000 }),
    page
      .getByRole("button", { name: "Retry content", exact: true })
      .waitFor({ timeout: 60000 })
      .then(() => {
        throw new Error(
          `Selected content depends on unavailable unselected assets: ${blocked.join(", ")}`,
        );
      }),
  ]);
}
async function menu(group, item) {
  await page.getByRole("menuitem", { name: group, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}
try {
  await page.goto(origin);
  await ready();
  assert.deepEqual([...definitions], ["basics.01"]);
  assert.deepEqual([...datasets], ["commerce-practice"]);
  await menu("Skills", "Skill Map");
  assert.equal(await page.locator(".skill-node").count(), 13);
  await page.locator("#skill-map-reconcile").click();
  assert.equal(await page.locator(".objectives button:disabled").count(), 5);
  await page.locator("#skill-map-basics").click();
  assert.equal(await page.locator(".objectives button:enabled").count(), 5);
  assert.deepEqual([...definitions], ["basics.01"]);
  allowed.add("basics.05");
  await page
    .locator(".objectives button")
    .filter({ hasText: "basics.05" })
    .click();
  await page.getByRole("tab", { name: /^basics\.05\.sql/ }).waitFor();
  await ready();
  assert.deepEqual([...definitions], ["basics.01", "basics.05"]);
  assert.deepEqual([...datasets], ["commerce-practice"]);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    "readiness/evidence/application/catalog-loading-smoke.json",
    JSON.stringify(
      {
        pass: true,
        origin,
        definitions: [...definitions],
        datasets: [...datasets],
        blocked,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS cold startup and all thirteen map nodes tolerate unavailable unselected content; explicit selection loads only its definition",
  );
} finally {
  await browser.close();
}
