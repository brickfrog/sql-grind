import { chromium, firefox } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browserName = process.env.SMOKE_BROWSER ?? "chromium";
const browserType = { chromium, firefox }[browserName];
if (!browserType) throw new Error(`Unsupported smoke browser: ${browserName}`);
const browser = await browserType.launch({ headless: true });
const suffix = browserName === "chromium" ? "" : `-${browserName}`;
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [],
  checks = [];
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173").origin;
page.on("pageerror", (e) => {
  errors.push(String(e));
  console.log("PAGE ERROR:", String(e));
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text());
});
const mark = (name, details) => {
  checks.push({ name, details });
  console.log("PASS", name, details ?? "");
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
  assert.equal(
    await page.locator(".error-banner").count(),
    0,
    (await page.locator(".error-banner").allTextContents()).join("\n"),
  );
}
async function sql(text) {
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}
async function run(kind = "Execute") {
  const previous = await page.locator(".run-identity").allTextContents();
  if (kind === "Execute") await page.locator(".toolbar .execute").click();
  else await page.getByRole("button", { name: kind, exact: true }).click();
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
    { timeout: 90000 },
  );
  assert.equal(
    await page.locator(".error-banner").count(),
    0,
    (await page.locator(".error-banner").allTextContents()).join("\n"),
  );
  assert.equal(
    await page.getByRole("grid", { name: "Exact query output" }).count(),
    1,
    await page.locator(".status-message").textContent(),
  );
  return page.locator(".status-message").textContent();
}
try {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  await ready();
  mark("fresh local startup without external origins");
  assert.match(await page.locator(".window-title").textContent(), /basics\.01/);
  await page
    .getByRole("button", { name: "Dock Patchouli", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide Patchouli", exact: true })
    .click();
  mark("starter execute", await run());
  assert.match(await page.locator(".scorecard").textContent(), /Not submitted/);
  const reference = await readFile(
    "readiness/challenges/basics.01/reference.sql",
    "utf8",
  );
  await sql(reference);
  mark("reference submission", await run("Submit"));
  assert.match(await page.locator(".fixture-results").textContent(), /PASS/);
  assert.equal(await page.locator(".fixture-results li").count(), 3);
  assert.match(await page.locator(".scorecard").textContent(), /Pass/);
  // The first correct basics submission opens the modal celebration. It offers
  // exactly one dismiss action and one forward action; a redundant footer Close
  // would be a third way to say the same thing.
  const celebration = page.locator("dialog");
  await celebration.waitFor({ state: "visible" });
  assert.equal(
    await celebration
      .getByRole("button", { name: "Close", exact: true })
      .count(),
    0,
    "the celebration has no redundant footer Close",
  );
  assert.equal(
    await celebration
      .getByRole("button", { name: "Open next challenge", exact: true })
      .count(),
    1,
  );
  await celebration
    .getByRole("button", { name: "Stay on this challenge", exact: true })
    .click();
  await celebration.waitFor({ state: "hidden" });
  mark("first-pass celebration offers one dismiss and one forward action");
  // A completed challenge reviews its hints without consuming a level: the
  // reveal action is withheld, so the remaining counter cannot walk backwards.
  await page.getByRole("button", { name: "Review hints", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "visible" });
  assert.equal(
    await page
      .locator("dialog")
      .getByRole("button", { name: /^Reveal hint/ })
      .count(),
    0,
  );
  // Withholding the reveal action must not leave an empty dialog behind.
  assert.match(
    await page.locator("dialog").textContent(),
    /No hints were revealed for this challenge/,
  );
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Review hints", exact: true })
      .count(),
    1,
  );
  mark("a completed challenge reviews hints without consuming a level");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.locator("dialog input").fill("my_solution.sql");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".status-message")
      ?.textContent?.startsWith("Saved my_solution.sql"),
  );
  await page.reload();
  await ready();
  assert.match(
    await page.locator(".window-title").textContent(),
    /my_solution.sql/,
  );
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const [savedSql] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export SQL", exact: true }).click(),
  ]);
  assert.equal(await readFile(await savedSql.path(), "utf8"), reference);
  assert.equal(
    await page
      .getByRole("button", { name: "Review hints", exact: true })
      .count(),
    1,
  );
  mark("saved SQL, hints, completion and name restored after reload");
  await sql(
    "SELECT customer_id, customer_name FROM customers WHERE false ORDER BY customer_id",
  );
  mark("missing-customer rejection", await run("Submit"));
  assert.match(
    await page.locator(".scorecard").textContent(),
    /Not yet correct/,
  );
  assert.match(await page.locator(".skill-tag").textContent(), /1\/5/);
  await page.getByRole("tab", { name: "Skill Map.dag", exact: true }).click();
  assert.equal(await page.locator(".skill-node").count(), 13);
  await mkdir("readiness/evidence/application", { recursive: true });
  await page.screenshot({
    path: `readiness/evidence/application/skill-map${suffix}.png`,
    fullPage: true,
  });
  mark("thirteen-node real skill map");
  await page.getByRole("tab", { name: "my_solution.sql", exact: true }).click();
  // Run evidence is keyed by document. A map round trip keeps this document's
  // own scorecard, and a document without a run shows no foreign evidence.
  const scorecard = () => page.locator(".scorecard").textContent();
  assert.match(await scorecard(), /Not yet correct/);
  assert.doesNotMatch(await scorecard(), /Not submitted|No result/);
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Query", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".toolbar .execute")?.disabled,
    null,
    { timeout: 45000 },
  );
  assert.equal(
    await page.locator(".run-identity").count(),
    0,
    "a document without a run shows no other document's run identity",
  );
  await sql("SELECT 7::BIGINT AS scratch_only");
  await run();
  assert.match(await page.locator(".run-identity").textContent(), /scratch/);
  await page.getByRole("tab", { name: "my_solution.sql", exact: true }).click();
  assert.match(await scorecard(), /Not yet correct/);
  assert.doesNotMatch(
    await page.locator(".run-identity").textContent(),
    /scratch/,
  );
  mark("run evidence stays keyed to its own document across tab switches");
  await page.getByRole("tab", { name: "my_solution.sql", exact: true }).click();
  await sql("SELECT sum(i*j) FROM range(1000000) a(i), range(1000000) b(j)");
  await page.locator(".toolbar .execute").click();
  await page.waitForFunction(
    () => !document.querySelector(".toolbar button:nth-of-type(6)")?.disabled,
  );
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".toolbar .execute")?.disabled,
    null,
    { timeout: 20000 },
  );
  assert.match(await page.locator(".status-message").textContent(), /cancel/i);
  await sql("SELECT 42::BIGINT AS answer");
  mark("execution recovered after cancellation", await run());
  assert.match(await page.locator(".output").textContent(), /42/);
  await page.screenshot({
    path: `readiness/evidence/application/workbench${suffix}.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    `readiness/evidence/application/smoke${suffix}.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        origin,
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
    await page
      .locator(".status-message")
      .allTextContents()
      .catch(() => []),
  );
  await mkdir("readiness/evidence/application", { recursive: true });
  await page
    .screenshot({
      path: `readiness/evidence/application/failure${suffix}.png`,
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
