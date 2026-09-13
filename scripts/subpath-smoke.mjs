// Proves the built application works when it is not served from a site root,
// which is how a GitHub project page at /<repo>/ serves it. Builds into its own
// output directory, serves it with no custom headers the way GitHub Pages does,
// and requires a working engine, images, credits and a graded submission with
// zero failed requests. This catches any unprefixed absolute URL, wherever it
// is written: markup, CSS, a new component, or a fetch call.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const BASE = "/sql-grind";
const PORT = 4180;
const outDir = resolve("dist-subpath");
const checks = [];
const mark = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".parquet": "application/octet-stream",
};

await rm(outDir, { recursive: true, force: true });
await new Promise((ok, fail) => {
  const build = spawn(
    "npx",
    ["vite", "build", "--outDir", outDir, "--emptyOutDir"],
    {
      env: { ...process.env, BASE_PATH: `${BASE}/` },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  build.on("error", fail);
  build.on("exit", (code) =>
    code === 0 ? ok() : fail(new Error(`vite build exited ${code}`)),
  );
});

// No custom headers: GitHub Pages sends none, so _headers must not be needed.
const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://127.0.0.1");
    if (!pathname.startsWith(BASE)) {
      res.writeHead(404).end("outside base");
      return;
    }
    let rest = decodeURIComponent(pathname.slice(BASE.length)) || "/";
    if (rest === "/") rest = "/index.html";
    const file = resolve(outDir, "." + rest);
    if (!file.startsWith(outDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    res.writeHead(200, {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
    });
    createReadStream(file).pipe(res);
  } catch {
    // Serve an error page body, so a component that reads a 404 response as
    // content produces a visible failure instead of empty text.
    res
      .writeHead(404, { "content-type": "text/html; charset=utf-8" })
      .end("<!doctype html><html><body><h1>404 Not Found</h1></body></html>");
  }
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failed = [];
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("requestfailed", (request) =>
  failed.push(`${request.failure()?.errorText} ${request.url()}`),
);
page.on("response", (response) => {
  if (response.status() >= 400)
    failed.push(`${response.status()} ${response.url()}`);
});
try {
  await page.goto(`http://127.0.0.1:${PORT}${BASE}/`);
  await page.waitForFunction(
    () => !document.querySelector(".toolbar .execute")?.disabled,
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page.evaluate(() => document.baseURI.endsWith("/sql-grind/")),
    true,
  );
  mark("Subpath build starts the pinned engine without a site root");

  const images = await page.evaluate(() =>
    [...document.images].map((image) => ({
      path: new URL(image.currentSrc || image.src).pathname,
      loaded: image.naturalWidth > 0,
    })),
  );
  assert.ok(images.length > 20, "the desktop renders its icon set");
  assert.deepEqual(
    images.filter((image) => !image.loaded),
    [],
  );
  for (const name of ["patchouli.webp", "patchouli-tray.png"])
    assert.ok(
      images.some((image) => image.path === `${BASE}/assets/${name}`),
      `${name} resolves under the base path`,
    );
  mark("Every portrait and icon resolves under the base path");

  await page.getByRole("menuitem", { name: "Help", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Asset Credits", exact: true })
    .click();
  const credits = await page.locator(".credits-text").innerText();
  assert.match(credits, /Kamiyamane/, "required icon attribution is present");
  assert.doesNotMatch(
    credits,
    /<html|Not Found/i,
    "an error page body is never shown as attribution",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  mark("Asset Credits shows real attribution, not a fetched error page");

  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "SELECT customer_id, customer_name FROM customers ORDER BY customer_id;",
  );
  await page.getByRole("button", { name: /^Submit/ }).click();
  await page.locator(".celebrate").waitFor({ timeout: 180000 });
  assert.equal(
    await page.locator(".fixture-results li.correct").count(),
    await page.locator(".fixture-results li").count(),
  );
  await page
    .getByRole("button", { name: "Stay on this challenge", exact: true })
    .click();
  mark("Grading loads every dataset and expected asset under the base path");

  assert.deepEqual(failed, [], "no request fails under the base path");
  assert.deepEqual(errors, []);
  mark("No failed request and no page error under the base path");
} finally {
  await browser.close();
  await new Promise((ok) => server.close(ok));
  await rm(outDir, { recursive: true, force: true });
}
await mkdir("readiness/evidence/application", { recursive: true });
await writeFile(
  "readiness/evidence/application/subpath-smoke.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      base: `${BASE}/`,
      headers: "none, as GitHub Pages serves them",
      status: "passed",
      checks,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ status: "passed", checks: checks.length }, null, 2),
);
