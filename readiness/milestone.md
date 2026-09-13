# First application milestone: challenge 07

Status: implemented as the local application at the repository root. See [run instructions and evidence](../README.md).
Keyboard, native accessibility output, zoom, and reflow checks passed. Actual screen-reader interoperability remains unverified.
The user's local-runtime decision in `scope.json` governs this milestone.
Public hosting and portrait distribution checks do not block local implementation.

## Inputs

- Visual authority: [design specification](../claude-design/design_handoff_sql_grind/README.md) and [prototype](../claude-design/design_handoff_sql_grind/SQL%20Grind.dc.html).
- Product behavior: [product contract](product.md), including every control identifier and accessibility criterion.
- Challenge text and types: [semantics](semantics.md) and [learning materials](challenge-07.json).
- Data and engine identity: [manifest](manifest.json), schema, generator, boundary fixtures, and expected rows.
- Judge facts: [rule contract](judge.md).
- Feasibility evidence and limitations: [report](REPORT.md) and `evidence/`.

The original screenshots are cropped JPEG images despite their PNG filenames.
Their labels do not consistently match the judge state or screen.
The desktop design remains authoritative, but the false counters, wrong SQL, and hardcoded warnings do not.
The result grid adds category identity. Icons use the explicit native-size decision in `product.md`.

## Architecture boundaries

Svelte 5 runes own presentation state. Plain TypeScript modules own execution, comparison, persistence, and bundle validation.
Vite builds a static client application. No SvelteKit, SSR, account backend, or LLM service belongs to this milestone.
CodeMirror owns the document, selection, undo history, and editor DOM.
Its theme and highlighting APIs apply the design colors.
Large Arrow data remains outside deeply reactive arrays. The UI stores handles, revisions, counts, and run status.
The Svelte adapter for TanStack Virtual owns bounded grid virtualization.
SVG draws the seventeen skill edges. HTML buttons represent the twelve skills.

A parser worker remains independent from the execution worker and pane visibility.
A challenge execution worker belongs to exactly one run and trusted snapshot.
Before learner SQL, the loader checks asset hashes, materializes the snapshot, loads extensions, restricts external access, and locks configuration.
After cancellation, failure, or completion, the worker cannot supply data for another challenge run.
A displayed result can outlive its execution worker through an owned Arrow result handle.
The index sandbox is a separate session with explicit write permissions and reset behavior.

The first release can pay the measured startup cost for cross-run isolation.
Reusing challenge workers requires a later measured immutable-data design, not a silent optimization.
Profiling comparison sessions isolate reference and candidate data snapshots and exclude bootstrap time from query latency.
The existing paired experiment used trusted authored queries in one worker. It proves measurement mechanics, not that future isolation implementation.

## Execution state machine

```text
idle -> initializing -> running -> transferring -> complete
                         |             |
                         +-> cancelling +-> result-limit
                                  |
                              recovering -> idle
```

Any active state can transition to recovering after a worker failure.
An initialization failure shows an actionable load error without pretending that SQL ran.
The 10-second deadline starts when the engine accepts the SQL, not during asset download.
The coordinator applies a separate 30-second initialization deadline with an explicit Retry action.
Only one current run exists. Editing remains available and marks output stale.
A second Execute or Submit cannot bypass serialization through a keyboard shortcut.
Cancel first requests cooperation, then terminates after 1500 ms.
The coordinator settles its run outcome without waiting for the worker's unsettled library promise.

The default result cap is 100,000 rows or 32 MiB retained output.
A transient incoming batch can exceed the remaining capacity. The coordinator discards it and stops the run rather than retaining it.
Neither truncation nor cancellation can produce a partial pass.
Submission compares every required fixture and the learning dataset under their own fresh snapshots.
Expected rows for generated data come from the pinned reference before learner execution, never from learner-mutated tables.

## End-to-end acceptance

1. Open the app with an empty profile. Show real loading state and zero invented completions.
2. Open preview challenge 07 without awarding its unreleased prerequisites.
3. Run the valid starter SQL and display its monthly totals without a correctness claim.
4. Edit the query, receive current diagnostics, and retain responsive editing during a long query.
5. Submit the reference answer. Accept all nine boundary rows and the complete learning-data answer.
6. Submit the recorded adverse solutions. Reject their semantic differences without losing duplicate or exact-value information.
7. Reveal and reread all three hints. Record assistance without a correctness penalty.
8. Save SQL, reload, and restore the last committed revision, selection, hint level, and completion.
9. Exercise cancellation during computation and transfer. Retain SQL and saved progress after worker recovery.
10. Exceed memory and output limits. Show the correct non-pass outcome and permit a new run.
11. Bypass statement admission in an integration fault injection. A poisoned engine must not affect the next run's restored dataset.
12. Exercise every visible control in `product.md`, including empty, disabled, error, and restore states.
13. Complete an export/import round trip, a blocked migration, a quota failure, and a two-tab conflict without silent data loss.
14. Exercise keyboard navigation, screen-reader output, splitters, and every specified zoom level in the real application.
15. Inspect floating, docked, hidden, and hushed judge states. All moods must report the same verified facts.
16. Inspect the skill map, local Leaderboard, query library, schema reference, and Recycle Bin without decorative clickable elements.
17. Inspect worker, Wasm, extension, and Parquet headers from the built application on localhost.
18. Block external origins before a fresh browser session. Load the local application and run SQL without internet access.

The expected grid types and multiplicities, not a screenshot or row count, establish correctness.
Application verification uses real-browser Playwright workflows and direct engine and storage scenarios.
Visual comparison uses the specified palette, bevels, dimensions, and pane behavior with the documented accessibility adjustments.
Passing a build does not satisfy these acceptance criteria.

## Explicit non-claims

This milestone does not release the remaining 59 challenge bundles.
Their authored objectives remain inspectable as unreleased content, never fake runnable challenges or completion marks.
Challenge 07 records correctness, but its preview does not award skill mastery without supported concept evidence.
The milestone does not provide public rankings, accounts, cross-device synchronization, or secret test cases.
It does not promise Safari, mobile, minimum-device, offline-start, or experimental-thread support without new evidence.
It does not grant rights to distribute the supplied portrait.
