import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseKeybindings, type KeybindingsConfig } from "./keybindings.ts";

export interface PieBoyConfig {
  stat: { art: "auto" | "pixel-art" | "off"; kitty: boolean };
  radio: { enabled: boolean };
  chat: { thinking: boolean; toolLog: boolean };
  quest: { enabled: boolean };
  keybindings: KeybindingsConfig;
}

export const DEFAULT_CONFIG: PieBoyConfig = {
  stat: { art: "auto", kitty: true },
  radio: { enabled: true },
  chat: { thinking: true, toolLog: true },
  quest: { enabled: false },
  keybindings: {},
};

export function configFile(agentDir = getAgentDir()): string {
  return join(agentDir, "pie-boy", "config.json");
}

function object(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${path} must be an object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key) || !allowed.includes(key)) {
      throw new Error(`Unknown config key: ${path}.${String(key)}`);
    }
  }
  return value as Record<string, unknown>;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

export function parseConfig(value: unknown): PieBoyConfig {
  const root = object(value, "config", ["stat", "radio", "chat", "quest", "keybindings"]);
  const result: PieBoyConfig = {
    stat: { ...DEFAULT_CONFIG.stat }, radio: { ...DEFAULT_CONFIG.radio },
    chat: { ...DEFAULT_CONFIG.chat }, quest: { ...DEFAULT_CONFIG.quest }, keybindings: {},
  };
  if (Object.hasOwn(root, "stat")) {
    const stat = object(root.stat, "stat", ["art", "kitty"]);
    if (Object.hasOwn(stat, "art")) {
      if (stat.art !== "auto" && stat.art !== "pixel-art" && stat.art !== "off") throw new Error("stat.art must be auto, pixel-art, or off");
      result.stat.art = stat.art;
    }
    if (Object.hasOwn(stat, "kitty")) result.stat.kitty = bool(stat.kitty, "stat.kitty");
  }
  if (Object.hasOwn(root, "radio")) {
    const radio = object(root.radio, "radio", ["enabled"]);
    if (Object.hasOwn(radio, "enabled")) result.radio.enabled = bool(radio.enabled, "radio.enabled");
  }
  if (Object.hasOwn(root, "chat")) {
    const chat = object(root.chat, "chat", ["thinking", "toolLog"]);
    if (Object.hasOwn(chat, "thinking")) result.chat.thinking = bool(chat.thinking, "chat.thinking");
    if (Object.hasOwn(chat, "toolLog")) result.chat.toolLog = bool(chat.toolLog, "chat.toolLog");
  }
  if (Object.hasOwn(root, "quest")) {
    const quest = object(root.quest, "quest", ["enabled"]);
    if (Object.hasOwn(quest, "enabled")) result.quest.enabled = bool(quest.enabled, "quest.enabled");
  }
  if (Object.hasOwn(root, "keybindings")) result.keybindings = parseKeybindings(root.keybindings);
  return result;
}

export function readConfig(agentDir?: string): PieBoyConfig {
  let text: string;
  const file = configFile(agentDir);
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Some platforms report ENOENT even when an ancestor is a regular file.
      // A dangling symlink is likewise an invalid placement, not an absent config.
      let path = file;
      while (true) {
        let exists = false;
        try {
          lstatSync(path);
          exists = true;
        } catch (probe) {
          if ((probe as NodeJS.ErrnoException).code !== "ENOENT") throw probe;
        }
        if (exists) {
          if (path === file || !statSync(path).isDirectory()) throw error;
          return parseConfig({});
        }
        const parent = dirname(path);
        if (parent === path) throw error;
        path = parent;
      }
    }
    throw error;
  }
  return parseConfig(JSON.parse(text));
}
