<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { format as formatDialect } from "sql-formatter";
  import SqlEditor from "./components/SqlEditor.svelte";
  import ResultGrid from "./components/ResultGrid.svelte";
  import SkillMap from "./components/SkillMap.svelte";
  import SchemaDiagram from "./components/SchemaDiagram.svelte";
  import ContextMenu, {
    type ContextMenuItem,
  } from "./components/ContextMenu.svelte";
  import { icons, type Skill } from "./lib/catalog";
  import { EngineCoordinator } from "./lib/engine";
  import {
    openPracticeStore,
    DocumentConflictError,
    HISTORY_LIMIT,
    type PracticeStore,
  } from "./lib/storage";
  import {
    defaultSettings,
    formatCount,
    formatProgress,
    type QueryDocument,
    type Settings,
    type RunResult,
    type RunKind,
    type EngineState,
    type Diagnostic,
    type SchemaTable,
    type Attempt,
    type HistoryEntry,
  } from "./lib/types";
  import {
    assetUrl,
    ChallengeCatalog,
    sameIdentity,
    type ContentIdentity,
    type LoadedChallenge,
    type ChallengeDefinition,
    type ChallengeSummary,
  } from "./lib/challenges";
  import { deriveProgression, type Progression } from "./lib/progression";
  import PlanLab from "./lib/components/PlanLab.svelte";
  import {
    evidenceMatches,
    type LabDocument,
    type LabEvidence,
    type SqlSlot,
  } from "./lib/engine-labs";
  import ReconciliationAssessment from "./components/ReconciliationAssessment.svelte";
  import { kataPatterns, kataContentErrors } from "./lib/kata-content";
  import {
    emptyKataProgress,
    findKataRecord,
    kataStatus,
    nextKataVariation,
    KATA_RETAINED_STREAK,
    type KataProgress,
  } from "./lib/katas";
  import type { KataPattern } from "./lib/challenges";

  type StatusTone = "neutral" | "working" | "success" | "error";

  let engine: EngineCoordinator;
  let store: PracticeStore;
  let catalog = $state.raw<ChallengeCatalog | null>(null);
  let skills = $state<Skill[]>([]);
  let identities = $state<Record<string, ContentIdentity>>({});
  let summaries = $state<
    Record<string, ChallengeSummary & { skillId: string }>
  >({});
  let definitions = $state<Record<string, LoadedChallenge>>({});
  let openedSkillIds = $state<string[]>([]);
  let exploredSkillIds = $state<string[]>([]);
  // Newest first, capped: a recall list, not an archive. Executed SQL only,
  // and recall opens it in a document — it never runs on its own.
  let history = $state<HistoryEntry[]>([]);
  let hintLevels = $state<Record<string, number>>({});
  let contentError = $state("");
  let contentLoading = $state(false);
  let preparedDocumentId = $state("");
  let historicalNotice = $state("");
  // Leaving a hard challenge should not feel like forfeiting it. The status bar
  // is transient and the engine overwrites it, so the guarantee gets a panel.
  let retentionNotice = $state("");
  let retentionChallengeId = $state("");
  let toldRetention = false;
  let navigationSequence = 0;
  let contentLoadSequence = 0;
  let contentRetryChallengeId: string | null = null;
  let configureChain: Promise<void> = Promise.resolve();
  let labEvidence = $state.raw<Record<string, LabEvidence>>({});
  let labEditorStates = $state<
    Record<
      string,
      { selection: { anchor: number; head: number }; scrollTop: number }
    >
  >({});
  let baselineSql = $state("");
  let evidenceCurrent = $state(false);
  let editor = $state<SqlEditor>();
  let contextMenu = $state<{
    items: ContextMenuItem[];
    x: number;
    y: number;
    label: string;
    returnFocus: HTMLElement;
  } | null>(null);
  let docs = $state<QueryDocument[]>([]);
  let activeId = $state("");
  let openIds = $state<string[]>([]);
  let view = $state<"sql" | "map" | "schema" | "erd">("sql");
  let settings = $state<Settings>({ ...defaultSettings });
  let attempts = $state<Attempt[]>([]);
  let engineState = $state<EngineState>("loading");
  let status = $state("Loading local practice data and DuckDB…");
  let statusTone = $state<StatusTone>("working");
  let error = $state("");
  let errorSource = $state<"engine" | "storage" | "operation">("operation");
  let committedRevisions = $state<Record<string, number>>({});
  let failedDocuments = new Set<string>();
  let conflicts = new Map<string, DocumentConflictError>();
  let recoveryAvailable = $state(false);
  let schema = $state<SchemaTable[]>([]);
  let objects = $state<{
    views: { name: string; definition: string }[];
    macros: { name: string; definition: string }[];
    indexes: { name: string; definition: string }[];
  }>({ views: [], macros: [], indexes: [] });
  let domain = $state<"challenge" | "sandbox">("challenge");
  // Run evidence is keyed by document: a result only ever describes the
  // document it ran for, so switching tabs can never attach one to another.
  // `sql` is the text the engine actually ran, not the editor's current text:
  // it is what a derived query must wrap to describe the rows on screen.
  type RunSlot = { run: RunResult; kind: RunKind; sql: string };
  const INDEX_LAB_DATASET = "index-lab";
  let runs = $state.raw<Record<string, RunSlot>>({});
  const activeSlot = $derived(activeId ? (runs[activeId] ?? null) : null);
  const result = $derived(activeSlot?.run ?? null);
  const resultKind = $derived(activeSlot?.kind ?? "execute");
  // The kind of the run currently in flight. Distinct from resultKind, which
  // describes the last completed run of the active document.
  let runningKind = $state<RunKind>("execute");
  // Sandbox databases are disposable, so their evidence dies with the session.
  // Guarded: this is read from an effect, and an unconditional rewrite would
  // retrigger it forever.
  function clearSandboxRuns() {
    const kept = Object.entries(runs).filter(
      ([, slot]) => slot.run.datasetId !== INDEX_LAB_DATASET,
    );
    if (kept.length !== Object.keys(runs).length)
      runs = Object.fromEntries(kept);
  }
  function dropRun(id: string) {
    if (!Object.hasOwn(runs, id)) return;
    const { [id]: _dropped, ...rest } = runs;
    runs = rest;
  }
  let diagnostics = $state<Diagnostic[]>([]);
  let parseInfo = $state("Parser starting…");
  let outputTab = $state("Results");
  let messages = $state<string[]>([]);
  let comparisonRunning = $state(false);
  const comparisonStep = $derived(
    Number(status.match(/Comparison (\d+)\/9/)?.[1] ?? 0),
  );
  // Every Edit verb is one editor command. The former `name.toLowerCase()`
  // guess silently missed "Go to Line" -> "go to line", which is why a second
  // implementation grew beside CodeMirror's own panel.
  const editorCommands: Record<string, string> = {
    Undo: "undo",
    Redo: "redo",
    Cut: "cut",
    Copy: "copy",
    Paste: "paste",
    "Select All": "selectAll",
    Find: "find",
    Replace: "replace",
    "Go to Line": "gotoLine",
  };
  const shortcutHints: Record<string, string> = {
    Execute: "F5 / Ctrl+Enter",
    Save: "Ctrl+S",
    "Save As": "Ctrl+Shift+S",
    Undo: "Ctrl+Z",
    // Redo is Ctrl+Y on Windows and Ctrl+Shift+Z on Linux and macOS: the
    // history keymap binds them per platform, so advertising one would be
    // false on the other.
    Redo: "Ctrl+Shift+Z / Ctrl+Y",
    Cut: "Ctrl+X",
    Copy: "Ctrl+C",
    Paste: "Ctrl+V",
    "Select All": "Ctrl+A",
    Find: "Ctrl+F",
    "Go to Line": "Ctrl+Alt+G",
    "Format SQL": "Ctrl+Shift+F",
    // The practice loop is edit, run, submit. Submit was the only step that
    // forced a reach for the mouse. Ctrl+Shift+Enter pairs with Execute's
    // Ctrl+Enter; F7 and F8 are free in the editor keymap and unreserved by
    // the browser, unlike F1 (help) and Ctrl+Shift+N (private window).
    Submit: "Ctrl+Shift+Enter",
    Parse: "F7",
    Hint: "Ctrl+Shift+H",
    "Open Next Challenge": "F8",
  };
  // The Keyboard Shortcuts dialog is generated from the table above, so a menu
  // hint and its documentation cannot drift apart. Only keys with no menu
  // command are authored separately below.
  const shortcutPurpose: Record<string, string> = {
    Execute: "Run the SQL in the active document.",
    Save: "Save the active query.",
    "Save As": "Save the active query as a new copy.",
    Undo: "Undo the last edit.",
    Redo: "Redo the last undone edit.",
    Cut: "Cut the selection.",
    Copy: "Copy the selection.",
    Paste: "Paste at the caret.",
    "Select All": "Select the whole document.",
    Find: "Open the editor's find panel. F3 repeats the search.",
    "Go to Line": "Jump to a line number.",
    "Format SQL": "Reflow the active document. One undo restores it.",
    Submit: "Grade the active SQL on every grading variant.",
    Parse: "Check syntax and collect style notes without executing.",
    Hint: "Reveal the next hint for the current challenge.",
    "Open Next Challenge": "Open the next challenge in the current skill.",
  };
  let running = $state(false);
  let storageReady = $state(false);
  let ideVisible = $state(true);
  let maximized = $state(false);
  let desktopShown = $state(false);
  let savedVisibility = { ide: true, judge: true };
  let showExplorer = $state(true);
  let showGoal = $state(true);
  let goalCollapsed = $state(false);
  let selectedSkill = $state("basics");
  let selectedObject = $state("");
  let expanded = $state<Record<string, boolean>>({
    database: true,
    tables: true,
    challenges: true,
    earlier: false,
    views: false,
    macros: false,
    indexes: false,
  });
  let filterVisible = $state(false);
  let objectFilter = $state("");
  // A flat 290 px was two thirds of a 450 px-tall workbench and a quarter of a
  // tall one. The editor keeps a constant share of the window instead, inside
  // the same bounds the splitter enforces.
  function defaultEditorHeight() {
    return Math.max(
      160,
      Math.min(650, Math.round((globalThis.innerHeight ?? 900) * 0.34)),
    );
  }
  let editorHeight = $state(defaultEditorHeight());
  let editorHeightChosen = $state(false);
  let ideX = $state(0);
  let ideY = $state(0);
  let explorerWidth = $state(220);
  let goalWidth = $state(280);
  let mapTabOpen = $state(true);
  let schemaTabOpen = $state(true);
  let erdTabOpen = $state(false);
  $effect(() => {
    if (view === "map") mapTabOpen = true;
    if (view === "schema") schemaTabOpen = true;
    if (view === "erd") erdTabOpen = true;
    if (view !== "sql") {
      if (running && runningKind === "lab") engine?.cancel();
      void engine?.resetSandbox();
      // Untracked: this effect must depend on the view, not on run evidence.
      untrack(clearSandboxRuns);
    }
  });
  let judgeX = $state<number | null>(null);
  let judgeY = $state<number | null>(null);
  // Floating judge zoom, set by dragging its corner grip. Persisted in layout.
  let judgeZoom = $state(1);
  const JUDGE_ZOOM_MIN = 0.75,
    JUDGE_ZOOM_MAX = 3;
  const clampJudgeZoom = (value: number) =>
    Math.round(Math.max(JUDGE_ZOOM_MIN, Math.min(JUDGE_ZOOM_MAX, value)) * 20) /
    20;
  // The application applies no zoom of its own: native browser zoom already
  // scales the whole document, including pointer coordinates and viewport
  // units, so layout state and pointer events share one coordinate space.
  const viewWidth = () => window.innerWidth;
  const viewHeight = () => window.innerHeight;
  // Floating goal window (View → Goal / Skill Details, Window → Dock / Float Goal).
  let goalFloating = $state(false);
  let goalHeight = $state(420);
  let goalX = $state<number | null>(null);
  let goalY = $state<number | null>(null);
  let moving = $state<"" | "judge" | "goal">("");
  // Below the desktop's minimum width the three-column IDE cannot reflow, so
  // Reading Layout becomes mandatory. This never writes the stored preference:
  // widening restores whatever the learner actually chose.
  const NARROW_QUERY = "(max-width: 1099px)";
  let narrowViewport = $state(false);
  const readingLayout = $derived(settings.readingLayout || narrowViewport);
  // A floated Goal returns to document flow while narrow, with its saved
  // coordinates, size, and visibility untouched.
  const effectiveGoalFloating = $derived(goalFloating && !readingLayout);
  const effectiveJudgeZoom = $derived(readingLayout ? 1 : judgeZoom);
  let movementStart = { x: 0, y: 0 };
  let menu = $state("");
  let menuPosition = $state({ left: 0, top: 0 });
  let focusedMenu = $state("File");
  let startMenu = $state(false);
  let explorerMenu = $state(false);
  let goalMenu = $state(false);
  let clock = $state(new Date());
  let modal = $state("");
  let modalTitle = $state("");
  let modalText = $state("");
  let inputValue = $state("");
  let querySearch = $state("");
  let queryFilter = $state("all");
  let recordFilter = $state("all");
  let recordAssistance = $state("all");
  let storageInfo = $state("");
  let cacheInfo = $state("");
  let credits = $state("");
  let dialog: HTMLDialogElement;
  let importSqlInput: HTMLInputElement;
  let importBackupInput: HTMLInputElement;
  let confirmation: ((answer: boolean) => void) | null = null;
  let naming: ((answer: string | null) => void) | null = null;
  let modalReturn: HTMLElement | null = null;
  let saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let saveChains = new Map<string, Promise<void>>();
  let layoutPending = false;
  let versions = new Map<string, number>();
  let parseTimer: ReturnType<typeof setTimeout>;
  let parseSequence = 0;
  let pendingWrites = $state(0);
  let externalNotice = $state(false);
  const activeDoc = $derived(
    docs.find((d) => d.id === activeId && !d.deletedAt),
  );
  const hints = $derived(
    activeDoc?.challenge
      ? (hintLevels[
          JSON.stringify([
            activeDoc.challenge.challengeId,
            activeDoc.challenge.bundleVersion,
          ])
        ] ?? 0)
      : 0,
  );
  const activeSummary = $derived(
    activeDoc?.challenge &&
      sameIdentity(
        activeDoc.challenge,
        identities[activeDoc.challenge.challengeId],
      )
      ? summaries[activeDoc.challenge.challengeId]
      : undefined,
  );
  const activeContent = $derived(
    activeSummary ? definitions[activeSummary.challengeId] : undefined,
  );
  const challenge = $derived(activeContent?.definition);
  const progression: Progression = $derived(
    catalog
      ? deriveProgression(
          catalog.curriculum,
          identities,
          attempts,
          openedSkillIds,
          exploredSkillIds,
        )
      : { skills: {}, challenges: {} },
  );
  const completed = $derived(
    !!challenge && !!progression.challenges[challenge.challengeId]?.completed,
  );
  const completionSchema = $derived(
    Object.fromEntries(
      schema.map((table) => [
        table.name,
        table.columns.map((column) => column.name),
      ]),
    ),
  );
  const diagnosticsExample = $derived(
    schema.length
      ? `SELECT *\nFROM ${schema
          .slice(0, 2)
          .map((table) => `"${table.name.replaceAll('"', '""')}"`)
          .join(", ")};`
      : "SELECT 1;",
  );
  const busy = $derived(
    running ||
      [
        "initializing",
        "running",
        "transferring",
        "cancelling",
        "recovering",
      ].includes(engineState),
  );
  let kataProgress = $state<KataProgress>(emptyKataProgress());
  let kataPatternId = $state("");
  let kataVariationId = $state("");
  let kataSql = $state("");
  /** Whether the open drill was due when it started. Early passes advance nothing. */
  let kataScheduled = $state(true);
  let kataFeedback = $state("");
  let kataOutcome = $state<"" | "pass" | "miss">("");
  let kataRunning = $state(false);
  let kataElapsedMs = $state(0);
  // Read once when the surface opens. A drill schedule that re-evaluated on
  // every keystroke would make a variation vanish mid-attempt as it came due.
  let kataNow = $state(Date.now());
  const activeKataPattern = $derived(
    kataPatterns.find((pattern) => pattern.patternId === kataPatternId) ?? null,
  );
  const activeKataVariation = $derived(
    activeKataPattern?.variations.find(
      (variation) => variation.variationId === kataVariationId,
    ) ?? null,
  );
  /**
   * Defaults to every pattern: hiding the ones with nothing due would empty
   * the surface exactly when a learner has just passed everything, which is
   * the failure product.md warns against. The filter narrows on request.
   */
  let kataFilter = $state<"due" | "all">("all");
  const kataStatuses = $derived(
    kataPatterns.map((pattern) => ({
      pattern,
      status: kataStatus(pattern, kataProgress, kataNow),
      // The intro counted 21 drills and the list showed 7 patterns, so the
      // drills themselves were invisible. Each variation reports its own
      // state under the pattern that owns it.
      variations: pattern.variations.map((variation) => {
        const record = findKataRecord(
          kataProgress,
          pattern.patternId,
          variation.variationId,
        );
        return {
          variation,
          due: !record || record.dueAt <= kataNow,
          retained: (record?.streak ?? 0) >= KATA_RETAINED_STREAK,
          streak: record?.streak ?? 0,
          dueAt: record?.dueAt ?? null,
          attempts: record?.attempts ?? 0,
        };
      }),
    })),
  );
  const kataDueTotal = $derived(
    kataStatuses.reduce((total, entry) => total + entry.status.due, 0),
  );
  const kataVisible = $derived(
    kataFilter === "all"
      ? kataStatuses
      : kataStatuses.filter((entry) => entry.status.due > 0),
  );
  const activeKataRecord = $derived(
    activeKataPattern && activeKataVariation
      ? (findKataRecord(
          kataProgress,
          activeKataPattern.patternId,
          activeKataVariation.variationId,
        ) ?? null)
      : null,
  );
  const currentDiagnostics = $derived(
    diagnostics.filter((d) => d.revision === activeDoc?.revision),
  );
  const diagnosticLocations = $derived(
    [...new Set(currentDiagnostics.map(diagnosticLines))].join(", "),
  );
  const stale = $derived(
    !!result &&
      (result.documentId !== activeId ||
        result.revision !== activeDoc?.revision),
  );
  const comparisonEligible = $derived(
    !!activeDoc &&
      !!challenge &&
      challenge.assessment.kind === "exact" &&
      domain === "challenge" &&
      ((result?.correctness === "correct" &&
        !stale &&
        sameIdentity(result.challenge, activeDoc.challenge)) ||
        attempts.some(
          (attempt) =>
            !attempt.deletedAt &&
            sameIdentity(attempt.challenge, activeDoc.challenge) &&
            attempt.sql === activeDoc.sql &&
            attempt.correctness === "correct" &&
            attempt.outcome === "complete",
        )),
  );
  // Evidence about the draft on screen right now. `completed` records history
  // and survives reloads and edits, so it can never stand in for this.
  const solvedNow = $derived(
    !!result &&
      !stale &&
      !!activeDoc &&
      result.outcome === "complete" &&
      result.correctness === "correct" &&
      result.datasetId === activeDoc.datasetId &&
      sameIdentity(result.challenge, activeDoc.challenge),
  );
  const currentFailure = $derived(
    !!result &&
      !stale &&
      (result.outcome !== "complete" || result.correctness === "incorrect")
      ? result.message
      : "",
  );
  const skill = $derived(
    skills.find((s) => s.id === selectedSkill) ?? skills[0],
  );
  const visibleTables = $derived(
    schema.filter((t) => t.name.includes(objectFilter.toLowerCase())),
  );
  // Index records carry no owning-table column, so the DDL is matched instead.
  function indexTargetsTable(definition: string, table: string) {
    return new RegExp(
      `\\bON\\s+"?${table.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?\\b`,
      "i",
    ).test(definition);
  }
  // Explorer children of a table. Every field is already loaded with the
  // schema, so expanding a table fetches nothing.
  function tableGroups(table: SchemaTable) {
    return [
      {
        key: `cols:${table.name}`,
        name: "Columns",
        items: table.columns.map(
          (column) =>
            `${column.name} ${column.type}${column.nullable ? "" : " NOT NULL"}`,
        ),
      },
      {
        key: `keys:${table.name}`,
        name: "Keys",
        items: [
          ...new Set(
            table.columns.flatMap((column) =>
              column.key ? column.key.split("; ") : [],
            ),
          ),
        ],
      },
      {
        key: `idx:${table.name}`,
        name: "Indexes",
        items: objects.indexes
          .filter((index) => indexTargetsTable(index.definition, table.name))
          .map((index) => index.name),
      },
    ];
  }
  const library = $derived(
    docs
      .filter(
        (d) =>
          !d.deletedAt &&
          d.name.toLowerCase().includes(querySearch.toLowerCase()) &&
          (queryFilter === "all" ||
            (queryFilter === "challenge" ? !!d.challenge : !d.challenge)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );
  const deleted = $derived(
    docs
      .filter((d) => !!d.deletedAt)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
  );
  const filteredAttempts = $derived(
    attempts
      .filter(
        (a) =>
          (recordFilter === "all" || a.correctness === recordFilter) &&
          (recordAssistance === "all" ||
            (recordAssistance === "assisted"
              ? a.hintLevel > 0
              : a.hintLevel === 0)),
      )
      .sort((a, b) => b.createdAt - a.createdAt),
  );
  /**
   * Aggregates over every recorded attempt, deliberately not the filtered
   * list: filtering by correctness would make accuracy and first-attempt rate
   * tautological — select "Correct" and every earliest shown attempt is
   * correct by construction. Every figure is computed
   * from stored fields: correctness, hintLevel, createdAt and elapsedMs.
   *
   * elapsedMs is engine time for the graded SQL, not time spent solving, and
   * is labelled as such. Nothing here estimates a duration the application
   * never measured.
   */
  const recordSummary = $derived.by(() => {
    const graded = attempts.filter(
      (a) => a.correctness === "correct" || a.correctness === "incorrect",
    );
    const correct = graded.filter((a) => a.correctness === "correct");
    const median = (values: number[]) => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = sorted.length >> 1;
      return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    // A challenge counts as first-attempt correct when its earliest graded
    // attempt passed. Ordering is by createdAt, so this survives filtering.
    const byChallenge = new Map<string, Attempt[]>();
    for (const attempt of graded) {
      const list = byChallenge.get(attempt.challenge.challengeId) ?? [];
      list.push(attempt);
      byChallenge.set(attempt.challenge.challengeId, list);
    }
    let firstTry = 0;
    for (const list of byChallenge.values())
      if (
        [...list].sort((a, b) => a.createdAt - b.createdAt)[0].correctness ===
        "correct"
      )
        firstTry++;
    // Calendar days in this browser's time zone, newest first.
    const days = [
      ...new Set(
        graded.map((a) => new Date(a.createdAt).toLocaleDateString("en-CA")),
      ),
    ].sort((a, b) => b.localeCompare(a));
    const dayMs = 86_400_000;
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    let streak = 0;
    while (
      days[streak] ===
      new Date(startOfToday - streak * dayMs).toLocaleDateString("en-CA")
    )
      streak++;
    // Yesterday still counts: a streak that breaks at midnight would report
    // zero to anyone practising before their next session.
    if (!streak)
      while (
        days[streak] ===
        new Date(startOfToday - (streak + 1) * dayMs).toLocaleDateString(
          "en-CA",
        )
      )
        streak++;
    const medianCorrectMs = median(correct.map((a) => a.elapsedMs));
    return {
      graded: graded.length,
      correct: correct.length,
      accuracy: graded.length ? correct.length / graded.length : null,
      unassisted: correct.filter((a) => a.hintLevel === 0).length,
      challenges: byChallenge.size,
      firstTry,
      medianCorrectMs,
      days: days.length,
      streak,
    };
  });
  /** Per-skill accuracy. The skill id is the challenge id before its dot. */
  const recordBySkill = $derived.by(() => {
    const rows = new Map<string, { graded: number; correct: number }>();
    for (const attempt of attempts) {
      if (
        attempt.correctness !== "correct" &&
        attempt.correctness !== "incorrect"
      )
        continue;
      const skillId = attempt.challenge.challengeId.split(".")[0];
      const row = rows.get(skillId) ?? { graded: 0, correct: 0 };
      row.graded++;
      if (attempt.correctness === "correct") row.correct++;
      rows.set(skillId, row);
    }
    return [...rows.entries()]
      .map(([skillId, row]) => ({
        skillId,
        label: skills.find((skill) => skill.id === skillId)?.label ?? skillId,
        ...row,
      }))
      .sort((a, b) => b.graded - a.graded);
  });
  const title = $derived(
    view === "map"
      ? "Skill Map.dag"
      : view === "schema"
        ? "schema.ref"
        : view === "erd"
          ? "schema.dgm"
          : (activeDoc?.name ?? "SQL Grind"),
  );
  const judgeState = $derived(
    settings.hush ? "hushed" : running ? "reading your query" : "reading",
  );
  const remark = $derived(
    settings.hush
      ? "Hushed. I keep reading — diagnostics and grading continue without me saying so."
      : running
        ? "Running. I dislike waiting, so let us both be patient."
        : view === "map"
          ? "Reading the skill map. Choose a challenge and I will read its SQL."
          : view === "schema"
            ? "Reading the schema reference. Table shapes, not opinions."
            : view === "erd"
              ? "Reading the relationship diagram. Keys, not opinions."
              : currentFailure ||
                currentDiagnostics[0]?.message ||
                (solvedNow
                  ? "Solved. The result agreed with the contract on every dataset; that is the only proof I accept."
                  : completed
                    ? "You completed this challenge before. Submit this draft to check it."
                    : "I am reading your query. Correctness is what I check; style and speed are separate notes."),
  );
  // Celebration for the first skill only, to see how it feels.
  const CELEBRATED_SKILL = "basics";
  let celebration = $state<{
    challengeId: string;
    title: string;
    skillId: string;
  } | null>(null);
  let confettiRun = $state(0);
  let confettiOn = $state(false);
  $effect(() => {
    if (!confettiOn) return;
    const run = confettiRun;
    const timer = setTimeout(() => {
      if (run === confettiRun) confettiOn = false;
    }, 2600);
    return () => clearTimeout(timer);
  });
  const celebrationNextId = $derived(
    celebration
      ? (progression.skills[celebration.skillId]?.nextChallengeId ?? null)
      : null,
  );
  // "-" is a separator sentinel. Every other string is simultaneously the
  // display text, the command() key, the disabled() key and the shortcut key.
  const menuItems: Record<string, string[]> = {
    File: [
      "New Query",
      "Open",
      "-",
      "Save",
      "Save As",
      "Export SQL",
      "-",
      "Export Practice Backup",
      "Import Practice Backup",
      "-",
      "Close Document",
      "Close Window",
    ],
    Edit: [
      "Undo",
      "Redo",
      "-",
      "Cut",
      "Copy",
      "Paste",
      "Select All",
      "-",
      "Find",
      "Replace",
      "Go to Line",
      "-",
      "Format SQL",
    ],
    View: [
      "Object Explorer",
      "Patchouli",
      "Goal / Skill Details",
      "-",
      "Results",
      "Messages",
      "Execution Plan",
      "Patchouli’s Notes",
      "-",
      "Reading Layout",
      "Reset Layout",
    ],
    Query: [
      "Execute",
      "Parse",
      "Cancel",
      "-",
      "Show Plan",
      "Compare with Reference",
      "-",
      "Submit",
      "Hint",
      "-",
      "Query History",
      "Reset Challenge SQL",
    ],
    Skills: [
      "Skill Map",
      "Current Skill",
      "Open Next Challenge",
      "-",
      "Katas",
      "Practice Records",
    ],
    Tools: [
      "Settings",
      "Storage",
      "-",
      "Schema Reference",
      "Refresh Schema",
      "-",
      "Reset Index Lab Session",
    ],
    Window: [
      "Minimize Workbench",
      "Maximize / Restore Workbench",
      "Close Workbench",
      "-",
      "Show Desktop",
      "-",
      "Dock / Float Patchouli",
      "Move Patchouli",
      "Reset Patchouli Position and Size",
      "-",
      "Dock / Float Goal",
      "Move Goal",
      "-",
      "Close All Documents",
    ],
    Help: [
      "Keyboard Shortcuts",
      "Challenge Rules",
      "-",
      "DuckDB Docs",
      "Asset Credits",
      "-",
      "About",
    ],
  };
  const desktopIcons = [
    { name: "My Queries", icon: "folderDesktop" },
    { name: "DuckDB Docs", icon: "globeDesktop" },
    { name: "Schema Reference", icon: "documentDesktop" },
    { name: "Skill Map", icon: "map" },
    { name: "Katas", icon: "play" },
    { name: "Practice Records", icon: "trophy" },
    { name: "Recycle Bin", icon: "bin" },
  ];
  const BASE_OUTPUT_TABS = [
    "Results",
    "Messages",
    "Execution plan",
    "Patchouli’s notes",
  ];

  function stateLabel(state?: string) {
    return (
      {
        locked: "Locked",
        available: "Available",
        "in-progress": "In progress",
        completed: "Completed",
        "needs-review": "Needs review",
      } as Record<string, string>
    )[state ?? "locked"];
  }
  // "Complete the prerequisite skills" leaves the learner to work out which
  // ones. Name them wherever a lock is shown.
  function blockingSkills(skillId: string) {
    return (skills.find((entry) => entry.id === skillId)?.requires ?? [])
      .filter((id) => !progression.skills[id]?.completed)
      .map((id) => skills.find((entry) => entry.id === id)?.label ?? id);
  }
  function joinNames(names: string[]) {
    return names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : (names[0] ?? "");
  }
  function blockedByText(skillId: string) {
    const names = blockingSkills(skillId);
    return names.length ? `Locked by ${joinNames(names)}.` : "Locked.";
  }
  function earnedAhead(skillId: string) {
    return !!progression.skills[skillId]?.objectives.some(
      (objective) => objective.completed,
    );
  }
  // Practicing ahead grants access, never availability: a prerequisite is still
  // only ever satisfied by completing it. The choice is reversible until work
  // lands here. Dropping access afterwards would re-lock this skill's own
  // unfinished objectives and strand the passes beside them, and routing that
  // through openedSkillIds would report "Needs review" — a regression claim
  // about a learner who has regressed nothing.
  async function setPracticeAhead(skillId: string, ahead: boolean) {
    if (!skillId || progression.skills[skillId]?.available) return;
    const label =
      skills.find((entry) => entry.id === skillId)?.label ?? skillId;
    if (!ahead && earnedAhead(skillId)) {
      announce(
        `${label} stays open: you have completed challenges here, and they keep their place. It still does not complete its prerequisites.`,
      );
      return;
    }
    // Write first, then reflect: a failed write must not leave the learner
    // looking at a skill that reopens locked.
    try {
      await store?.setSkillExplored(skillId, ahead);
    } catch (e) {
      fail(e, "storage");
      return;
    }
    exploredSkillIds = ahead
      ? [...new Set([...exploredSkillIds, skillId])]
      : exploredSkillIds.filter((id) => id !== skillId);
    announce(
      ahead
        ? `Practicing ahead in ${label}. Its challenges are open now. Finishing them counts for good; they do not complete its prerequisites.`
        : `${label} is back on the recommended path.`,
    );
  }
  // Direction and significance must come from the same statistic. Testing
  // separation on the two medians while taking direction from the paired
  // ratio can print "0.950× — your SQL ran slower", which is the exact
  // contradiction this panel exists to avoid. Both read the ratio series.
  function comparisonVerdict(comparison: { ratio: number; ratioMad: number }) {
    if (Math.abs(comparison.ratio - 1) <= comparison.ratioMad)
      return "no measurable difference";
    return comparison.ratio < 1 ? "your SQL ran faster" : "your SQL ran slower";
  }
  const guidedSummary = $derived.by(() => {
    const output = result?.result;
    if (
      !output ||
      !resultBelongsHere ||
      result?.outcome !== "complete" ||
      !result.challenge ||
      summaries[result.challenge.challengeId]?.skillId !== "reconcile"
    )
      return null;
    const confidence = output.columns.findIndex(
      (column) => column.name === "confidence",
    );
    if (confidence < 0) return null;
    const counts: Record<string, number> = {
      high: 0,
      probable: 0,
      ambiguous: 0,
      missing: 0,
    };
    for (let index = 0; index < output.count; index++) {
      const value = output.getRow(index)[confidence];
      if (value && Object.hasOwn(counts, value)) counts[value]++;
    }
    return {
      counts,
      total: output.count,
      committed: counts.high + counts.probable,
    };
  });
  // A result only ever describes the document it ran for. Its revision may lag
  // — the stale notice says so — but another document's evidence never shows.
  const resultBelongsHere = $derived(
    !!result &&
      !!activeDoc &&
      result.documentId === activeDoc.id &&
      result.datasetId === activeDoc.datasetId &&
      sameIdentity(result.challenge, activeDoc.challenge),
  );
  // The same test for evidence that also exists on scratch documents, where
  // both identities are absent and sameIdentity is false by definition.
  const resultIsForActiveDocument = $derived(
    resultBelongsHere ||
      (!!result &&
        !!activeDoc &&
        !result.challenge &&
        !activeDoc.challenge &&
        result.documentId === activeDoc.id &&
        result.datasetId === activeDoc.datasetId),
  );
  // The Assessment tab exists only where the authored challenge has an
  // assessment panel. Empty panels are not created to justify a tab.
  const assessmentAvailable = $derived(
    !!challenge &&
      (challenge.assessment.kind === "plan-lab" ||
        challenge.assessment.kind === "reconciliation" ||
        (activeSummary?.skillId === "reconcile" &&
          challenge.output.columns.some(
            (column) => column.name === "confidence",
          ))),
  );
  const outputTabs = $derived(
    assessmentAvailable
      ? [...BASE_OUTPUT_TABS, "Assessment"]
      : BASE_OUTPUT_TABS,
  );
  $effect(() => {
    if (!outputTabs.includes(outputTab)) outputTab = "Results";
  });
  // The status square describes the displayed message's outcome, not merely
  // engine readiness: a rejected query leaves the engine ready.
  function announce(text: string, tone: StatusTone = "neutral") {
    status = text;
    statusTone = tone;
    messages = [
      ...messages.slice(-99),
      `${new Date().toLocaleTimeString()}  ${text}`,
    ];
  }
  function menuChecked(item: string): boolean | undefined {
    if (item === "Patchouli") return settings.judgeVisible;
    if (item === "Reading Layout") return settings.readingLayout;
    if (item === "Object Explorer") return showExplorer;
    if (item === "Goal / Skill Details") return showGoal;
    return undefined;
  }
  // The Window menu lists everything the tab strip can show, not only SQL
  // documents: the map, reference and diagram are views, not documents.
  type WindowEntry = { key: string; name: string; active: boolean };
  const windowEntries = $derived<WindowEntry[]>([
    ...openIds.map((id) => ({
      key: "doc:" + id,
      name: docs.find((d) => d.id === id)?.name ?? "",
      active: view === "sql" && activeId === id,
    })),
    ...(mapTabOpen
      ? [{ key: "view:map", name: "Skill Map.dag", active: view === "map" }]
      : []),
    ...(schemaTabOpen
      ? [{ key: "view:schema", name: "schema.ref", active: view === "schema" }]
      : []),
    ...(erdTabOpen
      ? [{ key: "view:erd", name: "schema.dgm", active: view === "erd" }]
      : []),
  ]);
  // One command key, two labels: the item reports the action it will perform.
  function menuLabel(item: string) {
    return item === "Maximize / Restore Workbench"
      ? maximized
        ? "Restore Workbench"
        : "Maximize Workbench"
      : item;
  }
  $effect(() => {
    const selected = menu;
    if (!selected) return;
    void tick().then(() => {
      if (menu !== selected) return;
      const anchor = document
        .getElementById("menu-" + selected)
        ?.getBoundingClientRect();
      const popup = document.querySelector<HTMLElement>(".menu-popup");
      if (!anchor || !popup) return;
      // The anchor rect is viewport px; menuPosition is consumed as pre-zoom
      // CSS px inside the zoomed body, so both bounds must be app px.
      const anchorLeft = anchor.left;
      const anchorBottom = anchor.bottom;
      // Height and scrolling come from .menu-popup's max-height rule, which is
      // already expressed in app px via --view-height.
      menuPosition = {
        left: Math.max(
          4,
          Math.min(anchorLeft, viewWidth() - popup.offsetWidth - 4),
        ),
        top: Math.max(
          4,
          Math.min(anchorBottom, viewHeight() - popup.offsetHeight - 36),
        ),
      };
    });
  });
  function fail(
    cause: unknown,
    source: "engine" | "storage" | "operation" = "operation",
  ) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (source !== "operation" || message !== error) errorSource = source;
    error = message;
    announce(error, "error");
  }
  function isDirty(doc: QueryDocument) {
    return committedRevisions[doc.id] !== doc.revision;
  }
  async function initializeStorage() {
    store?.close();
    store = await openPracticeStore(announce, () => {
      externalNotice = true;
    });
    await reloadProfile();
    storageReady = true;
    if (!docs.some((d) => d.id === activeId && !d.deletedAt))
      activeId = docs.find((d) => !d.deletedAt)?.id ?? "";
    if (activeId && !openIds.includes(activeId))
      openIds = [...openIds, activeId];
  }
  async function retryFailedOperation() {
    error = "";
    try {
      if (errorSource === "storage") {
        if (!storageReady) await initializeStorage();
        else await flush();
      }
      if (!catalog && storageReady) await loadContent();
      if (
        errorSource === "engine" ||
        engineState === "loading" ||
        engineState === "error"
      ) {
        await prepareDocument();
      }
      announce("Recovery complete. Your SQL is retained.");
    } catch (e) {
      fail(e, errorSource);
    }
  }
  async function openRecoveredCopy() {
    const entry = conflicts.entries().next().value;
    await Promise.allSettled([...saveChains.values()]);
    if (!entry) return;
    const [originalId, conflict] = entry;
    const current = docs.find((d) => d.id === originalId);
    try {
      const recovered = await store.saveDocument(
        {
          ...conflict.recoveredDocument,
          ...(current
            ? {
                sql: current.sql,
                revision: current.revision,
                selection: { ...current.selection },
                scrollTop: current.scrollTop,
              }
            : {}),
        },
        conflict.recoveredDocument.version,
      );
      conflicts.delete(originalId);
      failedDocuments.delete(originalId);
      recoveryAvailable = conflicts.size > 0;
      openIds = openIds.filter((id) => id !== originalId);
      await reloadProfile(true);
      await activate(recovered.id);
      await reloadProfile(true);
      error = "";
      externalNotice = false;
      announce(
        "Recovered copy opened with your latest SQL. The other tab’s saved query is unchanged.",
      );
    } catch (e) {
      fail(e, "storage");
    }
  }
  function freshDocument(
    sql: string,
    name: string,
    identity: ContentIdentity | null = null,
    datasetId = activeDoc?.datasetId ??
      catalog?.curriculum.datasets[0]?.id ??
      "",
    lab?: LabDocument,
  ): QueryDocument {
    return {
      id: crypto.randomUUID(),
      name,
      sql,
      challenge: identity,
      datasetId,
      ...(lab ? { lab } : {}),
      revision: 0,
      version: 0,
      selection: { anchor: 0, head: 0 },
      scrollTop: 0,
      updatedAt: Date.now(),
      saved: false,
    };
  }
  async function reloadProfile(preserveCurrent = false) {
    const profile = await store.load();
    const dirty = preserveCurrent
      ? docs.filter(
          (d) =>
            d.id === activeId ||
            saveTimers.has(d.id) ||
            saveChains.has(d.id) ||
            failedDocuments.has(d.id) ||
            conflicts.has(d.id),
        )
      : [];
    docs = [
      ...profile.documents.filter((d) => !dirty.some((x) => x.id === d.id)),
      ...dirty,
    ];
    for (const d of profile.documents)
      if (!dirty.some((x) => x.id === d.id)) {
        versions.set(d.id, d.version);
        committedRevisions[d.id] = d.revision;
      }
    attempts = profile.attempts;
    hintLevels = profile.hints;
    openedSkillIds = profile.session.openedSkillIds;
    exploredSkillIds = profile.session.exploredSkillIds ?? [];
    history = profile.session.history ?? [];
    kataProgress = profile.katas;
    if (!preserveCurrent) {
      settings = { ...defaultSettings, ...profile.settings };
      themeSetting = settings.theme ?? "system";
      showExplorer = settings.layout?.showExplorer ?? true;
      showGoal = settings.layout?.showGoal ?? true;
      goalCollapsed = settings.layout?.goalCollapsed ?? false;
      editorHeightChosen = settings.layout?.editorHeight !== undefined;
      editorHeight = settings.layout?.editorHeight ?? defaultEditorHeight();
      explorerWidth = settings.layout?.explorerWidth ?? 220;
      goalWidth = settings.layout?.goalWidth ?? 280;
      goalHeight = settings.layout?.goalHeight ?? 420;
      goalFloating = settings.layout?.goalFloating ?? false;
      selectedSkill = settings.layout?.selectedSkill ?? "basics";
      mapTabOpen = settings.layout?.mapTabOpen ?? true;
      schemaTabOpen = settings.layout?.schemaTabOpen ?? true;
      erdTabOpen = settings.layout?.erdTabOpen ?? false;
      judgeZoom = clampJudgeZoom(settings.layout?.judgeZoom ?? 1);
      const restoredX = settings.layout?.judgeX ?? null;
      const restoredY = settings.layout?.judgeY ?? null;
      judgeX =
        restoredX !== null && restoredX <= viewWidth() - 360 * judgeZoom
          ? restoredX
          : null;
      judgeY =
        restoredY !== null && restoredY <= viewHeight() - 210 * judgeZoom
          ? restoredY
          : null;
      const goalLeft = settings.layout?.goalX ?? null;
      const goalTop = settings.layout?.goalY ?? null;
      goalX =
        goalLeft !== null && goalLeft <= viewWidth() - goalWidth
          ? goalLeft
          : null;
      goalY =
        goalTop !== null && goalTop <= viewHeight() - 120 ? goalTop : null;
      openIds = profile.session.openIds.filter((id) =>
        docs.some((d) => d.id === id && !d.deletedAt),
      );
      activeId = profile.session.activeId;
    }
  }
  async function persistSession() {
    if (store) {
      try {
        await store.saveSession({
          openIds: [...openIds],
          activeId,
          openedSkillIds: [...openedSkillIds],
          exploredSkillIds: [...exploredSkillIds],
          // Ignored by the store, which owns the history; passed because the
          // Session contract is one record.
          history: $state.snapshot(history) as HistoryEntry[],
        });
      } catch (e) {
        fail(e, "storage");
      }
    }
  }
  async function recordHistory(sql: string, datasetId: string, kind: RunKind) {
    const text = sql.trim();
    if (!text || !store) return;
    try {
      // The store owns the cap, the per-entry byte bound and the repeat check,
      // so the list here is whatever was actually written.
      history = await store.appendHistory({
        sql: text,
        datasetId,
        ranAt: new Date().toISOString(),
        kind,
      });
    } catch (e) {
      // Recall is a convenience. A failed history write must never turn a
      // successful run into an error the learner has to deal with.
      messages = [
        ...messages.slice(-99),
        `Query history not recorded: ${e instanceof Error ? e.message : String(e)}`,
      ];
    }
  }
  async function persistDocument(document: QueryDocument) {
    const snapshot = structuredClone($state.snapshot(document));
    const previous = saveChains.get(document.id) ?? Promise.resolve();
    pendingWrites++;
    const next = previous
      .catch(() => {})
      .then(async () => {
        try {
          const conflict = conflicts.get(snapshot.id);
          if (conflict) throw conflict;
          const saved = await store.saveDocument(
            snapshot,
            versions.get(snapshot.id),
          );
          versions.set(saved.id, saved.version);
          committedRevisions[saved.id] = saved.revision;
          failedDocuments.delete(saved.id);
          docs = docs.map((d) =>
            d.id === saved.id
              ? { ...d, version: saved.version, updatedAt: saved.updatedAt }
              : d,
          );
        } catch (e) {
          failedDocuments.add(snapshot.id);
          if (e instanceof DocumentConflictError) {
            conflicts.set(snapshot.id, e);
            recoveryAvailable = true;
            clearTimeout(saveTimers.get(snapshot.id));
            saveTimers.delete(snapshot.id);
            externalNotice = true;
          }
          fail(e, "storage");
          throw e;
        }
      })
      .finally(() => {
        pendingWrites--;
        if (saveChains.get(document.id) === next)
          saveChains.delete(document.id);
      });
    saveChains.set(document.id, next);
    return next;
  }
  function scheduleSave(doc: QueryDocument) {
    if (conflicts.has(doc.id)) return;
    clearTimeout(saveTimers.get(doc.id));
    saveTimers.set(
      doc.id,
      setTimeout(() => {
        saveTimers.delete(doc.id);
        const current = docs.find((d) => d.id === doc.id);
        if (current) void persistDocument(current).catch(() => {});
      }, 450),
    );
  }
  async function flush() {
    if (conflicts.size) throw conflicts.values().next().value;
    for (const timer of saveTimers.values()) clearTimeout(timer);
    const ids = [...new Set([...saveTimers.keys(), ...failedDocuments])];
    saveTimers.clear();
    for (const id of ids) {
      const doc = docs.find((d) => d.id === id);
      if (doc) await persistDocument(doc);
    }
    await Promise.all([...saveChains.values()]);
    if (storageReady) {
      settings.layout = layoutSnapshot();
      await store.saveSettings($state.snapshot(settings));
    }
  }
  function changeDocument(
    sql: string,
    selection: { anchor: number; head: number },
    scrollTop: number,
  ) {
    if (!activeDoc) return;
    const changed = activeDoc.sql !== sql;
    const doc = {
      ...activeDoc,
      sql,
      selection,
      scrollTop,
      revision: activeDoc.revision + (changed ? 1 : 0),
    };
    docs = docs.map((d) => (d.id === doc.id ? doc : d));
    scheduleSave(doc);
    if (changed) {
      diagnostics = [];
      scheduleParse();
    }
  }
  // Formatting is an ordinary edit: it goes through changeDocument like Reset
  // Challenge SQL, so it bumps one revision, schedules one save, reparses, and
  // lands in the editor as a single undoable transaction. The caret is clamped
  // rather than carried: its old byte offset points at an unrelated token once
  // the text is reflowed.
  function formatSql() {
    if (!activeDoc) return;
    const source = activeDoc.sql;
    if (!source.trim()) {
      announce("Nothing to format: this document is empty.");
      return;
    }
    let formatted: string;
    try {
      formatted = formatDialect(source, {
        language: "duckdb",
        keywordCase: "upper",
        tabWidth: 2,
      });
    } catch (e) {
      // Unparseable SQL is the learner's normal working state. Refuse the
      // reflow and say so; never rewrite text the formatter did not understand.
      announce(
        `SQL could not be formatted: ${e instanceof Error ? e.message.split("\n")[0] : "unrecognised syntax"}. The text is unchanged.`,
      );
      return;
    }
    if (formatted === source) {
      announce("SQL is already formatted.");
      return;
    }
    const caret = Math.min(
      editor?.getSelection().anchor ?? 0,
      formatted.length,
    );
    changeDocument(formatted, { anchor: caret, head: caret }, 0);
    announce("SQL formatted. Undo restores the previous text.");
  }
  function scheduleParse() {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => void parseQuery(false), 400);
  }
  async function parseQuery(explicit = true) {
    if (
      !activeDoc ||
      !engine ||
      engineState === "loading" ||
      preparedDocumentId !== activeDoc.id ||
      contentError
    )
      return;
    if (explicit) {
      clearTimeout(parseTimer);
      outputTab = "Patchouli’s notes";
    }
    const doc = activeDoc;
    const sequence = ++parseSequence;
    try {
      const parsed = await engine.parse(doc.sql, doc.revision);
      if (
        sequence !== parseSequence ||
        activeDoc?.id !== doc.id ||
        activeDoc.revision !== doc.revision
      )
        return;
      diagnostics = parsed.diagnostics;
      parseInfo =
        parsed.valid === true
          ? "Syntax OK. Submit checks correctness."
          : parsed.valid === null
            ? (parsed.coverage ?? "Parser coverage unavailable.")
            : "Syntax error. See Patchouli’s notes.";
      if (explicit) {
        announce(parseInfo);
        outputTab = "Patchouli’s notes";
      }
    } catch (e) {
      if (sequence === parseSequence) {
        parseInfo = String(e);
        if (explicit) fail(e);
      }
    }
  }
  async function activate(id: string) {
    const sequence = ++navigationSequence;
    contentRetryChallengeId = null;
    if (activeId !== id && running && runningKind === "lab") engine.cancel();
    activeId = id;
    view = "sql";
    ideVisible = true;
    if (!openIds.includes(id)) openIds = [...openIds, id];
    diagnostics = [];
    await persistSession();
    if (sequence === navigationSequence && activeId === id)
      await prepareDocument();
  }
  async function addDocument(
    sql = "",
    name = "untitled.sql",
    identity: ContentIdentity | null = null,
    datasetId = activeDoc?.datasetId ??
      catalog?.curriculum.datasets[0]?.id ??
      "",
    lab?: LabDocument,
    isCurrent = () => true,
  ) {
    const doc = freshDocument(sql, name, identity, datasetId, lab);
    docs = [...docs, doc];
    await persistDocument(doc);
    if (isCurrent()) await activate(doc.id);
  }
  function starterLab(
    definition: ChallengeDefinition,
  ): LabDocument | undefined {
    const assessment = definition.assessment;
    if (assessment.kind !== "plan-lab") return;
    if (assessment.lab === "pushdown" || assessment.lab === "selectivity")
      return {
        kind: assessment.lab,
        secondarySql: assessment.secondaryStarterSql ?? "",
        report: {},
      };
    if (assessment.lab === "index")
      return {
        kind: "index",
        createSql:
          "CREATE INDEX customer_lookup ON lookup_orders(customer_id);",
        dropSql: "DROP INDEX customer_lookup;",
        report: {},
      };
    return { kind: assessment.lab, report: {} };
  }
  async function loadContent() {
    const sequence = ++contentLoadSequence;
    const navigation = ++navigationSequence;
    const retryId = contentRetryChallengeId;
    contentLoading = true;
    try {
      const next = await ChallengeCatalog.load();
      if (sequence !== contentLoadSequence) return;
      const entries = next.curriculum.skills.flatMap((skill) =>
        skill.definitions.map((summary) => ({
          ...summary,
          skillId: skill.id,
        })),
      );
      summaries = Object.fromEntries(
        entries.map((summary) => [summary.challengeId, summary]),
      );
      identities = Object.fromEntries(
        entries.map((summary) => [summary.challengeId, summary.identity]),
      );
      definitions = {};
      skills = next.skills();
      catalog = next;
      contentError = "";
      if (retryId && navigation === navigationSequence)
        await openChallenge(retryId);
      else if (!activeDoc) await openChallenge("basics.01");
      else await prepareDocument();
    } catch (cause) {
      if (sequence === contentLoadSequence) {
        contentError = cause instanceof Error ? cause.message : String(cause);
        preparedDocumentId = "";
      }
    } finally {
      if (sequence === contentLoadSequence) contentLoading = false;
    }
  }
  async function prepareDocument() {
    const doc = activeDoc;
    const snapshot = catalog;
    const sequence = ++navigationSequence;
    contentRetryChallengeId = null;
    preparedDocumentId = "";
    historicalNotice = "";
    baselineSql = "";
    if (!doc || !snapshot) return;
    const isCurrent = () =>
      sequence === navigationSequence &&
      snapshot === catalog &&
      activeId === doc.id;
    if (
      doc.challenge &&
      !sameIdentity(doc.challenge, identities[doc.challenge.challengeId])
    ) {
      historicalNotice =
        "Historical challenge content: this draft is retained but cannot earn current completion. Open a scratch copy to execute it, or open the current challenge from the map.";
    }
    if (
      !snapshot.curriculum.datasets.some(
        (dataset) => dataset.id === doc.datasetId,
      )
    ) {
      historicalNotice =
        "Historical dataset unavailable. Choose a current dataset and open this draft as scratch.";
      return;
    }
    const prepare = async () => {
      if (!isCurrent()) return;
      try {
        const content =
          doc.challenge &&
          sameIdentity(doc.challenge, identities[doc.challenge.challengeId])
            ? await snapshot.load(doc.challenge.challengeId)
            : undefined;
        if (!isCurrent()) return;
        if (content) {
          if (content.dataset.id !== doc.datasetId)
            throw new Error(
              "Content error: The draft dataset does not match its challenge.",
            );
          definitions = {
            ...definitions,
            [content.identity.challengeId]: content,
          };
        }
        const nextSchema = await engine.configure(snapshot, doc.datasetId);
        if (!isCurrent() || running) return;
        const nextObjects = await engine.inspectObjects("challenge");
        if (!isCurrent()) return;
        let baseline = "";
        const assessment = content?.definition.assessment;
        if (assessment?.kind === "plan-lab" && assessment.secondaryReference)
          baseline = await snapshot.assets.text(assessment.secondaryReference);
        if (!isCurrent()) return;
        schema = nextSchema;
        if (!nextSchema.some((table) => table.name === selectedObject))
          selectedObject = nextSchema[0]?.name ?? "";
        objects = nextObjects;
        domain = "challenge";
        baselineSql = baseline;
        preparedDocumentId = doc.id;
        if (content?.definition.assessment.kind === "plan-lab") {
          if (!activeDoc?.lab) {
            const lab = starterLab(content.definition);
            if (lab) updateLab(lab);
          }
          outputTab = "Assessment";
        }
        contentError = "";
        if (content) {
          const skillId = content.definition.skillId;
          if (
            progression.skills[skillId]?.available &&
            !openedSkillIds.includes(skillId)
          ) {
            await store.markSkillOpened(skillId);
            openedSkillIds = [...openedSkillIds, skillId];
            if (!isCurrent()) return;
          }
        }
        scheduleParse();
      } catch (cause) {
        if (isCurrent())
          contentError = cause instanceof Error ? cause.message : String(cause);
      }
    };
    configureChain = configureChain.then(prepare, prepare);
    await configureChain;
  }
  async function openChallenge(
    id = progression.skills[selectedSkill]?.nextChallengeId ??
      skill?.objectives[0]?.id ??
      "basics.01",
  ) {
    const snapshot = catalog;
    const summary = summaries[id];
    if (!snapshot || !summary) {
      contentError = `Content error: Unknown challenge ${id}.`;
      return;
    }
    if (!progression.skills[summary.skillId]?.accessible) {
      announce(
        `${blockedByText(summary.skillId)} Complete the prerequisites, or choose Practice ahead on this skill to open it now.`,
      );
      return;
    }
    const sequence = ++navigationSequence;
    const sourceDocumentId = activeId;
    const isCurrent = () =>
      sequence === navigationSequence &&
      snapshot === catalog &&
      activeId === sourceDocumentId;
    contentRetryChallengeId = null;
    retentionNotice = "";
    let content: LoadedChallenge;
    try {
      content = await snapshot.load(id);
      if (!isCurrent()) return;
      definitions = { ...definitions, [id]: content };
      contentError = "";
    } catch (cause) {
      if (isCurrent()) {
        contentRetryChallengeId = id;
        contentError = cause instanceof Error ? cause.message : String(cause);
      }
      return;
    }
    selectedSkill = summary.skillId;
    // Leaving a hard challenge should not feel like forfeiting it. Set the
    // guarantee before the navigation awaits: activate() and prepareDocument()
    // both advance navigationSequence, so a post-await staleness guard on it
    // can never be true. Said once per session: a learner browsing the map
    // does not need the same reassurance on every hop.
    const leaving = activeDoc?.challenge?.challengeId;
    if (
      leaving &&
      leaving !== id &&
      !toldRetention &&
      !progression.challenges[leaving]?.completed
    ) {
      toldRetention = true;
      retentionChallengeId = leaving;
      retentionNotice = `${summaries[leaving]?.displayNumber ?? leaving} is kept exactly as you left it — draft SQL and any revealed hints. Reopen it from the tab strip or the map whenever you want.`;
      announce(retentionNotice);
    }
    try {
      const doc = docs.find(
        (doc) =>
          !doc.deletedAt && sameIdentity(doc.challenge, content.identity),
      );
      if (doc) await activate(doc.id);
      else
        await addDocument(
          content.definition.starterSql,
          `${id}.sql`,
          content.identity,
          content.dataset.id,
          starterLab(content.definition),
          isCurrent,
        );
    } catch (cause) {
      fail(cause, "storage");
    }
  }
  function updateLab(lab: LabDocument) {
    if (!activeDoc) return;
    const doc = { ...activeDoc, lab, revision: activeDoc.revision + 1 };
    docs = docs.map((current) => (current.id === doc.id ? doc : current));
    scheduleSave(doc);
  }
  $effect(() => {
    const doc = activeDoc,
      content = activeContent,
      baseline = baselineSql;
    const evidence = doc ? labEvidence[doc.id] : undefined;
    evidenceCurrent = false;
    let cancelled = false;
    if (doc?.lab && content && evidence) {
      void evidenceMatches(
        {
          identity: content.identity,
          datasetId: doc.datasetId,
          previewVariant: content.dataset.previewVariant,
          gradingVariants: content.dataset.gradingVariants,
          sql: doc.sql,
          document: doc.lab,
          baselineSql: baseline,
        },
        evidence,
      )
        .then((matches) => {
          if (!cancelled) evidenceCurrent = matches;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  });
  function resetLab() {
    engine.cancel();
    if (activeDoc) {
      const next = { ...labEvidence };
      delete next[activeDoc.id];
      labEvidence = next;
    }
  }
  async function openHistoricalScratch(datasetId = activeDoc?.datasetId ?? "") {
    if (!activeDoc) return;
    await addDocument(
      activeDoc.sql,
      activeDoc.name.replace(/\.sql$/, "") + " historical scratch.sql",
      null,
      datasetId,
    );
    announce(
      "Historical SQL opened as scratch. It cannot award challenge completion.",
    );
  }
  async function save(as = false) {
    if (!activeDoc || !storageReady) return;
    let doc = activeDoc;
    if (as || !doc.saved) {
      const name = await promptText(
        as ? "Save a Copy As" : "Name This Query",
        "Query name",
        doc.name,
      );
      if (!name) return;
      if (as) {
        doc = {
          ...freshDocument(
            doc.sql,
            name,
            doc.challenge,
            doc.datasetId,
            doc.lab,
          ),
          selection: { ...doc.selection },
          saved: true,
        };
        docs = [...docs, doc];
      } else {
        doc = { ...doc, name, saved: true };
        docs = docs.map((d) => (d.id === doc.id ? doc : d));
      }
    }
    clearTimeout(saveTimers.get(doc.id));
    saveTimers.delete(doc.id);
    await persistDocument(doc);
    if (as) await activate(doc.id);
    announce(`Saved ${doc.name}, revision ${doc.revision}.`);
  }
  function download(
    name: string,
    text: string,
    type = "text/plain;charset=utf-8",
  ) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportBackup() {
    await flush();
    download(
      "sql-grind-practice.json",
      await store.exportBackup(),
      "application/json",
    );
    announce("Practice backup exported. Keep it outside this browser.");
  }
  async function upload(event: Event, kind: "sql" | "backup") {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error("Import exceeds the 10 MiB limit.");
      const text = await file.text();
      if (kind === "sql") {
        closeModal();
        await addDocument(text, file.name);
      } else if (
        await confirmAction(
          "Import Practice Backup",
          "Merge this backup with local practice data? Conflicting queries remain separate copies.",
        )
      ) {
        await flush();
        await store.importBackup(text);
        await reloadProfile(true);
        announce("Backup imported without replacing local queries.");
      }
    } catch (e) {
      fail(e);
    } finally {
      input.value = "";
    }
  }
  async function execute(kind: RunKind = "execute") {
    editor?.dismissCompletion();
    if (
      !activeDoc ||
      busy ||
      engineState === "loading" ||
      contentError ||
      preparedDocumentId !== activeDoc.id
    )
      return;
    if (activeDoc.challenge && !activeContent) return;
    if (kind === "submit" && !activeDoc.challenge) {
      announce(
        "Scratch queries do not award challenge completion. Open a challenge from the skill map.",
      );
      return;
    }
    if (kind === "compare" && !comparisonEligible) {
      announce(
        "Compare with Reference requires a correct submission of the current SQL. Submit your answer first.",
      );
      return;
    }
    if (
      kind === "compare" &&
      !(await confirmAction(
        "Compare with Reference",
        "Recheck your answer on every grading variant, then run nine paired comparisons on isolated snapshots? This does not save another submission. Timings exclude initialization; profiles use separate executions.",
      ))
    )
      return;
    const doc = structuredClone($state.snapshot(activeDoc));
    const id = crypto.randomUUID();
    const submittedHintLevel = hints;
    running = true;
    comparisonRunning = kind === "compare";
    runningKind = kind;
    error = "";
    outputTab =
      kind === "lab" ||
      (kind === "submit" && challenge?.assessment.kind !== "exact")
        ? "Assessment"
        : kind === "plan" || kind === "compare"
          ? "Execution plan"
          : "Results";
    announce(
      `${kind === "submit" ? "Submitting" : kind === "plan" ? "Planning" : kind === "compare" ? "Comparing" : "Executing"} revision ${doc.revision}…`,
      "working",
    );
    try {
      const run = await engine.run({
        id,
        documentId: doc.id,
        revision: doc.revision,
        sql: doc.sql,
        kind,
        domain,
        hintLevel: submittedHintLevel,
        challenge: doc.challenge,
        datasetId: doc.datasetId,
        lab: doc.lab,
        labEvidence: labEvidence[doc.id],
      });
      runs = { ...runs, [run.documentId]: { run, kind, sql: doc.sql } };
      void recordHistory(doc.sql, doc.datasetId, kind);
      if (
        run.outcome === "engine-error" &&
        run.message.includes("Content error:")
      ) {
        contentError = run.message;
        preparedDocumentId = "";
      }
      if (run.assessment?.kind === "plan-lab")
        labEvidence = { ...labEvidence, [doc.id]: run.assessment.evidence };
      const current =
        activeDoc?.id === doc.id && activeDoc?.revision === doc.revision;
      if (current && run.diagnostics.length)
        diagnostics = [
          ...diagnostics.filter(
            (d) => !run.diagnostics.some((n) => n.ruleId === d.ruleId),
          ),
          ...run.diagnostics,
        ];
      // This overrides the engine's own "ready" callback: the run outcome, not
      // engine readiness, is what the displayed message reports.
      announce(
        run.message +
          (!current ? " Output is stale: the active document changed." : ""),
        run.outcome !== "complete" || run.correctness === "incorrect"
          ? "error"
          : "success",
      );
      if (kind === "submit" && run.challenge) {
        const firstPass =
          !progression.challenges[run.challenge.challengeId]?.completed;
        const attempt: Attempt = {
          id,
          documentId: doc.id,
          revision: doc.revision,
          sql: doc.sql,
          challenge: run.challenge,
          datasetId: run.datasetId,
          assessment: run.assessment,
          createdAt: Date.now(),
          outcome: run.outcome,
          correctness: current ? run.correctness : "not-evaluated",
          hintLevel: submittedHintLevel,
          elapsedMs: run.elapsedMs,
          message:
            run.message +
            (!current ? " Stale submission; no completion awarded." : ""),
        };
        await store.recordAttempt(attempt);
        attempts = [...attempts, attempt];
        const summary = summaries[run.challenge.challengeId];
        if (
          firstPass &&
          current &&
          attempt.correctness === "correct" &&
          summary?.skillId === CELEBRATED_SKILL
        )
          celebrateChallenge(run.challenge.challengeId, summary.title);
      }
      if (run.outcome !== "complete") outputTab = "Messages";
      if (domain === "sandbox") objects = await engine.inspectObjects(domain);
    } catch (e) {
      fail(e);
      outputTab = "Messages";
    } finally {
      running = false;
      comparisonRunning = false;
      if (activeDoc?.id !== doc.id) await prepareDocument();
    }
  }
  function celebrateChallenge(challengeId: string, title: string) {
    const skillId = summaries[challengeId]?.skillId ?? CELEBRATED_SKILL;
    celebration = { challengeId, title, skillId };
    confettiRun++;
    confettiOn = true;
    showModal("celebrate", "Noted");
  }
  function diagnosticLines(diagnostic: Diagnostic): string {
    const sql = activeDoc?.sql ?? "";
    const lastOffset = Math.min(
      sql.length,
      Math.max(diagnostic.from, diagnostic.to - 1),
    );
    let first = 1;
    let last = 1;
    for (let index = 0; index < lastOffset; index++) {
      if (sql.charCodeAt(index) === 10) {
        if (index < diagnostic.from) first++;
        last++;
      }
    }
    return first === last ? `Ln ${first}` : `Ln ${first}–${last}`;
  }
  function selectDiagnostic(d: Diagnostic) {
    if (d.revision !== activeDoc?.revision) {
      announce("This diagnostic is stale. Parse the current SQL.");
      return;
    }
    view = "sql";
    void tick().then(() => editor?.selectRange(d.from, d.to));
  }
  /**
   * Describe where the engine assets are actually coming from. The dialog used
   * to claim "the local server serves matched data and engine assets from
   * disk", which is untrue on any static host, and it hardcoded "no service
   * worker" — a claim that stops being true the moment one is registered.
   */
  async function describeAssetCache(): Promise<string> {
    const parts: string[] = [];
    const controller = navigator.serviceWorker?.controller;
    if (!("caches" in window)) {
      parts.push("This browser exposes no Cache Storage.");
    } else {
      let bytes = 0,
        entries = 0;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          entries++;
          const response = await cache.match(request);
          const length = Number(response?.headers.get("content-length") ?? 0);
          bytes += Number.isFinite(length) ? length : 0;
        }
      }
      parts.push(
        entries
          ? `${formatCount(entries, "asset")} held in Cache Storage${bytes ? ` (${(bytes / 1048576).toFixed(1)} MiB reported)` : ""}.`
          : "No assets are held in Cache Storage.",
      );
    }
    parts.push(
      controller
        ? "A service worker is serving this page, so the engine survives an HTTP cache eviction."
        : "No service worker is serving this page; assets rely on the HTTP cache, which the browser may evict.",
    );
    return parts.join(" ");
  }
  async function refreshSchema() {
    try {
      schema = await engine.refreshSchema(domain);
      objects = await engine.inspectObjects(domain);
      announce("Schema refreshed from the current database.");
    } catch (e) {
      fail(e);
    }
  }
  async function changeDataset(datasetId: string) {
    if (!activeDoc || activeDoc.challenge || busy) return;
    const doc = { ...activeDoc, datasetId, revision: activeDoc.revision + 1 };
    docs = docs.map((current) => (current.id === doc.id ? doc : current));
    await persistDocument(doc);
    await prepareDocument();
    announce(`Using immutable dataset ${datasetId}. SQL is unchanged.`);
  }
  function showDiagram(name = "") {
    view = "erd";
    erdTabOpen = true;
    ideVisible = true;
    if (name) selectedObject = name;
  }
  // Notes render after the view switches, so the heading only exists one tick
  // plus one frame later. A stale callback must not scroll a newer request.
  function showSchema(name = "") {
    view = "schema";
    ideVisible = true;
    if (!name) return;
    selectedObject = name;
    const datasetId = activeDoc?.datasetId;
    void tick().then(() =>
      requestAnimationFrame(() => {
        if (
          view !== "schema" ||
          selectedObject !== name ||
          activeDoc?.datasetId !== datasetId
        )
          return;
        document
          .getElementById("schema-" + name)
          ?.scrollIntoView({ block: "start", behavior: "instant" });
      }),
    );
  }
  async function revealHint() {
    const identity = activeDoc?.challenge;
    const definition = challenge;
    const summary = activeSummary;
    if (!identity || !definition || !summary) return;
    try {
      const key = JSON.stringify([
        identity.challengeId,
        identity.bundleVersion,
      ]);
      const level = Math.min(3, (hintLevels[key] ?? 0) + 1);
      await store.revealHint(identity, level);
      hintLevels = { ...hintLevels, [key]: level };
      if (sameIdentity(activeDoc?.challenge, identity))
        showModal("hints", `${summary.displayNumber} — hints`);
    } catch (e) {
      fail(e, "storage");
    }
  }
  function dialogKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
      ),
    ).filter((item) => item.getClientRects().length);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey ? index <= 0 : index === items.length - 1 || index < 0) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]?.focus();
    }
  }
  function showModal(type: string, title: string) {
    if (!modal) {
      const active = document.activeElement as HTMLElement;
      modalReturn =
        active?.closest(".menu-wrap")?.querySelector<HTMLElement>("button") ??
        active;
    }
    modal = type;
    modalTitle = title;
    menu = "";
    startMenu = false;
  }
  function closeModal() {
    const old = modalReturn;
    modal = "";
    dialog?.close();
    if (confirmation) {
      confirmation(false);
      confirmation = null;
    }
    if (naming) {
      naming(null);
      naming = null;
    }
    void tick().then(() => {
      if (old?.isConnected && old !== document.body) old.focus();
      else document.getElementById("menu-" + focusedMenu)?.focus();
    });
  }
  function openKatas() {
    kataNow = Date.now();
    kataFeedback = "";
    kataOutcome = "";
    kataPatternId = "";
    kataVariationId = "";
    showModal("katas", "Katas — repetition drills");
  }
  /** The variation whose next repetition falls soonest, due or not. */
  function earliestScheduled(pattern: KataPattern) {
    return [...pattern.variations].sort(
      (a, b) =>
        (findKataRecord(kataProgress, pattern.patternId, a.variationId)
          ?.dueAt ?? 0) -
        (findKataRecord(kataProgress, pattern.patternId, b.variationId)
          ?.dueAt ?? 0),
    )[0];
  }
  function startKata(pattern: KataPattern) {
    kataNow = Date.now();
    // Due-ness is a recommendation, not a gate. Passing every drill in one
    // sitting would otherwise leave the surface empty until tomorrow, which
    // reads as broken; so when nothing is due, drill the one scheduled
    // soonest and say that recall is not being measured.
    const due = nextKataVariation(pattern, kataProgress, kataNow);
    const variation = due ?? earliestScheduled(pattern);
    if (!variation) return;
    kataPatternId = pattern.patternId;
    kataVariationId = variation.variationId;
    kataScheduled = !!due;
    kataSql = "";
    kataFeedback = due
      ? ""
      : "Nothing is due for this pattern. Practice as much as you like: an early pass is recorded but does not advance the streak or the schedule, because spacing is what a streak claims.";
    kataOutcome = "";
    kataElapsedMs = 0;
  }
  function closeKata() {
    kataPatternId = "";
    kataVariationId = "";
    kataFeedback = "";
    kataOutcome = "";
    kataNow = Date.now();
  }
  /**
   * Waits for the engine to stop holding an operation. engineState returning
   * to "ready" is the observable end of a prepare or metadata read; a bounded
   * wait keeps a stuck engine from hanging the drill surface silently.
   */
  async function settleEngine(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (
      Date.now() < deadline &&
      (contentLoading || !["ready", "error"].includes(engineState))
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  /**
   * Grades one drill. A kata never writes challenge progression: its only
   * persistent effect is its own repetition schedule, so a drill can neither
   * award nor revoke a completion.
   */
  async function checkKata() {
    const pattern = activeKataPattern,
      variation = activeKataVariation;
    if (
      !pattern ||
      !variation ||
      !catalog ||
      busy ||
      kataRunning ||
      !storageReady
    )
      return;
    if (!kataSql.trim()) {
      kataFeedback = "Write a query first.";
      kataOutcome = "";
      return;
    }
    kataRunning = true;
    kataFeedback = "";
    announce(`Checking ${pattern.title} drill…`, "working");
    // The engine is configured by the document-prepare path, for the active
    // document's dataset. When a drill names that same dataset — the common
    // case — reconfiguring would reset the ready state underneath an
    // in-flight prepare, whose metadata read then holds the engine and
    // refuses this run. So only configure when the selection is actually
    // wrong, and wait for the engine to go idle first.
    const documentDataset = activeDoc?.datasetId ?? "";
    const configured =
      !!preparedDocumentId && documentDataset === pattern.datasetId;
    try {
      if (!configured) {
        await settleEngine();
        await engine.configure(catalog, pattern.datasetId);
      }
      const run = await engine.run({
        id: crypto.randomUUID(),
        documentId: `kata:${pattern.patternId}/${variation.variationId}`,
        revision: 0,
        sql: kataSql,
        kind: "kata",
        domain: "challenge",
        hintLevel: 0,
        challenge: null,
        datasetId: pattern.datasetId,
        kata: {
          patternId: pattern.patternId,
          variationId: variation.variationId,
          variantId: variation.variantId,
          reference: variation.reference,
          output: variation.output,
        },
      });
      kataFeedback = run.message;
      if (run.outcome !== "complete") {
        kataOutcome = "";
        announce(run.message, "error");
        return;
      }
      const pass = run.correctness === "correct";
      kataOutcome = pass ? "pass" : "miss";
      kataElapsedMs = run.elapsedMs;
      kataProgress = await store.recordKata(
        pattern.patternId,
        variation.variationId,
        pass,
        run.elapsedMs,
        kataScheduled,
      );
      announce(run.message, pass ? "success" : "error");
    } catch (error) {
      kataOutcome = "";
      kataFeedback = String((error as Error).message ?? error);
      announce(kataFeedback, "error");
    } finally {
      kataRunning = false;
      // Only a reconfigure discarded the workbench's dataset selection, so
      // only then is there anything to hand back.
      if (!configured && documentDataset) await prepareDocument();
    }
  }
  function confirmAction(title: string, text: string): Promise<boolean> {
    modalText = text;
    showModal("confirm", title);
    return new Promise((resolve) => {
      confirmation = resolve;
    });
  }
  function promptText(
    title: string,
    label: string,
    value = "",
  ): Promise<string | null> {
    modalText = label;
    inputValue = value;
    showModal("prompt", title);
    return new Promise((resolve) => {
      naming = resolve;
    });
  }
  function acceptModal() {
    if (modal === "prompt") {
      const resolve = naming;
      naming = null;
      const value = inputValue.trim();
      if (!value) {
        naming = resolve;
        return;
      }
      closeModal();
      resolve?.(value);
    } else {
      const resolve = confirmation;
      confirmation = null;
      closeModal();
      resolve?.(true);
    }
  }
  $effect(() => {
    if (modal && dialog) {
      if (!dialog.open) dialog.showModal();
      void tick().then(() => {
        const target =
          modal === "prompt"
            ? dialog.querySelector<HTMLElement>("input")
            : dialog.querySelector<HTMLElement>(
                ".dialog-content button, .dialog-actions button",
              );
        target?.focus();
      });
    } else if (dialog?.open) dialog.close();
  });
  function layoutSnapshot() {
    return {
      showExplorer,
      showGoal,
      goalCollapsed,
      // Omitted until the learner actually moves the splitter. Storing the
      // derived default on first load would pin a pixel height forever, so a
      // later window resize would inherit the old window's proportions. The
      // key is absent, not undefined: the validator allow-list counts a
      // present key.
      ...(editorHeightChosen ? { editorHeight } : {}),
      explorerWidth,
      goalWidth,
      judgeX,
      judgeY,
      judgeZoom,
      goalFloating,
      goalHeight,
      goalX,
      goalY,
      selectedSkill,
      mapTabOpen,
      schemaTabOpen,
      erdTabOpen,
    };
  }
  async function updateSettings() {
    if (!storageReady) return;
    settings.theme = themeSetting;
    settings.layout = layoutSnapshot();
    pendingWrites++;
    try {
      await store.saveSettings($state.snapshot(settings));
    } catch (e) {
      fail(e, "storage");
    } finally {
      pendingWrites--;
    }
  }
  // The setting offers System, Light and Dark; the palette in app.css keys off
  // a single resolved attribute. Resolving here keeps one block of dark values
  // instead of duplicating all of them under a media query, and it means a
  // learner on a light system can still force dark.
  let themeSetting = $state<"system" | "light" | "dark">("system");
  const darkSystem = $state({ matches: false });
  onMount(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    darkSystem.matches = query.matches;
    const listener = (event: MediaQueryListEvent) => {
      darkSystem.matches = event.matches;
    };
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  });
  $effect(() => {
    const dark =
      themeSetting === "dark" ||
      (themeSetting === "system" && darkSystem.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  });
  $effect(() => {
    if (!storageReady) return;
    layoutSnapshot();
    layoutPending = true;
    const timer = setTimeout(() => {
      layoutPending = false;
      void updateSettings();
    }, 200);
    return () => {
      clearTimeout(timer);
      layoutPending = false;
    };
  });
  async function renameQuery(doc: QueryDocument) {
    const name = await promptText("Rename Query", "Query name", doc.name);
    if (name) {
      const next = { ...doc, name };
      docs = docs.map((d) => (d.id === doc.id ? next : d));
      await persistDocument(next);
    }
  }
  async function duplicateQuery(doc: QueryDocument) {
    const copy = {
      ...freshDocument(
        doc.sql,
        doc.name.replace(/\.sql$/i, "") + " copy.sql",
        doc.challenge,
        doc.datasetId,
        doc.lab,
      ),
      saved: true,
    };
    docs = [...docs, copy];
    await persistDocument(copy);
    announce("Query duplicated.");
    return copy.id;
  }
  async function deleteQuery(doc: QueryDocument) {
    await flush();
    await store.deleteDocument(doc.id);
    docs = docs.map((d) =>
      d.id === doc.id ? { ...d, deletedAt: Date.now() } : d,
    );
    openIds = openIds.filter((id) => id !== doc.id);
    dropRun(doc.id);
    if (activeId === doc.id) activeId = openIds[0] ?? "";
    await persistSession();
    await prepareDocument();
    announce("Query moved to Recycle Bin.");
  }
  async function restoreQuery(doc: QueryDocument) {
    let name = doc.name;
    if (docs.some((d) => !d.deletedAt && d.name === name)) {
      const renamed = await promptText(
        "Restore query",
        "This name is already in use. Choose a restored query name.",
        name.replace(/\.sql$/i, "") + " restored.sql",
      );
      if (!renamed) return;
      name = renamed;
    }
    await store.restoreDocument(doc.id);
    if (name !== doc.name) {
      const restored = (await store.load()).documents.find(
        (d) => d.id === doc.id,
      )!;
      await store.saveDocument({ ...restored, name }, restored.version);
    }
    await reloadProfile(true);
    announce("Query restored with its original identity.");
  }
  async function permanentlyDelete(doc: QueryDocument) {
    if (
      await confirmAction(
        "Delete permanently",
        `Delete ${doc.name} and its drafts? Attempt history keeps its SQL snapshots.`,
      )
    ) {
      await store.permanentlyDeleteDocument(doc.id);
      dropRun(doc.id);
      await reloadProfile(true);
      announce("Query permanently deleted.");
      showModal("bin", "Recycle Bin");
    }
  }
  async function openHistory(entry: HistoryEntry, index: number) {
    closeModal();
    // The recorded dataset may have been retired between sessions; fall back
    // rather than opening a document bound to a dataset that cannot load.
    const datasetId = catalog?.curriculum.datasets.some(
      (dataset) => dataset.id === entry.datasetId,
    )
      ? entry.datasetId
      : (catalog?.curriculum.datasets[0]?.id ?? "");
    await addDocument(entry.sql, `history_${index + 1}.sql`, null, datasetId);
    await tick();
    editor?.focus();
    announce("History SQL opened as a new query. Run it when you are ready.");
  }
  async function clearHistory() {
    if (
      await confirmAction(
        "Clear query history",
        `Forget the last ${formatCount(history.length, "statement")} in the query history? Saved queries, attempts, and progress are unaffected.`,
      )
    ) {
      try {
        await store?.clearHistory();
      } catch (e) {
        fail(e, "storage");
        return;
      }
      history = [];
      announce("Query history cleared.");
    }
  }
  async function openAttempt(attempt: Attempt) {
    closeModal();
    const current = sameIdentity(
      attempt.challenge,
      identities[attempt.challenge.challengeId],
    );
    const datasetId = catalog?.curriculum.datasets.some(
      (dataset) => dataset.id === attempt.datasetId,
    )
      ? attempt.datasetId
      : (catalog?.curriculum.datasets[0]?.id ?? "");
    await addDocument(
      attempt.sql,
      `attempt_${attempt.id.slice(0, 8)}${current ? "" : "_historical_scratch"}.sql`,
      current ? attempt.challenge : null,
      datasetId,
      current && attempt.assessment?.kind === "plan-lab"
        ? attempt.assessment.report
        : undefined,
    );
    if (current && attempt.assessment?.kind === "plan-lab" && activeDoc)
      labEvidence = {
        ...labEvidence,
        [activeDoc.id]: attempt.assessment.evidence,
      };
    if (!current)
      historicalNotice =
        "Historical attempt opened as scratch. Its original identity remains in practice records; this copy cannot award completion.";
    if (!current)
      announce(
        "Historical attempt opened as scratch. Its original identity remains in practice records; this copy cannot award completion.",
      );
  }
  async function closeDocument(id = activeId) {
    await flush();
    const index = openIds.indexOf(id);
    openIds = openIds.filter((openId) => openId !== id);
    dropRun(id);
    if (activeId === id)
      activeId = openIds[Math.min(index, openIds.length - 1)] ?? "";
    await persistSession();
    await prepareDocument();
    announce("Document closed. Its saved draft remains in My Queries.");
  }
  function closeTab(event: MouseEvent, id: string) {
    if (event.button !== 1) return;
    event.preventDefault();
    if (id === "map" || id === "schema" || id === "erd") {
      if (id === "map") mapTabOpen = false;
      else if (id === "schema") schemaTabOpen = false;
      else erdTabOpen = false;
      if (view === id) view = "sql";
    } else void closeDocument(id).catch((error) => fail(error, "storage"));
  }
  async function closeWindow() {
    try {
      await flush();
      ideVisible = false;
      void tick().then(() => document.getElementById("app-task")?.focus());
    } catch {
      if (
        await confirmAction(
          "Save failed",
          "Keep the IDE open to export your SQL. Discard unsaved changes and close the IDE anyway?",
        )
      )
        ideVisible = false;
    }
  }
  function showDesktop() {
    if (!desktopShown) {
      savedVisibility = { ide: ideVisible, judge: settings.judgeVisible };
      ideVisible = false;
      settings.judgeVisible = false;
    } else {
      ideVisible = savedVisibility.ide;
      settings.judgeVisible = savedVisibility.judge;
    }
    desktopShown = !desktopShown;
  }
  async function toggleJudge() {
    settings.judgeVisible = !settings.judgeVisible;
    if (settings.judgeVisible && settings.judgeDocked) showGoal = true;
    await updateSettings();
  }
  async function dockJudge() {
    settings.judgeDocked = !settings.judgeDocked;
    settings.judgeVisible = true;
    // The docked judge rides in the goal panel, wherever that panel lives.
    showGoal = true;
    await tick();
    document.getElementById("judge-heading")?.focus();
    await updateSettings();
  }
  async function floatGoal(float: boolean) {
    goalFloating = float;
    showGoal = true;
    goalMenu = false;
    await tick();
    document.getElementById("goal-heading")?.focus();
  }
  function dragPointer(
    event: PointerEvent,
    move: (event: PointerEvent) => void,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    document.body.classList.add("pointer-dragging");
    window.getSelection()?.removeAllRanges();
    handle.setPointerCapture(pointerId);
    const update = (next: PointerEvent) => {
      if (next.pointerId === pointerId) move(next);
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", update);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
      document.body.classList.remove("pointer-dragging");
    };
    handle.addEventListener("pointermove", update);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
  }
  // Floating windows share one movement model. Positions are stored in layout
  // (pre-zoom) pixels; pointer and rect values are viewport pixels.
  const floating = {
    judge: {
      id: "judge-window",
      heading: "judge-heading",
      get x() {
        return judgeX;
      },
      get y() {
        return judgeY;
      },
      set(x: number | null, y: number | null) {
        judgeX = x;
        judgeY = y;
      },
      size: () => ({ width: 360 * judgeZoom, height: 210 * judgeZoom }),
    },
    goal: {
      id: "goal-window",
      heading: "goal-heading",
      get x() {
        return goalX;
      },
      get y() {
        return goalY;
      },
      set(x: number | null, y: number | null) {
        goalX = x;
        goalY = y;
      },
      size: () => ({ width: goalWidth, height: goalHeight }),
    },
  } as const;
  function clampWindow(
    x: number,
    y: number,
    size: { width: number; height: number },
  ) {
    return {
      x: Math.max(0, Math.min(viewWidth() - size.width, x)),
      y: Math.max(0, Math.min(viewHeight() - size.height - 32, y)),
    };
  }
  function moveWindow(event: PointerEvent, target: keyof typeof floating) {
    if ((event.target as HTMLElement).closest("button") || readingLayout)
      return;
    const element = document.getElementById(floating[target].id);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const size = {
      width: rect.width,
      height: rect.height,
    };
    const dx = event.clientX - rect.left,
      dy = event.clientY - rect.top;
    dragPointer(event, (next) => {
      const at = clampWindow(next.clientX - dx, next.clientY - dy, size);
      floating[target].set(at.x, at.y);
    });
  }
  function resizeSidebar(event: PointerEvent, side: "explorer" | "goal") {
    const start = event.clientX;
    const width = side === "explorer" ? explorerWidth : goalWidth;
    dragPointer(event, (next) => {
      const value = Math.max(
        180,
        Math.min(
          480,
          width + (next.clientX - start) * (side === "explorer" ? 1 : -1),
        ),
      );
      if (side === "explorer") explorerWidth = value;
      else goalWidth = value;
    });
  }
  function movementKey(event: KeyboardEvent) {
    if (!moving) return;
    const target = floating[moving];
    if (event.key === "Escape") {
      target.set(movementStart.x, movementStart.y);
      moving = "";
      event.preventDefault();
    } else if (event.key === "Enter") {
      moving = "";
      event.preventDefault();
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const at = clampWindow(
        (target.x ?? 0) +
          (event.key === "ArrowRight"
            ? 10
            : event.key === "ArrowLeft"
              ? -10
              : 0),
        (target.y ?? 0) +
          (event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0),
        target.size(),
      );
      target.set(at.x, at.y);
    }
  }
  async function startMoving(target: keyof typeof floating) {
    await tick();
    const rect = document
      .getElementById(floating[target].id)
      ?.getBoundingClientRect();
    if (!rect) return;
    floating[target].set(rect.left, rect.top);
    movementStart = { x: rect.left, y: rect.top };
    moving = target;
    document.getElementById(floating[target].heading)?.focus();
  }
  function resizeGoal(event: PointerEvent) {
    event.preventDefault();
    const element = document.getElementById("goal-window");
    if (!element) return;
    const rect = element.getBoundingClientRect();
    // Anchor the top-left corner so the window grows toward the pointer.
    goalX = rect.left;
    goalY = rect.top;
    const startX = event.clientX,
      startY = event.clientY,
      width = goalWidth,
      height = goalHeight;
    dragPointer(event, (next) => {
      goalWidth = Math.max(180, Math.min(480, width + next.clientX - startX));
      goalHeight = Math.max(
        160,
        Math.min(1200, height + next.clientY - startY),
      );
    });
  }
  function resizeGoalKey(event: KeyboardEvent) {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      goalWidth = Math.max(
        180,
        Math.min(480, goalWidth + (event.key === "ArrowRight" ? 10 : -10)),
      );
    else
      goalHeight = Math.max(
        160,
        Math.min(1200, goalHeight + (event.key === "ArrowDown" ? 10 : -10)),
      );
  }
  function resizeJudge(event: PointerEvent) {
    const element = document.getElementById("judge-window");
    if (!element) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const startZoom = judgeZoom;
    const startOffset = Math.max(1, event.clientX - rect.left);
    // Keep the top-left corner fixed while resizing from the bottom-right.
    judgeX = rect.left;
    judgeY = rect.top;
    dragPointer(event, (next) => {
      judgeZoom = clampJudgeZoom(
        (startZoom * (next.clientX - rect.left)) / startOffset,
      );
    });
  }
  function resizeJudgeKey(event: KeyboardEvent) {
    const step =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? 0.1
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? -0.1
          : 0;
    if (!step) return;
    event.preventDefault();
    judgeZoom = clampJudgeZoom(judgeZoom + step);
  }
  function resizeEditor(event: PointerEvent) {
    event.preventDefault();
    editorHeightChosen = true;
    const start = event.clientY,
      height = editorHeight;
    const move = (e: PointerEvent) => {
      editorHeight = Math.max(120, Math.min(650, height + e.clientY - start));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function splitterKey(e: KeyboardEvent) {
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      editorHeightChosen = true;
      editorHeight =
        e.key === "Home"
          ? 120
          : e.key === "End"
            ? 650
            : Math.max(
                120,
                Math.min(
                  650,
                  editorHeight +
                    (e.key === "ArrowDown" ? 1 : -1) * (e.shiftKey ? 50 : 10),
                ),
              );
    }
  }
  function contextAction(
    label: string,
    action: () => void | Promise<void>,
    unavailable = false,
    separatorBefore = false,
  ): ContextMenuItem {
    return {
      label,
      disabled: unavailable,
      separatorBefore,
      action: () => {
        void Promise.resolve()
          .then(action)
          .catch((error) => fail(error));
      },
    };
  }
  function contextCommand(
    name: string,
    separatorBefore = false,
  ): ContextMenuItem {
    return contextAction(
      name,
      () => command(name),
      disabled(name),
      separatorBefore,
    );
  }
  async function tableQuery(table: SchemaTable, run: boolean) {
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const sql = `SELECT\n  ${table.columns.map((column) => quote(column.name)).join(",\n  ")}\nFROM ${quote(table.name)}\nLIMIT 1000;`;
    await addDocument(sql, `${table.name}_top1000.sql`);
    await tick();
    editor?.focus();
    if (run) await execute();
  }
  // Sorting and filtering are taught, not simulated: the grid keeps showing
  // exactly what the engine returned, and the request becomes readable SQL in
  // a new document. The source is the text that produced those rows, not the
  // editor's current text, so an edited-but-unrun document cannot silently
  // change what is being wrapped.
  async function deriveQuery(
    derivation:
      | { kind: "sort"; column: string; descending: boolean }
      | { kind: "filter"; column: string; value: string | null },
  ) {
    const source = activeSlot?.sql.trim().replace(/;\s*$/, "");
    if (!source) return;
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const column = quote(derivation.column);
    const clause =
      derivation.kind === "sort"
        ? `ORDER BY ${column}${derivation.descending ? " DESC" : ""}`
        : derivation.value === null
          ? `WHERE ${column} IS NULL`
          : `WHERE ${column} = '${derivation.value.replaceAll("'", "''")}'`;
    const sql = `SELECT *\nFROM (\n${source
      .split("\n")
      .map((line) => (line.trim() ? `  ${line}` : line))
      .join("\n")}\n) AS source\n${clause};`;
    const name =
      derivation.kind === "sort"
        ? `sort_${derivation.column}${derivation.descending ? "_desc" : "_asc"}.sql`
        : `filter_${derivation.column}.sql`;
    // The run's dataset, not the document's current one: switching datasets
    // after a run must not point the derived query at data it never described.
    await addDocument(sql, name, null, activeSlot?.run.datasetId);
    await tick();
    editor?.focus();
    announce(
      derivation.kind === "sort"
        ? `Sorted query written to ${name}. Run it to see the ordered rows.`
        : `Filtered query written to ${name}. Run it to see the matching rows.`,
    );
  }
  function contextRequest(event: MouseEvent | KeyboardEvent): boolean {
    if (modal || event.defaultPrevented || !(event.target instanceof Element))
      return false;
    const target = event.target.closest<HTMLElement>("[data-context]");
    if (!target) return false;
    if (
      target.dataset.context === "editor" &&
      event.target.closest("input, textarea")
    )
      return false;
    let items: ContextMenuItem[];
    let label: string;
    switch (target.dataset.context) {
      case "table": {
        const table = schema.find(
          (table) => table.name === target.dataset.table,
        );
        if (!table) return false;
        selectedObject = table.name;
        label = `${table.name} table`;
        items = [
          contextAction(
            "Select Top 1000 Rows",
            () => tableQuery(table, true),
            busy || !storageReady || engineState !== "ready",
          ),
          contextAction(
            "Script SELECT to New Query",
            () => tableQuery(table, false),
            !storageReady,
          ),
          contextAction(
            "View Schema",
            () => showSchema(table.name),
            false,
            true,
          ),
          contextAction("View Diagram", () => showDiagram(table.name)),
          contextAction("Copy Table Name", async () => {
            await navigator.clipboard.writeText(table.name);
            announce(`Copied table name: ${table.name}.`);
          }),
          contextAction("Refresh", refreshSchema, busy),
        ];
        break;
      }
      case "editor":
        label = "SQL editor";
        items = [
          contextCommand("Execute"),
          contextCommand("Parse"),
          contextCommand("Show Plan"),
          contextCommand("Undo", true),
          contextCommand("Redo"),
          contextCommand("Cut", true),
          contextCommand("Copy"),
          contextCommand("Paste"),
          contextCommand("Select All"),
          contextCommand("Find", true),
          contextCommand("Save", true),
        ];
        break;
      case "query-tab": {
        const doc = docs.find((doc) => doc.id === target.dataset.documentId);
        if (!doc) return false;
        label = `${doc.name} tab`;
        items = [
          contextAction(
            "Save",
            async () => {
              await activate(doc.id);
              await save();
            },
            !storageReady,
          ),
          contextAction(
            "Save As",
            async () => {
              await activate(doc.id);
              await save(true);
            },
            !storageReady,
          ),
          contextAction("Rename", () => renameQuery(doc), !storageReady),
          contextAction(
            "Duplicate",
            async () => {
              await activate(await duplicateQuery(doc));
            },
            !storageReady,
          ),
          contextAction(
            "Close",
            async () => {
              await closeDocument(doc.id);
              await tick();
              document
                .querySelector<HTMLElement>(
                  '#document-tabs [aria-selected="true"]',
                )
                ?.focus();
            },
            !storageReady,
            true,
          ),
        ];
        break;
      }
      case "view-tab": {
        const tab = target.dataset.view;
        label =
          tab === "map"
            ? "Skill Map tab"
            : tab === "schema"
              ? "Schema tab"
              : "Diagram tab";
        items = [
          contextAction("Close", () => {
            if (tab === "map") mapTabOpen = false;
            else if (tab === "schema") schemaTabOpen = false;
            else erdTabOpen = false;
            if (view === tab) view = "sql";
            void tick().then(() =>
              document
                .querySelector<HTMLElement>(
                  '#document-tabs [aria-selected="true"]',
                )
                ?.focus(),
            );
          }),
        ];
        break;
      }
      case "skill": {
        const node = skills.find((entry) => entry.id === target.dataset.skill);
        if (!node) return false;
        const state = progression.skills[node.id];
        selectedSkill = node.id;
        label = `${node.label} skill`;
        items = [
          contextAction(
            "Open Next Challenge",
            () =>
              openChallenge(
                state?.nextChallengeId ?? node.objectives[0]?.challengeId,
              ),
            !state?.accessible || !storageReady,
          ),
          contextAction(
            "Practice Ahead",
            () => setPracticeAhead(node.id, true),
            !!state?.available || !!state?.ahead,
          ),
          contextAction(
            "Return to the Recommended Path",
            () => setPracticeAhead(node.id, false),
            !state?.ahead || earnedAhead(node.id),
          ),
        ];
        break;
      }
      case "schema":
        label = "Database schema";
        items = [
          contextAction("New Query", () => command("New Query"), !storageReady),
          contextAction(
            "Refresh",
            refreshSchema,
            busy || engineState === "loading",
          ),
          contextAction("View Schema", () => showSchema()),
          contextAction("View Diagram", () => showDiagram()),
        ];
        break;
      case "database":
        label = "SQL engine";
        items = [
          contextAction("Open Workbench", () => {
            ideVisible = true;
            desktopShown = false;
          }),
          contextAction("New Query", () => command("New Query"), !storageReady),
          contextAction(
            "Refresh Schema",
            refreshSchema,
            busy || engineState === "loading",
          ),
          contextCommand("Cancel"),
          contextAction("Close Workbench", closeWindow, !storageReady, true),
        ];
        break;
      case "judge":
        label = "Patchouli";
        items = [
          contextAction(
            settings.judgeVisible ? "Hide Patchouli" : "Show Patchouli",
            async () => {
              await command("Patchouli");
              if (settings.judgeVisible && settings.judgeDocked)
                ideVisible = true;
            },
            !storageReady,
          ),
          contextAction(
            settings.hush ? "Resume Commentary" : "Hush Commentary",
            async () => {
              settings.hush = !settings.hush;
              await updateSettings();
            },
            !storageReady,
          ),
          contextAction(
            settings.judgeDocked ? "Float Patchouli" : "Dock Patchouli",
            async () => {
              if (!settings.judgeDocked) ideVisible = true;
              await command("Dock / Float Patchouli");
            },
            !storageReady,
            true,
          ),
          contextAction(
            "Move Patchouli",
            () => command("Move Patchouli"),
            !storageReady,
          ),
          contextAction(
            "Reset Patchouli Position and Size",
            () => command("Reset Patchouli Position and Size"),
            !storageReady,
          ),
          contextAction(
            "Show Diagnostics",
            () => command("Patchouli’s Notes"),
            !activeDoc,
            true,
          ),
        ];
        break;
      default:
        return false;
    }
    event.preventDefault();
    menu = "";
    startMenu = false;
    explorerMenu = false;
    goalMenu = false;
    const rect = target.getBoundingClientRect();
    const pointer =
      event instanceof MouseEvent &&
      (event.clientX !== 0 || event.clientY !== 0);
    const returnFocus =
      target.dataset.context === "editor"
        ? (target.querySelector<HTMLElement>(".cm-content") ?? target)
        : target;
    contextMenu = {
      items,
      label,
      returnFocus,
      x: pointer ? event.clientX : rect.left,
      y: pointer ? event.clientY : rect.bottom,
    };
    return true;
  }
  function disabled(command: string) {
    if (command === "Reset Challenge SQL")
      return !challenge || busy || !storageReady;
    if (command === "Parse")
      return (
        !activeDoc ||
        view !== "sql" ||
        !storageReady ||
        !!contentError ||
        preparedDocumentId !== activeDoc.id ||
        engineState === "loading"
      );
    if (command === "Compare with Reference" && !comparisonEligible)
      return true;
    if (
      ["Execute", "Show Plan", "Compare with Reference", "Submit"].includes(
        command,
      )
    )
      return (
        busy ||
        !!contentError ||
        preparedDocumentId !== activeDoc?.id ||
        (!!activeDoc?.challenge && !activeContent) ||
        !activeDoc ||
        view !== "sql" ||
        engineState === "loading" ||
        (command === "Submit" &&
          (!activeContent ||
            domain === "sandbox" ||
            (!!activeDoc.lab && !evidenceCurrent)))
      );
    if (command === "Cancel") return !busy || engineState === "cancelling";
    if (command === "Hint") return !storageReady || !challenge;
    if (command === "Query History") return !storageReady;
    if (command === "Close All Documents")
      return !storageReady || !openIds.length;
    if (
      [
        "Save",
        "Save As",
        "Export SQL",
        "Close Document",
        "Reset Challenge SQL",
        ...menuItems.Edit,
      ].includes(command)
    )
      return !activeDoc || view !== "sql" || !storageReady;
    return false;
  }
  async function command(name: string) {
    menu = "";
    startMenu = false;
    explorerMenu = false;
    goalMenu = false;
    // The completion popup belongs to the editor's caret. Any menu or toolbar
    // verb moves attention elsewhere, so it must not stay on screen.
    editor?.dismissCompletion();
    if (disabled(name)) return;
    if (name.startsWith("doc:")) {
      await activate(name.slice(4));
      return;
    }
    if (name === "view:map") {
      view = "map";
      return;
    }
    if (name === "view:schema") {
      showSchema();
      return;
    }
    if (name === "view:erd") {
      showDiagram();
      return;
    }
    try {
      switch (name) {
        case "New Query":
          await addDocument();
          break;
        case "Open":
          showModal("open", "Open SQL");
          break;
        case "My Queries":
          querySearch = "";
          showModal("library", "My Queries");
          break;
        case "Save":
          await save();
          break;
        case "Save As":
          await save(true);
          break;
        case "Export SQL":
          if (activeDoc) download(activeDoc.name, activeDoc.sql);
          break;
        case "Export Practice Backup":
          await exportBackup();
          break;
        case "Import Practice Backup":
          importBackupInput.click();
          break;
        case "Close Document":
          await closeDocument();
          break;
        case "Close Window":
        case "Close Workbench":
          await closeWindow();
          break;
        case "Execute":
          await execute();
          break;
        case "Submit":
          await execute("submit");
          break;
        case "Show Plan":
          await execute("plan");
          break;
        case "Compare with Reference":
          await execute("compare");
          break;
        case "Parse":
          await parseQuery();
          break;
        case "Cancel":
          engine.cancel();
          announce("Cancelling the active run…");
          break;
        case "Reset Challenge SQL":
          if (
            await confirmAction(
              "Reset Challenge SQL",
              "Replace this document with the authored starter? Saved attempts and progress remain unchanged.",
            )
          )
            if (challenge) {
              changeDocument(challenge.starterSql, { anchor: 0, head: 0 }, 0);
              const lab = starterLab(challenge);
              if (lab) updateLab(lab);
              resetLab();
            }
          break;
        case "Format SQL":
          formatSql();
          break;
        case "Query History":
          showModal("history", "Query History");
          break;
        case "Object Explorer":
          showExplorer = !showExplorer;
          break;
        case "Goal / Skill Details":
          showGoal = !showGoal;
          break;
        case "Patchouli":
          await toggleJudge();
          break;
        case "Reading Layout":
          settings.readingLayout = !settings.readingLayout;
          await updateSettings();
          break;
        case "Reset Layout":
          showExplorer = true;
          showGoal = true;
          goalCollapsed = false;
          goalFloating = false;
          goalHeight = 420;
          goalX = null;
          goalY = null;
          maximized = false;
          editorHeight = defaultEditorHeight();
          // Back to derived: Reset Layout gives up the stored pixel height too.
          editorHeightChosen = false;
          explorerWidth = 220;
          goalWidth = 280;
          ideX = 0;
          ideY = 0;
          judgeX = null;
          judgeY = null;
          judgeZoom = 1;
          settings.readingLayout = false;
          await updateSettings();
          break;
        case "Results":
        case "Messages":
          view = "sql";
          outputTab = name;
          break;
        case "Execution Plan":
          view = "sql";
          outputTab = "Execution plan";
          break;
        case "Patchouli’s Notes":
          view = "sql";
          ideVisible = true;
          outputTab = "Patchouli’s notes";
          await tick();
          (
            document.querySelector<HTMLElement>(
              ".diagnostic-list .diagnostic",
            ) ??
            document.querySelector<HTMLElement>(".diagnostic-list .parser-info")
          )?.focus();
          break;
        case "Skill Map":
          view = "map";
          ideVisible = true;
          break;
        case "Current Skill":
          selectedSkill =
            summaries[activeDoc?.challenge?.challengeId ?? ""]?.skillId ??
            selectedSkill;
          view = "map";
          break;
        case "Open Next Challenge":
          await openChallenge();
          break;
        case "Practice Records":
          showModal("records", "Practice Records — this device");
          break;
        case "Katas":
          openKatas();
          break;
        case "Hint":
          if (completed || hints === 3)
            showModal("hints", `${activeSummary?.displayNumber} — hints`);
          else await revealHint();
          break;
        case "Close All Documents":
          for (const id of [...openIds]) await closeDocument(id);
          break;
        case "Recycle Bin":
          showModal("bin", "Recycle Bin");
          break;
        case "Schema Reference":
          showSchema();
          break;
        case "Refresh Schema":
          await refreshSchema();
          break;
        case "Reset Index Lab Session":
          if (
            await confirmAction(
              "Reset Index Lab Session",
              "End the disposable index lab session? Saved SQL and progress remain unchanged.",
            )
          ) {
            engine.cancel();
            await engine.resetSandbox();
            clearSandboxRuns();
            await refreshSchema();
            announce(
              "Index lab session reset. Saved SQL and progress are unchanged.",
            );
          }
          break;
        case "Settings":
          showModal("settings", "Settings");
          break;
        case "Storage": {
          const estimate = await navigator.storage?.estimate();
          storageInfo = estimate
            ? `${((estimate.usage ?? 0) / 1048576).toFixed(2)} MiB used of ${((estimate.quota ?? 0) / 1048576).toFixed(0)} MiB estimated quota.`
            : "Storage estimates unavailable.";
          // Report what is actually here rather than asserting a deployment.
          // The previous copy claimed a local server serves the assets, which
          // is false on a static host.
          cacheInfo = await describeAssetCache();
          showModal("storage", "Local Storage");
          break;
        }
        case "Minimize Workbench":
          ideVisible = false;
          await tick();
          document.getElementById("app-task")?.focus();
          break;
        case "Maximize / Restore Workbench":
          maximized = !maximized;
          break;
        case "Show Desktop":
          showDesktop();
          break;
        case "Dock / Float Patchouli":
          await dockJudge();
          break;
        case "Reset Patchouli Position and Size":
          judgeX = null;
          judgeY = null;
          judgeZoom = 1;
          break;
        case "Move Patchouli":
          settings.judgeDocked = false;
          settings.judgeVisible = true;
          await startMoving("judge");
          break;
        case "Dock / Float Goal":
          await floatGoal(!goalFloating);
          break;
        case "Move Goal":
          showGoal = true;
          goalFloating = true;
          await startMoving("goal");
          break;
        case "DuckDB Docs":
          window.open(
            "https://duckdb.org/docs/",
            "_blank",
            "noopener,noreferrer",
          );
          break;
        case "Keyboard Shortcuts":
          showModal("shortcuts", "Keyboard Shortcuts");
          break;
        case "Challenge Rules":
          showModal(
            "rules",
            activeSummary
              ? `${activeSummary.displayNumber} — Rules`
              : "Scratch query rules",
          );
          break;
        case "Asset Credits":
          {
            // A 404 body would otherwise be shown as the attribution text.
            const response = await fetch(assetUrl("/icon-credits.txt"), {
              credentials: "same-origin",
              redirect: "error",
            });
            credits = response.ok
              ? await response.text()
              : `Asset credits are unavailable: HTTP ${response.status}. Fugue Icons © 2013 Yusuke Kamiyamane, licensed under Creative Commons Attribution 3.0.`;
          }
          showModal("credits", "Asset Credits");
          break;
        case "About":
          showModal("about", "About SQL Grind");
          break;
        default:
          if (editorCommands[name]) {
            editor?.command(editorCommands[name]);
            break;
          }
      }
    } catch (e) {
      fail(e);
    }
  }
  function menuKey(e: KeyboardEvent, label: string) {
    const labels = Object.keys(menuItems);
    const index = labels.indexOf(label);
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? labels.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + labels.length) %
              labels.length;
      document.getElementById("menu-" + labels[next])?.focus();
      if (menu) menu = labels[next];
    } else if (["ArrowDown", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      menu = label;
      void tick().then(() =>
        document
          .querySelector<HTMLElement>(".menu-popup button:not(:disabled)")
          ?.focus(),
      );
    } else if (e.key === "Escape") menu = "";
  }
  function popupKey(e: KeyboardEvent) {
    const items = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      items[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
      ]?.focus();
    } else if (e.key === "Escape") {
      const label = menu;
      menu = "";
      document.getElementById("menu-" + label)?.focus();
    } else if (e.key.length === 1) {
      items
        .find(
          (item, i) =>
            i > index &&
            item.textContent?.toLowerCase().startsWith(e.key.toLowerCase()),
        )
        ?.focus();
    }
  }
  function tabKey(e: KeyboardEvent) {
    const buttons = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
        "[role=tab]",
      ),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next =
        buttons[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                buttons.length
        ];
      next?.focus();
      next?.click();
    }
  }
  function treeKey(e: KeyboardEvent) {
    const items = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        "[role=treeitem]",
      ),
    );
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[role=treeitem]",
    );
    const index = items.indexOf(target!);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      items[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : Math.max(
                0,
                Math.min(
                  items.length - 1,
                  index + (e.key === "ArrowDown" ? 1 : -1),
                ),
              )
      ]?.focus();
    } else if (e.key === "ArrowRight" && target) {
      e.preventDefault();
      if (target.getAttribute("aria-expanded") === "false") target.click();
      else items[index + 1]?.focus();
    } else if (e.key === "ArrowLeft" && target) {
      e.preventDefault();
      if (target.getAttribute("aria-expanded") === "true") target.click();
      else {
        const level = Number(target.getAttribute("aria-level") ?? 1);
        items
          .slice(0, index)
          .reverse()
          .find((x) => Number(x.getAttribute("aria-level") ?? 1) < level)
          ?.focus();
      }
    }
  }
  function globalKey(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (
      (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) &&
      contextRequest(e)
    )
      return;
    if (modal) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
      return;
    }
    if (moving) {
      movementKey(e);
      return;
    }
    // Title mnemonics only: every menu title has a unique first letter, while
    // item first letters collide (Save/Save As, Results/Reset Layout).
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !modal &&
      ideVisible &&
      (e.key.length === 1 || /^Key[A-Z]$/.test(e.code))
    ) {
      // Either source alone is insufficient: Option+F on macOS reports
      // e.key "ƒ", while e.code names a QWERTY position that is not the
      // labelled letter on AZERTY or Dvorak.
      const target = Object.keys(menuItems).find(
        (label) =>
          label[0].toLowerCase() === e.key.toLowerCase() ||
          "Key" + label[0].toUpperCase() === e.code,
      );
      if (target) {
        e.preventDefault();
        menu = menu === target ? "" : target;
        focusedMenu = target;
        if (menu)
          void tick().then(() =>
            document
              .querySelector<HTMLElement>(".menu-popup button:not(:disabled)")
              ?.focus(),
          );
        return;
      }
    }
    if (e.key === "Escape" && !modal) {
      menu = "";
      startMenu = false;
      explorerMenu = false;
      goalMenu = false;
    }
    if (e.key === "F6" && !modal) {
      e.preventDefault();
      const regions = Array.from(
        document.querySelectorAll<HTMLElement>("[data-region]"),
      ).filter((n) => n.getClientRects().length);
      const current = regions.findIndex((n) =>
        n.contains(document.activeElement),
      );
      regions[
        (current + (e.shiftKey ? -1 : 1) + regions.length) % regions.length
      ]?.focus();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "s" &&
      !modal &&
      ideVisible &&
      !e.defaultPrevented &&
      document.querySelector(".ide")?.contains(document.activeElement)
    ) {
      e.preventDefault();
      void command(e.shiftKey ? "Save As" : "Save");
    }
    // Ctrl+F alone belongs to the editor's find panel; the Shift variant does
    // not match that binding, so it reaches here unclaimed.
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      e.key.toLowerCase() === "f" &&
      !modal &&
      ideVisible &&
      !e.defaultPrevented &&
      document.querySelector(".ide")?.contains(document.activeElement)
    ) {
      e.preventDefault();
      void command("Format SQL");
    }
    // The rest of the practice loop. These keys are unclaimed by the editor
    // keymap, so they arrive here whether or not the caret is in the SQL. The
    // same command() path the menus use enforces eligibility, so a disabled
    // command stays disabled from the keyboard.
    if (
      !modal &&
      ideVisible &&
      !e.defaultPrevented &&
      document.querySelector(".ide")?.contains(document.activeElement)
    ) {
      const loop =
        e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.shiftKey
          ? "Submit"
          : e.key === "F7"
            ? "Parse"
            : e.key === "F8"
              ? "Open Next Challenge"
              : e.key.toLowerCase() === "h" &&
                  (e.ctrlKey || e.metaKey) &&
                  e.shiftKey
                ? "Hint"
                : "";
      if (loop && !disabled(loop)) {
        e.preventDefault();
        void command(loop);
      }
    }
  }
  function moveIde(event: PointerEvent) {
    if (
      maximized ||
      readingLayout ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    const rect = (
      event.currentTarget as HTMLElement
    ).parentElement!.getBoundingClientRect();
    const left = rect.left,
      top = rect.top,
      width = rect.width;
    const startX = event.clientX,
      startY = event.clientY;
    const offsetX = ideX,
      offsetY = ideY;
    dragPointer(event, (next) => {
      const x = Math.max(
        80 - width,
        Math.min(viewWidth() - 80, left + next.clientX - startX),
      );
      const y = Math.max(
        0,
        Math.min(viewHeight() - 58, top + next.clientY - startY),
      );
      ideX = offsetX + x - left;
      ideY = offsetY + y - top;
    });
  }
  function beforeUnload(e: BeforeUnloadEvent) {
    if (
      pendingWrites ||
      saveTimers.size ||
      failedDocuments.size ||
      conflicts.size ||
      layoutPending
    ) {
      e.preventDefault();
    }
  }
  onMount(() => {
    const closeChromeMenus = () => {
      menu = "";
      startMenu = false;
      explorerMenu = false;
      goalMenu = false;
    };
    window.addEventListener("sql-grind-context-menu-open", closeChromeMenus);
    const narrow = window.matchMedia(NARROW_QUERY);
    const narrowChanged = () => (narrowViewport = narrow.matches);
    narrowChanged();
    narrow.addEventListener("change", narrowChanged);
    let disposed = false;
    const timer = setInterval(() => (clock = new Date()), 1000);
    engine = new EngineCoordinator((state, message) => {
      if (!disposed) {
        engineState = state;
        if (message) {
          status = message;
          statusTone =
            state === "error"
              ? "error"
              : state === "ready"
                ? "neutral"
                : "working";
        }
      }
    });
    void (async () => {
      try {
        await initializeStorage();
      } catch (e) {
        fail(e, "storage");
        return;
      }
      await loadContent();
    })();
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener(
        "sql-grind-context-menu-open",
        closeChromeMenus,
      );
      narrow.removeEventListener("change", narrowChanged);
      clearTimeout(parseTimer);
      for (const timer of saveTimers.values()) clearTimeout(timer);
      engine.dispose();
      store?.close();
    };
  });
</script>

<svelte:window
  onkeydown={globalKey}
  oncontextmenu={contextRequest}
  onbeforeunload={beforeUnload}
/>
<input
  class="file-input"
  type="file"
  accept=".sql,text/plain"
  aria-label="Import SQL file"
  bind:this={importSqlInput}
  onchange={(e) => upload(e, "sql")}
/>
<input
  class="file-input"
  type="file"
  accept=".json,application/json"
  aria-label="Import practice backup file"
  bind:this={importBackupInput}
  onchange={(e) => upload(e, "backup")}
/>
<a
  class="skip-link"
  href="#editor-region"
  onclick={() => {
    view = "sql";
    void tick().then(() => editor?.focus());
  }}>Skip to SQL editor</a
>
<a class="skip-link" href="#output-region">Skip to output</a>
<div class:reading={readingLayout} class="desktop">
  <nav class="desktop-icons" aria-label="Desktop shortcuts">
    {#each desktopIcons as item}<button
        class="desktop-icon"
        onclick={() => command(item.name)}
        aria-label={item.name === "DuckDB Docs"
          ? "DuckDB Docs — opens in a new tab"
          : item.name}
        title={item.name}
        ><span class="desktop-glyph"><img src={icons[item.icon]} alt="" /></span
        ><span>{item.name}</span></button
      >{/each}
  </nav>
  {#if ideVisible}
    <main
      class:maximized
      class:popup-open={!!menu || explorerMenu || goalMenu}
      class="ide window"
      aria-label="SQL Grind workbench"
      style:left={!maximized && !readingLayout ? `${ideX}px` : undefined}
      style:top={!maximized && !readingLayout ? `${ideY}px` : undefined}
    >
      <header
        class="titlebar ide-title"
        role="presentation"
        onpointerdown={moveIde}
        ondblclick={(event) => {
          if (!(event.target as HTMLElement).closest("button"))
            void command("Maximize / Restore Workbench");
        }}
      >
        <div class="window-title">
          <img src={icons.database} alt="" /> SQL Grind - {title}{activeDoc &&
          isDirty(activeDoc) &&
          view === "sql"
            ? " *"
            : ""} - {activeDoc?.datasetId ?? "SQL Grind"} (duckdb, in-browser)
        </div>
        <div class="window-controls">
          <button
            aria-label="Minimize Workbench"
            onclick={() => command("Minimize Workbench")}>_</button
          ><button
            aria-label="Maximize or restore Workbench"
            onclick={() => command("Maximize / Restore Workbench")}
            aria-pressed={maximized}
            ><span
              class="maximize-glyph"
              class:restore-glyph={maximized}
              aria-hidden="true"
            ></span></button
          ><button
            aria-label="Close Workbench"
            onclick={() => command("Close Workbench")}>×</button
          >
        </div>
      </header>
      <div class="menubar" aria-label="Application menus" role="menubar">
        {#each Object.keys(menuItems) as label}<div class="menu-wrap">
            <button
              id={"menu-" + label}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={menu === label}
              tabindex={focusedMenu === label ? 0 : -1}
              onfocus={() => (focusedMenu = label)}
              class:menu-active={menu === label}
              onclick={() => (menu = menu === label ? "" : label)}
              onkeydown={(e) => menuKey(e, label)}
              ><u>{label[0]}</u>{label.slice(1)}</button
            >{#if menu === label}<div
                class="menu-popup"
                style:left={menuPosition.left + "px"}
                style:top={menuPosition.top + "px"}
                role="menu"
                tabindex="-1"
                aria-label={label}
                onkeydown={popupKey}
              >
                {#each menuItems[label] as item}{#if item === "-"}<div
                      class="menu-separator"
                      role="separator"
                    ></div>{:else}<button
                      role={menuChecked(item) === undefined
                        ? "menuitem"
                        : "menuitemcheckbox"}
                      aria-checked={menuChecked(item)}
                      disabled={disabled(item)}
                      onclick={() => command(item)}
                      title={item === "Compare with Reference" &&
                      !comparisonEligible
                        ? "Submit a correct answer for the current SQL first."
                        : shortcutHints[item]}
                      >{menuLabel(item)}{#if shortcutHints[item]}<span
                          class="menu-shortcut"
                          aria-hidden="true">{shortcutHints[item]}</span
                        >{/if}{#if menuChecked(item) !== undefined}<span
                          class="menu-check"
                          aria-hidden="true"
                          >{menuChecked(item) ? "✓" : ""}</span
                        >{/if}</button
                    >{/if}{/each}{#if label === "Window" && windowEntries.length}
                  <div class="menu-separator" role="separator"></div>
                  {#each windowEntries as entry, index}<button
                      role="menuitemradio"
                      aria-checked={entry.active}
                      onclick={() => command(entry.key)}
                      >{#if index < 9}{index + 1}&nbsp;{/if}{entry.name}<span
                        class="menu-check"
                        aria-hidden="true">{entry.active ? "•" : ""}</span
                      ></button
                    >{/each}
                {/if}
              </div>{/if}
          </div>{/each}
      </div>
      <div class="toolbar" role="toolbar" aria-label="Query actions">
        <span class="gripper" aria-hidden="true"></span>
        {#each [{ label: "New Query", icon: "document" }, { label: "Open", icon: "folder" }, { label: "Save", icon: "save" }] as item}<button
            disabled={disabled(item.label)}
            onclick={() => command(item.label)}
            ><img src={icons[item.icon]} alt="" />{item.label}</button
          >{/each}
        <span class="separator"></span>
        <button
          class="execute"
          aria-label="Execute"
          aria-keyshortcuts="F5 Control+Enter Meta+Enter"
          disabled={disabled("Execute")}
          onclick={() => command("Execute")}
          ><img src={icons.play} alt="" /><b>Execute</b
          >{#if running && runningKind === "execute"}<span
              class="spinner"
              aria-hidden="true"
            ></span>{:else}<span class="shortcut" aria-hidden="true">F5</span
            >{/if}</button
        >
        <button disabled={disabled("Parse")} onclick={() => command("Parse")}
          ><img src={icons.check} alt="" />Parse</button
        >
        <button disabled={disabled("Cancel")} onclick={() => command("Cancel")}
          ><img src={icons.stop} alt="" />Cancel</button
        >
        <span class="separator"></span>
        <select
          aria-label="Database"
          class="dataset-select"
          value={activeDoc?.datasetId ?? ""}
          onchange={(event) => changeDataset(event.currentTarget.value)}
          disabled={busy || !!activeDoc?.challenge || !activeDoc}
          title={activeDoc?.challenge
            ? "A challenge grades against its own dataset, so this stays fixed. Open a scratch query to choose one."
            : !activeDoc
              ? "Open a query to choose a dataset."
              : busy
                ? "Wait for the running query to finish."
                : "Every dataset is an immutable snapshot."}
          >{#each catalog?.curriculum.datasets ?? [] as dataset}<option
              value={dataset.id}>{dataset.id}</option
            >{/each}</select
        >
        <button
          disabled={disabled("Show Plan")}
          onclick={() => command("Show Plan")}
          ><img src={icons.plan} alt="" />Show Plan</button
        >
        <button
          aria-pressed={settings.judgeVisible}
          class:pressed={settings.judgeVisible}
          onclick={() => command("Patchouli")}
          ><span class="judge-dot"></span>Patchouli</button
        >
        <span class="skill-tag"
          >{#if view === "map"}<b
              >{formatProgress(
                Object.values(progression.skills).filter(
                  (skill) => skill.completed,
                ).length,
                skills.length,
                "skill",
              )}</b
            >{:else}<b
              >{challenge
                ? `${skills.find((skill) => skill.id === challenge.skillId)?.label ?? challenge.skillId} · ${formatProgress(
                    progression.skills[challenge.skillId].objectives.reduce(
                      (count, objective) => count + Number(objective.completed),
                      0,
                    ),
                    progression.skills[challenge.skillId].objectives.length,
                    "challenge",
                    "badge",
                  )}${progression.skills[challenge.skillId].ahead ? " · ahead" : ""}`
                : "Scratch · no completion credit"}</b
            >{/if}</span
        >
      </div>
      {#if comparisonRunning}<section
          class="comparison-progress"
          aria-label="Compare with Reference progress"
        >
          <strong>Compare with Reference</strong>
          <progress
            max="9"
            value={comparisonStep || undefined}
            aria-label="Comparison pairs"
          ></progress>
          <span role="status">{status}</span>
          <button onclick={() => engine.cancel()}>Cancel comparison</button>
        </section>{/if}
      {#if contentError}<div class="error-banner" role="alert">
          <strong>Content unavailable</strong><span
            >{contentError} Your drafts are retained.</span
          >
          <button
            disabled={contentLoading || running}
            onclick={() => loadContent()}>Retry content</button
          >
          <button disabled={!activeDoc} onclick={() => command("Export SQL")}
            >Export SQL</button
          >
        </div>{/if}
      {#if historicalNotice}<div class="notice" role="status">
          {historicalNotice}
          <label
            >Scratch dataset <select
              aria-label="Historical scratch dataset"
              onchange={(event) =>
                openHistoricalScratch(event.currentTarget.value)}
            >
              <option value="" disabled selected>Choose a dataset</option>
              {#each catalog?.curriculum.datasets ?? [] as dataset}<option
                  value={dataset.id}>{dataset.id}</option
                >{/each}
            </select></label
          >
        </div>{/if}
      {#if retentionNotice && retentionChallengeId !== activeDoc?.challenge?.challengeId}<div
          class="notice"
          role="status"
        >
          {retentionNotice}
          <button onclick={() => (retentionNotice = "")}>Dismiss</button>
        </div>{/if}
      {#if error}<div class="error-banner" role="alert">
          <span>{error}</span>
          {#if errorSource !== "operation"}<button
              disabled={busy || recoveryAvailable}
              onclick={retryFailedOperation}
              >{errorSource === "storage"
                ? "Retry save / storage"
                : "Retry engine"}</button
            >{/if}
          <button onclick={() => command("Export SQL")}>Export SQL</button>
          <button aria-label="Dismiss error" onclick={() => (error = "")}
            >×</button
          >
        </div>{/if}
      {#if externalNotice || recoveryAvailable}<div class="notice">
          {#if recoveryAvailable}<button onclick={openRecoveredCopy}
              >Open recovered copy</button
            >{/if}
          Practice data changed or conflicted in another tab. Your editor is not
          overwritten.<button
            onclick={async () => {
              await flush().catch(() => {});
              await reloadProfile(true);
              externalNotice = false;
            }}>Refresh library</button
          ><button onclick={() => command("Export SQL")}>Export this SQL</button
          >
        </div>{/if}
      <div
        class="work-area"
        style:grid-template-columns={(showExplorer
          ? `${explorerWidth}px 7px `
          : "") +
          "minmax(340px, 1fr)" +
          (showGoal && !effectiveGoalFloating ? ` 7px ${goalWidth}px` : "")}
      >
        {#if showExplorer}<aside
            class="explorer panel"
            aria-label="Object Explorer"
            data-region
            tabindex="-1"
          >
            <div class="panel-heading">
              <b>Object Explorer</b>
              <div class="heading-actions">
                <button
                  aria-label="Object Explorer actions"
                  onclick={() => (explorerMenu = !explorerMenu)}>▾</button
                ><button
                  aria-label="Hide Object Explorer"
                  onclick={() => {
                    showExplorer = false;
                    void tick().then(() =>
                      document.getElementById("document-tabs")?.focus(),
                    );
                  }}>×</button
                >
              </div>
              {#if explorerMenu}<div class="panel-menu">
                  {#each ["Show all", "Collapse all", "Refresh", "Hide panel"] as action}<button
                      onclick={() => {
                        explorerMenu = false;
                        if (action === "Refresh") void refreshSchema();
                        else if (action === "Hide panel") showExplorer = false;
                        else
                          expanded = Object.fromEntries(
                            Object.keys(expanded).map((k) => [
                              k,
                              action === "Show all",
                            ]),
                          );
                      }}>{action}</button
                    >{/each}
                </div>{/if}
            </div>
            <div class="mini-toolbar">
              <button
                aria-label="Refresh schema"
                title="Refresh schema"
                onclick={() => refreshSchema()}
                ><img src={icons.refresh} alt="" /></button
              ><button
                aria-label="Open selected schema details"
                title="Open schema details"
                onclick={() => showSchema(selectedObject)}
                ><img src={icons.document} alt="" /></button
              ><button
                aria-label="Filter objects"
                title="Filter objects"
                aria-pressed={filterVisible}
                onclick={() => (filterVisible = !filterVisible)}>▽</button
              ><span class="dataset-label"
                >{activeContent?.dataset.previewVariant ??
                  activeDoc?.datasetId}</span
              >
            </div>
            {#if filterVisible}<div class="filter">
                <input
                  aria-label="Filter database objects"
                  placeholder="Filter tables…"
                  bind:value={objectFilter}
                /><button onclick={() => (objectFilter = "")}>Clear</button
                ><span
                  >{formatCount(visibleTables.length, "match", "matches")}</span
                >
              </div>{/if}
            <div
              class="tree inset"
              role="tree"
              tabindex="-1"
              aria-label="Database objects"
              onkeydown={treeKey}
            >
              <button
                class="tree-row"
                role="treeitem"
                data-context="schema"
                aria-selected="false"
                aria-level="1"
                aria-expanded={expanded.database}
                onclick={() => (expanded.database = !expanded.database)}
                ><span class="tree-toggle" aria-hidden="true"
                  >{expanded.database ? "−" : "+"}</span
                ><img src={icons.database} alt="" /><b
                  >{activeDoc?.datasetId ?? "No dataset"}</b
                ></button
              >
              {#if expanded.database}<button
                  class="tree-row level2"
                  role="treeitem"
                  aria-selected="false"
                  aria-level="2"
                  aria-expanded={expanded.tables}
                  onclick={() => (expanded.tables = !expanded.tables)}
                  ><span class="tree-toggle" aria-hidden="true"
                    >{expanded.tables ? "−" : "+"}</span
                  ><img src={icons.folder} alt="" />Tables</button
                >
                {#if expanded.tables}{#each visibleTables as table}{@const tableKey = `table:${table.name}`}<button
                      class:selected={selectedObject === table.name}
                      class="tree-row level3"
                      role="treeitem"
                      data-context="table"
                      data-table={table.name}
                      aria-level="3"
                      aria-selected={selectedObject === table.name}
                      aria-expanded={!!expanded[tableKey]}
                      onclick={() => {
                        selectedObject = table.name;
                        expanded[tableKey] = !expanded[tableKey];
                      }}
                      ondblclick={() => showSchema(table.name)}
                      onkeydown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          showSchema(table.name);
                        }
                      }}
                      ><span class="tree-toggle" aria-hidden="true"
                        >{expanded[tableKey] ? "−" : "+"}</span
                      ><img src={icons.table} alt="" />{table.name}<span
                        class="count">({table.count.toLocaleString()})</span
                      ></button
                    >{#if expanded[tableKey]}{#each tableGroups(table) as group}<button
                          class="tree-row level4"
                          role="treeitem"
                          aria-selected="false"
                          aria-level="4"
                          aria-expanded={!!expanded[group.key]}
                          onclick={() =>
                            (expanded[group.key] = !expanded[group.key])}
                          ><span class="tree-toggle" aria-hidden="true"
                            >{expanded[group.key] ? "−" : "+"}</span
                          ><img src={icons.folder} alt="" />{group.name}</button
                        >{#if expanded[group.key]}{#each group.items as item}<button
                              class="tree-row level5"
                              role="treeitem"
                              aria-selected="false"
                              aria-level="5"
                              onclick={() => (selectedObject = table.name)}
                              ondblclick={() => showSchema(table.name)}
                              onkeydown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  showSchema(table.name);
                                }
                              }}>{item}</button
                            >{:else}<span class="tree-empty">No objects</span
                            >{/each}{/if}{/each}{/if}{/each}{#if schema.length === 0}<span
                      class="tree-empty"
                      >{engineState === "error"
                        ? "Schema unavailable"
                        : "Loading schema…"}</span
                    >{/if}{/if}
                {#each ["views", "macros", "indexes"] as branch}<button
                    class="tree-row level2"
                    role="treeitem"
                    aria-selected="false"
                    aria-level="2"
                    aria-expanded={expanded[branch]}
                    onclick={() => (expanded[branch] = !expanded[branch])}
                    ><span class="tree-toggle" aria-hidden="true"
                      >{expanded[branch] ? "−" : "+"}</span
                    ><img
                      src={icons[
                        branch === "views"
                          ? "view"
                          : branch === "macros"
                            ? "macro"
                            : "index"
                      ]}
                      alt=""
                    />{branch === "indexes"
                      ? "Indexes / ART"
                      : branch.charAt(0).toUpperCase() +
                        branch.slice(1)}</button
                  >{#if expanded[branch]}{#each objects[branch as keyof typeof objects] as object}<button
                        class="tree-row level3"
                        role="treeitem"
                        aria-selected="false"
                        aria-level="3"
                        onclick={() => {
                          modalText = object.definition;
                          showModal("info", object.name);
                        }}>{object.name}</button
                      >{:else}<span class="tree-empty">No objects</span
                      >{/each}{/if}{/each}
              {/if}
              <button
                class="tree-row"
                role="treeitem"
                aria-selected="false"
                aria-level="1"
                aria-expanded={expanded.challenges}
                onclick={() => (expanded.challenges = !expanded.challenges)}
                ><span class="tree-toggle" aria-hidden="true"
                  >{expanded.challenges ? "−" : "+"}</span
                ><img src={icons.folder} alt="" /><b>Challenges</b></button
              >
              {#if expanded.challenges}
                {#each skills as mapSkill}
                  <button
                    class="tree-row level2"
                    role="treeitem"
                    aria-level="2"
                    aria-selected={view === "map" &&
                      selectedSkill === mapSkill.id}
                    aria-expanded={!!expanded[mapSkill.id]}
                    aria-label={progression.skills[mapSkill.id]?.accessible
                      ? undefined
                      : `${mapSkill.label}. ${blockedByText(mapSkill.id)} Right-click the skill on the map to practice ahead.`}
                    title={progression.skills[mapSkill.id]?.accessible
                      ? undefined
                      : blockedByText(mapSkill.id)}
                    onclick={() => {
                      selectedSkill = mapSkill.id;
                      expanded[mapSkill.id] = !expanded[mapSkill.id];
                      view = "map";
                    }}
                  >
                    <span class="tree-toggle" aria-hidden="true"
                      >{expanded[mapSkill.id] ? "−" : "+"}</span
                    >
                    <span class="tree-label">{mapSkill.label}</span>
                    <small
                      >{stateLabel(
                        progression.skills[mapSkill.id]?.state,
                      )}</small
                    >
                  </button>
                  {#if expanded[mapSkill.id]}{#each mapSkill.objectives as objective}
                      <button
                        class="tree-row level3 challenge-row"
                        role="treeitem"
                        aria-level="3"
                        aria-selected={activeDoc?.challenge?.challengeId ===
                          objective.id}
                        disabled={!progression.skills[mapSkill.id]?.accessible}
                        title={progression.skills[mapSkill.id]?.accessible
                          ? undefined
                          : blockedByText(mapSkill.id)}
                        onclick={() => openChallenge(objective.id)}
                      >
                        <span class="tree-label"
                          >{summaries[objective.id]?.displayNumber}
                          {objective.title}</span
                        >
                        <small
                          >{stateLabel(
                            progression.challenges[objective.id]?.state,
                          )}</small
                        >
                      </button>
                    {/each}{/if}
                {/each}
              {/if}
            </div>
            <div class="explorer-footer">
              Local data · {formatCount(schema.length, "table")}<br
              />{activeDoc?.datasetId ?? "No dataset"} · immutable snapshots
            </div>
          </aside>
          <input
            class="sidebar-splitter"
            type="range"
            min="180"
            max="480"
            step="10"
            aria-label="Object Explorer width"
            bind:value={explorerWidth}
            onpointerdown={(event) => resizeSidebar(event, "explorer")}
          />
        {/if}
        <section class="document-area" aria-label="Documents">
          <div
            class="document-tabs"
            id="document-tabs"
            role="tablist"
            aria-label="Open documents"
            tabindex="-1"
            onkeydown={tabKey}
          >
            {#each openIds as id}{@const doc = docs.find(
                (d) => d.id === id,
              )}{#if doc}<button
                  role="tab"
                  data-context="query-tab"
                  data-document-id={id}
                  aria-selected={view === "sql" && activeId === id}
                  tabindex={view === "sql" && activeId === id ? 0 : -1}
                  class:active={view === "sql" && activeId === id}
                  onclick={() => activate(id)}
                  onmousedown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onauxclick={(event) => closeTab(event, id)}
                  ><img src={icons.document} alt="" />{doc.name}{isDirty(doc)
                    ? " *"
                    : ""}</button
                >{/if}{/each}{#if mapTabOpen}<button
                role="tab"
                data-context="view-tab"
                data-view="map"
                aria-selected={view === "map"}
                tabindex={view === "map" ? 0 : -1}
                class:active={view === "map"}
                onmousedown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onauxclick={(event) => closeTab(event, "map")}
                onclick={() => (view = "map")}>Skill Map.dag</button
              >{/if}{#if schemaTabOpen}<button
                role="tab"
                data-context="view-tab"
                data-view="schema"
                aria-selected={view === "schema"}
                tabindex={view === "schema" ? 0 : -1}
                class:active={view === "schema"}
                onmousedown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onauxclick={(event) => closeTab(event, "schema")}
                onclick={() => showSchema()}>schema.ref</button
              >{/if}
            {#if erdTabOpen}<button
                role="tab"
                data-context="view-tab"
                data-view="erd"
                aria-selected={view === "erd"}
                tabindex={view === "erd" ? 0 : -1}
                class:active={view === "erd"}
                onmousedown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onauxclick={(event) => closeTab(event, "erd")}
                onclick={() => showDiagram()}>schema.dgm</button
              >{/if}
          </div>
          {#if view === "sql"}
            {#if activeDoc}<div
                id="editor-region"
                class="editor-region inset"
                data-context="editor"
                style:height={editorHeight + "px"}
                data-region
                tabindex="-1"
              >
                <SqlEditor
                  bind:this={editor}
                  id={activeDoc.id}
                  documentName={activeSummary
                    ? `${activeDoc.name} · ${activeSummary.displayNumber}`
                    : activeDoc.name}
                  {completionSchema}
                  value={activeDoc.sql}
                  revision={activeDoc.revision}
                  selection={activeDoc.selection}
                  scrollTop={activeDoc.scrollTop}
                  diagnostics={currentDiagnostics}
                  fontSize={settings.fontSize}
                  indentation={settings.indentation}
                  wordWrap={settings.wordWrap}
                  onchange={changeDocument}
                  onrun={() => void execute()}
                  onsave={() => void command("Save")}
                />
              </div>{:else}<div class="empty-document">
                <h2>No open SQL document</h2>
                <p>Your drafts remain in My Queries.</p>
                <button onclick={() => openChallenge()}
                  >Open next challenge</button
                ><button onclick={() => command("New Query")}>New Query</button>
              </div>{/if}
            <input
              class="splitter"
              type="range"
              aria-label="Editor and results splitter"
              aria-controls="editor-region output-region"
              min="120"
              max="650"
              step="10"
              bind:value={editorHeight}
              oninput={() => (editorHeightChosen = true)}
              onpointerdown={resizeEditor}
              onkeydown={splitterKey}
            />
            <section
              class="output"
              id="output-region"
              data-region
              tabindex="-1"
              aria-label="Query output"
            >
              <div
                class="output-tabs"
                role="tablist"
                tabindex="-1"
                aria-label="Result views"
                onkeydown={tabKey}
              >
                {#each outputTabs as tab}<button
                    role="tab"
                    aria-selected={outputTab === tab}
                    tabindex={outputTab === tab ? 0 : -1}
                    class:active={outputTab === tab}
                    class:notes-tab={tab === "Patchouli’s notes"}
                    onclick={() => (outputTab = tab)}
                    >{tab}{tab === "Patchouli’s notes"
                      ? " " + currentDiagnostics.length
                      : ""}</button
                  >{/each}
              </div>
              {#if result && resultIsForActiveDocument}<div
                  class="run-identity"
                >
                  Revision {result.revision} · {result.id.slice(0, 8)} · {result.datasetId}
                  · {result.challenge?.challengeId ?? "scratch"}
                  {#if stale}<strong>STALE — SQL or document changed</strong
                    >{/if}
                </div>{/if}
              {#if outputTab === "Results"}<ResultGrid
                  result={result?.result ?? null}
                  {stale}
                  {busy}
                  onderive={(derivation) => void deriveQuery(derivation)}
                />
              {:else if outputTab === "Assessment"}<div class="plan-view inset">
                  {#if activeDoc?.lab && activeContent}
                    <PlanLab
                      document={activeDoc.lab}
                      evidence={labEvidence[activeDoc.id]}
                      {evidenceCurrent}
                      busy={busy ||
                        preparedDocumentId !== activeDoc.id ||
                        !!contentError}
                      {baselineSql}
                      editor={labEditor}
                      onchange={updateLab}
                      onmeasure={() => execute("lab")}
                      onreset={resetLab}
                      oncancel={() => engine.cancel()}
                      error={result?.outcome !== "complete" && !stale
                        ? result?.message
                        : undefined}
                    />
                  {/if}
                  {#if result?.assessment?.kind === "reconciliation" && resultBelongsHere}
                    {#if stale}<p>
                        This assessment belongs to the captured earlier SQL and
                        content, not the active revision.
                      </p>{/if}
                    <ReconciliationAssessment
                      variants={result.assessment.variants}
                    />
                  {:else if guidedSummary}
                    <h3>
                      Reconciliation coverage — {stale
                        ? "earlier result"
                        : "current result"}
                    </h3>
                    <p>
                      {guidedSummary.committed} committed / {guidedSummary.total}
                      reference rows ({guidedSummary.total
                        ? (
                            (100 * guidedSummary.committed) /
                            guidedSummary.total
                          ).toFixed(2)
                        : "0"}%). This is observed coverage, not truth recall.
                    </p>
                    <ul>
                      {#each Object.entries(guidedSummary.counts) as [confidence, count]}<li
                        >
                          {confidence}: {count}
                        </li>{/each}
                    </ul>
                  {:else if !activeDoc?.lab}
                    {#if challenge?.assessment.kind === "exact"}<p>
                        Execute or submit your query to inspect confidence
                        counts and coverage.
                      </p>{:else}<p>
                        Submit a reconciliation answer to inspect outcome
                        metrics and evidence. Exact challenge outcomes appear in
                        the scorecard.
                      </p>{/if}
                  {/if}
                </div>
              {:else if outputTab === "Messages"}<div
                  class="message-list inset"
                >
                  {#each messages as message}<p>{message}</p>{:else}<p>
                      No query messages yet. Execute runs SQL; Submit checks
                      correctness.
                    </p>{/each}
                </div>
              {:else if outputTab === "Execution plan"}<div
                  class="plan-view inset"
                >
                  {#if result?.comparison}<h3>
                      Compare with Reference — {result.datasetId}
                    </h3>
                    <p>
                      {result.comparison.pairs} alternating pairs; bootstrap excluded.
                      Median ± MAD.
                    </p>
                    <dl class="status-card">
                      <dt>Reference</dt>
                      <dd>
                        {result.comparison.referenceMs.toFixed(1)} ± {result.comparison.referenceMad.toFixed(
                          1,
                        )} ms
                      </dd>
                      <dt>Your SQL</dt>
                      <dd>
                        {result.comparison.candidateMs.toFixed(1)} ± {result.comparison.candidateMad.toFixed(
                          1,
                        )} ms
                      </dd>
                      <dt>Paired ratio</dt>
                      <dd>
                        {result.comparison.ratio.toFixed(3)}× — {comparisonVerdict(
                          result.comparison,
                        )}
                      </dd>
                    </dl>
                    <p class="quiet">
                      The ratio is the median of the {result.comparison.pairs} per-pair
                      ratios of your SQL to the reference, so it cancels per-pair
                      machine noise and need not equal the two medians divided. Below
                      1 is faster than the reference; above 1 is slower. Speed never
                      affects correctness.
                    </p>
                    {#each [{ title: "Reference scans", scans: result.comparison.referenceScans }, { title: "Your scans", scans: result.comparison.candidateScans }] as side}
                      <h3>{side.title} — separate execution, not timed</h3>
                      {#if side.scans.length}<ul class="scan-list">
                          {#each side.scans as scan}<li>
                              {scan.table ?? scan.operator}
                              {#if scan.rowsScanned !== undefined}· {formatCount(
                                  scan.rowsScanned,
                                  "row",
                                )} scanned{/if}
                              {#if scan.accessPath !== "not-reported"}· {scan.accessPath}
                                scan{/if}
                              {#if scan.filtered}· filter pushed down{/if}
                            </li>{/each}
                        </ul>{:else}<p class="quiet">
                          No scan operators reported.
                        </p>{/if}
                    {/each}{:else if result?.plan}<pre>{result.plan}</pre>{:else}<p
                    >
                      No plan collected. Show Plan uses non-executing EXPLAIN.
                    </p>
                    <button
                      disabled={disabled("Show Plan")}
                      onclick={() => command("Show Plan")}>Show Plan</button
                    >{/if}
                </div>
              {:else}<div class="diagnostic-list inset">
                  <p class="parser-info" tabindex="-1">{parseInfo}</p>
                  {#each currentDiagnostics as diagnostic}<button
                      class="diagnostic"
                      onclick={() => selectDiagnostic(diagnostic)}
                      ><b class={"severity " + diagnostic.severity}
                        >{diagnostic.severity.toUpperCase()} · {diagnostic.ruleId}
                        · {diagnosticLines(diagnostic)}</b
                      ><span>{diagnostic.message}</span
                      >{#if diagnostic.evidence}<small
                          >{diagnostic.evidence}</small
                        >{/if}</button
                    >{:else}<p>
                      No warnings or style notes for this SQL. Patchouli checks
                      automatically after you pause typing, or when you click
                      Parse. Submit checks whether your answer is correct.
                    </p>{/each}
                  <details class="diagnostic-help">
                    <summary>How to trigger Patchouli’s notes</summary>
                    <p>Try this query in a new SQL tab, then click Parse:</p>
                    <pre>{diagnosticsExample}</pre>
                    <p>
                      <b>J001</b> warns about unrelated tables in a join.
                      <b>J002</b> flags SELECT * when you can name the columns. Click
                      a note to select its source in the editor.
                    </p>
                    <p>
                      Syntax errors also appear here. Plan comparison can add
                      measured performance notes. Patchouli does not generate
                      general commentary about every valid query.
                    </p>
                    <button
                      onclick={() =>
                        addDocument(
                          diagnosticsExample,
                          "diagnostics_example.sql",
                        ).catch((error) => fail(error, "storage"))}
                      >Open example in a new tab</button
                    >
                  </details>
                </div>{/if}
            </section>
          {:else if view === "map"}<SkillMap
              selected={selectedSkill}
              {skills}
              {progression}
              {readingLayout}
              onselect={(id) => (selectedSkill = id)}
            />
          {:else if view === "erd"}<SchemaDiagram
              {schema}
              {readingLayout}
              selected={selectedObject}
              onselect={(table) => (selectedObject = table)}
            />
          {:else}<div class="schema-reference inset" data-region tabindex="-1">
              <h2>
                {activeDoc?.datasetId ?? "No dataset"} · {activeContent?.dataset
                  .version ?? "scratch"}
              </h2>
              <p>
                {formatCount(schema.length, "table")}. Learning data is
                immutable. Times use UTC.
              </p>
              <p>
                Challenge runs restore protected snapshots. The index sandbox is
                separate.
              </p>
              <nav aria-label="Schema tables">
                {#each schema as table}<a href={"#schema-" + table.name}
                    >{table.name}</a
                  >{/each}
              </nav>
              {#each schema as table}<section id={"schema-" + table.name}>
                  <h3>
                    {table.name}
                    <small>{formatCount(table.count, "row")}</small>
                  </h3>
                  <table>
                    <thead
                      ><tr
                        ><th>Column</th><th>Type</th><th>Nullable / key</th></tr
                      ></thead
                    ><tbody
                      >{#each table.columns as column}<tr
                          ><td>{column.name}</td><td>{column.type}</td><td
                            >{column.nullable ? "NULL" : "NOT NULL"}
                            {column.key ?? ""}</td
                          ></tr
                        >{/each}</tbody
                    >
                  </table>
                  <details>
                    <summary>Schema definition and relationships</summary>
                    <pre>{table.definition}</pre>
                  </details>
                </section>{/each}
            </div>{/if}
        </section>
        {#if showGoal && !effectiveGoalFloating}
          <input
            class="sidebar-splitter"
            type="range"
            min="180"
            max="480"
            step="10"
            aria-label="Goal panel width"
            bind:value={goalWidth}
            onpointerdown={(event) => resizeSidebar(event, "goal")}
          />
          {@render goalPanel(false)}
        {/if}
      </div>
      <footer class="statusbar">
        <span class="status-message" role="status" aria-live="polite"
          ><i
            class:ready={statusTone === "success"}
            class:working={statusTone === "working"}
            class:error={statusTone === "error"}
          ></i>{status}</span
        ><span
          >DuckDB {activeDoc?.challenge?.engineVersion ?? "v1.5.4"} · 1 thread</span
        ><span>{result ? result.elapsedMs.toFixed(1) + " ms" : "Not run"}</span
        ><span
          >{result?.fixtureResults
            ? formatCount(result.fixtureResults.length, "dataset")
            : formatCount(result?.result?.count ?? 0, "row")}</span
        ><span
          >{activeDoc
            ? `Ln ${activeDoc.sql.slice(0, activeDoc.selection.head).split("\n").length} Col ${activeDoc.selection.head - (activeDoc.sql.lastIndexOf("\n", activeDoc.selection.head - 1) + 1) + 1} INS`
            : "No editor"}</span
        >
      </footer>
    </main>{/if}
  {#if settings.judgeVisible && !settings.judgeDocked}{@render judge(
      false,
    )}{/if}
  {#if ideVisible && showGoal && effectiveGoalFloating}{@render goalPanel(
      true,
    )}{/if}
  {#key confettiRun}
    {#if confettiOn}
      <div class="confetti" aria-hidden="true">
        {#each Array.from({ length: 40 }, (_, index) => index) as piece}
          <i
            style:left={((piece * 37) % 100) + "%"}
            style:animation-delay={((piece % 10) * 70) / 1000 + "s"}
            style:background={[
              "#b79ad6",
              "#3b1f5e",
              "#ffd966",
              "#3c9a3c",
              "#a31515",
            ][piece % 5]}
          ></i>
        {/each}
      </div>
    {/if}
  {/key}
  {#if startMenu}<nav class="start-menu window" aria-label="Start menu">
      <div class="start-brand">SQL Grind</div>
      <div>
        <button
          onclick={() => {
            ideVisible = true;
            startMenu = false;
          }}>SQL Grind</button
        >{#each desktopIcons as item}<button onclick={() => command(item.name)}
            ><img src={icons[item.icon]} alt="" />{item.name}</button
          >{/each}
        <hr />
        <button onclick={() => command("Settings")}>Settings</button><button
          onclick={() => command("About")}>About SQL Grind</button
        >
      </div>
    </nav>{/if}
  <footer class="taskbar">
    <button
      class="start-button"
      aria-expanded={startMenu}
      class:pressed={startMenu}
      onclick={() => (startMenu = !startMenu)}
      ><span class="start-logo" aria-hidden="true"
        ><i></i><i></i><i></i><i></i></span
      ><b>Start</b></button
    ><span class="separator"></span><button
      class="quick-launch"
      aria-label="Show desktop"
      title="Show desktop"
      onclick={() => showDesktop()}><img src={icons.tree} alt="" /></button
    ><button
      class="quick-launch"
      aria-label="DuckDB Docs — opens in a new tab"
      title="DuckDB Docs"
      onclick={() => command("DuckDB Docs")}
      ><img src={icons.globe} alt="" /></button
    ><span class="separator"></span><button
      id="app-task"
      class="app-task"
      class:pressed={ideVisible}
      onclick={() => {
        ideVisible = !ideVisible;
        desktopShown = false;
      }}
      >SQL Grind - {title}{activeDoc && view === "sql" && isDirty(activeDoc)
        ? " *"
        : ""}{busy ? " · running" : ""}</button
    ><button
      class="judge-task"
      onclick={async () => {
        settings.judgeVisible = true;
        if (settings.judgeDocked) {
          showGoal = true;
          ideVisible = true;
        }
        await tick();
        document.getElementById("judge-heading")?.focus();
        await updateSettings();
      }}>Patchouli — {judgeState}</button
    >
    <div class="tray">
      <button
        class="tray-icon"
        data-context="database"
        aria-haspopup="menu"
        aria-expanded={contextMenu?.label === "SQL engine"}
        onclick={contextRequest}
        aria-label={`SQL engine: ${engineState}`}
        title={`SQL engine: ${engineState}`}
      >
        <img src={icons.database} alt="" width="16" height="16" />
      </button>
      <button
        class="tray-icon tray-judge"
        class:inactive={!settings.judgeVisible}
        data-context="judge"
        aria-haspopup="menu"
        aria-expanded={contextMenu?.label === "Patchouli"}
        onclick={contextRequest}
        aria-label={`Patchouli: ${settings.judgeVisible ? "visible" : "hidden"}${settings.hush ? ", hushed" : ""}`}
        title={`Patchouli: ${settings.judgeVisible ? "visible" : "hidden"}${settings.hush ? ", hushed" : ""}`}
      >
        <img
          src={assetUrl("/assets/patchouli-tray.png")}
          alt=""
          width="16"
          height="16"
        />
      </button>
      <time title={clock.toString()} datetime={clock.toISOString()}
        >{clock.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}</time
      >
    </div>
  </footer>
</div>

{#if contextMenu}
  {@const currentMenu = contextMenu}
  {#key currentMenu}
    <ContextMenu
      {...currentMenu}
      onclose={() => {
        if (contextMenu === currentMenu) contextMenu = null;
      }}
    />
  {/key}
{/if}

{#snippet judge(docked: boolean)}
  <section
    id={docked ? "judge-docked" : "judge-window"}
    class:docked
    class="judge window"
    style:left={!docked && !readingLayout && judgeX !== null
      ? judgeX + "px"
      : undefined}
    style:top={!docked && !readingLayout && judgeY !== null
      ? judgeY + "px"
      : undefined}
    style:right={!docked && !readingLayout && judgeX !== null
      ? "auto"
      : undefined}
    style:bottom={!docked && !readingLayout && judgeY !== null
      ? "auto"
      : undefined}
    style:--judge-zoom={docked ? undefined : effectiveJudgeZoom}
    aria-label="Patchouli"
  >
    <div
      class="titlebar judge-title"
      role="presentation"
      onpointerdown={docked ? undefined : (event) => moveWindow(event, "judge")}
    >
      <h2 id="judge-heading" tabindex="-1">Patchouli — {judgeState}</h2>
      <div class="window-controls">
        <button
          aria-label={docked ? "Float Patchouli" : "Dock Patchouli"}
          onclick={() => dockJudge()}>{docked ? "⇱" : "⇲"}</button
        ><button
          aria-label="Hide Patchouli"
          onclick={async () => {
            settings.judgeVisible = false;
            await tick();
            document
              .querySelector<HTMLButtonElement>(".toolbar button[aria-pressed]")
              ?.focus();
            await updateSettings();
          }}>×</button
        >
      </div>
    </div>
    {#if moving === "judge" && !docked}<p class="movement-help">
        Arrow keys move · Enter accepts · Escape restores
      </p>{/if}
    <div class="judge-body">
      <img
        class="portrait"
        src={assetUrl("/assets/patchouli.webp")}
        alt="Patchouli Knowledge"
        width={docked ? 40 : 72}
        height={docked ? 40 : 72}
      />
      <div class="judge-speech inset">
        <p
          aria-live={settings.announceDiagnostics && !settings.hush
            ? "polite"
            : "off"}
        >
          {remark}
        </p>
        <small>■ {diagnosticLocations || "reading the query"}</small>
      </div>
    </div>
    <div class="judge-summary">
      <b class="warning"
        >{currentDiagnostics.filter(
          (d) => d.severity === "warning" || d.severity === "error",
        ).length} WARN</b
      ><b class="style-count"
        >{currentDiagnostics.filter((d) => d.severity === "style").length} STYLE</b
      ><button class="link" onclick={() => command("Patchouli’s Notes")}
        >Patchouli’s notes ›</button
      >
    </div>
    <div class="judge-actions">
      <button onclick={() => command("Patchouli’s Notes")}
        >Show diagnostics</button
      ><button
        disabled={disabled("Compare with Reference")}
        title={!comparisonEligible
          ? "Submit a correct answer for the current SQL first."
          : "Compare nine pairs against the reference"}
        onclick={() => command("Compare with Reference")}
        >{#if comparisonRunning}<span class="spinner" aria-hidden="true"
          ></span>Comparing…{:else}Compare with Reference{/if}</button
      ><button
        onclick={async () => {
          settings.hush = !settings.hush;
          await updateSettings();
        }}>{settings.hush ? "Resume commentary" : "Hush"}</button
      >
      {#if !docked && !readingLayout}<button
          class="judge-resize"
          aria-label="Resize Patchouli"
          title="Drag to resize · Arrow keys change size"
          onpointerdown={resizeJudge}
          onkeydown={resizeJudgeKey}
          aria-valuenow={Math.round(judgeZoom * 100)}
          aria-valuetext={`${Math.round(judgeZoom * 100)}%`}
          role="slider"
          aria-valuemin={JUDGE_ZOOM_MIN * 100}
          aria-valuemax={JUDGE_ZOOM_MAX * 100}
        ></button>{/if}
    </div>
  </section>
{/snippet}

{#snippet goalPanel(floatingWindow: boolean)}
  <aside
    id={floatingWindow ? "goal-window" : "goal-panel"}
    class:floating={floatingWindow}
    class:window={floatingWindow}
    class="goal panel"
    data-region
    tabindex="-1"
    aria-label={view === "map" ? "Skill Details" : "Goal"}
    style:left={floatingWindow && goalX !== null ? goalX + "px" : undefined}
    style:top={floatingWindow && goalY !== null ? goalY + "px" : undefined}
    style:right={floatingWindow && goalX !== null ? "auto" : undefined}
    style:width={floatingWindow ? goalWidth + "px" : undefined}
    style:height={floatingWindow ? goalHeight + "px" : undefined}
  >
    {#if floatingWindow}
      <div
        class="titlebar goal-title"
        role="presentation"
        onpointerdown={(event) => moveWindow(event, "goal")}
      >
        <h2 id="goal-heading" tabindex="-1">
          {view === "map" ? "Skill Details" : "Goal"}
        </h2>
        <div class="window-controls">
          <button aria-label="Dock Goal panel" onclick={() => floatGoal(false)}
            >⇱</button
          ><button
            aria-label="Hide Goal panel"
            onclick={() => {
              showGoal = false;
              void tick().then(() =>
                document.getElementById("document-tabs")?.focus(),
              );
            }}>×</button
          >
        </div>
      </div>
      {#if moving === "goal"}<p class="movement-help">
          Arrow keys move · Enter accepts · Escape restores
        </p>{/if}
    {:else}
      <div class="panel-heading">
        <b id="goal-heading" tabindex="-1"
          >{view === "map" ? "Skill Details" : "Goal"}</b
        >
        <div class="heading-actions">
          <button
            aria-label="Goal panel actions"
            onclick={() => (goalMenu = !goalMenu)}>▾</button
          ><button
            aria-label="Pop out Goal panel"
            onclick={() => floatGoal(true)}>⇲</button
          ><button
            aria-label="Hide Goal panel"
            onclick={() => {
              showGoal = false;
              void tick().then(() =>
                document.getElementById("document-tabs")?.focus(),
              );
            }}>×</button
          >
        </div>
        {#if goalMenu}<div class="panel-menu">
            <button
              onclick={() => {
                goalCollapsed = !goalCollapsed;
                goalMenu = false;
              }}>{goalCollapsed ? "Expand" : "Collapse"} content</button
            ><button onclick={() => floatGoal(true)}>Pop out</button><button
              onclick={() => {
                showGoal = false;
                goalMenu = false;
              }}>Hide panel</button
            >
          </div>{/if}
      </div>
    {/if}
    {#if settings.judgeVisible && settings.judgeDocked}{@render judge(
        true,
      )}{/if}
    {#if !goalCollapsed}<div class="goal-content inset">
        {#if view === "map" && skill}
          <div class="eyebrow">
            {stateLabel(progression.skills[skill.id]?.state)}
          </div>
          <h2>{skill.label}</h2>
          <p>{skill.description}</p>
          <p>
            {formatProgress(
              progression.skills[skill.id]?.objectives.filter(
                (objective) => objective.completed,
              ).length ?? 0,
              skill.objectives.length,
              "challenge",
            )}
          </p>
          <h3>Requires</h3>
          {#if skill.requires.length}<ul class="requirements">
              {#each skill.requires as id}<li>
                  <button class="link" onclick={() => (selectedSkill = id)}
                    >{skills.find((skill) => skill.id === id)?.label ??
                      id}</button
                  >
                  — {stateLabel(progression.skills[id]?.state)}
                </li>{/each}
            </ul>{:else}<p>No prerequisites.</p>{/if}
          <h3>Challenges</h3>
          <ol class="objectives">
            {#each skill.objectives as objective}<li>
                <button
                  disabled={!progression.skills[skill.id]?.accessible}
                  onclick={() => openChallenge(objective.id)}
                >
                  <b
                    >{summaries[objective.id]?.displayNumber} · {objective.title}</b
                  >
                  <span
                    >{stateLabel(
                      progression.challenges[objective.id]?.state,
                    )}</span
                  >
                </button>
                <p>{objective.description}</p>
              </li>{/each}
          </ol>
          {#if !progression.skills[skill.id]?.accessible}
            <div class="ahead-offer">
              <p><strong>{blockedByText(skill.id)}</strong></p>
              <button onclick={() => setPracticeAhead(skill.id, true)}
                >Practice ahead anyway</button
              >
              <p>
                Practicing ahead opens these five challenges now. It does not
                mark the prerequisites complete. Anything you finish here counts
                for good.
              </p>
            </div>
          {:else if progression.skills[skill.id]?.ahead}
            <div class="ahead-offer">
              <p>
                <strong>Practicing ahead.</strong> You opened this before
                {joinNames(blockingSkills(skill.id))}. Completions here count
                for good.
              </p>
              {#if earnedAhead(skill.id)}
                <p>
                  This stays open now: you have completed challenges here, and
                  they keep their place.
                </p>
              {:else}
                <button onclick={() => setPracticeAhead(skill.id, false)}
                  >Return to the recommended path</button
                >
              {/if}
            </div>
          {/if}
        {:else if challenge}
          <div class="eyebrow">
            CHALLENGE {activeSummary?.displayNumber} · {skills.find(
              (skill) => skill.id === challenge.skillId,
            )?.label}
          </div>
          <h2>{challenge.title}</h2>
          <p>{challenge.brief}</p>
          <ol>
            {#each challenge.instructions as instruction}<li>
                {instruction}
              </li>{/each}
          </ol>
          <h3>Expected shape</h3>
          <div class="shape">
            {#each challenge.output.columns as column}<div>
                <code>{column.name}</code>
                {column.type}{column.type === "DECIMAL"
                  ? `(${column.precision},${column.scale})`
                  : ""}
                {column.nullable ? "nullable" : "not null"}
              </div>{/each}
            <p>
              Ordering: {challenge.output.ordering.length
                ? challenge.output.ordering
                    .map(
                      (key) =>
                        `${key.column} ${key.direction} NULLS ${key.nulls}`,
                    )
                    .join(", ")
                : "No ordering keys"}. Equal ordering keys may appear in either
              order.
            </p>
          </div>
          <p class="quiet">{challenge.starterExplanation}</p>
          <h3>Challenge status</h3>
          <dl class="status-card">
            <dt>Completion</dt>
            <dd>
              {completed
                ? "Completed"
                : stateLabel(
                    progression.challenges[challenge.challengeId]?.state,
                  )}
            </dd>
            <dt>Hints revealed</dt>
            <dd>{hints} of 3</dd>
          </dl>
          <h3>
            {activeSlot
              ? activeSlot.kind === "submit"
                ? "This run · graded submission"
                : activeSlot.kind === "compare"
                  ? "This run · comparison, not a submission"
                  : "This run · not a submission"
              : "This run · nothing run yet"}
          </h3>
          <dl class="scorecard">
            <dt>Correctness</dt>
            <dd class:correct={result?.correctness === "correct" && !stale}>
              {stale
                ? "Stale result"
                : result?.correctness === "correct"
                  ? "Pass"
                  : result?.correctness === "incorrect"
                    ? "Not yet correct"
                    : "Not submitted"}
            </dd>
            <dt>
              {resultKind === "submit"
                ? "Graded SQL time"
                : resultKind === "compare"
                  ? "Comparison run time"
                  : "Runtime"}
            </dt>
            <dd>
              {result ? result.elapsedMs.toFixed(1) + " ms" : "Not measured"}
            </dd>
            <dt>
              {result?.fixtureResults ? "Datasets checked" : "Rows returned"}
            </dt>
            <dd>
              {result?.fixtureResults
                ? result.fixtureResults.length
                : (result?.result?.count.toLocaleString() ?? "No result")}
            </dd>
            <dt>Style and syntax notes</dt>
            <dd>
              {formatCount(currentDiagnostics.length, "note")} for this revision
            </dd>
          </dl>
          {#if result?.fixtureResults && resultBelongsHere}<ul
              class="fixture-results"
            >
              {#each result.fixtureResults as fixture}<li
                  class:correct={fixture.pass}
                >
                  {fixture.pass ? "PASS" : "FAIL"} · {fixture.name}
                  {#if fixture.expectedRows !== undefined}
                    · expected {fixture.expectedRows} rows; returned {fixture.actualRows ??
                      "unavailable"}
                  {/if}
                  {#if fixture.elapsedMs !== undefined}
                    · {fixture.elapsedMs.toFixed(1)} ms{/if}
                  {fixture.reason ? " — " + fixture.reason : ""}
                </li>{/each}
            </ul>{/if}
          {#if challenge.assessment.kind === "exact"}<h3>
              Compare with Reference
            </h3>
            <div class="reference-boxes">
              <div>
                runtime<b
                  >{result?.comparison
                    ? result.comparison.candidateMs.toFixed(1) + " ms"
                    : "Unavailable"}</b
                >
              </div>
              <div>
                reference<b
                  >{result?.comparison
                    ? result.comparison.referenceMs.toFixed(1) + " ms"
                    : "Not collected"}</b
                >
              </div>
              <div>
                your SQL<b
                  >{formatCount(
                    activeDoc?.sql.split("\n").length ?? 0,
                    "line",
                  )}</b
                >
              </div>
            </div>
            <p class="quiet">
              {comparisonEligible
                ? "Compare with Reference collects nine paired timings and separate execution profiles."
                : "Submit a correct answer for the current SQL to enable Compare with Reference."}
              Speed and hints never reduce correctness credit.
            </p>
            <!-- The section that explains the comparison now carries the
                 control that starts it. It remains in Patchouli's dock and the
                 Query menu; a learner reading the methodology should not have
                 to hunt another window for the button. -->
            <button
              class="goal-compare"
              disabled={disabled("Compare with Reference")}
              title={!comparisonEligible
                ? "Submit a correct answer for the current SQL first."
                : "Compare nine pairs against the reference"}
              onclick={() => command("Compare with Reference")}
              >{#if comparisonRunning}<span class="spinner" aria-hidden="true"
                ></span>Comparing…{:else}Compare with Reference{/if}</button
            >
          {:else}<p>
              Use the assessment panel for {challenge.assessment.kind ===
              "plan-lab"
                ? "measured lab evidence"
                : "reconciliation outcome quality"}. Generic speed comparison is
              not used for this assessment.
            </p>{/if}
          <p>
            All five current challenges complete a skill. Hints do not reduce
            credit.
          </p>
        {:else}
          <h2>
            {historicalNotice ? "Historical draft" : "Scratch query"}
          </h2>
          <p>
            Execute SQL against the selected immutable dataset. Scratch and
            historical drafts cannot be submitted for completion.
          </p>
          <button
            onclick={() => {
              view = "map";
            }}>Choose a challenge</button
          >
        {/if}
      </div>{:else}<button onclick={() => (goalCollapsed = false)}
        >Expand content</button
      >{/if}
    <footer class="goal-footer">
      {#if view === "map"}
        <button
          class="default-button"
          disabled={!progression.skills[selectedSkill]?.accessible}
          onclick={() => command("Open Next Challenge")}
        >
          {progression.skills[selectedSkill]?.nextChallengeId
            ? "Open next challenge"
            : "Review first challenge"}
        </button>
      {:else}
        <button
          disabled={!storageReady || !challenge}
          onclick={() =>
            completed || hints === 3
              ? showModal("hints", `${activeSummary?.displayNumber} — hints`)
              : revealHint()}
        >
          {completed || hints === 3
            ? "Review hints"
            : `Hint (${3 - hints} left)`}
        </button>
        <button disabled={disabled("Submit")} onclick={() => command("Submit")}
          >{#if running && runningKind === "submit"}<span
              class="spinner"
              aria-hidden="true"
            ></span>Submitting…{:else}Submit{/if}</button
        >
        {#if completed}
          {@const nextId =
            progression.skills[challenge?.skillId ?? ""]?.nextChallengeId}
          <button
            class="default-button"
            onclick={async () => {
              if (nextId) await openChallenge(nextId);
              else view = "map";
            }}>{nextId ? "Next challenge" : "Skill map"}</button
          >
        {/if}
      {/if}
    </footer>
    {#if floatingWindow}<button
        class="goal-resize"
        aria-label="Resize Goal window"
        title="Drag to resize · Arrow keys change size"
        onpointerdown={resizeGoal}
        onkeydown={resizeGoalKey}
      ></button>{/if}
  </aside>
{/snippet}

<dialog
  bind:this={dialog}
  class="app-dialog window"
  onkeydown={dialogKey}
  tabindex="-1"
  oncancel={(e) => {
    e.preventDefault();
    closeModal();
  }}
  aria-labelledby="dialog-title"
>
  <div class="titlebar">
    <h2 id="dialog-title">{modalTitle}</h2>
    <button aria-label="Close dialog" onclick={closeModal}>×</button>
  </div>
  <div class="dialog-content">
    {#if modal === "prompt"}<form
        onsubmit={(e) => {
          e.preventDefault();
          acceptModal();
        }}
      >
        <label
          >{modalText}<input
            bind:value={inputValue}
            maxlength="200"
            required
          /></label
        >
        <div class="dialog-actions">
          <button type="button" onclick={closeModal}>Cancel</button><button
            class="default-button"
            type="submit">Save</button
          >
        </div>
      </form>
    {:else if modal === "confirm"}<p>{modalText}</p>
      <div class="dialog-actions">
        <button onclick={closeModal}>Cancel</button><button
          class="default-button"
          onclick={acceptModal}>Continue</button
        >
      </div>
    {:else if modal === "info"}<p class="preserve-text">{modalText}</p>
    {:else if modal === "celebrate"}<div class="celebrate">
        <p class="celebrate-lead">
          {celebration?.title} — solved. Your result matched the contract on every
          grading dataset, which is the only argument I find persuasive.
        </p>
        <p>
          {celebrationNextId
            ? "There is another one waiting. I have marked the page; go on when you like."
            : "That completes this skill. The later shelves are open to you now."}
        </p>
        <p class="quiet">
          Hints cost you nothing here, and neither does a slow answer.
        </p>
      </div>
      <div class="dialog-actions">
        <button onclick={closeModal}>Stay on this challenge</button
        >{#if celebrationNextId}<button
            class="default-button"
            onclick={async () => {
              const next = celebrationNextId;
              closeModal();
              if (next) await openChallenge(next);
            }}>Open next challenge</button
          >{:else}<button
            class="default-button"
            onclick={() => {
              closeModal();
              view = "map";
            }}>Open the skill map</button
          >{/if}
      </div>
    {:else if modal === "open"}<p>
        Open a local query or import a UTF-8 SQL file. Imported SQL never runs
        automatically.
      </p>
      <button onclick={() => showModal("library", "My Queries")}
        >My Queries</button
      ><button onclick={() => importSqlInput.click()}>Import SQL file</button>
    {:else if modal === "library"}<div class="library-tools">
        <label
          >Search queries<input type="search" bind:value={querySearch} /></label
        ><label
          >Challenge filter<select bind:value={queryFilter}
            ><option value="all">All queries</option><option value="challenge"
              >Challenge queries</option
            ><option value="scratch">Scratch queries</option></select
          ></label
        >
      </div>
      <div class="library-list">
        {#each library as doc}<article>
            <h3>
              {doc.name}
              <small>{doc.saved ? "Saved query" : "Auto-saved draft"}</small>
            </h3>
            <p>
              Revision {doc.revision} · {new Date(
                doc.updatedAt,
              ).toLocaleString()}
            </p>
            <div>
              <button
                onclick={() => {
                  closeModal();
                  void activate(doc.id);
                }}>Open</button
              ><button
                onclick={() =>
                  renameQuery(doc).catch((e) => fail(e, "storage"))}
                >Rename</button
              ><button
                onclick={() =>
                  duplicateQuery(doc).catch((e) => fail(e, "storage"))}
                >Duplicate</button
              ><button
                onclick={() =>
                  deleteQuery(doc).catch((e) => fail(e, "storage"))}
                >Delete</button
              ><button onclick={() => download(doc.name, doc.sql)}
                >Export SQL</button
              >
            </div>
          </article>{:else}<p>
            No local queries match. New Query creates a draft; Save names it.
          </p>{/each}
      </div>
    {:else if modal === "bin"}<p>
        Deleted queries keep their SQL until permanent deletion. Attempts keep
        independent snapshots.
      </p>
      <div class="library-list">
        {#each deleted as doc}<article>
            <h3>{doc.name}</h3>
            <p>Deleted {new Date(doc.deletedAt!).toLocaleString()}</p>
            <button
              onclick={() => restoreQuery(doc).catch((e) => fail(e, "storage"))}
              >Restore</button
            ><button
              onclick={() =>
                permanentlyDelete(doc).catch((e) => fail(e, "storage"))}
              >Delete permanently</button
            >
          </article>{:else}<p>The Recycle Bin is empty.</p>{/each}
      </div>
      <button
        disabled={!deleted.length}
        onclick={async () => {
          if (
            await confirmAction(
              "Empty Recycle Bin",
              "Permanently delete every recycled query and draft? Attempt history remains.",
            )
          ) {
            await store.emptyBin();
            await reloadProfile(true);
            showModal("bin", "Recycle Bin");
          }
        }}>Empty Bin</button
      >
    {:else if modal === "settings"}<div class="settings-grid">
        <label
          >Theme<select bind:value={themeSetting} onchange={updateSettings}
            ><option value="system">System</option><option value="light"
              >Light</option
            ><option value="dark">Dark</option></select
          ></label
        >
        <label
          >Editor font size<select
            bind:value={settings.fontSize}
            onchange={updateSettings}
            >{#each [12, 14, 16, 18, 20, 24] as size}<option value={size}
                >{size} px</option
              >{/each}</select
          ></label
        ><label
          >Indentation<select
            bind:value={settings.indentation}
            onchange={updateSettings}
            ><option value={2}>2 spaces</option><option value={4}
              >4 spaces</option
            ></select
          ></label
        ><label
          ><input
            type="checkbox"
            bind:checked={settings.wordWrap}
            onchange={updateSettings}
          />Wrap SQL lines</label
        ><label
          ><input
            type="checkbox"
            bind:checked={settings.hush}
            onchange={updateSettings}
          />Hush unsolicited commentary</label
        ><label
          ><input
            type="checkbox"
            bind:checked={settings.readingLayout}
            onchange={updateSettings}
          />Single-column Reading Layout</label
        >{#if narrowViewport}<small class="setting-note"
            >Reading Layout is automatic below 1100 pixels.</small
          >{/if}<label
          ><input
            type="checkbox"
            bind:checked={settings.announceDiagnostics}
            onchange={updateSettings}
          />Announce current diagnostic summaries</label
        >
      </div>
      <p>
        Patchouli reports the same facts however she phrases them. Hints and
        style never reduce correctness credit.
      </p>
    {:else if modal === "storage"}<p>{storageInfo}</p>
      <p>
        Queries, drafts, settings, hints, and progress live in IndexedDB on this
        browser origin. Browser eviction can remove them.
      </p>
      <button
        onclick={async () => {
          const granted = await navigator.storage?.persist?.();
          storageInfo = granted
            ? "Persistent storage permission granted. Backups are still necessary."
            : "Persistent storage permission not granted. Export a backup.";
        }}>Request persistent storage</button
      ><button onclick={() => exportBackup()}>Export Practice Backup</button
      ><button onclick={() => importBackupInput.click()}
        >Import Practice Backup</button
      >
      <h3>Engine and dataset assets</h3>
      <p>{cacheInfo}</p>
      <p>
        Content assets — the bundle, datasets and extensions — are checked
        against their published SHA-256 before use. The engine worker and wasm
        module are fetched by URL, so for those two the cache is trusted.
      </p>
      <h3>Practice data</h3>
      <button
        onclick={async () => {
          if (
            await confirmAction(
              "Clear all practice data",
              "Delete all local queries, drafts, hints, settings, attempts, and progress? Exported backups are not deleted.",
            )
          ) {
            await store.clearPracticeData();
            await reloadProfile();
            await openChallenge("basics.01");
            announce("Local practice data cleared.");
          }
        }}>Clear all practice data</button
      >
    {:else if modal === "hints"}<p>
        Revealed hints remain readable. Assistance is recorded, never penalized.
      </p>
      {#each challenge?.hints.slice(0, hints) ?? [] as hint}<section
          class="hint"
        >
          <h3>Hint {hint.level} · {hint.kind}</h3>
          <p>{hint.text}</p>
        </section>{/each}{#if hints < 3 && !completed}<button
          onclick={() => revealHint()}
          >Reveal hint {hints + 1} ({3 - hints} left)</button
        >{/if}{#if !hints}<p>
          No hints were revealed for this challenge. Nothing here was withheld.
        </p>{/if}
    {:else if modal === "katas"}{#if activeKataPattern && activeKataVariation}<p
          class="kata-prompt"
        >
          {activeKataVariation.prompt}
        </p>
        <p class="kata-meta">
          {activeKataPattern.title} · variation {activeKataVariation.variationId}
          · dataset {activeKataPattern.datasetId} ({activeKataVariation.variantId})
        </p>
        <div class="kata-editor">
          <SqlEditor
            id={`kata:${activeKataPattern.patternId}/${activeKataVariation.variationId}`}
            documentName={`${activeKataPattern.patternId}/${activeKataVariation.variationId}`}
            value={kataSql}
            revision={0}
            selection={{ anchor: 0, head: 0 }}
            scrollTop={0}
            diagnostics={[]}
            fontSize={settings.fontSize}
            indentation={settings.indentation}
            wordWrap={settings.wordWrap}
            {completionSchema}
            onchange={(value) => (kataSql = value)}
            onrun={() => void checkKata()}
            onsave={() => {}}
          />
        </div>
        <div class="library-tools">
          <button
            onclick={() => void checkKata()}
            disabled={kataRunning || busy || !storageReady}
            >{kataRunning ? "Checking…" : "Check drill"}</button
          ><button onclick={() => closeKata()}>Back to patterns</button
          >{#if kataOutcome === "pass"}<button
              onclick={() => startKata(activeKataPattern!)}>Next drill</button
            >{/if}
        </div>
        {#if kataFeedback}<p
            class="kata-feedback"
            class:kata-pass={kataOutcome === "pass"}
            class:kata-miss={kataOutcome === "miss"}
          >
            {kataFeedback}
          </p>{/if}
        {#if kataOutcome === "pass"}<p class="kata-meta">
            Matched in {Math.round(kataElapsedMs)} ms of engine time. Streak {activeKataRecord?.streak ??
              0}; due again {activeKataRecord
              ? new Date(activeKataRecord.dueAt).toLocaleDateString()
              : "later"}.{kataScheduled
              ? ""
              : " This drill was not due, so the streak and the date are unchanged."}
          </p>{/if}
        <p class="kata-meta">
          Drills record their own schedule only. Nothing here completes a
          challenge or changes the skill map.
        </p>
      {:else}<p>
          Katas are short repetition drills. They are graded against an authored
          reference at run time, and they never award or revoke challenge
          completion — the skill map is unaffected by anything you do here.
        </p>
        <p>
          {formatCount(kataDueTotal, "drill")} due now across {formatCount(
            kataPatterns.length,
            "pattern",
          )}.
        </p>
        {#if kataContentErrors.length}<p class="kata-feedback kata-miss">
            {formatCount(kataContentErrors.length, "drill pattern")} could not be
            loaded and are unavailable: {kataContentErrors.join(" ")}
          </p>{/if}
        <div class="library-tools">
          <label
            >Show<select bind:value={kataFilter}
              ><option value="due">Patterns with drills due</option><option
                value="all">All patterns</option
              ></select
            ></label
          >
        </div>
        <div class="library-list">
          {#each kataVisible as entry}<article>
              <h3>{entry.pattern.title}</h3>
              <p class="kata-meta">
                {entry.status.due} of {entry.status.total} due · {entry.status
                  .retained} retained ({KATA_RETAINED_STREAK} clean passes){#if entry.status.due === 0 && entry.status.nextDueAt}{" "}·
                  next {new Date(
                    entry.status.nextDueAt,
                  ).toLocaleDateString()}{/if}
              </p>
              <p>{entry.pattern.why}</p>
              <ul class="kata-variations">
                {#each entry.variations as item}<li>
                    <span>{item.variation.prompt}</span>
                    <small
                      >{item.retained
                        ? `Retained · streak ${item.streak}`
                        : item.due
                          ? item.attempts
                            ? `Due · streak ${item.streak}`
                            : "Never drilled"
                          : `Next ${new Date(item.dueAt!).toLocaleDateString()} · streak ${item.streak}`}</small
                    >
                  </li>{/each}
              </ul>
              <button
                onclick={() => startKata(entry.pattern)}
                disabled={!storageReady}
                >{entry.status.due ? "Start drill" : "Drill early"}</button
              >
            </article>{:else}<p class="kata-meta">
              Nothing is due. Choose “All patterns” to drill early; an early
              pass is recorded but does not advance a streak.
            </p>{/each}
        </div>
        {#if kataFeedback}<p class="kata-feedback">{kataFeedback}</p>{/if}
      {/if}
    {:else if modal === "records"}<p>
        These practice records belong to this browser. They are not verified
        public rankings.
      </p>
      <div class="library-tools">
        <label
          >Correctness<select bind:value={recordFilter}
            ><option value="all">All attempts</option><option value="correct"
              >Correct</option
            ><option value="incorrect">Incorrect</option><option
              value="not-evaluated">Not evaluated</option
            ></select
          ></label
        ><label
          >Assistance<select bind:value={recordAssistance}
            ><option value="all">All assistance</option><option value="assisted"
              >Assisted</option
            ><option value="unassisted">Unassisted</option></select
          ></label
        ><button onclick={() => exportBackup()}>Export records</button>
      </div>
      <p>
        {formatCount(
          Object.values(progression.challenges).filter(
            (objective) => objective.completed,
          ).length,
          "current challenge",
        )} completed.
      </p>
      <!-- The log alone showed none of what it already records. Every figure
           below is derived from stored attempts, and describes every one of
           them rather than the filtered list. -->
      {#if recordSummary.graded}<h3>Summary of all recorded attempts</h3>
        <dl class="status-card">
          <dt>Graded submissions</dt>
          <dd>
            {recordSummary.graded} across {formatCount(
              recordSummary.challenges,
              "challenge",
            )}
          </dd>
          <dt>Correct</dt>
          <dd>
            {recordSummary.correct} · {Math.round(
              (recordSummary.accuracy ?? 0) * 100,
            )}%
          </dd>
          <dt>Correct without a hint</dt>
          <dd>{recordSummary.unassisted} of {recordSummary.correct}</dd>
          <dt>Correct on the first graded attempt</dt>
          <dd>
            {recordSummary.firstTry} of {formatCount(
              recordSummary.challenges,
              "challenge",
            )}
          </dd>
          <dt>Median engine time, correct attempts</dt>
          <dd>
            {recordSummary.medianCorrectMs === null
              ? "Not measured"
              : `${recordSummary.medianCorrectMs.toFixed(1)} ms`}
          </dd>
          <dt>Days practiced</dt>
          <dd>
            {formatCount(recordSummary.days, "day")}{recordSummary.streak
              ? ` · ${formatCount(recordSummary.streak, "day")} in a row`
              : ""}
          </dd>
        </dl>
        <p class="quiet">
          These figures cover every recorded attempt, not the filtered list
          below. Engine time is how long the graded SQL ran, not how long the
          challenge took to solve; the application never measures the latter.
          Execute runs are not submissions and are excluded.
        </p>
        <h3>By skill</h3>
        <dl class="status-card">
          {#each recordBySkill as row}<dt>{row.label}</dt>
            <dd>
              {row.correct}/{row.graded} correct · {Math.round(
                (row.correct / row.graded) * 100,
              )}%
            </dd>{/each}
        </dl>{/if}
      <div class="library-list">
        {#each filteredAttempts as attempt}<article>
            <h3>
              {attempt.challenge.challengeId} · {attempt.correctness}
              <small>{attempt.hintLevel ? "Assisted" : "Unassisted"}</small>
            </h3>
            <p>
              {new Date(attempt.createdAt).toLocaleString()} · {attempt
                .challenge.bundleVersion}
              · revision {attempt.revision}
            </p>
            <p>{attempt.message}</p>
            <p>
              {sameIdentity(
                attempt.challenge,
                identities[attempt.challenge.challengeId],
              )
                ? "Current content"
                : "Historical content — needs review"} · {attempt.datasetId}
            </p>
            {#if attempt.assessment?.kind === "reconciliation"}<details>
                <summary>Saved reconciliation evidence</summary
                ><ReconciliationAssessment
                  variants={attempt.assessment.variants}
                />
              </details>{/if}
            {#if attempt.assessment?.kind === "plan-lab"}<details>
                <summary>Saved lab measurements and report</summary>
                <pre>{JSON.stringify(attempt.assessment, null, 2)}</pre>
              </details>{/if}
            <button onclick={() => openAttempt(attempt)}
              >Open attempt SQL</button
            ><button
              onclick={async () => {
                if (
                  await confirmAction(
                    "Delete attempt history",
                    "Delete this attempt and recompute completion from remaining attempts?",
                  )
                ) {
                  await store.deleteAttempt(attempt.id);
                  attempts = attempts.filter((a) => a.id !== attempt.id);
                  showModal("records", "Practice Records — this device");
                }
              }}>Delete attempt</button
            >
          </article>{:else}<p>
            No matching attempts. Submit creates a local practice record.
          </p>{/each}
      </div>
    {:else if modal === "history"}<p>
        The last {HISTORY_LIMIT} statements executed here or restored from a backup,
        newest first. Opening one puts its SQL in a new document; nothing runs until
        you run it.
      </p>
      <div class="library-list">
        {#each history as entry, index}<article>
            <h3>
              {entry.kind === "submit"
                ? "Submitted"
                : entry.kind === "plan"
                  ? "Planned"
                  : entry.kind === "compare"
                    ? "Compared"
                    : entry.kind === "lab"
                      ? "Lab"
                      : "Executed"}
              <small>{entry.datasetId}</small>
            </h3>
            <p>{new Date(entry.ranAt).toLocaleString()}</p>
            <pre class="history-sql">{entry.sql}</pre>
            <button onclick={() => openHistory(entry, index)}
              >Open in new query</button
            >
          </article>{:else}<p>
            No SQL has run on this device yet. Execute a query and it appears
            here.
          </p>{/each}
      </div>
      {#if history.length}<button onclick={() => clearHistory()}
          >Clear query history</button
        >{/if}
    {:else if modal === "shortcuts"}<dl class="shortcuts">
        {#each Object.keys(shortcutPurpose) as name}<dt>
            {shortcutHints[name]}
          </dt>
          <dd>{shortcutPurpose[name]}</dd>{/each}
        <dt>Escape, then Tab</dt>
        <dd>Leave the SQL editor without inserting indentation.</dd>
        <dt>F6 / Shift+F6</dt>
        <dd>Move between major regions.</dd>
        <dt>Alt + menu letter</dt>
        <dd>Open that menubar menu. The underlined letter is the key.</dd>
        <dt>Shift+F10 / Context Menu key</dt>
        <dd>
          Open the menu for a table, editor, document tab, result cell, or tray
          icon.
        </dd>
        <dt>Escape</dt>
        <dd>Close a context menu and return focus to its source.</dd>
        <dt>Arrow keys / Home / End</dt>
        <dd>Navigate menus, tabs, tree, grid, and skill map.</dd>
        <dt>Editor/results splitter</dt>
        <dd>Up/Down resize 10 px; Shift changes 50 px. Home/End use limits.</dd>
      </dl>
      <p>
        On macOS use Command wherever this list says Ctrl. Browser reload,
        close-tab, and zoom shortcuts remain browser actions outside the editor.
        Use the browser's own zoom to scale the whole interface.
      </p>
    {:else if modal === "rules"}<h3>{challenge?.title ?? "Scratch query"}</h3>
      {#if challenge}
        <p>{challenge.brief}</p>
        <ol>
          {#each challenge.instructions as instruction}<li>
              {instruction}
            </li>{/each}
        </ol>
        <p>
          Submission checks every grading variant: {activeContent?.dataset.gradingVariants.join(
            ", ",
          )}. Cancellation, stale submissions, truncated output, and errors
          cannot pass.
        </p>
        <p>
          Equivalent correct solutions earn completion. Completion does not
          prove technique mastery.
        </p>
      {:else}<p>
          Scratch queries can execute but cannot earn challenge completion.
        </p>{/if}
      <p>
        512 MB engine memory · 10-second query deadline · 100,000 rows / 32 MiB
        retained output. Each challenge run starts from a fresh protected
        snapshot.
      </p>
    {:else if modal === "credits"}<pre class="credits-text">{credits}</pre>
      <h3>Portrait</h3>
      <p>
        Patchouli Knowledge portrait supplied with the design. The user accepts
        this wiki image for local use and defers exact distribution permission
        review.
      </p>
      <p>
        Touhou Project character: Team Shanghai Alice. Local use is not a claim
        of redistribution permission.
      </p>
    {:else if modal === "about"}<h3>SQL Grind 0.1.0</h3>
      <p>A local SQL learning workbench. Svelte 5 · TypeScript · Vite.</p>
      <p>
        DuckDB {activeDoc?.challenge?.engineVersion ?? "v1.5.4"} · one execution
        thread.
      </p>
      <p>
        Dataset {activeDoc?.datasetId ?? "not selected"} · bundle {activeDoc
          ?.challenge?.bundleVersion ?? "scratch"}. No accounts, telemetry, LLM
        grading, or server-side submissions.
      </p>
      <p>
        {formatCount(skills.length, "skill")} · {formatCount(
          Object.keys(summaries).length,
          "authored exercise",
        )}. Correct current outcomes unlock later skills.
      </p>
    {/if}
  </div>
  {#if modal !== "prompt" && modal !== "confirm" && modal !== "celebrate"}<footer
      class="dialog-actions"
    >
      <button class="default-button" onclick={closeModal}>Close</button>
    </footer>{/if}
</dialog>
{#snippet labEditor(slot: SqlSlot, sql: string, change: (sql: string) => void)}
  {@const key = `${activeId}:lab:${slot}`}
  <SqlEditor
    id={key}
    documentName={`${activeDoc?.name ?? "Lab"} — ${slot}`}
    value={sql}
    revision={activeDoc?.revision ?? 0}
    selection={labEditorStates[key]?.selection ?? { anchor: 0, head: 0 }}
    scrollTop={labEditorStates[key]?.scrollTop ?? 0}
    diagnostics={[]}
    fontSize={settings.fontSize}
    indentation={settings.indentation}
    wordWrap={settings.wordWrap}
    {completionSchema}
    onchange={(value, selection, scrollTop) => {
      labEditorStates[key] = { selection, scrollTop };
      if (value !== sql) change(value);
    }}
    onrun={() => void execute("lab")}
    onsave={() => void command("Save")}
  />
{/snippet}
