# Dataset and grading contract

## Scope and evidence

The current catalog contains 65 runnable challenges across 13 skills.
`curriculum.json` defines the skill graph, required challenge order, definition paths, and dataset paths.
`src/lib/challenges.ts` defines and checks the runtime contracts.
Challenge definitions supply learner text, starters, three ordered hints, output contracts, references, and assessment assets.

The catalog includes exact exercises, five measured plan labs, four guided reconciliation stages, and an outcome-based reconciliation capstone.
The original Challenge 07 remains `window.03`, with display alias `07`.
Its semantic version remains `challenge-07-v1`. Its current package is `window.03-bundle-v2`.
The original schema, fixtures, reference SQL, expected ranking rows, and small Parquet bytes remain unchanged.
The preserved reference returns nine boundary rows and thirty-six small-dataset rows.

The original design supplies the commerce table names but no executable commerce dataset.
The sections about Challenge 07 below preserve the independently derived mathematical contract.
They do not restrict the other challenges to its row count, output columns, or dataset.
Historical evidence under `evidence/` retains the scope of its recorded run.

Sources:

- Design specification, in the original handoff bundle kept outside this repository.
- [Product contract](product.md)
- [DuckDB ranking functions](https://duckdb.org/docs/current/sql/functions/window_functions.html)
- [DuckDB numeric types](https://duckdb.org/docs/current/sql/data_types/numeric.html)
- [DuckDB duplicate-preserving set operations](https://duckdb.org/docs/current/sql/query_syntax/setops.html)

These upstream links describe contracts, not evidence from the selected browser engine.

## Original ranking assets and run procedure

| Asset | Version | Purpose |
| --- | --- | --- |
| `schema.sql` | `commerce-v1` | Eight constrained tables |
| `fixtures.sql` | `boundary-v1` | Hand-calculable semantic dataset |
| `generator.sql` | `commerce-generator-v1` | Deterministic learning data at two scales |
| `reference-07.sql` | `reference-07-v1` | Corrected answer |
| `expected-07.json` | `typed-result-v1` | Nine typed expected rows for `boundary-v1` |
| Challenge text in this document | `challenge-07-v1` | Output and learning requirements |

1. Create a fresh disposable DuckDB database.
2. Run `schema.sql`.
3. For boundary checks, run `fixtures.sql`.
4. For generated data, run `generator.sql` instead of `fixtures.sql`.
5. Run `reference-07.sql`.
6. For boundary checks, compare the complete result with `expected-07.json`.

The two dataset loaders are alternatives. Neither loader appends safely to an existing dataset.
The generator needs no random function, clock, or third-party generator package.
In the selected Wasm engine, UTC timestamp operations require the matching ICU extension during bootstrap.
The engine report records self-hosted ICU, JSON, and Parquet extension assets.

Before generated data, the caller can set these engine variables:

```sql
SET VARIABLE dataset_scale = 'small';
SET VARIABLE dataset_seed = 20240907;
```

The alternative scale is `illustrated`. The seed is an integer from 0 through 2147483646.
The generator uses `range`, integer remainder, and fixed decimal arithmetic.
Its mixing expression is `(id * multiplier + seed) % 2147483647`, with multipliers 48271 and 69621.
These expressions provide reproducibility, not cryptographic randomness or a realistic demand model.

| Table | Boundary | Small | Illustrated |
| --- | ---: | ---: | ---: |
| categories | 7 | 48 | 48 |
| customers | 2 | 500 | 120,000 |
| orders | 12 | 2,000 | 1,400,000 |
| order_items | 19 | 8,500 | 5,900,000 |
| payments | 5 | 2,100 | 1,500,000 |
| products | 5 | 240 | 12,000 |
| returns | 3 | 126 | 88,000 |
| warehouses | 4 | 14 | 14 |

The generated dataset covers joins, aggregation, date filters, windows, pivot operations, and both recursive domains.
It includes duplicate category names, empty categories, nullable emails, payment fan-out, multiple years, and non-paid statuses.
Every generated order has at least four items. The boundary dataset adds empty orders and exact ranking ties.
The generator does not guarantee ranking ties for every seed. Every grading bundle includes the boundary dataset.
Payment amounts describe independent processing snapshots, not a reconciled accounting ledger.
The reconciliation family uses separate reference and partner events, not these payment snapshots.

Logical rows are deterministic for a version, scale, and seed. Physical row order is not part of dataset identity.
Parquet export needs stable primary-key ordering, pinned writer configuration, file hashes, and manifest row counts.
The published ranking Parquet assets retain their original hashes and row counts.
The illustrated scale is a measurement target, not the application default.

## Catalog dataset families

Each `DatasetDefinition` declares its schema, table load order, preview variant, grading variants, and ordered trusted bootstrap assets.
Optional Parquet entries name their tables explicitly. The engine does not infer tables from commerce constants.
Trusted bootstrap SQL can contain multiple statements. Learner SQL remains one admitted statement.

| Family | Purpose and variants |
| --- | --- |
| `commerce-ranking` | Unchanged Challenge 07. Preview `small-v1`, grade `boundary-v1` and `small-v1`. |
| `commerce-practice` | Commerce exercises and selected labs. Grade boundary plus seeds 20240907 and 20240908. Preview seed 20240907. |
| `workshop` | Nullable cohorts, raw contacts, date frames, and reshape exercises with two variants. |
| `graphs` | Explicit cycles and directed route alternatives with two variants. Separate from the commerce forests. |
| `index-lab` | `lookup_orders` with 100,000 rows and a primary key. Disposable index and selectivity experiments. |
| `reconciliation` | Immutable reference events, imperfect partner events, and category aliases. Boundary plus two seeded variants. |

The original commerce row-count table describes unsupplemented ranking data, not `commerce-practice`.
Practice supplements add orderless customers, nullable contacts, quantity boundaries, tied order timestamps, and payment selection boundaries.
The supplements use IDs from 10001. They preserve the boundary customer whose ID exceeds JavaScript's exact integer range.
Practice publication runs `invariants.sql`, without an accounting-balance invariant.

### Seeded practice preparation

The small generator originally assigns roots to category IDs 2, 3, and 7.
Practice supplements require these IDs to be leaves. A dataset-local permutation preserves the forest and all product relationships.
Preparation copies the generated rows into temporary tables and updates category identities and parent references there.
Restoration recreates the unchanged constrained schema, then inserts parents before descendants.
This sequence avoids unsafe in-place changes to referenced primary keys.

Generated order 1 can occur after the supplemental payment timestamp.
Preparation moves that order to an earlier timestamp, no later than `2024-01-01 00:00:00 UTC`.
Its payment and return timestamps move by the same offset. Their relative event intervals remain unchanged.
Only the seeded practice variants use this adaptation.

The loader uses `dataset_scale='small'`, not `illustrated`.
It removes `generator_config` and preparation tables. It then adds the supplements and runs the invariants.
No adaptation changes `schema.sql`, `fixtures.sql`, `generator.sql`, `reference-07.sql`, `expected-07.json`, or the ranking Parquet assets.

### Publication and loading

The [README](../README.md#publish-challenge-content) gives the setup and publication commands.
`curriculum.mjs` requires an explicit `LAB_URL` and checks the loaded DuckDB v1.5.4 engine.
It uses the existing engine lab and exact scalar encoder, not a separate Wasm runtime.
The publisher checks references against independently authored boundary answers before it generates non-boundary expected assets.
It also checks incomplete starters, plausible wrong queries, both capstone policies, and intentionally bad policies.

`--check` does not change published assets.
`--publish` stages generated assets and replaces them with the manifest only after every content check succeeds.
The manifest recursively records referenced definitions, schemas, bootstrap SQL, references, expected answers, truth, runtime assets, and Parquet files.
Each entry includes its byte length and SHA-256 hash.
Application setup preserves nested asset paths rather than flattening basenames.

The loader rejects unknown or duplicate IDs, missing references, prerequisite cycles, empty grading lists, malformed outputs, and invalid hint sequences.
Asset paths must be safe same-origin paths in the publication manifest.
Caches use immutable publication and content identities. Selecting a challenge does not load every dataset.
A content error keeps drafts available and exposes retry. It never substitutes Challenge 07.

## Schema decisions

All primary keys are positive `BIGINT` values. Every declared foreign key references the primary key of its target table.
All columns are `NOT NULL` except the nullable columns in this table.
`schema.sql` is the authoritative DDL for exact checks and types.

| Table | Columns and types beyond its `BIGINT` primary key | Nullable columns |
| --- | --- | --- |
| categories | `parent_category_id BIGINT`, `c_name VARCHAR` | `parent_category_id` |
| customers | `customer_name VARCHAR`, `email VARCHAR`, `created_at TIMESTAMPTZ` | `email` |
| warehouses | `warehouse_name VARCHAR`, `route_to_warehouse_id BIGINT`, `route_minutes INTEGER` | `route_to_warehouse_id` |
| products | `category_id BIGINT`, `product_name VARCHAR`, `unit_price DECIMAL(18,2)`, `active BOOLEAN` | None |
| orders | `customer_id BIGINT`, `warehouse_id BIGINT`, `ordered_at TIMESTAMPTZ`, `status VARCHAR` | None |
| order_items | `order_id BIGINT`, `product_id BIGINT`, `qty INTEGER`, `unit_price DECIMAL(18,2)` | None |
| payments | `order_id BIGINT`, `paid_at TIMESTAMPTZ`, `status VARCHAR`, `amount DECIMAL(18,2)` | `paid_at` |
| returns | `order_item_id BIGINT`, `qty INTEGER`, `reason VARCHAR`, `status VARCHAR`, `requested_at TIMESTAMPTZ`, `refunded_at TIMESTAMPTZ`, `refund_amount DECIMAL(18,2)` | `refunded_at` |

Relationships:

- A category has zero or one parent category and any number of children.
- A product belongs to one category. Different categories can share a name.
- A customer has any number of orders. Customer names and emails are not identity keys.
- An order belongs to one customer and one fulfillment warehouse.
- An order has any number of items and payment attempts, including zero.
- An item belongs to one order and one product. Repeated products within an order are valid.
- An item has any number of return requests, including zero.
- A warehouse has zero or one next-hop warehouse. Multiple warehouses can share a next hop.

The hierarchy and routing data use forests, not arbitrary graphs.
A parent or next-hop ID must be smaller than its child ID. This constraint excludes self-links and cycles.
This numbering restriction replaces unrestricted graph identity to keep eight-table fixtures enforceable without triggers.
Generated categories use eight roots and forty children. Category 48 has no products.
Generated warehouses use one root, six regional nodes, and seven local nodes.
`route_minutes` describes the directed edge to the next hop. A root has zero minutes and no next hop.
The boundary route from warehouse 4 through 2 to 1 costs 5 + 10 = 15 minutes.
A recursive exercise can return ancestors, depth, route path, and accumulated minutes.
Multiple route alternatives, inventory, and stock transfers are outside this schema.

The schema enforces positive quantities through 1000 and prices from 0.00 through 999999.99.
An inactive product remains eligible for historic revenue.
An empty string differs from NULL. Emails are not unique and need no production email validation.

Order statuses are `pending`, `paid`, `cancelled`, and `refunded`.
Payment statuses are `pending`, `succeeded`, and `failed`.
A successful payment requires `paid_at`. Other payment statuses require NULL.
Return statuses are `requested`, `refunded`, and `rejected`.
Return reasons are `damaged`, `wrong_item`, and `unwanted`.
A refunded return requires a refund timestamp no earlier than its request and a nonnegative refund amount.
Other returns require a NULL refund timestamp and a zero refund amount.

Cross-row publication invariants supplement the DDL:

- Every product references a leaf category in these dataset versions.
- Customer creation precedes each corresponding order.
- A return request follows its order timestamp.
- Total requested or refunded quantity per item does not exceed purchased quantity. Rejected requests do not consume that allowance.
- Total refund amount per item does not exceed that item's transaction value.
- A payment timestamp does not precede its order timestamp.

The DDL does not enforce those cross-row invariants. The asset publication check must enforce them before distribution.
Even when payment attempts suggest another status, order status remains authoritative for challenge 07.
Neither successful payments nor partial refunds automatically change the order status in this static dataset.
Tax, shipping, currencies, exchange rates, discounts as separate fields, and temporal product-category history are outside this schema.
The transaction price already includes any item-level discount. All money uses one fictional currency with two decimal places.
Categories describe a fixed dataset snapshot, not the category at an earlier sale date.

## Challenge 07 text

**Top categories by monthly paid gross revenue**

For each UTC calendar month in 2024, return categories whose competition rank is at most three.
Revenue is the sum of `order_items.qty * order_items.unit_price` for orders whose status is exactly `paid`.
Include orders at `2024-01-01T00:00:00Z`. Exclude orders at `2025-01-01T00:00:00Z`.
Use the category ID as identity. Do not combine categories that share a display name.
Do not subtract returns or include tax, shipping, or payment amounts.
Rank categories by revenue in descending order within each month. Equal revenues share a rank, and subsequent ranks contain gaps.
Include every category tied at rank three. A qualifying category with zero revenue remains eligible.
Return no row for a category without qualifying items or a month without qualifying categories.

Return these columns in this order:

```text
mon DATE
category_id BIGINT
c_name VARCHAR
revenue DECIMAL(38,2)
rnk BIGINT
```

Order the result by `mon ASC, rnk ASC`. Any order within identical `(mon, rnk)` peers is acceptable.
The reference adds `category_id ASC` only for a stable example display.
The answer can contain fewer or more than three rows per month. It does not require exactly 36 rows.

The learning objective is competition ranking with a window function.
The reference and hints explain that construct. Equivalent relational answers earn completion without a SQL-keyword requirement.
Completion records a correct outcome, not proof of technique mastery.

### Proposed-default decision table

| GOAL proposal | Decision | Exact meaning |
| --- | --- | --- |
| Competition `RANK`, ties through rank three | Adopt | Revenue alone determines window peers. Category ID must not break the ranking tie. |
| Variable row counts | Adopt | Four January rows, three February rows, and no March row in the boundary fixture. |
| `orders.status = 'paid'` | Adopt | No inference from payments. `refunded` orders are excluded. |
| Transaction prices, gross revenue | Adopt | Item price, not current product price. No refund subtraction or payment join. |
| Half-open 2024 range | Adopt | UTC instants from January 1 inclusive to next January 1 exclusive. |
| Timezone and `DATE` month | Adopt and specify | UTC conversion precedes month truncation. The output is a date, not a timestamp or string. |
| Exact decimals and bounds | Adopt and specify | Prices `DECIMAL(18,2)`, quantity 1–1000, total `DECIMAL(38,2)`. No floating tolerance. |
| Category identity separate from name | Adopt and extend output | Add `category_id BIGINT`. Group by ID and name. Never rank an ancestor rollup. |
| Empty months | Adopt | No synthetic calendar rows. Empty categories also disappear. |
| Final ordering and peers | Adopt and specify | Ascending month and rank. Peers can appear in any internal order. |

The added identity column changes the prototype's four-column shape deliberately.
It makes equal-name categories distinguishable without changing their names.
The product grid must display the fifth column rather than hide identity from the grading contract.

### Decimal arithmetic and bounds

Prices contain exact cents. Quantity multiplication does not use floating-point arithmetic.
The reference casts quantity to `DECIMAL(18,0)` before multiplication and casts the sum to `DECIMAL(38,2)`.
The maximum line value is 1000 × 999999.99 = 999999990.00.
At 5,900,000 items, the maximum dataset total is 5899999941000000.00.
This bound fits the 36 integral digits available in `DECIMAL(38,2)`.
Every intermediate multiplication also fits its declared decimal width.
Published datasets cannot exceed the declared row count without a new version and a new bound.
An engine overflow is an execution error, not a rounded answer or a partial pass.

## Independent boundary arithmetic

This section derives expected values from the item ledger, not from the reference SQL.
Category 2 and category 3 both have the name `Audio`.
Category 1 is the root. Category 7 has no products. Neither category contributes a row.

| UTC month | Category ID | Item arithmetic | Revenue | Competition rank | Include? |
| --- | ---: | --- | ---: | ---: | --- |
| January | 2 | 3×20 + 1×20 + 1×20 | 100.00 | 1 | Yes |
| January | 3 | 1×100 | 100.00 | 1 | Yes |
| January | 4 | 1×90 | 90.00 | 3 | Yes |
| January | 5 | 1×90 | 90.00 | 3 | Yes |
| January | 6 | 1×80 + 1×0 | 80.00 | 5 | No |
| February | 2 | 1×50 | 50.00 | 1 | Yes |
| February | 3 | 1×40 | 40.00 | 2 | Yes |
| February | 4 | 1×40 | 40.00 | 2 | Yes |
| February | 5 | 1×30 | 30.00 | 4 | No |
| April | 6 | 1×0 | 0.00 | 1 | Yes |
| December | 4 | 2×12.34 | 24.68 | 1 | Yes |

The expected answer contains 4 + 3 + 1 + 1 = 9 rows.
The expected revenue sum is 380.00 + 130.00 + 0.00 + 24.68 = 534.68.
January `DENSE_RANK` gives ranks 1, 1, 2, 2, 3 and incorrectly includes category 6.
February `DENSE_RANK` incorrectly includes category 5 at rank three.
`ROW_NUMBER` or `LIMIT 3` loses a January cutoff peer.

Boundary causes:

- Order 1 occurs exactly at the UTC lower bound, despite its local 2023 date. Its three items contribute 100.00.
- Order 3 has a local February date but a January UTC instant. Its zero-price item belongs to January.
- Order 4 occurs on leap day. Its four category totals belong to February.
- March orders have `pending`, `cancelled`, or `refunded` status. All three 900.00 amounts are excluded.
- Order 5 has a successful payment but remains pending. Payment success cannot replace the status predicate.
- Order 8 contributes an actual zero-value group. Zero revenue differs from an absent group.
- Order 9 has a local 2025 date but a December UTC instant. Its 24.68 amount belongs to December.
- Order 10 occurs exactly at the UTC upper bound. Its 999.89 amount is excluded.
- Order 11 occurs one second before the lower bound. Its 999.99 amount is excluded.
- Order 12 is paid but has no items. It creates no category group.
- Current product prices differ from every fixture transaction price. Product-price substitution cannot pass.
- Two refunds on item 1 total 40.00. Paid gross revenue remains 100.00 for category 2 in January.
- Order 1 has two successful payments and one failed payment. An unaggregated payment join multiplies item revenue.
- Two returns on item 1 also multiply its rows in an unaggregated join.
- Items 2 and 3 have identical business fields but distinct primary keys. `DISTINCT` on those fields incorrectly deletes 20.00.
- Customer ID `9007199254740993` exceeds JavaScript's exact integer range. Its exact value must survive result transport.
- Customers share a name, and one email is NULL. Name identity and NULL handling have independent boundary examples.

The reference needs only orders, items, products, and categories.
Comma joins with all three relationship predicates remain correct. Explicit joins are a readability choice, not the grading rule.

## Typed grading protocol

The grader compares the complete result, not the grid preview or a row-count label.
It does not execute learner SQL with an added `LIMIT` and then grade that truncated answer.
A result-cap breach has outcome `result-limit`, not `incorrect` or `correct`.
Timeout, cancellation, engine errors, stale runs, and incomplete transfers never award a correctness pass.

Each run captures this complete `ContentIdentity` at dispatch:

```text
challengeId, bundleVersion, challengeVersion
datasetVersion, assessmentVersion, engineVersion
```

The request and result also retain the dataset ID, document ID, SQL revision, SQL text, and run identity.
Manifest hashes protect the assets behind the identity. The engine settings include UTC, one thread, limits, extensions, and access policy.
New exact content uses `<challengeId>-v1`, `<challengeId>-bundle-v1`, and `exact-v1`.
Plan labs use `plan-lab-v1`. The capstone uses `reconciliation-v1`.
The four guided reconciliation stages use exact assessment.

Runs use fresh snapshots. Every grading variant runs the reference and learner SQL against its own restored data.
The engine checks the reference against the expected asset before it assesses the learner result.
A reference disagreement is a content error, not an incorrect learner answer.
An engine failure stops assessment. Otherwise, the result records named outcomes for each grading variant.

A result belongs to its dispatched SQL revision and content identity.
An edit makes the displayed result stale. A document switch cannot attach its result or attempt to another challenge.
The attempt retains the result identity, not an identity inferred from the currently selected document.
Execute provides feedback but no completion. Submission records the exact, lab, or reconciliation assessment.

Comparison procedure:

1. Require a complete, successful result with the expected bundle identity.
2. Compare column count, names, order, and declared logical types before values.
3. Decode Arrow values without conversion through JavaScript `Number` for integers or decimals.
4. Encode each typed row with unambiguous field boundaries and explicit NULL markers.
5. Compare row multiplicities in both directions.
6. Compare ordering independently across the full row sequence.
7. Award correctness only after every required fixture passes.

A length-prefixed typed tuple is a valid row key. A joined string with an ordinary delimiter is not.
A hash can index buckets, but equal hashes still require exact tuple comparison.
The comparator retains duplicate multiplicities and checks the complete retained result.
It checks expected-asset identity, scalar encodings, completeness, arbitrary row counts, and arbitrary output shapes.
There is no nine-row, five-column, month, or rank assumption in the shared comparator.

Type and value rules:

| Kind | Contract |
| --- | --- |
| Integer | Exact logical integer type. Encode `BIGINT` as a decimal string or lossless bigint, never a floating number. |
| Decimal | Exact scale and scaled integer value. If its precision represents every expected value, the width can differ. |
| Date | Exact `DATE`, then exact calendar day. A midnight timestamp or date-shaped string fails the type check. |
| Timestamp | Not a declared output type in the current challenge contracts. A timestamp cannot substitute for `DATE`. |
| String | Exact Unicode sequence. No trimming, case folding, normalization, or locale collation. |
| Boolean | Exact `BOOLEAN` and value. Numeric 0 and 1 are not substitutes. |
| NULL | NULL equals NULL for result comparison. NULL differs from empty text, zero, and a missing column. |
| Floating point | Not a declared output type in the current catalog. No float tolerance applies. |

The expected JSON uses decimal strings, integer strings, date strings, and JSON null under explicit column types.
Its `nullable` fields describe expected values. Arrow nullability metadata does not determine correctness.
For challenge 07, `DECIMAL(18,2)` revenue can pass because width is not a semantic requirement.
Even when a grid displays the same digits, `DECIMAL(38,3)`, `DOUBLE`, and `VARCHAR` revenue fail.
The displayed target remains `DECIMAL(38,2)` because that width safely covers the published data bound.

Every ordering key declares its column, direction, and NULL placement.
The comparator uses exact typed values to compare adjacent keys. Identical keys permit either peer order.
For Challenge 07, the keys remain `(mon ASC, rnk ASC)`. Duplicate counts remain significant.
Declared SQL types map to Arrow representations. SQL display strings do not substitute for Arrow type interpretation.

Acceptance and rejection examples:

| Submission result or behavior | Decision |
| --- | --- |
| January categories 3 then 2, followed by 5 then 4 | Accept. Both exchanges remain inside peers. |
| January rank-three rows before rank-one rows | Reject ordering, even with equal row multisets. |
| Same nine rows with another exact decimal width at scale two | Accept. |
| Same nine rows with `rnk INTEGER` or `mon VARCHAR` | Reject types before values. |
| An extra copy of the first row and a missing second row | Reject multiplicities, despite the same row count and display name. |
| Nine matching preview rows followed by another row | Reject the complete result. |
| Cancellation after nine matching rows | No correctness decision or completion. |
| A correlated-count answer with the correct typed results on every variant | Completion passes. No window-syntax requirement applies. |
| Correct explicit joins or correct comma joins | Same correctness decision. |
| Correct but slower SQL or `SELECT *` with the exact output | Correctness remains independent of style and speed. |
| NULL replaced by empty text in a nullable exercise | Reject values. |
| `9007199254740993` rounded to `9007199254740992` | Reject values. |

## Progression and durable identity

The catalog defines 13 skills, each with five required challenges.
The original aliases remain `07` for `window.03`, `08` for `rec.01`, and `09` for `pivot.01`.
Fresh profiles open `basics.01`. Every available challenge has its own current-version document.

A challenge is completed when a nondeleted correct attempt matches every field of its current content identity.
A skill is completed when all five current required challenges are completed.
Completion, diagnostics, measurements, and explanations remain separate. Completion never claims technique mastery.
All five challenges in an available skill are directly selectable, without intra-skill gates.

The prerequisite graph preserves the original seventeen edges:

```text
basics -> agg, joins, sub
agg -> cte, window, sets
joins -> cte, window, dates, plan
sub -> cte, clean
cte -> rec, pivot
window -> pivot, plan
dates -> clean
```

The added `reconcile` skill requires `cte`, `window`, `sets`, and `clean`.
A skill becomes available after all prerequisite skills are completed.
The application records an opened skill only after the learner opens an available challenge.
Previously opened skills remain accessible after a prerequisite loses current completion.

Visible states are locked, available, in-progress, completed, and needs-review.
Historical passes show needs-review, not current completion.
Open next follows authored challenge order and skips current completed challenges.
A later incorrect attempt does not erase an earlier current pass. Attempt deletion recomputes completion.
Hints preserve the highest revealed level and do not reduce credit.

### Version 2 storage and backups

Query documents store `challenge: ContentIdentity | null`, `datasetId`, and any lab SQL and report answers.
Scratch documents use a selected dataset without a challenge identity. They cannot submit for credit.
Attempts store the captured content identity and accepted assessment evidence.
Lab evidence contains measurements and report answers, not worker handles.
Progress caches use challenge ID and bundle version. Accepted attempts remain the source of completion.

IndexedDB and exported backups use version 2.
Version 1 migration preserves SQL, revisions, history, timestamps, deletion state, selections, scroll, hints, and attempts transactionally.
Known legacy `window.03` records retain their recorded versions with `legacy-assessment-v1`.
Documents without a recorded legacy engine version use the historical `v1.5.4`, not the currently loaded engine.
Legacy window records also preserve window access as previously opened.

The new `window.03-bundle-v2` requires resubmission despite unchanged ranking semantics.
Unknown legacy identities remain historical and ungradable.
Unavailable historical attempts open as scratch with an explicit notice, never as a silently reassigned current challenge.

Imports accept version 1 through explicit migration and accept strictly checked version 2 records.
Exports emit only version 2.
Malformed data or broken relationships reject the import without replacing existing data.
A failed migration preserves the old database. Blocked upgrades and `versionchange` retain recovery behavior.
Backups contain durable state, not transient Arrow buffers. Local records remain learner-owned practice data.

## Reset and index sandbox

Challenge source data and grading fixtures are immutable publication assets.
A challenge run cannot permanently mutate the source or reuse learner-mutated data for grading.
The engine integration must enforce this boundary rather than rely only on a SQL keyword filter.

Two execution domains keep the behavior explicit:

| Domain | Data and permitted intent | Reset |
| --- | --- | --- |
| Challenge | Protected published data. Read queries only. | Recreate the disposable engine and restore the same bundle. |
| Index lab | Separate `index-lab` snapshot. One non-unique index on `lookup_orders(customer_id)`, a read probe, and DROP. | Terminate the sandbox and restore its published source. |

The index domain never points at writable challenge source files.
Parquet views are suitable for read exercises but cannot stand in for internal tables in index exercises.
The index lab checks `duckdb_indexes()` before creation, after creation, and after DROP.
It checks the index table, column, name, and non-unique status.
The probe must return exact results before creation, with the index, and after DROP.
An incomplete sequence cannot pass. A sequential scan can pass when the report agrees with the measured profile.

An engine reset deletes temporary tables, session variables, macros, indexes, and partial result handles.
The selected challenge policy creates a fresh worker and restores trusted publication data before every run.
Historical snapshot-poisoning evidence in `evidence/safety.json` establishes restoration for its recorded engine scope.
The implementation does not depend on the failed read-only database transition.
Restoration includes the schema, dataset version, UTC, engine settings, and selected execution domain.
Saved queries, editor text, attempt history, hints, and completion remain outside the engine in persistent application storage.
A reset never means a progress reset. A separate, explicit product action controls deletion of saved progress.
Cancellation and recovery must invalidate active run identities before another result can receive credit.
The index sandbox terminates on reset, cancellation, completion, or navigation.
No general DDL or source-file mutation is available through the lab.

The current execution bounds are one thread, 512 MiB memory, 10 seconds per statement, and 30 seconds for initialization.
Retained results have limits of 100,000 rows and 32 MiB.
Cancellation terminates an unresponsive worker after a 1,500 ms grace period.
The [judge contract](judge.md) defines measured lab evidence and the reconciliation rubric.
The [README](../README.md#focused-regression-checks) distinguishes current focused checks from pending full-catalog UI proof.
