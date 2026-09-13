# Deterministic judge rules

The application implements deterministic diagnostics and three assessment kinds: exact, plan-lab, and reconciliation.
`src/lib/engine-diagnostics.ts` supplies diagnostics against the selected dataset's actual schema.
`src/lib/engine-profile.ts` supplies the shared profile adapter for diagnostics and measured labs.
The selected engine is DuckDB v1.5.4 through Wasm package 1.33.1-dev57.0.

Historical examples below use the original unsupplemented commerce boundary dataset.
Their row counts do not describe `commerce-practice` or every current dataset.
Their evidence remains in `evidence/profile.json`, `evidence/suite.json`, and `evidence/browser-matrix.json`.
The [README](../README.md#focused-regression-checks) records current focused coverage and pending full-catalog UI proof.

## Shared diagnostic record

The diagnostic contract identifies these facts:

```text
ruleId, ruleVersion, severity: warning | style | information
sqlRevision, sqlHash, runId | null, bundleVersion
facts[], sourceRanges[{fromUtf16,toUtf16}], explanationId
planEvidence[{operatorPath,field,value}] | null
coverage: verified | unsupported
```

A live diagnostic uses the current AST and current revision. A measured diagnostic also needs the matching plan and run identity.
Source ranges select verified tokens, not guessed line numbers from the prototype.
If an AST location is absent or invalid, the diagnostic remains in Notes without a false highlight.
Unsupported syntax produces no speculative relationship diagnosis.
Phrasing never changes facts, severity, source ranges, or grading.
No diagnostic affects ordinary correctness. No LLM participates in these rules or grading.

## J001: disconnected relationships

Severity: warning. Fact: the analyzed join scope has disconnected relations without an explicit intentional cross join.
The analyzer resolves aliases and schema identities before it constructs a relation graph.
It includes supported relationship predicates in both ON and WHERE.
It treats nested scopes, correlated references, USING, and NATURAL joins according to their actual binding semantics.
If that analysis is incomplete, the rule reports unsupported coverage instead of a missing relationship.
An OR expression, lateral dependency, or unsupported join form cannot become proof of disconnection through token matching.

Positive example:

```sql
SELECT count(*) FROM orders o, order_items i;
```

The boundary fixture produces 228 rows before aggregation: 12 orders × 19 items.
Its measured plan contains CROSS_PRODUCT with cardinality 228.
The warning names the absent orders/items relationship. The comma itself is not the cause.
A token range selects the unconnected relation reference, not every comma in the query.

Negative examples:

```sql
SELECT count(*) FROM orders o, order_items i
WHERE o.order_id = i.order_id;

SELECT count(*) FROM orders o
JOIN order_items i ON o.order_id = i.order_id;

SELECT count(*) FROM range(2) a CROSS JOIN range(3) b;
```

Both relationship queries return 19 and use the same measured HASH_JOIN condition.
The explicit CROSS JOIN returns the intended six combinations and receives no missing-relationship warning.
An explicit cross join can still produce a wrong challenge answer. Only the complete grader decides that question.
An intentional date/category grid is another legitimate cross-join use.

Dialogue for the same verified disconnection: “No orders-to-items relationship connects these sources. The measured join produces 228 combinations.”

Before a run, the dialogue omits the measured count and says only what the current AST supports.

## J002: explicit projection

Severity: style. Fact: a SELECT list contains an expansion wildcard.
The highlighted source range covers that wildcard token.
The explanation recommends explicit output columns for readability and a stable interface.
It never claims that every source column crosses the join or that a rewrite necessarily runs faster.

Positive example:

```sql
WITH x AS (SELECT * FROM order_items)
SELECT sum(qty) FROM x;
```

The style advice applies to the CTE wildcard.
The measured plan reads only `qty`, despite the wildcard. That fact forbids the prototype's all-columns performance claim.
`SELECT i.* FROM order_items i` has the same style trigger.

Negative examples:

```sql
SELECT qty, unit_price FROM order_items;
SELECT count(*) FROM order_items;
SELECT qty * unit_price FROM order_items;
```

COUNT's wildcard and the multiplication operator are not projection expansions.
The rule must distinguish their AST classes rather than search for the `*` character.

Dialogue: “Name the projected columns to make this query's interface explicit.”

This advice stays at style severity and makes no performance claim.

## J003: repeated scan observation

Severity: information. Fact: a measured plan contains multiple physical scan nodes for the same resolved source.
This rule runs only after a profile exists for the current revision and content identity.
It counts local scan nodes and records their operator paths and projected columns.
`operator_rows_scanned` describes scanned work. `extra_info.Table` identifies its source.
Output cardinality is a different metric. The adapter preserves absent metrics rather than replacing them with zero.
The rule never sums cumulative subtree counters repeatedly.
It does not label repeated scans avoidable without an equivalent measured alternative.

Positive acceptance example:

```sql
SELECT (SELECT sum(qty) FROM order_items WHERE qty > 1) AS a,
       (SELECT sum(qty) FROM order_items WHERE qty = 1) AS b;
```

The measured plan contains two scans, each with 19 scanned rows.
The first emits two rows, and the second emits seventeen rows.
If a later engine reuses a scan, the rule reports only the observed scan count.
SQL text alone cannot establish repeated physical work.

Negative measured example:

```sql
SELECT sum(qty) AS a, sum(qty) AS b FROM order_items;
```

The current evidence contains one scan and one `sum_no_overflow(#0)` aggregate.
Both result columns contain 22. The repeated aggregate text receives no repeated-computation warning.
A single scan with a larger output cardinality also does not trigger repeated-scan advice.
A self join can need two scans. The rule observes them without calling the SQL incorrect.

Dialogue reports the measured count directly: “The measured plan contains {count} scans of {source}. Compare their projections and filters.”

## Performance claims and acceptance

An avoidable-work claim needs all of the following evidence:

1. The original query passes complete correctness checks.
2. The proposed alternative passes the same typed, duplicate-preserving, ordered checks.
3. Both plans use the same dataset, configuration, and engine version.
4. The claimed operator change exists in those plans.
5. Any runtime claim uses alternating paired measurements with separate profiles.

A join graph, style advice, or plan count never substitutes for full semantic grading.
J001 and J002 remain advisory. No warning determines completion.
Equivalent results earn exact completion without proof of a specific SQL construct.
A stale diagnostic must neither change the scorecard nor move the editor selection.
Unsupported parser structures receive no speculative structural diagnosis. DuckDB execution support is separate from parser coverage.

## Exact assessment

`src/lib/engine-results.ts` compares complete typed results against each challenge's declared output contract.
The comparison preserves duplicates and exact BIGINT and DECIMAL values.
It checks column names, column order, logical types, decimal scale, and declared ordering keys.
NULL values remain significant. Arrow nullability metadata does not determine correctness.
Peers can appear in either order only when their declared ordering keys are identical.
There is no float tolerance, global text normalization, or fixed Challenge 07 result shape.

Every grading variant uses a fresh snapshot.
The engine checks the reference result against its expected asset before it assesses learner SQL.
A reference disagreement produces a content error. It does not mark the learner answer incorrect.
An exact pass requires every grading variant to pass.
Execute, cancellation, timeout, engine errors, incomplete transfer, and output limits cannot earn completion.
The [semantic contract](semantics.md#typed-grading-protocol) specifies the complete identity and scalar rules.

## Measured plan labs

`src/lib/engine-labs.ts` assesses the five `plan.*` objectives.
Each lab requires correct query results and report answers that agree with measurements from the current SQL and dataset.
Evidence binds the complete content identity, dataset ID, preview variant, and SHA-256 hashes of all measured SQL strings.
Editing SQL invalidates its measurements. Editing report answers preserves measurements for unchanged SQL.
A document ID alone cannot make evidence current.

The profile adapter preserves unknown fields as absent.
`not-reported` means that a successful profile lacks the required metric.
A missing profile caused by an engine error cannot pass as `not-reported`.
No lab requires a faster query, a specific optimizer shape, or a hardware-dependent timing threshold.

| Challenge | Evidence and completion                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.01` | Exact customer order counts. Report completed result count separately from the sum of leaf scan `operator_rows_scanned`.                                 |
| `plan.02` | Two exact paid-order queries. Report filter presence for each scan profile. The panel shows actual filter text.                                          |
| `plan.03` | Exact independent order totals for the candidate and correlated baseline. Report the lower median and whether its difference exceeds both MADs combined. |
| `plan.04` | Complete CREATE/probe/DROP sequence in the disposable index sandbox. Report the actual index, sequential, or unreported access path.                     |
| `plan.05` | Exact selective and broad lookup queries. Use measured medians and MADs in the report, without rounded numeric re-entry.                                 |

For `plan.01`, any absent required leaf metric makes scanned work `not-reported`.
The EXPLAIN wrapper row count never substitutes for completed result count.
For timing comparisons, one warmup per query precedes nine alternating pairs.
The report compares the absolute median difference with the sum of both median absolute deviations (MADs).
The measured numeric fields remain evidence, not a required speedup.

### Disposable index sandbox

The `plan.04` sandbox uses `lookup_orders` from `index-lab`, separate from the learning database.
Admission permits one non-unique index on `lookup_orders(customer_id)` and DROP of that created index.
The parser and post-command `duckdb_indexes()` checks constrain the sequence. General DDL remains unavailable.
Catalog checks establish absence before creation, the correct index after creation, and absence after DROP.
The read probe must return exact results before creation, with the index, and after DROP.
An incomplete sequence cannot pass.

The learner reports the observed access path. A sequential scan can pass.
The sandbox terminates on reset, cancellation, completion, or navigation.
It cannot modify published source data or leave a permanent learning index.
Saved lab SQL, report answers, and accepted evidence persist. Worker handles do not.

## Reconciliation assessment

The reconciliation dataset contains immutable `reference_events`, imperfect `partner_events`, and `category_aliases`.
These records are separate from commerce payment snapshots.
The first four challenges use exact outputs. The fifth uses the outcome rubric below.
All stages preserve reference data and use the full normalized account block for candidate generation.

### Guided evidence and decisions

Text normalization preserves Unicode letters. It lowercases and trims text, replaces punctuation runs with spaces, and collapses whitespace.
Account keys use lower/trim, with blanks becoming NULL. Source event keys use trim only, with blanks becoming NULL.
Known category aliases map to their canonical values. Unknown categories remain normalized text.
Dates accept ISO, US month/day/year, and day/month-name/year formats. Invalid dates become NULL.

Physical replays share a non-NULL normalized event key. The smallest partner ID survives.
Missing event keys remain separate. Distinct event keys with identical values are not duplicates.
The fixtures exclude conflicting payloads under one event key.

The guided score sums integer evidence:

| Evidence                         | Points                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Description Levenshtein distance | 30 for distance at most two, 15 for distance at most five, otherwise zero. Empty descriptions score zero. |
| Date distance                    | 20 for the same date, 15 for one day, 10 for two or three days, otherwise zero.                           |
| Quantity distance                | 30 for equality, 20 for a difference of one, otherwise zero.                                              |
| Category                         | 10 for equal nonempty normalized categories.                                                              |
| Shared words                     | 10 for at least two distinct shared normalized words.                                                     |

Eligible groups support one-to-one, one-to-many, and many-to-one relationships, with at most three members per side.
Multiple members on both sides are forbidden.
Multi-member groups require equal aggregate quantities. Quantity contributes 30 points.
Other group contributions use the minimum constituent pair contribution.
Canonical group keys contain numerically sorted decimal IDs: `r:<reference IDs>|p:<partner IDs>`.

Guided decisions rank groups by descending score, then ascending group key.
The margin subtracts the best different group's score, or zero when no other group exists.
A best score less than 75 is missing. A qualifying score with margin less than 10 is ambiguous.
Otherwise, scores at least 90 are high and scores from 75 through 89 are probable.
Distinct provisional groups that share any member make every affected reference ambiguous.
This overlap rule applies simultaneously, without dependence on iteration order.
A valid many-to-one group is one group, not an overlap conflict.
Guided coverage derives from the exact decisions. Evidence scores are not calibrated probabilities.

### Outcome-based capstone

`reconcile.05` accepts different matching policies. It does not require equality with the guided reference or a particular SQL formula.
Every reference appears once with this output:

```text
ref_id BIGINT
partner_ids VARCHAR
confidence VARCHAR
score DECIMAL(5,4)
explanation VARCHAR
```

`partner_ids` contains a JSON array of decimal ID strings. Numeric JSON IDs are rejected to prevent precision loss.
Array order does not matter. Every ID must exist, and IDs within an array must be unique.
Confidence is `high`, `probable`, `ambiguous`, or `missing`. Score is from zero through one.
Explanations contain 1–1000 characters. The assessor does not check explanation keywords or establish that an explanation is true.

High and probable decisions commit links. Ambiguous decisions can list plausible candidates without commitment.
Missing decisions require an empty list.
The assessor canonicalizes replay aliases internally, then forms connected components of committed links.
It rejects oversized groups and many-to-many components.
Truth comparison credits whole components, not independent edges from an incorrect group.

Every grading variant must satisfy all requirements:

- Committed precision is at least 0.98.
- Determinate-match recall is at least 0.85.
- No high-confidence decision is incorrect.
- Every truth-ambiguous reference is ambiguous, and every truth-missing reference is missing.
- No truth-ambiguous or truth-missing reference has a committed decision.
- Split-family recall and rollup-family recall are each at least 0.80, using whole recovered truth groups.

Precision divides correct committed reference decisions by all committed reference decisions.
Determinate recall divides correctly committed determinate decisions by all determinate reference decisions.
An empty committed set has precision zero and cannot pass.
With no high-confidence commitments, high-confidence precision is not applicable, not 100%.
There is no minimum high-confidence count.

The panel separates committed coverage over all reference rows from truth recall.
It shows counts by confidence, business unit, and reference category.
It identifies false commitments, missing and ambiguous cases, and failed group recovery.
Source rows and evidence facts appear beside the learner explanation.
Generic speed comparison is unavailable for the capstone because valid outputs can differ.

### Synthetic truth and policy freedom

Truth assets remain separate from learner tables and use the same manifest checks as other content.
Public IDs do not encode a direct matching key. Fixtures include exact BIGINT IDs greater than `2^53`.
Boundary and seeded variants contain determinate, ambiguous, missing, split, and rollup cases.
All rubric denominators are nonzero.

The publisher checks two complete policies: guided additive scoring and conservative lexicographic matching.
It also requires failures for all-missing, all-matched, arbitrary tie-breaking, and greedy partner reuse.
These checks establish outcome freedom without rewarding arbitrary ambiguity resolution.
Truth, references, and expected assets remain locally inspectable.
This application provides synthetic practice, not secret anti-cheating infrastructure or production matching guarantees.
