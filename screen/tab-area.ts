/** A read-only presentation of the tab area while Pi owns the keyboard. */
import {
  Container,
  CURSOR_MARKER,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import type { LayoutNode, ScrollLayoutState } from "@earendil-works/pi-tui/dist/layout-node.js";
import type { TuiMouseDispatchResult } from "@earendil-works/pi-tui/dist/tui.js";

// Pi's viewport lays out stacks and scroll views directly, bypassing their
// render(). Keep that tree (including scroll state) and decorate the leaves.
// The extension loader aliases the package entry, not its runtime subpaths.
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
type LayoutComponent = Component & { [LAYOUT_NODE]?(): LayoutNode | undefined };

const DIM = "\x1b[2m";
const NORMAL_INTENSITY = "\x1b[22m";
const ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
// Skip string controls such as OSC 8 links; only SGR can override the dim.
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]P_^X][\s\S]*?(?:\x07|\x1b\\))/g;

function dimLine(line: string): string {
  // Pi handles image placement and clipping; do not style the protocol data.
  if (line.includes("\x1b_G") || line.includes("\x1b]1337;File=")) return line;
  const text = line.replaceAll(CURSOR_MARKER, "").replace(/\x1b_pi:\/?fc\x07/g, "");
  // Keep Pi's leading OSC 133 marker in place so its layout can still strip it.
  const zone = ZONE_PREFIX.exec(text)?.[0] ?? "";
  const body = text.slice(zone.length);
  return body === "" ? zone : zone + DIM + body.replace(ANSI, (code) =>
    code.startsWith("\x1b[") && code.endsWith("m") ? code + DIM : code,
  ) + NORMAL_INTENSITY;
}

export function tabArea(enabled: () => boolean, cancelDrag: () => void): (component: Component) => Component {
  let on: boolean | undefined;
  let generation = new WeakMap<Component, LayoutComponent>();

  const refresh = () => {
    const next = enabled();
    if (on !== next) {
      on = next;
      generation = new WeakMap();
      if (!on) cancelDrag();
    }
    return next;
  };

  const wrap = (component: LayoutComponent): LayoutComponent => {
    const existing = generation.get(component);
    if (existing) return existing;
    const mounted = generation;
    const interactive = () => refresh() && mounted === generation;
    let scroll: { source: ScrollLayoutState; adapter: ScrollLayoutState } | undefined;
    const adapter: LayoutComponent = {
      render(width) {
        const lines = component.render(width);
        return on ? lines : lines.map(dimLine);
      },
      invalidate: () => component.invalidate(),
      [LAYOUT_NODE]() {
        const node = component[LAYOUT_NODE]?.();
        if (!node) return undefined;
        if (node.type === "scroll") {
          if (scroll?.source !== node.state) {
            // Pi hits scrollbars before dispatching component mouse events.
            // Hide the track even in a stale layout, but let Pi's own viewport
            // keys and the layout engine continue using the real scroll state.
            scroll = {
              source: node.state,
              adapter: new Proxy(node.state, {
                get(target, key) {
                  if (key === "scrollbar" && !interactive()) return "hidden";
                  if (key === "isScrollbarVisible" && !interactive()) return false;
                  const value: unknown = Reflect.get(target, key, target);
                  return typeof value === "function" ? value.bind(target) : value;
                },
              }),
            };
          }
          return { ...node, component: wrap(node.component), state: scroll.adapter };
        }
        return {
          ...node,
          // Preserve Split's live basis getter and the other entry metadata.
          entries: node.entries.map((entry) => new Proxy(entry, {
            get(target, key) {
              return key === "component" ? wrap(target.component) : Reflect.get(target, key);
            },
          })),
        };
      },
    };
    adapter.handleMouse = (event: TuiMouseEvent) => {
      // Pi can dispatch against its last rendered layout or a captured target.
      // Never reuse a pre-dialog target (or its click count) after a handoff.
      if (!interactive()) return { handled: true, render: false };

      // As in Pi's own layout dispatch, don't send the event to the children
      // twice through a stack's/scroll view's default container handler.
      if (component[LAYOUT_NODE] && component.handleMouse === Container.prototype.handleMouse) return undefined;
      const result = component.handleMouse?.(event);
      if (!result) return undefined;
      // Preserve the coordinates of a forwarded target, but gate its later
      // events too. Keyboard focus still belongs to the unwrapped component.
      if ("target" in result) {
        const forwarded = result as TuiMouseDispatchResult;
        const target = forwarded.target.component;
        return {
          ...forwarded,
          target: { ...forwarded.target, component: wrap(target) },
          focusTarget: forwarded.focusTarget ?? target,
        } satisfies TuiMouseDispatchResult;
      }
      if (result.focus) {
        return {
          ...result,
          handled: true,
          target: {
            component: adapter, originX: event.screenX - event.x, originY: event.screenY - event.y,
            width: event.width, height: event.height,
          },
          focusTarget: component,
        } satisfies TuiMouseDispatchResult;
      }
      return result;
    };
    mounted.set(component, adapter);
    return adapter;
  };

  // Keep just the boundary stable. Pi sees fresh mouse targets below it when
  // focus returns, so its native multi-click detection starts from scratch.
  return (component: LayoutComponent): LayoutComponent => {
    const current = () => {
      refresh();
      return wrap(component);
    };
    return {
      render: (width) => current().render(width),
      invalidate: () => component.invalidate(),
      [LAYOUT_NODE]: () => current()[LAYOUT_NODE]?.(),
    };
  };
}
