import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { bindingHint, createKeybindings } from "../keybindings.ts";
import { completeQuest, questData, selectedQuest, selectQuest } from "../features/quests.ts";
import { framed } from "../screen/frame.ts";
import { ListLines, Selection, withCursor } from "./common.ts";
import { registerPanel } from "./registry.ts";

const defaults = createKeybindings();
registerPanel("questlist", env => {
  const keys = env.keys ?? defaults;
  const selection = new class extends Selection {
    key(data: string): boolean {
      if (!keys.matches(data, "pieBoy.quest.complete")) return false;
      const quest = selectedQuest(env.state); if (quest) void completeQuest(env.state, quest);
      return true;
    }
  }(() => questData(env.state).quests.map(q => q.key), index => {
    const quest = questData(env.state).quests[index]; if (quest) selectQuest(env.state, quest);
  }, () => selectedQuest(env.state)?.key);
  const panel = framed(env.theme, () => ["QUEST", bindingHint(keys, "pieBoy.quest.complete", "complete")].filter(Boolean).join("  ·  "), new ListLines(selection, width => {
    selection.reset(); const data = questData(env.state); const t = env.theme(); const lines: string[] = [];
    data.quests.forEach((q, index) => { selection.place(index, lines.length, 1); lines.push(truncateToWidth(` ${t.fg("text", q.title)}`, Math.max(1, width - 1))); });
    if (!data.quests.length && !data.error) lines.push(t.fg("dim", " -- no quests --"));
    if (data.error) for (const line of wrapTextWithAnsi(data.error, Math.max(1, width - 2))) lines.push(t.fg("error", ` ${line}`));
    if (data.busy) lines.push(t.fg("dim", " confirming…"));
    return withCursor(env, selection, "questlist", lines);
  }, () => [questData(env.state).version, selection.selectedKey, env.focused("questlist")]), "top", () => env.focused("questlist"));
  selection.view = panel.scroll; return { ...panel, list: selection };
});

registerPanel("questdetail", env => {
  const keys = env.keys ?? defaults;
  const selection = new class extends Selection {
    private lastIndex = 0;
    private questKey: unknown;
    override get index(): number {
      const quest = selectedQuest(env.state);
      if (quest?.key !== this.questKey) {
        this.questKey = quest?.key;
        const preferred = questData(env.state).objectiveSelection;
        this.lastIndex = preferred?.questKey === quest?.key ? preferred?.index ?? 0 : 0;
        if (this.keys().length) this.select(Math.min(this.lastIndex, this.keys().length - 1));
      }
      const current = super.index;
      if (current >= 0) { this.lastIndex = current; return current; }
      if (!this.keys().length) return -1;
      const next = Math.min(this.lastIndex, this.keys().length - 1);
      this.select(next);
      return next;
    }
    key(data: string): boolean {
      if (!keys.matches(data, "pieBoy.quest.complete")) return false;
      const quest = selectedQuest(env.state); const objective = quest?.objectives[this.index];
      if (quest && objective) void completeQuest(env.state, quest, objective);
      return true;
    }
  }(() => (selectedQuest(env.state)?.objectives ?? []).map(o => o.key), () => {});
  const panel = framed(env.theme, () => ["DETAIL", bindingHint(keys, "pieBoy.quest.complete", "complete subgoal")].filter(Boolean).join("  ·  "), new ListLines(selection, width => {
    selection.reset(); const t = env.theme(); const data = questData(env.state); const quest = selectedQuest(env.state); const lines: string[] = [];
    const wrap = (text: string, prefix = 1) => text.split("\n").flatMap(line => line ? wrapTextWithAnsi(line, Math.max(1, width - 1 - prefix)) : [""]);
    if (quest) {
      for (const line of wrap(quest.title)) lines.push(t.fg("accent", ` ${line}`));
      if (quest.description) { lines.push(""); for (const line of wrap(quest.description)) lines.push(` ${t.fg("text", line)}`); }
      if (quest.provenance) { lines.push(""); for (const line of wrap(quest.provenance)) lines.push(` ${t.fg("dim", line)}`); }
      if (quest.objectives.length) lines.push("", t.fg("muted", " SUBGOALS"));
      quest.objectives.forEach((objective, index) => {
        const prefix = width >= 6 ? " - " : "";
        const rows = wrap(objective.text, prefix.length);
        selection.place(index, lines.length, rows.length);
        rows.forEach((line, n) => lines.push(`${n ? " ".repeat(prefix.length) : prefix}${t.fg("text", line)}`));
      });
    }
    if (data.error) for (const line of wrap(data.error)) lines.push(t.fg("error", ` ${line}`));
    if (data.source) { lines.push(""); for (const line of wrap(data.source)) lines.push(t.fg("dim", ` ${line}`)); }
    return withCursor(env, selection, "questdetail", lines);
  }, () => [questData(env.state).version, selection.selectedKey, env.focused("questdetail")]), "top", () => env.focused("questdetail"));
  selection.view = panel.scroll; return { ...panel, list: selection };
});
