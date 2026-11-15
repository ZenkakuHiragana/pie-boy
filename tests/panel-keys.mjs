import assert from 'node:assert/strict';
import { harness, load, plain, renderLayoutFrame, theme, themes, tui } from './support.mjs';

export default async function panelKeys() {
  themes.setThemeInstance(theme);
  for (const path of ['panels/radio.ts', 'panels/models.ts', 'panels/tree.ts', 'panels/inv.ts']) await load(path);
  const { PANELS } = await load('panels/registry.ts');
  const { createKeybindings } = await load('keybindings.ts');
  const h = await harness();
  const base = { ...h.panelEnv, focusPanel: () => {}, tui: () => undefined, renderersFor: () => undefined };
  const make = (id, keys) => PANELS.get(id)({ ...base, ...(keys ? { keys } : {}) });
  const frame = (p, height = 20) => {
    renderLayoutFrame(p.component, 100, height, () => {});
    return renderLayoutFrame(p.component, 100, height, () => {}).lines.map(plain).join('\n');
  };
  const defaults = make('modellist');
  assert.match(defaults.title(), /s: scoped/);
  assert.equal(defaults.list.key('s'), true);
  const custom = createKeybindings({
    'pieBoy.models.toggleScope': 'u', 'pieBoy.radio.next': 'r', 'pieBoy.radio.volumeUp': [],
    'pieBoy.radio.volumeDown': 'v', 'pieBoy.radio.deleteStation': 'd', 'pieBoy.radio.addPlaylist': [],
    'pieBoy.field.cancel': 'ctrl+q', 'pieBoy.tree.help': 'h', 'pieBoy.tree.previousBranch': 'p',
    'pieBoy.tree.nextBranch': [], 'pieBoy.tree.here': 'b', 'pieBoy.panel.activate': 'ctrl+x',
  });
  const model = make('modellist', custom);
  assert.match(model.title(), /u: scoped/);
  assert.equal(model.list.key('s'), false);
  assert.equal(model.list.key('u'), true);
  let player = frame(make('nowplaying', custom), 25);
  assert.match(player, /CTRL\+X OR CLICK A STATION TO TUNE IN/);
  assert.match(player, /r next/);
  assert.match(player, /v volume down/);
  assert.doesNotMatch(player, /volume up/);
  const station = make('stations', custom);
  assert.match(station.title(), /D ×2/);
  assert.equal(station.list.key('n'), false);
  assert.equal(station.list.key('r'), true);
  assert.equal(station.list.key('+'), false);
  assert.equal(station.list.key('v'), true);
  assert.equal(station.list.key('\x1b[3~'), false);
  assert.equal(station.list.key('d'), true);
  const disabled = createKeybindings({ 'pieBoy.radio.deleteStation': [], 'pieBoy.panel.activate': [], 'pieBoy.models.toggleScope': [] });
  assert.doesNotMatch(make('stations', disabled).title(), /remove/i);
  player = frame(make('nowplaying', disabled), 25);
  assert.match(player, /CLICK A STATION TO TUNE IN/);
  assert.doesNotMatch(player, /ENTER OR CLICK/);
  assert.doesNotMatch(make('modellist', disabled).title(), /scoped/i);
  assert.match(frame(make('tooldetail', custom)), /ctrl\+x or a click/);
  assert.match(frame(make('tooldetail', disabled)), /a click/);
  assert.doesNotMatch(frame(make('tooldetail', disabled)), /enter/i);
  const tree = make('tree', custom);
  assert.equal(tree.list.key('?'), false);
  assert.equal(tree.list.key('h'), true);
  let text = frame(tree);
  assert.match(text, /p\s+previous fork/);
  assert.doesNotMatch(text, /next fork/);
  assert.equal(tree.list.key('b'), true);
  assert.equal(tree.list.key('.'), false);
  assert.equal(tree.list.key(']'), false);

  const { pieBoyEditor } = await load('shell/editor.ts');
  const shell = {
    keys: createKeybindings({ 'pieBoy.focus.toggle': 'alt+i' }), theme: () => theme, state: {}, now: () => 0,
    panelMode: () => true, tabsShown: () => true, typingIgnored: () => false, focusedId: () => undefined,
    every: () => 0,
  };
  const editor = pieBoyEditor(shell, () => {}, { requestRender() {}, terminal: { rows: 40, columns: 100 } }, themes.getEditorTheme(), tui.getKeybindings());
  assert.match(editor.render(100).map(plain).join('\n'), /alt\+i to type/);
  assert.doesNotMatch(editor.render(100).map(plain).join('\n'), /alt\+o to type/i);
  shell.keys = createKeybindings({ 'pieBoy.focus.toggle': [] });
  assert.match(editor.render(100).map(plain).join('\n'), /click editor to type/);

  const global = tui.getKeybindings();
  const native = new tui.KeybindingsManager({ ...tui.TUI_KEYBINDINGS, 'app.tree.editLabel': { defaultKeys: 'l' } }, { 'tui.input.submit': 'ctrl+y' });
  tui.setKeybindings(native);
  try {
    const search = make('radiosearch', custom);
    assert.doesNotMatch(search.title(), /add playlist/);
    search.list.activate();
    assert.equal(search.list.typing(), true);
    text = frame(search);
    assert.match(text, /CTRL\+Y search/);
    assert.match(text, /CTRL\+Q cancel/);
    assert.doesNotMatch(text, /ENTER search|ESC cancel/);
    search.list.key('\x1b');
    assert.equal(search.list.typing(), true, 'disabled Escape does not cancel through Pi Input');
    search.list.key('\x11');
    assert.equal(search.list.typing(), false);
    search.list.activate();
    search.list.cancel();
    assert.equal(search.list.typing(), false, 'focus handoff cancels independently of bindings');

    const { setupTree } = await load('features/tree.ts');
    const node = { entry: { id: 'entry', parentId: null, timestamp: new Date().toISOString(), type: 'message', message: { role: 'user', content: 'hello' } }, children: [] };
    const treeCtx = { sessionManager: { getTree: () => [node], getLeafId: () => 'entry' } };
    setupTree({ on() {}, registerCommand() {}, getSettings: () => ({}) }, {
      state: h.state, context: () => treeCtx, requestRender() {}, shows: () => true,
    });
    const labeled = make('tree', custom);
    frame(labeled);
    assert.equal(labeled.list.key('l'), true, 'Pi tree label binding remains active');
    assert.equal(labeled.list.typing(), true);
    labeled.list.key('\x1b');
    assert.equal(labeled.list.typing(), true);
    labeled.list.key('\x11');
    assert.equal(labeled.list.typing(), false);
    labeled.list.key('l');
    labeled.list.cancel();
    assert.equal(labeled.list.typing(), false);
  } finally { tui.setKeybindings(global); }
  const { setupInput } = await load('shell/input.ts');
  for (const cancel of ['ctrl+q', []]) {
    const keys=createKeybindings({'pieBoy.field.cancel':cancel});
    const search=make('radiosearch',keys); search.list.activate(); assert.equal(search.list.typing(),true);
    let terminalInput; const handlers=new Map(); let mode=true;
    const inputShell={keys,tabs:[],tabsShown:()=>true,editorFocused:()=>true,panelMode:()=>mode,setPanelMode:v=>mode=v,focusedId:()=> 'search',handleFor:()=>({list:search.list}),requestRender:()=>{}};
    setupInput({on:(n,f)=>handlers.set(n,f),registerShortcut:()=>{}},inputShell);
    handlers.get('session_start')({}, {mode:'tui',hasUI:true,ui:{onTerminalInput:f=>{terminalInput=f;return()=>{};},getEditorText:()=>''}});
    terminalInput('\x1bo'); assert.equal(search.list.typing(),false,'focus change closes independently of cancel binding'); assert.equal(mode,false);
    handlers.get('session_shutdown')();
    search.list.activate(); mode=true;
    const mouseShell={...inputShell,theme:()=>theme,state:{},now:()=>0,every:()=>0,typingIgnored:()=>false};
    const mouseEditor=pieBoyEditor(mouseShell,()=>{}, {requestRender(){},terminal:{rows:40,columns:100}},themes.getEditorTheme(),tui.getKeybindings());
    const mouseResult=mouseEditor.handleMouse({type:'click',button:'left',x:2,y:0,width:100,height:3});
    assert.equal(mouseResult.handled,true);
    assert.equal(search.list.typing(),false,'editor click closes independently of cancel binding');
    assert.equal(mode,false);
  }
  const treeOne=make('tree',createKeybindings({'pieBoy.tree.help':'h','pieBoy.panel.start':[]}));treeOne.list.key('h');
  const treeText=frame(treeOne); assert.match(treeText,/end\s+last row/); assert.doesNotMatch(treeText,/first \/ last row/);

}
