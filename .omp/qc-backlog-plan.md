# Handle the QC backlog

## Context

The QC fix pass closed ~50 findings. What remains is the backlog it deliberately
deferred: one content/pedagogy defect (twelve skills hard-locked behind SQL
basics with no signposted escape), four "missing feature" items, and five
aesthetics items. This plan handles all of them, and records the two it
disproves rather than implements.

Repository `/mnt/data/Code/sql-grind`, branch `main`. Prettier governs `src/`
and `scripts/`; `readiness/product.md` is **not** prettier-managed — edit its
content only, never reflow it.

## Verified corrections to the backlog

Read before implementing. Five backlog premises are wrong, stale, or
contractually blocked, and building on them would encode false statements.

1. **The progression model already has the seam.** `accessible = available ||
   opened.has(skill.id)` (`src/lib/progression.ts:107`). Availability is derived
   purely from *completions* (`:98-106`), never from access. So granting a
   learner access to a locked skill cannot corrupt progression: any completion
   they earn there is still an identity-matched accepted attempt
   (`challengeCompleted`, `:35-46`), and downstream skills unlock from those
   completions by the existing rule. **No new completion semantics are needed.**
   This is what makes an elegant fix possible.
2. **`openedSkillIds` is not that escape hatch, and must not be reused as one.**
   It is recorded only when the skill is *already available*
   (`src/App.svelte:1246`), and `readiness/product.md:384` states "Selecting a
   locked map node does not record an opening." Its contracted meaning is
   retention of review access when prerequisites regress (`:385`). Conflating
   the two destroys a distinction the contract draws deliberately. Use a
   separate set.
3. **Icon incoherence is contractually deliberate, not a defect.** All 23 PNGs
   come from one vendor set (Fugue Icons 3.5.6, CC BY 3.0), but from three
   archive sub-directories at three native sizes, so the 32 px desktop column
   holds three 32 px glyphs, two 24 px glyphs (DuckDB Docs, Recycle Bin) and a
   16 px trophy (Practice Records). `readiness/product.md:721-722` mandates
   exactly this: "Desktop slots remain 32 × 32. Smaller native glyphs remain
   centered, not stretched. This explicitly accepts a smaller trophy silhouette
   instead of distorting it or replacing it with a generic circle." `:725`
   forbids fractional scaling; `:704` records "No icon files were added to this
   repository"; `:730` forbids adding artwork beyond the manifest. **Upscaling
   or swapping icons is out of scope without new archive-inspection evidence.**
   What *is* a genuine, fixable incoherence is the skill-map legend — see
   Phase 4.
4. **Click-to-sort stays excluded, and the reason is contractual, not
   technical.** `ArrowResult` retains every RecordBatch in memory
   (`src/lib/engine-results.ts:328-376`, cap 100,000 rows / 32 MiB at `:22-23`),
   so a permutation-view sort is easy. But W11 (`readiness/product.md:171`)
   says headers "do not sort output or alter the grading order", and the
   row-number column means "absolute row positions". Phase 8 serves the
   underlying need without touching that guarantee.
5. **The Compare progress bar already exists and is dead.** `<progress max="9">`
   renders at `src/App.svelte:3369-3373`, driven by `comparisonStep`, which
   parses `status.match(/Comparison (\d+)\/9/)` (`:139-141`). **Nothing in the
   codebase ever emits that string.** The measurement loop is a statically known
   `for (let pair = 0; pair < 9; pair++)` (`src/lib/engine.ts:1014`) whose inner
   queries pass `visible=false` (`:1203-1204`), suppressing the one status
   channel that exists. This is a wiring bug, not a design problem.

## Approach

Phases 1–3 are the pedagogy fix and share `src/lib/progression.ts`,
`src/lib/storage.ts` and `src/App.svelte`; do them in order. Phases 4–11 are
independent of each other and of 1–3.

---

### Phase 1 — Practice ahead: make the gate advisory (content item 13)

**The defect.** `basics` is the sole root; all twelve other skills require it
transitively (`readiness/curriculum.json`, 13 skills / 65 challenges). A learner
who already knows SQL must complete five challenges to see anything else, and a
learner stuck on `basics.04` has nowhere to go. The only text they get is a
dead end: "Complete every required challenge in each prerequisite skill to
unlock these challenges." (`src/App.svelte:4491-4494`).

**The design.** Keep the recommended path as the default and the prominent
route. Add a deliberate, learner-initiated, clearly-labelled override that
grants *access* without ever claiming *readiness*. Because availability derives
from completions, this needs no new completion semantics: a learner who
practises ahead into `joins` and completes all five genuinely completes
`joins`, and `cte` then unlocks by the existing rule. Work is the only thing
that ever counts.

1. **State.** Add `exploredSkillIds: string[]` to `Session`
   (`src/lib/types.ts:180-182`), beside `openedSkillIds`. Thread it through
   `deriveProgression` as a fifth parameter.
2. **Progression.** In `src/lib/progression.ts`:
   - `const explored = new Set(exploredSkillIds);`
   - `const accessible = available || opened.has(skill.id) || explored.has(skill.id);`
   - Leave `review` (`:108-112`) **untouched** — it must keep keying off
     `opened` alone, or a practise-ahead skill would falsely report
     "Needs review", which means version-regressed or historical.
   - The `state` expression (`:113-125`) needs one term: add
     `explored.has(skill.id)` to the `in-progress` disjunct at `:119`. A skill
     you deliberately opened ahead reads "In progress", which is true, and the
     five contracted states (`readiness/product.md:380`) stay exactly five.
   - Add `ahead: boolean` to `SkillProgress` = `explored.has(id) && !available`.
     This drives the badge and disappears by itself the moment the real
     prerequisites complete.
3. **Storage.** Mirror the `openedSkillIds` machinery in `src/lib/storage.ts`:
   `markSkillExplored` beside `markSkillOpened` (`:1697-1704`), union-merge on
   import beside `:2087-2093`, and carry the field in the session capture paths
   (`:1580`, `:1670-1675`, `:2076`). In `validateSession` (`:964-966`) accept a
   **missing** field as `[]` and validate a present one as a string list. Do
   **not** bump `formatVersion`: a backup written by this build must still
   restore into the previous one, and vice versa. Verify that with a
   round-trip in `scripts/storage-smoke.mjs`.
4. **Entry points — this is the actual QC complaint (signposting).**
   - Replace the dead-end paragraph at `src/App.svelte:4491-4494` with a block
     that (a) names the specific unmet prerequisite skills, (b) offers the
     action, and (c) states its consequences honestly:

     > Locked by **Ledger joins** and **Aggregation**.
     > `[ Practice ahead anyway ]`
     > Practising ahead opens these five challenges now. It does not mark the
     > prerequisites complete. Anything you finish here counts for good.

   - Add `Practice Ahead` to the skill-node context menu for a locked node,
     and `Return to the Recommended Path` for a skill currently ahead
     (removes it from the set; the skill re-locks unless it has been completed
     in the meantime). The symmetry keeps the action non-destructive and
     reversible.
   - Change the dead-end announcement at `src/App.svelte:1274-1277` from
     "Complete the prerequisite skills before opening this challenge." to name
     the route: "…or choose Practice ahead on this skill to open it now."
5. **Do not change `Open next challenge` (W25).** It keeps following authored
   order on the recommended path. Practising ahead is a deliberate detour, not
   a new default — if it silently retargeted the primary verb, the curriculum
   would stop meaning anything.

### Phase 2 — "Leaving is free, and coming back is free" (the user's jump-back case)

Returning to a hard challenge already works — drafts persist per document,
hints persist in `hintLevels`, attempts are immutable — but nothing *tells* the
learner that, so leaving feels like forfeiting. Make the guarantee explicit and
verify it holds.

1. When a learner opens a different challenge while one has an unsubmitted
   draft, the status message states the guarantee once:
   "Your `basics.04` draft and revealed hints are kept. Reopen it any time."
2. Patchouli offers the detour on repeated failure rather than the learner
   having to discover it: after the third failed submission on one challenge
   within a session, add one remark branch pointing at a sibling challenge in
   the same skill and at Practice ahead. Bounded, session-scoped, and only on
   a genuine repeated-failure signal — no nagging.
3. Verify the guarantee end to end: draft text, caret, revealed hint level, and
   run evidence all survive leaving and returning. If any does not, that is a
   bug this phase fixes, not a message this phase writes.

### Phase 3 — Say which prerequisite blocks you (W23/W24 compliance)

`readiness/product.md:186` (W24) already requires "Locked rows explain unmet
prerequisites" and `:185` (W23) "The list identifies which requirements remain
incomplete." Today the map node says only `Locked · 0/5`
(`src/components/SkillMap.svelte:132-136`), and the Object Explorer's disabled
challenge buttons (`src/App.svelte:3674-3676`) carry **no reason text at all**,
which also breaches `readiness/product.md:40` ("Disabled commands expose their
reason through adjacent text or a described status message").

Name the blocking skills wherever a lock is shown: map node `aria-label`,
skill detail panel (Phase 1 step 4 does this one), and the explorer's disabled
rows via an adjacent described status. Derive the list from
`skill.requires.filter(id => !progression.skills[id]?.completed)`.

### Phase 4 — Skill-map legend coherence (aesthetics)

Three concrete, anchored defects, none of which touch the pinned icon set:

1. **Legend swatches do not match node fills.** Legend `.completed` is
   `#286b28` (`SkillMap.svelte:377-388`) while a completed node is `#d0e8d0`
   (`:440-455`); legend `.review` is `#c0bcb4`, which is exactly the *locked*
   node colour, not the amber `#fff0c0` review node. Drive both from one set of
   CSS custom properties so a legend swatch is definitionally the node fill.
2. **The legend shows a padlock no node ever renders.** `icons.lock`
   (`SkillMap.svelte:165`) is the only consumer of `lock.png` in the whole app.
   Render the same 16 px lock on locked nodes — this also fixes (3).
3. **Locked has no class of its own**, so it is indistinguishable from
   "no state loaded" (`:441-442` default fill). Give it an explicit `.locked`
   class.

### Phase 5 — One progress format (aesthetics)

The same quantity renders four ways, and a second quantity two more:

| Text | Location |
| --- | --- |
| `Available · 0/5` | `SkillMap.svelte:132-136` (node + `aria-label`) |
| `0 of 5 objectives completed.` | `SkillMap.svelte:199-204` (reading layout) |
| `0 / 5 completed` | `App.svelte:4457-4460` (Goal panel) |
| `0/5 Completed` | `App.svelte:3358-3360` (toolbar skill tag) |
| `13 skills · 0 completed` | `SkillMap.svelte:140-143` |
| `0 / 13 completed` | `App.svelte:3353-3356` |

Add one `formatProgress(done, total, noun)` helper in `src/lib/types.ts` beside
the existing `formatCount` (`:202-205`), and route all six through it. Pick
`3 of 5 challenges` for the long form and `3/5` for the badge form, pluralised
by `formatCount`. Keep the `role="progressbar"` encoding
(`SkillMap.svelte:303-307`) as-is; it is the only non-textual rendering and it
is correct.

Also fix a genuinely misleading string while here: the About dialog's
`13 skills · 65 complete exercises` (`App.svelte:5128-5132`) counts *authored*
exercises but reads like a progress figure. It becomes `65 authored exercises`.

### Phase 6 — Compare progress (aesthetics)

Pure wiring. In `src/lib/engine.ts`, the pair loop at `:1014` emits
`onState("working", \`Comparison ${pair + 1}/9\`)` at the top of each iteration,
which is exactly the string `comparisonStep` already parses
(`src/App.svelte:139-141`) and the existing `<progress max="9">` already
renders. Nine iterations are known before the loop starts, so a determinate bar
is honest.

**No ETA in seconds.** Per-pair time varies with the variant being restored and
the learner's SQL; a countdown that drifts is worse than none. The bar plus
"Comparison 4 of 9" is determinate and true. Keep the `.comparison-progress`
selector and the `Cancel comparison` accessible name — `scripts/qc-smoke.mjs:312-333`
pins both.

### Phase 7 — Reading layout line length (aesthetics)

`.reading.desktop { min-width: 0; width: 100% }` (`src/app.css:1754-1757`) with
`.reading .work-area { display: flex; flex-direction: column }` (`:1781-1785`)
leaves prose unconstrained: at 2560 px the Goal and Patchouli text runs about
2540 px wide, roughly 390 characters per line. No `max-width` rule applies to
any prose container — the only `max-width`s in the file are icon, dialog and
tab clamps.

Add a `max-width: 72ch` (with `margin-inline: auto`) to the prose containers
under `.reading` only — `.goal-content`, `.judge-speech`, and the skill-map
linear list. Leave the SQL editor, the result grid and the expected-shape block
unconstrained: those are tabular or code and are already governed by
`readiness/product.md:286` (justified scroll regions).

### Phase 8 — Sort and filter, without breaking W11 (missing item)

**Reframe.** The learner's real need is "show me this differently". In a SQL
trainer, the right answer is to teach the SQL, not to bolt a spreadsheet onto
the grid — and it happens to be the only answer W11 permits.

1. **`Add ORDER BY` / `Add WHERE` from the header menu.** A new header context
   menu (there is none today; the `columnheader` at
   `ResultGrid.svelte:551-575` carries only the resize grip) offers
   "Sort by this column in SQL" and "Filter by this value in SQL". Both *edit
   the query text* through the existing `changeDocument` path
   (`src/App.svelte:1019-1039`) — the same path `Reset Challenge SQL` uses
   (`:2637-2650`), which means undo works for free via CodeMirror's history.
   They do **not** auto-execute: the learner reads the change, then runs it.
   The grid itself never reorders anything, so W11 holds verbatim.
   Clause placement uses the repo's own tokenizer
   (`src/lib/engine-diagnostics.ts:46`) to detect a depth-0 `ORDER BY`; when
   one exists, select it instead of appending a second.
2. **`Find in results`** — a non-destructive search over the resident Arrow
   batches that scrolls to and highlights matches without hiding rows. W11
   constrains sorting and reordering; it says nothing about highlighting, and
   because nothing is hidden, W07's "complete-result count" and the row-number
   column's "absolute row positions" both stay true.

Row-hiding filters are **rejected**: they would force either a lying row-number
column or a second count, and they invite misreading a filtered view as a
result during grading review.

### Phase 9 — Format SQL (missing item)

No formatter exists in the repo (`package.json` has no `sql-formatter`, no
`prettier-plugin-sql`), and `@codemirror/lang-sql` exposes no formatting
service — its Lezer grammar carries no `indentNodeProp`, so the generic
`indentService` has nothing SQL-aware to consult. Two in-repo options exist and
both are traps:

- The repo's own `tokens()` lexer **discards comments and whitespace**
  (`engine-diagnostics.ts:52, 59, 72`), so a formatter built on it would
  silently delete the learner's comments.
- `json_serialize_sql` round-tripping is already documented as unsafe for this
  purpose at `engine-diagnostics.ts:44-45`: DuckDB executes read statements
  (notably `PIVOT`) that its serializer cannot emit — and `pivot.01`–`pivot.05`
  are an entire authored skill.

**Decision: add `sql-formatter` as a runtime dependency**, configured for the
`duckdb` dialect, honouring the existing `indentation` setting
(`src/lib/types.ts:152`). Hand-rolling a SQL pretty-printer that survives CTEs,
window frames and `PIVOT` is a sinkhole, and getting it subtly wrong corrupts
learner work. Provenance is tracked formally in this repo, so the dependency
gets an entry in the Asset Credits modal and in `readiness/product.md`.

Acceptance is machine-checked, not eyeballed: a script formats all 65 authored
`reference.sql` files plus every starter, and asserts (a) formatting is
idempotent, and (b) the formatted SQL returns byte-identical results to the
original on a real variant. A formatter that changes results is a defect, and
this catches it.

Wire it as `Format SQL` in the Edit menu with `Ctrl+Shift+F`, dispatched
through `changeDocument`. `readiness/product.md:99` (M02) enumerates the Edit
menu exhaustively and **must** be edited.

### Phase 10 — Scratch query history (missing item)

Challenge attempts are durable; scratch runs vanish. Add a bounded run history:
the last 200 executed statements per profile, each with its text, timestamp,
row count, duration and dataset, written on execute, deduplicated by text,
surfaced in a `History` section of My Queries with "Open as new query" and
"Delete". It joins the backup export/import payload alongside documents and
attempts.

It is explicitly **not** attempt evidence: it awards no completion and never
feeds progression. Say so in the UI and in the contract, or it will be mistaken
for practice records.

### Phase 11 — Shortcut consistency (missing item)

The sharpest finding of the three research passes, and the cheapest to fix.

1. **Seven of ten hints advertise accelerators the app does not own.** `Undo`,
   `Redo`, `Cut`, `Copy`, `Paste`, `Select All` and `Find`
   (`src/App.svelte:146-152`) appear in every Edit menu popup, but `globalKey`
   binds none of them — they work only while CodeMirror has focus. Click the
   result grid, press Ctrl+Z, get nothing. **Do not invent global bindings**
   (Undo/Cut/Paste outside a text field are meaningless, and
   `readiness/product.md:112` ties Paste to the native path). Instead, qualify
   the hint: these items are disabled with a reason when the editor does not
   have focus, which is both truthful and Win2k-correct.
2. **Go to Line has two implementations** — a real breach of
   `readiness/product.md:38` ("Every command has one implementation"). The menu
   item runs a `promptText` dialog (`src/App.svelte:2831-2845`); `Ctrl+Alt+G`
   runs CodeMirror's own panel via `searchKeymap`. Route the menu item to the
   already-existing, currently-unreachable `editor.command("gotoLine")`
   (`SqlEditor.svelte:437-439`) and delete the dialog path, ~15 lines.
3. **Three conventions for one key.** Menus say `Ctrl+S`
   (`App.svelte:143-152`, never platform-aware), the modal says
   `Ctrl+S / Command+S` (`:5053-5058`), and ARIA says `Meta+Enter`
   (`:3307`). Make `shortcutHints` platform-aware with one formatter over a
   Ctrl-canonical table; the modal and ARIA forms stay as they are.
4. **The modal omits everything Edit-shaped** plus the Alt mnemonics that
   `readiness/product.md:107` now mandates and that
   `scripts/controls-smoke.mjs:789-803` already tests. Add the Edit group,
   find-next (`F3`), the Alt mnemonics, and the resize-grip keys.
   `readiness/product.md:239` already establishes the modal as the
   documentation surface.

### Phase 12 — Editor/results split (aesthetics)

`editorHeight` defaults to a flat `290` px (`src/App.svelte:176, 902, 2673`)
regardless of viewport height, so the editor is cramped on a tall screen and
dominant on a short one. Make the *first-run* default proportional — about 38 %
of the work area, clamped to the existing 120–650 px range — while keeping the
stored pixel value authoritative the moment a learner drags the splitter. One
`?? ` fallback becomes a function; the splitter, its keyboard handling and
`Reset Layout` are otherwise untouched.

---

## Contract updates (`readiness/product.md`)

Content edits only; never run prettier on this file.

- **New progression rules** beside `:377-386`: practising ahead grants access
  without availability; it never marks a prerequisite complete; completions
  earned ahead are ordinary current completions and do unlock downstream
  skills; the set is reversible; `Open next challenge` keeps following the
  recommended path.
- `:380` — confirm the five states still enumerate exactly; add the `ahead`
  badge as a modifier, not a sixth state.
- `:185-186` (W23/W24) — locked surfaces name the specific unmet skills.
- `:40` — explorer disabled rows gain their adjacent reason.
- `:99` (M02) — Edit menu gains `Format SQL`.
- `:107` — the Keyboard Shortcuts modal documents the Alt mnemonics.
- W07/W11/W12 (`:167-172`) — record the header menu's SQL-editing actions and
  `Find in results`, and restate that the grid still never sorts or hides.
- W17a (`:178`) — the comparison reports determinate progress over nine pairs
  and no time estimate.
- Reading layout (`:285-290`) — prose is line-length limited; tabular and code
  regions keep their scroll behaviour.
- New rows for scratch history (bounded, non-evidential) and the
  `sql-formatter` dependency provenance.

## Verification

Start one supervised dev server (`npm run dev -- --port 5176 --strictPort`) and
point `APP_URL` at it. Every check below is an observable input → output.

1. **Practice ahead** — on a fresh profile, open `joins` (locked), assert the
   detail panel names `SQL basics` as the blocker; click Practice ahead; assert
   the five `joins` challenges become selectable and the node reads
   `In progress` with the ahead badge. Complete one; assert the attempt is
   recorded as a normal current completion. Reload; assert the state survives.
   Then "Return to the recommended path"; assert `joins` re-locks but the
   completion is retained.
2. **Practice ahead does not forge prerequisites** — after practising ahead into
   `joins` without completing it, assert `cte` is still locked. This is the
   assertion that proves the escape hatch is not a cheat code.
3. **Downstream unlock by real work** — complete all five `joins` challenges
   while ahead; assert `joins` reads `Completed` and that `cte`'s requirement
   list shows `joins` satisfied.
4. **Jump back** — type a draft into `basics.04`, reveal two hints, leave,
   work elsewhere, return: assert text, caret, hint level and run evidence are
   all intact.
5. **Blocked-by naming** — assert a locked node's `aria-label` names the
   specific unmet skills, and that an explorer disabled row exposes a reason.
6. **Counters** — assert all six locations render the unified format.
7. **Legend** — assert each legend swatch's computed background equals the
   corresponding node fill, and that a locked node renders the lock image.
   Screenshot and **look at it**.
8. **Compare progress** — start a comparison; assert `<progress>` reaches
   `value="1"` within the first pair and advances monotonically to 9; assert
   `scripts/qc-smoke.mjs`'s cancel path still passes unchanged.
9. **Reading layout** — at a 2560 px viewport in reading layout, assert the
   Goal prose element's measured width is ≤ 72ch, and that the result grid is
   *not* clamped.
10. **Header menu** — right-click `created_at`, choose "Sort by this column in
    SQL"; assert the editor text gained a depth-0 `ORDER BY created_at`, that
    the grid did **not** reorder, and that Ctrl+Z reverts the edit. Repeat with
    an existing `ORDER BY` and assert it is selected, not duplicated.
11. **Format SQL** — run the 65-file idempotence and result-equality script;
    assert both properties hold. Then format a query containing a comment and
    assert the comment survives.
12. **History** — execute three scratch statements, assert all three appear,
    reopen one, assert it opens as a new document with no completion credit;
    export and re-import a backup and assert history survives.
13. **Shortcuts** — assert Edit items are disabled with a reason when the grid
    has focus; assert the menu item and `Ctrl+Alt+G` open the *same* Go to Line
    UI; assert the modal lists the Edit group and the Alt mnemonics.
14. **Split** — at 1440 px and at 800 px viewport heights, assert the first-run
    editor height differs and both lie within 120–650; assert a dragged value
    persists verbatim across reload.

Then the full regression sweep (all suites, including the three whose names do
not end in `-smoke`), `npm run check`, `npm run build`, `subpath-smoke`, and
`deployment-smoke` against `npm run serve`.

## Assumptions & contingencies

- **Phase 1 storage compatibility.** If `validateSession`'s `object()` helper
  rejects unknown or missing keys in a way that breaks old backups, the field
  becomes optional at the validator level rather than bumping `formatVersion` —
  a format bump would strand backups written by the deployed build, which is a
  worse outcome than a tolerant reader.
- **Phase 9 dependency.** If `sql-formatter`'s `duckdb` dialect fails the
  result-equality check on any authored challenge, the feature is cut rather
  than shipped with a corrupting formatter. A formatter that silently changes
  results is worse than no formatter.
- **Phase 2 heuristic.** The repeated-failure remark is session-scoped and
  bounded. If it proves noisy in verification, it degrades to a static line in
  the hints dialog rather than growing more conditions.
- **Phases excluded by evidence.** Icon-set replacement (contractually fixed,
  correction 3) and click-to-sort / row-hiding filters (W11, correction 4).
  Both are recorded here with their reasons so they are not re-raised as
  oversights.
