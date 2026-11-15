/**
 * Core panels plus the optional panels selected by the startup configuration.
 */
import "./common.ts";
import "./tools.ts";
import "./git.ts";
import "./status.ts";
import "./history.ts";
import "./inv.ts";
import "./sessions.ts";
import "./models.ts";
import "./extensions.ts";
import "./tree.ts";
import type { PieBoyConfig } from "../config.ts";

export async function loadPanels(config: PieBoyConfig): Promise<void> {
  await Promise.all([
    config.chat.thinking ? import("./thinking.ts") : undefined,
    config.chat.toolLog ? import("./tool-list.ts") : undefined,
    config.radio.enabled ? import("./radio.ts") : undefined,
    config.quest.enabled ? import("./quests.ts") : undefined,
  ]);
}
