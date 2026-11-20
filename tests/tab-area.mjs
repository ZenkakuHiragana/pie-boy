// Pi's fullscreen renderer, SGR mouse dispatcher, and built-in selector
// entry points, with isolated session, model and settings data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, load, loadPi, tui, theme, themes, plain, user } from './support.mjs';

export default async function () {
  const { InteractiveMode } = await loadPi('pi-coding-agent/dist/modes/interactive/interactive-mode.js');
  const { createShell } = await load('shell/controller.ts');
  const { setupInput } = await load('shell/input.ts');
  await load('panels/radio.ts');
  const { Selection, ListLines } = await load('panels/common.ts');
  const { registerPanel } = await load('panels/registry.ts');
  const { framed } = await load('screen/frame.ts');
  let activations = 0;
  registerPanel('testrows', (env) => {
    const labels = Array.from({ length: 40 }, (_, i) => `ITEM ${i}`);
    const list = new Selection(() => labels, () => { activations++; });
    return framed(env.theme, () => 'LIST', new ListLines(list, () => {
      list.reset();
      labels.forEach((_, i) => list.place(i, i, 1));
      return labels;
    }, () => []), 'top', () => env.focused('testrows'));
  });
  themes.setThemeInstance(theme);

  const terminal = { columns: 160, rows: 26, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const screen = new tui.TuiAltScreen(terminal, true);
  screen.altScreenActive = true;
  const editorContainer = new tui.Container();
  screen.setLayoutRoot(new tui.VStack([
    new tui.ScrollView(new tui.Text('Pi transcript'), { primary: true }),
    editorContainer,
  ]));

  const handlers = new Map();
  const pi = {
    on(event, fn) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); },
    getSettings: () => ({}),
    registerToolRenderer() {},
    registerShortcut() {},
  };
  let editor;
  const ctx = { hasUI: true, mode: 'tui', ui: {
    theme: { fg: theme.fg.bind(theme), bg: theme.bg.bind(theme), bold: theme.bold.bind(theme),
      getFgAnsi: () => '\x1b[39m' },
    onTerminalInput: (fn) => screen.addInputListener(fn),
    getEditorText: () => editor.getText(),
    setWorkingVisible() {},
    setEditorComponent(factory) {
      if (!factory) { editorContainer.clear(); return; }
      editor = factory(screen, themes.getEditorTheme(), tui.getKeybindings());
      editorContainer.addChild(editor);
      screen.setFocus(editor);
    },
  } };
  const emit = (name, event = {}) => { for (const fn of handlers.get(name) ?? []) fn(event, ctx); };
  const shell = createShell(pi, [
    ...['TERM', 'STAT', 'INV', 'DATA', 'MAP'].map((label) => ({ label, layout: 'transcript' })),
    { label: 'RADIO', pages: [
      { label: 'SEARCH', layout: { row: [{ panel: 'radiosearch', size: '50%' }, 'testrows'] } },
      { label: 'STATIONS', layout: 'nosignal' },
    ] },
  ]);
  setupInput(pi, shell);
  emit('session_start');
  shell.selectTab(5);
  const frame = () => { screen.renderNow(); return screen.getScreenLines(); };
  const send = (data) => screen.handleTerminalInput(data);
  const mouse = (button, x, y, suffix = 'M') => send(`\x1b[<${button};${x + 1};${y + 1}${suffix}`);
  const click = (x, y) => { mouse(0, x, y); mouse(0, x, y, 'm'); };
  const find = (lines, text) => {
    const y = lines.findIndex((line) => plain(line).includes(text));
    assert.notEqual(y, -1, text);
    return [plain(lines[y]).indexOf(text), y];
  };
  const list = shell.handleFor('radiosearch').list;
  const pane = shell.handleFor('testrows').scroll;
  const history = api.SessionManager.inMemory();
  history.appendMessage(user('A test history entry'));
  const sessionDir = join(process.env.PI_SCRATCHPAD ?? tmpdir(), randomUUID());
  const mode = {
    ui: screen, editorContainer, editor,
    showSelector: InteractiveMode.prototype.showSelector,
    disposeActiveSelector: InteractiveMode.prototype.disposeActiveSelector,
    settingsManager: api.SettingsManager.inMemory(),
    sessionManager: {
      getTree: () => history.getTree(),
      getLeafId: () => history.getLeafId(),
      getCwd: () => process.cwd(),
      getSessionDir: () => sessionDir,
      usesDefaultSessionDir: () => false,
      getSessionFile: () => undefined,
    },
    keybindings: tui.getKeybindings(),
    themeController: { getThemeSelection: () => 'dark', getTerminalTheme: () => 'dark' },
    session: {
      scopedModels: [], steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time',
      modelRuntime: {
        getAvailableSnapshot: () => [],
        refresh: async () => ({ errors: new Map() }),
        getError: () => undefined,
      },
    },
  };
  let dockClicks = 0, received = '';
  const open = () => InteractiveMode.prototype.showSelector.call(mode, (done) => {
    const selector = {
      render: () => ['PI SELECTOR'],
      invalidate() {},
      handleInput(data) { if (data === '\x1b') done(); else received += data; },
      handleMouse(event) {
        if (event.type !== 'press') return undefined;
        dockClicks++;
        return { handled: true };
      },
    };
    return { component: selector, focus: selector };
  });

  try {
    let lines = frame();
    const search = find(lines, 'search YouTube');
    const otherTab = find(lines, 'TERM');
    const otherPage = find(lines, 'STATIONS');
    const [divider] = find(lines, '│');
    const row = find(lines, 'ITEM 0');
    click(...row);
    assert.equal(activations, 1);
    frame();
    assert.ok(divider > 0);
    assert.match(plain(lines.join('\n')), /◆ SEARCH/);

    // Disabling mid-drag cancels its capture rather than committing the split.
    mouse(0, divider, 4);
    mouse(32, divider + 9, 4);
    open();
    // A press immediately after the focus moves still hits the old layout.
    mouse(0, divider + 9, 4, 'm');
    click(...search);
    assert.equal(list.typing(), false);

    lines = frame();
    assert.match(lines[0], /\x1b\[2m/);
    assert.match(lines[1], /\x1b\[2m/);
    assert.match(lines[search[1]], /\x1b\[2m/);
    assert.doesNotMatch(plain(lines.join('\n')), /◆ SEARCH/);
    assert.match(plain(lines[0]), /Close Pi dialog/);
    const dock = find(lines, 'PI SELECTOR');
    assert.doesNotMatch(lines[dock[1]], /\x1b\[2m/);
    click(...dock);
    assert.equal(dockClicks, 1);
    click(...otherTab);
    click(...otherPage);
    click(...search);
    click(...row);
    mouse(0, divider, 4);
    mouse(32, divider + 9, 4);
    mouse(0, divider + 9, 4, 'm');
    // The native scrollbar track lies on the last terminal column.
    mouse(35, terminal.columns - 1, 10);
    click(terminal.columns - 1, 18);
    mouse(65, ...row);
    assert.equal(pane.scrollTop, 0);
    assert.equal(activations, 1);
    assert.deepEqual(shell.visiblePanels(), ['radiosearch', 'testrows']);
    assert.equal(list.typing(), false);
    send('s');
    assert.equal(received, 's');

    send('\x1b');
    lines = frame();
    assert.doesNotMatch(plain(lines[0]), /Close Pi dialog/);
    assert.equal(find(lines, '│')[0], divider);
    assert.deepEqual(shell.visiblePanels(), ['radiosearch', 'testrows']);
    assert.equal(list.typing(), false);
    assert.equal(activations, 1);
    // Hover + click the same native scrollbar successfully when active.
    mouse(35, terminal.columns - 1, 10);
    frame();
    click(terminal.columns - 1, 18);
    assert.ok(pane.scrollTop > 0);
    click(...search);
    send('q');
    lines = frame();
    assert.equal(list.typing(), true);
    const draft = find(lines, '› q');
    assert.equal(editor.getText(), '');
    assert.equal(received, 's');

    // An existing draft remains visible without the edit frame and can be
    // resumed when Pi returns focus; resizing doesn't change the layout model.
    open();
    terminal.columns = 140;
    lines = frame();
    assert.doesNotMatch(plain(lines[draft[1]]), /│› q/);
    find(lines, '› q');
    send('\x1b');
    terminal.columns = 160;
    send('r');
    lines = frame();
    find(lines, '› qr');
    assert.equal(editor.getText(), '');
    assert.equal(received, 's');
    // The real /tree, /resume, /model and /settings entry points all swap the
    // editor out, receive text themselves, then restore it on Esc.
    list.cancel();
    terminal.columns = 50;
    open();
    assert.match(plain(frame()[0]), /RADIO.*Close Pi dialog/);
    send('\x1b');
    terminal.columns = 80;
    for (const method of ['showTreeSelector', 'showSessionSelector', 'showModelSelector', 'showSettingsSelector']) {
      InteractiveMode.prototype[method].call(mode);
      const focused = screen.getFocusedComponent();
      assert.notEqual(focused, editor, method);
      const inputs = [];
      const handle = focused.handleInput.bind(focused);
      focused.handleInput = (data) => { inputs.push(data); handle(data); };
      const openLines = frame();
      assert.match(plain(openLines[0]), /Close Pi dialog/, method);
      click(...find(openLines, 'search YouTube'));
      assert.equal(list.typing(), false, method);
      send('x');
      assert.deepEqual(inputs, ['x'], method);
      assert.equal(editor.getText(), '', method);
      assert.equal(list.typing(), false, method);
      send('\x1b');
      // Some built-ins use the first Esc to clear their search.
      if (screen.getFocusedComponent() !== editor) send('\x1b');
      assert.equal(screen.getFocusedComponent(), editor, method);
      assert.doesNotMatch(plain(frame()[0]), /Close Pi dialog/, method);
    }
  } finally {
    emit('session_shutdown', { reason: 'quit' });
    screen.stop({ preserveScreen: true });
  }
}
