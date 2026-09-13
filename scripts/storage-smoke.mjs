import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appURL = process.env.APP_URL ?? "http://127.0.0.1:5173";
const evidenceDirectory = "readiness/evidence/application";
const evidence = {
  suite: "actual-storage-module",
  appURL,
  startedAt: new Date().toISOString(),
  cases: [],
};
const contexts = [];
let browser;
let currentCase = "launch";

async function bounded(promise, label, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function evaluate(page, fn, argument) {
  return bounded(page.evaluate(fn, argument), currentCase);
}
function record(name, observations, injection = null) {
  evidence.cases.push({ name, status: "passed", injection, observations });
}
async function freshPage(context) {
  if (!context) {
    context = await browser.newContext();
    contexts.push(context);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  // A same-origin empty surface imports the production module without mounting
  // the app, whose initial autosaves would make the database no longer fresh.
  await page.route("**/__storage_smoke__", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Storage smoke</title>",
    }),
  );
  await page.goto(new URL("/__storage_smoke__", appURL).href, {
    waitUntil: "domcontentloaded",
  });
  await evaluate(page, async () => {
    const module = await import("/src/lib/storage.ts");
    const { defaultSettings } = await import("/src/lib/types.ts");
    const h = (globalThis.storageSmoke = {
      module,
      defaultSettings,
      stores: [],
      messages: [],
      name: "sql-grind-practice",
      storeNames: [
        "attempts",
        "drafts",
        "meta",
        "progress",
        "queries",
        "settings",
      ],
    });
    h.request = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    h.open = async () => {
      const store = await module.openPracticeStore(
        (message) => h.messages.push(message),
        () => {},
      );
      h.stores.push(store);
      return store;
    };
    h.closeStores = () => {
      for (const store of h.stores) store.close();
      h.stores.length = 0;
    };
    h.rawSnapshot = async () => {
      const db = await h.request(indexedDB.open(h.name));
      try {
        const names = [...db.objectStoreNames];
        const tx = db.transaction(names, "readonly");
        const complete = new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        const [, rows] = await Promise.all([
          complete,
          Promise.all(
            names.map((name) => h.request(tx.objectStore(name).getAll())),
          ),
        ]);
        return {
          version: db.version,
          stores: names,
          data: Object.fromEntries(names.map((name, i) => [name, rows[i]])),
        };
      } finally {
        db.close();
      }
    };
    h.deleteDatabase = async () => {
      h.closeStores();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(h.name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("Smoke cleanup database deletion was blocked"));
      });
    };
    h.error = async (action) => {
      try {
        await action();
        return null;
      } catch (error) {
        return {
          name: error.name,
          message: error.message,
          ...(error.currentDocument
            ? { currentDocument: error.currentDocument }
            : {}),
          ...(error.recoveredDocument
            ? { recoveredDocument: error.recoveredDocument }
            : {}),
        };
      }
    };
    h.identity = {
      challengeId: "window.03",
      bundleVersion: "window.03-bundle-v2",
      challengeVersion: "challenge-07-v1",
      datasetVersion: "small-v1",
      assessmentVersion: "exact-v1",
      engineVersion: "v1.5.4",
    };
    h.document = (id, sql, name = id) => ({
      id,
      name,
      sql,
      revision: 1,
      version: 0,
      selection: { anchor: 2, head: Math.min(9, sql.length) },
      scrollTop: 37.5,
      updatedAt: Date.now(),
      challenge: { ...h.identity },
      datasetId: "commerce-ranking",
      saved: true,
    });
    h.attempt = (id, document, correctness, createdAt) => ({
      id,
      documentId: document.id,
      revision: document.revision,
      sql: document.sql,
      challenge: { ...document.challenge },
      datasetId: document.datasetId,
      createdAt,
      outcome: "complete",
      correctness,
      hintLevel: 0,
      elapsedMs: 12.5,
      message: correctness === "correct" ? "Accepted" : "Wrong answer",
    });
    h.backup = async (payload, version = 2) => {
      const encoded = JSON.stringify(payload);
      const sha256 = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(encoded),
          ),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return JSON.stringify({
        format: h.name,
        formatVersion: version,
        exportedAt: "2026-01-01T00:00:00.000Z",
        applicationVersion: "0.1.0",
        ...(version === 1 ? { contentVersions: h.legacyVersions } : {}),
        payload: encoded,
        sha256,
      });
    };
    h.legacyVersions = {
      bundleVersion: "readiness-07-v1",
      challengeVersion: "challenge-07-v1",
      datasetVersion: "small-v1",
      engineVersion: "v1.5.4",
    };
    h.legacyFixture = () => {
      const timestamp = "2025-01-01T00:00:00.000Z";
      const { challenge, datasetId, ...document } = h.document(
        "legacy-window",
        "SELECT 7 AS original;",
      );
      const { engineVersion, ...versions } = h.legacyVersions;
      const query = {
        ...document,
        ...versions,
        challengeId: "challenge-07",
        version: 7,
        revision: 9,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const removed = {
        ...query,
        id: "legacy-removed",
        name: "Removed",
        deletedAt: timestamp,
      };
      const unknown = {
        ...query,
        id: "legacy-unknown",
        challengeId: "unpublished.77",
        engineVersion: "v1.4.0",
      };
      const attempt = {
        id: "legacy-pass",
        documentId: query.id,
        revision: 8,
        sql: "SELECT 6 AS submitted;",
        challengeId: "challenge-07",
        ...h.legacyVersions,
        createdAt: timestamp,
        outcome: "complete",
        correctness: "correct",
        hintLevel: 2,
        elapsedMs: 10,
        message: "Original accepted outcome",
        conceptOutcome: "not-evaluated",
        documentDeleted: false,
      };
      return {
        meta: [
          {
            id: "profile",
            schemaVersion: 1,
            backupFormatVersion: 1,
            installationId: "legacy-installation",
            contentVersions: h.legacyVersions,
            lastExportAt: timestamp,
          },
        ],
        queries: [query, removed, unknown],
        drafts: [
          {
            id: "legacy-draft",
            queryId: query.id,
            sessionId: "old-session",
            document: { ...query, sql: "SELECT 8 AS unsaved;", revision: 10 },
            persistedAt: timestamp,
          },
        ],
        attempts: [attempt],
        progress: [
          {
            id: JSON.stringify(["challenge-07", "readiness-07-v1"]),
            challengeId: "challenge-07",
            bundleVersion: "readiness-07-v1",
            hintLevel: 3,
            reviewStatus: "preview-no-mastery",
            conceptOutcome: "not-evaluated",
            acceptedAttemptId: attempt.id,
            completedAt: timestamp,
            assistance: "assisted",
          },
        ],
        settings: [
          {
            id: "preferences",
            value: { ...h.defaultSettings, wordWrap: true },
          },
          {
            id: "session",
            value: { openIds: [unknown.id, query.id], activeId: query.id },
          },
        ],
      };
    };
    h.seedV1 = async (payload) => {
      const opening = indexedDB.open(h.name, 1);
      opening.onupgradeneeded = () => {
        for (const name of h.storeNames) {
          const store = opening.result.createObjectStore(name, {
            keyPath: "id",
          });
          for (const row of payload[name]) store.put(row);
        }
      };
      const db = await h.request(opening);
      db.close();
    };
  });
  return page;
}

try {
  browser = await chromium.launch({ headless: true });
  currentCase = "fresh six-store database";
  const page = await freshPage();
  const fresh = await evaluate(page, async () => {
    const h = storageSmoke;
    h.store = await h.open();
    return { raw: await h.rawSnapshot(), profile: await h.store.load() };
  });
  assert.equal(fresh.raw.version, 2);
  assert.deepEqual(fresh.raw.stores, [
    "attempts",
    "drafts",
    "meta",
    "progress",
    "queries",
    "settings",
  ]);
  for (const rows of Object.values(fresh.raw.data)) assert.deepEqual(rows, []);
  assert.deepEqual(fresh.profile.documents, []);
  assert.deepEqual(fresh.profile.session, {
    openIds: [],
    activeId: "",
    openedSkillIds: [],
  });
  record(currentCase, fresh);

  currentCase =
    "document draft selection settings hints and session persistence";
  const saved = await evaluate(page, async () => {
    const h = storageSmoke;
    h.first = await h.store.saveDocument(
      h.document("query-primary", "SELECT 7 AS accepted;"),
      0,
    );
    h.second = await h.store.saveDocument(
      { ...h.document("query-draft", "SELECT 8 AS draft;"), saved: false },
      0,
    );
    h.preferences = {
      ...h.defaultSettings,
      hush: true,
      fontSize: 19,
      wordWrap: true,
      mood: "gentle",
      judgeSize: "auto",
    };
    await h.store.saveSettings(h.preferences);
    await h.store.revealHint(h.identity, 2);
    await h.store.revealHint(h.identity, 1);
    await h.store.markSkillOpened("window");
    await h.store.saveSession({
      openIds: [h.second.id, h.first.id],
      activeId: h.first.id,
      openedSkillIds: [],
    });
    return {
      first: h.first,
      second: h.second,
      settings: h.preferences,
      profile: await h.store.load(),
      raw: await h.rawSnapshot(),
    };
  });
  assert.equal(saved.first.version, 1);
  assert.equal(saved.second.saved, false);
  // Retired preferences (mood, judgeSize) load without error and are dropped,
  // so the next save removes them from the stored row.
  const { mood, judgeSize, ...current } = saved.settings;
  assert.deepEqual(saved.profile.settings, current);
  assert.equal("mood" in saved.profile.settings, false);
  assert.equal("judgeSize" in saved.profile.settings, false);
  assert.equal(
    saved.profile.hints[JSON.stringify(["window.03", "window.03-bundle-v2"])],
    2,
  );
  assert.deepEqual(saved.profile.session, {
    openIds: ["query-draft", "query-primary"],
    activeId: "query-primary",
    openedSkillIds: ["window"],
  });
  for (const document of [saved.first, saved.second]) {
    assert.deepEqual(
      saved.profile.documents.find((row) => row.id === document.id),
      document,
    );
    const draft = saved.raw.data.drafts.find(
      (row) => row.queryId === document.id,
    );
    assert.equal(draft.document.sql, document.sql);
    assert.deepEqual(draft.document.selection, document.selection);
    assert.equal(draft.document.scrollTop, document.scrollTop);
  }
  // Close all module instances, then actually reload the page and module.
  await evaluate(page, () => storageSmoke.closeStores());
  await page.reload({ waitUntil: "domcontentloaded" });
  const reloaded = await evaluate(page, async () => {
    const module = await import("/src/lib/storage.ts");
    const store = await module.openPracticeStore(
      () => {},
      () => {},
    );
    try {
      return await store.load();
    } finally {
      store.close();
    }
  });
  assert.deepEqual(reloaded, saved.profile);
  record(currentCase, { saved, afterPageReload: reloaded });

  // Rebootstrap on a new blank page in the same isolated browser context.
  await page.close();
  const work = await freshPage(contexts[0]);
  await evaluate(work, async () => {
    const h = storageSmoke;
    h.store = await h.open();
    h.first = (await h.store.load()).documents.find(
      (row) => row.id === "query-primary",
    );
  });

  currentCase = "optimistic conflict keeps both SQL drafts";
  const conflict = await evaluate(work, async () => {
    const h = storageSmoke;
    h.other = await h.open();
    const stale = (await h.other.load()).documents.find(
      (row) => row.id === h.first.id,
    );
    h.first = await h.store.saveDocument(
      { ...h.first, sql: "SELECT 70 AS winning_tab;", revision: 2 },
      h.first.version,
    );
    const losingSQL = "SELECT 71 AS losing_tab;";
    const error = await h.error(() =>
      h.other.saveDocument(
        { ...stale, sql: losingSQL, revision: 2 },
        stale.version,
      ),
    );
    return {
      error,
      winning: h.first,
      losingSQL,
      profile: await h.store.load(),
      raw: await h.rawSnapshot(),
    };
  });
  assert.equal(conflict.error?.name, "DocumentConflictError");
  assert.deepEqual(conflict.error.currentDocument, conflict.winning);
  assert.notEqual(conflict.error.recoveredDocument.id, conflict.winning.id);
  assert.equal(conflict.error.recoveredDocument.sql, conflict.losingSQL);
  assert.equal(conflict.error.recoveredDocument.saved, false);
  assert.equal(
    conflict.profile.documents.find((row) => row.id === conflict.winning.id)
      .sql,
    conflict.winning.sql,
  );
  assert.deepEqual(
    conflict.profile.documents.find(
      (row) => row.id === conflict.error.recoveredDocument.id,
    ),
    conflict.error.recoveredDocument,
  );
  assert.equal(
    conflict.raw.data.drafts.find(
      (row) => row.queryId === conflict.error.recoveredDocument.id,
    ).document.sql,
    conflict.losingSQL,
  );
  record(currentCase, conflict);

  currentCase =
    "accepted progress survives later failure and recomputes on deletion";
  const progress = await evaluate(work, async () => {
    const h = storageSmoke;
    const date = Date.parse("2026-01-01T00:00:00.000Z");
    h.accepted = h.attempt("attempt-accepted", h.first, "correct", date);
    await h.store.recordAttempt(h.accepted);
    h.closeStores();
    h.store = await h.open();
    const accepted = await h.rawSnapshot();
    const loaded = await h.store.load();
    await h.store.recordAttempt(
      h.attempt("attempt-failed", h.first, "incorrect", date + 1000),
    );
    const afterFailure = await h.rawSnapshot();
    await h.store.deleteAttempt(h.accepted.id);
    const afterDeletion = await h.rawSnapshot();
    await h.store.recordAttempt(h.accepted);
    return { accepted, loaded, afterFailure, afterDeletion };
  });
  const acceptedProgress = progress.accepted.data.progress.find(
    (row) => row.challengeId === "window.03",
  );
  assert.equal(acceptedProgress.acceptedAttemptId, "attempt-accepted");
  assert.equal(acceptedProgress.completedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(acceptedProgress.assistance, "independent");
  assert.equal(
    progress.loaded.attempts.find((row) => row.id === "attempt-accepted")
      .correctness,
    "correct",
  );
  assert.deepEqual(
    progress.afterFailure.data.progress,
    progress.accepted.data.progress,
  );
  assert.equal(
    progress.afterFailure.data.attempts.find(
      (row) => row.id === "attempt-failed",
    ).correctness,
    "incorrect",
  );
  const revoked = progress.afterDeletion.data.progress.find(
    (row) => row.challengeId === "window.03",
  );
  assert.equal(Object.hasOwn(revoked, "acceptedAttemptId"), false);
  assert.equal(Object.hasOwn(revoked, "completedAt"), false);
  assert.equal(Object.hasOwn(revoked, "assistance"), false);
  assert.equal(revoked.hintLevel, 2);
  assert.deepEqual(
    progress.afterDeletion.data.attempts.map((row) => row.id),
    ["attempt-failed"],
  );
  record(currentCase, progress);

  currentCase = "soft delete restore identity and session pruning";
  const deletion = await evaluate(work, async () => {
    const h = storageSmoke;
    const before = (await h.store.load()).documents.find(
      (row) => row.id === h.first.id,
    );
    await h.store.deleteDocument(before.id);
    const deleted = await h.store.load();
    const invalidSession = await h.error(() =>
      h.store.saveSession({
        openIds: [before.id],
        activeId: before.id,
        openedSkillIds: [],
      }),
    );
    await h.store.restoreDocument(before.id);
    const restored = await h.store.load();
    h.first = restored.documents.find((row) => row.id === before.id);
    await h.store.saveSession({
      openIds: [h.first.id, "query-draft"],
      activeId: h.first.id,
      openedSkillIds: [],
    });
    return { before, deleted, invalidSession, restored };
  });
  const deleted = deletion.deleted.documents.find(
    (row) => row.id === deletion.before.id,
  );
  const restored = deletion.restored.documents.find(
    (row) => row.id === deletion.before.id,
  );
  assert.equal(deleted.sql, deletion.before.sql);
  assert.equal(typeof deleted.deletedAt, "number");
  assert.equal(deleted.version, deletion.before.version + 1);
  assert.equal(deletion.deleted.session.openIds.includes(deleted.id), false);
  assert.equal(deletion.deleted.session.activeId, "query-draft");
  assert.equal(deletion.invalidSession?.name, "SessionConflictError");
  assert.equal(restored.id, deletion.before.id);
  assert.equal(restored.sql, deletion.before.sql);
  assert.equal(restored.name, deletion.before.name);
  assert.equal(restored.version, deletion.before.version + 2);
  assert.equal(Object.hasOwn(restored, "deletedAt"), false);
  assert.deepEqual(deletion.restored.attempts, deletion.deleted.attempts);
  record(currentCase, deletion);

  currentCase = "quota failure atomically rolls back a real write transaction";
  const quota = await evaluate(work, async () => {
    const h = storageSmoke;
    const before = await h.rawSnapshot();
    const original = IDBObjectStore.prototype.put;
    let injected = 0;
    let precedingQueryWrites = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (
        this.transaction.mode === "readwrite" &&
        this.transaction.db.name === h.name
      ) {
        if (this.name === "queries") precedingQueryWrites++;
        if (this.name === "drafts") {
          injected++;
          throw new DOMException(
            "Injected quota failure after query write",
            "QuotaExceededError",
          );
        }
      }
      return Reflect.apply(original, this, args);
    };
    let error;
    try {
      error = await h.error(() =>
        h.store.saveDocument(
          { ...h.first, sql: "SELECT 999 AS must_rollback;", revision: 3 },
          h.first.version,
        ),
      );
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    return {
      error,
      injected,
      precedingQueryWrites,
      before,
      after: await h.rawSnapshot(),
    };
  });
  assert.equal(quota.error?.name, "QuotaExceededError");
  assert.equal(quota.injected, 1);
  assert.equal(quota.precedingQueryWrites, 1);
  assert.deepEqual(quota.after, quota.before);
  record(
    currentCase,
    quota,
    "IDBObjectStore.put throws QuotaExceededError on drafts after the real queries.put succeeds; native transaction abort and persistence are exercised.",
  );

  currentCase = "backup roundtrip into a clean browser database";
  const portable = await evaluate(work, async () => {
    const h = storageSmoke;
    const backup = await h.store.exportBackup();
    return {
      backup,
      profile: await h.store.load(),
      raw: await h.rawSnapshot(),
    };
  });
  assert.equal(JSON.parse(portable.backup).formatVersion, 2);
  const importedPage = await freshPage();
  const roundtrip = await evaluate(
    importedPage,
    async (backup) => {
      const h = storageSmoke;
      h.store = await h.open();
      const empty = await h.rawSnapshot();
      await h.store.importBackup(backup);
      h.closeStores();
      h.store = await h.open();
      return {
        empty,
        profile: await h.store.load(),
        raw: await h.rawSnapshot(),
      };
    },
    portable.backup,
  );
  for (const rows of Object.values(roundtrip.empty.data))
    assert.deepEqual(rows, []);
  assert.deepEqual(roundtrip.profile, portable.profile);
  assert.deepEqual(roundtrip.raw, portable.raw);
  record(currentCase, {
    roundtrip,
    exportedBytes: Buffer.byteLength(portable.backup),
  });

  currentCase =
    "backup merge remaps conflicting query attempt draft and progress references";
  const mergePage = await freshPage();
  const merge = await evaluate(
    mergePage,
    async (backup) => {
      const h = storageSmoke;
      h.store = await h.open();
      const local = await h.store.saveDocument(
        h.document("query-primary", "SELECT 1000 AS local_only;"),
        0,
      );
      await h.store.recordAttempt(
        h.attempt(
          "attempt-accepted",
          local,
          "incorrect",
          Date.parse("2025-01-01T00:00:00.000Z"),
        ),
      );
      const before = await h.rawSnapshot();
      await h.store.importBackup(backup);
      return {
        local,
        before,
        profile: await h.store.load(),
        raw: await h.rawSnapshot(),
      };
    },
    portable.backup,
  );
  const importedQuery = merge.profile.documents.find(
    (row) => row.sql === conflict.winning.sql,
  );
  assert.ok(importedQuery);
  assert.notEqual(importedQuery.id, "query-primary");
  assert.deepEqual(
    merge.profile.documents.find((row) => row.id === "query-primary"),
    merge.local,
  );
  const importedAttempt = merge.raw.data.attempts.find(
    (row) => row.correctness === "correct",
  );
  assert.ok(importedAttempt);
  assert.notEqual(importedAttempt.id, "attempt-accepted");
  assert.equal(importedAttempt.documentId, importedQuery.id);
  assert.equal(importedAttempt.sql, conflict.winning.sql);
  assert.deepEqual(
    merge.raw.data.attempts.find((row) => row.id === "attempt-accepted"),
    merge.before.data.attempts[0],
  );
  assert.equal(
    merge.raw.data.progress.find((row) => row.challengeId === "window.03")
      .acceptedAttemptId,
    importedAttempt.id,
  );
  assert.equal(merge.profile.session.activeId, importedQuery.id);
  assert.deepEqual(merge.profile.session.openIds, [
    importedQuery.id,
    "query-draft",
  ]);
  const importedDrafts = merge.raw.data.drafts.filter(
    (row) => row.queryId === importedQuery.id,
  );
  assert.ok(
    importedDrafts.some((row) => row.document.sql === conflict.winning.sql),
  );
  for (const draft of importedDrafts)
    assert.equal(draft.document.id, importedQuery.id);
  for (const draft of merge.raw.data.drafts)
    assert.ok(merge.raw.data.queries.some((row) => row.id === draft.queryId));
  // Importing into the source database after changing its query also collides
  // draft IDs, unlike the independent-context merge above.
  const draftCollision = await evaluate(
    work,
    async (backup) => {
      const h = storageSmoke;
      h.first = await h.store.saveDocument(
        { ...h.first, sql: "SELECT 2000 AS after_export;", revision: 4 },
        h.first.version,
      );
      const before = await h.rawSnapshot();
      await h.store.importBackup(backup);
      return { before, after: await h.rawSnapshot() };
    },
    portable.backup,
  );
  for (const draft of draftCollision.before.data.drafts)
    assert.deepEqual(
      draftCollision.after.data.drafts.find((row) => row.id === draft.id),
      draft,
    );
  const remappedDraftQuery = draftCollision.after.data.queries.find(
    (row) => row.id !== "query-primary" && row.sql === conflict.winning.sql,
  );
  assert.ok(remappedDraftQuery);
  const newDrafts = draftCollision.after.data.drafts.filter(
    (row) =>
      !draftCollision.before.data.drafts.some((old) => old.id === row.id),
  );
  assert.ok(
    newDrafts.some(
      (row) =>
        row.queryId === remappedDraftQuery.id &&
        row.document.sql === conflict.winning.sql,
    ),
  );
  for (const draft of newDrafts) assert.equal(draft.document.id, draft.queryId);
  record(currentCase, { merge, draftCollision });

  currentCase =
    "malicious malformed checksum and relational backups reject atomically";
  const rejected = await evaluate(
    importedPage,
    async (backup) => {
      const h = storageSmoke;
      const signed = async (payload) => {
        const envelope = JSON.parse(backup);
        envelope.payload =
          typeof payload === "string" ? payload : JSON.stringify(payload);
        envelope.sha256 = [
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(envelope.payload),
            ),
          ),
        ]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        return JSON.stringify(envelope);
      };
      const payload = JSON.parse(JSON.parse(backup).payload);
      const malformed = structuredClone(payload);
      malformed.queries[0].selection.anchor = -1;
      const dangling = structuredClone(payload);
      dangling.drafts[0].queryId = "missing-parent";
      dangling.drafts[0].document.id = "missing-parent";
      const corrupt = JSON.parse(backup);
      corrupt.payload += " ";
      const unsafe = JSON.stringify(payload).replace(
        '"queries":',
        '"__proto__":{"polluted":true},"queries":',
      );
      const cases = [
        ["malformed-json", "{"],
        ["corrupt-checksum", JSON.stringify(corrupt)],
        ["malformed-record-valid-checksum", await signed(malformed)],
        ["dangling-reference-valid-checksum", await signed(dangling)],
        ["unsafe-property-valid-checksum", await signed(unsafe)],
      ];
      const results = [];
      for (const [name, input] of cases) {
        const before = await h.rawSnapshot();
        const error = await h.error(() => h.store.importBackup(input));
        results.push({
          name,
          error,
          before,
          after: await h.rawSnapshot(),
          polluted: Object.prototype.polluted ?? null,
        });
      }
      return results;
    },
    portable.backup,
  );
  for (const result of rejected) {
    assert.equal(result.error?.name, "BackupValidationError", result.name);
    assert.deepEqual(result.after, result.before, result.name);
    assert.equal(result.polluted, null);
  }
  record(currentCase, rejected);

  currentCase = "lab documents and immutable accepted evidence survive backup";
  const labStoragePage = await freshPage();
  const labStorage = await evaluate(labStoragePage, async () => {
    const h = storageSmoke;
    const { sqlHash } = await import("/src/lib/engine-labs.ts");
    const { challengeCompleted } = await import("/src/lib/progression.ts");
    h.store = await h.open();
    const identity = {
      ...h.identity,
      challengeId: "plan.01",
      bundleVersion: "plan.01-bundle-v1",
      challengeVersion: "plan.01-v1",
      datasetVersion: "commerce-practice-v1",
      assessmentVersion: "plan-lab-v1",
    };
    const document = await h.store.saveDocument(
      {
        ...h.document("lab-document", "SELECT 1 AS n;"),
        challenge: identity,
        datasetId: "commerce-practice",
        lab: {
          kind: "cardinality",
          report: { outputRows: "1", scanRows: "not-reported" },
        },
      },
      0,
    );
    const assessment = {
      kind: "plan-lab",
      report: document.lab,
      evidence: {
        kind: "cardinality",
        binding: {
          identity,
          datasetId: document.datasetId,
          variantId: "boundary",
          sqlHashes: { primary: await sqlHash(document.sql) },
        },
        fixtures: [{ variantId: "boundary", slot: "primary", pass: true }],
        primary: {
          count: 1,
          profile: {
            scans: [
              {
                path: "profile",
                operator: "SEQ_SCAN",
                table: "customers",
                leaf: true,
                accessPath: "sequential",
              },
            ],
          },
        },
      },
    };
    const attempt = {
      ...h.attempt(
        "lab-accepted",
        document,
        "correct",
        Date.parse("2026-01-01T00:00:00.000Z"),
      ),
      assessment,
    };
    // A changed document must not replace an already captured run identity.
    const nextIdentity = { ...identity, assessmentVersion: "plan-lab-v2" };
    await h.store.saveDocument(
      { ...document, challenge: nextIdentity },
      document.version,
    );
    await h.store.recordAttempt(attempt);
    await h.store.recordAttempt(attempt);
    const conflict = await h.error(() =>
      h.store.recordAttempt({ ...attempt, sql: "SELECT 2 AS n;" }),
    );
    const stale = {
      ...attempt,
      id: "lab-stale",
      challenge: nextIdentity,
      sql: "SELECT 2 AS n;",
      correctness: "incorrect",
    };
    await h.store.recordAttempt(stale);
    const profile = await h.store.load();
    const backup = await h.store.exportBackup();
    const malformed = JSON.parse(JSON.parse(backup).payload);
    malformed.attempts[0].assessment.evidence.primary.profile.scans[0].rowsScanned =
      "unknown";
    const before = await h.rawSnapshot();
    const rejected = await h.error(async () =>
      h.store.importBackup(await h.backup(malformed)),
    );
    const after = await h.rawSnapshot();
    await h.store.clearPracticeData();
    await h.store.importBackup(backup);
    return {
      document,
      attempt,
      stale,
      profile,
      restored: await h.store.load(),
      conflict,
      rejected,
      before,
      after,
      oldCompleted: challengeCompleted(identity, profile.attempts),
      newCompleted: challengeCompleted(nextIdentity, profile.attempts),
    };
  });
  assert.deepEqual(labStorage.profile.attempts, [
    labStorage.attempt,
    labStorage.stale,
  ]);
  assert.deepEqual(labStorage.restored, labStorage.profile);
  assert.deepEqual(
    labStorage.restored.documents[0].lab,
    labStorage.document.lab,
  );
  assert.equal(labStorage.oldCompleted, true);
  assert.equal(labStorage.newCompleted, false);
  assert.equal(labStorage.conflict?.name, "BackupValidationError");
  assert.equal(labStorage.rejected?.name, "BackupValidationError");
  assert.deepEqual(labStorage.after, labStorage.before);
  assert.equal(
    Object.hasOwn(
      labStorage.restored.attempts[0].assessment.evidence.primary.profile
        .scans[0],
      "rowsScanned",
    ),
    false,
  );
  record(currentCase, labStorage);

  currentCase =
    "real capstone evidence survives storage and rejects lossy facts";
  const reconciliationPage = await freshPage();
  const reconciliationStorage = await evaluate(reconciliationPage, async () => {
    const h = storageSmoke;
    const { assessReconciliation, validateReconciliationTruth } = await import(
      "/src/lib/reconciliation.ts"
    );
    const { validateExpected } = await import("/src/lib/engine-results.ts");
    const definition = await (
      await fetch("/bundle/challenges/reconcile.05/challenge.json")
    ).json();
    const variantId = "boundary-v1";
    const fixture = await (await fetch(definition.expected[variantId])).json();
    const truth = validateReconciliationTruth(
      await (await fetch(definition.assessment.truth[variantId])).json(),
    );
    const answer = validateExpected(fixture, definition.output, {
      identity: fixture.identity,
      datasetId: definition.datasetId,
      variantId,
    });
    const metrics = assessReconciliation(answer, truth);
    h.store = await h.open();
    const document = await h.store.saveDocument(
      {
        ...h.document(
          "capstone-document",
          await (await fetch(definition.reference)).text(),
        ),
        challenge: fixture.identity,
        datasetId: definition.datasetId,
      },
      0,
    );
    const attempt = {
      ...h.attempt(
        "capstone-accepted",
        document,
        "correct",
        Date.parse("2026-01-01T00:00:00.000Z"),
      ),
      assessment: {
        kind: "reconciliation",
        variants: [{ variantId, metrics }],
      },
    };
    await h.store.recordAttempt(attempt);
    const backup = await h.store.exportBackup();
    const malformed = JSON.parse(JSON.parse(backup).payload);
    const fact =
      malformed.attempts[0].assessment.variants[0].metrics.evidence.find(
        (row) => row.facts.length,
      ).facts[0];
    fact.quantityDifference = 9007199254740993;
    const before = await h.rawSnapshot();
    const rejected = await h.error(async () =>
      h.store.importBackup(await h.backup(malformed)),
    );
    const after = await h.rawSnapshot();
    await h.store.clearPracticeData();
    await h.store.importBackup(backup);
    return {
      pass: metrics.pass,
      attempt,
      restored: (await h.store.load()).attempts[0],
      rejected,
      before,
      after,
    };
  });
  assert.equal(reconciliationStorage.pass, true);
  assert.deepEqual(
    reconciliationStorage.restored,
    reconciliationStorage.attempt,
  );
  assert.equal(reconciliationStorage.rejected?.name, "BackupValidationError");
  assert.deepEqual(reconciliationStorage.after, reconciliationStorage.before);
  record(currentCase, reconciliationStorage);

  currentCase =
    "progression requires five complete current identities and preserves opened review";
  const transitions = await evaluate(labStoragePage, async () => {
    const h = storageSmoke;
    const { deriveProgression } = await import("/src/lib/progression.ts");
    const ids = Array.from({ length: 5 }, (_, index) => `basics.0${index + 1}`);
    const curriculum = {
      skills: [
        { id: "basics", requires: [], requiredChallengeIds: ids },
        { id: "agg", requires: ["basics"], requiredChallengeIds: ["agg.01"] },
      ],
    };
    const identities = Object.fromEntries(
      [...ids, "agg.01"].map((challengeId) => [
        challengeId,
        {
          ...h.identity,
          challengeId,
          bundleVersion: `${challengeId}-bundle-v1`,
        },
      ]),
    );
    const attempts = ids.map((id, index) => ({
      ...h.attempt(
        `pass-${id}`,
        h.document(`doc-${id}`, "SELECT 1;"),
        "correct",
        index + 1,
      ),
      challenge: identities[id],
    }));
    const four = deriveProgression(
      curriculum,
      identities,
      attempts.slice(0, 4),
      [],
    );
    const five = deriveProgression(curriculum, identities, attempts, []);
    const laterFailure = deriveProgression(
      curriculum,
      identities,
      [
        ...attempts,
        { ...attempts[0], id: "failure", correctness: "incorrect" },
      ],
      [],
    );
    const upgraded = {
      ...identities,
      [ids[0]]: { ...identities[ids[0]], engineVersion: "v9.0.0" },
    };
    const review = deriveProgression(curriculum, upgraded, attempts, ["agg"]);
    const deleted = deriveProgression(
      curriculum,
      identities,
      attempts.map((attempt, index) =>
        index ? attempt : { ...attempt, deletedAt: 100 },
      ),
      ["agg"],
    );
    return { four, five, laterFailure, review, deleted };
  });
  assert.equal(transitions.four.skills.agg.accessible, false);
  assert.equal(transitions.five.skills.basics.completed, true);
  assert.equal(transitions.five.skills.agg.available, true);
  assert.equal(transitions.laterFailure.skills.agg.available, true);
  assert.equal(
    transitions.review.challenges["basics.01"].state,
    "needs-review",
  );
  assert.equal(transitions.review.skills.agg.available, false);
  assert.equal(transitions.review.skills.agg.accessible, true);
  assert.equal(transitions.deleted.skills.agg.available, false);
  assert.equal(transitions.deleted.skills.agg.accessible, true);
  assert.equal(transitions.deleted.skills.basics.nextChallengeId, "basics.01");
  record(currentCase, transitions);

  currentCase =
    "v1 migration preserves history and requires current-identity resubmission";
  const legacyPage = await freshPage();
  const legacyMigration = await evaluate(legacyPage, async () => {
    const h = storageSmoke;
    const source = h.legacyFixture();
    await h.seedV1(source);
    h.store = await h.open();
    const profile = await h.store.load();
    const raw = await h.rawSnapshot();
    const { challengeCompleted } = await import("/src/lib/progression.ts");
    return {
      source,
      profile,
      raw,
      currentCompleted: challengeCompleted(h.identity, profile.attempts),
      exported: await h.store.exportBackup(),
    };
  });
  assert.equal(legacyMigration.raw.version, 2);
  assert.equal(legacyMigration.currentCompleted, false);
  const historicalDocument = legacyMigration.profile.documents.find(
    (document) => document.id === "legacy-window",
  );
  assert.equal(historicalDocument.sql, legacyMigration.source.queries[0].sql);
  assert.equal(historicalDocument.revision, 9);
  assert.equal(historicalDocument.version, 7);
  assert.deepEqual(
    historicalDocument.selection,
    legacyMigration.source.queries[0].selection,
  );
  assert.equal(
    historicalDocument.scrollTop,
    legacyMigration.source.queries[0].scrollTop,
  );
  assert.equal(historicalDocument.challenge.challengeId, "window.03");
  assert.equal(
    historicalDocument.challenge.assessmentVersion,
    "legacy-assessment-v1",
  );
  assert.equal(historicalDocument.challenge.engineVersion, "v1.5.4");
  assert.equal(
    legacyMigration.profile.documents.find(
      (document) => document.id === "legacy-unknown",
    ).datasetId,
    "legacy-unavailable",
  );
  assert.equal(
    legacyMigration.profile.documents.find(
      (document) => document.id === "legacy-unknown",
    ).challenge.engineVersion,
    "v1.4.0",
  );
  assert.equal(
    legacyMigration.profile.documents.find(
      (document) => document.id === "legacy-removed",
    ).deletedAt,
    Date.parse(legacyMigration.source.queries[1].deletedAt),
  );
  assert.equal(
    legacyMigration.raw.data.drafts[0].document.sql,
    legacyMigration.source.drafts[0].document.sql,
  );
  assert.equal(legacyMigration.raw.data.drafts[0].document.revision, 10);
  assert.equal(
    legacyMigration.profile.attempts[0].sql,
    "SELECT 6 AS submitted;",
  );
  assert.equal(
    legacyMigration.profile.attempts[0].challenge.assessmentVersion,
    "legacy-assessment-v1",
  );
  assert.equal(
    legacyMigration.profile.hints[
      JSON.stringify(["window.03", "readiness-07-v1"])
    ],
    3,
  );
  assert.deepEqual(legacyMigration.profile.session, {
    ...legacyMigration.source.settings[1].value,
    openedSkillIds: ["window"],
  });
  assert.equal(JSON.parse(legacyMigration.exported).formatVersion, 2);
  record(currentCase, legacyMigration);

  currentCase =
    "strict v1 backup import uses the same migration and v2 roundtrip";
  const legacyImportPage = await freshPage();
  const legacyImport = await evaluate(legacyImportPage, async () => {
    const h = storageSmoke;
    h.store = await h.open();
    await h.store.importBackup(await h.backup(h.legacyFixture(), 1));
    const profile = await h.store.load();
    const malformed = h.legacyFixture();
    malformed.attempts[0].engineVersion = 42;
    const before = await h.rawSnapshot();
    const error = await h.error(async () =>
      h.store.importBackup(await h.backup(malformed, 1)),
    );
    const after = await h.rawSnapshot();
    const backup = await h.store.exportBackup();
    await h.store.clearPracticeData();
    await h.store.importBackup(backup);
    return { profile, restored: await h.store.load(), before, after, error };
  });
  assert.deepEqual(legacyImport.profile, legacyMigration.profile);
  assert.deepEqual(legacyImport.restored, legacyImport.profile);
  assert.equal(legacyImport.error?.name, "BackupValidationError");
  assert.deepEqual(legacyImport.after, legacyImport.before);
  record(currentCase, legacyImport);

  currentCase = "failed v1 migration leaves the original database intact";
  const failedLegacyPage = await freshPage();
  const failedLegacy = await evaluate(failedLegacyPage, async () => {
    const h = storageSmoke;
    const source = h.legacyFixture();
    await h.seedV1(source);
    const before = await h.rawSnapshot();
    const original = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (
        this.transaction.db.name === h.name &&
        this.transaction.mode === "versionchange" &&
        ++writes === 3
      )
        throw new DOMException(
          "Interrupted v1 migration",
          "QuotaExceededError",
        );
      return Reflect.apply(original, this, args);
    };
    let error;
    try {
      error = await h.error(() => h.open());
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const after = await h.rawSnapshot();
    h.store = await h.open();
    return { error, writes, before, after, restored: await h.store.load() };
  });
  assert.equal(failedLegacy.error?.name, "MigrationError");
  assert.equal(failedLegacy.writes, 3);
  assert.deepEqual(failedLegacy.after, failedLegacy.before);
  assert.equal(failedLegacy.after.version, 1);
  assert.deepEqual(failedLegacy.restored, legacyMigration.profile);
  record(currentCase, failedLegacy);

  currentCase = "failed native schema migration rolls back and can retry";
  const migrationPage = await freshPage();
  const migration = await evaluate(migrationPage, async () => {
    const h = storageSmoke;
    const original = IDBDatabase.prototype.createObjectStore;
    let calls = 0;
    IDBDatabase.prototype.createObjectStore = function (...args) {
      if (this.name === h.name && ++calls === 2)
        throw new DOMException(
          "Injected invalid migration after first store creation",
          "ConstraintError",
        );
      return Reflect.apply(original, this, args);
    };
    let error;
    try {
      error = await h.error(() => h.open());
    } finally {
      IDBDatabase.prototype.createObjectStore = original;
    }
    // A native open queued behind the failed upgrade observes the rollback,
    // and the production retry must create all six stores without collisions.
    h.store = await h.open();
    return { error, calls, recovered: await h.rawSnapshot() };
  });
  assert.equal(migration.error?.name, "MigrationError");
  assert.equal(migration.calls, 2);
  assert.deepEqual(migration.recovered.stores, fresh.raw.stores);
  for (const rows of Object.values(migration.recovered.data))
    assert.deepEqual(rows, []);
  record(
    currentCase,
    migration,
    "IDBDatabase.createObjectStore throws ConstraintError on the second creation inside the actual native versionchange transaction; no fake IndexedDB backend.",
  );

  currentCase = "newer database version is rejected without altering data";
  const newer = await evaluate(migrationPage, async () => {
    const h = storageSmoke;
    h.closeStores();
    const request = indexedDB.open(h.name, 3);
    request.onupgradeneeded = () =>
      request.transaction
        .objectStore("meta")
        .put({ id: "future-sentinel", keep: "future application data" });
    const db = await h.request(request);
    db.close();
    const before = await h.rawSnapshot();
    const error = await h.error(() => h.open());
    return { error, before, after: await h.rawSnapshot() };
  });
  assert.equal(newer.error?.name, "VersionError");
  assert.equal(newer.before.version, 3);
  assert.deepEqual(newer.after, newer.before);
  assert.deepEqual(newer.after.data.meta, [
    { id: "future-sentinel", keep: "future application data" },
  ]);
  record(currentCase, newer);

  currentCase =
    "real blocking connection rejects upgrade and releases pending open";
  const blockedPage = await freshPage();
  const blocked = await evaluate(blockedPage, async () => {
    const h = storageSmoke;
    h.store = await h.open();
    const original = IDBFactory.prototype.open;
    const blocker = await h.request(
      Reflect.apply(original, indexedDB, [h.name, 2]),
    );
    let versionChanges = 0;
    blocker.onversionchange = () => {
      versionChanges++;
    }; // Deliberately keep this real connection open.
    let nativeRequest;
    let settled;
    const finished = new Promise((resolve, reject) => {
      settled = { resolve, reject };
    });
    IDBFactory.prototype.open = function (name, version) {
      if (name !== h.name || version !== 2)
        return Reflect.apply(original, this, arguments);
      nativeRequest = Reflect.apply(original, this, [name, 3]);
      nativeRequest.addEventListener("success", () => settled.resolve());
      nativeRequest.addEventListener("error", () =>
        settled.reject(nativeRequest.error),
      );
      return nativeRequest;
    };
    let error;
    try {
      error = await h.error(() => h.open());
    } finally {
      IDBFactory.prototype.open = original;
      blocker.close();
    }
    await finished;
    const closedStoreError = await h.error(() => h.store.load());
    const upgraded = await h.rawSnapshot();
    const messages = [...h.messages];
    // Public instances close before deletion; success above also proves the
    // rejected pending module open reached its self-closing success handler.
    await h.deleteDatabase();
    h.store = await h.open();
    return {
      error,
      versionChanges,
      closedStoreError,
      messages,
      upgraded,
      afterDeletion: await h.rawSnapshot(),
    };
  });
  assert.equal(blocked.error?.name, "StorageBlockedError");
  assert.equal(blocked.versionChanges, 1);
  assert.equal(blocked.closedStoreError?.name, "InvalidStateError");
  assert.ok(blocked.messages.includes(blocked.error.message));
  assert.equal(blocked.upgraded.version, 3);
  assert.equal(blocked.afterDeletion.version, 2);
  assert.deepEqual(blocked.afterDeletion.stores, fresh.raw.stores);
  record(
    currentCase,
    blocked,
    "Only the requested upgrade version is changed from 2 to 3. Native connections exercise versionchange, blocked rejection, and post-block closure.",
  );

  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.failure = {
    case: currentCase,
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  process.exitCode = 1;
} finally {
  for (const context of contexts) {
    for (const page of context.pages()) {
      await bounded(
        page.evaluate(() => globalThis.storageSmoke?.closeStores()),
        "closing public store instances",
        3000,
      ).catch(() => {});
    }
    await bounded(context.close(), "closing browser context", 5000).catch(
      (error) => {
        evidence.cleanupError = String(error);
        process.exitCode = 1;
      },
    );
  }
  if (browser)
    await bounded(browser.close(), "closing browser", 5000).catch((error) => {
      evidence.cleanupError = String(error);
      process.exitCode = 1;
    });
  evidence.finishedAt = new Date().toISOString();
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    `${evidenceDirectory}/storage-smoke.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}
console.log(
  JSON.stringify(
    {
      status: evidence.status,
      cases: evidence.cases.length,
      evidence: `${evidenceDirectory}/storage-smoke.json`,
      failure: evidence.failure,
    },
    null,
    2,
  ),
);
