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
const ASSETS = scoped("bundle/assets.json");
const SHELL = scoped(".");
const PREFIX = "sql-grind-";
const META = `${PREFIX}meta`;
// Synthetic key. It only ever lives in META, so it cannot shadow a real file.
const VERSION_KEY = scoped("__sw_version__");
const assetCacheName = (version) => `${PREFIX}assets-${version}`;
const shellCacheName = (version) => `${PREFIX}shell-${version}`;
/**
 * Keyed by a digest of the bundle's own file hashes rather than by the deploy
 * version, because the two can disagree. bundleVersion is hand-set and
 * configurationHash covers the engine configuration only, so a content-only
 * deploy — rewording a challenge, correcting a declared type — changes neither.
 * A cache named after them would keep serving the superseded challenge.json
 * while bundle/manifest.json, which is network-first, came back fresh: a
 * permanent integrity failure whose only offered affordance, "Retry content",
 * refetches the same stale bytes and can never succeed.
 *
 * The engine keeps the version-named cache above, so correcting a sentence
 * costs kilobytes instead of re-downloading 47 MB.
 */
const bundleCacheName = (digest) => `${PREFIX}bundle-${digest}`;
const WARM_REQUEST = "sql-grind:warm";
const WARM_REPORT = "sql-grind:warmed";
// A deploy is picked up within this window of a service worker start-up. The
// shell is network-first regardless, so this only bounds how long a superseded
// engine cache survives.
const REVALIDATE_INTERVAL_MS = 60_000;
const PUBLIC = "public/";

/**
 * Cache-first content. Everything under /engine/ and /extensions/ is pinned by
 * version in the URL or by the engine's own version assertion.
 *
 * /bundle/ is hash-verified by the app but NOT content addressed: the paths
 * carry no hash, so a given URL's bytes change from deploy to deploy. That is
 * why it lives in its own digest-named cache. manifest.json and assets.json are
 * the roots of the hash chain and must follow the network, so a deploy is
 * observed instead of being masked by its own superseded index.
 */
function isImmutable(pathname) {
  const rel = pathname.slice(BASE.length);
  if (rel.startsWith("engine/") || rel.startsWith("extensions/")) return true;
  return isBundleContent(rel);
}

/** Bundle payload, excluding the two index files that must stay network-first. */
function isBundleContent(rel) {
  return (
    rel.startsWith("bundle/") &&
    rel !== "bundle/manifest.json" &&
    rel !== "bundle/assets.json"
  );
}

let lastManifest = null;
let statePromise = null;

async function fetchIndex(url, label) {
  // no-cache rather than no-store: a host that sends validators (GitHub Pages
  // sends ETags) answers 304, so the periodic check costs a round trip instead
  // of the body.
  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  return response.json();
}

async function fetchManifest() {
  const manifest = await fetchIndex(MANIFEST, "manifest");
  lastManifest = manifest;
  return manifest;
}

/** Names the engine caches: the deploy identity, not the content. */
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

/**
 * Names the bundle cache: a digest over the shipped bundle's own paths and
 * hashes, so any content change renames the cache and the superseded copy is
 * dropped instead of being served against a fresh index.
 *
 * Read from bundle/assets.json, not bundle/manifest.json: the manifest lists
 * the engine payload and the authored sources it was built from, and carries no
 * entry for any shipped /bundle/ URL. Digesting it would have produced one
 * constant name for every deploy — the same defect in new clothes. assets.json
 * is the index the app itself verifies against, and it is already network-first
 * for exactly this reason.
 *
 * Engine and extension entries are excluded, so an engine upgrade does not
 * evict the bundle and a content fix does not re-download 47 MB.
 */
async function contentDigestOf(index) {
  const files = Array.isArray(index?.files) ? index.files : [];
  const material = files
    .filter(
      (file) =>
        typeof file?.path === "string" &&
        isBundleContent(file.path.replace(/^\//, "")),
    )
    .map((file) => `${file.path}:${file.sha256 ?? file.bytes ?? ""}`)
    .sort()
    .join("\n");
  // An index naming no bundle content is a broken deploy. It degrades to a
  // constant name rather than throwing, because the engine's durability must
  // not depend on the content index — but sw-smoke asserts a real digest, so
  // this cannot ship unnoticed again.
  if (!material) return "none";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readStoredState() {
  try {
    const stored = await (await caches.open(META)).match(VERSION_KEY);
    if (!stored) return null;
    const record = await stored.json();
    if (typeof record?.version !== "string") return null;
    return record;
  } catch {
    return null;
  }
}

async function storeState(state) {
  try {
    await (
      await caches.open(META)
    ).put(
      VERSION_KEY,
      new Response(JSON.stringify({ ...state, checkedAt: Date.now() }), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch {
    // Best effort: a missing pointer only costs one manifest fetch next time.
  }
}

/**
 * Network truth. Rewrites the stored pointer and the memoised state.
 *
 * Both indexes are read together and in parallel: they are the two roots of the
 * hash chain, they are small, and this runs at most once per
 * REVALIDATE_INTERVAL_MS off a navigation's waitUntil.
 */
async function refreshState() {
  const [manifest, index] = await Promise.all([
    fetchManifest(),
    fetchIndex(ASSETS, "assets"),
  ]);
  const state = {
    version: versionOf(manifest),
    content: await contentDigestOf(index),
  };
  await storeState(state);
  statePromise = Promise.resolve(state);
  return state;
}

/**
 * The stored pointer is consulted first so an offline start-up can name its
 * caches without the network.
 *
 * A pointer written before the bundle cache was split carries no content
 * digest, so the network is consulted to learn one — that is what moves an
 * already-poisoned profile onto a correctly named bundle cache without asking
 * anyone to clear storage. If that fetch fails the version half is still
 * usable, and discarding it would strand a profile with 47 MB of engine in a
 * cache it had just decided not to name. LEGACY records exactly that state:
 * engine by version, bundle read from whichever cache already holds it.
 */
const LEGACY = "legacy";
function state() {
  if (!statePromise)
    statePromise = (async () => {
      const stored = await readStoredState();
      if (stored && typeof stored.content === "string")
        return { version: stored.version, content: stored.content };
      try {
        return await refreshState();
      } catch (error) {
        if (stored) return { version: stored.version, content: LEGACY };
        throw error;
      }
    })().catch((error) => {
      statePromise = null; // never memoise a failure
      throw error;
    });
  return statePromise;
}

async function stateOrNull() {
  try {
    return await state();
  } catch {
    return null;
  }
}

async function purgeForeignCaches() {
  const current = await stateOrNull();
  // Without a version we cannot name the replacement, so we keep what we have
  // rather than wiping an engine we may not be able to download again.
  if (!current) return [];
  // Under LEGACY the bundle's cache name is unknown, so every bundle cache is
  // kept: deleting the one that happens to hold this profile's content would
  // turn a working offline profile into a broken one.
  const keep = new Set([
    META,
    assetCacheName(current.version),
    shellCacheName(current.version),
    bundleCacheName(current.content),
  ]);
  const stale = (await caches.keys()).filter(
    (name) =>
      name.startsWith(PREFIX) &&
      !keep.has(name) &&
      !(current.content === LEGACY && name.startsWith(`${PREFIX}bundle-`)),
  );
  await Promise.all(stale.map((name) => caches.delete(name)));
  // Never while LEGACY: those entries are the only copy this profile can read.
  if (current.content !== LEGACY)
    await pruneLegacyBundleEntries(current.version);
  return stale;
}

let legacyPruned = false;
/**
 * One-time migration. Before the bundle cache was split out, /bundle/ content
 * was stored in the engine cache, which a content-only deploy never renames —
 * that is what left profiles serving a superseded challenge against a fresh
 * index. Those entries are unreachable now that bundle requests read their own
 * digest-named cache, so they are dead weight; a profile that was stuck
 * recovers by fetching fresh bytes and drops the copy that stranded it.
 *
 * Guarded by a flag rather than run per navigation: it is a keys() walk over
 * several hundred entries, and after the first pass there is nothing to find.
 */
async function pruneLegacyBundleEntries(version) {
  if (legacyPruned) return 0;
  legacyPruned = true;
  try {
    const cache = await caches.open(assetCacheName(version));
    const stale = (await cache.keys()).filter((request) =>
      isBundleContent(new URL(request.url).pathname.slice(BASE.length)),
    );
    await Promise.all(stale.map((request) => cache.delete(request)));
    return stale.length;
  } catch {
    return 0; // Reclaiming space is never worth failing a navigation over.
  }
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
      const stored = await readStoredState();
      if (
        !stored ||
        Date.now() - (stored.checkedAt ?? 0) > REVALIDATE_INTERVAL_MS
      )
        await refreshState().catch(() => {
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

/**
 * The durable cache a cache-first request belongs in, or null when the state
 * cannot name one.
 *
 * Under LEGACY a bundle URL has no nameable cache: the content may sit in the
 * pre-split engine cache or in a digest-named one this worker cannot compute
 * offline. Those reads fall back to a global match, which searches every cache,
 * and are deliberately not written back — storing under a guessed name is how
 * a superseded copy becomes permanent.
 */
async function cacheFor(url) {
  const current = await stateOrNull();
  if (!current) return null;
  if (!isBundleContent(url.pathname.slice(BASE.length)))
    return await caches.open(assetCacheName(current.version));
  if (current.content === LEGACY) return null;
  return await caches.open(bundleCacheName(current.content));
}

async function legacyBundleHit(url) {
  const current = await stateOrNull();
  if (current?.content !== LEGACY) return null;
  if (!isBundleContent(url.pathname.slice(BASE.length))) return null;
  try {
    return (await caches.match(url.href)) ?? null;
  } catch {
    return null;
  }
}

async function cacheFirst(event, url) {
  const href = url.href;
  const cache = await cacheFor(url);
  const hit = cache ? await cache.match(href) : await legacyBundleHit(url);
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
  const current = await stateOrNull();
  const cache = current
    ? await caches.open(shellCacheName(current.version))
    : null;
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
        const cache = await caches.open(
          shellCacheName((await state()).version),
        );
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
      await refreshState().catch(() => {});
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
  const current = await stateOrNull();
  const manifest =
    lastManifest ?? (await fetchManifest().catch(() => null)) ?? null;
  // LEGACY means the bundle cache cannot be named, which only happens with no
  // network; warming would create a junk cache and fetch nothing.
  if (current && current.content !== LEGACY) {
    const assets = await caches.open(assetCacheName(current.version));
    const bundle = await caches.open(bundleCacheName(current.content));
    const shell = await caches.open(shellCacheName(current.version));
    for (const [href, target] of warmTargets(manifest, resources)) {
      const pathname = new URL(href).pathname;
      const immutable = isImmutable(pathname);
      const durable = isBundleContent(pathname.slice(BASE.length))
        ? bundle
        : assets;
      const cache = immutable ? durable : shell;
      if (immutable) {
        // Whatever is stored under this name is already the right bytes: the
        // engine cache is named after the deploy and the bundle cache after a
        // digest of its own contents, so changed bytes arrive under a new name.
        if (await durable.match(href)) {
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
  report.version = current?.version ?? null;
  report.content = current?.content ?? null;
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
