<script module lang="ts">
  let savedZoom = "fit";
  let savedScroll = { left: 0, top: 0 };
</script>

<script lang="ts">
  // Scale is a CSS transform, so labels grow with it: an unbounded Fit renders a
  // small graph at ~4.8x on an ultrawide, which reads worse than the old cap. The
  // manual steps up to 400% cover anyone who wants more.
  const FIT_MAX = 3;

  import { onMount, tick } from "svelte";
  import { formatCount, type SchemaTable } from "../lib/types";

  let {
    schema,
    readingLayout,
    selected,
    onselect,
  }: {
    schema: SchemaTable[];
    readingLayout: boolean;
    selected: string;
    onselect: (table: string) => void;
  } = $props();
  let zoom = $state(savedZoom);
  let viewport = $state<HTMLDivElement>();
  let width = $state(720);
  let height = $state(520);

  // Tables carry no authored coordinates, so the layout is derived from the
  // foreign keys: depth 0 is a table that references nothing.
  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 84;
  const byName = $derived(new Map(schema.map((table) => [table.name, table])));
  const outgoing = $derived(
    new Map(
      schema.map((table) => [
        table.name,
        table.references.filter(
          (reference) =>
            reference.table !== table.name && byName.has(reference.table),
        ),
      ]),
    ),
  );
  const depths = $derived.by(() => {
    const known = new Map<string, number>();
    const visiting = new Set<string>();
    // A cycle yields depth 0 rather than recursing forever.
    const depth = (name: string): number => {
      const cached = known.get(name);
      if (cached !== undefined) return cached;
      if (visiting.has(name)) return 0;
      visiting.add(name);
      const targets = outgoing.get(name) ?? [];
      const value = targets.length
        ? 1 + Math.max(...targets.map((reference) => depth(reference.table)))
        : 0;
      visiting.delete(name);
      known.set(name, value);
      return value;
    };
    for (const table of schema) depth(table.name);
    return known;
  });
  type DiagramNode = {
    table: SchemaTable;
    x: number;
    y: number;
    selfReferencing: boolean;
    primaryKey: string;
    /** Columns that carry a foreign key, so the relationship is visible. */
    foreignKeys: string[];
  };
  const nodes = $derived.by<DiagramNode[]>(() => {
    const columns = new Map<number, SchemaTable[]>();
    for (const table of [...schema].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const level = depths.get(table.name) ?? 0;
      const bucket = columns.get(level) ?? [];
      bucket.push(table);
      columns.set(level, bucket);
    }
    // Lines crossed because each column was ordered alphabetically, ignoring
    // what it connects to. Two barycenter sweeps order every column by the
    // mean row of its neighbours, which is the standard crossing-reduction
    // heuristic and removes most crossings on this schema.
    const levels = [...columns.keys()].sort((a, b) => a - b);
    const rowOf = new Map<string, number>();
    for (const level of levels)
      columns.get(level)!.forEach((table, index) => {
        rowOf.set(table.name, index);
      });
    const neighbours = (table: SchemaTable) => [
      ...table.references.map((reference) => reference.table),
      ...schema
        .filter((other) =>
          other.references.some((reference) => reference.table === table.name),
        )
        .map((other) => other.name),
    ];
    for (let sweep = 0; sweep < 2; sweep++)
      for (const level of levels) {
        const bucket = columns.get(level)!;
        const weight = new Map<string, number>();
        for (const table of bucket) {
          const rows = neighbours(table)
            .filter((name) => name !== table.name)
            .map((name) => rowOf.get(name))
            .filter((row): row is number => row !== undefined);
          weight.set(
            table.name,
            rows.length
              ? rows.reduce((total, row) => total + row, 0) / rows.length
              : (rowOf.get(table.name) ?? 0),
          );
        }
        bucket.sort(
          (a, b) =>
            weight.get(a.name)! - weight.get(b.name)! ||
            a.name.localeCompare(b.name),
        );
        bucket.forEach((table, index) => {
          rowOf.set(table.name, index);
        });
      }
    return levels.flatMap((level) =>
      columns.get(level)!.map((table, index) => ({
        table,
        x: 40 + level * 340,
        y: 40 + index * (NODE_HEIGHT + 40),
        selfReferencing: table.references.some(
          (reference) => reference.table === table.name,
        ),
        primaryKey:
          table.columns.find((column) => column.key?.includes("PRIMARY KEY"))
            ?.name ?? "",
        foreignKeys: [
          ...new Set(table.references.map((reference) => reference.column)),
        ],
      })),
    );
  });
  /**
   * Many-to-one unless the referencing column is itself unique. The drawn edge
   * and the reading-layout list both read this, so the textual equivalent can
   * never say less than the picture.
   */
  function cardinality(table: SchemaTable, column: string): string {
    const declared = table.columns.find((entry) => entry.name === column);
    return /PRIMARY KEY|UNIQUE/.test(declared?.key ?? "") ? "1:1" : "N:1";
  }
  const nodeByName = $derived(
    new Map(nodes.map((node) => [node.table.name, node])),
  );
  // Referencing tables sit to the right of what they reference, so an edge
  // leaves and enters the sides that face each other: a fixed right-to-left
  // pair would draw every line back across its own node.
  const edges = $derived.by(() =>
    nodes.flatMap((node) => {
      const references = outgoing.get(node.table.name) ?? [];
      return references.flatMap((reference, index) => {
        const target = nodeByName.get(reference.table);
        if (!target) return [];
        const rightward = target.x > node.x;
        // Several references leaving one table used to overlap exactly. Fan
        // their departure points so each line is followable.
        const spread = (index - (references.length - 1) / 2) * 12;
        return [
          {
            reference,
            from: node,
            to: target,
            cardinality: cardinality(node.table, reference.column),
            x1: rightward ? node.x + NODE_WIDTH : node.x,
            y1: node.y + NODE_HEIGHT / 2 + spread,
            x2: rightward ? target.x : target.x + NODE_WIDTH,
            y2: target.y + NODE_HEIGHT / 2,
          },
        ];
      });
    }),
  );
  const canvasWidth = $derived(
    Math.max(720, ...nodes.map((node) => node.x + NODE_WIDTH + 20)),
  );
  const canvasHeight = $derived(
    Math.max(520, ...nodes.map((node) => node.y + NODE_HEIGHT + 36)),
  );
  // Fit means fit; see SkillMap. A capped fit put a 675x228 diagram in the
  // corner of a 2066x1462 canvas.
  const scale = $derived(
    zoom === "fit"
      ? Math.max(
          0.1,
          Math.min(width / canvasWidth, height / canvasHeight, FIT_MAX),
        )
      : Number(zoom) / 100,
  );
  const edgeCount = $derived(
    schema.reduce((total, table) => total + table.references.length, 0),
  );

  onMount(() => {
    const element = viewport;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      width = box.width;
      height = box.height;
    });
    observer.observe(element);
    element.scrollLeft = savedScroll.left;
    element.scrollTop = savedScroll.top;
    return () => {
      observer.disconnect();
    };
  });

  function rememberCanvas() {
    if (viewport)
      savedScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
  }

  async function selectTable(name: string, focus = false) {
    onselect(name);
    if (focus) {
      await tick();
      const element = document.getElementById(
        `table-${readingLayout ? "list" : "diagram"}-${name}`,
      );
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function navigate(event: KeyboardEvent, current: DiagramNode) {
    let target: DiagramNode | undefined;
    if (event.key === "Home") target = nodes[0];
    else if (event.key === "End") target = nodes[nodes.length - 1];
    else if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      const horizontal =
        event.key === "ArrowLeft" || event.key === "ArrowRight";
      const sign =
        event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const index = nodes.findIndex(
        (node) => node.table.name === current.table.name,
      );
      target = readingLayout
        ? nodes[Math.max(0, Math.min(nodes.length - 1, index + sign))]
        : nodes
            .filter(
              (node) =>
                (horizontal ? node.x - current.x : node.y - current.y) * sign >
                0,
            )
            .sort((a, b) => {
              const score = (node: DiagramNode) =>
                Math.abs(horizontal ? node.x - current.x : node.y - current.y) +
                2 *
                  Math.abs(
                    horizontal ? node.y - current.y : node.x - current.x,
                  );
              return score(a) - score(b);
            })[0];
    } else return;
    event.preventDefault();
    if (target) void selectTable(target.table.name, true);
  }
</script>

<section class="schema-diagram" aria-label="Schema relationship diagram">
  <header class="map-toolbar">
    <strong>schema.dgm</strong>
    <span
      >{formatCount(schema.length, "table")} · {formatCount(
        edgeCount,
        "reference",
      )}</span
    >
    <label
      >Zoom
      <select
        bind:value={zoom}
        onchange={() => {
          savedZoom = zoom;
        }}
        disabled={readingLayout}
        aria-label="Diagram zoom"
      >
        <option value="75">75%</option><option value="100">100%</option><option
          value="125">125%</option
        ><option value="150">150%</option><option value="200">200%</option
        ><option value="300">300%</option><option value="400">400%</option
        ><option value="fit">Fit</option>
      </select>
    </label>
  </header>
  <p class="preview-note">
    Arrows point from a foreign key to the table it references. A table that
    references itself carries a <b>self</b> badge instead of a looping arrow.
  </p>
  <div bind:this={viewport} class="map-viewport" onscroll={rememberCanvas}>
    {#if readingLayout}
      <ol class="linear-tables" aria-label="Tables and their references">
        {#each nodes as node}
          <li>
            <button
              id={`table-list-${node.table.name}`}
              type="button"
              class:selected={selected === node.table.name}
              aria-pressed={selected === node.table.name}
              onkeydown={(event) => navigate(event, node)}
              onclick={() => selectTable(node.table.name)}
            >
              <strong>{node.table.name}</strong><span
                >{formatCount(node.table.count, "row")}</span
              >
            </button>
            <p>
              References: {#if node.table.references.length}{#each node.table.references as reference, index}{#if index},
                  {/if}{reference.column} → {reference.table}.{reference.toColumn}
                  ({cardinality(
                    node.table,
                    reference.column,
                  )}){/each}{:else}None{/if}
            </p>
          </li>
        {/each}
      </ol>
    {:else}
      <div
        class="scaled-canvas"
        style:width={`${canvasWidth * scale}px`}
        style:height={`${canvasHeight * scale}px`}
      >
        <div
          class="canvas"
          style:width={`${canvasWidth}px`}
          style:height={`${canvasHeight}px`}
          style:transform={`scale(${scale})`}
        >
          <svg
            width={canvasWidth}
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <!-- refX places the tip at the line end, so arrows point into the
                   referenced table. The head is sized in user space: at
                   strokeWidth units it was barely visible at default zoom. -->
              <marker
                id="erd-edge"
                viewBox="0 0 12 12"
                refX="11"
                refY="6"
                markerWidth="12"
                markerHeight="12"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <!-- var() is invalid in an SVG presentation attribute: as an
                     attribute this fill was dropped and the head vanished. -->
                <path class="edge-head" d="M0 0 L12 6 L0 12 z" />
              </marker>
            </defs>
            {#each edges as edge}
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                class="erd-edge-line"
                stroke-width="2"
                marker-end="url(#erd-edge)"
              />
              <!-- One label per edge. Separate markers at each end collided
                   with the column name on short spans, so the cardinality
                   travels with the column it describes: "customer_id N:1"
                   reads as many rows here, one row there. -->
              <text
                class="edge-label"
                x={(edge.x1 + edge.x2) / 2}
                y={(edge.y1 + edge.y2) / 2 - 4}
                text-anchor="middle"
                >{edge.reference.column} {edge.cardinality}</text
              >
            {/each}
          </svg>
          {#each nodes as node}
            <button
              type="button"
              id={`table-diagram-${node.table.name}`}
              class="table-node"
              class:selected={selected === node.table.name}
              style:left={`${node.x}px`}
              style:top={`${node.y}px`}
              tabindex={selected === node.table.name ||
              (!nodeByName.has(selected) && node === nodes[0])
                ? 0
                : -1}
              aria-pressed={selected === node.table.name}
              aria-label={`${node.table.name}. ${formatCount(node.table.count, "row")}.${
                node.primaryKey ? ` Primary key ${node.primaryKey}.` : ""
              }${
                node.foreignKeys.length
                  ? ` Foreign ${node.foreignKeys.length === 1 ? "key" : "keys"} ${node.foreignKeys.join(", ")}.`
                  : ""
              }${node.selfReferencing ? " References itself." : ""}`}
              onkeydown={(event) => navigate(event, node)}
              onclick={() => selectTable(node.table.name)}
            >
              <strong
                >{node.table.name}{#if node.selfReferencing}<span
                    class="self-badge">self</span
                  >{/if}</strong
              >
              <span class="node-rows"
                >{formatCount(node.table.count, "row")}</span
              >
              <span class="node-key"
                >{node.primaryKey
                  ? `PK ${node.primaryKey}`
                  : "No primary key"}</span
              >
              <!-- Which column the relationship runs on was invisible: the box
                   showed only its primary key. -->
              <span class="node-key node-fk"
                >{node.foreignKeys.length
                  ? `FK ${node.foreignKeys.join(", ")}`
                  : "No foreign keys"}</span
              >
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <footer>
    Select a table to inspect it in the schema reference. Arrow keys move
    between tables; Home/End selects the first/last table.
  </footer>
</section>

<style>
  .schema-diagram {
    height: 100%;
    min-height: 300px;
    display: flex;
    flex-direction: column;
    color: var(--ink-strong);
    background: var(--field);
    font:
      11px Tahoma,
      sans-serif;
  }
  .map-toolbar {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    padding: 4px 7px;
    background: var(--face);
    border-bottom: 1px solid var(--bevel-mid);
  }
  .map-toolbar label {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  select {
    min-height: 24px;
    color: var(--ink-strong);
    background: var(--field);
    border: 2px inset var(--face);
    font: inherit;
  }
  .preview-note {
    margin: 0;
    padding: 5px 8px;
    background: var(--tooltip);
    border-bottom: 1px solid var(--face-sunken);
    line-height: 1.4;
  }
  .map-viewport {
    flex: 1;
    min-height: 120px;
    overflow: auto;
    background-color: var(--field);
    background-image:
      linear-gradient(var(--panel-alt) 1px, transparent 1px),
      linear-gradient(90deg, var(--panel-alt) 1px, transparent 1px);
    background-size: 20px 20px;
  }
  /* SVG presentation attributes do not accept var(), so these are real CSS
     rules. As attributes the stroke and fill were dropped and every edge and
     arrowhead disappeared. */
  .erd-edge-line {
    stroke: var(--edge-strong);
  }
  .edge-head {
    fill: var(--edge-strong);
  }
  .edge-label {
    fill: var(--ink);
    font-size: 11px;
    paint-order: stroke;
    stroke: var(--field);
    stroke-width: 3px;
  }
  .node-fk {
    color: var(--ink-soft);
  }
  .scaled-canvas {
    position: relative;
  }
  .canvas {
    transform-origin: top left;
    position: absolute;
  }
  svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .table-node {
    position: absolute;
    width: 200px;
    height: 84px;
    box-sizing: border-box;
    padding: 4px 7px;
    text-align: left;
    background: var(--face-sunken);
    color: var(--ink-mid);
    border: 1px solid;
    border-color: var(--bevel-light) var(--bevel-dim) var(--bevel-dim)
      var(--bevel-light);
    box-shadow: 2px 2px 0 var(--veil);
    border-radius: 0;
    font:
      11px Tahoma,
      sans-serif;
    cursor: pointer;
  }
  .table-node strong {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    line-height: 15px;
  }
  .table-node.selected {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  .self-badge {
    font-size: 10px;
    font-weight: normal;
    padding: 0 3px;
    border: 1px solid var(--bevel-dim);
    background: var(--tooltip);
    color: var(--ink-mid);
  }
  .node-rows,
  .node-key {
    display: block;
    font-size: 11px;
    line-height: 14px;
  }
  .node-key {
    color: var(--ink-muted);
  }
  .table-node.selected .node-key {
    color: var(--accent-ink-soft);
  }
  .linear-tables {
    margin: 0;
    padding: 8px 8px 8px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .linear-tables button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    font: inherit;
  }
  .linear-tables button.selected {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .linear-tables p {
    margin: 3px 0 0;
    line-height: 1.4;
  }
  footer {
    padding: 5px 8px;
    background: var(--face);
    border-top: 1px solid var(--bevel-mid);
    line-height: 1.4;
  }
  @media (forced-colors: active) {
    .table-node,
    .linear-tables button {
      border: 1px solid ButtonText;
    }
    .table-node.selected,
    .linear-tables button.selected {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
</style>
