import assert from 'node:assert/strict';
import { load } from './support.mjs';

// The provider's instructions are opaque: prose edits are not behavior changes.
export default async function questContext() {
  const { setupQuests } = await load('features/quests.ts');
  const { createState } = await load('state/core.ts');
  const task = { key:'task', title:'PRIVATE TASK', description:'PRIVATE BODY', objectives:[] };
  function fixture(failure, read) {
    const state = createState(), handlers = new Map();
    let guide = 'opaque provider value';
    const store = {
      source:'PRIVATE SOURCE',
      initialize:async()=>{ if(failure === 'init') throw Error('init'); },
      read:read ?? (async()=>{ if(failure === 'read') throw Error('read'); return [task]; }),
      complete:async()=>assert.fail('prompt assembly must not write'),
      subscribe:()=>()=>{}, instructions:()=>guide,
    };
    setupQuests({on:(name,fn)=>handlers.set(name,fn)}, {
      state, changed:data=>data.version++, requestRender:()=>{},
      shows:()=>false, onShownChange:()=>{},
    },store);
    const ctx = {mode:'rpc',hasUI:false};
    return {
      emit:(name,event={})=>handlers.get(name)(event,ctx),
      set guide(value){guide=value;},
    };
  }
  for (const failure of [undefined,'init','read']) {
    const f = fixture(failure);
    const event = {systemPrompt:'BASE + prior extension'};
    assert.equal(await f.emit('before_agent_start',event),undefined);
    await f.emit('session_start');
    try {
      for (const guide of ['first arbitrary text', 'Different words\n## Heading\n```text\nexample\n```']) {
        f.guide = guide;
        const result = await f.emit('before_agent_start',event);
        assert.deepEqual(result,{systemPrompt:`${event.systemPrompt}\n\n${guide}`});
        assert.equal(event.systemPrompt,'BASE + prior extension');
      }
    } finally {await f.emit('session_shutdown');}
    assert.equal(await f.emit('before_agent_start',event),undefined);
  }
  let reads=0, release, entered;
  const waiting = new Promise(resolve=>{entered=resolve;});
  const f=fixture(undefined,async()=>{
    if(++reads===1) throw Error('retry needed');
    entered(); return await new Promise(resolve=>{release=resolve;});
  });
  await f.emit('session_start');
  const pending=f.emit('before_agent_start',{systemPrompt:'BASE'});
  await waiting;
  await f.emit('session_shutdown');
  release([task]);
  assert.equal(await pending,undefined);
}
