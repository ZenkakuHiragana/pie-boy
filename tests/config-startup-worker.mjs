// Fresh process: real index/config/layout/features, fake Pi registration boundary.
// Session callbacks unrelated to the assertion are not run (no TUI, network or model).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { jiti, load, root } from './support.mjs';

const scenario = process.argv[2];
const handlers = new Map(), shortcuts = [], tools = [];
const pi = {
  on(name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
  registerShortcut(...args) { shortcuts.push(args); },
  registerCommand() {}, registerMarkdownTransformer() {}, registerToolRenderer() {},
  registerTool(tool) { tools.push(tool); },
};
// Observe the real bootstrap call without replacing its renderer implementation.
const artCalls = [];
let restoreArt;
if (scenario === 'autoNoKitty' || scenario === 'default') {
  await load('panels/status-art.ts');
  const path = Object.keys(jiti.cache).find(p => p.replaceAll('\\', '/').endsWith('/panels/status-art.ts'));
  const exports = jiti.cache[path].exports;
  const original = exports.createStatusArt;
  exports.createStatusArt = (...args) => { artCalls.push(args); return original(...args); };
  restoreArt = () => { exports.createStatusArt = original; };
}
const factory = (await load('index.ts')).default;
if (scenario === 'invalid') {
  await assert.rejects(factory(pi));
  assert.equal(handlers.size, 0);
  assert.equal(shortcuts.length, 0);
} else {
  try { await factory(pi); }
  finally { restoreArt?.(); }
}
if (scenario === 'autoNoKitty' || scenario === 'default') {
  assert.equal(artCalls.length, 1);
  assert.equal(artCalls[0][1], scenario === 'default');
  const logoPath = Object.keys(jiti.cache).find(p => p.replaceAll('\\', '/').endsWith('/features/logo.ts'));
  const source = jiti.cache[logoPath].exports;
  for (const name of ['logoArt', 'logoPicture', 'logoData', 'logoError', 'logoFrameTime']) {
    assert.equal(artCalls[0][0]?.[name], source[name], `keep the actual image source: ${name}`);
  }
}

// jiti's require cache tracks TS imports, including dynamic imports.
const files = Object.keys(jiti.cache).map(p => p.replaceAll('\\', '/'));
const loaded = path => files.some(p => p.endsWith('/' + path));
const expectLoaded = (paths, yes) => paths.forEach(path => assert.equal(loaded(path), yes, `${scenario}: ${path}, loaded=${loaded(path)}`));
const optional = ['features/logo.ts', 'panels/status-art.ts', 'pixel-art.ts', 'features/radio.ts', 'panels/radio.ts', 'panels/thinking.ts', 'panels/tool-list.ts', 'features/quests.ts', 'panels/quests.ts', 'state/quests.ts'];
if (scenario === 'invalid') {
  expectLoaded(['layout.ts', 'features/tools.ts', 'panels/index.ts', ...optional], false);
} else {
  expectLoaded(['features/tools.ts', 'state/tools.ts', 'panels/tools.ts', 'panels/status.ts'], true);
  assert.equal(tools.length, 0);
  const todo = join(process.env.PI_CODING_AGENT_DIR, 'pie-boy', 'TODO.md');
  if (scenario === 'off') {
    expectLoaded(optional, false);
    assert.ok(!files.some(p => /imagescript|node-speaker|naudiodon|@discordjs\/opus|@kmamal\/sdl|prism-media|@distube\/ytdl-core/i.test(p)));
    assert.ok(!process.moduleLoadList.some(name => /discordjs|kmamal|opus|sdl/i.test(name)));
    assert.ok(handlers.has('tool_execution_start'));
    assert.ok(!handlers.has('message_update'));
    assert.ok(!existsSync(todo));
    // Test precisely the disabled-radio callback, not the unrelated TUI bootstrap.
    const cleanup = handlers.get('session_start').find(fn => fn.toString().includes('stopRadio'));
    assert.ok(cleanup, 'disabled RADIO cleanup registered');
    let disposed = 0;
    const symbol = Symbol.for('pie-boy.radio');
    const radio = { dispose() { disposed++; } };
    globalThis[symbol] = radio;
    await cleanup({}, { mode: 'rpc', hasUI: false });
    await cleanup({}, { mode: 'rpc', hasUI: true });
    await cleanup({}, { mode: 'tui', hasUI: false });
    assert.equal(disposed, 0); assert.equal(globalThis[symbol], radio);
    await cleanup({}, { mode: 'tui', hasUI: true });
    assert.equal(disposed, 1); assert.equal(globalThis[symbol], undefined);
  } else if (scenario === 'pixel') {
    expectLoaded(['panels/status-art.ts', 'pixel-art.ts'], true);
    expectLoaded(['features/logo.ts', 'features/radio.ts', 'features/quests.ts'], false);
    assert.ok(!files.some(p => /imagescript/i.test(p)));
    assert.ok(!existsSync(todo));
  } else if (scenario === 'autoNoKitty') {
    expectLoaded(['features/logo.ts', 'panels/status-art.ts', 'pixel-art.ts'], true);
    expectLoaded(['features/radio.ts', 'panels/radio.ts', 'panels/thinking.ts', 'panels/tool-list.ts', 'features/quests.ts', 'panels/quests.ts', 'state/quests.ts'], false);
    assert.ok(!existsSync(todo));
  } else if (scenario === 'default') {
    expectLoaded(['features/logo.ts', 'panels/status-art.ts', 'pixel-art.ts', 'features/radio.ts', 'panels/radio.ts', 'panels/thinking.ts', 'panels/tool-list.ts'], true);
    expectLoaded(['features/quests.ts', 'state/quests.ts', 'panels/quests.ts'], false);
    assert.ok(!existsSync(todo));
  } else if (scenario === 'quest') {
    expectLoaded(['features/quests.ts', 'state/quests.ts', 'panels/quests.ts'], true);
    assert.ok(!existsSync(todo));
    const start = handlers.get('session_start').find(fn => fn.toString().includes('store.initialize'));
    assert.ok(start, 'QUEST initialization callback registered');
    await start({}, { mode: 'rpc', hasUI: false });
    assert.ok(existsSync(todo));
    const results = await Promise.all((handlers.get('before_agent_start') ?? []).map(fn => fn({ systemPrompt: 'BASE' }, {})));
    const prompt = results.find(result => result?.systemPrompt)?.systemPrompt;
    assert.ok(prompt?.startsWith('BASE\n\n'));
    assert.ok(prompt.includes('TODO.md'));
    assert.match(prompt, /bash/i);
    assert.equal(tools.length, 0);
    // Stop quest only; no watcher was created in RPC mode.
    const stop = handlers.get('session_shutdown').find(fn => fn.toString().includes('generation'));
    assert.ok(stop); await stop();
  }
}
