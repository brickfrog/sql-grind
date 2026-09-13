<script lang="ts">
  import { tick, untrack } from "svelte";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { formatCount, type ResultHandle } from "../lib/types";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";

  let {
    result,
    stale,
    busy,
  }: { result: ResultHandle | null; stale: boolean; busy: boolean } = $props();
  let viewport = $state<HTMLDivElement>();
  let grid = $state<HTMLDivElement>();
  let paginated = $state(false);
  let page = $state(0);
  let row = $state(0);
  let column = $state(0);
  let copyStatus = $state("");
  let cellMenu = $state<{
    x: number;
    y: number;
    label: string;
    returnFocus: HTMLElement | null;
    items: ContextMenuItem[];
  } | null>(null);
  const rowHeight = 25;
  const pageSize = 50;
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => viewport ?? null,
    estimateSize: () => rowHeight,
    overscan: 6,
    scrollPaddingStart: 42,
  });
  const count = $derived(result?.count ?? 0);
  const columns = $derived(result?.columns ?? []);
  // Per-column widths, seeded from the SQL type so timestamps are readable
  // without a drag. A new result starts from the type-derived defaults.
  let widths = $state<number[]>([]);
  const defaultWidth = (type: string) =>
    /TIMESTAMP/i.test(type) ? 220 : /DATE|TIME/i.test(type) ? 120 : 160;
  const columnWidth = (index: number) =>
    widths[index] ?? defaultWidth(columns[index]?.type ?? "");
  const template = $derived(
    `48px ${columns.map((_, index) => `${columnWidth(index)}px`).join(" ")}`,
  );
  const gridWidth = $derived(
    48 + columns.reduce((total, _, index) => total + columnWidth(index), 0),
  );
  const visibleRows = $derived($virtualizer.getVirtualItems());
  const pageCount = $derived(Math.max(1, Math.ceil(count / pageSize)));
  const pageRows = $derived(
    Array.from(
      { length: Math.max(0, Math.min(pageSize, count - page * pageSize)) },
      (_, i) => page * pageSize + i,
    ),
  );
  const activeId = $derived(
    visibleRows.some((item) => item.index === row) && columns.length
      ? `result-cell-${row}-${column}`
      : undefined,
  );

  $effect(() => {
    const rows = count;
    const element = viewport;
    const enabled = !paginated;
    untrack(() =>
      $virtualizer.setOptions({
        count: rows,
        getScrollElement: () => element ?? null,
        enabled,
      }),
    );
  });

  $effect(() => {
    const nextResult = result;
    untrack(() => {
      row = 0;
      column = 0;
      page = 0;
      copyStatus = "";
      cellMenu = null;
      if (nextResult && viewport) viewport.scrollTop = 0;
      widths = [];
    });
  });

  function cellText(cell: string | null | undefined): string {
    return cell === null ? "NULL" : (cell ?? "");
  }

  function tsvField(value: string): string {
    return /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }
  function csvField(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }

  function setWidth(index: number, value: number) {
    const next = columns.map((_, i) => columnWidth(i));
    next[index] = Math.max(60, Math.round(value));
    widths = next;
  }

  function startResize(event: PointerEvent, index: number) {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const start = columnWidth(index);
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) =>
      setWidth(index, start + next.clientX - startX);
    const release = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", release);
      handle.removeEventListener("pointercancel", release);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", release);
  }

  function resizeKey(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(index, columnWidth(index) + step);
  }

  function exportCsv() {
    if (!result || !count || !columns.length) return;
    const lines = [columns.map((field) => csvField(field.name)).join(",")];
    for (let index = 0; index < count; index++) {
      const cells = result.getRow(index);
      lines.push(
        columns.map((_, field) => csvField(cellText(cells[field]))).join(","),
      );
    }
    const url = URL.createObjectURL(
      new Blob([lines.join("\r\n") + "\r\n"], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "result.csv";
    link.click();
    URL.revokeObjectURL(url);
    copyStatus = `Exported ${formatCount(count, "row")} to result.csv. NULL values export as the text NULL.`;
  }

  function openCellMenu(
    event: MouseEvent | KeyboardEvent,
    index: number,
    col: number,
  ) {
    if (!result || index < 0 || index >= count || !columns[col]) return;
    event.preventDefault();
    event.stopPropagation();
    row = index;
    column = col;
    const cell = document.getElementById(
      `${paginated ? "table" : "result"}-cell-${index}-${col}`,
    );
    const returnFocus = paginated ? cell : (grid ?? null);
    const bounds = (cell ?? returnFocus)?.getBoundingClientRect();
    const pointer =
      event instanceof MouseEvent &&
      (event.clientX !== 0 || event.clientY !== 0)
        ? event
        : null;
    copyStatus = "";
    cellMenu = {
      x: pointer ? pointer.clientX : (bounds?.left ?? 0),
      y: pointer ? pointer.clientY : (bounds?.bottom ?? 0),
      label: `Result row ${index + 1}, ${columns[col].name}`,
      returnFocus,
      items: [
        {
          label: "Copy Cell",
          action: () => void copySelection("cell", index, col),
        },
        {
          label: "Copy Row",
          action: () => void copySelection("row", index, col),
        },
        {
          label: "Copy Row with Headers",
          action: () => void copySelection("headers", index, col),
        },
        {
          label: "Copy All with Headers",
          action: () => void copySelection("all", index, col),
        },
      ],
    };
  }

  async function move(nextRow: number, nextColumn: number) {
    if (!count || !columns.length) return;
    row = Math.max(0, Math.min(count - 1, nextRow));
    column = Math.max(0, Math.min(columns.length - 1, nextColumn));
    if (paginated) {
      page = Math.floor(row / pageSize);
      await tick();
      document.getElementById(`table-cell-${row}-${column}`)?.focus();
    } else {
      $virtualizer.scrollToIndex(row, { align: "auto" });
      await tick();
      document
        .getElementById(`result-cell-${row}-${column}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      grid?.focus({ preventScroll: true });
    }
  }

  function navigate(event: KeyboardEvent) {
    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
    ) {
      openCellMenu(event, row, column);
      return;
    }
    if (!count || !columns.length || event.altKey) return;
    const step = paginated
      ? pageSize
      : Math.max(
          1,
          Math.floor(((viewport?.clientHeight ?? 250) - 42) / rowHeight),
        );
    let nextRow = row;
    let nextColumn = column;
    switch (event.key) {
      case "ArrowUp":
        nextRow--;
        break;
      case "ArrowDown":
        nextRow++;
        break;
      case "ArrowLeft":
        nextColumn--;
        break;
      case "ArrowRight":
        nextColumn++;
        break;
      case "Home":
        nextColumn = 0;
        if (event.ctrlKey || event.metaKey) nextRow = 0;
        break;
      case "End":
        nextColumn = columns.length - 1;
        if (event.ctrlKey || event.metaKey) nextRow = count - 1;
        break;
      case "PageUp":
        nextRow -= step;
        break;
      case "PageDown":
        nextRow += step;
        break;
      default:
        return;
    }
    event.preventDefault();
    void move(nextRow, nextColumn);
  }

  function copy(event: ClipboardEvent) {
    if (!count || !columns.length) return;
    if (!event.clipboardData) {
      copyStatus = "Clipboard unavailable. Use the Copy cell button to retry.";
      return;
    }
    event.preventDefault();
    try {
      event.clipboardData.setData(
        "text/plain",
        cellText(result?.getRow(row)[column]),
      );
      copyStatus = `Copied row ${row + 1}, ${columns[column].name}.`;
    } catch {
      copyStatus = "Clipboard unavailable. Use the Copy cell button to retry.";
    }
  }

  async function copySelection(
    format: "cell" | "row" | "headers" | "all",
    index: number,
    col: number,
  ) {
    copyStatus = "";
    try {
      const header = columns.map((field) => tsvField(field.name)).join("\t");
      const rowText = (target: number) => {
        const cells = result?.getRow(target);
        return columns
          .map((_, field) => tsvField(cellText(cells?.[field])))
          .join("\t");
      };
      let text: string;
      if (format === "cell") text = cellText(result?.getRow(index)[col]);
      else if (format === "all")
        text = [
          header,
          ...Array.from({ length: count }, (_, target) => rowText(target)),
        ].join("\n");
      else
        text =
          format === "headers"
            ? `${header}\n${rowText(index)}`
            : rowText(index);
      const status =
        format === "cell"
          ? `Copied row ${index + 1}, ${columns[col].name}.`
          : format === "all"
            ? `Copied ${formatCount(count, "row")} with headers. NULL values copy as the text NULL.`
            : `Copied row ${index + 1}${format === "headers" ? " with headers" : ""}.`;
      await navigator.clipboard.writeText(text);
      copyStatus = status;
    } catch {
      copyStatus =
        "Clipboard permission unavailable. Focus the selected cell and press Ctrl+C or Command+C.";
    }
  }

  async function copyCell() {
    await copySelection("cell", row, column);
  }

  function changePage(next: number) {
    page = Math.max(0, Math.min(pageCount - 1, next));
    row = Math.min(count - 1, page * pageSize);
  }
</script>

<section class="result-panel" aria-label="Query results" aria-busy={busy}>
  <div class="result-tools">
    <span
      >{result
        ? `${formatCount(count, "row")} · ${formatCount(columns.length, "column")}`
        : "No result"}</span
    >
    {#if busy}<strong>Running…</strong>{/if}
    {#if stale && result}<strong class="stale">Stale — SQL changed</strong>{/if}
    <button
      type="button"
      onclick={() => {
        paginated = !paginated;
        page = Math.floor(row / pageSize);
      }}
      aria-pressed={paginated}
      >{paginated
        ? "Virtual grid"
        : `Accessible table (${pageSize} rows per page)`}</button
    >
    <button
      type="button"
      disabled={!count || !columns.length}
      onclick={copyCell}>Copy cell</button
    >
    <button
      type="button"
      disabled={!count || !columns.length}
      onclick={exportCsv}>Export CSV</button
    >
  </div>
  {#if !result}
    <p class="empty">
      {busy
        ? "Waiting for a complete result. Editing remains available."
        : "Execute SQL to inspect its results. Execute does not grade your answer."}
    </p>
  {:else if paginated}
    <div class="page-controls" aria-label="Result pagination">
      <button type="button" disabled={page === 0} onclick={() => changePage(0)}
        >First</button
      >
      <button
        type="button"
        disabled={page === 0}
        onclick={() => changePage(page - 1)}>Previous</button
      >
      <span
        >Page {page + 1} of {pageCount} · {count
          ? `${page * pageSize + 1}–${Math.min(count, (page + 1) * pageSize)}`
          : "0"} of {formatCount(count, "row")}</span
      >
      <button
        type="button"
        disabled={page >= pageCount - 1}
        onclick={() => changePage(page + 1)}>Next</button
      >
      <button
        type="button"
        disabled={page >= pageCount - 1}
        onclick={() => changePage(pageCount - 1)}>Last</button
      >
    </div>
    <div class="table-scroll">
      <table oncopy={copy}>
        <caption
          >Exact query output, page {page + 1}. NULL is a missing value; an
          empty string is blank.</caption
        >
        <thead
          ><tr
            ><th scope="col">Row</th>{#each columns as col}<th scope="col"
                >{col.name}<small title={`SQL type: ${col.type}`}
                  >{col.type}</small
                ></th
              >{/each}</tr
          ></thead
        >
        <tbody>
          {#each pageRows as index}
            {@const values = result.getRow(index)}
            <tr
              ><th scope="row">{index + 1}</th>
              {#each columns as col, colIndex}
                <td
                  class:selected={row === index && column === colIndex}
                  oncontextmenu={(event) =>
                    openCellMenu(event, index, colIndex)}
                >
                  <button
                    type="button"
                    id={`table-cell-${index}-${colIndex}`}
                    tabindex={row === index && column === colIndex ? 0 : -1}
                    class="table-value"
                    class:null-value={values[colIndex] === null}
                    aria-label={values[colIndex] === null
                      ? "NULL (missing value)"
                      : values[colIndex] === ""
                        ? "Empty string"
                        : undefined}
                    aria-haspopup="menu"
                    onkeydown={navigate}
                    onfocus={() => {
                      row = index;
                      column = colIndex;
                    }}
                    onclick={() => {
                      row = index;
                      column = colIndex;
                    }}
                    >{values[colIndex] === null
                      ? "NULL"
                      : values[colIndex]}</button
                  >
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if count === 0}<p class="empty">Query completed with zero rows.</p>{/if}
    </div>
  {:else}
    <div bind:this={viewport} class="grid-scroll">
      <div
        bind:this={grid}
        class="grid"
        role="grid"
        tabindex="0"
        aria-label="Exact query output"
        aria-describedby="result-grid-help"
        aria-rowcount={count + 1}
        aria-colcount={columns.length + 1}
        aria-activedescendant={activeId}
        onkeydown={navigate}
        oncopy={copy}
        style:min-width={`${gridWidth}px`}
      >
        <div
          class="grid-header"
          role="row"
          aria-rowindex="1"
          style:grid-template-columns={template}
        >
          <div role="columnheader" aria-colindex="1">Row</div>
          {#each columns as col, colIndex}<div
              role="columnheader"
              aria-colindex={colIndex + 2}
              class="resizable"
            >
              {col.name}<small title={`SQL type: ${col.type}`}>{col.type}</small
              ><button
                type="button"
                class="column-grip"
                aria-label={`Resize ${col.name}, ${columnWidth(colIndex)} pixels`}
                title="Drag or use Left/Right arrows; double-click resets"
                onpointerdown={(event) => startResize(event, colIndex)}
                onkeydown={(event) => resizeKey(event, colIndex)}
                ondblclick={() => setWidth(colIndex, defaultWidth(col.type))}
              ></button>
            </div>{/each}
        </div>
        <div
          class="virtual-body"
          role="rowgroup"
          style:height={`${$virtualizer.getTotalSize()}px`}
        >
          {#each visibleRows as item (item.key)}
            {@const values = result.getRow(item.index)}
            <div
              class="grid-row"
              role="row"
              aria-rowindex={item.index + 2}
              style:grid-template-columns={template}
              style:transform={`translateY(${item.start}px)`}
            >
              <div role="rowheader" aria-colindex="1" class="row-number">
                {item.index + 1}
              </div>
              {#each columns as col, colIndex}
                <div
                  role="gridcell"
                  id={`result-cell-${item.index}-${colIndex}`}
                  tabindex="-1"
                  aria-colindex={colIndex + 2}
                  aria-selected={row === item.index && column === colIndex}
                  class:selected={row === item.index && column === colIndex}
                  class:null-value={values[colIndex] === null}
                  aria-label={values[colIndex] === null
                    ? "NULL (missing value)"
                    : values[colIndex] === ""
                      ? "Empty string"
                      : undefined}
                  oncontextmenu={(event) =>
                    openCellMenu(event, item.index, colIndex)}
                  onfocus={() => {
                    row = item.index;
                    column = colIndex;
                  }}
                  onkeydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      row = item.index;
                      column = colIndex;
                      grid?.focus({ preventScroll: true });
                    }
                  }}
                  onclick={() => {
                    row = item.index;
                    column = colIndex;
                    grid?.focus({ preventScroll: true });
                  }}
                >
                  {values[colIndex] === null ? "NULL" : values[colIndex]}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
      {#if count === 0}<p class="empty">Query completed with zero rows.</p>{/if}
    </div>
  {/if}
  <div class="grid-help" id="result-grid-help">
    Arrows: move cell · Home/End: row edges · Page Up/Down: page · Ctrl+C /
    Command+C: exact cell value · Right-click / Shift+F10: copy menu. NULL ≠
    empty string.
  </div>
  {#if copyStatus}<div role="status" class="copy-status">{copyStatus}</div>{/if}
  {#if cellMenu}
    {#key cellMenu}
      <ContextMenu
        {...cellMenu}
        onclose={() => {
          cellMenu = null;
        }}
      />
    {/key}
  {/if}
</section>

<style>
  .result-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 120px;
    min-width: 0;
    background: #fff;
    color: #000;
    font:
      11px Tahoma,
      sans-serif;
  }
  .result-tools,
  .page-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 3px 5px;
    background: #d4d0c8;
    border-bottom: 1px solid #808080;
    flex: none;
  }
  .result-tools > button:first-of-type {
    margin-left: auto;
  }
  button {
    min-height: 24px;
    border: 1px solid;
    border-color: #fff #404040 #404040 #fff;
    border-radius: 0;
    background: #d4d0c8;
    color: #000;
    font: inherit;
    padding: 2px 7px;
  }
  button:disabled {
    color: #666;
  }
  button:focus-visible {
    outline: 2px solid #0a246a;
    outline-offset: -3px;
  }
  .stale {
    color: #704500;
  }
  .grid-scroll,
  .table-scroll {
    overflow: auto;
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .grid:focus-visible {
    outline: 2px solid #0a246a;
    outline-offset: -2px;
  }
  .grid-header,
  .grid-row {
    display: grid;
  }
  .grid-header {
    position: sticky;
    top: 0;
    z-index: 1;
    background: #d4d0c8;
    height: 42px;
  }
  .grid-header > div {
    padding: 3px 6px;
    font-weight: bold;
    border: 1px solid;
    border-color: #fff #808080 #808080 #fff;
    overflow: hidden;
  }
  .grid-header > div.resizable {
    position: relative;
  }
  .column-grip {
    border: 0;
    padding: 0;
    border-radius: 0;
    position: absolute;
    top: 0;
    right: 0;
    width: 5px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    touch-action: none;
  }
  .column-grip:hover,
  .column-grip:focus-visible {
    background: #0a246a;
    outline: none;
  }
  small {
    display: block;
    font-size: 10px;
    color: #484848;
    font-weight: normal;
  }
  .virtual-body {
    position: relative;
  }
  .grid-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 25px;
  }
  .grid-row > div {
    padding: 4px 6px;
    border-right: 1px solid #d4d0c8;
    border-bottom: 1px solid #e4e0d8;
    overflow: hidden;
    white-space: pre;
    font-family: "DejaVu Sans Mono", Consolas, monospace;
    color: #111;
  }
  .grid-row:nth-child(even) {
    background: #f6f5f2;
  }
  .row-number {
    text-align: right;
    background: #eeece6;
    color: #444;
  }
  .selected {
    background: #0a246a !important;
    color: white !important;
    box-shadow: inset 0 0 0 1px white;
  }
  .null-value {
    font-style: italic;
    color: #444;
  }
  .grid-help {
    background: #f0eee8;
    padding: 3px 6px;
    font-size: 10px;
    flex: none;
  }
  .copy-status {
    background: #ffffe1;
    padding: 3px 6px;
  }
  .empty {
    margin: 0;
    padding: 14px;
    color: #444;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 11px;
  }
  caption {
    text-align: left;
    padding: 5px;
  }
  th {
    background: #d4d0c8;
    text-align: left;
    padding: 3px 6px;
    border: 1px solid #808080;
    white-space: nowrap;
  }
  td {
    border: 1px solid #ddd;
    padding: 0;
  }
  .table-value {
    display: block;
    width: 100%;
    text-align: left;
    min-height: 24px;
    white-space: pre;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: "DejaVu Sans Mono", Consolas, monospace;
  }
  @media (forced-colors: active) {
    .selected {
      outline: 2px solid Highlight;
    }
  }
</style>
