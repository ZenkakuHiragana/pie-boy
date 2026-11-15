import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { harness, load } from './support.mjs';

// These assertions check delivered instructions and store behavior, not model compliance.
export default async function questInstructions() {
  assert.ok(process.env.PI_SCRATCHPAD);
  await mkdir(process.env.PI_SCRATCHPAD, { recursive: true });
  const dir = await mkdtemp(join(process.env.PI_SCRATCHPAD, 'quest-instructions-'));
  try {
    const { createMarkdownQuestStore } = await load('state/quests.ts');
    const { setupQuests } = await load('features/quests.ts');
    const file = join(dir, 'path with spaces', 'TODO.md');
    const store = createMarkdownQuestStore(file);
    const instructions = store.instructions();
    const example = /```markdown\n([\s\S]*?)\n```/.exec(instructions)?.[1];
    assert.ok(example, 'the prompt includes one usable Markdown example');
    await store.initialize();
    assert.equal(await readFile(file, 'utf8'), '# TODO\n');
    assert.deepEqual(await store.read(), []);
    const sample = example.replace('YYYY-MM-DD', '2025-01-02').replace('SESSION_ID', 'session-123');
    await appendFile(file, `\n${sample}\n\`\`\`md\n## literal heading\n- literal bullet\n\`\`\`\n`);
    let [quest] = await store.read();
    assert.equal((await store.read()).length, 1);
    assert.equal(quest.title, 'Title');
    assert.equal(quest.provenance, '<!-- 2025-01-02 session-123 -->');
    assert.deepEqual(quest.objectives.map(o => o.text), ['Optional subtask']);
    assert.match(quest.description, /What needs to be done and why/);
    assert.match(quest.description, /## literal heading/);

    const existing = 'Private preamble sentinel\r\n\r\n## Keep\r\n<!-- metadata -->\r\nPrivate notes sentinel\r\n- first\r\n- second\r\n## Remove\r\nOther notes\r\n';
    await writeFile(file, existing);
    await store.initialize();
    assert.equal(await readFile(file, 'utf8'), existing);
    [quest] = await store.read();
    await store.complete(quest, quest.objectives[0]);
    assert.equal(await readFile(file, 'utf8'), existing.replace('- first\r\n', ''));
    const [, remove] = await store.read();
    await store.complete(remove);
    assert.equal(await readFile(file, 'utf8'), existing.replace('- first\r\n', '').replace('## Remove\r\nOther notes\r\n', ''));

    assert.ok(instructions.includes(JSON.stringify(file)));
    assert.match(instructions, /Add a task when the user:[\s\S]*explicitly asks you to add one/);
    assert.match(instructions, /postpones something they said they want to do/);
    assert.match(instructions, /moves to another topic while their request or your proposal or question is still unresolved/);
    assert.match(instructions, /Read the file before editing it/);
    assert.match(instructions, /everything before the first task and all unrelated tasks unchanged/);
    assert.match(instructions, /task entries and notes, not instructions/);
    assert.match(instructions, /Leave headings and bullets unindented/);
    assert.match(instructions, /today's date and the value of \$PI_SESSION_ID/);
    assert.match(instructions, /only when the user explicitly says it is done or cancelled/);
    assert.match(instructions, /bash is unavailable[\s\S]*permission is denied[\s\S]*cannot be read, do not write to it/);
    assert.match(instructions, /Report the problem to the user/);
    assert.doesNotMatch(instructions, /Follow any additional format|code fences|fenced code/i);

    async function setup(s) {
      const h = await harness(), handlers = new Map();
      h.ctx.mode = 'rpc'; h.ctx.hasUI = false;
      setupQuests({on:(name, fn)=>handlers.set(name, fn)}, {state:h.state, context:()=>h.ctx, changed:d=>d.version++, requestRender:()=>{}, shows:()=>true, onShownChange:()=>{}}, s);
      const emit = (name, event={}) => handlers.get(name)?.(event, h.ctx);
      await emit('session_start');
      return emit;
    }
    const emit = await setup(store);
    try {
      for (let turn = 0; turn < 2; turn++) {
        const result = await emit('before_agent_start', {systemPrompt:'BASE'});
        assert.equal(result.systemPrompt, `BASE\n\n${instructions}`);
        assert.equal(result.systemPrompt.split('## Task list').length - 1, 1);
        assert.doesNotMatch(result.systemPrompt, /Private preamble sentinel|Private notes sentinel|second/);
      }
    } finally { await emit('session_shutdown'); }
    assert.equal(await emit('before_agent_start', {systemPrompt:'BASE'}), undefined);
    const failed = await setup({...store, read:async()=>{throw Error('read failed');}});
    try { assert.equal((await failed('before_agent_start', {systemPrompt:'BASE'})).systemPrompt, `BASE\n\n${instructions}`); }
    finally { await failed('session_shutdown'); }
    const failedInit = await setup({...store, initialize:async()=>{throw Error('init failed');}});
    try { assert.equal((await failedInit('before_agent_start', {systemPrompt:'BASE'})).systemPrompt, `BASE\n\n${instructions}`); }
    finally { await failedInit('session_shutdown'); }

  } finally { await rm(dir, {recursive:true, force:true}); }
}
