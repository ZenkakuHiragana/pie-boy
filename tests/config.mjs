import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, plain, tui, theme, themes } from './support.mjs';

export default async function () {
  themes.setThemeInstance(theme);
  const { DEFAULT_CONFIG, parseConfig, readConfig, configFile } = await load('config.ts');
  const { PIE_BOY_BINDINGS, createKeybindings, bindingHint } = await load('keybindings.ts');
  assert.ok(process.env.PI_SCRATCHPAD, 'PI_SCRATCHPAD is required for config tests');
  const dir = mkdtempSync(join(process.env.PI_SCRATCHPAD, 'pie-boy-config-'));
  try {
    assert.equal(configFile(dir), join(dir, 'pie-boy', 'config.json'));
    assert.deepEqual(readConfig(dir), DEFAULT_CONFIG);
    assert.deepEqual(parseConfig({}), DEFAULT_CONFIG);
    const fresh = parseConfig({});
    fresh.chat.thinking = false;
    assert.equal(parseConfig({}).chat.thinking, true);
    assert.deepEqual(parseConfig({ stat: { art: 'pixel-art' }, radio: { enabled: false }, chat: { toolLog: false }, quest: { enabled: true } }), {
      stat: { art: 'pixel-art', kitty: true }, radio: { enabled: false }, chat: { thinking: true, toolLog: false }, quest: { enabled: true }, keybindings: {},
    });
    assert.deepEqual(parseConfig({stat:{kitty:false}}).stat,{art:'auto',kitty:false});
    for(const art of ['auto','pixel-art','off'])for(const kitty of [true,false])assert.deepEqual(parseConfig({stat:{art,kitty}}).stat,{art,kitty});
    for(const kitty of ['false',null,0,[],{}])assert.throws(()=>parseConfig({stat:{kitty}}),/stat.kitty/);
    const global = tui.getKeybindings();
    const defaults = createKeybindings();
    for (const [id, definition] of Object.entries(PIE_BOY_BINDINGS)) {
      assert.deepEqual(defaults.getKeys(id), [].concat(definition.defaultKeys));
    }
    assert.equal(defaults.matches('\x1b1', 'pieBoy.tab.term'), true);
    assert.equal(defaults.matches('j', 'pieBoy.panel.down'), true);
    const panelDefaults = {
      'pieBoy.radio.next': ['n'], 'pieBoy.radio.volumeUp': ['+', '='], 'pieBoy.radio.volumeDown': ['-'],
      'pieBoy.radio.deleteStation': ['delete'], 'pieBoy.radio.addPlaylist': ['a'], 'pieBoy.models.toggleScope': ['s'],
      'pieBoy.tree.help': ['?'], 'pieBoy.tree.previousBranch': ['['], 'pieBoy.tree.nextBranch': [']'],
      'pieBoy.tree.here': ['.'], 'pieBoy.field.cancel': ['escape', 'tab'],
    };
    for (const [id, expected] of Object.entries(panelDefaults)) {
      assert.deepEqual(defaults.getKeys(id), expected);
      assert.deepEqual(createKeybindings(parseConfig({keybindings: {[id]: []}}).keybindings).getKeys(id), []);
      assert.deepEqual(createKeybindings(parseConfig({keybindings: {[id]: 'ctrl+q'}}).keybindings).getKeys(id), ['ctrl+q']);
    }
    const cfg = parseConfig({ keybindings: {
      'pieBoy.tab.term': ['ctrl++', 'super+shift+alt+ctrl+x'],
      'pieBoy.panel.down': 'ctrl+j', 'pieBoy.quest.complete': [],
    } });
    const keys = createKeybindings(cfg.keybindings);
    assert.equal(tui.getKeybindings(), global);
    assert.deepEqual(keys.getKeys('pieBoy.tab.term'), ['ctrl++', 'super+shift+alt+ctrl+x']);
    assert.equal(keys.matches('\x1b1', 'pieBoy.tab.term'), false);
    assert.equal(keys.matches('\x1b[43;5u', 'pieBoy.tab.term'), true);
    assert.equal(keys.matches('j', 'pieBoy.panel.down'), false);
    assert.equal(keys.matches('\n', 'pieBoy.panel.down'), true);
    assert.deepEqual(keys.getKeys('pieBoy.quest.complete'), []);
    assert.equal(bindingHint(keys, 'pieBoy.quest.complete', 'complete'), '');
    const hint = plain(bindingHint(keys, 'pieBoy.tab.term', 'term'));
    assert.ok(hint.includes('ctrl++') && !hint.includes('alt+1'));
    assert.ok(plain(bindingHint(defaults, 'pieBoy.tab.term', 'term')).includes('alt+1'));
    for (const key of ['+', 'ctrl++', 'ctrl+shift+alt+super+pageUp', 'alt+ctrl+x', '\\', 'f12', 'shift+tab']) {
      assert.doesNotThrow(() => parseConfig({keybindings: {'pieBoy.panel.up': key}}), key);
    }
    for (const key of ['', 'ctrl+', 'ctrl+ctrl+x', 'hyper+x', 'ctrl++x', 'f13', 'A', 'pageup', 'x+y', ' ']) {
      assert.throws(() => parseConfig({keybindings: {'pieBoy.panel.up': key}}), undefined, key);
    }
    for (const invalid of [null, [], 1, 'x', { unknown: true }, { stat: null }, { stat: { art: 'bad' } }, { stat: { extra: 1 } },
      { radio: { enabled: 'false' } }, { chat: { thinking: null } }, { quest: { enabled: 0 } }, { keybindings: [] },
      { keybindings: { unknown: 'x' } }, { keybindings: { 'pieBoy.panel.up': [1] } },
      { keybindings: { 'pieBoy.panel.up': null } }, { keybindings: { 'pieBoy.panel.up': Array(1) } }, new Date(), { keybindings: { 'pieBoy.panel.up': undefined } },
      JSON.parse('{"__proto__": 1}'), JSON.parse('{"keybindings":{"__proto__":"x"}}')]) {
      assert.throws(() => parseConfig(invalid), undefined, JSON.stringify(invalid));
    }
    mkdirSync(join(dir, 'pie-boy'));
    writeFileSync(configFile(dir), '{ invalid');
    assert.throws(() => readConfig(dir), SyntaxError);
    writeFileSync(configFile(dir), JSON.stringify({ stat: { art: 'off' } }));
    assert.equal(readConfig(dir).stat.art, 'off');
    rmSync(configFile(dir));
    mkdirSync(configFile(dir));
    assert.throws(() => readConfig(dir));
    rmSync(configFile(dir), { recursive: true });
    rmSync(join(dir, 'pie-boy'), { recursive: true });
    writeFileSync(join(dir, 'pie-boy'), 'not a directory');
    assert.throws(() => readConfig(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
