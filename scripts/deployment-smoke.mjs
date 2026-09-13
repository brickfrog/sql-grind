import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:4173").origin;
const evidence = {
  date: new Date().toISOString(),
  origin,
  headers: [],
  screens: [],
  errors: [],
  externalRequests: [],
};
const html = await (await fetch(origin)).text();
const css = html.match(/href="([^"]+\.css)"/)[1],
  js = html.match(/src="([^"]+\.js)"/)[1];
assert.ok(
  js.startsWith("/assets/"),
  "Verify the built application, not the Vite development server",
);
// Subpath deployments (a GitHub project page at /<repo>/) break on any
// root-absolute runtime URL that skips assetUrl(). Manifest identities are
// allowed: they are looked up, not fetched.
{
  const files = ["src/App.svelte", "src/lib/catalog.ts"];
  for (const file of files) {
    // Drop assetUrl(...) call sites: those literals are resolved correctly.
    const remainder = (await readFile(file, "utf8")).replaceAll(
      /assetUrl\(\s*[^)]*\)/g,
      "",
    );
    const offender = remainder.match(
      /(["'`])(\/(?:assets|icons|bundle|data)\/[^"'`]*|\/icon-credits\.txt)\1/,
    );
    assert.equal(
      offender,
      null,
      `${file} uses ${offender?.[2]} without assetUrl(); a subpath deployment would 404`,
    );
  }
}
const assets = await (await fetch(origin + "/bundle/assets.json")).json();
const parquetPath = "/bundle/data/small-v1/orders.parquet";
const paths = [
  "/",
  css,
  js,
  "/bundle/assets.json",
  ...assets.files
    .filter(
      (a) =>
        a.path.includes("/engine/") ||
        a.path.includes("/extensions/") ||
        /^\/bundle\/(?:curriculum\.json$|challenges\/basics\.01\/|datasets\/commerce-practice\/)/.test(
          a.path,
        ),
    )
    .map((a) => a.path),
  parquetPath,
  "/assets/patchouli.webp",
  "/icons/folderDesktop.png",
];
for (const path of paths) {
  const response = await fetch(origin + path, { method: "HEAD" });
  assert.equal(response.status, 200, path);
  const headers = Object.fromEntries(response.headers);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /worker-src 'self'/);
  const expected = path.endsWith(".css")
    ? "text/css"
    : path.endsWith(".js")
      ? "text/javascript"
      : path.includes("/engine/") || path.includes("/extensions/")
        ? "application/wasm"
        : path.endsWith(".webp")
          ? "image/webp"
          : path.endsWith(".png")
            ? "image/png"
            : path.endsWith(".json")
              ? "application/json"
              : path.endsWith(".sql") || path.endsWith(".parquet")
                ? "application/octet-stream"
                : "text/html";
  assert.ok(headers["content-type"].startsWith(expected), path);
  evidence.headers.push({ path, status: response.status, headers });
}
const range = await fetch(origin + parquetPath, {
  headers: { Range: "bytes=0-3" },
});
assert.equal(range.status, 206);
assert.equal(await range.text(), "PAR1");
const parquetBytes = assets.files.find(
  (asset) => asset.path === parquetPath,
).bytes;
assert.equal(range.headers.get("content-range"), `bytes 0-3/${parquetBytes}`);
evidence.range = {
  status: 206,
  contentRange: range.headers.get("content-range"),
  magic: "PAR1",
};
assert.equal(
  (
    await fetch(origin + parquetPath, {
      headers: { Range: "bytes=99999999-" },
    })
  ).status,
  416,
);
assert.equal((await fetch(origin, { method: "POST" })).status, 405);
const browser = await chromium.launch({
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      evidence.externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.cspViolations.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
      }),
    );
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => evidence.errors.push(String(e)));
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
    await page.locator(".error-banner").allTextContents(),
  );
  await mkdir("readiness/evidence/application", { recursive: true });
  const shot = async (name) => {
    await page.screenshot({
      path: `readiness/evidence/application/${name}.png`,
      fullPage: true,
    });
    evidence.screens.push(name);
  };
  evidence.geometry = await page.evaluate(() => {
    let background = document.querySelector(".desktop");
    while (
      background &&
      getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)"
    )
      background = background.parentElement;
    return {
      desktop: getComputedStyle(background).backgroundColor,
      panes: [...document.querySelectorAll(".explorer,.goal")].map(
        (e) => e.getBoundingClientRect().width,
      ),
      titleGradient: getComputedStyle(document.querySelector(".ide>.titlebar"))
        .backgroundImage,
      chrome: getComputedStyle(document.querySelector(".ide")).backgroundColor,
    };
  });
  assert.deepEqual(evidence.geometry.panes, [220, 280]);
  assert.equal(evidence.geometry.desktop, "rgb(58, 110, 165)");
  await shot("desktop-floating");
  const styles = await page.evaluate(() => ({
    panel: {
      color: getComputedStyle(document.querySelector(".panel-heading")).color,
      background: getComputedStyle(document.querySelector(".panel-heading"))
        .backgroundColor,
    },
    caption: {
      color: getComputedStyle(document.querySelector(".window-title")).color,
      backing: getComputedStyle(document.querySelector(".window-title"))
        .backgroundColor,
    },
    syntax: [
      ...new Set(
        [...document.querySelectorAll(".cm-content span")]
          .filter((e) => e.textContent.trim())
          .map((e) => getComputedStyle(e).color),
      ),
    ],
  }));
  const rgb = (s) => s.match(/[\d.]+/g).map(Number);
  const luminance = (rgb) =>
    rgb
      .slice(0, 3)
      .map((c) => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const backing = rgb(styles.caption.backing),
    end = [166, 202, 240],
    captionBackground = end.map(
      (v, i) => v * (1 - backing[3]) + backing[i] * backing[3],
    );
  evidence.contrast = {
    panel: contrast(rgb(styles.panel.color), rgb(styles.panel.background)),
    captionWorstEndpoint: contrast(
      rgb(styles.caption.color),
      captionBackground,
    ),
    syntax: styles.syntax.map((color) => ({
      color,
      ratio: contrast(rgb(color), [255, 255, 229]),
    })),
  };
  assert.ok(evidence.contrast.panel >= 4.5);
  assert.ok(evidence.contrast.captionWorstEndpoint >= 4.5);
  assert.ok(evidence.contrast.syntax.every((s) => s.ratio >= 4.5));
  await page.locator(".toolbar .execute").click();
  await page.waitForFunction(
    () =>
      document.querySelector("[role=grid]") &&
      !document.querySelector(".toolbar .execute")?.disabled,
    null,
    { timeout: 45000 },
  );
  assert.ok(
    Number(await page.getByRole("grid").getAttribute("aria-rowcount")) > 1,
  );
  await page.getByRole("button", { name: "Dock judge", exact: true }).click();
  await page.locator("#judge-docked").waitFor();
  await shot("desktop-docked");
  await page.getByRole("tab", { name: "Skill Map.dag", exact: true }).click();
  await page.locator(".skill-node").first().waitFor();
  assert.equal(await page.locator(".skill-node").count(), 13);
  await shot("map-docked");
  await page.getByRole("button", { name: "Float judge", exact: true }).click();
  await page.locator("#judge-window").waitFor();
  await shot("map-floating");
  evidence.icons = await page
    .locator('img[src*="/icons/"]')
    .evaluateAll((elements) =>
      elements.map((e) => ({
        src: e.getAttribute("src"),
        native: [e.naturalWidth, e.naturalHeight],
        rendered: [
          e.getBoundingClientRect().width,
          e.getBoundingClientRect().height,
        ],
      })),
    );
  assert.ok(
    evidence.icons.every(
      (i) => i.native[0] === i.rendered[0] && i.native[1] === i.rendered[1],
    ),
    "Pixel icons must retain their native dimensions",
  );
  evidence.cspViolations = await page.evaluate(() => window.cspViolations);
  assert.deepEqual(evidence.cspViolations, []);
  assert.deepEqual(evidence.externalRequests, []);
  assert.deepEqual(evidence.errors, []);
  await writeFile(
    "readiness/evidence/application/deployment-smoke.json",
    JSON.stringify(
      { ...evidence, browser: browser.version(), pass: true },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS built localhost headers, byte ranges, offline runtime, geometry, contrast and four visual states",
  );
} catch (e) {
  await mkdir("readiness/evidence/application", { recursive: true });
  await writeFile(
    "readiness/evidence/application/deployment-failure.json",
    JSON.stringify({ ...evidence, failure: String(e) }, null, 2) + "\n",
  );
  throw e;
} finally {
  await browser.close();
}
