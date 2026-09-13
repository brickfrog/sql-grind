<script module lang="ts">
  let savedZoom = "fit";
  let savedScroll = { left: 0, top: 0 };
</script>

<script lang="ts">
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
  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 64;
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
    return [...columns.entries()].flatMap(([level, tables]) =>
      tables.map((table, index) => ({
        table,
        x: 40 + level * 240,
        y: 40 + index * 120,
        selfReferencing: table.references.some(
          (reference) => reference.table === table.name,
        ),
        primaryKey:
          table.columns.find((column) => column.key?.includes("PRIMARY KEY"))
            ?.name ?? "",
      })),
    );
  });
  const nodeByName = $derived(
    new Map(nodes.map((node) => [node.table.name, node])),
  );
  // Referencing tables sit to the right of what they reference, so an edge
  // leaves and enters the sides that face each other: a fixed right-to-left
  // pair would draw every line back across its own node.
  const edges = $derived(
    nodes.flatMap((node) =>
      (outgoing.get(node.table.name) ?? []).flatMap((reference) => {
        const target = nodeByName.get(reference.table);
        if (!target) return [];
        const rightward = target.x > node.x;
        return [
          {
            reference,
            x1: rightward ? node.x + NODE_WIDTH : node.x,
            y1: node.y + NODE_HEIGHT / 2,
            x2: rightward ? target.x : target.x + NODE_WIDTH,
            y2: target.y + NODE_HEIGHT / 2,
          },
        ];
      }),
    ),
  );
  const canvasWidth = $derived(
    Math.max(720, ...nodes.map((node) => node.x + NODE_WIDTH + 20)),
  );
  const canvasHeight = $derived(
    Math.max(520, ...nodes.map((node) => node.y + NODE_HEIGHT + 36)),
  );
  const scale = $derived(
    zoom === "fit"
      ? Math.max(0.1, Math.min(width / canvasWidth, height / canvasHeight, 1.5))
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
        ><option value="150">150%</option><option value="fit">Fit</option>
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
                  {/if}{reference.column} → {reference.table}.{reference.toColumn}{/each}{:else}None{/if}
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
              <!-- refX places the tip at the line end, so arrows point into the referenced table. -->
              <marker
                id="erd-edge"
                viewBox="0 0 4 4"
                refX="4"
                refY="2"
                markerWidth="4"
                markerHeight="4"
                markerUnits="strokeWidth"
                orient="auto"
              >
                <path d="M0 0 L4 2 L0 4 z" fill="#515151" />
              </marker>
            </defs>
            {#each edges as edge}
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke="#515151"
                stroke-width="2"
                marker-end="url(#erd-edge)"
              />
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
    color: #000;
    background: #fff;
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
    background: #d4d0c8;
    border-bottom: 1px solid #808080;
  }
  .map-toolbar label {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  select {
    min-height: 24px;
    color: #000;
    background: #fff;
    border: 2px inset #d4d0c8;
    font: inherit;
  }
  .preview-note {
    margin: 0;
    padding: 5px 8px;
    background: #ffffe1;
    border-bottom: 1px solid #c0bcb4;
    line-height: 1.4;
  }
  .map-viewport {
    flex: 1;
    min-height: 120px;
    overflow: auto;
    background-color: #fff;
    background-image:
      linear-gradient(#f0f0f0 1px, transparent 1px),
      linear-gradient(90deg, #f0f0f0 1px, transparent 1px);
    background-size: 20px 20px;
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
    width: 180px;
    height: 64px;
    box-sizing: border-box;
    padding: 4px 7px;
    text-align: left;
    background: #c0bcb4;
    color: #303030;
    border: 1px solid;
    border-color: #fff #707070 #707070 #fff;
    box-shadow: 2px 2px 0 #0005;
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
    font-size: 11px;
    line-height: 14px;
  }
  .table-node.selected {
    background: #0a246a;
    color: #fff;
    border-color: #0a246a;
  }
  .self-badge {
    font-size: 9px;
    font-weight: normal;
    padding: 0 3px;
    border: 1px solid #707070;
    background: #ffffe1;
    color: #303030;
  }
  .node-rows,
  .node-key {
    display: block;
    font-size: 10px;
    line-height: 13px;
  }
  .node-key {
    color: #404040;
  }
  .table-node.selected .node-key {
    color: #e9efff;
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
    background: #0a246a;
    color: #fff;
  }
  .linear-tables p {
    margin: 3px 0 0;
    line-height: 1.4;
  }
  footer {
    padding: 5px 8px;
    background: #d4d0c8;
    border-top: 1px solid #808080;
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
