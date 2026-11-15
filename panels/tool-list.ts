/** CHAT's compact optional TOOL LOG, used in narrow layouts. */
import { toolData } from "../features/tools.ts";
import type { ToolEntry } from "../state/tools.ts";
import { framed } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { spinner } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("tools", (env) =>
  framed(
    env.theme,
    () => {
      const data = toolData(env.state);
      return `TOOL LOG${data.toolsTrimmed ? `  last ${data.tools.length}` : ""}  ✓ ${data.ok} ✗ ${data.failed}`;
    },
    new Lines(
      () => {
        const t = env.theme();
        const tools = toolData(env.state).tools;
        if (!tools.length) return [t.fg("dim", " -- no tool calls yet --")];
        return tools.map((tool) => toolLine(env, tool));
      },
      // Spinners of running tools move only while the agent runs.
      () => [toolData(env.state).toolsVersion, env.state.agentRunning ? env.every(120) : -1],
    ),
    "end",
    () => env.focused("tools"),
  ));

function toolLine(env: PanelEnv, tool: ToolEntry): string {
  const t = env.theme();
  const mark =
    tool.status === "running"
      ? t.fg("warning", spinner(env.every(120)))
      : tool.status === "ok"
        ? t.fg("success", "✓")
        : t.fg("error", "✗");
  const indent = tool.nested ? "  ↳" : "";
  const time = tool.durationMs === undefined ? "" : t.fg("dim", ` ${(tool.durationMs / 1000).toFixed(1)}s`);
  return ` ${indent}${mark} ${t.fg("toolTitle", tool.name)} ${t.fg("muted", tool.summary)}${time}`;
}
