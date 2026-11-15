import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness, load, plain, renderLayoutFrame } from './support.mjs';

export default async function statusArt() {
  await load('panels/status.ts');
  const { PANELS } = await load('panels/registry.ts');
  const { createStatusArt } = await load('panels/status-art.ts');
  const { setupTools, toolData } = await load('features/tools.ts');

  const h = await harness();
  setupTools(h.pi, { state: h.state, requestRender() {}, changed() {} });
  const tools = toolData(h.state);
  let now = 0;
  let timers = [];
  const env = { ...h.panelEnv, now: () => now, every: ms => {
    timers.push((Math.floor(now / ms) + 1) * ms);
    return Math.floor(now / ms);
  }, redrawAt: at => timers.push(at), cwd: () => '/project' };
  const make = () => PANELS.get('vitals')(env);
  const render = panel => renderLayoutFrame(panel.component, 100, 25, () => {}).lines;
  const text = panel => render(panel).map(plain).join('\n');

  // The real STATUS panel with no provider retains numbers, cards and state, but
  // neither reserves an image-sized space nor schedules the pixel animation.
  let panel = make();
  let output = text(panel);
  for (const value of ['CTX', '2%', '5H', 'CACHE', 'WEEK', 'STANDBY', 'TOOLS', 'FAIL', 'COST', '/project']) {
    assert.ok(output.includes(value), `off keeps ${value}`);
  }
  assert.deepEqual(timers, [], 'off has no art redraw in standby');
  const offLines = output.split('\n');
  assert.ok(offLines.findIndex(line => line.includes('STANDBY')) - offLines.findIndex(line => line.includes('CTX')) <= 2, 'off has no blank image area');
  h.state.agentRunning = true; h.state.agentStartedAt = 0; h.state.version++;
  tools.active.add('call'); tools.lastErrorAt = 500; tools.toolsVersion++;
  now = 500; timers = []; output = text(panel);
  assert.match(output, /WORKING\s+00:00/);
  assert.ok(timers.length && timers.every(at => at === 1000), 'off only schedules the working clock');

  // Auto source simulates an image and a reload with the same frame key. Verify
  // actual cached panel output, scene timing, image error footer and timers.
  h.state.agentRunning = false; h.state.version++; now = 0; timers = [];
  tools.active.clear(); tools.lastErrorAt = undefined; tools.toolsVersion++;
  let version = 1;
  let glyph = 'A';
  let error;
  const seen = [];
  const source = {
    logoData: () => ({ version }),
    logoFrameTime: (_state, scene, at) => { seen.push(['frame', scene, at]); return { key: 'same-frame', next: 250 }; },
    logoPicture: () => undefined,
    logoArt: (_state, _width, scene, at) => { seen.push(['art', scene, at]); return [[{ glyph }]]; },
    logoError: (_state, scene) => { seen.push(['error', scene]); return error; },
  };
  let pictureCalls = 0;
  source.logoPicture = () => { pictureCalls++; return undefined; };
  env.statusArt = createStatusArt(source, false);
  panel = make();
  output = text(panel);
  assert.match(output, /\sA\s/);
  assert.ok(timers.includes(250), 'auto schedules image frame');
  timers = []; text(panel);
  assert.ok(timers.includes(250), 'image frame is scheduled on a cache hit');
  glyph = 'B'; version++;
  output = text(panel);
  assert.match(output, /\sB\s/, 'image version invalidates identical frame key');
  error = 'logo: failed';
  assert.match(text(panel), /logo: failed/, 'image error appears in footer');
  error = undefined;
  h.state.agentRunning = true; h.state.agentStartedAt = 0; h.state.version++;
  now = 100; timers = []; seen.length = 0; text(panel);
  assert.ok(seen.some(item => item[0] === 'frame' && item[1] === 'standby'), 'image scene held');
  assert.ok(!seen.some(item => item[0] === 'art' && item[1] === 'thinking'), 'new image not drawn before hold expires');
  assert.ok(timers.includes(600), 'held scene schedules expiry');
  now = 600; text(panel);
  assert.ok(seen.some(item => item[0] === 'art' && item[1] === 'thinking' && item[2] === 0));
  tools.active.add('call'); tools.toolsVersion++;
  now = 1300; text(panel);
  assert.ok(seen.some(item => item[0] === 'art' && item[1] === 'tool'));
  tools.lastErrorAt = 1400; tools.toolsVersion++;
  now = 1400; timers = []; text(panel);
  assert.ok(seen.some(item => item[0] === 'art' && item[1] === 'error' && item[2] === 0));
  assert.ok(timers.includes(2400), 'error scene schedules expiry');
  h.state.agentRunning = false; h.state.termAttention = true; h.state.version++;
  now = 2500; text(panel);
  assert.ok(seen.some(item => item[0] === 'art' && item[1] === 'done'));

  assert.equal(pictureCalls, 0, 'disabled Kitty never calls picture across scene and version changes');

  // Kitty picture takes precedence over character cells, and missing image data
  // falls back to the built-in art in auto mode.
  source.logoPicture = () => { pictureCalls++; return { lines: ['PICTURE'], columns: 7 }; };
  version++;
  assert.match(text(panel), /\sB\s/, 'false uses the same source character art');
  assert.equal(pictureCalls, 0);
  for (const enabled of [true, undefined]) {
    env.statusArt = enabled === undefined ? createStatusArt(source) : createStatusArt(source, enabled);
    panel = make();
    assert.match(text(panel), /PICTURE/, `picture takes precedence for ${enabled}`);
  }
  assert.ok(pictureCalls >= 2, 'mock picture renderer was called');
  env.statusArt = createStatusArt(source, false); panel = make();
  source.logoPicture = () => undefined;
  source.logoArt = () => undefined;
  source.logoFrameTime = () => ({});
  version++;
  assert.match(text(panel), /[▀▄█]/, 'auto falls back to pixels without an image');

  // Real decoded image and real STATUS renderer; this does not test terminal Kitty transport.
  assert.ok(process.env.PI_SCRATCHPAD);
  const dir = mkdtempSync(join(process.env.PI_SCRATCHPAD, 'status-art-'));
  const saved = process.env.PI_CODING_AGENT_DIR;
  const logo = await load('features/logo.ts');
  const handlers = new Map();
  try {
    const assets = join(dir, 'pie-boy', 'assets');
    mkdirSync(assets, { recursive: true });
    const { Image } = await import('imagescript');
    writeFileSync(join(assets, 'logo.png'), await new Image(2, 2).fill(0xff0000ff).encode());
    process.env.PI_CODING_AGENT_DIR = dir;
    logo.setupLogo({ on: (name, fn) => handlers.set(name, fn) }, {
      state: h.state, changed: data => data.version++, requestRender() {},
    });
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved;
    handlers.get('session_start')({}, { mode: 'tui', hasUI: true });
    for (let i = 0; i < 100 && !logo.logoData(h.state).version; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(logo.logoData(h.state).image?.length, 'asset decoded');
    assert.equal(logo.logoData(h.state).error, undefined);
    h.state.agentRunning = false; h.state.termAttention = false; h.state.version++;
    tools.active.clear(); tools.lastErrorAt = undefined; tools.toolsVersion++;
    now = 0; env.statusArt = createStatusArt(logo, false); panel = make();
    const actual = render(panel).join('\n');
    const data = logo.logoData(h.state);
    assert.ok(data.art.size, 'decoded image produced cached text art');
    const glyph = [...data.art.values()].flat(2).find(cell => cell.glyph.trim())?.glyph;
    assert.ok(glyph && plain(actual).includes(glyph), 'cached image glyph appears in STATUS');
    assert.equal(data.kitty, undefined);
    assert.ok(!actual.includes('\x1b_G'), 'no Kitty graphics escape in rendered panel');
  } finally {
    handlers.get('session_shutdown')?.({}, {});
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }

  // Built-in pixel provider: moving scan, running/error motion and done breathing.
  // No source exists here; all scenes still render through the registered panel.
  env.statusArt = createStatusArt();
  h.state.agentRunning = false; h.state.termAttention = false; h.state.version++;
  tools.active.clear(); tools.lastErrorAt = undefined; tools.toolsVersion++;
  now = 0; timers = []; panel = make();
  let pixel0 = render(panel).join('\n');
  assert.match(plain(pixel0), /[▀▄█]/);
  assert.ok(timers.includes(120), 'standby scan advances');
  now = 120; let pixel1 = render(panel).join('\n');
  assert.notEqual(pixel0, pixel1, 'scan frame changes');
  now = 3000; timers = []; render(panel);
  assert.ok(timers.includes(5040), 'standby waits for next scan');
  h.state.agentRunning = true; h.state.agentStartedAt = 3000; h.state.version++;
  now = 3120; timers = []; pixel0 = render(panel).join('\n');
  assert.ok(timers.includes(3240), 'working animation advances');
  tools.lastErrorAt = now; tools.toolsVersion++;
  timers = []; pixel1 = render(panel).join('\n');
  assert.notEqual(pixel0, pixel1, 'error noise changes the built-in art');
  assert.ok(timers.includes(4120), 'error noise expires');
  h.state.agentRunning = false; h.state.termAttention = true; h.state.version++;
  now = 5000; timers = []; render(panel);
  assert.ok(timers.some(at => Math.abs(at - (now + 1000 / 60)) < 0.001), 'done breathes');
}
