/** CHAT's optional THINKING panel. */
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { toolData } from "../features/tools.ts";
import { THINKING_TAIL } from "../state/tools.ts";
import { framed } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { spinner } from "./common.ts";
import { registerPanel } from "./registry.ts";

registerPanel("thinking", (env) =>
  framed(
    env.theme,
    () => {
      // The panel follows the end, so a note above the text would scroll away; the title says it.
      const data = toolData(env.state);
      const trimmed = data.thinkingTrimmed || data.thinking.length > THINKING_TAIL;
      const title = trimmed ? `THINKING  …last ${THINKING_TAIL} chars` : "THINKING";
      return env.state.agentRunning ? `${title} ${spinner(env.every(120))}` : title;
    },
    new Lines(
      (width) => {
        const t = env.theme();
        const text = toolData(env.state).thinking.slice(-THINKING_TAIL);
        if (!text) return [t.fg("dim", " -- no thinking yet --")];
        return wrapTextWithAnsi(text, Math.max(1, width - 2)).map((line) => ` ${t.fg("thinkingText", line)}`);
      },
      () => [toolData(env.state).toolsVersion],
    ),
    "end",
    () => env.focused("thinking"),
  ));
