import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './support.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A logo setup on a fake Pi, reading Pi's agent directory `agentDir`. */
async function logoOn(agentDir, setupLogo, logoData) {
  const handlers = new Map();
  const pi = { on: (name, handler) => handlers.set(name, handler) };
  const state = {};
  const env = { state, changed: data => { data.version++; }, context: () => undefined, requestRender() {}, shows: () => true, onShownChange() {} };
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try { setupLogo(pi, env); } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved;
  }
  return {
    start: async () => { handlers.get('session_start')({}, { mode: 'tui', hasUI: true }); await wait(300); },
    stop: () => handlers.get('session_shutdown')({}, {}),
    data: () => logoData(state),
    /** The first pixel of logo.*, as [r, g, b, a]; none without it. */
    pixel: () => { const bitmap = logoData(state).image?.[0].image.bitmap; return bitmap && Array.from(bitmap.slice(0, 4)); },
  };
}

export default async function logoAssets() {
  const { assetsFolder, setupLogo, logoData } = await load('features/logo.ts');
  const { Image } = await import('imagescript');
  await mkdir(join(tmpdir(), 'pi'), { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), 'pi', 'pie-boy-logo-'));
  try {
    const agent = join(dir, 'agent');
    const assets = assetsFolder(agent);
    assert.equal(assets, join(agent, 'pie-boy', 'assets'));

    // No folder: no logo (Pi's is shown) and no error.
    const logo = await logoOn(agent, setupLogo, logoData);
    await logo.start();
    assert.equal(logo.data().image, undefined);
    assert.equal(logo.data().error, undefined);
    assert.equal(logo.data().scenes.size, 0);

    // A folder without logo.*: no logo and no error either.
    mkdirSync(assets, { recursive: true });
    logo.stop();
    await logo.start();
    assert.equal(logo.data().image, undefined);
    assert.equal(logo.data().error, undefined);

    // logo.png added while watched is read.
    writeFileSync(join(assets, 'logo.png'), await new Image(2, 2).fill(0xff0000ff).encode());
    await wait(300);
    assert.equal(logo.data().error, undefined);
    assert.deepEqual(logo.pixel(), [255, 0, 0, 255], 'logo.png is read');

    // logo.png replaced while watched is read again.
    writeFileSync(join(assets, 'logo.png'), await new Image(2, 2).fill(0x00ff00ff).encode());
    await wait(300);
    assert.deepEqual(logo.pixel(), [0, 255, 0, 255], 'the replaced logo.png is read');

    // A scene's image added while watched is read too.
    writeFileSync(join(assets, 'logo-tool.png'), await new Image(2, 2).fill(0x00ff00ff).encode());
    await wait(300);
    assert.ok(logo.data().scenes.get('tool')?.length, 'logo-tool.png is read');

    // The folder removed while watched: no logo, no error, and the watching stops.
    rmSync(assets, { recursive: true, force: true });
    await wait(300);
    assert.equal(logo.data().image, undefined);
    assert.equal(logo.data().scenes.size, 0);
    assert.equal(logo.data().error, undefined);
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, 'logo.png'), await new Image(2, 2).fill(0x0000ffff).encode());
    await wait(300);
    assert.equal(logo.data().image, undefined, 'not watched again until the next session');
    // The watching stopped: a session_start (which does nothing while a folder is
    // watched) now watches the new folder and reads its logo.
    await logo.start();
    assert.ok(logo.data().image?.length, 'the watching stopped when the folder went');

    // The folder removed and made again at once: the new folder is watched.
    rmSync(assets, { recursive: true, force: true });
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, 'logo.png'), await new Image(2, 2).fill(0xff0000ff).encode());
    await wait(300);
    assert.deepEqual(logo.pixel(), [255, 0, 0, 255], 'the logo of a folder made again is read');
    writeFileSync(join(assets, 'logo.png'), await new Image(2, 2).fill(0x00ff00ff).encode());
    await wait(300);
    assert.deepEqual(logo.pixel(), [0, 255, 0, 255], 'a folder made again is watched');
    logo.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log('logo assets folder assertions passed');
}
