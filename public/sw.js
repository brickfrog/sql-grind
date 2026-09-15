/**
 * SQL Grind service worker.
 *
 * WHY THIS EXISTS: a cold visit pulls ~46 MB of engine payload — duckdb-eh.wasm
 * (35.9 MB), duckdb-browser-eh.worker.js (773 KB) and three DuckDB extensions
 * (icu 6.4 MB, parquet 3.2 MB, json 821 KB). Without a worker those bytes live
 * only in the HTTP cache, which the browser may evict at any moment, for an app
 * that is meant to be opened daily and to work with the network switched off.
 * Cache Storage is durable by comparison and is the only place we can keep the
 * engine across evictions.
 *
 * SHAPE: this file is served verbatim from public/ (Vite copies publicDir
 * untouched), so it is plain classic-worker JavaScript with no imports and a
 * URL that is stable across deploys.
 *
 * CSP: no directive was added or weakened. `worker-src 'self'` already admits
 * this worker, every request it issues is same-origin (`connect-src 'self'`),
 * and cross-origin requests are deliberately passed through untouched below.
 *
 * SCOPE: everything is derived from self.registration.scope, so a GitHub
 * project page at /sql-grind/ behaves exactly like a site root.
 */

const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname.endsWith("/")
  ? SCOPE.pathname
  : `${SCOPE.pathname}/`;
const ROOT = `${SCOPE.origin}${BASE}`;
const scoped = (relative) => new URL(relative, ROOT).href;

const MANIFEST = scoped("bundle/manifest.json");
const SHELL = scoped(".");
const PREFIX = "sql-grind-";
const META = `${PREFIX}meta`;
// Synthetic key. It only ever lives in META, so it cannot shadow a real file.
const VERSION_KEY = scoped("__sw_version__");
const assetCacheName = (version) => `${PREFIX}assets-${version}`;
const shellCacheName = (version) => `${PREFIX}shell-${version}`;
const WARM_REQUEST = "sql-grind:warm";
const WARM_REPORT = "sql-grind:warmed";
// A deploy is picked up within this window of a service worker start-up. The
// shell is network-first regardless, so this only bounds how long a superseded
// engine cache survives.
const REVALIDATE_INTERVAL_MS = 60_000;
const PUBLIC = "public/";

/**
 * Immutable, hash-verified content. Everything under /engine/ and /extensions/
 * is pinned by version in the URL or by the engine's own version assertion, and
 * everything under /bundle/ is content addressed — except manifest.json and
 * assets.json, which are the roots of that hash chain. Those two must follow
 * the network so a deploy is observed instead of being masked by its own
 * superseded index.
 */
function isImmutable(pathname) {
  const rel = pathname.slice(BASE.length);
  if (rel.startsWith("engine/") || rel.startsWith("extensions/")) return true;
  return (
    rel.startsWith("bundle/") &&
    rel !== "bundle/manifest.json" &&
    rel !== "bundle/assets.json"
  );
}

let lastManifest = null;
let versionPromise = null;

async function fetchManifest() {
  // no-cache rather than no-store: a host that sends validators (GitHub Pages
  // sends ETags) answers 304, so the periodic check costs a round trip instead
  // of the manifest body.
  const response = await fetch(MANIFEST, {
    cache: "no-cache",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`manifest ${response.status}`);
  const manifest = await response.json();
  lastManifest = manifest;
  return manifest;
}

function versionOf(manifest) {
  const bundle =
    typeof manifest.bundleVersion === "string"
      ? manifest.bundleVersion
      : "unknown";
  const configuration =
    typeof manifest.configurationHash === "string"
      ? manifest.configurationHash
      : "";
  return `${bundle}-${configuration.slice(0, 16)}`.replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
}

async function readStoredVersion() {
  try {
    const stored = await (await caches.open(META)).match(VERSION_KEY);
    if (!stored) return null;
    const record = await stored.json();
    return typeof record?.version === "string" ? record : null;
  } catch {
    return null;
  }
}

async function storeVersion(version) {
  try {
    await (
      await caches.open(META)
    ).put(
      VERSION_KEY,
      new Response(JSON.stringify({ version, checkedAt: Date.now() }), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch {
    // Best effort: a missing pointer only costs one manifest fetch next time.
  }
}

/** Network truth. Rewrites the stored pointer and the memoised version. */
async function refreshVersion() {
  const version = versionOf(await fetchManifest());
  await storeVersion(version);
  versionPromise = Promise.resolve(version);
  return version;
}

/**
 * The stored pointer is consulted first so an offline start-up can name its
 * caches without the network.
 */
function version() {
  if (!versionPromise)
    versionPromise = (async () => {
      const stored = await readStoredVersion();
      return stored ? stored.version : await refreshVersion();
    })().catch((error) => {
      versionPromise = null; // never memoise a failure
      throw error;
    });
  return versionPromise;
}

async function versionOrNull() {
  try {
    return await version();
  } catch {
    return null;
  }
}

async function purgeForeignCaches() {
  const current = await versionOrNull();
  // Without a version we cannot name the replacement, so we keep what we have
  // rather than wiping an engine we may not be able to download again.
  if (!current) return [];
  const keep = new Set([
    META,
    assetCacheName(current),
    shellCacheName(current),
  ]);
  const stale = (await caches.keys()).filter(
    (name) => name.startsWith(PREFIX) && !keep.has(name),
  );
  await Promise.all(stale.map((name) => caches.delete(name)));
  return stale;
}

let checking = null;
/**
 * Runs off a navigation's waitUntil, never in its path. The version re-check
 * hits the network at most once per REVALIDATE_INTERVAL_MS (the timestamp is
 * persisted, so it survives worker restarts); the purge is a caches.keys()
 * scan, so it is cheap enough to run on every navigation — which is what
 * protects users, because sw.js itself rarely changes bytes and therefore
 * rarely installs again.
 */
async function revalidate() {
  if (!checking)
    checking = (async () => {
      const stored = await readStoredVersion();
      if (
        !stored ||
        Date.now() - (stored.checkedAt ?? 0) > REVALIDATE_INTERVAL_MS
      )
        await refreshVersion().catch(() => {
          // Offline: keep serving the version we already know.
        });
    })().finally(() => {
      checking = null;
    });
  await checking;
  await purgeForeignCaches();
}

async function store(cache, href, response) {
  try {
    await cache.put(href, response);
  } catch {
    // Quota or an unstorable response: caching is an optimisation, not a
    // correctness requirement.
  }
}

// Hrefs the fetch handler is currently streaming into a cache. Warming skips
// them so a page download and a warm download never race for the same 36 MB.
const inflight = new Set();

async function cacheFirst(event, url) {
  const href = url.href;
  const current = await versionOrNull();
  const cache = current ? await caches.open(assetCacheName(current)) : null;
  const hit = cache && (await cache.match(href));
  if (hit) return hit;
  const response = await fetch(event.request);
  if (cache && response.status === 200) {
    inflight.add(href);
    event.waitUntil(
      store(cache, href, response.clone()).finally(() => inflight.delete(href)),
    );
  }
  return response;
}

/**
 * Network-first for the document and the built application shell: a deploy must
 * always win, and the app's own SHA-256 verification cannot protect us from a
 * shell pinned to a superseded build. The cache is the offline fallback only.
 */
async function networkFirst(event, url) {
  const current = await versionOrNull();
  const cache = current ? await caches.open(shellCacheName(current)) : null;
  try {
    const response = await fetch(event.request);
    if (cache && response.status === 200 && response.type === "basic")
      event.waitUntil(store(cache, url.href, response.clone()));
    return response;
  } catch (error) {
    if (cache) {
      const hit =
        (await cache.match(url.href)) ||
        (event.request.mode === "navigate" ? await cache.match(SHELL) : null);
      if (hit) return hit;
    }
    throw error;
  }
}

self.addEventListener("install", (event) => {
  // Deliberately NOT precaching 46 MB here: install would block the first
  // visit's takeover on the whole engine, and one failed subresource would fail
  // the install outright. What is precached is the shell the first visit has
  // already started loading before clients.claim() can take effect — the
  // document plus the built module and stylesheet it names, a few hundred
  // kilobytes read straight out of the document's own markup rather than from
  // a build-time manifest. Without this the first visit's own <script> and
  // <link> loads race the claim and are simply missed, which would leave the
  // shell undurable until the next online visit.
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(shellCacheName(await version()));
        const response = await fetch(SHELL, { credentials: "same-origin" });
        if (response.status !== 200) return;
        const html = await response.clone().text();
        await store(cache, SHELL, response);
        const entries = new Set();
        for (const [, reference] of html.matchAll(
          /(?:src|href)="([^"]+\.(?:js|css))"/g,
        )) {
          const url = new URL(reference, SHELL);
          if (url.origin === SCOPE.origin && url.pathname.startsWith(BASE))
            entries.add(url.href);
        }
        await Promise.all(
          [...entries].map(async (href) => {
            try {
              const asset = await fetch(href, { credentials: "same-origin" });
              if (asset.status === 200) await store(cache, href, asset);
            } catch {
              // One missing shell asset is not worth failing the install over.
            }
          }),
        );
      } catch {
        // Install must never fail: the worker is useful even with a cold shell.
      }
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Claim first, so the visit that installed this worker already has its
      // engine downloads routed through the cache instead of only the next one.
      await self.clients.claim();
      await refreshVersion().catch(() => {});
      await purgeForeignCaches();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // POST/HEAD go straight to the host
  const url = new URL(request.url);
  // Cross-origin and out-of-scope requests are passed through untouched, which
  // keeps `connect-src 'self'` semantics observable: this worker never becomes
  // a way to reach anything the page could not reach itself.
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(BASE)) return;
  // Byte-range reads (parquet probes) are left to the host: Cache Storage
  // support for synthesising 206 responses is uneven across browsers, and the
  // static host answers ranges natively.
  if (request.headers.has("range")) return;
  if (request.mode === "navigate") event.waitUntil(revalidate());
  event.respondWith(
    isImmutable(url.pathname)
      ? cacheFirst(event, url)
      : networkFirst(event, url),
  );
});

let warming = null;

/**
 * Warms the durable caches after activation, driven by a message the page sends
 * once it has settled (see src/lib/service-worker.ts).
 *
 * WHY AFTER, NOT AT INSTALL: 46 MB on install would block the first visit's
 * takeover and fail wholesale on one bad subresource. Warming afterwards keeps
 * the first paint and the engine boot uncontended.
 *
 * WHAT: the engine payload named by bundle/manifest.json — including assets
 * this visit never asked for, such as the 6.4 MB icu extension — plus every
 * same-origin resource the page reports having actually loaded. The second list
 * is what makes the *next* visit work offline: a first visit loads its icons,
 * its bundle index and its datasets before clients.claim() can take effect, so
 * those requests are never seen by this worker and would otherwise be missing.
 * Reading them back from the page's resource timeline keeps that set honest
 * without a build-time precache manifest.
 *
 * Sequential and restartable on purpose: each immutable entry re-checks the
 * cache first, so a worker killed mid-warm simply resumes on the next visit,
 * and a single failure is recorded and stepped over instead of aborting.
 */
function warmEngine(resources) {
  if (!warming)
    warming = runWarm(resources).finally(() => {
      warming = null;
    });
  return warming;
}

function warmTargets(manifest, resources) {
  const targets = new Map();
  if (manifest && Array.isArray(manifest.files))
    for (const file of manifest.files) {
      const path = typeof file?.path === "string" ? file.path : "";
      if (!path.startsWith(PUBLIC)) continue; // readiness/ is not shipped
      const rel = path.slice(PUBLIC.length);
      targets.set(scoped(rel), { rel, bytes: Number(file.bytes) || 0 });
    }
  for (const resource of Array.isArray(resources) ? resources : []) {
    let url;
    try {
      url = new URL(resource, ROOT);
    } catch {
      continue;
    }
    if (url.origin !== SCOPE.origin || !url.pathname.startsWith(BASE)) continue;
    if (url.href === scoped("sw.js")) continue;
    if (!targets.has(url.href))
      targets.set(url.href, { rel: url.pathname.slice(BASE.length), bytes: 0 });
  }
  return targets;
}

async function runWarm(resources) {
  const report = {
    type: WARM_REPORT,
    assets: { warmed: [], present: [], skipped: [], bytes: 0 },
    shell: { stored: 0, bytes: 0 },
    failed: [],
  };
  const current = await versionOrNull();
  const manifest =
    lastManifest ?? (await fetchManifest().catch(() => null)) ?? null;
  if (current) {
    const assets = await caches.open(assetCacheName(current));
    const shell = await caches.open(shellCacheName(current));
    for (const [href, target] of warmTargets(manifest, resources)) {
      const immutable = isImmutable(new URL(href).pathname);
      const cache = immutable ? assets : shell;
      if (immutable) {
        // Content addressed: whatever is already stored is already correct.
        if (await assets.match(href)) {
          report.assets.present.push(target.rel);
          continue;
        }
        if (inflight.has(href)) {
          // The page is streaming it right now and the fetch handler stores
          // that response; downloading 36 MB a second time would be absurd.
          report.assets.skipped.push(target.rel);
          continue;
        }
      }
      try {
        // Default cache mode on purpose: right after a visit these bytes are
        // usually still in the HTTP cache, so warming costs little network.
        const response = await fetch(href, { credentials: "same-origin" });
        if (response.status !== 200) throw new Error(String(response.status));
        // Reported before the body is handed to the cache: measured figures,
        // with the manifest size only as a fallback.
        const bytes =
          Number(response.headers.get("content-length")) || target.bytes;
        await cache.put(href, response);
        if (immutable) {
          report.assets.warmed.push(target.rel);
          report.assets.bytes += bytes;
        } else {
          // Shell entries are refetched unconditionally: they are small, and
          // overwriting keeps the offline fallback as current as the last
          // online visit rather than as old as the first one.
          report.shell.stored += 1;
          report.shell.bytes += bytes;
        }
      } catch (error) {
        report.failed.push({ path: target.rel, error: String(error) });
      }
    }
  }
  report.version = current;
  for (const client of await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  }))
    client.postMessage(report);
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== WARM_REQUEST) return;
  event.waitUntil(warmEngine(event.data.resources));
});
