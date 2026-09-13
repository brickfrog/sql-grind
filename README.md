# SQL Grind

A local SQL practice desktop built with Svelte 5, TypeScript, Vite, CodeMirror, and DuckDB-Wasm.
The catalog contains 65 challenges across 13 skills, including five measured plan labs and five reconciliation exercises.

## Run the application

Use Node.js 22.12 or newer. Run these commands from the repository root:

```sh
npm ci
npm run setup
npm run build
npm run serve
```

Open **http://127.0.0.1:4173**. Keep the server active while you use the application.
For development, run `npm run dev` and open http://127.0.0.1:5173.

Initial installation and asset provisioning can require internet access.
After provisioning, the local server supplies the runtime, extensions, datasets, and challenge assets.
No public deployment or external runtime service is necessary. The application does not support `file://`.

`npm run setup` checks published hashes and preserves nested paths under `/bundle/` and `/data/`.
Different origins and browser profiles have separate practice records.
Before you change origins or clear browser storage, export a backup through File → Export Backup.

## Deploy as a static site

The build is static files. `dist/` needs no server-side code.

```sh
npm ci && npm run setup
BASE_PATH=/sql-grind/ npm run build   # omit BASE_PATH to serve from a site root
```

Set `BASE_PATH` to the URL prefix the site is served from. A GitHub **project**
page serves from `/<repo>/`; a user or organisation page and a custom domain
both serve from `/`. `.github/workflows/pages.yml` selects the correct value and
publishes `dist/` to GitHub Pages on every push to `main`.

Manifest asset paths stay root-absolute identities; they are hashed and verified
as written, and only their fetch URLs carry the prefix.

Hosts that read `public/_headers` (Netlify, Cloudflare Pages, and
`npm run serve`) apply the full response-header policy.

GitHub Pages sends no custom headers, so `_headers` has no effect there. The
built document carries the Content Security Policy in a `<meta>` element, which
is not equivalent:

- `frame-ancestors` is ignored in a meta policy, so framing is not restricted.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` cannot be
  expressed in a meta element and are absent.
- Parquet and WebAssembly rely on the host's own content types.

Choose a host that honours `_headers` when the complete policy matters.

## Practice and completion

Fresh profiles open `basics.01`. Each challenge has its own draft, starter, output contract, and three persistent hints.
The catalog retains display aliases **07** (`window.03`), **08** (`rec.01`), and **09** (`pivot.01`).
Challenge 07 retains its original monthly paid gross-revenue ranking task and unchanged ranking datasets.

- **Execute** runs SQL without completion credit. **Submit** assesses every grading variant.
- Exact challenges require complete typed results, duplicate counts, and the declared ordering.
- Plan labs require correct results and reports that agree with current measurements. No speed threshold determines completion.
- The reconciliation capstone assesses outcome quality rather than equality with one reference policy.
- A current accepted attempt marks a challenge **Completed**, not mastered. Hints do not reduce credit.
- All five challenges in an available skill are directly selectable. Completing the skill unlocks its dependent skills.
- Previously opened skills remain accessible for review after prerequisite completion changes.
- Historical content shows **needs-review** and requires a current submission. A later failure does not erase an earlier current pass.
- Scratch queries use their selected dataset but cannot earn challenge credit.

The schema explorer follows the selected dataset. Source data remains immutable.
The index lab uses a separate disposable sandbox for its CREATE/probe/DROP sequence.
Reference SQL, expected answers, and synthetic truth are inspectable client assets, not secret examination material.
The Leaderboard contains local practice records, not public rankings or synchronized accounts.

## Execution and recovery

Runs use fresh snapshots and isolated workers. The parser remains independent, and the editor remains available during a run.
The engine uses one thread, UTC, and a 512 MiB memory limit.
Execution has a 10-second deadline. Initialization has a separate 30-second deadline.
Output limits are 100,000 rows and 32 MiB of retained Arrow data.
Cancellation terminates an unresponsive worker after 1,500 ms. Partial output never earns completion.

Each result retains its dispatched document, SQL revision, dataset, and complete content identity.
Switching documents cannot attach a result to another challenge. Content errors preserve drafts and expose a retry control.
A failed save retains the active SQL. A conflicting save preserves the saved winner and a separate recovery copy.

IndexedDB and backup exports use version 2. Version 1 imports preserve drafts, revisions, hints, attempts, and historical identities.
Legacy Challenge 07 passes do not transfer to `window.03-bundle-v2`.
Historical unavailable content opens as scratch with a notice. Invalid imports preserve existing data.
Backups contain durable practice state, not worker handles or transient Arrow buffers.

F5 and Ctrl+Enter run SQL. Ctrl+S saves while the IDE has focus. Command replaces Ctrl on macOS.
Escape then Tab leaves the editor. F6 moves between application regions.
The Help menu documents keyboard controls. Context menus expose editor, tab, table, result, and tray actions.
Middle-click closes a tab without deleting its draft. Patchouli moves only through explicit window controls.

## Publish challenge content

`readiness/curriculum.json` defines the skill graph and challenge paths.
Challenge and dataset definitions select their schemas, trusted bootstrap SQL, references, expected answers, and truth assets.
The publication tool uses the separate engine lab, not the application server.

Install and provision the lab:

```sh
npm --prefix experiments/engine ci
npm --prefix experiments/engine run setup
npx playwright install chromium
```

Start the lab in a separate terminal:

```sh
npm --prefix experiments/engine run dev -- --port 5174 --strictPort
```

With the lab active, run the content checks:

```sh
LAB_URL=http://127.0.0.1:5174 node experiments/engine/curriculum.mjs --check
```

To publish checked content, run:

```sh
LAB_URL=http://127.0.0.1:5174 node experiments/engine/curriculum.mjs --publish
npm run setup
npm run build
```

The publisher checks DuckDB v1.5.4, dataset invariants, independent boundary answers, references, incomplete starters, wrong queries, and capstone policies.
`--check` leaves published assets unchanged. `--publish` stages generated assets and replaces the publication only after all content checks pass.
The manifest records byte lengths and SHA-256 hashes, including nested assets.

## Focused regression checks

With the development server active on port 5173, run:

```sh
npm run check
node scripts/engine-results-regression.mjs
node scripts/progression-regression.mjs
node scripts/reconciliation-regression.mjs
APP_URL=http://127.0.0.1:5173 node scripts/engine-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/storage-smoke.mjs
APP_URL=http://127.0.0.1:5173 npm run smoke
APP_URL=http://127.0.0.1:5173 node scripts/context-menu-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/interaction-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/controls-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/workflows-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/qc-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/zoom-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/ui-recovery-smoke.mjs
APP_URL=http://127.0.0.1:5173 node scripts/catalog-loading-smoke.mjs
```

With the built application served on port 4173, also run:

```sh
APP_URL=http://127.0.0.1:4173 node scripts/deployment-smoke.mjs
```

To verify a subpath deployment, run this suite. It builds with
`BASE_PATH=/sql-grind/` into its own output directory, serves that build with no
custom headers, and requires a working engine, unbroken images, real asset
credits, a graded submission, and zero failed requests:

```sh
node scripts/subpath-smoke.mjs
```

The browser runners use actual DuckDB workers, native IndexedDB, and the application surface.
The engine runner covers exact values, admission, isolated grading, cancellation, limits, timeout, recovery, and profiles.
The storage runner covers transactions, migration, conflicts, backups, rejected imports, rollback, and attempt deletion.
The application smoke covers fresh basics practice, submission, hints, persistence, failure after a pass, cancellation, and the map.
The desktop runners cover controls, keyboard focus, zoom, deletion, recovery, SQL errors, and read-only dataset workflows.
Catalog summaries supply map labels and version identities.
Startup fetches only the selected challenge and its dataset definition.

Publication checks passed for all 65 challenges and 173 grading variants.
The focused engine and storage runs passed 38 checks and 18 cases respectively.
Post-cutover browser checks cover cold startup, lazy loading, skill navigation, submission, attempt history, deletion, and storage recovery.
All 494 served manifest assets passed byte-length and SHA-256 checks.

Historical browser captures, recorded before the lazy-catalog cutover:

- [Full progression and UI transitions](readiness/evidence/application/full-progression.json)
- [Production browser checks](readiness/evidence/application/production-ui.json)

These captures do not verify the current build. The full-curriculum browser replay and production restore capture have not been repeated after that cutover.

Post-cutover evidence:

- [Served asset integrity](readiness/evidence/application/production-assets.json)
- [Storage and backup cases](readiness/evidence/application/storage-smoke.json)
- [Desktop workflow checks](readiness/evidence/application/workflows-smoke.json)
- [Recovery and cross-tab conflicts](readiness/evidence/application/ui-recovery-smoke.json)
- [Deployment headers, ranges, and offline runtime](readiness/evidence/application/deployment-smoke.json)
- [Subpath deployment under a base path](readiness/evidence/application/subpath-smoke.json)
- [Selected-content loading](readiness/evidence/application/catalog-loading-smoke.json)

Earlier files under `readiness/evidence/` retain their historical scope.

## Contracts and limits

- [Product and progression](readiness/product.md)
- [Datasets, exact grading, and migration](readiness/semantics.md)
- [Diagnostics, measured labs, and reconciliation assessment](readiness/judge.md)

Safari, mobile browsers, minimum-device performance, and full screen-reader interoperability remain unverified.
The supplied portrait is accepted for local use. Public redistribution rights remain deferred, without blocking local practice.
The original design handoff is kept outside this repository.
The root package lock defines application dependencies. The engine lab has its own lock and serves publication tooling.

## License

The application source is under the GNU General Public License version 3
([LICENSE](LICENSE)). The browser delivers the built JavaScript to every user, so
a hosted copy distributes the work and must offer its source under the same
terms.

Bundled third-party assets keep their own terms and are not covered by that
license:

- Interface icons are the Fugue set by Yusuke Kamiyamane, under Creative Commons
  Attribution 3.0. The application states this attribution in Help → Asset
  Credits, and `public/icon-credits.txt` ships with the build.
- The judge portrait is Touhou Project fan art from the community wiki. Touhou
  Project is the work of Team Shanghai Alice. The portrait is neither original
  to this project nor licensed under the GPL. Remove
  `assets/portrait/` and the portrait provisioning
  in `scripts/setup.mjs` to build without it.

DuckDB and DuckDB-Wasm are separate MIT-licensed projects. The build installs
their pinned runtime; it does not modify them.
