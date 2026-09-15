# Product readiness contract

Status: current progression and persistence contract. Accessibility criteria remain acceptance requirements, not a claim of audited conformance.

This document covers GOAL outcomes 9 and 10, plus persistence and accessibility requirements from outcome 8.
Hosting, browser support, device limits, and engine experiments belong to the integration report.
The application baseline remains Svelte 5, TypeScript, and Vite.

## Evidence and decision boundaries

The primary design sources are:

- Design specification, lines 14–89 and 111–113, in the original handoff bundle
  kept outside this repository.
- Prototype, lines 12–79, 103–175, 176–296, and 306–418, in the same bundle.
- [Goal](../GOAL.md), outcomes 8–10 and the implementation sequence.
- [Challenge semantics](semantics.md), which governs deterministic grading and the preserved Challenge 07 result.
- [Authored curriculum](curriculum.json), which defines skills, prerequisites, required challenge order, and definition paths.

The prototype uses spans and divs for many apparent controls.
Its absent handlers do not authorize inert application controls.
The inventory below defines their application behavior.
Static information has no button role, pointer cursor, or misleading hover effect.

Design changes are explicit:

1. Execute runs SQL. It never switches to the skill map.
2. Local practice records replace public ranking. The surface is named Practice Records everywhere — desktop icon, Skills menu and dialog title. The icon remains the trophy from the pinned icon set, whose provenance is recorded; the dialog states that these records are not a verified public ranking.
3. Real counts and measured metrics replace sample scores, row counts, thread counts, and completion marks.
4. Accessible hit areas can exceed the small visible bevels. A separate reading layout supports high zoom.
5. Native icon sizes replace fractional scaling. The icon section records the small geometry changes.
6. Challenge 07 uses the five-column result contract in `semantics.md`, including `category_id`.
7. The complete progression replaces the former Challenge 07 preview milestone.
8. Correct outcomes earn **Completed**, not proof of technique mastery. No SQL keyword or diagnostic determines completion.

## Shared interaction rules

Every command has one implementation, whether invoked from a menu, toolbar, desktop icon, or keyboard shortcut.
The Keyboard Shortcuts dialog is generated from the same table that supplies the menu accelerators, so a documented key and its menu hint cannot disagree. Keys with no menu command are listed separately.
Buttons support Enter and Space. Links support Enter and retain browser link behavior.
Disabled commands expose their reason through adjacent text or a described status message.
Unavailable metrics show “Unavailable” and their reason, not zero or a fabricated score.

Run, Parse, Submit, and Show Plan capture the current SQL revision.
Each run captures its document, dataset ID, run identifier, and complete content identity.
That identity contains `challengeId`, `bundleVersion`, `challengeVersion`, `datasetVersion`, `assessmentVersion`, and `engineVersion`.
A subsequent edit marks old output as stale. It does not change the recorded run.
Switching documents never attaches a result or attempt to the newly selected document.
Only a complete, correct Submit result for the captured revision can create a completion record.

A change of document, pane, window state, or judge visibility does not delete SQL or restart the engine.
The editor keeps selection, undo history, and scroll position per open document.
Explicit reset operations describe their affected data before the learner accepts them.

## Visible interaction inventory

### Desktop, taskbar, and windows

Evidence: specification lines 14–26 and 71–76. Prototype lines 12–35 and 248–296.

| ID  | Visible control                           | Required behavior                                                                                                                                      |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D01 | My Queries, yellow folder                 | Opens the local query library. It supports name search, challenge filters, recent order, Open, Rename, Duplicate, Delete, and SQL export.              |
| D02 | DuckDB Docs, globe                        | Opens `https://duckdb.org/docs/` in a new tab. Its accessible name includes “opens in a new tab”. It uses `noopener noreferrer`.                       |
| D03 | Schema Reference, document                | Opens `schema.ref`, a read-only reference for the selected dataset version. It shows types, keys, relationships, definitions, and actual counts. |
| D04 | Skill Map                                 | Opens or activates `Skill Map.dag`. It retains the last selected skill and canvas position.                                                            |
| D04a | Katas, play icon | Opens “Katas — repetition drills”. It lists every authored drill pattern with its due count, retained count, and the reason the shape is worth practicing. Drills are graded at run time against an authored reference and never award or revoke challenge completion. |
| D05 | Practice Records, gold trophy             | Opens “Practice Records — this device”. It shows local practice records and the trust notice defined below.                                                 |
| D06 | Recycle Bin                               | Opens deleted queries with deletion dates. Restore preserves identity and SQL. Delete permanently and Empty Bin require explicit acceptance.           |
| D07 | Start                                     | Opens a menu with SQL Grind, all seven desktop destinations, Settings, and About. SQL Grind restores the IDE. No fake operating-system shutdown exists.  |
| D08 | First quick-launch button, blue rectangle | “Show desktop” hides application windows without closing documents. A second activation restores their previous visibility.                            |
| D09 | Second quick-launch button, blue globe    | Opens DuckDB Docs with D02 behavior. Its tooltip and accessible name identify the destination.                                                         |
| D10 | SQL Grind taskbar button                  | Restores or activates the IDE. If it is already active, the button minimizes it. It shows the active document and unsaved status.                      |
| D11 | Patchouli taskbar button                  | Restores Patchouli in its saved dock state. If Patchouli is visible, it receives focus. It does not silently hush Patchouli.                           |
| D12 | Workbench minimize `_`                    | Named “Minimize Workbench”. Hides the workbench window. Focus moves to D10. The query engine continues, and the taskbar shows its run state.                                                    |
| D13 | Workbench maximize/restore `□`            | Named “Maximize or restore Workbench”. Toggles between the specified desktop bounds and all available desktop space above the taskbar. Browser fullscreen is not involved.                    |
| D14 | Workbench close `×`                       | Named “Close Workbench”. Closes the workbench window, not the browser tab. Pending writes finish first. A failed save offers Export, Keep open, or Discard unsaved changes.           |
| D15 | IDE title and application glyph           | Identify the window. They are not draggable controls. A Window menu supplies all window actions.                                                       |
| D16 | Patchouli floating title                  | Identifies a modeless window. Pointer dragging moves it within desktop bounds. Window → Move Patchouli supplies a keyboard equivalent.                     |
| D17 | Patchouli dock `⇲`                        | Moves Patchouli into the Goal / Skill Details panel, wherever that panel is. A hidden panel reopens. Focus moves to the docked heading.          |
| D18 | Patchouli float `⇱`                       | Restores the last floating position. An invalid position resets above the taskbar. Focus moves to the floating heading.                                |
| D19 | Patchouli close `×`, either location      | Hides Patchouli without disabling diagnostics, grading, or Hush state. Focus returns to the invoking control, or toolbar Patchouli.                                  |
| D20 | Engine tray square                        | Static status with text equivalent: loading, ready, busy, recovering, or error. Green means ready, not proof of a successful query.                    |
| D21 | Patchouli tray dot                        | Static status with text equivalent: visible, hidden, or hushed. Its purple color never carries the state alone.                                        |
| D22 | Tray clock                                | Shows the device time and exposes the full local date and timezone. It is not a fake calendar button.                                                  |

The IDE close action retains the session after successful persistence.
Start → SQL Grind and the taskbar restore the session without fabricated startup progress.
The close action does not call `window.close()`.
The title text and taskbar labels never truncate their accessible names.

### Menus

Evidence: specification line 23 and prototype lines 36–38 and 306.
These are complete menu contents for the planned desktop release, not speculative empty menus.
Repeated names invoke the corresponding inventory action.

| ID  | Menu   | Items and meaning                                                                                                                                                               |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | File   | New Query, Open, Save, Save As, Export SQL, Export Practice Backup, Import Practice Backup, Close Document, Close Window.                                                       |
| M02 | Edit   | Undo, Redo, Cut, Copy, Paste, Select All, Find, Replace, Go to Line, Format SQL. They act on the focused editable document or selection. Format SQL reflows the active document as one undoable edit; unparseable SQL is refused with its parser message and left untouched.                                    |
| M03 | View   | Object Explorer, Patchouli, Goal / Skill Details, then Results, Messages, Execution Plan, Patchouli’s Notes, then Reading Layout, Reset Layout. Separators divide those three groups, and visibility items expose checked state. |
| M04 | Query  | Execute, Parse, Cancel, Show Plan, Compare with Reference, Submit, Hint, Query History, Reset Challenge SQL. Hint reveals the next hint, or reopens revealed hints once the challenge is complete. Reset restores authored starter SQL after explicit acceptance. |
| M05 | Skills | Skill Map, Current Skill, Open Next Challenge, Katas, Practice Records. Current Skill selects the skill associated with the active challenge.                                          |
| M06 | Tools  | Settings, Storage, Schema Reference, Refresh Schema, Reset Index Lab Session. The index lab reset never deletes saved queries or progress.                                      |
| M07 | Window | Minimize Workbench, Maximize / Restore Workbench, Close Workbench, Show Desktop, Dock / Float Patchouli, Move Patchouli, Reset Patchouli Position and Size, Dock / Float Goal, Move Goal, Close All Documents, then every open tab. The maximize item shows the action it performs, Maximize Workbench or Restore Workbench. Open documents and the `Skill Map.dag`, `schema.ref` and `schema.dgm` tabs are listed after a separator, numbered from 1 for the first nine, and the active one is marked with `role="menuitemradio"` and `aria-checked`. |
| M08 | Help   | Keyboard Shortcuts, Challenge Rules, DuckDB Docs, Asset Credits, About. About shows real application and engine versions.                                                       |

Every menubar menu groups its items with `role="separator"` dividers, and each menu title exposes an Alt mnemonic on its first letter, which is unique across the eight menus. Item-level access letters are not assigned; first-letter typeahead inside an open popup remains the in-menu affordance.
Save As creates a new saved query and preserves the original.
Close Document retains a persisted draft and offers recovery through My Queries.
If a draft is unsaved, Close Document uses the same failed-save choices as D14.
Read-only documents disable mutating Edit items.
Paste uses browser permission and the native editor action. A denied clipboard request shows the standard keyboard alternative.

Settings includes theme, Hush, editor font size, editor indentation, word wrap, reading layout, and diagnostic announcement preference.
Patchouli has one voice. Her phrasing never changes the supported facts or rule identifiers.
Storage shows usage estimates, persistence permission, backup actions, and separate controls for cache and practice data.
The index lab uses a disposable sandbox, separate from immutable learning data.
A sandbox reset terminates its session and invalidates pending sandbox results.

### Toolbar and object explorer

Evidence: specification lines 24 and 28–38. Prototype lines 40–70 and 309–327.

| ID  | Visible control                         | Required behavior                                                                                                                                        |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | New Query                               | Creates a blank scratch document with a unique internal identifier. It never overwrites the active challenge.                                            |
| T02 | Open                                    | Opens a dialog with My Queries and Import SQL choices. UTF-8 SQL imports become unsaved documents and never run automatically.                           |
| T03 | Save                                    | Saves the current revision to My Queries. A new query requests a name. “Saved” appears only after transaction completion.                                |
| T04 | Execute, F5                             | Runs the active SQL document through the approved execution policy. Selection is not an implicit alternative query. A scratch run never awards progress. |
| T05 | Parse                                   | Requests syntax diagnostics without query execution. It replaces only diagnostics for the captured revision. It never reports correctness.               |
| T06 | Cancel                                  | Cancels the active run through the recovery contract. It is disabled without a cancellable run. Repeated clicks do not start repeated recovery.          |
| T07 | Dataset selector and arrow              | Shows the selected document's dataset. The index lab identifies its separate disposable sandbox. No external connection dialog exists.                   |
| T08 | Show Plan                               | Requests a non-executing plan for the active SQL and opens Execution Plan. A measured profile is a separate, explicitly labeled execution.               |
| T09 | Patchouli                               | Toggles Patchouli's visibility in its previous dock state. Its pressed state reports visibility, not whether grading is active.                                |
| T10 | Skill tag                               | Shows the active skill and its actual completed count. The map shows completed skills, not technique mastery.                                            |
| T11 | Grippers and toolbar separators         | Decorative only. They have no drag cursor, focus stop, or action.                                                                                        |
| O01 | Object Explorer header arrow            | Opens Show all / Collapse all / Refresh / Hide panel actions. It is not an unimplemented arrow.                                                          |
| O02 | Object Explorer header `×`              | Hides the panel. View → Object Explorer restores it. Focus returns to the document tab.                                                                  |
| O03 | Mini-toolbar refresh `⟲`                | Reloads metadata for the current dataset and sandbox revision. It does not regenerate challenge data.                                                    |
| O04 | Mini-toolbar document `▤`               | Opens schema details for the selected object. Without a selection, it opens the database overview.                                                       |
| O05 | Mini-toolbar filter `▽`                 | Opens a named object filter field with Clear. Filtering preserves ancestors and announces the matching count.                                            |
| O06 | Database and Tables expanders           | Expand or collapse their children. Selection does not expand a branch implicitly.                                                                        |
| O07 | Dataset table nodes                     | Select the table and expand it. Enter or double-click opens its schema section. Tables and counts come from the selected dataset. An expanded table exposes Columns, Keys and Indexes children built from the loaded schema, and each child leaf opens the same schema section. |
| O08 | Views / Macros / Indexes / ART branches | Show actual registered objects. An empty branch, including an expanded table's empty Columns, Keys or Indexes group, shows “No objects”. A leaf opens its definition and ownership.                                                        |
| O09 | Challenges branch                       | Expands the authored challenge list. Each entry shows its real state and stable challenge identity.                                                      |
| O10 | Prototype `01–06 complete` group        | Becomes an expandable list of real challenge records. It never implies six passes on a new installation.                                                 |
| O11 | Authored challenge entries              | Open the selected available challenge. Display aliases 07, 08, and 09 never redirect to another objective.                                               |

During a run, Execute and Submit are disabled. The learner can still edit, save, inspect schema, and cancel.
A parse request can continue only under the parser concurrency contract.
The tree uses the selected dataset's declared tables. It does not assume eight commerce tables for every challenge.
Unsupported metadata queries show an error and retain the last known metadata with a stale label.

### Documents, results, goal, and skill map

Evidence: specification lines 40–69. Prototype lines 73–165 and 176–244.

| ID   | Visible control or information                              | Required behavior                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01  | SQL document tab                                            | Activates that document and its definition-based Goal sidebar. It retains that document's own SQL, results, and hints. Run evidence is keyed by document, so another document's result, run identity or fixture list never renders under it. |
| W02  | `Skill Map.dag` tab                                         | Activates the skill map and Skill Details sidebar. Query execution continues independently.                                                                                                                    |
| W03  | `schema.ref` tab                                            | Activates the read-only schema reference. Internal table links select the corresponding reference heading.                                                                                                     |
| W03a | `schema.dgm` tab                                            | Activates the relationship diagram. Nodes are the dataset's tables; edges are typed foreign keys drawn from a table to the table it references, with a `self` badge where a table references itself. Right-click ▸ View Diagram on a table in the explorer or the reference opens it. Reading layout replaces the canvas with a linear list of the same references. |
| W04  | SQL editor                                                  | Supports text editing, selection, completion, search, and undo through CodeMirror. A named editor exposes its language and challenge.                                                                          |
| W05  | Line gutter and diagnostic highlights                       | Line numbers are informational. A diagnostic marks its own line in the gutter and underlines its source range, and a syntax rejection underlines the whole token the parser stopped on rather than its first character. A diagnostic list entry selects its current source range and focuses the editor. Stale entries cannot select unrelated text.                                                   |
| W06  | Editor/results splitter                                     | Resizes the panes without hiding either pane. It supports keyboard adjustment and the limits below.                                                                                                            |
| W07  | Results tab                                                 | Shows the complete-result count and a bounded visible window. It distinguishes no run, zero rows, loading, cancelled, incomplete, stale, and successful results.                                               |
| W08  | Messages tab                                                | Shows syntax, execution, cancellation, recovery, and grading messages for the selected run. Messages contain plain text, not imported HTML.                                                                    |
| W09  | Execution plan tab                                          | Shows the available plan with query revision and collection method. It never invents a plan before collection.                                                                                                 |
| W10  | `Patchouli's notes` tab and count                           | Shows current deterministic diagnostics, severity, evidence, and source ranges. The count excludes discarded stale diagnostics.                                                                                |
| W11  | Grid headers and row numbers                                | Identify columns, types, and absolute row positions. They do not sort output or alter the grading order. Each header exposes a resize grip: pointer drag, Left/Right arrow adjustment, and double-click reset to the type-derived default width. |
| W12  | Grid cells and selected row                                 | Support keyboard cell navigation and exact-value copy. Arrow keys move cells. Home/End move across a row. Copy preserves decimal and integer text. The cell menu also copies the whole result with headers, and Export CSV writes `result.csv` as RFC 4180 text. Both reuse the cell rendering, so a NULL leaves as the text `NULL` and an empty string leaves empty. The cell menu additionally derives a sorted or filtered query: it wraps the SQL that produced the displayed rows in a new document and never reorders or hides the rows on screen. |
| W13  | Goal / Skill Details header arrow                           | Opens Collapse content / Expand content / Pop out / Hide panel actions. Collapse retains its header and restore action.                                                                                        |
| W14  | Goal / Skill Details header `⇲` and `×`                     | `⇲` pops the panel out as a floating window; `×` hides the panel. View restores it. Docked Patchouli hides with the panel but remains available through View → Patchouli.                                                   |
| W15  | Challenge chips, expected shape, scorecard, reference boxes | Informational only. Correctness shows pass/fail or no submission. Performance shows measured values or unavailable reasons.                                                                                    |
| W16  | Hint and remaining count                                    | Reveals the next authored hint. Three levels exist per challenge. Revealed hints remain readable without another attempt or penalty. A completed challenge reads Review hints and reopens the revealed hints without consuming a level.  |
| W17  | Submit                                                      | Runs full grading for the current revision and approved challenge data. It records success, mismatch, error, timeout, cancellation, or incomplete status.                                                      |
| W17a | Busy indicator on Execute, Submit and Compare               | Marks the running action and names it: Submitting…, Comparing…. Reduced motion keeps the marker and the text, without rotation. Compare reports determinate progress over its nine measured pairs and states no time estimate, because per-pair duration varies.  |
| W17b | Completion celebration (SQL basics only)                    | A first correct submission shows decorative confetti and a modal. The modal opens the next challenge or dismisses without leaving the current one. The Goal panel then offers Next challenge alongside Submit. |
| W18  | Map legend                                                  | Explains Completed, In progress, Available, Locked, and Needs review through text and symbols. Each legend swatch renders the same fill as the node state it names, and Locked carries the padlock that locked nodes themselves display.                        |
| W19  | Map Zoom percentage                                         | Opens map scale choices 75%, 100%, 125%, 150%, and Fit. The map opens at Fit so every node is reachable without scrolling; an explicit choice persists for the session. Browser zoom remains independent and is never intercepted. |
| W20  | Map skill and completion counts                             | Show thirteen skills and the derived completed count. A fresh profile has zero completions. Every surface states a completion ratio in one shared format.                                                                                                       |
| W21  | Thirteen skill nodes                                        | Select the skill and show its prerequisites and five required challenges. Locked nodes remain inspectable, name the skills that block them, and offer Practice ahead through their context menu.                                                                |
| W22  | Map edges and progress bars                                 | Edges are decorative SVG. Requirements also exist as text links. Progress bars expose completed count and total.                                                                                                                 |
| W23  | Requires links                                              | Select each prerequisite skill. The list identifies which requirements remain incomplete.                                                                                                                      |
| W24  | Skill challenge rows                                        | Open any challenge in an accessible skill with its own current-version draft. Locked rows name the specific unmet prerequisite skills and offer Practice ahead.                                                                                                 |
| W25  | Open next challenge                                         | Opens the first challenge without current completion, in authored order. Previously opened skills retain review access.                                                                                        |
| W26  | Status bar cells                                            | Show real engine/version/thread state, elapsed interval, result count, and caret location. They are information, not inert buttons. Its square reports the displayed message's outcome — neutral, working, success, or error — not merely engine readiness.       |

The correctness area does not convert partial row matches into a percentage pass.
Style and diagnostic counts remain separate from correctness.
The reference area consistently uses “Compare with Reference”. It makes no claim of optimality.
Line counts can describe SQL length, but they never imply quality or performance.
The section that explains the comparison also carries the control that starts it, in addition to Patchouli's dock and the Query menu.

Grading restores an isolated snapshot per variant, and reuses a pool of warm SQL workers to do it. Isolation rests on DuckDB's `open()`, which discards the previous database instance entirely: base tables, temporary tables, macros, the configuration lock and the session time zone all return to their defaults, and every setting is reapplied. A worker is returned to the pool only after a clean finish; a cancelled run or a failed worker is destroyed, because a cancelled query may still be executing. Instantiating a worker costs roughly 600 ms against 13 ms to reopen one, so the pool is what makes a graded submission take about two seconds rather than ten.
A profile comparison names its dataset, engine configuration, repeated-run method, and variability.
Exact submission scorecards show named outcomes for every grading variant.
Lab scorecards show measured evidence and report answers. Reconciliation scorecards show the applicable decision or outcome assessment.
The result grid displays SQL type names. Grading retains exact internal type and multiplicity checks.
Hint and Submit remain in a fixed panel footer, outside the scrolling challenge content.
The initial floating judge position leaves that footer unobstructed. Saved user positions remain unchanged.

### Judge actions

Evidence: specification lines 56 and 71–87. Prototype lines 166–174 and 267–294.

| ID  | Visible control                       | Required behavior                                                                                                                                                     |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J01 | `Patchouli's notes ›` link            | Opens W10 and focuses the first diagnostic heading. An empty list says that no supported diagnostics exist.                                                           |
| J02 | Show diagnostics                      | Opens current notes and their source ranges. It never requests an LLM or claims unsupported evidence.                                                                 |
| J03 | Compare with Reference                | Requires correct current SQL. The action discloses repeated measurements and separate profiles. Capstones use outcome assessment instead of generic speed comparison. |
| J04 | Hush                                  | Stops unsolicited remarks and live speech announcements. Diagnostics, highlights, and grading remain active. The button becomes Resume commentary.                    |
| J05 | Watched-line text                     | Shows the actual current source ranges. It is static information.                                                                                                     |
| J06 | Warning/style totals and line summary | Summarize current diagnostics. Full text remains in Notes. Their colors have text equivalents.                                                                        |
| J07 | Portrait and speech                   | Identify the character and present authored remarks. They do not open hidden menus. The complete remark remains readable despite the docked two-line preview.         |

Hush persists until Resume commentary or a Settings change.
Closing the judge does not change Hush. Reopening a hushed judge does not resume unsolicited speech.
Errors and explicit Submit results remain available to assistive technology.
The application has no automatic audio or speech synthesis.

## Keyboard, focus, and accessibility acceptance

These criteria target WCAG 2.2 AA behavior. They do not assert conformance before an application audit.
References: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [ARIA patterns](https://www.w3.org/WAI/ARIA/apg/patterns/).

### Keyboard and focus

- Tab follows visible logical order. Hidden panes and minimized windows contribute no focus stops.
- A visible skip link reaches the editor. Another reaches the active output or skill details.
- F6 and Shift+F6 move between major regions, without replacing ordinary Tab access.
- Menu bars use Left/Right, Home/End, and Enter or Down to open a menu.
- Open menus use Up/Down, Home/End, type-ahead, and Escape. Escape returns focus to the invoking menu button.
- Tabs use roving focus, Left/Right, Home/End, and Enter or Space for activation.
- Tree navigation uses Up/Down for visible nodes and Left/Right for parent, child, and expansion operations.
- A map node is an HTML button. Tab visits nodes in prerequisite order, not SVG drawing order.
- Selecting a map node keeps focus on that node. An explicit action moves focus into Skill Details.
- Modal dialogs trap focus, name their purpose, and restore focus on close. Modeless judge windows never trap focus.
- If an action hides the focused region, focus moves to its documented restore control.
- A stale diagnostic does not move the caret. Notes explains that the SQL changed.
- Editor Escape followed by Tab leaves CodeMirror without inserting indentation. Keyboard Shortcuts explains this escape route.
- F5 runs SQL only while an editable SQL document has focus. Elsewhere, the browser retains its F5 behavior.
- Ctrl+Enter also runs SQL in the editor. Ctrl+S saves while the IDE has focus.
- The rest of the practice loop carries keys while the workbench has focus: Ctrl+Shift+Enter submits, F7 parses, Ctrl+Shift+H reveals the next hint, and F8 opens the next challenge. Each dispatches the same command as its menu item, so an ineligible command stays ineligible from the keyboard. F1 and Ctrl+Shift+N are deliberately unused: browsers reserve them.
- macOS uses Command+Enter and Command+S equivalents. No application shortcut captures browser close-tab, reload, or zoom shortcuts. The application has no zoom of its own: the browser's own zoom scales the whole interface.
- Submit has no *bare* Enter binding. Ctrl+Shift+Enter is an explicit chord; the default-button bevel does not authorize accidental grading from unrelated controls.
- Cancel remains reachable through Tab and Query → Cancel during a run.

### Splitters, movement, and hit areas

The editor/results splitter uses a named native vertical range control with an accessible current value and limits.
Up/Down changes editor height by 10 CSS pixels. Shift increases the step to 50 pixels.
Home and End select the permitted extremes. Both panes retain at least 120 CSS pixels.
Without a stored preference the editor takes a fixed share of the window height rather than a fixed pixel height, bounded by those same limits, so a short window does not surrender its result grid and a tall one does not waste the space. Nothing is stored until the learner moves the splitter, so the share is re-derived on every load; after a deliberate move the stored height always wins, and Reset Layout gives it up again.
If the window cannot contain those limits, the document region scrolls instead of compressing a pane to zero.

The inner sidebar borders support horizontal pointer dragging and keyboard width adjustments.
Widths range from 180 to 480 CSS pixels and persist with the layout. Reset Layout restores 220/280-pixel defaults.
Middle-click closes SQL, map, and schema tabs. Closing a SQL tab preserves its saved draft in My Queries.
Judge dragging captures the pointer and prevents text selection until release or cancellation.

Window → Move Patchouli enters movement mode with a visible instruction.
Arrow keys move 10 CSS pixels. Enter accepts the position. Escape restores its starting position.
The floating judge has a bottom-right grip. Dragging it scales the window and its portrait between 75% and 300%, keeping the top-left corner fixed; with the grip focused, arrow keys change the size in 10% steps and the current percentage is exposed as its slider value. The size persists with the layout. The docked judge is never scaled.
Reset Patchouli Position and Size restores the specified lower-right position at 100%.
The judge never changes position or docking state in response to focus. Only explicit movement, docking, or reset commands change its placement.
Judge docking and goal floating are independent. The docked judge rides in the Goal panel whether it is docked or floating, and docking or floating one never toggles the other.
The Goal / Skill Details panel pops out as a floating window through its `⇲` button, its header menu, or Window → Dock / Float Goal. The floating window keeps the panel's content, hint and submit controls, and a docked judge. Its title bar drags with the pointer; Window → Move Goal enters the same keyboard movement mode as Move Judge. A bottom-right grip resizes the window between 180–480 by 160–1200 CSS pixels; with the grip focused, arrow keys change width and height in 10-pixel steps. The width is shared with the docked panel width. Position, size, and floating state persist with the layout, and Reset Layout docks the panel again.
The application scales through the browser's own zoom, which already scales the document, pointer coordinates, and viewport units together. It carries no zoom control of its own, so layout state and pointer events share one coordinate space. A stored layout.viewZoom from an earlier build is a retired key: it is tolerated on validation and dropped when the profile loads.
The main window title bar supports pointer dragging when the window is not maximized or in Reading Layout.
Maximize/restore retains the previous dragged position. Reset Layout restores the default window position, the default judge position and size (100%), and the docked goal panel.
Each window has an isolated paint layer, so IDE menus cannot overlap the floating judge's text.

Every independent pointer target has at least a 24-by-24 CSS-pixel hit area or sufficient non-overlapping target spacing.
The visible 16-by-14 window bevel can remain smaller inside that area.
Adjacent tiny buttons cannot claim overlapping invisible hit areas.
Dense chrome can increase its row height where necessary to meet this criterion.
Focus indicators remain distinct from selection, with at least 3:1 adjacent contrast.

### Zoom, layout, and readable content

The default desktop retains the blue background, icon column, taskbar, three columns, square bevels, and specified palette roles.
Its minimum desktop workspace remains 1100 by 640 CSS pixels.
Below 1100 CSS pixels of viewport width, Reading Layout applies automatically instead of scrolling the desktop horizontally.
Below 640 CSS pixels of height the desktop still scrolls vertically. No pane uses clipping to conceal controls or text.
The default left and right panels remain 220 and 280 CSS pixels, subject to accessible hit-area adjustments.
Each long tree, goal, notes list, editor, result grid, and map has an independent scroll region.

Reading Layout supplies an additional single-column layout at all viewport sizes, and is the required layout below 1100 CSS pixels.
It places navigation, active document, output, and goal/details in ordinary document flow.
Prose and dialogs reflow at 320 CSS pixels without horizontal page scrolling.
Only SQL, result tables, and the graph retain justified two-dimensional scroll regions.
The map also supplies an equivalent linear skill list in Reading Layout.
This alternative preserves the desktop rather than pretending that a fixed-width IDE satisfies reflow by itself.
Reading Layout limits prose to a bounded measure so wide viewports do not produce unreadable line lengths. SQL, result tables, and the graph keep their justified scroll regions and are never clamped.

The palette is defined once as a set of role tokens — chrome faces, bevel edges, fields, ink, accents, status colours and syntax colours — with light values identical to the ones the application shipped with. A dark theme supplies a second set of values for the same roles, and the Settings theme control offers System, Light and Dark. System is resolved through `matchMedia` and reacts to a change while the application is open, so the dark values live in one block rather than being duplicated under a media query. A theme is stored per device; a profile written before the theme existed has no such key, is loaded unchanged, and resolves to System.

The skill map and the relationship diagram both offer 75% to 400% plus Fit. Fit means fit: it scales to the binding axis of the pane it is given, with no fixed ceiling, because a capped fit left both canvases in a corner of a large display.

The relationship diagram draws one labelled edge per declared foreign key. The label names the referencing column and its cardinality — `N:1`, or `1:1` where the referencing column is itself unique — and each box lists its primary key and its foreign-key columns, so the column a relationship runs on is visible without opening the schema reference. Columns are ordered by the mean row of their neighbours, which removes most edge crossings. Edge colours are CSS rules rather than SVG presentation attributes, which do not accept custom properties.

Acceptance includes 100%, 125%, 200%, and 400% browser zoom, plus text-only enlargement to 200% where available.
At each size, all commands remain reachable, focus stays visible, and dialogs fit the visible viewport.
Long filenames, translated labels, validation messages, and full judge remarks remain accessible without hover-only tooltips.
The application does not disable pinch zoom or set a maximum viewport scale.

Ordinary text meets 4.5:1 contrast. Large text meets 3:1. Non-text controls and states meet 3:1 where required.
Green completed nodes retain their identity but use text or a darker green surface that meets contrast.
Amber diagnostic text, locked nodes, and syntax colors need actual contrast measurements before release.
Forced-colors mode preserves borders, focus, selection, and severity labels.
Reduced-motion mode has no loss of information. The ordinary interface already uses instant transitions.

The results grid exposes row and column counts, column headers, exact values, and the logical position of virtual rows.
Page Up/Down navigates result pages.
If virtual-grid screen-reader behavior fails acceptance, the application provides a bounded paginated table.
NULL has an explicit accessible value and remains distinct from an empty string.
The row-number column is not a data column for copy or grading.

Live regions announce run completion, save failure, and explicit grading results once.
They never announce every caret movement, clock tick, timer update, or parsed keystroke.
The diagnostics announcement preference defaults to quiet summaries, not unsolicited full remarks.

## Curriculum scope and progression

The current curriculum contains thirteen skills with five required challenges each: 65 challenges.
The original sixty objective IDs remain unchanged. Five reconciliation challenges extend that curriculum.
`readiness/curriculum.json` owns skill labels, briefs, prerequisites, coordinates, required challenge order, and definition paths.
Challenge definitions own their titles and briefs. The application does not maintain a second authored list.

Each definition supplies instructions, starter SQL, three hints, a typed output contract, dataset selection, reference SQL, and assessment assets.
Learner briefs describe useful work without relying on column names. Schema and output requirements name fields precisely.
References and hints teach the intended construct. Equivalent SQL earns completion when its outcomes satisfy the assessment.
No concept requirement, SQL keyword, style opinion, diagnostic, or runtime threshold acts as an additional completion gate.
**Completed** records an accepted outcome. It does not claim that the grader proved technique mastery.

### Authored objectives

Objective IDs remain stable across content versions. Display numbers do not define prerequisite order.
`window.03` retains display label “Challenge 07”. `rec.01` retains “08”, and `pivot.01` retains “09”.
Other challenges display their objective IDs. The following summaries describe intended learning, not syntax requirements or duplicate challenge briefs.

| Skill                        | Five distinct required objectives                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL basics (`basics`)        | `basics.01`: project stable customer identifiers and names without extra columns. `basics.02`: filter paid orders with a half-open date interval. `basics.03`: separate NULL values from empty strings in an authored fixture. `basics.04`: produce a deterministic top-N result with a complete tie-break order. `basics.05`: classify quantities through CASE with mutually exclusive boundaries.                                                                        |
| Aggregation (`agg`)          | `agg.01`: compute gross line-item revenue with exact decimals. `agg.02`: distinguish COUNT(\*) from COUNT(nullable_column). `agg.03`: apply HAVING after monthly category grouping. `agg.04`: prevent inflated payment totals through pre-aggregation before a fan-out join. `agg.05`: distinguish subtotal rows from data NULLs through GROUPING SETS and GROUPING.                                                                                                       |
| Joins (`joins`)              | `joins.01`: traverse orders, items, products, and categories with all key relationships. `joins.02`: preserve customers without orders through a left join. `joins.03`: compare ON and WHERE filters on the optional side of an outer join. `joins.04`: use semi/anti joins without multiplying customer rows. `joins.05`: reconcile item returns and payments at their correct grains without fan-out.                                                                    |
| Subqueries & EXISTS (`sub`)  | `sub.01`: compare product prices with an exact catalog average. `sub.02`: find customers with paid activity without duplicates. `sub.03`: exclude return-request customers despite nullable references. `sub.04`: compare each product with its category average. `sub.05`: select the latest payment status with a timestamp and identity tie break.                                                                                                                      |
| Set operations (`sets`)      | `sets.01`: combine customer cohorts with UNION and documented deduplication. `sets.02`: preserve repeated events through UNION ALL. `sets.03`: find cohort differences through EXCEPT with NULL-aware fixtures. `sets.04`: intersect independently derived purchaser cohorts. `sets.05`: reconcile duplicate event counts through EXCEPT ALL in both directions.                                                                                                           |
| CTEs (`cte`)                 | `cte.01`: name and reuse a filtered paid-order relation. `cte.02`: chain item revenue and monthly totals with explicit grains. `cte.03`: separate grouped revenue from window ranking. `cte.04`: compare equivalent inline and materialized CTE forms without assuming an optimizer result. `cte.05`: assemble revenue, returns, and customer cohorts into a readable reconciliation query.                                                                                |
| Window functions (`window`)  | `window.01`: contrast RANK and DENSE_RANK on revenue ties. `window.02`: select one latest order per customer through ROW_NUMBER and deterministic peers. `window.03` (07): rank 2024 category revenue per month with ties and exact transaction prices. `window.04`: compare monthly revenue with LAG across an explicit gap-filled calendar. `window.05`: distinguish ROWS and RANGE frames for running totals with duplicate dates.                                      |
| Date / time (`dates`)        | `dates.01`: classify timestamps on the UTC year boundary. `dates.02`: group paid orders by calendar month and return DATE values. `dates.03`: fill missing months through a generated calendar and left join. `dates.04`: assign a July-start fiscal year without month-boundary errors. `dates.05`: find order-activity islands through a stated maximum gap.                                                                                                             |
| Recursive CTEs (`rec`)       | `rec.01` (08): enumerate category descendants with depth and root identity. `rec.02`: build category ancestor paths from leaves to roots. `rec.03`: stop a deliberate category cycle through visited identifiers. `rec.04`: enumerate warehouse routes with directed edges and a depth bound. `rec.05`: select minimum-cost simple routes and preserve equal-cost ties.                                                                                                    |
| Pivot / unpivot (`pivot`)    | `pivot.01` (09): pivot return quantities into fixed reason columns by month. `pivot.02`: reproduce the same matrix through conditional aggregation. `pivot.03`: preserve absent reasons as zero without losing empty months. `pivot.04`: unpivot a fixed monthly fixture while documenting NULL inclusion. `pivot.05`: prove a pivot/unpivot round trip at an explicitly unique input grain.                                                                               |
| Plans & indexing (`plan`)    | `plan.01`: distinguish result count from scanned work. `plan.02`: report actual filter evidence for equivalent queries. `plan.03`: compare equivalent aggregation strategies with repeated measurements. `plan.04`: create an index, report the observed access path, then drop the index. `plan.05`: compare selective and broad work with measured variability.                                                                                                          |
| Cleaning & strings (`clean`) | `clean.01`: normalize surrounding whitespace and case without merging customer identities. `clean.02`: distinguish blank values from missing values through NULLIF and COALESCE. `clean.03`: extract valid postal codes and retain invalid original values for review. `clean.04`: split multi-value tags and preserve one-to-many output without accidental duplication. `clean.05`: parse mixed-format dates with explicit accepted formats and a rejected-value report. |
| Reconciliation (`reconcile`) | `reconcile.01`: normalize partner records and expose account-block candidates. `reconcile.02`: score and rank pair evidence with ties. `reconcile.03`: construct split and rollup groups. `reconcile.04`: report confident, ambiguous, and missing decisions. `reconcile.05`: design a policy that meets the outcome rubric.                                                                                                                                               |

Six explicit dataset families serve the curriculum: `commerce-ranking`, `commerce-practice`, `workshop`, `graphs`, `index-lab`, and `reconciliation`.
Cleaning uses workshop fixtures. Cycles and alternate routes use graph fixtures, not undocumented edges in the commerce forests.
Only `window.03` uses the unchanged ranking family, including its Parquet preview and nine-row boundary answer.
Commerce-practice supplements are separate from the original schema, fixtures, ranking reference, and Parquet assets.
Its seeded category permutation preserves foreign keys and the forest while making categories 2, 3, and 7 leaves.
Its seeded order 1 timestamp moves earlier with dependent time offsets preserved. These adaptations make the supplements compatible with existing invariants.
Payment records remain independent processing snapshots, not an accounting ledger.

### Prerequisites and state transitions

The prerequisite graph retains all 17 original design edges. The final row adds four prerequisites for Reconciliation:

| Skill     | All required prerequisite skills |
| --------- | -------------------------------- |
| basics    | None                             |
| agg       | basics                           |
| joins     | basics                           |
| sub       | basics                           |
| sets      | agg                              |
| cte       | agg, joins, sub                  |
| window    | agg, joins                       |
| dates     | joins                            |
| rec       | cte                              |
| pivot     | cte, window                      |
| plan      | window, joins                    |
| clean     | dates, sub                       |
| reconcile | cte, window, sets, clean         |

A fresh profile starts at `basics.01` with zero completions. Existing valid documents remain selected.
A skill becomes available only when all prerequisite skills have current completion.
A skill is completed only when all five required challenges have current completion.
A challenge has current completion when any nondeleted, complete, correct attempt matches its entire current content identity.
An opened skill or an attempted challenge can show In progress. The other states are Locked, Available, Completed, and Needs review.

All five challenges in an available skill are directly selectable. There are no gates between challenges within a skill.
Open next challenge uses authored order and skips current completions.
Opening an available challenge records its skill in `openedSkillIds`. Selecting a locked map node does not record an opening.
Previously opened skills remain accessible for review after prerequisite completion disappears through a version change or attempt deletion.
Review access does not complete prerequisites or unlock further skills by itself.

A locked skill can be opened early through Practice ahead, from its map context menu or its detail panel.
Practicing ahead is recorded in `exploredSkillIds`. It grants access only: the skill stays unavailable, and it reads In progress with an ahead marker.
Availability is still derived from completion alone, so practicing ahead never satisfies a prerequisite and never unlocks a later skill by itself.
A challenge completed while practicing ahead is an ordinary current completion. It counts toward its own skill and unlocks what that skill gates.
Practicing ahead is reversible while the skill holds no completion. Returning to the recommended path re-locks it.
Once any challenge there is completed, the skill stays open and the reversal is withdrawn with its reason. Dropping access would re-lock that skill's own unfinished objectives and strand the passes beside them, and it never reports Needs review, because nothing has regressed.
Open next challenge continues to follow the recommended path and never retargets to a skill opened ahead.
Every surface that shows a lock names the specific prerequisite skills that remain incomplete.
Leaving an unfinished challenge retains its draft SQL and revealed hints. The application states that guarantee once per session, on the first such departure, and withdraws it when that challenge is the open document.

A later failed submission never erases an earlier current-identity pass.
Deleting an accepted attempt recomputes completion from the remaining nondeleted attempts.
Historical passes show Needs review, not current completion. Imported history follows the same rule.
Any identity difference requires a new accepted submission for current completion, even when the mathematical task remains unchanged.

New exact definitions use `<challengeId>-v1`, `<challengeId>-bundle-v1`, and assessment version `exact-v1`.
Measured labs use `plan-lab-v1`. The outcome-based capstone uses `reconciliation-v1`.
Challenge 07 retains semantic version `challenge-07-v1` within `window.03-bundle-v2`.
Its legacy attempts remain historical and require review and resubmission. The new package never silently inherits a legacy pass.

### Definition-based practice

Opening a challenge finds or creates its own current-version document. It never reuses another challenge's draft.
The selected definition supplies the Goal, instructions, output shape, starter, hints, reset behavior, and submission eligibility.
Each document retains independent SQL, revision history, selections, scroll position, and revealed hints.
The three hint levels cover concept, query structure, and boundary guidance. Hint use does not reduce completion credit.

Each guided document carries its full content identity and dataset ID.
Scratch documents carry a dataset ID and `challenge: null`. They can execute, but cannot submit for challenge credit.
Reopening a current attempt restores its SQL and recorded identity.
Unavailable historical content opens as scratch with an explicit historical notice, never as a silently reassigned current challenge.
Content errors remain visible with Retry. Drafts remain available, and a load failure never falls back to Challenge 07.

The former preview-only Challenge 07 milestone is historical. The current application uses one catalog for all 65 challenges.
The map contains thirteen nodes. Its canvas derives its bounds from the authored coordinates and margins.
Existing keyboard navigation, scrolling, context menus, trays, and explicit-only judge movement remain part of the interaction contract.
Local use requires provisioned assets and a local server, not a public deployment.

### Measured performance labs

All five plan challenges require correct results and report answers that agree with measurements from the current SQL and dataset.
Evidence binds the full content identity, dataset variant, and SHA-256 of every measured SQL string.
Editing SQL invalidates its measurements. Editing report answers does not invalidate measurements for unchanged SQL.
Documents preserve lab SQL and report answers. Accepted attempts preserve measured evidence, never worker handles.

| Challenge | Required measured evidence                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.01` | Report completed result count separately from the sum of leaf scan `operator_rows_scanned` values. A missing required metric means `not-reported`.      |
| `plan.02` | Run two equivalent paid-order filters. Report each profile's scan filter evidence as `reported` or `not-reported`, with the actual filter text visible. |
| `plan.03` | Compare a correct correlated baseline with an equivalent alternative. Report the lower median and whether the difference exceeds both MADs combined.    |
| `plan.04` | Create one non-unique index on `lookup_orders(customer_id)`, run the exact probe, report its access path, then drop the index.                          |
| `plan.05` | Compare selective and broad queries after one warmup each and nine alternating timed pairs. Report measured medians, MADs, and their comparison.        |

`plan.03` also uses nine alternating timed pairs and separate profiles. Neither comparison requires a speed improvement.
Report fields use actual measurements, not rounded text that the learner must re-enter.
The index lab checks index existence and columns, exact probe results before and after, and absence after DROP.
Its disposable session ends on reset, cancellation, completion, or navigation. An incomplete sequence cannot pass.
Only this sandbox admits its restricted index commands. Learning data remains immutable.

An absent optional field in a successful profile can support `not-reported`.
A failed profile request is an engine error, not evidence of an absent metric.
The grader never substitutes plan wrapper counts for result count or treats absent metrics as zero.
An index scan or a particular optimizer shape is not a completion requirement.

### Staged reconciliation and capstone outcomes

Four guided challenges use exact outputs: normalized candidates, ranked pair evidence, eligible groups, then confidence decisions.
Each stage runs independently against dedicated reference and partner tables. Learner SQL never modifies reference records.
Candidate pairs share a non-NULL normalized account key.
Physical replays share a non-NULL normalized source event key. Distinct event keys remain distinct even when their values match.

Guided evidence combines description distance, date distance, quantity, category, and shared words into an integer score from 0 through 100.
Groups support one-to-one, one-to-many, and many-to-one matches, with at most three members on either side.
Multiple members on both sides are forbidden. Multi-member groups require equal aggregate quantities.
Guided decisions retain ties, ambiguous evidence, missing evidence, and simultaneous overlap conflicts.
The score is evidence, not a calibrated probability.

`reconcile.05` accepts different policies. The additive and conservative lexicographic solutions illustrate distinct complete approaches.
Each output contains one row per reference: `ref_id`, `partner_ids`, `confidence`, `score`, and `explanation`.
`partner_ids` contains a JSON array of unique decimal ID strings, never numeric JSON IDs.
Confidence is `high`, `probable`, `ambiguous`, or `missing`. Scores range from 0 through 1, with explanations of 1–1000 characters.
Every listed partner ID must exist. Missing decisions use empty arrays.

High and probable decisions commit links. Ambiguous decisions can list candidates without committing them.
The assessor canonicalizes replay aliases and assesses whole connected components against synthetic truth.
It rejects many-to-many groups and groups larger than the supported limit.
Every grading variant must meet all requirements:

- Committed precision is at least 0.98.
- Determinate-match recall is at least 0.85.
- No high-confidence decision is incorrect.
- Every truth-ambiguous reference has an ambiguous label. Every truth-missing reference has a missing label.
- No truth-ambiguous or truth-missing reference has a committed decision.
- Split-family and rollup-family recall each reach 0.80, measured through complete recovered truth groups.

Committed precision counts correct committed reference decisions among all committed reference decisions.
Determinate-match recall counts correctly committed determinate references among all determinate references.
An empty committed set has precision zero and cannot pass.
Without high-confidence commitments, high-confidence precision is not applicable. The rubric requires no minimum high-confidence count.

The assessment shows committed coverage separately from truth recall.
It includes confidence counts, business-unit and category breakdowns, false commitments, missing cases, ambiguity, and failed group recovery.
Source records and evidence appear beside learner explanations. The grader does not claim to establish an explanation's truth.
Generic speed comparison is unavailable for the capstone because valid outputs can differ.
Synthetic truth assets are locally inspectable, not secret examination infrastructure.
Successful completion establishes outcome quality on these fixtures, not a production matching guarantee.

### Katas: repetition drills

Decision: drills are a separate practice mode, not a second grading authority. A kata is a short prompt drilled repeatedly to build recall of one SQL shape; the 65 challenges remain the only source of completion.

Each authored pattern names a curriculum skill, one dataset, a reason the shape is worth practicing, and at least three variations. A variation carries its prompt, one dataset variant, an authored reference query, and its own output contract — the same five column types, the same nullability declaration, and the same explicitly authored ordering keys a challenge uses. Ordering is enforced only where the contract names it, so drilling `ORDER BY` is a stated property rather than an accident of the reference.

Correctness is decided at run time: the authored reference is executed beside the learner's SQL in the named variant, and both are compared with the same comparator that grades challenges. Katas therefore ship no published expectation, hold no content identity, and add no manifest entry, so adding a drill never changes `bundleVersion` and never invalidates a learner's completions.

Because nothing in the content pipeline verifies a drill, the reference is checked against its own contract before the learner's answer is compared. A disagreement is reported as a content error naming the kata, never as an incorrect attempt: a mis-authored contract must not tell a learner that a correct answer is wrong.

Drills carry the only time-based schedule in the application. A scheduled pass advances a per-variation streak and schedules the next repetition after 1, 3, 7, then 21 days; the last interval repeats, because a drill returning in a year has been silently dropped. A miss resets the streak and schedules it immediately, whenever it happens: failing is evidence of not knowing regardless of when it was asked. Four consecutive scheduled passes mark a variation retained.

Due-ness recommends rather than gates. Any pattern can be drilled at any time, because passing every drill in one sitting would otherwise leave the surface empty until the next day and read as broken. A pass on a variation that was not due is recorded as an attempt but advances neither the streak nor the date, and the surface says so: spacing is the entire claim a streak makes, so four repetitions in two minutes must not mark a shape retained.

The schedule is stored per device in the settings store, travels in a practice backup, and merges by most recent attempt on import. It never writes an attempt, a document, a hint level, or a completion.

The drill surface lists every variation under the pattern that owns it, each with its own state: never drilled, due, retained, or the date it next comes due. A filter shows either the patterns with drills due or all of them, so a count of drills in the introduction is always reachable as individual drills below it.

## Practice Records, accounts, and trust

Decision: local practice records only. Public rankings, accounts, synchronization, and a submission backend are excluded from the planned release.
The gold trophy remains; its desktop label is “Practice Records”.
The destination title is “Practice Records — this device”, not a misleading public list.
It includes this notice: “These practice records belong to this browser. They are not verified public rankings.”

The view groups records by challenge and content version.
It shows completion, first accepted attempt, latest attempt, hint use, and comparable local performance sessions.
Correctness and assistance filters are explicit. Empty state explains how Submit creates a record.
A learner can reopen attempt SQL, export records, or delete selected history after explicit acceptance.
Imported records carry an Imported label. No invented competitors, percentile, or global rank appears.

A summary describes every recorded attempt, deliberately not the filtered list: graded submissions and the number of challenges they cover, correct count and share, how many correct answers used no hint, how many challenges were correct on their first graded attempt, the median engine time of correct attempts, and the number of calendar days practiced with the current consecutive run. Filtering by correctness would make accuracy and first-attempt rate tautological — select “Correct” and every earliest shown attempt is correct by construction — so the summary names its own scope and ignores the filters. Every figure is derived from stored attempt fields, and a per-skill breakdown gives correct-over-graded for each skill. Execute runs are not submissions and are excluded from every figure. Engine time is labelled as the time the graded SQL ran, never as time spent solving: the application does not measure that, so it does not report it.

Local performance ordering applies only within one recorded comparison session with identical dataset and engine configuration.
Cross-device imports and different configurations never compete through one “best runtime” column.
The application never claims that the learner beat an optimum from one wall-clock sample.

All client SQL, fixtures, reference answers, local storage, timestamps, and completion records are inspectable and editable.
Local records are useful practice history, not trusted evidence for prizes, hiring, or certification.
A checksum detects accidental damage to a backup. It cannot establish authenticity.
No SQL or saved query leaves the device through grading, telemetry, or synchronization.
Ordinary static-host access logs and an explicit DuckDB Docs visit remain outside that local-data promise.

A future public ranking requires a new product decision and a server-side design before any backend selection.
That design must define authenticated identity, privacy, deletion, submission retention, per-account/IP abuse limits, and resource budgets.
It must re-run submitted SQL against a controlled engine and dataset in a resource-limited environment.
Comparable ranking requires fixed hardware policy, engine configuration, warmup, repeated measurements, and a variability rule.
Client-reported correctness or runtime can never establish a trusted public rank.
No account or trust upgrade happens silently to existing local records.

## Persistence contract

### Store ownership and writes

IndexedDB database `sql-grind-practice` uses integer schema version 2.
The engine and its disposable data never own the only copy of learner work.
The persistent stores are:

| Store      | Identity and content                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`     | Database schema version, backup format version, installation identifier, and last successful export date.                                                     |
| `queries`  | Stable query identifier, name, SQL, revision, full `challenge` identity or NULL, dataset ID, optional lab document, timestamps, and deletion state.           |
| `drafts`   | Query identifier plus session identifier, complete document snapshot, and persistence time. Drafts preserve conflicting edits from multiple tabs.             |
| `attempts` | Run identifier, immutable SQL snapshot, full content identity, dataset ID, revision, outcome, hints, and discriminated assessment evidence.                   |
| `progress` | Challenge ID plus bundle version, accepted attempt identifier, completion date, assistance label, and review status. This derived index is not authoritative. |
| `settings` | Three keyed records. `preferences`: judge and editor settings, panel dimensions, reading layout. `session`: open and active document identifiers, `openedSkillIds`, `exploredSkillIds`, and the query history. `katas`: the drill repetition schedule, which is never a source of challenge completion.               |

Attempt identity comes from the captured run result, never from the currently selected document or fixed global content metadata.
Assessment evidence distinguishes exact fixture outcomes, measured labs, and reconciliation metrics.
Lab evidence preserves measurements and report answers. Worker handles and full Arrow results remain disposable.
Plans and result buffers can regenerate only when their recorded content remains available.
Timestamps use UTC ISO strings. Exact decimal metrics and large integers use typed decimal strings in portable records.
Imported or historical SQL never runs automatically. Recalling a statement from the query history opens it in a new document and waits for the learner to run it.

The query history keeps the last 50 executed statements, newest first, with the dataset and the kind of run. Consecutive repeats of the same statement are recorded once. One entry holds at most 16 KiB of SQL; a longer statement is stored truncated and says so, because the whole row is rewritten on every run. These are fixed retention limits chosen for recall, not automatic deletion to free space, and the learner can clear the history after explicit acceptance. It travels in the backup, so a restored history may describe runs from another device; it holds no document reference and never awards completion.
Recording one statement writes the history alone. It never re-checks open-document identity, so a failed history write reports itself in Messages and cannot turn a successful run into a storage error. An ordinary session save never rewrites the history.

Draft persistence occurs after 500 milliseconds without an edit and before a deliberate document switch.
Save persists the captured revision immediately.
If an older write completes after a newer edit, the newer revision remains dirty.
The “Saved” state appears only after transaction completion, not after request success.
Browser shutdown cannot guarantee a final asynchronous write, so the interface never treats `beforeunload` as a backup mechanism.

Attempt recording is atomic and idempotent. One transaction stores the immutable attempt and recomputes its progress index.
If storage fails, the result remains visible as “Passed, not saved”.
The application offers Retry save and Export SQL. It does not claim durable completion.

Multiple tabs use revision checks inside a write transaction.
An outdated writer creates a conflicting draft rather than replacing a newer saved query.
The conflict dialog offers Keep both, Use this draft, or Keep saved version.
No last-write-wins policy silently deletes another tab's SQL.

### Migrations and content versions

Schema migrations use ordered, deterministic `upgradeneeded` steps from every supported stored version.
The implementation retains all published migration steps. It never deletes and recreates the database to repair an upgrade error.
A migration copies records before replacing a store or index with incompatible structure.
An aborted transaction leaves the prior database version intact.

The version 1 migration preserves SQL, revisions, history, timestamps, deletion state, selections, scroll position, hints, and attempts.
Known legacy `challenge-07` identities become historical `window.03` identities with their recorded bundle, challenge, dataset, and engine versions.
Legacy identities use assessment version `legacy-assessment-v1`.
When a legacy document has no engine version, migration uses the historical `v1.5.4`, not the currently loaded engine.
Unknown legacy identities remain historical and ungradable until the learner opens them as scratch.
Legacy window documents or attempts record `window` as previously opened, preserving review access.
The migration deletes obsolete concept outcomes. They never become current completion evidence.

An open tab handles `versionchange` by finishing its current write, closing its connection, and requesting reload.
A blocked upgrade names the cause and offers Retry after other SQL Grind tabs close.
Neither branch loops forever nor clears the database.
An older application that encounters a newer schema stops writes and requests a current application version.
It does not attempt a downgrade.

On a migration error, the application preserves stored data and shows the error.
The previous compatible release remains the recovery path for a backup export.
A future release cannot become current until that recovery path and every prior migration path have acceptance evidence.
Content-version changes preserve SQL and historical attempts independently from schema migrations.
Progress recomputes from accepted attempts and the current content manifest.

### Export and import

Export Practice Backup downloads a UTF-8 JSON file with `format: "sql-grind-practice"` and `formatVersion: 2`.
The envelope includes export time, application version, and all six stores in its payload.
Content identities belong to individual documents and attempts, not a global backup content version.
A SHA-256 digest covers the exact UTF-8 bytes of a serialized `payload` string inside the envelope.
This representation avoids an unspecified JSON canonicalization rule.
Backup exports include deleted queries unless the learner explicitly excludes the Recycle Bin.
They exclude caches, browser permissions, engine binaries, and result buffers.

Import checks the format, supported version, digest, field types, bounded strings, unique identifiers, and record relationships before writing.
The backup file limit is 64 MiB. A SQL field limit is 1 MiB in UTF-8.
The total record limit is 100,000. A nesting limit of 20 prevents unreasonable structures.
These are product safeguards, not browser quota promises.
A larger existing library uses explicit per-query SQL export until a new backup format supports larger archives.

A preview shows incoming query, draft, attempt, deleted-query, and conflict counts.
The learner chooses Merge or Replace practice data. Replace requires an explicit data-loss warning and offers an export first.
Merge deduplicates identical identifiers and content.
Different content under one identifier becomes a new query or attempt with remapped references and an Imported conflict label.
Imported settings do not replace local settings during Merge unless the learner selects that option.

Import stages its parsed records in memory within the file limit.
One IndexedDB transaction commits all affected stores. A failure leaves the previous practice data intact.
Wrong digests, malformed values, unsupported newer formats, and invalid references reject the import before mutation.
Import accepts versions 1 and 2. Version 1 records migrate in memory before the same strict checks and atomic transaction.
Exports contain only version 2 records.
Unknown challenge versions remain historical and never award current completion automatically.
Strings render as text. An imported name, SQL comment, or message cannot create HTML, scripts, URLs to fetch, or filesystem access.

### Quota, eviction, deletion, and privacy

Storage → Protect local work requests `navigator.storage.persist()` after an explicit learner action.
The result shows Granted, Denied, or Unavailable. Denial does not prevent practice.
Usage from `navigator.storage.estimate()` is approximate, not guaranteed available disk space.
Private browsing can erase work at session end, so the interface always offers portable backup without claiming private-mode detection.

On `QuotaExceededError`, the application retains the unsaved revision in memory and shows a persistent save-error banner.
It can delete only disposable application cache entries before one explicit retry.
It never deletes queries, drafts, attempts, progress, or the Recycle Bin to free space automatically.
The banner offers Export SQL, Export Practice Backup, Storage, and Retry save.
If IndexedDB is unavailable, practice continues in a clearly labeled temporary session with download-based SQL export.

Browser eviction can delete all data for the origin, including IndexedDB and caches.
After complete eviction, the application cannot reliably distinguish a first visit from data loss.
An empty profile therefore states “No local practice data found” and offers Import backup.
A sentinel in the same origin is not evidence that deleted records can be recovered.
A backup outside the origin is the recovery mechanism.

Delete in My Queries sets a deletion time. Restore clears it and preserves the stable identifier.
A name conflict offers rename without overwriting another query.
The Recycle Bin has no automatic expiration.
Permanent query deletion also deletes its drafts, but historical attempts retain their disclosed SQL snapshots.
The deletion dialog explains that distinction and offers separate deletion of related attempt history.
Deleting an accepted attempt recomputes progress from remaining attempts.
Clear all practice data deletes all six stores after explicit acceptance. It does not promise deletion of previously downloaded backups.

A host or origin change requires an export from the old origin and import into the new origin.
A path change on the same origin does not require a different database.
Third-party embedded operation is outside the support contract because storage partitioning can change its behavior.
No application analytics contain query text, imports, or local practice records.

### Offline policy

The user's local-runtime decision in `scope.json` replaces the former online-first policy.
After initial provisioning, a local server must serve all runtime assets without internet access.
A fresh browser session and an engine restart must work with external origins blocked.
The local server must remain available. This requirement does not mean opening files through `file://`.

A service worker now caches the engine, the extensions and the content bundle in Cache Storage, and is registered only in a production build so the development server is unaffected. It exists for durability rather than for offline support as a feature: the HTTP cache may evict a 36 MB wasm module at any time, and re-downloading it is the slowest thing the application can do. The content bundle, the datasets and the extension payloads are SHA-256 verified against the manifest before use. The worker script and the wasm module are verified as bytes and then loaded again by URL, so what executes is whatever the fetch layer returns: the cache is trusted for those two, and the manifest hash bounds what a *content* asset can be, not what the runtime is.

Immutable, hash-verified assets are served cache-first. The document and the built application assets are served network-first with a cache fallback, so a deployment is never masked by a superseded copy. Cache names carry the bundle version and configuration hash, and caches that do not match the current version are deleted.

Missing local assets stop the affected action without changing the dataset or awarding a correctness pass.
Saving, exporting, and importing local work remain independent from engine recovery.
The Storage dialog reports what is actually cached and whether a service worker controls the page, rather than describing a deployment it cannot verify.

Persistence sources:

- [IndexedDB usage and upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).
- [Browser quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- [Storage persistence request](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

## Assets, permission evidence, and release blockers

The research below used primary author or rights-holder pages on 2026-09-12.
The handoff's phrase “Touhou fan-work license” is not a license grant for this particular image.

### Portrait

The supplied file is `assets/portrait/patchouli.webp`.
Its SHA-256 is `9ac49fbf2733234115889a954823bd24001cb562c87357ee8366c3e3b07c6ebf`.
The upload filename is `patchouli_art-1789181910732-0cpn.webp`.
The local handoff supplies no artist identity, original publication URL, license text, or permission correspondence.
The image bytes contain no EXIF or XMP metadata signatures.
Those observations identify missing evidence. They do not identify the artist or prove an infringement.

User decision, 2026-09-12: the portrait comes from a wiki, and this project is not a SaaS.
The user accepts the supplied portrait for now and wants to revisit its permissions later.
Keep the supplied design. Do not substitute another character or reopen the permission question during local readiness work.
No exact wiki URL, creator attribution, or permission record accompanied that decision. The distribution record remains deferred, not verified.

The [official Touhou fan guidelines](https://touhou-project.news/guidelines_en/) require a clear Touhou fan-work notice.
They expressly prohibit another creator's fan content without that creator's permission.
They also distinguish individual fan activity from business activity by a legal person.
The browser-game rule requires free-to-play release, with stated monetization exceptions.
Those general rules do not establish this application's legal classification or authorize this portrait's redistribution.

Portrait permission status: **unresolved, public-release blocker**.
The asset owner must supply the original creator, original source, and a recorded grant tied to this exact file.
The grant must cover public website distribution, repository distribution, resize/crop operations, and promotional screenshots.
It must state the required credit and any commercial-use limits.
The product owner must identify the distributing entity and the actual monetization model before applying the Touhou guidelines.
If a legal person distributes the fan work as a business, the official guidance requires contact with the rights holder.

Public release with this portrait remains blocked until those records exist and their terms match the intended distribution.
An alternative is an explicitly approved replacement character and portrait with documented rights.
That alternative changes the design and requires a product decision. This document does not silently substitute it.
Private readiness work does not imply permission to publish the handoff image or screenshots.

### Selected icon source and native-size manifest

Decision: use selected Fugue Icons 3.5.6 by Yusuke Kamiyamane under CC BY 3.0.
The [author page](https://p.yusukekamiyamane.com/) identifies the license and the 16-pixel PNG set with bonus sizes.
The [author archive](https://p.yusukekamiyamane.com/icon/downloads/fugue-icons-3.5.6.zip) contains its own copyright and license notice.
Its SHA-256 is `59d54804343b9add8c96ea03bfb2fa3ff48f692459cf426c920a5612e771c37a`.
Archive inspection established the following filenames and PNG dimensions. No icon files were added to this repository.

| Destination                          | Archive member                                                                    | Native dimensions |
| ------------------------------------ | --------------------------------------------------------------------------------- | ----------------- |
| My Queries                           | `bonus/icons-32/folder.png`                                                       | 32 × 32           |
| DuckDB Docs                          | `bonus/icons-24/globe.png`                                                        | 24 × 24           |
| Schema Reference                     | `bonus/icons-32/document-text.png`                                                | 32 × 32           |
| Skill Map                            | `bonus/icons-32/map.png`                                                          | 32 × 32           |
| Practice Records                     | `icons/trophy.png`                                                                | 16 × 16           |
| Recycle Bin                          | `bonus/icons-24/bin.png`                                                          | 24 × 24           |
| Folder / document / database / table | `icons/folder.png`, `icons/document.png`, `icons/database.png`, `icons/table.png` | Each 16 × 16      |
| View / macro / index                 | `icons/table-select.png`, `icons/script.png`, `icons/key.png`                     | Each 16 × 16      |
| Execute / Parse / Cancel             | `icons/control.png`, `icons/tick.png`, `icons/control-stop-square.png`            | Each 16 × 16      |
| Plan / lock / Save                   | `icons/chart.png`, `icons/lock.png`, `icons/disk.png`                             | Each 16 × 16      |
| Refresh / filter / schema tree       | `icons/arrow-circle.png`, `icons/funnel.png`, `icons/application-tree.png`        | Each 16 × 16      |
| Quick-launch Docs                    | `icons/globe.png`                                                                 | 16 × 16           |

Desktop slots remain 32 × 32. Smaller native glyphs remain centered, not stretched.
This explicitly accepts a smaller trophy silhouette instead of distorting it or replacing it with a generic circle.
Tree glyphs become native 16 × 16 within 20-pixel rows, instead of squeezing 24-pixel artwork into 12 × 10.
The original indentation, folder identity, document identity, gold trophy, green run action, and purple judge role remain.
Browser zoom can scale the whole page. Application CSS never applies fractional icon scaling at 100% zoom.

Simple minimize, maximize, close, dock, expander, and judge-dot marks use project-authored geometric CSS shapes.
The Start emblem uses project-authored colored squares, not a copied Windows logo asset.
The application glyph remains its letter G. A moon-shaped judge mark uses project-authored geometry, not an operating-system glyph image.
These choices add no third-party icon artwork beyond the listed manifest.

The archive lists special licenses for geotag, language, open-share, opml, share, and xfn icons.
None belongs to the selected manifest. Logos and trademark icons also remain excluded.
The [CC BY 3.0 terms](https://creativecommons.org/licenses/by/3.0/) permit distribution and adaptation with attribution and license conditions.
They do not remove unrelated trademark or other rights.

Asset Credits must include: “Fugue Icons © 2013 Yusuke Kamiyamane. Licensed under Creative Commons Attribution 3.0.”
The credit links to the author and license and states whether selected icons changed.
The distributed asset directory must retain the archive's applicable notice and license information.
The [author's attribution examples](https://p.yusukekamiyamane.com/icon/attribution/) explicitly permit an About dialog as a credit location.
If the release complies with the attribution license, no royalty-free purchase is necessary.
Actual vendoring, credit inclusion, and visual acceptance remain application-release requirements, not completed work here.

[Pixelarticons Free](https://pixelarticons.com/free/) states MIT licensing and a 24 × 24 grid.
It is not selected because shrinking that grid to the small tree slot damages pixel geometry.
The free-page claim does not license paid Mini or Prime artwork.
The FamFamFam author URL failed DNS resolution during research, so no permission conclusion relies on that source.

## Original readiness evidence and prerequisites

| Requirement            | Current evidence                                                                                     | Exact remaining prerequisite                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portrait distribution  | Supplied bytes, filename, handoff statement, and official general guidelines                         | Creator identity, original source, exact-file permission, credit requirements, distributing entity, monetization decision, and any required rights-holder contact. Public release remains blocked. |
| Icon distribution      | Author terms, package notice, package hash, member names, and actual PNG dimensions                  | Vendor only selected files, retain notices, expose Asset Credits, and inspect their native-size appearance in the application. No unknown permission is assumed.                                   |
| Curriculum             | Sixty distinct authored objectives, fixed prerequisite graph, and milestone boundary                 | Each released challenge needs reviewed text, reference SQL, semantic fixtures, hints, and supported concept evidence. Only 07 belongs to the first milestone.                                      |
| Accessibility          | Inventory and explicit keyboard, focus, contrast, zoom, and layout criteria                          | Exercise the real application with keyboard and supported screen readers. Measure contrast and inspect each zoom/layout state. No accessibility pass is claimed here.                              |
| Persistence            | Stores, transaction boundaries, migration/import rules, quota handling, eviction, and offline policy | Exercise migration chains, two-tab conflicts, failed writes, malformed backups, backup round trips, and storage loss in the supported browser matrix.                                              |
| Browser and deployment | Product policies only                                                                                | Main's named browser matrix, device evidence, hosting decision, deployed headers, and execution measurements. This document does not invent those results.                                         |

The original investigation did not run an application build.
The application now has browser, storage, recovery, contrast, zoom, and deployment evidence in [the root README](../README.md).
Native icon sizes and the four desktop states also have application evidence.
Actual screen-reader interoperability and the untested browser/device targets remain outside the current evidence.

### Application accessibility adjustments

The title captions use dark backing within the original gradients. Panel headings use `#707070` for readable white text.
Controls retain at least 24 CSS pixels of target height. The docked judge retains its actions and therefore exceeds the prototype strip height.
The skill map retains the white 20-pixel grid. Reading Layout replaces spatial nodes with a linear skill list.
