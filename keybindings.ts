/** Pie-boy's bindings are independent of Pi's global keybinding manager. */
import { KeybindingsManager, type KeyId } from "@earendil-works/pi-tui";
import { rawKeyHint } from "@earendil-works/pi-coding-agent";

export const PIE_BOY_BINDINGS = {
  "pieBoy.tab.term": { defaultKeys: "alt+1" },
  "pieBoy.tab.stat": { defaultKeys: "alt+2" },
  "pieBoy.tab.inv": { defaultKeys: "alt+3" },
  "pieBoy.tab.data": { defaultKeys: "alt+4" },
  "pieBoy.tab.map": { defaultKeys: "alt+5" },
  "pieBoy.tab.radio": { defaultKeys: "alt+6" },
  "pieBoy.tab.next": { defaultKeys: "alt+j" },
  "pieBoy.tab.previous": { defaultKeys: "alt+k" },
  "pieBoy.page.next": { defaultKeys: "alt+l" },
  "pieBoy.page.previous": { defaultKeys: "alt+h" },
  "pieBoy.focus.toggle": { defaultKeys: "alt+o" },
  "pieBoy.panel.down": { defaultKeys: ["down", "j"] },
  "pieBoy.panel.up": { defaultKeys: ["up", "k"] },
  "pieBoy.panel.start": { defaultKeys: "home" },
  "pieBoy.panel.end": { defaultKeys: "end" },
  "pieBoy.panel.next": { defaultKeys: "tab" },
  "pieBoy.panel.previous": { defaultKeys: "shift+tab" },
  "pieBoy.panel.activate": { defaultKeys: "enter" },
  "pieBoy.panel.maximize": { defaultKeys: "z" },
  "pieBoy.radio.next": { defaultKeys: "n" },
  "pieBoy.radio.volumeUp": { defaultKeys: ["+", "="] },
  "pieBoy.radio.volumeDown": { defaultKeys: "-" },
  "pieBoy.radio.deleteStation": { defaultKeys: "delete" },
  "pieBoy.radio.addPlaylist": { defaultKeys: "a" },
  "pieBoy.models.toggleScope": { defaultKeys: "s" },
  "pieBoy.tree.help": { defaultKeys: "?" },
  "pieBoy.tree.previousBranch": { defaultKeys: "[" },
  "pieBoy.tree.nextBranch": { defaultKeys: "]" },
  "pieBoy.tree.here": { defaultKeys: "." },
  "pieBoy.field.cancel": { defaultKeys: ["escape", "tab"] },
  "pieBoy.quest.complete": { defaultKeys: "x" },
} satisfies Record<string, { defaultKeys: KeyId | KeyId[] }>;

export type PieBoyAction = keyof typeof PIE_BOY_BINDINGS;
export type KeybindingsConfig = Partial<Record<PieBoyAction, KeyId | KeyId[]>>;
export type PieBoyKeys = KeybindingsManager;

declare module "@earendil-works/pi-tui" {
  interface Keybindings extends Record<PieBoyAction, true> {}
}

// Match the KeyId grammar in Pi's keybindings reference, including the '+' key.
const specialKeys = new Set([
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear",
  "home", "end", "pageUp", "pageDown", "up", "down", "left", "right",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);
const symbols = new Set(Array.from("`-=[]\\;',./!@#$%^&*()_+|~{}:<>?"));
const modifiers = new Set(["ctrl", "shift", "alt", "super"]);

function validKey(value: string): boolean {
  let rest = value;
  const seen = new Set<string>();
  while (true) {
    const separator = rest.indexOf("+");
    if (separator < 0) break;
    const modifier = rest.slice(0, separator);
    if (!modifiers.has(modifier)) break;
    if (seen.has(modifier)) return false;
    seen.add(modifier);
    rest = rest.slice(separator + 1);
  }
  return /^[a-z0-9]$/.test(rest) || symbols.has(rest) || specialKeys.has(rest);
}

/** Validate the untrusted config boundary; returned values are safe for Pi's manager. */
export function parseKeybindings(value: unknown): KeybindingsConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("keybindings must be an object");
  }
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) {
    throw new Error("Invalid keybindings property");
  }
  const result: KeybindingsConfig = {};
  for (const [action, binding] of Object.entries(value)) {
    if (!Object.hasOwn(PIE_BOY_BINDINGS, action)) throw new Error(`Unknown keybinding: ${action}`);
    const list = Array.isArray(binding) ? binding : [binding];
    if (Array.from(list).some((key) => typeof key !== "string" || !validKey(key))) {
      throw new Error(`Invalid keybinding for ${action}`);
    }
    result[action as PieBoyAction] = (Array.isArray(binding) ? [...list] : binding) as KeyId | KeyId[];
  }
  return result;
}

/** Overrides have already been validated by parseConfig. */
export function createKeybindings(overrides: KeybindingsConfig = {}): PieBoyKeys {
  return new KeybindingsManager(PIE_BOY_BINDINGS, overrides);
}

export function bindingHint(keys: PieBoyKeys, action: PieBoyAction, label: string): string {
  const resolved = keys.getKeys(action);
  return resolved.length ? rawKeyHint(resolved.join("/"), label) : "";
}

/** Default-only manager for panel environments that do not supply production keys. */
const defaultKeys = createKeybindings();
export function panelKeys(env: { keys?: PieBoyKeys }): PieBoyKeys {
  return env.keys ?? defaultKeys;
}

export function bindingText(keys: PieBoyKeys, action: PieBoyAction): string {
  return keys.getKeys(action).join("/");
}
