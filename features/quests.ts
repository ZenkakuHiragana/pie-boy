import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitize, type PieBoyState } from "../state/core.ts";
import type { Quest, QuestObjective, QuestStore } from "../state/quests.ts";
import type { FeatureEnv } from "./env.ts";

export interface QuestData {
  version: number; source: string; quests: Quest[]; selected?: unknown; objectiveSelection?: { questKey: unknown; index: number }; error?: string; busy: boolean;
}
type Instance = { data: QuestData; env: FeatureEnv; store: QuestStore; active: boolean; initialized: boolean; readable: boolean; generation: number; unsubscribe?: () => void; context?: ExtensionContext };
const instances = new WeakMap<PieBoyState, Instance>();
const blank: QuestData = { version: 0, source: "", quests: [], busy: false };
export function questData(state: PieBoyState): Readonly<QuestData> { return instances.get(state)?.data ?? blank; }
export function selectedQuest(state: PieBoyState): Quest | undefined {
  const data = questData(state);
  return data.quests.find(q => q.key === data.selected) ?? data.quests[0];
}
export function selectQuest(state: PieBoyState, quest: Quest): void {
  const i = instances.get(state); if (!i || !i.data.quests.includes(quest)) return;
  i.data.selected = quest.key; i.data.objectiveSelection = { questKey: quest.key, index: 0 }; i.env.changed(i.data);
}
function message(error: unknown): string { return sanitize(error instanceof Error ? error.message : String(error)); }
async function refresh(i: Instance, retainError?: string, preferredIndex?: number): Promise<void> {
  const generation = ++i.generation;
  try {
    const quests = await i.store.read();
    if (!i.active || generation !== i.generation) return;
    i.readable = true; i.data.quests = quests; i.data.error = retainError;
    if (!quests.some(q => q.key === i.data.selected)) i.data.selected = quests[Math.min(preferredIndex ?? 0, Math.max(0, quests.length - 1))]?.key;
  } catch (error) {
    if (!i.active || generation !== i.generation) return;
    i.readable = false; i.data.quests = []; i.data.selected = undefined; i.data.error = `QUEST: ${message(error)}`;
  }
  i.env.changed(i.data);
}
export async function completeQuest(state: PieBoyState, quest: Quest, objective?: QuestObjective): Promise<void> {
  const i = instances.get(state);
  if (!i || !i.active || !i.initialized || !i.readable || i.data.busy || !i.data.quests.includes(quest) || (objective && !quest.objectives.includes(objective)) || !i.context?.hasUI) return;
  i.data.busy = true; i.env.changed(i.data);
  try {
    const yes = await i.context.ui.confirm("Complete QUEST?", objective ? `Remove subgoal: ${objective.text}?` : `Remove quest: ${quest.title}?`);
    if (!i.active || !yes) return;
    // A refresh while the dialog was open invalidates its displayed object.
    if (!i.data.quests.includes(quest) || !i.readable) { await refresh(i, "QUEST changed while confirming; please review it again"); return; }
    try {
      const index = i.data.quests.indexOf(quest);
      const objectiveIndex = objective ? quest.objectives.indexOf(objective) : 0;
      await i.store.complete(quest, objective);
      await refresh(i, undefined, index);
      const selected = selectedQuest(state);
      if (selected) i.data.objectiveSelection = { questKey: selected.key, index: Math.max(0, Math.min(objectiveIndex, selected.objectives.length - 1)) };
    }
    catch (error) { if (i.active) await refresh(i, `QUEST: ${message(error)}`); }
  } catch (error) { if (i.active) await refresh(i, `QUEST: ${message(error)}`); }
  finally { if (i.active) { i.data.busy = false; i.env.changed(i.data); } }
}
export function setupQuests(pi: ExtensionAPI, env: FeatureEnv, store: QuestStore): void {
  const i: Instance = { data: { version: 0, source: sanitize(store.source), quests: [], busy: false }, env, store, active: false, initialized: false, readable: false, generation: 0 };
  instances.set(env.state, i);
  pi.on("session_start", async (_event, ctx) => {
    i.active = true; i.context = ctx; const generation = ++i.generation;
    try { await store.initialize(); }
    catch (error) { if (i.active && generation === i.generation) { i.data.error = `QUEST initialization: ${message(error)}`; env.changed(i.data); } return; }
    if (!i.active || generation !== i.generation) return;
    i.initialized = true;
    if (ctx.mode === "tui" && ctx.hasUI) {
      try { i.unsubscribe = store.subscribe(() => { if (i.active) void refresh(i); }); }
      catch (error) { i.data.error = `QUEST watch: ${message(error)}`; env.changed(i.data); }
    }
    await refresh(i, i.data.error);
  });
  env.onShownChange(() => { if (i.active && i.initialized && i.context?.hasUI && (env.shows("questlist") || env.shows("questdetail"))) void refresh(i); });
  pi.on("before_agent_start", async event => {
    // Non-interactive sessions have no file watcher to recover a failed read.
    if (i.active && i.initialized && !i.readable) await refresh(i);
    return i.active && i.initialized && i.readable ? { systemPrompt: `${event.systemPrompt}\n\n${store.instructions()}` } : undefined;
  });
  pi.on("session_shutdown", () => { i.active = false; i.initialized = false; i.readable = false; i.context = undefined; ++i.generation; i.unsubscribe?.(); i.unsubscribe = undefined; });
}
