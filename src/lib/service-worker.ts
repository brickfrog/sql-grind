/**
 * Service worker registration.
 *
 * The worker itself is public/sw.js: it keeps the ~46 MB engine payload in
 * Cache Storage so a daily, offline-capable visit does not depend on the
 * evictable HTTP cache. This module is the page-side half — registration and
 * the one message that asks the worker to warm the engine once the visit has
 * settled.
 */

/** Asks the worker to warm this long after the page has finished loading. Late
 * enough that the engine boot and first paint never contend with it. */
const WARM_DELAY_MS = 6_000;
const WARM_REQUEST = "sql-grind:warm";

/**
 * Registers public/sw.js under the deployment's base path and schedules the
 * engine warm-up. Safe to call unconditionally: it returns immediately outside
 * a production build or without service worker support, and a registration
 * failure is swallowed — the app is fully functional without a worker, it just
 * loses offline durability.
 */
export function registerServiceWorker(): void {
  // Production only, and deliberately so: every existing smoke suite drives the
  // Vite development server, where module URLs are rewritten per session and
  // the suites assume nothing sits between the page and the server. A worker
  // there would cache development artefacts and change what those suites
  // observe, so `npm run dev` stays exactly as it was.
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  // Derived from BASE_URL, never hardcoded: the same build serves from a site
  // root and from a project page at /<repo>/.
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const scope = new URL(base, location.href);
  navigator.serviceWorker
    .register(new URL("sw.js", scope), { scope: scope.href })
    .then(scheduleWarm)
    .catch(() => {
      // Private browsing, an insecure origin or a storage refusal all land
      // here. There is nothing to report: the site works without the worker.
    });
}

/**
 * Asks the active worker to warm its durable caches, WARM_DELAY_MS after the
 * load event so the request lands while the tab is idle rather than mid-boot.
 *
 * The message carries every same-origin resource this visit actually loaded.
 * The worker cannot discover that set by itself: a first visit fetches its
 * icons, its bundle index and its datasets before clients.claim() takes
 * effect, so those requests never reach the worker and would be missing from
 * the cache on the next, possibly offline, visit. The resource timeline is the
 * honest answer to "what does this app need", with no build-time list to keep
 * in sync.
 */
function scheduleWarm(): void {
  const warm = () =>
    void setTimeout(() => {
      const resources = [
        ...new Set(
          performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => name.startsWith(`${location.origin}/`)),
        ),
      ];
      navigator.serviceWorker.ready
        .then((registration) =>
          registration.active?.postMessage({ type: WARM_REQUEST, resources }),
        )
        .catch(() => {});
    }, WARM_DELAY_MS);
  if (document.readyState === "complete") warm();
  else addEventListener("load", warm, { once: true });
}
