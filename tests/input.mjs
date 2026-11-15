// Real setupInput and key managers; fake Pi terminal registration and shell operations.
import assert from 'node:assert/strict';
import { load, theme as piTheme, themes, plain } from './support.mjs';

export default async function () {
  themes.setThemeInstance(piTheme);
  const { setupInput, panelHints } = await load('shell/input.ts');
  const { createKeybindings } = await load('keybindings.ts');
  const keys = createKeybindings({
    'pieBoy.tab.term': ['alt+7', 'alt+8'], 'pieBoy.tab.radio': 'alt+9',
    'pieBoy.tab.next': [], 'pieBoy.panel.down': 'q', 'pieBoy.panel.up': [],
    'pieBoy.panel.activate': ['a', 'b'], 'pieBoy.focus.toggle': 'alt+i',
  });
  const handlers = new Map(), shortcuts = new Map(), calls = [];
  const pi = {
    on(name, fn) { handlers.set(name, fn); },
    registerShortcut(key, spec) { assert.ok(!shortcuts.has(key), key); shortcuts.set(key, spec.handler); },
  };
  let panelMode = true, shown = true, editorFocused = true, typing = false, focus = 'list', primary = 'list', menuOpen = false, editor = '', listener, unsubscribed = 0;
  const list = {
    move(n) { calls.push(['move', n]); }, toStart() { calls.push(['start']); }, toEnd() { calls.push(['end']); },
    activate() { calls.push(['activate']); }, scroll(by) { calls.push(['scroll', by(10)]); },
    typing() { return typing; }, cancel() { calls.push(["cancel"]); typing=false; }, key(data) { calls.push(['key', data]); return false; },
  };
  const shell = {
    tabs: [{ label: 'TERM' }, { label: 'STAT' }, { label: 'DATA' }], keys,
    tabsShown: () => shown, editorFocused: () => editorFocused, panelMode: () => panelMode,
    setPanelMode(value) { calls.push(['mode', value]); panelMode = value; },
    focusedId: () => focus, handleFor: () => ({ list }), visiblePanels: () => ['list', 'other'],
    focusPanel(id) { focus = id; calls.push(['focus', id]); },
    primaryPanel: () => primary, editorMenuOpen: () => menuOpen,
    selectTab(n) { calls.push(['tab', n]); }, stepTab(n) { calls.push(['stepTab', n]); },
    stepPage(n) { calls.push(['stepPage', n]); }, toggleMaximized() { calls.push(['max']); },
    requestRender() { calls.push(['render']); }, ignoreTyping() { calls.push(['ignored']); },
  };
  setupInput(pi, shell);
  assert.ok(shortcuts.has('alt+7') && shortcuts.has('alt+8'));
  assert.ok(!shortcuts.has('alt+1') && !shortcuts.has('alt+j') && !shortcuts.has('alt+9'));
  shortcuts.get('alt+8')(); assert.deepEqual(calls.pop(), ['tab', 0]);
  const ui = { onTerminalInput(fn) { listener = fn; return () => { unsubscribed++; }; }, getEditorText: () => editor };
  handlers.get('session_start')({}, { mode: 'rpc', hasUI: true, ui }); assert.equal(listener, undefined);
  handlers.get('session_start')({}, { mode: 'tui', hasUI: true, ui }); assert.ok(listener);
  const send = data => { calls.length = 0; return listener(data); };
  assert.deepEqual(send('q'), { consume: true }); assert.ok(calls.some(c => c[0] === 'move' && c[1] === 1));
  assert.deepEqual(send('j'), { consume: true }); assert.ok(!calls.some(c => c[0] === 'move'));
  for (const key of ['a', 'b']) { assert.deepEqual(send(key), { consume: true }); assert.ok(calls.some(c => c[0] === 'activate')); }
  assert.deepEqual(send('k'), { consume: true }); assert.ok(!calls.some(c => c[0] === 'move'));
  assert.equal(send('\x1b'), undefined); assert.equal(send('\x03'), undefined);
  assert.deepEqual(send('\x1b[5~'), { consume: true }); assert.ok(calls.some(c => c[0] === 'scroll'));
  panelMode = false; primary = 'transcript'; assert.equal(send('\x1b[5~'), undefined);
  primary = 'list'; menuOpen = true; assert.equal(send('\x1b[5~'), undefined);
  menuOpen = false; assert.deepEqual(send('\x1b[5~'), { consume: true });
  panelMode = true;
  typing = true;
  assert.equal(send('\x03'), undefined); assert.ok(!calls.length);
  assert.deepEqual(send('\x1bi'), { consume: true });
  assert.deepEqual(calls[0], ['cancel']); assert.equal(panelMode, false);
  typing = false; panelMode = true;
  assert.equal(send('/'), undefined); assert.equal(panelMode, false);
  panelMode = true; editor = 'existing'; assert.deepEqual(send('/'), { consume: true }); assert.equal(panelMode, true);
  shown = false; assert.equal(send('q'), undefined); shown = true;
  editorFocused = false; assert.equal(send('q'), undefined);
  const theme = () => ({ fg: (_color, text) => text });
  const hint = plain(panelHints(theme, keys));
  assert.ok(hint.includes('q')); assert.ok(!hint.includes('j')); assert.ok(!hint.includes(' up'));
  assert.ok(hint.includes('a/b')); assert.ok(hint.includes('alt+i'));
  handlers.get('session_shutdown')(); assert.equal(unsubscribed, 1);
  // Printable extension shortcuts are not swallowed by the panel text guard.
  shell.keys = createKeybindings({'pieBoy.focus.toggle':'q','pieBoy.tab.term':'v'});
  shortcuts.clear(); setupInput(pi,shell); shown=true; editorFocused=true; panelMode=true; editor='';
  handlers.get('session_start')({}, {mode:'tui',hasUI:true,ui});
  assert.equal(send('q'),undefined); shortcuts.get('q')(); assert.equal(panelMode,false);
  panelMode=true; assert.equal(send('v'),undefined); shortcuts.get('v')(); assert.ok(calls.some(c=>c[0]==='tab'&&c[1]===0));
  assert.ok(!shortcuts.has('alt+o') && !shortcuts.has('alt+1'));
  handlers.get('session_shutdown')();
}
