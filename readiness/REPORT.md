# Implementation readiness report

Status: the local application is implemented in Svelte 5, TypeScript, and Vite.
See [the root README](../README.md) for commands, application evidence, screenshots, and remaining support limits.
The sections below preserve the readiness investigation from 2026-09-12.
Files under `experiments/engine` remain historical feasibility experiments, not production APIs.

## Resume here

1. Read this report, `../GOAL.md`, `semantics.md`, and `product.md`.
2. Run the experiment commands below for changed contracts.
3. Use `scope.json` for the local-runtime requirement. Public deployment is separate from local readiness.
4. Preserve the original design files. Do not replace their illustrative data in place.

## Contracts and assets

| GOAL outcome | Repository deliverable | Status |
| --- | --- | --- |
| 1. Commerce dataset | SQL assets, `manifest.json`, publication and dataset evidence | Both scales passed publication invariants. Two independent small exports have identical hashes. |
| 2. Challenge 07 | `semantics.md`, `challenge-07.json`, reference and expected assets | Nine hand-derived rows match the browser result. Starter SQL and three hints are authored. |
| 3. Grading and progression | `semantics.md`, `product.md`, `evidence/comparator.json` | Exact comparison and adverse examples ran. The application also exercises grading and durable progression in `evidence/application/`. |
| 4. Judge facts | `judge.md`, profile evidence | Three stable rules have positive and negative examples, source-range policies, and consistent dialogue. |
| 5. Parser/editor | `evidence/suite.json`, `evidence/browser-matrix.json`, `evidence/profile.json` | Coverage, Unicode range, concurrent parser, and stale revision experiments ran. PIVOT AST support is absent. |
| 6. Safety/recovery | `evidence/suite.json`, `evidence/safety.json`, `evidence/faults.json` | Cooperative cancellation, forced termination, memory error, saved-state recovery, and poisoned-snapshot recovery ran. |
| 7. Profiling | `evidence/suite.json`, `evidence/profile.json`, dataset profiles | JSON profiles and paired timing ran. The application displays actual timing and isolated paired comparisons. |
| 8. Runtime/storage/browser | `scope.json`, `product.md`, browser matrix and CSP evidence | Chromium and Firefox ran. The built localhost harness ran with external origins blocked. Public hosting is deferred. |
| 9. Product/assets | `product.md` | 85 control identifiers, 60 distinct objectives, accessibility criteria, and icon terms recorded. The user accepts the portrait for local work and defers distribution review. |
| 10. Leaderboard | `product.md` | Local practice records only. No accounts, synchronization, or public ranking authority. |

## Selected engine and reproducibility

The experiment pins `@duckdb/duckdb-wasm` to `1.33.1-dev57.0`.
The actual engine reports `v1.5.4`. These version strings describe different release layers.
The tested bundle is `duckdb-eh.wasm` with `duckdb-browser-eh.worker.js`, single-threaded and without cross-origin isolation.
The package lock pins all JavaScript dependencies. The development-release package requires explicit review before any later engine upgrade.

ICU, JSON, and Parquet extensions come from `v1.5.4/wasm_eh` and remain self-hosted beside the engine.
Initial probes fetched ICU and JSON from DuckDB's extension service.
The revised harness sets `custom_extension_repository` to its own origin before loading ICU and JSON.
The revised suite recorded no external-origin responses. The browser matrix blocked non-local network requests and still loaded all data.
This proves self-hosted assets, not offline cold-start support. The local server must remain available, but runtime internet access is unnecessary.

Commands, from `experiments/engine`:

```sh
npm ci
npm run assets
node extensions.mjs
npx playwright install chromium firefox webkit
npm run dev
```

The server command runs in a separate terminal. The runners use `http://127.0.0.1:5173`.

```sh
node run.mjs
node suite.mjs
node comparator.mjs
node dataset.mjs small 512MB
node dataset.mjs illustrated 512MB
node dataset.mjs illustrated 1536MB
node matrix.mjs
node safety.mjs
node profile.mjs
node faults.mjs
node publication.mjs
node publication-large.mjs
node paired.mjs small
node paired.mjs illustrated
node summarize.mjs
node manifest.mjs
npx vite build
node deployed.mjs https://guileless-starlight-2f04a6.netlify.app
```

For the built-policy check, start `node serve-built.mjs` in a separate terminal after the Vite build.
Then run `node csp.mjs` and `node audit.mjs`.
The built-policy server uses port 4173 and applies the exact `_headers` file from `dist`.

The temporary upload used `npm exec --yes --package netlify-cli@27.3.0 -- netlify deploy --allow-anonymous --dir dist --json`.
Netlify CLI 27.5.2 failed the local registry's release-age restriction. Version 27.3.0 completed the anonymous upload.

The deployed URL is a temporary anonymous Netlify experiment. It is not the product origin or a durable artifact.
The deployment contains only the synthetic harness, dependencies, and synthetic data. It excludes the portrait and design archive.
The raw deployment command returned a claim token. That token must not enter repository evidence.

`manifest.mjs` publishes hashes after reviewed asset changes. It does not authorize an unreviewed dependency or extension update.
For an unchanged bundle, `audit.mjs` compares the installed/generated files against the existing manifest without rewriting it.

## Challenge semantics and independent review

Competition ranking uses revenue alone, not category ID as a window tie-breaker.
The output adds `category_id` to distinguish categories with the same name.
Months are UTC calendar dates. The year interval is half-open.
Only `orders.status = 'paid'` qualifies. Revenue uses line-item transaction prices and does not subtract refunds.

The integration review checked the fixture ledger independently of the reference SQL:

- January: category 2 has `3×20 + 20 + 20 = 100`. Category 3 also has 100. Both rank first.
- Categories 4 and 5 each have 90 and rank third. Category 6 has 80 and ranks fifth.
- February: 50 ranks first, both 40 values rank second, and 30 ranks fourth.
- March has no qualifying order. April has an actual zero-value group.
- The local-2025 timestamp on order 9 is a December UTC instant and contributes `2×12.34 = 24.68`.
- Both exact year endpoints and the preceding second have explicit fixtures.

The expected output has nine rows and total displayed revenue 534.68.
`comparator.mjs` decoded the actual Arrow values and matched every expected row.
It rejected dense ranking, catalog prices, a missing year filter, and deduplication of distinct line items.

The comparator experiment also preserves duplicate rows, NULL, `9007199254740993`, and `-12345678901234567890.12`.
Wrong integer types, rounded decimal values, incomplete streams, missing duplicates, and incorrect ordering fail.
A different decimal width at the same scale and arbitrary ordering within peers pass.
This experiment covers the initial challenge's types. It is not a general nested-Arrow comparator.

The comparator also maps the authored `expected-07.json` column contract to Arrow types before it compares the reference.
The actual reference passes. An actual query that casts `rnk` to INTEGER fails the type check.
An actual DECIMAL(18,2) revenue result passes under the explicitly permitted equivalent-width policy.
These checks prevent reference-generated expectations from hiding an incorrect reference type.

Generic `lab.query` outputs are Arrow debug representations, not formatted currency.
Their decimal strings contain unscaled integers. Only `compare.js` applies the decimal scale for the exact grading evidence.
The early suite's `lightweightMs` field measures CodeMirror state construction, not parsing.
The browser matrix separately calls the language parser and records actual parse trees and elapsed time.

`challenge-07.json` contains valid starter SQL and three authored hints.
The starter computes monthly totals but intentionally does not solve the ranking objective.
It ran against the illustrated dataset and returned 468 monthly-category groups.

## Dataset measurements and decision

The deterministic generator uses seed 20240907 and no random clock-dependent input.
Parquet output uses ZSTD, primary-key ordering, and row groups of 122880 rows.

The small payload is 83,994 bytes. The illustrated payload is 45,197,753 bytes.
The engine, worker, and three extensions total 47,115,868 uncompressed bytes, excluding application JavaScript.
`manifest.json` records exact file hashes, sizes, gzip sizes, package versions, seed, and configuration identity.
`publication.json` proves identical small exports from two independent engines.
`publication-large.json` records all eight illustrated counts and zero violations for all six cross-row publication invariants.
The constrained schema enforces primary keys, foreign keys, nullability, and local checks during generation.
Each dataset evidence file records per-table byte counts and SHA-256 hashes.

| Measurement | Small | Illustrated |
| --- | ---: | ---: |
| Orders | 2,000 | 1,400,000 |
| Line items | 8,500 | 5,900,000 |
| Generation | About 166 ms | About 23.5 s at 1536 MB |
| Internal reference samples | About 10–12 ms | About 1.72–1.85 s |
| Parquet reference samples | About 10–12 ms | About 2.10–2.25 s |
| 512 MB constrained generation | Succeeds | Out of memory |
| Small Parquet artifacts | `../experiments/engine/public/data/small-v1/` | Regenerate large artifacts from SQL |

These measurements come from a Ryzen 9 3900X Linux workstation, not a minimum-spec device.
Chromium reports 24 logical processors and 32 GiB through `navigator.deviceMemory`.
The memory-limit string `512MB` corresponds to an observed engine allocation ceiling near 488 MiB.
The illustrated run generated and queried all data at 1536 MB.
Its later materialized reload used the harness's fresh-worker 512 MB configuration and failed allocation.
That failure does not mean the earlier illustrated queries failed.

Decision: use the small dataset plus boundary fixtures for the first complete challenge.
Do not copy the mockup's millions-of-rows labels into the application.
The illustrated scale remains an explicit large-data experiment, not the default download.
The smaller dataset supports semantic learning without the demonstrated memory and startup costs.
A larger default needs new lower-device evidence, not an extrapolation from this workstation.

Decision: materialize the protected challenge dataset before learner access.
Registered Parquet views remain useful for experiments, but `enable_external_access=false` blocks their file reads.
The dataset runner compares registered files and materialized reloads separately.
Cache reload measurements use already-fetched buffers and therefore exclude network download time.
The matrix additionally loads the small files through same-origin HTTP URLs.

Decision: no OPFS or service worker for the first release.
The small data payload and explicit online-first policy do not justify another storage subsystem.
IndexedDB owns learner work. HTTP caching is opportunistic and cannot guarantee offline recovery.

Peak memory needs careful labels. Profiles expose engine `system_peak_buffer_memory`, not total browser memory.
`profile.json` records process RSS point samples, not a peak or a portable browser memory API.
The second parser engine increased aggregate sampled Chromium RSS by about 146 MiB in the final paired run.
Shared process pages can count twice. Low-memory browser acceptance remains open.

`evidence/summary.json` records medians and median absolute deviations from the raw samples.
The small internal median is 11.3 ms, with MAD 0.8 ms. Its Parquet median is 11.5 ms, with MAD 0.7 ms.
The illustrated internal median is 1771.3 ms, with MAD 22.2 ms. Its Parquet median is 2162.4 ms, with MAD 58.6 ms.
Recorded engine buffer peaks are about 75–76 MB for small data and 1.99–2.00 GB for illustrated data.
Those high-water counters include preceding generation/export work. They are not isolated per-query allocation deltas.
The illustrated counters exceed the configured memory limit, so that limit cannot serve as a total browser-memory cap.

## Parser architecture and diagnostics

Decision: use a separate single-threaded DuckDB parser worker and CodeMirror's SQL language support.
CodeMirror provides lexical editor behavior. It is not a substitute for DuckDB syntax validation.
The measured PostgreSQL-oriented CodeMirror parser reports no error for incomplete `SELECT * FROM`.
It treats PIVOT and QUALIFY as identifiers in the recorded trees.

The DuckDB JSON parser accepts the tested CTE, recursive CTE, window, QUALIFY, alias, comment, and multiple-statement cases.
It returns a structured error for incomplete input.
It rejects the tested PIVOT with `Only SELECT statements can be serialized to json!`.
The same PIVOT query executes successfully. Unsupported serialization must not become a false SQL error.

For unsupported AST forms, the UI reports that structural diagnostics are unavailable.
It retains syntax highlighting and permits execution under the execution policy.
Full live PIVOT diagnostics require a further parser adapter experiment before that curriculum unit releases.
No package claim converts this missing capability into a complete semantic parser.

Warm JSON parser round trips were generally below 2 ms on this workstation.
Cold extension loads cost hundreds of milliseconds and belong to startup, not the typing debounce.
A separate parser worker answered during an expensive execution-worker query in about 1 ms.
The recorded 400 ms debounce plus parser round trip took about 401 ms.
A CodeMirror revision change caused the captured older diagnostic to be discarded.

DuckDB AST/token offsets are UTF-8 byte offsets in the Unicode experiment.
The token `missing` begins at byte 22 but UTF-16 offset 19 after an emoji and an accented character.
The experiment decoded the prefix and selected exactly `missing` in CodeMirror at `[19,26)`.
An implementation must reject invalid byte boundaries and sentinel locations rather than round them.
Token ends require tokenization or verified source spans. AST starts alone are not complete highlight ranges.

## Execution policy and current safety evidence

The initial execution configuration is one worker, one active run, 512 MB engine memory, and a 10-second application deadline.
The initial retained-output cap is 32 MiB or 100,000 rows, whichever arrives first.
These are explicit product limits, not a claim that DuckDB can prevent all browser allocation failure.
The display uses a bounded preview. A grading result must still complete without exceeding its separate limit.
A result-cap breach has no partial correctness pass.

A challenge permits one read query, including CTEs, windows, and supported relational forms.
Multiple statements, session mutation, extension commands, external readers, ATTACH, COPY, and DDL are not learner challenge commands.
An index exercise uses a separate disposable engine and an explicit index-operation policy.
Every run carries SQL revision, challenge/data/bundle versions, configuration identity, and run ID.
Late messages from an obsolete worker or revision cannot change progress.

Bootstrap must load matching extensions and data before it disables autoload, autoinstall, and external access, then locks configuration.
The experiment proves that registered CSV, remote CSV, ATTACH paths, COPY paths, and external-access re-enabling fail after restriction.
`INSTALL httpfs` returned success without a fetch in one case. A keyword filter is not sufficient proof of engine isolation.
An internal table still accepts DELETE, so admission rules alone cannot protect future grading.
The read-only database transition failed with an exclusive-lock error. Database-file export also failed in an earlier probe.
Decision: each challenge run receives a fresh worker and a trusted snapshot from immutable host-owned assets.
The worker receives only that run's disposable copies. It never receives the sole copy of publication data or saved work.
The poisoning experiment bypassed admission, deleted all three return rows, destroyed that worker, and restored all three rows in a replacement worker.
Snapshot restoration took 960.5 ms in that run. The application must show initialization separately from query execution latency.
This alternative establishes cross-run isolation without assuming the failed read-only transition works.
An index sandbox can retain its intentional mutations within its own session, but never supplies data for challenge grading.

The expensive `send` query accepted `cancelSent()` and rejected the pending query as cancelled.
The measured cooperative cancellation round trip was about 1–2 ms.
The harness also terminated the worker and ran a query in a replacement worker.
A ten-million-row output stream transferred 100352 rows in 49 batches before cancellation.
The harness discarded the batches and recovered in a fresh worker.
A 16 MB memory-limit experiment produced a real Out of Memory error and then recovered in a fresh worker.
IndexedDB preserved a saved SQL/progress record across worker termination and re-creation.
This is a persistence-boundary experiment, not the complete application autosave implementation.

`faults.json` exercises cancellation while a blocking query prevents cooperative handling.
The 1500 ms grace interval expired, worker termination occurred after about 1600 ms including the initial 100 ms delay, and recovery succeeded.
A separate forced worker loss during computation also recovered successfully.
The original query promises remained unsettled after termination. The coordinator must settle its own run state and discard those promises.
It must not await a terminated worker before enabling recovery or resolving the user's Cancel action.

The application must attempt cooperative cancellation first, then terminate after a 1500 ms grace interval.
Timeout, worker error, and output-cap paths share that recovery transition.
Recovery restores the same bundle before accepting another run and never deletes learner storage.
Private files, credentials, imports, and unrelated origin data never enter the SQL worker.
The browser sandbox, same-origin network policy, and disposable data boundary supplement statement admission rules.
This local-practice design is not a hostile-code certification or trusted ranking system.

## Profiling and judge decisions

`EXPLAIN (ANALYZE, FORMAT JSON)` returns measured JSON in this package.
It is a second execution and must carry that label in the interface.
A JSON profile file also worked before external access was disabled.
The selected restricted feedback path uses returned EXPLAIN JSON, not unrestricted profile-file paths.

Profile field meanings:

- `latency` and `operator_timing` use seconds. UI milliseconds require multiplication by 1000.
- `operator_rows_scanned` is a local operator count, not its output cardinality.
- `operator_cardinality` is the number of rows produced by that operator.
- `cumulative_rows_scanned` includes descendants. Do not sum it over every node.
- `system_peak_buffer_memory` measures engine buffers, not total Wasm or browser memory.
- Zero file-byte counters on registered buffers do not establish zero network traffic.

The filtered 19-item fixture scans 19 rows and emits one row.
Range scans and Parquet scans have separate recorded profiles.
The repeated-aggregate and pruned-CTE cases retain actual plans for inspection.
A comma join with the relationship predicate and an explicit join produce the same count.
A disconnected comma join and an intentional cross join are separate examples, not one syntax rule.

Correctness remains independent of timing. The UI uses `vs. reference`, never `vs. optimal`.
A performance session uses identical configuration and data, warmup, and at least seven alternating paired samples.
It reports median durations, median paired ratio, and median absolute deviation. Background/device changes invalidate comparison.
The nine recorded pairs vary substantially even on equivalent small queries.
No arbitrary percentage bar or one-shot runtime becomes a mastery requirement.
Optimization exercises require declared result equivalence and an evidenced plan property, not an undisclosed speed threshold.

The boundary-fixture pairs in `profile.json` demonstrate the measurement procedure, not a useful query-performance threshold.
Generated-data pairs are in `paired-small.json` and `paired-illustrated.json`.
Each includes complete typed result equivalence, one warmup per query, and nine alternating pairs.

| Dataset | Reference median / MAD | Candidate median / MAD | Median paired ratio / MAD |
| --- | --- | --- | --- |
| 2,000 orders / 8,500 items | 9.6 / 0.6 ms | 9.6 / 0.8 ms | 0.990 / 0.052 |
| 1.4 million orders / 5.9 million items | 1728.4 / 33.4 ms | 1740.8 / 23.1 ms | 1.008 / 0.054 |

Durations include the worker round trip and result transfer, not only engine execution.
The candidate differs only in permitted ordering within peers. These samples do not establish a meaningful speed improvement.

## Browser, hosting, and deployment boundaries

The tested browsers are Chromium 153.0.8010.12 and Firefox 155.0 on Linux.
Both loaded the small Parquet dataset and executed PIVOT with same-origin extensions.
The provisional desktop support target is current Chromium-family browsers and Firefox with Wasm exception handling.
Edge is not independently exercised. WebKit 26.6 failed to launch because host libraries are missing.
Safari, mobile browsers, and low-memory devices have no acceptance claim.
A provisional device target is 64-bit desktop, 8 GiB RAM, and at least four logical processors. It still needs real-device measurements.

Optional publication target: Netlify static HTTPS hosting, without a backend. The selected runtime is local HTTP, as recorded in `scope.json`.
The anonymous experiment served Wasm and worker content types correctly and returned real HTTP 206 byte ranges.
Its remote Parquet count returned 8500. Its parser ran from the deployed origin.
Both ranged and ordinary full-document responses lacked the intended CSP, nosniff, and referrer headers.
Therefore this deployment does not yet satisfy the security-header acceptance criterion.
The temporary site also needs a claimed account and durable origin before product deployment.

Header policy lives in `../experiments/engine/public/_headers` for the next deployment check.
The baseline does not request COOP/COEP or experimental threads.
Versioned immutable asset paths can use long-lived caching after the manifest and rollout contract exist.
The experiment deliberately uses revalidation rather than pretending its unversioned engine paths are immutable.

`evidence/csp.json` proves the built harness under the exact proposed headers on localhost.
The engine, JSON parser, Parquet query, and restricted EXPLAIN profile all succeeded with no recorded browser errors.
The worker used a same-origin script URL, not a blob URL. The policy therefore needs no speculative `blob:` exception.
The engine reported session timezone `UTC`. The probe blocked external origins.
This local policy result does not repair the missing headers on the anonymous HTTPS deployment.

Sources: [Netlify headers](https://docs.netlify.com/manage/routing/headers/),
[Netlify deployment](https://docs.netlify.com/deploy/create-deploys/),
[DuckDB SQL serialization](https://duckdb.org/docs/current/data/json/sql_to_and_from_json),
[DuckDB profiling](https://duckdb.org/docs/current/dev/profiling), and
[DuckDB security](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview).

## Local implementation readiness

The user clarified: “This site should run local.”
The authoritative decision is `scope.json`. Public deployment and portrait distribution do not block local implementation.
The prior report incorrectly treated those publication concerns as implementation prerequisites.
The Netlify experiment remains historical evidence, not a required service.

The audit checks 24 manifest files and the semantic, parser, recovery, dataset, and profiling evidence.
`evidence/audit.json` separates implementation readiness from public-release approval.
The final audit passed with `implementationReady: true`, `localBlockers: []`, and `releaseReady: false`.
The fresh localhost probe loaded DuckDB v1.5.4 in 989.5 ms and counted 8,500 Parquet rows with external origins blocked.
It also passed UTC, JSON parsing, and restricted profiling checks without browser errors.
The application milestone now exists at the repository root. Its evidence is separate from these historical harness measurements.

### Run the local feasibility harness

Run these commands from `experiments/engine`:

```sh
npm ci
npm run setup
npm run build
npm run serve
```

Open `http://127.0.0.1:4173`.
Initial installation and asset provisioning require internet access.
After provisioning, the server supplies all runtime assets locally. It must remain running.
This page is the engine feasibility harness, not the SQL Grind desktop application.

With the local server running, reproduce the disconnected-runtime evidence:

```sh
node csp.mjs
npm run audit
```

The browser probe blocks external origins before the first navigation.
It checks engine startup, UTC, JSON parsing, local Parquet, and restricted profiling under the built security policy.
The functional challenge-07 desktop workflow now replaces readiness investigation as the application deliverable.
