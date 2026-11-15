/** Optional STAT art: image scenes in auto mode, built-in animated pixels otherwise. */
import { colorToRgb, foregroundAnsi, backgroundAnsi } from "@earendil-works/pi-tui";
import type { LogoScene } from "../features/logo.ts";
import { toolData } from "../features/tools.ts";
import { type Paint, PI_LOGO, PI_LOGO_SHADES, type Rgb, pixelArtWidth, renderPixelArt, shade, shadePalette } from "./pixel-art.ts";
import type { PanelEnv } from "./registry.ts";

export interface StatusArt {
  key(env: PanelEnv, width: number): unknown[];
  lines(env: PanelEnv, width: number): { lines: string[]; left: number; columns: number };
  error(env: PanelEnv): string | undefined;
}

export type LogoSource = Pick<typeof import("../features/logo.ts"), "logoData" | "logoArt" | "logoPicture" | "logoError" | "logoFrameTime">;

export function createStatusArt(logo?: LogoSource, kitty = true): StatusArt {
  /** How long the error scene is shown after a tool fails. */
  const ERROR_SCENE_MS = 1000;

  /** Scene priority follows the live agent and tool state. */
  function logoScene(env: PanelEnv): LogoScene {
    if (env.state.agentRunning) {
      const tools = toolData(env.state);
      if (tools.lastErrorAt !== undefined && env.now() - tools.lastErrorAt < ERROR_SCENE_MS) {
        env.redrawAt(tools.lastErrorAt + ERROR_SCENE_MS);
        return "error";
      }
      return tools.active.size ? "tool" : "thinking";
    }
    return env.state.termAttention ? "done" : "standby";
  }

  /** How long a scene drawn from an image stays at least, so that quick tool calls do not flicker it. */
  const MIN_SCENE_MS = 600;

  /** The scene each pie-boy instance shows, and when it started (see sceneTime). */
  const sceneStarts = new WeakMap<object, { key: string; scene: LogoScene; since: number }>();

  /**
   * The scene and the time into it: a scene's animation plays from its first frame
   * when the scene starts. The error scene starts with the error (again with each new
   * one); another scene starts when it is first shown in place of the one before.
   * A scene drawn from an image is shown for MIN_SCENE_MS at least before another
   * replaces it, except the error scene. Pi's logo does not use the scene's frames, so
   * a scene without an image is replaced at once.
   */
  function sceneTime(env: PanelEnv): { scene: LogoScene; at: number; since: number } {
    const scene = logoScene(env);
    const now = env.now();
    const errorAt = toolData(env.state).lastErrorAt;
    const key = scene === "error" ? `error ${errorAt}` : scene;
    let start = sceneStarts.get(env.state);
    if (start?.key !== key) {
      if (start && scene !== "error" && now - start.since < MIN_SCENE_MS && logo?.logoFrameTime(env.state, start.scene, 0).key !== undefined) {
        env.redrawAt(start.since + MIN_SCENE_MS);
        return { scene: start.scene, at: now - start.since, since: start.since };
      }
      start = { key, scene, since: scene === "error" && errorAt !== undefined ? errorAt : now };
      sceneStarts.set(env.state, start);
    }
    return { scene, at: now - start.since, since: start.since };
  }

  /** The visible animation values also schedule their next change, even on a cache hit. */
  function logoKey(env: PanelEnv, width: number): unknown[] {
    const { scene, at, since } = sceneTime(env);
    const frame = logo?.logoFrameTime(env.state, scene, at) ?? {};
    if (frame.next !== undefined) env.redrawAt(since + frame.next);
    if (frame.key !== undefined) return [logo?.logoData(env.state).version, scene, frame.key];
    const { stage, noisy, breath } = piLogoMotion(env, width);
    return [logo?.logoData(env.state).version, scene, frame.key, stage, noisy, breath];
  }

  /** A step of Pi's logo's animation, in ms. */
  const PI_LOGO_STEP_MS = 120;
  /** While the agent does not run, a scan line crosses Pi's logo once every this many steps. */
  const PI_LOGO_SCAN_STEPS = 42;

  /**
   * How Pi's logo moves now in a panel `width` cells wide, which both the cache key and
   * the drawing read; asks for a redraw when it next changes. `scale` is the logo's size,
   * `stage` the step while the logo moves (-1 while it stands still), `scan` the pixel row
   * of the scan line (-1 when there is none), `noisy` whether it shows the error noise, and
   * `breath` its brightness.
   */
  function piLogoMotion(env: PanelEnv, width: number): { scale: number; stage: number; scan: number; noisy: boolean; breath: number } {
    const now = env.now();
    let scale = 4;
    while (scale > 1 && pixelArtWidth(PI_LOGO, scale) > width) scale--;
    const rows = PI_LOGO.length * scale;
    const working = env.state.agentRunning;
    const step = Math.floor(now / PI_LOGO_STEP_MS);
    let stage = -1;
    let scan = -1;
    if (working || step % PI_LOGO_SCAN_STEPS < rows) {
      stage = env.every(PI_LOGO_STEP_MS);
      scan = working ? stage % rows : stage % PI_LOGO_SCAN_STEPS;
    } else env.redrawAt((Math.floor(step / PI_LOGO_SCAN_STEPS) + 1) * PI_LOGO_SCAN_STEPS * PI_LOGO_STEP_MS);
    const errorAt = toolData(env.state).lastErrorAt;
    const noisy = working && errorAt !== undefined && now < errorAt + ERROR_SCENE_MS;
    if (noisy) env.redrawAt(errorAt + ERROR_SCENE_MS);
    // Done (finished on another page, not yet seen) breathes: the brightness eases down to
    // 80% and back every 2.4 s (20 steps), without the logo going away.
    const done = !working && env.state.termAttention;
    const breath = done ? 0.9 + 0.1 * Math.cos((2 * Math.PI * now) / 2400) : 1;
    if (done) env.redrawAt(now + 1000 / 60);
    return { scale, stage, scan, noisy, breath };
  }

  /**
   * The logo in the theme's accent colour, as large as the panel allows, centred in
   * `width`: its lines, the cell its left edge is at, and its width in cells.
   */
  function logoLines(env: PanelEnv, width: number): { lines: string[]; left: number; columns: number } {
    const theme = env.theme();
    const mode = theme.getColorMode();
    const rgb = colorToRgb(theme.colors.accent);
    const base: Rgb = [rgb.r, rgb.g, rgb.b];
    // logo.*, when there is one: as a Kitty image when enabled and supported, else
    // as cells carrying brightness, coloured here so that a change of theme recolours
    // them without reading the picture again.
    const { scene, at } = sceneTime(env);
    const picture = kitty ? logo?.logoPicture(env.state, width, base, scene, at) : undefined;
    if (picture) {
      const left = Math.max(0, Math.floor((width - picture.columns) / 2));
      return { lines: [" ".repeat(left) + picture.lines[0], ...picture.lines.slice(1)], left, columns: picture.columns };
    }
    const image = logo?.logoArt(env.state, width, scene, at);
    if (image) {
      const columns = image[0]!.length;
      const left = Math.max(0, Math.floor((width - columns) / 2));
      const pad = " ".repeat(left);
      return { left, columns, lines: image.map((row) => pad + row.map(({ glyph, fg, bg }) => {
        if (fg === undefined && bg === undefined) return glyph;
        const f = shade(base, fg ?? 0);
        const b = shade(base, bg ?? 0);
        return (fg !== undefined ? foregroundAnsi({ kind: "rgb", r: f[0], g: f[1], b: f[2] }, mode) : "") +
          (bg !== undefined ? backgroundAnsi({ kind: "rgb", r: b[0], g: b[1], b: b[2] }, mode) : "") + glyph + "\x1b[0m";
      }).join("")) };
    }
    const { scale, stage, scan, noisy, breath } = piLogoMotion(env, width);
    // Cells are about twice as tall as they are wide, so both scales stay equal.
    // The effects work on the drawn pixels (half a row tall), not on the logo's four
    // rows, so that the scan line is one pixel thin and the noise moves by one pixel.
    // The noise and the shades only move while the agent runs, when stage is the step.
    const pixels = PI_LOGO.flatMap((row) => Array.from({ length: scale }, () => [...row].map((pixel) => pixel.repeat(scale)).join("")));
    const rows = pixels.map((row, index) => {
      let next = row;
      if (noisy) {
        const shift = (stage + index) % 3 - 1;
        next = shift < 0 ? row.slice(1) + "." : shift > 0 ? "." + row.slice(0, -1) : row;
      } else if (index === scan) {
        next = row.replace(/[bcy]/g, "h");
      } else if (env.state.agentRunning) {
        const shades = "byc";
        next = row.replace(/[bcy]/g, (color) => shades[(shades.indexOf(color) + Math.floor(stage / 4)) % shades.length]!);
      }
      return next;
    });
    // The scan line is the accent halfway to white, so that it shows on the brightest shade too.
    const palette: Record<string, Rgb> = { ...shadePalette(base, Object.fromEntries(Object.entries(PI_LOGO_SHADES).map(([key, factor]) => [key, factor * breath]))), h: base.map((value) => Math.round(value + (255 - value) / 2)) as Rgb };
    const paint: Paint = (glyph, colors) => {
      const fg = colors.fg ? palette[colors.fg] : undefined;
      const bg = colors.bg ? palette[colors.bg] : undefined;
      const prefix =
        (fg ? foregroundAnsi({ kind: "rgb", r: fg[0], g: fg[1], b: fg[2] }, mode) : "") +
        (bg ? backgroundAnsi({ kind: "rgb", r: bg[0], g: bg[1], b: bg[2] }, mode) : "");
      const reset = "\x1b[0m";
      return prefix === "" ? glyph : `${prefix}${glyph}${reset}`;
    };
    const art = renderPixelArt(rows, { scaleX: 1, scaleY: 1, paint });
    const columns = pixelArtWidth(PI_LOGO, scale);
    const left = Math.max(0, Math.floor((width - columns) / 2));
    return { lines: art.map((line) => " ".repeat(left) + line), left, columns };
  }

  return {
    key: logoKey,
    lines: logoLines,
    error: (env) => logo?.logoError(env.state, sceneTime(env).scene),
  };
}
