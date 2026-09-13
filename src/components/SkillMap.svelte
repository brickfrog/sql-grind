<script module lang="ts">
  let savedZoom = "100";
  let savedScroll = { left: 0, top: 0 };
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import { icons, type Skill } from "../lib/catalog";
  import type { Progression, ProgressState } from "../lib/progression";

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
  const scale = $derived(
    zoom === "fit"
      ? Math.max(0.1, Math.min(width / canvasWidth, height / canvasHeight, 1.5))
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
  function status(skill: Skill) {
    return `${stateLabel(progression.skills[skill.id]?.state)} · ${count(skill)}/${skill.objectives.length}`;
  }
</script>

<section class="skill-map" aria-label="Skill Map">
  <header class="map-toolbar">
    <strong>Skill Map.dag</strong>
    <span
      >{skills.length} skills · {Object.values(progression.skills).filter(
        (skill) => skill.completed,
      ).length} completed</span
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
        ><option value="150">150%</option><option value="fit">Fit</option>
      </select>
    </label>
  </header>
  <div class="legend" aria-label="Map legend">
    <span><i class="completed"></i>Completed</span>
    <span><i class="progress"></i>In progress</span>
    <span><i class="available"></i>Available</span>
    <span><img src={icons.lock} alt="" />Locked</span>
    <span><i class="review"></i>Needs review</span>
  </div>
  <p class="preview-note">
    Complete all five current challenges to complete a skill. Previously opened
    skills remain accessible for review.
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
              {count(skill)} of {skill.objectives.length} objectives completed.
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
            {#each edges as edge}
              <line
                x1={edge.from.x + 150}
                y1={edge.from.y + 26}
                x2={edge.to.x}
                y2={edge.to.y + 26}
                stroke={progression.skills[edge.from.id]?.completed
                  ? "#286b28"
                  : "#909090"}
                stroke-width="2"
                stroke-dasharray="4 4"
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
              class:selected={selected === skill.id}
              style:left={`${skill.x}px`}
              style:top={`${skill.y}px`}
              tabindex={selected === skill.id ||
              (!byId.has(selected) && skill.id === "basics")
                ? 0
                : -1}
              aria-pressed={selected === skill.id}
              aria-label={`${skill.label}. ${status(skill)} objectives completed.`}
              onkeydown={(event) => navigate(event, skill)}
              onclick={() => selectSkill(skill.id)}
            >
              <strong>{skill.label}</strong>
              <span class="node-state">{status(skill)}</span>
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
  .legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    padding: 6px 8px;
    background: #f0eee8;
  }
  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border: 1px solid #555;
  }
  .legend img {
    width: 16px;
    height: 16px;
  }
  .completed {
    background: #286b28;
  }
  .progress {
    background: #ffd966;
  }
  .available {
    background: #fff;
  }
  .review {
    background: #c0bcb4;
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
  .skill-node {
    position: absolute;
    width: 150px;
    height: 52px;
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
  .skill-node strong {
    display: block;
    font-size: 11px;
    line-height: 13px;
  }
  .skill-node.progress {
    background: #ffd966;
    color: #282000;
  }
  .skill-node.available {
    background: #fff;
    color: #000;
  }
  .skill-node.completed {
    background: #d0e8d0;
    color: #153d15;
  }
  .skill-node.review {
    background: #fff0c0;
    color: #493800;
  }
  .skill-node.selected {
    box-shadow:
      0 0 0 2px #0a246a,
      3px 3px 0 #0005;
  }
  .skill-node:focus-visible {
    outline: 2px dashed #000;
    outline-offset: -4px;
  }
  .node-state {
    display: block;
    font-size: 10px;
    line-height: 13px;
    margin-top: 2px;
  }
  .node-progress {
    display: block;
    height: 4px;
    margin-top: 3px;
    background: #fff;
    border: 1px solid #888;
  }
  .node-progress > span {
    display: block;
    height: 100%;
    background: #6b4900;
  }
  footer {
    background: #d4d0c8;
    padding: 4px 8px;
    border-top: 1px solid #808080;
    line-height: 1.4;
  }
  .linear-skills {
    margin: 0;
    padding: 12px 12px 12px 32px;
    background: #f5f4ef;
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
    background: #d4d0c8;
    color: #000;
    border: 1px solid;
    border-color: #fff #404040 #404040 #fff;
    border-radius: 0;
    font: inherit;
  }
  .linear-skills .selected {
    outline: 2px solid #0a246a;
  }
  .linear-skills p {
    margin: 5px 0;
    line-height: 1.5;
  }
  .requirement {
    display: inline;
    min-height: 24px;
    background: none;
    color: #0000a0;
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
