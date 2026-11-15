/**
 * Pie-boy entry point. Read config before importing feature and panel implementations.
 * Disabled optional features are not imported or initialized. Shared core data stays
 * active for the panels that still use it (for example TERM LOG and STAT).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.ts";

export default async function (pi: ExtensionAPI): Promise<void> {
  const config = readConfig();
  const [layout, input, controller, panels, bindings, context, extensions, git, images,
    inventory, models, sessions, tools, tree, usage, vitals] = await Promise.all([
    import("./layout.ts"), import("./shell/input.ts"), import("./shell/controller.ts"),
    import("./panels/index.ts"), import("./keybindings.ts"), import("./features/context.ts"),
    import("./features/extensions.ts"), import("./features/git.ts"), import("./features/image.ts"),
    import("./features/inv.ts"), import("./features/models.ts"), import("./features/sessions.ts"),
    import("./features/tools.ts"), import("./features/tree.ts"), import("./features/usage.ts"),
    import("./features/vitals.ts"),
  ]);
  await panels.loadPanels(config);
  let art: import("./panels/status-art.ts").StatusArt | undefined;
  let logo: typeof import("./features/logo.ts") | undefined;
  if (config.stat.art !== "off") {
    const { createStatusArt } = await import("./panels/status-art.ts");
    if (config.stat.art === "auto") logo = await import("./features/logo.ts");
    art = createStatusArt(logo, config.stat.kitty);
  }
  const keys = bindings.createKeybindings(config.keybindings);
  const shell = controller.createShell(pi, layout.createTabs(config), art, keys);
  input.setupInput(pi, shell);
  const env = shell.features;
  tools.setupTools(pi, env, config.chat.thinking);
  git.setupGit(pi, env);
  context.setupContext(pi, env);
  usage.setupUsage(pi, env);
  vitals.setupVitals(pi, env);
  logo?.setupLogo(pi, env);
  images.setupImages(pi, env);
  sessions.setupSessions(pi, env);
  models.setupModels(pi, env);
  extensions.setupExtensions(pi, env);
  tree.setupTree(pi, env);
  inventory.setupInventory(pi, env);
  if (config.radio.enabled) {
    const { setupRadio } = await import("./features/radio.ts");
    setupRadio(pi, env);
  } else {
    const { stopRadio } = await import("./state/radio-lifetime.ts");
    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode === "tui" && ctx.hasUI) stopRadio();
    });
  }
  if (config.quest.enabled) {
    const [{ setupQuests }, { createMarkdownQuestStore }] = await Promise.all([
      import("./features/quests.ts"), import("./state/quests.ts"),
    ]);
    setupQuests(pi, env, createMarkdownQuestStore());
  }
}
