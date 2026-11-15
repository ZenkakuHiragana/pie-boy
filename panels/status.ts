/**
 * STAT's panels: VITALS, CONTEXT and USAGE.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { CONTEXT_PANEL, contextData, contextUsage } from "../features/context.ts";
import { gitData } from "../features/git.ts";
import { toolData } from "../features/tools.ts";
import { USAGE_PANEL, usageData } from "../features/usage.ts";
import { VITALS_PANEL, vitals } from "../features/vitals.ts";
import { gaugeRatios } from "../state/usage.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { alignedRow, bar, compactNumber, elapsedText, textCounterRows } from "./common.ts";
import { type CardInput, cardsWidth, centerLine, gaugeRow, statCards } from "./status-parts.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel(VITALS_PANEL, (env) => {
  let view: SizedView | undefined;
  const panel = framed(
    env.theme,
    () => "STATUS",
    new Lines(
      (width) => {
        const height = Math.max(1, view?.viewportHeight ?? 1);
        if (view) view.drawnFor = height;
        // Centred up and down; a panel too short for it all scrolls from the top.
        const lines = vitalsLines(env, width);
        return [...Array.from({ length: Math.max(0, Math.floor((height - lines.length) / 2)) }, () => ""), ...lines];
      },
      (width) => [
        contextData(env.state).version,
        env.state.version,
        toolData(env.state).toolsVersion,
        gitData(env.state).version,
        usageData(env.state).version,
        vitals(env.state).version,
        ...(env.statusArt?.key(env, Math.max(10, width - 2)) ?? []),
        stateText(env),
        env.cwd(),
        view?.viewportHeight,
      ],
    ),
    "sized",
    () => env.focused(VITALS_PANEL),
    // Why logo.* could not be shown, on the panel's last row whether or not the rest scrolls.
    new Lines((width) => {
      const error = env.statusArt?.error(env);
      return error ? [` ${env.theme().fg("text", centerLine(error, Math.max(10, width - 2)))}`] : [];
    }),
  );
  view = panel.scroll as SizedView;
  return panel;
});

registerPanel(CONTEXT_PANEL, (env) => {
  const panel = framed(
    env.theme,
    () => "CONTEXT",
    new Lines(
      (width) => contextLines(env, width),
      () => [contextData(env.state).version],
    ),
    "top",
    () => env.focused(CONTEXT_PANEL),
  );
  panel.scroll?.setScrollbar("always");
  return panel;
});

registerPanel(USAGE_PANEL, (env) =>
  framed(
    env.theme,
    () => {
      const model = usageData(env.state).model;
      return model ? `USAGE  ${model}` : "USAGE";
    },
    new Lines((width) => usageLines(env, width)),
    "top",
    () => env.focused(USAGE_PANEL),
  ));

function contextLines(env: PanelEnv, width: number): string[] {
  const t = env.theme();
  const data = contextData(env.state);
  const usage = contextUsage(env.state);
  const parts = data.contextParts;
  const estimated = parts.reduce((sum, part) => sum + part.tokens, 0);
  const lines: string[] = [];
  const window = usage?.contextWindow;
  if (usage) {
    const isEstimate = usage.tokens === null;
    const count = isEstimate ? `≈${compactNumber(estimated)}` : compactNumber(usage.tokens!);
    const percent = isEstimate
      ? (window && window > 0 ? Math.round(estimated / window * 100) : undefined)
      : (usage.percent === null ? undefined : Math.round(usage.percent));
    const right = `${count}/${compactNumber(usage.contextWindow)} ${percent === undefined ? "--" : `${percent}%`}`;
    const ratio = (percent ?? 0) / 100;
    const barWidth = Math.max(0, Math.min(40, width - visibleWidth(right) - 2));
    const left = barWidth ? ` ${bar(t, ratio, barWidth, ratio > 0.85 ? "error" : ratio > 0.6 ? "warning" : "accent")}` : "";
    lines.push(alignedRow(left, t.fg("accent", t.bold(right)), width));
  } else {
    lines.push(t.fg("dim", " USAGE UNKNOWN"));
  }
  if (data.captureWarning) lines.push(t.fg("warning", ` ${data.captureWarning}`));
  lines.push(...textCounterRows(data.counter.id, width, t, "BREAKDOWN"));

  // The bars compare quantities; the right-hand percentages still use capacity.
  const values = parts.map((part) => ({
    part,
    count: compactNumber(part.tokens),
    percent: window && window > 0 ? `${Math.round(part.tokens / window * 100)}%` : "--",
  }));
  const percentHeading = `of ${window && window > 0 ? compactNumber(window) : "?"}`;
  const countWidth = Math.max(4, ...values.map((value) => value.count.length));
  const percentWidth = Math.max(percentHeading.length, ...values.map((value) => value.percent.length));
  const columns = (count: string, percent: string) => `${count.padStart(countWidth)} ${percent.padStart(percentWidth)}`;
  const rightWidth = countWidth + 1 + percentWidth;
  const stacked = width < rightWidth + 15;
  const maximum = parts.reduce((max, part) => Math.max(max, part.tokens), 0);
  const limit = contextBarLimit(maximum);
  const limitText = compactNumber(limit);
  const available = Math.min(20, Math.max(0, width - rightWidth - 15));
  const barWidth = maximum > 0 && available >= visibleWidth(limitText) + 2 ? available : 0;
  const label = (name: string) => ` ${name.padEnd(13)}`;
  const axis = barWidth ? `0${" ".repeat(barWidth - 1 - visibleWidth(limitText))}${limitText}` : "";
  lines.push(alignedRow(t.fg("muted", barWidth ? label("") + axis : ""), t.fg("dim", columns("≈tok", percentHeading)), width));
  if (!parts.length) {
    lines.push(t.fg("dim", " -- no estimated parts --"));
    return lines;
  }
  for (const { part, count, percent } of values) {
    const right = t.fg("muted", columns(count, percent));
    if (stacked) {
      lines.push(alignedRow(t.fg("text", ` ${part.label}`), "", width), alignedRow("", right, width));
    } else {
      const left = t.fg("text", label(part.label)) + (barWidth ? bar(t, part.tokens / limit, barWidth, "muted") : "");
      lines.push(alignedRow(left, right, width));
    }
  }
  return lines;
}

/** Derived per reading: keep the axis stable until a 1-2-5 threshold is crossed. */
function contextBarLimit(maximum: number): number {
  if (maximum <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(maximum));
  for (const factor of [1, 2, 5, 10]) {
    const limit = factor * unit;
    if (Number.isFinite(limit) && limit >= maximum) return limit;
  }
  return maximum;
}

function usageLines(env: PanelEnv, width: number): string[] {
  const t = env.theme();
  const usage = usageData(env.state);
  const reading = usage.reading;
  const windows = reading?.windows ?? [];
  const lines: string[] = [];
  // Above the windows, what is unusual: no reading, or a state other than fresh
  // (stale, unavailable, auth_required and the rest).
  if (usage.error) lines.push(t.fg("error", ` ${usage.error}`));
  else if (!reading) lines.push(t.fg("dim", " -- reading --"));
  else if (reading.notSetUp) lines.push(t.fg("dim", " -- quota-axi found no sign-in in Pi --"));
  else if (reading.status !== "fresh") lines.push(t.fg("warning", ` ${reading.status}${reading.error ? `: ${reading.error}` : ""}`));
  else if (!windows.length) lines.push(t.fg("dim", " -- no windows reported --"));
  if (lines.length && windows.length) lines.push("");
  const labelWidth = Math.max(4, ...windows.map((window) => visibleWidth(window.label)));
  const now = env.now();
  for (const window of windows) {
    if (window.resetAt !== undefined && window.resetAt > now) {
      const minutes = Math.ceil((window.resetAt - now) / 60_000);
      env.redrawAt(window.resetAt - (minutes - 1) * 60_000);
    }
    const reset = window.resetAt === undefined ? "" : `resets in ${untilText(window.resetAt - now)}`;
    // Name, bar, "100%", then the reset time when it fits.
    const barWidth = Math.max(4, Math.min(24, width - labelWidth - 9 - (reset ? reset.length + 2 : 0)));
    // A window without a percentage (credits) shows an empty bar and "--".
    const ratio = window.ratio ?? 0;
    const color = ratio > 0.85 ? "error" : ratio > 0.6 ? "warning" : "accent";
    const percent = (window.ratio === undefined ? "--" : `${Math.round(ratio * 100)}%`).padStart(4);
    const resetText = reset ? `  ${t.fg("muted", reset)}` : "";
    lines.push(` ${t.fg("text", window.label.padEnd(labelWidth))} ${bar(t, ratio, barWidth, color)} ${t.fg("accent", percent)}${resetText}`);
  }
  const at = usage.at;
  if (at) lines.push("", t.fg("dim", ` updated ${new Date(at).toLocaleTimeString()}`));
  return lines;
}

/** `45m`, `2h 05m` or `3d 04h` from now. */
function untilText(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}

/** STATUS: the logo, four gauges around it, the stat cards, the model and the working folder. */
function vitalsLines(env: PanelEnv, width: number): string[] {
  const t = env.theme();
  const inner = Math.max(10, width - 2);
  const logo = env.statusArt?.lines(env, inner);
  // Each gauge (name, bar and value) has its middle on an edge of the logo, as far as
  // the panel allows, rather than filling the panel.
  const gauges = { gap: 4, maxColumn: 30, centers: logo
    ? [logo.left, logo.left + logo.columns] as const
    : [inner / 4, inner * 3 / 4] as const };
  // The four gauges share their name and value columns, so their bars are the same
  // length. The value column fits "100%", so a bar does not move as its value grows.
  // The line is drawn in "text"; after its bar, the colour is set again for the value.
  const columns = {
    labelWidth: visibleWidth("CACHE"),
    valueWidth: visibleWidth("100%"),
    bar: (ratio: number, width: number) => bar(t, ratio, width, "text") + t.getFgAnsi("text"),
  };
  const v = vitals(env.state);
  const usage = contextUsage(env.state);
  const allowance = usageData(env.state);
  const limits = gaugeRatios(allowance.reading?.windows ?? []);
  const body: string[] = [];

  body.push(gaugeRow(
    { ...columns, label: "CTX", ratio: (usage?.percent ?? 0) / 100, value: usage?.percent === null || usage === undefined ? "--" : undefined },
    { ...columns, label: "5H", ratio: limits.fiveHour ?? 0, value: limits.fiveHour === undefined ? "--" : undefined },
    inner,
    gauges,
  ));
  if (logo) {
    body.push("");
    body.push(...logo.lines);
  }
  body.push("");
  body.push(centerLine(stateText(env), inner));
  body.push("");
  body.push(gaugeRow(
    { ...columns, label: "CACHE", ratio: v.cacheRatio ?? 0, value: v.cacheRatio === undefined ? "--" : undefined },
    { ...columns, label: "WEEK", ratio: limits.weekly ?? 0, value: limits.weekly === undefined ? "--" : undefined },
    inner,
    gauges,
  ));
  body.push("");

  const lines = body.map((line) => ` ${t.fg("text", line)}`);
  // The cards are as wide as their names and values need, up to the panel's width, and centred.
  const cardInputs = cardsOf(env);
  // statCards returns four lines per row: frame, name, value, frame.
  const cards = statCards(cardInputs, Math.min(inner, cardsWidth(cardInputs)));
  cards.forEach((line, index) => {
    const slot = index % 4 === 1 ? "muted" : index % 4 === 2 ? "accent" : "dim";
    lines.push(` ${t.fg(slot, centerLine(line, inner))}`);
  });
  lines.push(` ${t.fg("muted", centerLine(allowance.model ?? "-- no model --", inner))}`);
  lines.push(` ${t.fg("muted", centerLine(env.cwd(), inner))}`);
  return lines;
}

/** `WORKING 02:14` while the agent runs, `STANDBY` otherwise. */
function stateText(env: PanelEnv): string {
  if (!env.state.agentRunning) return "STANDBY";
  const now = env.now();
  const startedAt = env.state.agentStartedAt;
  if (startedAt !== undefined) env.redrawAt(startedAt + (Math.floor((now - startedAt) / 1000) + 1) * 1000);
  return `WORKING  ${elapsedText(startedAt, now)}`;
}

/** The five cards under the logo. */
function cardsOf(env: PanelEnv): CardInput[] {
  const v = vitals(env.state);
  const tools = toolData(env.state);
  const lines = gitData(env.state).lines;
  const speed = v.outputTokensPerSecond;
  return [
    { label: "TOOLS", value: compactNumber(tools.ok + tools.failed) },
    { label: "FAIL", value: compactNumber(tools.failed) },
    { label: "DIFF", value: lines ? `+${compactNumber(lines.added)}-${compactNumber(lines.removed)}` : "--" },
    { label: "COST", value: v.cost > 0 ? `$${v.cost.toFixed(2)}` : "--" },
    { label: "SPEED", value: speed === undefined ? "--" : `${Math.round(speed)} t/s` },
  ];
}

