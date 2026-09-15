<script module lang="ts">
  import type { EditorState as SavedEditorState } from "@codemirror/state";
  const documents = new Map<
    string,
    { state: SavedEditorState; scrollTop: number }
  >();
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import {
    Compartment,
    EditorSelection,
    EditorState,
    StateEffect,
  } from "@codemirror/state";
  import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
  } from "@codemirror/view";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    redo,
    selectAll,
    undo,
    isolateHistory,
  } from "@codemirror/commands";
  import {
    autocompletion,
    closeCompletion,
    completionKeymap,
  } from "@codemirror/autocomplete";
  import { PostgreSQL, sql } from "@codemirror/lang-sql";
  import {
    bracketMatching,
    defaultHighlightStyle,
    HighlightStyle,
    indentOnInput,
    indentUnit,
    syntaxHighlighting,
  } from "@codemirror/language";
  import {
    closeSearchPanel,
    gotoLine,
    openSearchPanel,
    search,
    searchKeymap,
  } from "@codemirror/search";
  import { setDiagnostics, lintGutter } from "@codemirror/lint";
  import { tags } from "@lezer/highlight";
  import type { Diagnostic } from "../lib/types";

  interface Props {
    id: string;
    documentName: string;
    value: string;
    revision: number;
    selection: { anchor: number; head: number };
    scrollTop: number;
    diagnostics: Diagnostic[];
    fontSize: number;
    indentation: number;
    wordWrap: boolean;
    completionSchema: Record<string, string[]>;
    onchange: (
      value: string,
      selection: { anchor: number; head: number },
      scrollTop: number,
    ) => void;
    onrun: () => void;
    onsave: () => void;
  }
  let {
    id,
    documentName,
    value,
    revision,
    selection,
    scrollTop,
    diagnostics,
    fontSize,
    indentation,
    wordWrap,
    completionSchema,
    onchange,
    onrun,
    onsave,
  }: Props = $props();
  let host: HTMLDivElement;
  let view = $state.raw<EditorView | null>(null);
  let clipboardMessage = $state("");
  let activeId = "";
  let applyingExternal = false;
  const appearance = new Compartment();
  const language = new Compartment();
  const sqlColors = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syn-keyword)" },
    {
      tag: [tags.function(tags.variableName), tags.standard(tags.name)],
      color: "var(--syn-type)",
    },
    { tag: tags.string, color: "var(--syn-string)" },
    { tag: tags.number, color: "var(--syn-number)" },
    { tag: tags.comment, color: "var(--ok-edge)" },
    { tag: tags.operator, color: "var(--ink-mid)" },
  ]);

  function appearanceExtensions() {
    return [
      EditorView.contentAttributes.of({
        "aria-label": `SQL editor — ${documentName}`,
        "aria-describedby": "sql-editor-help",
        spellcheck: "false",
      }),
      indentUnit.of(" ".repeat(Math.max(1, Math.min(8, indentation)))),
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: `${fontSize}px`,
          backgroundColor: "var(--field)",
          color: "var(--ink)",
        },
        ".cm-scroller": {
          fontFamily: '"DejaVu Sans Mono", Consolas, monospace',
          overflow: "auto",
        },
        ".cm-content": {
          padding: "5px 0",
          color: "var(--ink)",
          caretColor: "var(--ink)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--face-alt)",
          color: "var(--ink-muted)",
          borderRight: "1px solid var(--face-sunken)",
        },
        ".cm-activeLine": { backgroundColor: "var(--line-highlight)" },
        // CodeMirror paints the selection layer at z-index -2, behind the line
        // boxes, and drawSelection() clears the native ::selection colour. An
        // opaque active-line fill therefore hides the selection on the very
        // line being edited, so drop the fill while a range is selected.
        "&.cm-has-selection .cm-activeLine": {
          backgroundColor: "transparent",
        },
        ".cm-activeLineGutter": { backgroundColor: "var(--active-gutter)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
          { backgroundColor: "var(--selection) !important" },
        ".cm-panels": { backgroundColor: "var(--face)", color: "var(--ink)" },
        ".cm-tooltip": {
          backgroundColor: "var(--tooltip)",
          color: "var(--ink)",
          border: "1px solid var(--bevel-mid)",
        },
        ".cm-diagnostic-error": { borderLeftColor: "var(--danger-ink)" },
        ".cm-diagnostic-warning": { borderLeftColor: "var(--caution-ink)" },
        "&.cm-focused": { outline: "none" },
      }),
    ];
  }

  function notify(editor: EditorView) {
    if (applyingExternal) return;
    const range = editor.state.selection.main;
    onchange(
      editor.state.doc.toString(),
      { anchor: range.anchor, head: range.head },
      editor.scrollDOM.scrollTop,
    );
  }

  function extensions() {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      // Marks the editor while any range is non-empty, so the theme can clear
      // the active-line fill that would otherwise cover the selection.
      EditorView.editorAttributes.of((view) =>
        view.state.selection.ranges.some((range) => !range.empty)
          ? { class: "cm-has-selection" }
          : null,
      ),
      language.of(
        sql({
          dialect: PostgreSQL,
          schema: completionSchema,
          upperCaseKeywords: true,
        }),
      ),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(sqlColors),
      indentOnInput(),
      bracketMatching(),
      autocompletion(),
      search({ top: true }),
      // The status bar, the message log and Patchouli's notes all reported the
      // failing line; the line itself carried nothing. A gutter marker puts the
      // report where the mistake is, and hovering it shows the message.
      lintGutter(),
      keymap.of([
        {
          key: "F5",
          run: () => {
            onrun();
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            onrun();
            return true;
          },
        },
        {
          key: "Mod-s",
          run: () => {
            onsave();
            return true;
          },
        },
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) notify(update.view);
      }),
      EditorView.domEventHandlers({
        scroll: (_event, editor) => {
          notify(editor);
        },
        // The popup is positioned against the editor, so it must not outlive
        // the editor's focus: a toolbar click leaves it hanging otherwise.
        blur: (_event, editor) => {
          closeCompletion(editor);
          return false;
        },
      }),
      appearance.of(appearanceExtensions()),
    ];
  }

  function boundedSelection(length: number) {
    return EditorSelection.single(
      Math.max(0, Math.min(selection.anchor, length)),
      Math.max(0, Math.min(selection.head, length)),
    );
  }

  function remember() {
    if (view && activeId)
      documents.set(activeId, {
        state: view.state,
        scrollTop: view.scrollDOM.scrollTop,
      });
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({ extensions: extensions() }),
    });
    return () => {
      remember();
      view?.destroy();
    };
  });

  $effect(() => {
    const editor = view;
    const nextId = id;
    const text = value;
    const nextSelection = boundedSelection(text.length);
    const restoredScroll = scrollTop;
    if (!editor) return;
    applyingExternal = true;
    try {
      if (activeId !== nextId) {
        remember();
        activeId = nextId;
        const saved = documents.get(nextId);
        let state =
          saved?.state ??
          EditorState.create({
            doc: text,
            selection: nextSelection,
            extensions: extensions(),
          });
        if (saved)
          state = state.update({
            effects: StateEffect.reconfigure.of(extensions()),
          }).state;
        if (state.doc.toString() !== text)
          state = state.update({
            changes: { from: 0, to: state.doc.length, insert: text },
            selection: nextSelection,
          }).state;
        else state = state.update({ selection: nextSelection }).state;
        editor.setState(state);
        editor.scrollDOM.scrollTop = saved?.scrollTop ?? restoredScroll;
      } else if (editor.state.doc.toString() !== text) {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
          selection: nextSelection,
          // A whole-document replacement is its own undo step. Without this,
          // CodeMirror merges it into the typing group that preceded it, so one
          // Ctrl+Z reverts the replacement *and* the learner's last sentence of
          // typing.
          annotations: isolateHistory.of("full"),
        });
      } else if (!editor.state.selection.eq(nextSelection)) {
        editor.dispatch({ selection: nextSelection });
      }
    } finally {
      applyingExternal = false;
    }
  });

  $effect(() => {
    const settings = appearanceExtensions();
    view?.dispatch({ effects: appearance.reconfigure(settings) });
  });

  $effect(() => {
    const schema = completionSchema;
    view?.dispatch({
      effects: language.reconfigure(
        sql({
          dialect: PostgreSQL,
          schema,
          upperCaseKeywords: true,
        }),
      ),
    });
  });

  $effect(() => {
    const editor = view;
    const currentRevision = revision;
    const currentId = id;
    const current = diagnostics.filter(
      (item) => item.revision === currentRevision,
    );
    if (!editor || activeId !== currentId) return;
    editor.dispatch(
      setDiagnostics(
        editor.state,
        current.map((item) => ({
          from: Math.max(0, Math.min(item.from, editor.state.doc.length)),
          to: Math.max(
            0,
            Math.min(Math.max(item.from, item.to), editor.state.doc.length),
          ),
          severity:
            item.severity === "style"
              ? ("info" as const)
              : item.severity === "information"
                ? ("info" as const)
                : item.severity,
          message: item.message,
          source: item.ruleId,
        })),
      ),
    );
  });

  export function focus() {
    view?.focus();
  }
  export function dismissCompletion() {
    if (view) closeCompletion(view);
  }
  export function getSelection() {
    const range = view?.state.selection.main;
    return { anchor: range?.anchor ?? 0, head: range?.head ?? 0 };
  }
  export function selectRange(from: number, to: number) {
    if (!view) return;
    const length = view.state.doc.length;
    view.dispatch({
      selection: {
        anchor: Math.max(0, Math.min(from, length)),
        head: Math.max(0, Math.min(to, length)),
      },
      scrollIntoView: true,
    });
    view.focus();
  }

  async function clipboard(action: "cut" | "copy" | "paste") {
    const editor = view;
    if (!editor) return;
    clipboardMessage = "";
    editor.focus();
    const state = editor.state;
    const documentId = activeId;
    try {
      if (action === "paste") {
        const text = await navigator.clipboard.readText();
        if (
          view !== editor ||
          activeId !== documentId ||
          editor.state !== state
        ) {
          clipboardMessage =
            "The selection changed. Use Ctrl+V or Command+V to paste at the current caret.";
          return;
        }
        editor.dispatch(state.replaceSelection(text));
      } else {
        const range = state.selection.main;
        await navigator.clipboard.writeText(
          state.sliceDoc(range.from, range.to),
        );
        if (
          action === "cut" &&
          view === editor &&
          activeId === documentId &&
          editor.state === state
        )
          editor.dispatch(state.replaceSelection(""));
      }
    } catch {
      clipboardMessage = `Clipboard permission unavailable. Use ${action === "paste" ? "Ctrl+V or Command+V" : action === "cut" ? "Ctrl+X or Command+X" : "Ctrl+C or Command+C"} in the editor.`;
    }
  }

  export function command(name: string): void {
    if (!view) return;
    closeCompletion(view);
    view.focus();
    switch (name) {
      case "undo":
        undo(view);
        break;
      case "redo":
        redo(view);
        break;
      case "selectAll":
        selectAll(view);
        break;
      case "find":
        openSearchPanel(view);
        break;
      case "replace":
        openSearchPanel(view);
        requestAnimationFrame(() =>
          view?.dom
            .querySelector<HTMLInputElement>('.cm-search input[name="replace"]')
            ?.focus(),
        );
        break;
      case "gotoLine":
        gotoLine(view);
        break;
      case "cut":
      case "copy":
      case "paste":
        void clipboard(name);
        break;
      case "closeSearch":
        closeSearchPanel(view);
        break;
    }
  }
</script>

<div class="sql-editor" bind:this={host}></div>
<span id="sql-editor-help" class="editor-help"
  >SQL, PostgreSQL-style highlighting for DuckDB. F5 or Control+Enter runs.
  Control+S saves. On macOS use Command. Tab leaves the editor; Escape then Tab
  also leaves it.</span
>
{#if clipboardMessage}<div class="clipboard-message" role="status">
    {clipboardMessage}
  </div>{/if}

<style>
  .sql-editor {
    height: 100%;
    min-height: 120px;
    overflow: hidden;
    position: relative;
    background: white;
  }
  .sql-editor:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .editor-help {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .clipboard-message {
    padding: 4px 8px;
    color: var(--danger-ink);
    background: var(--tooltip);
  }
</style>
