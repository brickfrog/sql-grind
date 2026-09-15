<script module lang="ts">
  export type ContextMenuItem = {
    label: string;
    disabled?: boolean;
    separatorBefore?: boolean;
    action: () => void;
  };
</script>

<script lang="ts">
  import { onMount } from "svelte";

  let {
    items,
    x,
    y,
    label,
    returnFocus,
    onclose,
  }: {
    items: ContextMenuItem[];
    x: number;
    y: number;
    label: string;
    returnFocus: HTMLElement | null;
    onclose: () => void;
  } = $props();

  let menu: HTMLDivElement;
  let fallbackFocus: HTMLElement | null = null;
  let closed = false;
  const openEvent = "sql-grind-context-menu-open";

  function dismiss(restoreFocus: boolean) {
    if (closed) return;
    closed = true;
    // Closing can synchronously clear the props supplied by the parent.
    const opener = returnFocus?.isConnected
      ? returnFocus
      : fallbackFocus?.isConnected
        ? fallbackFocus
        : null;
    // Svelte removes the component on its next update; hide it before an action
    // can open a dialog, and without flushing during a sibling's mount.
    menu.hidden = true;
    onclose();
    if (restoreFocus && opener?.isConnected)
      opener.focus({ preventScroll: true });
  }

  function activate(item: ContextMenuItem) {
    if (closed || item.disabled) return;
    dismiss(true);
    item.action();
  }

  function focusItem(button: HTMLButtonElement) {
    button.focus({ preventScroll: true });
    const bounds = menu.getBoundingClientRect();
    const itemBounds = button.getBoundingClientRect();
    const top = bounds.top + menu.clientTop;
    const bottom = top + menu.clientHeight;
    if (itemBounds.top < top) menu.scrollTop += itemBounds.top - top;
    else if (itemBounds.bottom > bottom)
      menu.scrollTop += itemBounds.bottom - bottom;
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Tab") {
      // Restore the tab sequence's starting point, then let the browser advance.
      dismiss(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const active = document.activeElement;
      if (
        active instanceof HTMLButtonElement &&
        menu.contains(active) &&
        !active.disabled
      )
        active.click();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;

    event.preventDefault();
    const enabled = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    if (!enabled.length) return;
    const current = enabled.findIndex(
      (button) => button === document.activeElement,
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? enabled.length - 1
          : current < 0
            ? event.key === "ArrowUp"
              ? enabled.length - 1
              : 0
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                enabled.length) %
              enabled.length;
    focusItem(enabled[next]);
  }

  onMount(() => {
    fallbackFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    window.dispatchEvent(new Event(openEvent));
    // Escape ancestor stacking contexts and scrolling/overflow containers.
    document.body.appendChild(menu);

    // Pointer and viewport values share one coordinate space: the application
    // applies no zoom of its own, and native browser zoom scales both.
    const visualViewport = window.visualViewport;
    const width = visualViewport?.width ?? window.innerWidth;
    const height = visualViewport?.height ?? window.innerHeight;
    const left = visualViewport?.offsetLeft ?? 0;
    const top = visualViewport?.offsetTop ?? 0;
    const px = x,
      py = y;
    const inset = Math.min(4, width / 4, height / 4);
    menu.style.maxWidth = `${Math.max(0, width - inset * 2)}px`;
    menu.style.maxHeight = `${Math.max(0, height - inset * 2)}px`;
    const rect = menu.getBoundingClientRect();
    const bounds = { width: rect.width, height: rect.height };
    const preferredX =
      px + bounds.width > left + width - inset ? px - bounds.width : px;
    const preferredY =
      py + bounds.height > top + height - inset ? py - bounds.height : py;
    menu.style.left = `${Math.max(left + inset, Math.min(preferredX, left + width - bounds.width - inset))}px`;
    menu.style.top = `${Math.max(top + inset, Math.min(preferredY, top + height - bounds.height - inset))}px`;

    function outsidePointer(event: PointerEvent) {
      if (!event.composedPath().includes(menu)) dismiss(false);
    }
    function externalScroll(event: Event) {
      if (!(event.target instanceof Node) || !menu.contains(event.target))
        dismiss(false);
    }
    function closeWithoutFocus() {
      dismiss(false);
    }

    window.addEventListener("pointerdown", outsidePointer, true);
    window.addEventListener("scroll", externalScroll, true);
    window.addEventListener("resize", closeWithoutFocus);
    window.addEventListener(openEvent, closeWithoutFocus);
    visualViewport?.addEventListener("resize", closeWithoutFocus);
    visualViewport?.addEventListener("scroll", closeWithoutFocus);

    const first = menu.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    if (first) focusItem(first);
    else menu.focus({ preventScroll: true });

    return () => {
      window.removeEventListener("pointerdown", outsidePointer, true);
      window.removeEventListener("scroll", externalScroll, true);
      window.removeEventListener("resize", closeWithoutFocus);
      window.removeEventListener(openEvent, closeWithoutFocus);
      visualViewport?.removeEventListener("resize", closeWithoutFocus);
      visualViewport?.removeEventListener("scroll", closeWithoutFocus);
      menu.remove();
    };
  });
</script>

<div
  bind:this={menu}
  class="context-menu"
  role="menu"
  aria-label={label}
  tabindex="-1"
  onkeydown={handleKeydown}
  onkeyup={(event) => event.stopPropagation()}
  oncontextmenu={(event) => {
    event.preventDefault();
    event.stopPropagation();
  }}
>
  {#each items as item}
    {#if item.separatorBefore}
      <div class="context-separator" role="separator"></div>
    {/if}
    <button
      type="button"
      role="menuitem"
      tabindex="-1"
      disabled={item.disabled}
      onclick={() => activate(item)}
      onpointermove={(event) => {
        if (event.pointerType === "mouse" && !item.disabled)
          event.currentTarget.focus({ preventScroll: true });
      }}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 100;
    box-sizing: border-box;
    width: 230px;
    max-width: calc(100vw - 8px);
    max-height: calc(100dvh - 8px);
    overflow: auto;
    overscroll-behavior: contain;
    border: 2px outset var(--face);
    background: var(--face);
    color: var(--ink);
    box-shadow: 2px 2px var(--bevel-shadow);
    padding: 3px;
    font-family: Tahoma, Verdana, sans-serif;
    font-size: 11px;
  }

  .context-menu:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -4px;
  }

  .context-menu button {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 26px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    padding: 5px 16px;
    font: inherit;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .context-menu button:hover:not(:disabled),
  .context-menu button:focus:not(:disabled),
  .context-menu button:active:not(:disabled) {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .context-menu button:focus-visible {
    outline: 2px solid var(--bevel-light);
    outline-offset: -3px;
  }

  .context-menu button:disabled {
    color: var(--ink-dim);
    cursor: default;
  }

  .context-separator {
    height: 0;
    border-top: 1px solid var(--bevel-mid);
    border-bottom: 1px solid var(--bevel-light);
    margin: 3px 1px;
  }

  @media (forced-colors: active) {
    .context-menu {
      border: 2px solid ButtonText;
      background: Canvas;
      color: CanvasText;
      box-shadow: none;
    }

    .context-menu:focus-visible {
      outline-color: Highlight;
    }

    .context-menu button:hover:not(:disabled),
    .context-menu button:focus:not(:disabled),
    .context-menu button:active:not(:disabled) {
      forced-color-adjust: none;
      background: Highlight;
      color: HighlightText;
    }

    .context-menu button:focus-visible {
      outline-color: HighlightText;
    }

    .context-menu button:disabled {
      color: GrayText;
    }

    .context-separator {
      border-color: GrayText;
    }
  }
</style>
