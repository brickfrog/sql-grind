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
  import { type Skill } from "../lib/catalog";
  import type { Progression, ProgressState } from "../lib/progression";
  import { formatProgress } from "../lib/types";

  let {
    selected,
    skills,
    progression,
    readingLayout,
    onselect,
  }: {
    selected: string;
    skills: Skill[];
    progression: Progression;
    readingLayout: boolean;
    onselect: (id: string) => void;
  } = $props();
  let zoom = $state(savedZoom);
  let viewport = $state<HTMLDivElement>();
  let width = $state(720);
  let height = $state(520);
  const canvasWidth = $derived(
    Math.max(720, ...skills.map((skill) => skill.x + 180)),
  );
  const canvasHeight = $derived(
    Math.max(520, ...skills.map((skill) => skill.y + 82)),
  );
  // Fit means fit. A ceiling here left the graph marooned in the top-left
  // corner of a large display, and the manual steps could not recover it
  // because they stopped below the ratio the viewport allowed.
  const scale = $derived(
    zoom === "fit"
      ? Math.max(
          0.1,
          Math.min(width / canvasWidth, height / canvasHeight, FIT_MAX),
        )
      : Number(zoom) / 100,
  );
  const byId = $derived(new Map(skills.map((skill) => [skill.id, skill])));
  const edges = $derived(
    skills.flatMap((skill) =>
      skill.requires.map((id) => ({ from: byId.get(id)!, to: skill })),
    ),
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

  async function selectSkill(id: string, focus = false) {
    onselect(id);
    if (focus) {
      await tick();
      const element = document.getElementById(
        `skill-${readingLayout ? "list" : "map"}-${id}`,
      );
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function navigate(event: KeyboardEvent, current: Skill) {
    let target: Skill | undefined;
    if (event.key === "Home") target = skills[0];
    else if (event.key === "End") target = skills[skills.length - 1];
    else if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      const horizontal =
        event.key === "ArrowLeft" || event.key === "ArrowRight";
      const sign =
        event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      if (readingLayout) {
        const index = skills.findIndex((skill) => skill.id === current.id);
        target = skills[Math.max(0, Math.min(skills.length - 1, index + sign))];
      } else {
        target = skills
          .filter(
            (skill) =>
              (horizontal ? skill.x - current.x : skill.y - current.y) * sign >
              0,
          )
          .sort((a, b) => {
            const score = (skill: Skill) =>
              Math.abs(horizontal ? skill.x - current.x : skill.y - current.y) +
              2 *
                Math.abs(
                  horizontal ? skill.y - current.y : skill.x - current.x,
                );
            return score(a) - score(b);
          })[0];
      }
    } else return;
    event.preventDefault();
    if (target) void selectSkill(target.id, true);
  }

  function stateLabel(state?: ProgressState) {
    return {
      locked: "Locked",
      available: "Available",
      "in-progress": "In progress",
      completed: "Completed",
      "needs-review": "Needs review",
    }[state ?? "locked"];
  }
  function count(skill: Skill) {
    return (
      progression.skills[skill.id]?.objectives.filter(
        (objective) => objective.completed,
      ).length ?? 0
    );
  }
  // Locked without a reason is a dead end: name the skills that block it.
  function blockedBy(skill: Skill) {
    if (progression.skills[skill.id]?.accessible) return "";
    const names = skill.requires
      .filter((id) => !progression.skills[id]?.completed)
      .map((id) => skills.find((entry) => entry.id === id)?.label ?? id);
    return names.length
      ? ` Locked by ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}.`
      : "";
  }
  function status(skill: Skill) {
    return `${stateLabel(progression.skills[skill.id]?.state)} · ${formatProgress(count(skill), skill.objectives.length, "challenge", "badge")}`;
  }
</script>

<section class="skill-map" aria-label="Skill Map">
  <header class="map-toolbar">
    <strong>Skill Map.dag</strong>
    <span
      >{formatProgress(
        Object.values(progression.skills).filter((skill) => skill.completed)
          .length,
        skills.length,
        "skill",
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
        aria-label="Map zoom"
      >
        <option value="75">75%</option><option value="100">100%</option><option
          value="125">125%</option
        ><option value="150">150%</option><option value="200">200%</option
        ><option value="300">300%</option><option value="400">400%</option
        ><option value="fit">Fit</option>
      </select>
    </label>
  </header>
  {#snippet lockMark()}
    <svg
      class="node-lock"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      ><path
        d="M3.4 5.4V3.6a2.6 2.6 0 0 1 5.2 0v1.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
      /><rect
        x="2.4"
        y="5.4"
        width="7.2"
        height="5.2"
        fill="currentColor"
      /></svg
    >
  {/snippet}
  <div class="legend" aria-label="Map legend">
    <span><i class="completed"></i>Completed</span>
    <span><i class="progress"></i>In progress</span>
    <span><i class="available"></i>Available</span>
    <span class="legend-locked"
      ><i class="locked"></i>{@render lockMark()}Locked</span
    >
    <span><i class="review"></i>Needs review</span>
  </div>
  <p class="preview-note">
    Complete all five current challenges to complete a skill. Previously opened
    skills remain accessible for review. A locked skill can be opened early with
    Practice ahead: right-click its node. That grants access, not completion.
  </p>
  <div bind:this={viewport} class="map-viewport" onscroll={rememberCanvas}>
    {#if readingLayout}
      <ol class="linear-skills" aria-label="Skills in prerequisite order">
        {#each skills as skill}
          <li>
            <button
              id={`skill-list-${skill.id}`}
              type="button"
              class:selected={selected === skill.id}
              aria-pressed={selected === skill.id}
              onkeydown={(event) => navigate(event, skill)}
              onclick={() => selectSkill(skill.id)}
            >
              <strong>{skill.label}</strong><span>{status(skill)}</span>
            </button>
            <p>{skill.description}</p>
            <p>
              Requires: {#if skill.requires.length}{#each skill.requires as required, index}{#if index},
                  {/if}<button
                    type="button"
                    class="requirement"
                    onclick={() => selectSkill(required, true)}
                    >{byId.get(required)!.label} ({stateLabel(
                      progression.skills[required]?.state,
                    )})</button
                  >{/each}{:else}None{/if}
            </p>
            <p>
              {formatProgress(
                count(skill),
                skill.objectives.length,
                "challenge",
              )}.{blockedBy(skill)}
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
              <!-- refX places the tip at the line end, so arrows point into the dependent skill. -->
              <marker
                id="skill-edge-done"
                viewBox="0 0 4 4"
                refX="4"
                refY="2"
                markerWidth="4"
                markerHeight="4"
                markerUnits="strokeWidth"
                orient="auto"
              >
                <!-- var() is invalid in an SVG presentation attribute, so the
                     fill is a CSS rule; as an attribute the arrow vanished. -->
                <path class="edge-head-done" d="M0 0 L4 2 L0 4 z" />
              </marker>
              <marker
                id="skill-edge-todo"
                viewBox="0 0 4 4"
                refX="4"
                refY="2"
                markerWidth="4"
                markerHeight="4"
                markerUnits="strokeWidth"
                orient="auto"
              >
                <path class="edge-head-todo" d="M0 0 L4 2 L0 4 z" />
              </marker>
            </defs>
            {#each edges as edge}
              <line
                x1={edge.from.x + 150}
                y1={edge.from.y + 26}
                x2={edge.to.x}
                y2={edge.to.y + 26}
                class={progression.skills[edge.from.id]?.completed
                  ? "skill-edge-done"
                  : "skill-edge-todo"}
                stroke-width="2"
                stroke-dasharray="4 4"
                marker-end={progression.skills[edge.from.id]?.completed
                  ? "url(#skill-edge-done)"
                  : "url(#skill-edge-todo)"}
              />
            {/each}
          </svg>
          {#each skills as skill}
            <button
              type="button"
              id={`skill-map-${skill.id}`}
              class="skill-node"
              class:available={progression.skills[skill.id]?.state ===
                "available"}
              class:progress={progression.skills[skill.id]?.state ===
                "in-progress"}
              class:completed={progression.skills[skill.id]?.state ===
                "completed"}
              class:review={progression.skills[skill.id]?.state ===
                "needs-review"}
              class:locked={!progression.skills[skill.id]?.accessible}
              class:ahead={progression.skills[skill.id]?.ahead}
              class:selected={selected === skill.id}
              data-context="skill"
              data-skill={skill.id}
              style:left={`${skill.x}px`}
              style:top={`${skill.y}px`}
              tabindex={selected === skill.id ||
              (!byId.has(selected) && skill.id === "basics")
                ? 0
                : -1}
              aria-pressed={selected === skill.id}
              aria-label={`${skill.label}. ${stateLabel(
                progression.skills[skill.id]?.state,
              )}. ${formatProgress(
                count(skill),
                skill.objectives.length,
                "challenge",
              )}.${blockedBy(skill)}${progression.skills[skill.id]?.ahead ? " Practicing ahead." : ""}`}
              onkeydown={(event) => navigate(event, skill)}
              onclick={() => selectSkill(skill.id)}
            >
              <strong>{skill.label}</strong>
              <span class="node-state"
                >{#if !progression.skills[skill.id]?.accessible}{@render lockMark()}{/if}{status(
                  skill,
                )}</span
              >
              <span
                class="node-progress"
                role="progressbar"
                aria-label={`${skill.label} objective completions`}
                aria-valuemin="0"
                aria-valuemax={skill.objectives.length}
                aria-valuenow={count(skill)}
                ><span
                  style:width={`${(100 * count(skill)) / skill.objectives.length}%`}
                ></span></span
              >
              {#if progression.skills[skill.id]?.ahead}<span class="node-ahead"
                  >ahead</span
                >{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <footer>
    Select a skill to inspect all five authored objectives. Arrow keys move
    between nodes; Home/End selects the first/last skill. Locked objectives
    remain inspectable in the detail panel.
  </footer>
</section>

<style>
  .skill-map {
    /* One source of truth: a legend swatch is definitionally its node fill. */
    --state-completed: var(--state-completed-fill);
    --state-progress: var(--state-progress-fill);
    --state-available: var(--field);
    --state-review: var(--state-review-fill);
    --state-locked: var(--face-sunken);
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
  .legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    padding: 6px 8px;
    background: var(--face-alt);
  }
  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border: 1px solid var(--ink-soft);
  }
  .legend-locked {
    gap: 2px;
  }
  .legend-locked .node-lock {
    margin-left: 2px;
    color: var(--ink-mid);
  }
  .completed {
    background: var(--state-completed);
  }
  .progress {
    background: var(--state-progress);
  }
  .available {
    background: var(--state-available);
  }
  .review {
    background: var(--state-review);
  }
  .locked {
    background: var(--state-locked);
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
  /* SVG presentation attributes do not accept var(), so edge colours are real
     CSS rules. As attributes they were dropped and the arrows disappeared. */
  .edge-head-done {
    fill: var(--ok-edge);
  }
  .edge-head-todo {
    fill: var(--edge);
  }
  .skill-edge-done {
    stroke: var(--ok-edge);
  }
  .skill-edge-todo {
    stroke: var(--edge);
  }
  .scaled-canvas {
    position: relative;
  }
  .canvas {
    transform-origin: top left;
    position: absolute;
  }
  /* The edge layer only: node marks are inline SVG and must stay in flow. */
  .canvas > svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .skill-node {
    position: absolute;
    width: 150px;
    height: 52px;
    box-sizing: border-box;
    padding: 4px 7px;
    text-align: left;
    background: var(--state-locked);
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
  .skill-node strong {
    display: block;
    font-size: 11px;
    line-height: 13px;
  }
  .skill-node.progress {
    background: var(--state-progress);
    color: var(--caution-ink);
  }
  .skill-node.available {
    background: var(--state-available);
    color: var(--ink-strong);
  }
  .skill-node.completed {
    background: var(--state-completed);
    color: var(--ok-ink);
  }
  .skill-node.review {
    background: var(--state-review);
    color: var(--caution-ink);
  }
  .skill-node.locked {
    background: var(--state-locked);
    color: var(--ink-mid);
  }
  .skill-node.selected {
    box-shadow:
      0 0 0 2px var(--accent),
      3px 3px 0 var(--veil);
  }
  .skill-node:focus-visible {
    outline: 2px dashed var(--ink-strong);
    outline-offset: -4px;
  }
  .node-state {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    line-height: 13px;
    margin-top: 2px;
  }
  .node-lock {
    /* Authored vector, not a manifest icon: the canvas is transform-scaled, so
       a raster glyph inside it could never keep its native pixel size. */
    flex-shrink: 0;
  }
  .node-ahead {
    position: absolute;
    top: 3px;
    right: 4px;
    font-size: 9px;
    line-height: 11px;
    padding: 0 3px;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .node-progress {
    display: block;
    height: 4px;
    margin-top: 3px;
    background: var(--field);
    border: 1px solid var(--rule-strong);
  }
  .node-progress > span {
    display: block;
    height: 100%;
    background: var(--ahead-bg);
  }
  footer {
    background: var(--face);
    padding: 4px 8px;
    border-top: 1px solid var(--bevel-mid);
    line-height: 1.4;
  }
  .linear-skills {
    margin: 0;
    padding: 12px 12px 12px 32px;
    background: var(--panel-quiet);
  }
  .linear-skills li {
    margin-bottom: 18px;
  }
  .linear-skills li > button {
    min-height: 32px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding: 5px 8px;
    background: var(--face);
    color: var(--ink-strong);
    border: 1px solid;
    border-color: var(--bevel-light) var(--bevel-shadow) var(--bevel-shadow)
      var(--bevel-light);
    border-radius: 0;
    font: inherit;
  }
  .linear-skills .selected {
    outline: 2px solid var(--focus);
  }
  .linear-skills p {
    margin: 5px 0;
    line-height: 1.5;
  }
  .requirement {
    display: inline;
    min-height: 24px;
    background: none;
    color: var(--syn-keyword);
    border: 0;
    padding: 0 2px;
    text-decoration: underline;
    font: inherit;
  }
  @media (forced-colors: active) {
    .skill-node.selected,
    .linear-skills .selected {
      outline: 2px solid Highlight;
    }
  }
</style>
