// Proves the service worker makes the engine durable offline.
//
// The point of public/sw.js is that ~46 MB of engine payload survives HTTP
// cache eviction and a missing network, so this suite refuses to settle for
// "a registration exists": it builds the site, serves it, loads it once, then
// pulls the network out from under the app and requires a full engine boot and
// a real query from Cache Storage alone. It also proves the shell is not
// pinned — a changed shell asset must be served fresh while online — and that
// activation drops caches which do not carry the deployed version.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PORT = 4173;
const origin = `http://127.0.0.1:${PORT}`;
const ENGINE_READY = 180_000;
const CREDITS = resolve("dist/icon-credits.txt");
const FOREIGN_CACHE = "sql-grind-assets-foreign-version";
const checks = [];
const evidence = {
  date: new Date().toISOString(),
  origin,
  checks,
  errors: [],
  offlineRequestFailures: [],
};
const mark = (name, detail) => {
  checks.push(detail === undefined ? { name } : { name, detail });
  console.log(`ok ${checks.length} ${name}`);
};

const busy = await new Promise((ok) => {
  const socket = connect(PORT, "127.0.0.1");
  socket.on("connect", () => {
    socket.destroy();
    ok(true);
  });
  socket.on("error", () => ok(false));
});
if (busy) {
  console.error(
    `port ${PORT} is already in use: this suite needs it for its own static host, and it will not touch a process it did not start`,
  );
  process.exit(1);
}

const run = (command, args) =>
  new Promise((ok, fail) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? ok(output)
        : fail(
            new Error(`${command} ${args.join(" ")} exited ${code}\n${output}`),
          ),
    );
  });

await run("npm", ["run", "build"]);
const manifest = JSON.parse(
  await readFile("dist/bundle/manifest.json", "utf8"),
);
const engineFiles = manifest.files
  .filter((file) => file.path.startsWith("public/"))
  .map((file) => ({
    path: `/${file.path.slice("public/".length)}`,
    bytes: file.bytes,
  }));
assert.ok(
  engineFiles.length >= 5,
  "the manifest still lists the engine and extension payload",
);
// The cache-name version the worker derives, computed here independently.
const configurationHash = String(manifest.configurationHash).slice(0, 16);
evidence.deployedVersion = `${manifest.bundleVersion}-${configurationHash}`;
evidence.engineAndExtensionBytes = manifest.engineAndExtensionBytes;
const creditsOriginal = await readFile(CREDITS, "utf8");

const server = spawn("node", ["scripts/serve.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));
await new Promise((ok, fail) => {
  const timer = setTimeout(
    () =>
      fail(new Error(`scripts/serve.mjs never reported ready\n${serverLog}`)),
    20_000,
  );
  server.on("exit", (code) =>
    fail(new Error(`scripts/serve.mjs exited ${code}\n${serverLog}`)),
  );
  const poll = setInterval(() => {
    if (!/ready on/i.test(serverLog)) return;
    clearInterval(poll);
    clearTimeout(timer);
    ok();
  }, 100);
});

// "Engine ready" is the enabled execute button, the same signal every other
// suite waits on; an error banner short-circuits the wait so a failure is
// reported instead of timing out.
const requireReady = async (target, label) => {
  await target.waitForFunction(
    () =>
      !document.querySelector(".toolbar .execute")?.disabled ||
      !!document.querySelector(".error-banner"),
    null,
    { timeout: ENGINE_READY },
  );
  const banners = await target.locator(".error-banner").allTextContents();
  assert.deepEqual(banners, [], `${label}: engine reported an error banner`);
};
const runQuery = async (target) => {
  await target.locator(".toolbar .execute").click();
  await target.waitForFunction(
    () =>
      !!document.querySelector("[role=grid]") &&
      !document.querySelector(".toolbar .execute")?.disabled,
    null,
    { timeout: ENGINE_READY },
  );
  return Number(await target.getByRole("grid").getAttribute("aria-rowcount"));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
let offlinePhase = false;
try {
  await context.addInitScript(() => {
    window.swMessages = [];
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.addEventListener("message", (event) =>
        window.swMessages.push(event.data),
      );
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (offlinePhase)
      evidence.offlineRequestFailures.push(
        `${request.failure()?.errorText} ${request.url()}`,
      );
  });

  const cacheState = () =>
    page.evaluate(async () => {
      const state = {};
      for (const name of await caches.keys())
        state[name] = (await (await caches.open(name)).keys()).length;
      return state;
    });
  const cachedBytes = (paths) =>
    page.evaluate(async (relative) => {
      const out = [];
      for (const path of relative) {
        const href = new URL(path.slice(1), document.baseURI).href;
        const hit = await caches.match(href);
        out.push({
          path,
          cached: !!hit,
          bytes: hit
            ? Number(hit.headers.get("content-length")) ||
              (await hit.blob()).size
            : 0,
        });
      }
      return out;
    }, paths);

  const coldStarted = Date.now();
  await page.goto(origin);
  await requireReady(page, "cold load");
  evidence.coldReadyMs = Date.now() - coldStarted;
  evidence.coldQueryRows = await runQuery(page);
  assert.ok(evidence.coldQueryRows > 1, "the cold visit runs a query");
  mark("Cold visit boots the engine and runs a query", {
    readyMs: evidence.coldReadyMs,
    rows: evidence.coldQueryRows,
  });

  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    null,
    {
      timeout: 30_000,
    },
  );
  evidence.worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      script: registration.active?.scriptURL,
      state: registration.active?.state,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  });
  assert.equal(evidence.worker.state, "activated");
  assert.equal(evidence.worker.scope, `${origin}/`);
  assert.ok(
    evidence.worker.controller?.endsWith("/sw.js"),
    "the first visit is already controlled, so its engine downloads are cached",
  );
  mark(
    "Service worker activated and controls the first visit",
    evidence.worker,
  );

  evidence.warmReport = await page
    .waitForFunction(
      () =>
        window.swMessages.find((m) => m?.type === "sql-grind:warmed") ?? null,
      null,
      { timeout: 120_000 },
    )
    .then((handle) => handle.jsonValue());
  assert.deepEqual(
    evidence.warmReport.failed,
    [],
    "background warming must not fail on any manifest asset",
  );
  assert.equal(evidence.warmReport.version, evidence.deployedVersion);
  evidence.cachedEngineAssets = await cachedBytes(
    engineFiles.map((f) => f.path),
  );
  for (const file of engineFiles) {
    const entry = evidence.cachedEngineAssets.find((e) => e.path === file.path);
    assert.ok(entry.cached, `${file.path} is in Cache Storage after warming`);
    assert.equal(
      entry.bytes,
      file.bytes,
      `${file.path} is cached whole (manifest says ${file.bytes} bytes)`,
    );
  }
  evidence.cachedEngineBytes = evidence.cachedEngineAssets.reduce(
    (total, entry) => total + entry.bytes,
    0,
  );
  evidence.caches = await cacheState();
  assert.ok(
    Object.keys(evidence.caches).some((name) =>
      name.endsWith(evidence.deployedVersion),
    ),
    "cache names carry the deployed bundle version",
  );
  mark("Every engine and extension asset is durably cached, whole", {
    assets: evidence.cachedEngineAssets.length,
    cachedEngineBytes: evidence.cachedEngineBytes,
    warmedEngineBytes: evidence.warmReport.assets.bytes,
    warmedEngineAssets: evidence.warmReport.assets.warmed,
    alreadyPresent: evidence.warmReport.assets.present.length,
    shellEntriesStored: evidence.warmReport.shell.stored,
    shellBytesStored: evidence.warmReport.shell.bytes,
  });

  // The first visit's own <script>/<link> loads race clients.claim(), so the
  // install handler precaches them out of the document markup. Without that the
  // shell would only become durable on a later online visit.
  const shellCache = `sql-grind-shell-${evidence.deployedVersion}`;
  const indexHtml = await readFile("dist/index.html", "utf8");
  const shellAssets = [
    ...indexHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
  ]
    .map(([, reference]) => reference)
    .filter((reference) => reference.startsWith("/"));
  assert.ok(
    shellAssets.length >= 2,
    "the build emits a module and a stylesheet",
  );
  evidence.shellPrecache = await page.evaluate(
    async ({ name, assets }) => {
      const cache = await caches.open(name);
      const keys = (await cache.keys()).map((request) => request.url);
      return {
        entries: keys.length,
        document: keys.includes(new URL(".", document.baseURI).href),
        assets: assets.map((path) => ({
          path,
          cached: keys.includes(new URL(path.slice(1), document.baseURI).href),
        })),
      };
    },
    { name: shellCache, assets: shellAssets },
  );
  assert.ok(
    evidence.shellPrecache.document,
    "the navigation document is cached after the very first visit",
  );
  assert.deepEqual(
    evidence.shellPrecache.assets.filter((asset) => !asset.cached),
    [],
    "every built shell asset is cached after the very first visit",
  );
  mark("Install precaches the document and its built assets", {
    shellCache,
    ...evidence.shellPrecache,
  });

  // Warming is what keeps the engine durable when the HTTP cache is evicted, so
  // prove the loop really re-downloads and re-stores an evicted asset instead
  // of only reporting assets the page had already fetched.
  const evictTarget = engineFiles.reduce((largest, file) =>
    file.bytes > largest.bytes ? file : largest,
  );
  assert.equal(
    await page.evaluate(
      async ({ name, path }) =>
        (await caches.open(name)).delete(
          new URL(path.slice(1), document.baseURI).href,
        ),
      {
        name: `sql-grind-assets-${evidence.deployedVersion}`,
        path: evictTarget.path,
      },
    ),
    true,
    "the eviction we simulate really removed the cached engine asset",
  );
  evidence.rewarmReport = await page
    .evaluate(async () => {
      window.swMessages.length = 0;
      const registration = await navigator.serviceWorker.ready;
      registration.active.postMessage({ type: "sql-grind:warm" });
    })
    .then(() =>
      page.waitForFunction(
        () =>
          window.swMessages.find((m) => m?.type === "sql-grind:warmed") ?? null,
        null,
        { timeout: 120_000 },
      ),
    )
    .then((handle) => handle.jsonValue());
  assert.deepEqual(evidence.rewarmReport.failed, []);
  assert.deepEqual(
    evidence.rewarmReport.assets.warmed,
    [evictTarget.path.slice(1)],
    "warming re-downloads exactly the evicted immutable asset",
  );
  assert.equal(evidence.rewarmReport.assets.bytes, evictTarget.bytes);
  const rewarmed = await cachedBytes([evictTarget.path]);
  assert.deepEqual(rewarmed, [
    { path: evictTarget.path, cached: true, bytes: evictTarget.bytes },
  ]);
  mark("Background warming restores an evicted engine asset", {
    asset: evictTarget.path,
    redownloadedBytes: evidence.rewarmReport.assets.bytes,
  });

  // The shell must never be pinned: a redeployed asset has to win while online.
  const credits = (path) =>
    page.evaluate(
      (relative) =>
        fetch(new URL(relative, document.baseURI).href, {
          credentials: "same-origin",
        }).then((response) => response.text()),
      path,
    );
  const before = await credits("icon-credits.txt");
  await writeFile(CREDITS, `${creditsOriginal}\nREDEPLOYED-MARKER\n`);
  const after = await credits("icon-credits.txt");
  assert.doesNotMatch(before, /REDEPLOYED-MARKER/);
  assert.match(
    after,
    /REDEPLOYED-MARKER/,
    "a shell asset changed on the host must be served fresh, not from cache",
  );
  evidence.shellFreshness = {
    asset: "/icon-credits.txt",
    cachedFirstBytes: before.length,
    afterRedeployBytes: after.length,
  };
  mark("Network-first shell serves a redeployed asset instead of a stale copy");

  // Activation-time purge: a cache from another version must not survive.
  await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    await cache.put(
      new URL("stale-marker", document.baseURI).href,
      new Response("stale"),
    );
  }, FOREIGN_CACHE);
  evidence.cachesWithForeign = await cacheState();
  assert.equal(
    evidence.cachesWithForeign[FOREIGN_CACHE],
    1,
    "the foreign cache was planted",
  );
  const onlineReloadStarted = Date.now();
  await page.reload();
  await requireReady(page, "online reload");
  evidence.onlineReloadReadyMs = Date.now() - onlineReloadStarted;
  await page.waitForFunction(
    (name) => caches.keys().then((names) => !names.includes(name)),
    FOREIGN_CACHE,
    { timeout: 30_000 },
  );
  evidence.cachesAfterPurge = await cacheState();
  assert.ok(
    !(FOREIGN_CACHE in evidence.cachesAfterPurge),
    "a cache that does not carry the deployed version is deleted",
  );
  assert.ok(
    Object.keys(evidence.cachesAfterPurge).some((name) =>
      name.endsWith(evidence.deployedVersion),
    ),
    "the current version's caches survive the purge",
  );
  mark("Foreign-version cache is purged while the current one survives", {
    planted: FOREIGN_CACHE,
    before: Object.keys(evidence.cachesWithForeign),
    after: Object.keys(evidence.cachesAfterPurge),
  });

  // The whole point: no network at all, engine still boots and answers.
  offlinePhase = true;
  await context.setOffline(true);
  const offlineStarted = Date.now();
  await page.reload();
  await requireReady(page, "offline reload");
  evidence.offlineReloadReadyMs = Date.now() - offlineStarted;
  assert.equal(
    await page.evaluate(() => navigator.onLine),
    false,
    "the offline reload really had no network",
  );
  evidence.offlineQueryRows = await runQuery(page);
  assert.ok(
    evidence.offlineQueryRows > 1,
    "an offline visit runs a real query against DuckDB",
  );
  const offlineCredits = await credits("icon-credits.txt");
  evidence.shellFreshness.offlineFallbackBytes = offlineCredits.length;
  assert.match(
    offlineCredits,
    /REDEPLOYED-MARKER/,
    "network-first falls back to the cache when the host is unreachable",
  );
  mark("Offline reload reaches engine-ready and runs a query", {
    readyMs: evidence.offlineReloadReadyMs,
    rows: evidence.offlineQueryRows,
    requestFailures: evidence.offlineRequestFailures.length,
  });
  assert.deepEqual(
    evidence.offlineRequestFailures,
    [],
    "no request fails while offline: everything needed is in Cache Storage",
  );
  assert.deepEqual(evidence.errors, []);
  mark("No page error and no failed request in the offline run");

  // The realistic user story: a brand new client with empty storage opens the
  // app once, lets it settle, then opens it again with no network at all.
  // Nothing is primed here beyond that single visit — no extra online reload
  // and no hand-written cache entry, only the worker's own post-load warm.
  const second = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const secondVisit = { requestFailures: [], errors: [] };
  evidence.secondVisit = secondVisit;
  try {
    await second.addInitScript(() => {
      window.swMessages = [];
      navigator.serviceWorker.addEventListener("message", (event) =>
        window.swMessages.push(event.data),
      );
    });
    const fresh = await second.newPage();
    fresh.on("pageerror", (error) => secondVisit.errors.push(String(error)));
    let recording = false;
    fresh.on("requestfailed", (request) => {
      if (recording)
        secondVisit.requestFailures.push(
          `${request.failure()?.errorText} ${request.url()}`,
        );
    });
    await fresh.goto(origin);
    await requireReady(fresh, "second visit, first load");
    secondVisit.firstQueryRows = await runQuery(fresh);
    secondVisit.warm = await fresh
      .waitForFunction(
        () =>
          window.swMessages.find((m) => m?.type === "sql-grind:warmed") ?? null,
        null,
        { timeout: 120_000 },
      )
      .then((handle) => handle.jsonValue());
    assert.deepEqual(secondVisit.warm.failed, []);
    recording = true;
    await second.setOffline(true);
    const started = Date.now();
    await fresh.reload();
    await requireReady(fresh, "second visit, offline");
    secondVisit.offlineReadyMs = Date.now() - started;
    secondVisit.offlineQueryRows = await runQuery(fresh);
    assert.ok(
      secondVisit.offlineQueryRows > 1,
      "the second visit ever runs a query with the network switched off",
    );
    assert.deepEqual(secondVisit.errors, []);
    assert.deepEqual(
      secondVisit.requestFailures,
      [],
      "the post-load warm leaves nothing for the second visit to fetch",
    );
  } finally {
    await second.close().catch(() => {});
  }
  mark("Second visit ever works offline without any priming", secondVisit);
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.failure = String(error);
  throw error;
} finally {
  await writeFile(CREDITS, creditsOriginal);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    "readiness/evidence/application/sw-smoke.json",
    JSON.stringify({ ...evidence, browser: browser.version() }, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify(
    {
      status: evidence.status,
      checks: checks.length,
      coldReadyMs: evidence.coldReadyMs,
      onlineReloadReadyMs: evidence.onlineReloadReadyMs,
      offlineReloadReadyMs: evidence.offlineReloadReadyMs,
      cachedEngineBytes: evidence.cachedEngineBytes,
    },
    null,
    2,
  ),
);
