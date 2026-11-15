import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from './support.mjs';

export default async function () {
  assert.ok(process.env.PI_SCRATCHPAD);
  const scratch = mkdtempSync(join(process.env.PI_SCRATCHPAD, 'config-startup-'));
  const worker = fileURLToPath(new URL('./config-startup-worker.mjs', import.meta.url));
  const off = { stat: { art: 'off' }, radio: { enabled: false }, chat: { thinking: false, toolLog: false } };
  try {
    for (const [name, config] of Object.entries({ off, pixel: { ...off, stat: { art: 'pixel-art' } }, autoNoKitty: { ...off, stat: { art: 'auto', kitty: false } }, default: null, quest: { ...off, quest: { enabled: true } }, invalid: { radio: { enabled: 'no' } } })) {
      const agent = join(scratch, name); mkdirSync(join(agent, 'pie-boy'), { recursive: true });
      if (config) writeFileSync(join(agent, 'pie-boy', 'config.json'), JSON.stringify(config));
      const child = spawnSync(process.execPath, [worker, name], { env: { ...process.env, PI_CODING_AGENT_DIR: agent }, encoding: 'utf8', timeout: 45000 });
      assert.equal(child.status, 0, `${name}: ${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }

  const { createTabs } = await load('layout.ts');
  const { parseConfig } = await load('config.ts');
  const leaves = node => typeof node === 'string' ? [node] : node.panel ? [node.panel] : [...(node.row ?? node.column ?? [])].flatMap(leaves);
  for (const thinking of [false, true]) for (const toolLog of [false, true]) {
    const tabs = createTabs(parseConfig({ chat: { thinking, toolLog }, radio: { enabled: false }, quest: { enabled: true } }));
    assert.deepEqual(tabs.map(t => t.label), ['TERM', 'STAT', 'INV', 'DATA', 'MAP']);
    const term = tabs.find(t => t.label === 'TERM');
    assert.equal(term.pages.find(p => p.label === 'LOG').layout, 'toollog');
    const chat = term.pages.find(p => p.label === 'CHAT').layout;
    assert.deepEqual(leaves(chat.wide).sort(), ['transcript', ...(thinking ? ['thinking'] : []), ...(toolLog ? ['toollog'] : [])].sort());
    assert.deepEqual(leaves(chat.narrow).sort(), ['transcript', ...(thinking ? ['thinking'] : []), ...(toolLog ? ['tools'] : [])].sort());
    const quest = tabs.find(t => t.label === 'DATA').pages.find(p => p.label === 'QUEST');
    assert.deepEqual(leaves(quest.layout.wide), ['questlist', 'questdetail']);
    assert.deepEqual(leaves(quest.layout.narrow), ['questlist', 'questdetail']);
  }
}
