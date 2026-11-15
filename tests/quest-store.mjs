import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, symlink, lstat, unlink, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from './support.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default async function questStoreTests() {
  if (!process.argv.includes('--quest-store-worker')) {
    // Fault injection must precede the first store import; never inherit another
    // test's cached module or leave altered fs bindings in the suite process.
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--quest-store-worker'], {env:process.env,encoding:'utf8',timeout:45000});
    assert.equal(child.status,0,`${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
    if (child.stdout) process.stdout.write(child.stdout);
    return;
  }
  assert.ok(process.env.PI_SCRATCHPAD, 'tests require an isolated PI_SCRATCHPAD');
  await mkdir(process.env.PI_SCRATCHPAD, { recursive: true });
  const dir = await mkdtemp(join(process.env.PI_SCRATCHPAD, 'quest-store-'));
  const realOpen = fs.promises.open, realRename = fs.promises.rename;
  let openImpl = realOpen, renameImpl = realRename;
  fs.promises.open = (...args) => openImpl(...args);
  fs.promises.rename = (...args) => renameImpl(...args);
  syncBuiltinESMExports();
  let createMarkdownQuestStore;
  try { ({ createMarkdownQuestStore } = await load('state/quests.ts')); }
  catch (error) { fs.promises.open = realOpen; fs.promises.rename = realRename; syncBuiltinESMExports(); throw error; }
  const file = join(dir, 'nested', 'TODO.md');
  const store = createMarkdownQuestStore(file);
  const read = () => readFile(file, 'utf8');
  const temps = async d => (await readdir(d)).filter(n => n.endsWith('.tmp'));
  const put = text => writeFile(file, text, 'utf8');
  try {
    await Promise.all(Array.from({ length: 12 }, () => createMarkdownQuestStore(file).initialize()));
    assert.match(await read(), /^# TODO/);
    await put('## Existing\n');
    await Promise.all([store.initialize(), createMarkdownQuestStore(file).initialize()]);
    assert.equal(await read(), '## Existing\n');
    assert.deepEqual(await temps(join(dir, 'nested')), []);

    // Inject a write error after a partial temp write; only the temp may ever contain it.
    const failFile = join(dir, 'failed', 'TODO.md');
    const probe = await fs.promises.open(join(dir, 'probe'), 'w');
    const handlePrototype = Object.getPrototypeOf(probe);
    const originalWrite = handlePrototype.writeFile;
    await probe.close();
    let injected = false;
    handlePrototype.writeFile = async function () { injected = true; await originalWrite.call(this, '# partial'); throw new Error('injected write failure'); };
    try { await assert.rejects(createMarkdownQuestStore(failFile).initialize(), /injected write failure/); }
    finally { handlePrototype.writeFile = originalWrite; }
    assert.equal(injected, true);
    await assert.rejects(readFile(failFile), { code: 'ENOENT' });
    assert.deepEqual(await temps(join(dir, 'failed')), []);

    // Hold a completely staged template before publication. A competing creator wins
    // without ever seeing an empty/partial TODO; link's EEXIST must preserve it.
    const racing = join(dir, 'racing', 'TODO.md');
    let stagedInit, releaseInit;
    const initStaged = new Promise(r => stagedInit = r), initRelease = new Promise(r => releaseInit = r);
    handlePrototype.writeFile = async function (...args) { await originalWrite.apply(this, args); stagedInit(); await initRelease; };
    try {
      const initializing = createMarkdownQuestStore(racing).initialize();
      await initStaged;
      await assert.rejects(readFile(racing), { code: 'ENOENT' });
      await writeFile(racing, '## winner\n');
      releaseInit(); await initializing;
      assert.equal(await readFile(racing, 'utf8'), '## winner\n');
      assert.deepEqual(await temps(join(dir, 'racing')), []);
    } finally { releaseInit(); handlePrototype.writeFile = originalWrite; }

    await put('## A\n- one\n## B\n- two\n');
    const store2 = createMarkdownQuestStore(file);
    const [a] = await store.read(), [, b] = await store2.read();
    await Promise.all([store.complete(a), store2.complete(b)]);
    assert.equal(await read(), '');
    assert.equal(globalThis[Symbol.for('pie-boy.quest-store.queue')].size, 0);

    // Each failed completion must preserve the original bytes and release all resources.
    for (const failure of ['write', 'close', 'rename']) {
      const original = Buffer.from('preamble\r\n## A\r\n- one\r\n');
      await writeFile(file, original);
      const [item] = await store.read();

      let injectedFailure = false;
      try {
        if (failure === 'write') handlePrototype.writeFile = async function () {
          injectedFailure = true; await originalWrite.call(this, 'partial'); throw new Error('injected write failure');
        };
        if (failure === 'close') {
          openImpl = async (...args) => {
            const handle = await realOpen(...args);
            const close = handle.close;
            handle.close = async function (...closeArgs) {
              await close.apply(this, closeArgs); injectedFailure = true; throw new Error('injected close failure');
            };
            return handle;
          };
        }
        if (failure === 'rename') {
          renameImpl = async () => { injectedFailure = true; throw new Error('injected rename failure'); };
        }
        await assert.rejects(store.complete(item), new RegExp(`injected ${failure} failure`));
      } finally {
        handlePrototype.writeFile = originalWrite; openImpl = realOpen; renameImpl = realRename;
      }
      assert.equal(injectedFailure, true, failure);
      assert.deepEqual(await readFile(file), original, failure);
      assert.deepEqual(await temps(join(dir, 'nested')), [], failure);
      assert.equal(globalThis[Symbol.for('pie-boy.quest-store.queue')].size, 0, failure);
    }

    if (process.platform !== 'win32') {
      await put('## A\n- one\n'); await chmod(file, 0o664);
      const [item] = await store.read();
      const previousUmask = process.umask(0o077);
      try { await store.complete(item, item.objectives[0]); }
      finally { process.umask(previousUmask); }
      assert.equal((await stat(file)).mode & 0o7777, 0o664);
      assert.equal(await read(), '## A\n');
    } else console.log('quest-store: POSIX mode/umask test skipped on Windows');

    // Exact snapshots protect edits even when a unique title retains its UI key.
    await put('## A\n- one\n');
    const [old] = await store.read();
    await put('## A\n- changed\n');
    const [changed] = await store.read();
    assert.equal(old.key, changed.key);
    await assert.rejects(store.complete(old), /changed|duplicated/);
    await assert.rejects(store.complete({ ...changed }), /stale|invalid/);
    await assert.rejects(store.complete(changed, { ...changed.objectives[0] }), /changed|duplicated/);
    assert.equal(await read(), '## A\n- changed\n');

    const x = '## Same\n<!-- origin -->\n- x\n', y = '## Same\n<!-- origin -->\n- y\n';
    await put(x + y); const xy = await store.read();
    await put(y + x); const yx = await store.read();
    assert.equal(xy[0].key, yx[1].key); assert.equal(xy[1].key, yx[0].key);
    assert.notEqual(xy[0].key, xy[1].key);
    await put('## Same\n- x\n## Same\n- x');
    let duplicate = await store.read();
    assert.notEqual(duplicate[0].key, duplicate[1].key);
    await assert.rejects(store.complete(duplicate[0]), /duplicated/);
    assert.equal(await read(), '## Same\n- x\n## Same\n- x');
    await put('## Same\r\n- x\r\n## Same\n- x\n');
    duplicate = await store.read(); await assert.rejects(store.complete(duplicate[1]), /duplicated/);
    await put('## Q\r\n- x\r\n- x');
    let [q] = await store.read(); await assert.rejects(store.complete(q, q.objectives[1]), /duplicated/);
    assert.equal(await read(), '## Q\r\n- x\r\n- x');
    await put('\ufeffpreamble\r\n## Q\r\n- one\r\n- two\r\n');
    [q] = await store.read(); await store.complete(q, q.objectives[0]);
    assert.equal(await read(), '\ufeffpreamble\r\n## Q\r\n- two\r\n');
    await put('## Before\n- yes\n```\n## not a quest\n- not a goal\n');
    const fenced = await store.read(); assert.equal(fenced.length, 1); assert.equal(fenced[0].objectives.length, 1);
    assert.match(fenced[0].description, /not a quest/);

    const target = join(dir, 'target.md'), alias = join(dir, 'link.md');
    await writeFile(target, '## A\n- goal\n');
    let symlinks = true;
    try { await symlink(target, alias); }
    catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) symlinks = false; else throw e; }
    if (symlinks) {
      const linked = createMarkdownQuestStore(alias);
      const [item] = await linked.read(); await linked.complete(item, item.objectives[0]);
      assert.equal((await lstat(alias)).isSymbolicLink(), true);
      assert.equal(await readFile(target, 'utf8'), '## A\n');
      // Different path spellings to one target share the same serialization queue.
      await writeFile(target, '## A\n## B\n');
      const direct = createMarkdownQuestStore(target);
      const [first] = await linked.read(), [, second] = await direct.read();
      await Promise.all([linked.complete(first), direct.complete(second)]);
      assert.equal(await readFile(target, 'utf8'), '');
      assert.equal((await lstat(alias)).isSymbolicLink(), true);
      // A snapshot belongs to its read-time target, even if the new target has identical content.
      await writeFile(target, '## A\n- same\n');
      const beforeOther = join(dir, 'before-other.md'); await writeFile(beforeOther, '## A\n- same\n');
      const [beforeRetarget] = await linked.read();
      await unlink(alias); await symlink(beforeOther, alias);
      await assert.rejects(linked.complete(beforeRetarget), /target changed/);
      assert.equal(await readFile(target, 'utf8'), '## A\n- same\n');
      assert.equal(await readFile(beforeOther, 'utf8'), '## A\n- same\n');
      assert.equal((await lstat(alias)).isSymbolicLink(), true);
      assert.equal(globalThis[Symbol.for('pie-boy.quest-store.queue')].size, 0);
      await unlink(alias); await symlink(target, alias);
      // Retarget after staging but before the compare must reject, preserving both files.
      await writeFile(target, '## A\n');
      const other = join(dir, 'other.md'); await writeFile(other, '## A\n');
      const [stale] = await linked.read();
      let staged, release;
      const stagedPromise = new Promise(r => staged = r), releasePromise = new Promise(r => release = r);
      handlePrototype.writeFile = async function (...args) { await originalWrite.apply(this, args); staged(); await releasePromise; };
      try {
        const completion = linked.complete(stale);
        await stagedPromise; await unlink(alias); await symlink(other, alias); release();
        await assert.rejects(completion, /changed/);
      } finally { release(); handlePrototype.writeFile = originalWrite; }
      assert.equal(await readFile(target, 'utf8'), '## A\n');
      assert.equal(await readFile(other, 'utf8'), '## A\n');
      assert.equal((await lstat(alias)).isSymbolicLink(), true);
      assert.deepEqual(await temps(dir), []);
    } else console.log('quest-store: symlink tests skipped (OS permissions)');
    const prompt = store.instructions();
    for (const pattern of [/## Title/, /- subgoal/, /preamble/, /bash/, /permission/i, /cannot be read/, /do not write/, /report/]) assert.match(prompt, pattern);
  } finally { fs.promises.open = realOpen; fs.promises.rename = realRename; syncBuiltinESMExports(); await rm(dir, { recursive: true, force: true }); }
}

if (process.argv.includes("--quest-store-worker")) await questStoreTests();
