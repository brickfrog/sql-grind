# Goal: SQL Grind local application

Status: the local challenge-07 application is implemented. The original readiness investigation is complete.

Run instructions and current application evidence: [README.md](README.md). Historical investigation: [readiness/REPORT.md](readiness/REPORT.md).
Contracts: [challenge and data semantics](readiness/semantics.md), [product decisions](readiness/product.md).
Reproducible browser experiments: `experiments/engine/`. Raw evidence: `readiness/evidence/`.
Scope: [local runtime decision](readiness/scope.json). Public hosting and portrait distribution are deferred publication concerns, not local-readiness blockers.
Local experiment status: [evidence audit](readiness/evidence/audit.json).

## Original readiness objective

Resolve the engineering and product gaps in the Claude design handoff before a full application build.
Preserve the specified desktop appearance and learning experience.
Replace illustrative behavior with explicit contracts and measured engine capabilities.

Completion requires documented decisions, reproducible feasibility results, and acceptance criteria for the application build.
A visual scaffold alone does not complete this goal.

## Starting points

- [Original archive](Learn%20Analytics%20Platform%20Design.zip)
- Design specification, interactive prototype, and supplied screenshots: the
  original handoff bundle, kept outside this repository.
- [Portrait asset](assets/portrait/patchouli.webp)

The handoff directory is the primary reference. The archive also contains identical copies of the prototype, runtime, and portrait.
The prototype is not production code. Its execution results, metrics, warnings, and challenge progress are hardcoded.
The archive contains no database schema, commerce dataset, reference solutions, or complete challenge collection.
The supplied screenshots are cropped and mislabeled. Prefer the prototype and specification for visual decisions.

### Evidence available before this investigation

- All 13 extracted files matched their archive entries byte-for-byte.
- Chromium displayed the workbench, skill map, and floating judge.
- Research covered current documentation and selected upstream source files.
- No DuckDB-Wasm execution, parser, profiling, or dataset feasibility experiment ran.
- No application dependencies or production code were added.

## Proposed technical baseline

The application framework is decided. Other baseline choices remain recommendations from research, not requirements from the visual design.
Record any replacement and its reason before implementation.

| Area              | Proposed choice                                        | Reason or boundary                                                                                                   |
| ----------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Application       | Svelte 5, TypeScript, Vite                             | Decided after comparison with React and Solid. Static client-side application without SvelteKit or server rendering. |
| Appearance        | Custom CSS tokens and semantic HTML                    | Exact Win2000 styling without global Win98 overrides. No 98.css dependency.                                          |
| Editor            | CodeMirror 6                                           | Completion, keybindings, diagnostic ranges, and syntax highlighting.                                                 |
| Execution         | Pinned DuckDB-Wasm in a dedicated worker               | Single-threaded baseline. Experimental threads require separate evidence.                                            |
| Results           | Arrow batches and TanStack Virtual                     | Preserve exact values and bound rendered rows and retained memory.                                                   |
| Data distribution | Versioned, deterministic Parquet assets                | Measure download and execution costs before choosing default dataset size.                                           |
| Saved work        | IndexedDB with a small wrapper                         | Keep queries and progress outside the disposable engine. Include export/import.                                      |
| Dataset cache     | Decide after measurement                               | OPFS is a candidate, not a requirement implied by row counts.                                                        |
| Skill map         | SVG edges and HTML buttons                             | Twelve fixed nodes do not need a graph framework.                                                                    |
| Judge             | Deterministic grading and authored dialogue            | No LLM dependency for correctness, hints, or scores.                                                                 |
| Hosting           | Local loopback static server with configurable headers | All runtime assets come from localhost. Public HTTPS hosting is optional publication work.                           |
| Verification      | Vitest and Playwright                                  | Semantic grading boundaries and real browser workflows.                                                              |

References: [Vite](https://vite.dev/guide/), [CodeMirror](https://codemirror.net/docs/guide/),
[98.css scope](https://jdan.github.io/98.css/), [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction).

### Framework decision

The user delegated framework selection to the implementer after the Svelte, React, and Solid comparison.
Use Svelte 5 with TypeScript and Vite.
Its component-local markup, scoped CSS, and granular reactivity fit the custom desktop interface.
This decision concerns maintainability and authoring convenience, not a measured performance advantage.

- Use Svelte 5 runes consistently for presentation state.
- Keep execution, grading, persistence, and Arrow storage in plain TypeScript modules.
- Keep the worker lifecycle independent of tabs and pane visibility.
- Let CodeMirror own its document, selection, and DOM.
- Use CodeMirror theme and highlighting APIs for editor styling, not ordinary Svelte scoped selectors.
- Keep bulk result data outside deep reactive UI collections.
- Expose result handles, revisions, counts, and execution status to the UI.
- Use the Svelte adapter for TanStack Virtual.
- Reconsider SvelteKit only after routed pages or server requirements justify it.

Svelte does not deep-proxy class instances. Plain result arrays and objects still need deliberate reactive boundaries.
CodeMirror integration and static deployment work with all three frameworks.
React remains capable, and Solid offers a suitable signal model.
Neither provides a required integration advantage for this design.

Sources: [Svelte state](https://svelte.dev/docs/svelte/$state),
[Svelte scoped styles](https://svelte.dev/docs/svelte/scoped-styles),
[Solid reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity),
[React effects](https://react.dev/reference/react/useEffect),
[React Compiler](https://react.dev/learn/react-compiler/introduction).

## Required outcomes

### 1. Define the commerce schema and dataset

Design pointers: README lines 29–38 and 98. The displayed row counts are illustrative.

- Define all eight tables, keys, relationships, types, nullability, and constraints.
- Define transaction prices, paid status, refunds, timestamps, and category identity.
- Define the category hierarchy and the warehouse routing data required by recursive exercises.
- Create a deterministic generator with a version and seed.
- Produce small semantic fixtures and a representative learning dataset.
- Include rank ties, duplicate-sensitive joins, empty groups, and date boundaries.
- Measure the illustrated scale, including 5.9 million line items and 1.4 million orders.
- Select the default dataset size from browser evidence, not the mockup labels.
- Record compressed size, startup time, peak memory, and representative query latency.
- Compare registered Parquet views with materialized internal tables.
- Define reset behavior and separate writable index exercises from protected challenge data.

Acceptance: a versioned schema, reproducible data artifacts, and a measured dataset-size decision.

Sources: [Wasm ingestion](https://duckdb.org/docs/current/clients/wasm/data_ingestion),
[Wasm limitations](https://duckdb.org/docs/current/clients/wasm/overview).

### 2. Correct challenge 07 and define its contract

Design pointers: README lines 48–55. Prototype lines 87–101 contain the sample query.

The sample lacks the orders-to-items and items-to-products relationships.
It also lacks the 2024 restriction and final result ordering.
Its claimed correctness is not supported by the displayed SQL.

Proposed defaults:

- Use competition ranking with `RANK`, including ties at ranks up to three.
- Permit variable row counts instead of promising exactly 36 rows.
- Define paid orders through `orders.status = 'paid'` for this exercise.
- Use line-item transaction prices for gross revenue, without refunds, tax, or shipping.
- Use `ordered_at` within `[2024-01-01, 2025-01-01)`.
- Define the timezone and return the month as `DATE`.
- Define exact decimal precision, scale, and overflow bounds.
- Define category identity independently from its display name.
- Return no rows for months without qualifying categories.
- Define final ordering and permitted ordering within ties.

Acceptance: unambiguous challenge text and hand-calculable expected answers for boundary fixtures.
Document approval or replacement of each proposed default.

Sources: [Ranking functions](https://duckdb.org/docs/current/sql/functions/window_functions.html),
[order preservation](https://duckdb.org/docs/current/sql/dialect/order_preservation.html),
[numeric types](https://duckdb.org/docs/current/sql/data_types/numeric.html).

### 3. Define deterministic grading and progression

Design pointers: README lines 53–55, 69, and 92–98.

- Version challenge text, schema, data, reference SQL, expected types, and engine configuration together.
- Compare complete results, not displayed row counts or truncated previews.
- Preserve duplicate rows, NULLs, decimals, dates, and large integers.
- Compare result types before values to prevent accidental coercion.
- Compare duplicate-preserving collections and verify ordering separately.
- Define whether equivalent decimal widths and arbitrary ordering within peers are acceptable.
- Use explicit tolerances only for exercises that require floating-point results.
- Reject timeout, cancellation, and incomplete results without awarding a partial correctness pass.
- Define hints, attempt history, challenge completion, mastery, and prerequisite unlock rules.
- Separate correctness from style and performance.
- Declare required SQL concepts explicitly instead of rejecting equivalent solutions without explanation.
- Associate every result with its SQL revision, challenge version, dataset version, and run identifier.

Acceptance: documented acceptance/rejection examples and an independently reviewed reference answer for each initial fixture.
Browser-delivered fixtures are inspectable. Do not describe them as secret or tamper-resistant.

Source: [Duplicate-preserving set operations](https://duckdb.org/docs/current/sql/query_syntax/setops.html).

### 4. Replace misleading judge rules

Design pointers: README lines 77–87. Prototype lines 341–349 contain the hardcoded warnings and dialogue.

A comma join is not inherently incorrect. Relationship predicates can appear in `WHERE`.
DuckDB can remove unused columns from `SELECT *` and reuse identical aggregate expressions.
Repeated SQL text is not proof of repeated engine work.

- Diagnose missing relationships rather than commas alone.
- Distinguish intentional cross joins from suspicious disconnected relations.
- Treat explicit column selection as style advice without unsupported performance claims.
- Inspect actual plans before claiming repeated computation or avoidable scans.
- Keep dry, gentle, and harsh dialogue consistent with the same verified facts.
- Use stable rule identifiers, evidence, and source ranges for diagnostics.
- Keep an optional future LLM outside all grading decisions.

Acceptance: each rule has positive and negative examples, including legitimate cross joins and repeated aggregates.

Sources: [Optimizer explanation](https://duckdb.org/2024/11/14/optimizers.html),
[optimizer passes](https://github.com/duckdb/duckdb/blob/main/src/optimizer/optimizer.cpp),
[aggregate reuse](https://github.com/duckdb/duckdb/blob/main/src/planner/binder/expression/bind_aggregate_expression.cpp).
Upstream source describes current development behavior, not a guarantee for an unselected package version.

### 5. Prove parser and editor integration

Design pointers: README lines 44 and 87 require token-level feedback after roughly 400 milliseconds.

- Evaluate DuckDB `json_serialize_sql` as the first parser candidate.
- Verify availability in the pinned Wasm package, including required extensions and offline behavior.
- Cover CTEs, recursive CTEs, windows, `QUALIFY`, `PIVOT`, aliases, comments, and multiple statements.
- Verify incomplete input and Unicode source locations against CodeMirror UTF-16 offsets.
- Keep parsing responsive during long query runs.
- Compare a separate engine parser worker against a lightweight dialect-aware parser.
- Record memory costs, syntax coverage, and diagnostic latency before selecting the parser architecture.
- Discard stale diagnostics after an editor revision changes.

Acceptance: a parser capability matrix with measured latency and verified highlight ranges.
Do not treat syntax highlighting as a complete semantic parser.

Source: [SQL AST serialization](https://duckdb.org/docs/current/data/json/sql_to_and_from_json).

### 6. Prove execution safety and recovery

Design pointers: README lines 24, 87, and 98 specify execution but omit resource and access policies.

- Pin matching Wasm, worker, and extension versions.
- Define permitted statement classes and external data sources.
- Restrict external access and extension installation before accepting learner SQL.
- Verify restrictions against registered data paths and profile retrieval.
- Keep private files and secrets outside the learner engine.
- Set memory, runtime, and retained-result limits.
- Serialize runs and define cancellation behavior for obsolete runs.
- Attempt cooperative cancellation before a bounded worker-termination fallback.
- Restore the engine after timeout, memory exhaustion, and fatal worker errors.
- Preserve editor contents and saved progress during recovery.
- Keep display limits separate from grading and measured query semantics.

Acceptance: reproducible cancellation and recovery during computation and result transfer, without loss of saved work.
A SQL statement filter alone is not a security boundary.

Sources: [Query API](https://duckdb.org/docs/current/clients/wasm/query),
[security guidance](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview),
[cancellation implementation](https://github.com/duckdb/duckdb-wasm/blob/main/lib/src/webdb.cc).

### 7. Define honest profiling and performance feedback

Design pointers: README lines 53–55 and 87 contain illustrative performance scores.

- Replace `vs. optimal` with `vs. reference`.
- Distinguish engine latency, profiling latency, result transfer, and UI display time.
- Compare reference and learner queries under identical configuration and data conditions.
- Use repeated paired measurements with warmup and a reported variability measure.
- Keep ordinary correctness independent of device speed.
- Define explicit criteria for optimization exercises instead of arbitrary score percentages.
- Verify JSON profile retrieval in the pinned Wasm package.
- Distinguish `OPERATOR_ROWS_SCANNED` from `OPERATOR_CARDINALITY`.
- Avoid repeated sums of subtree cumulative counters.
- Report unavailable metrics explicitly instead of displaying fabricated zeros.
- Label a separate `EXPLAIN ANALYZE` run as a second execution.

Acceptance: measured profile fields and units, representative scan cases, and a documented reference-comparison policy.
DuckDB documents scanned-row counters. Their browser availability and scan-path semantics still require evidence.

Sources: [Profiling](https://duckdb.org/docs/current/dev/profiling),
[metric definitions](https://duckdb.org/docs/current/dev/metrics).

### 8. Select deployment, persistence, and browser support

Design pointers: README lines 15 and 89 specify desktop dimensions, not a browser or deployment contract.

- Select a supported browser matrix and minimum device expectations.
- Select a local static server with explicit worker, Wasm, caching, and security-header support. Record optional public hosting separately.
- Verify same-origin assets, content types, and HTTP range behavior for remote Parquet.
- Keep the initial engine single-threaded unless experiments justify experimental threads.
- For threaded execution, configure COOP/COEP and explicit compatible thread bundles and extensions.
- Verify headers against the built local application, not only the development server. Public deployment checks belong to publication.
- Define saved-query and progress migrations, export/import, quota errors, and storage eviction behavior.
- Require local runtime operation without internet access after initial provisioning, as recorded in `readiness/scope.json`.
- Serve matching engine extensions and datasets from the local server, including during a fresh browser session.
- Decide whether OPFS adds value after measurements of cache and reload behavior.

Acceptance: a named local runtime, browser matrix, persistence contract, and local production-header feasibility results.
Cross-origin isolation headers alone do not enable DuckDB threads.

Sources: [Instantiation](https://duckdb.org/docs/current/clients/wasm/instantiation),
[deployment](https://duckdb.org/docs/current/clients/wasm/deploying_duckdb_wasm),
[browser storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

### 9. Complete the product and asset decisions

Design pointers: README lines 17–24, 41, 69, and 111–123.

- Inventory every visible menu, toolbar action, desktop icon, tab, and window control.
- Define behavior for Save, Open, My Queries, Schema Reference, Recycle Bin, and Hush.
- Replace the prototype Execute action with actual query execution.
- Define keyboard navigation, focus, accessible names, splitters, and browser zoom behavior.
- Preserve pane scrolling and the specified desktop layout below its minimum dimensions.
- Define meaningful behavior for all visible controls instead of retaining decorative clickable elements.
- Author the curriculum rather than copying generated challenge titles and fake scores.
- Decide whether five challenges for each of twelve skills is the intended scope.
- Record the user's decision to keep the supplied portrait for local work and defer its exact public-distribution permission review.
- Select native-size icons that preserve pixel geometry and semantic colors.
- Record icon attribution and distribution terms.

Acceptance: an interaction inventory, curriculum scope, accessibility criteria, and explicit asset decisions with deferred publication concerns.
The free Pixelarticons set is MIT-licensed, but its 24-pixel artwork is not a direct match for small tree icons.

Source: [Pixelarticons free set](https://pixelarticons.com/free/).

### 10. Decide the leaderboard and account boundary

Design pointer: README line 17 names a Leaderboard icon but provides no leaderboard behavior.

- Decide whether the product needs local practice records or a public leaderboard.
- Define account and synchronization requirements only if the product needs them.
- For trusted public rankings, require server-side re-execution in a resource-limited environment.
- Do not accept client-reported correctness or performance as authoritative.
- Define submission retention, abuse limits, and comparable ranking criteria before selecting a backend.
- If public rankings are excluded, record that scope decision explicitly.

Acceptance: a documented product decision and the corresponding trust boundary.
The local-first recommendation does not silently remove the leaderboard from the design.

## Execution sequence

1. Resolve challenge semantics and create small fixtures.
2. Run the engine, parser, comparator, profile, and recovery experiments.
3. Measure the representative dataset across the browser matrix.
4. Select the dataset size, parser architecture, deployment target, and persistence policy.
5. Record product scope and asset permissions.
6. Define one complete challenge as the first application milestone.
7. Build the full desktop interface around proven execution and grading behavior.
8. Expand the curriculum and implement approved online features.

Steps 6–8 describe the subsequent application build, not completed work under this readiness goal.

## Definition of done

- [x] Every required outcome has a decision, evidence, or an explicit unresolved external prerequisite.
- [x] Feasibility evidence names package versions, browsers, commands, fixtures, measurements, and limitations.
- [x] Parser evidence covers syntax, offsets, incomplete input, and concurrent execution.
- [x] Comparator evidence covers duplicates, NULLs, exact values, wrong types, and ordering.
- [x] Execution evidence covers cancellation, large output, restricted access, and worker recovery.
- [x] Dataset evidence supports the chosen size and storage strategy.
- [x] Profiling evidence supports every displayed metric and performance criterion.
- [x] Product scope covers progression, controls, curriculum, persistence, and leaderboard behavior.
- [x] Asset permissions and accessibility criteria are explicit.
- [x] The implementation milestone links to the preserved design and the resolved contracts.

These checks record evidence coverage, not release approval or completion of unresolved prerequisites.

### Publication concerns, not local completion gates

The user clarified that the site must run locally. `readiness/scope.json` records the authoritative runtime scope.
The built local harness serves all engine, extension, and dataset assets without external runtime requests.
Portrait distribution, owned public hosting, and additional device guarantees remain deferred. They do not block local implementation readiness.
These deferrals do not grant public-release approval. The subsequent application now exists at the repository root.
