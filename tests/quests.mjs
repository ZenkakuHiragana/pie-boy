import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { harness, load, renderLayoutFrame, plain, theme, themes } from './support.mjs';

export default async function quests() {
  themes.setThemeInstance(theme);
  assert.ok(process.env.PI_SCRATCHPAD, 'tests require an isolated PI_SCRATCHPAD');
  await mkdir(process.env.PI_SCRATCHPAD, {recursive:true});
  const dir = await mkdtemp(join(process.env.PI_SCRATCHPAD, 'quests-'));
  const {createMarkdownQuestStore, questFile} = await load('state/quests.ts');
  const feature = await load('features/quests.ts');
  const {createKeybindings} = await load('keybindings.ts');
  await load('panels/quests.ts');
  const {PANELS} = await load('panels/registry.ts');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, what) => { for(let i=0;i<80;i++){if(fn())return; await sleep(50);} assert.fail(what); };
  async function setup(store, hasUI=true) {
    const h = await harness(); const handlers = new Map();
    const pi = {on:(name,fn)=>handlers.set(name,fn)};
    let shown; const env={state:h.state,context:()=>h.ctx,changed:d=>d.version++,requestRender:()=>{},shows:()=>true,onShownChange:fn=>shown=fn};
    h.ctx.mode=hasUI ? "tui" : "json"; h.ctx.hasUI=hasUI; let answer=false, confirmations=0;
    h.ctx.ui={confirm:async()=>{confirmations++; return typeof answer === 'function' ? answer() : answer;}};
    feature.setupQuests(pi,env,store);
    const emit=async(name,event={})=>handlers.get(name)?.(event,h.ctx);
    await emit('session_start');
    return {...h, emit, shown:()=>shown(), setAnswer:v=>answer=v, get confirmations(){return confirmations;}};
  }
  try {
    assert.equal(questFile(dir),join(dir,'pie-boy','TODO.md'));
    const file=questFile(dir), store=createMarkdownQuestStore(file);
    await store.initialize(); const template=await readFile(file,'utf8'); assert.equal(template,'# TODO\n'); assert.deepEqual(await store.read(),[]);
    const initial='Intro\r\n\r\n## Alpha\r\n<!-- date id -->\r\nDescription\r\n```md\r\n## not a quest\r\n- not a goal\r\n```\r\n- first\r\n- second\r\n\r\n## Beta\r\nother\r\n';
    await writeFile(file,initial); await store.initialize(); assert.equal(await readFile(file,'utf8'),initial);
    let [a,b]=await store.read(); assert.equal(a.title,'Alpha'); assert.equal(a.objectives.length,2); assert.match(a.description,/## not a quest/); assert.match(a.provenance,/date id/); assert.equal(b.title,'Beta');
    await store.complete(a,a.objectives[0]); assert.equal(await readFile(file,'utf8'),initial.replace('- first\r\n',''));
    await assert.rejects(store.complete(a),/changed|duplicated/);
    [a,b]=await store.read(); await store.complete(b); assert.equal(await readFile(file,'utf8'),initial.replace('- first\r\n','').replace('## Beta\r\nother\r\n',''));
    await writeFile(file,'\uFEFF## bom\r\n- first\r\n'); [a]=await store.read(); await store.complete(a,a.objectives[0]); assert.equal(await readFile(file,'utf8'),'\uFEFF## bom\r\n');
    const dupe='pre\n## same\n- x\n## same\n- x\n'; await writeFile(file,dupe); [a]=await store.read(); await assert.rejects(store.complete(a),/duplicated/); assert.equal(await readFile(file,'utf8'),dupe);
    const goals='## q\n- x\n- x\n'; await writeFile(file,goals); [a]=await store.read(); await assert.rejects(store.complete(a,a.objectives[0]),/duplicated/); assert.equal(await readFile(file,'utf8'),goals);
    await writeFile(file,'## q\n```\n'); assert.equal((await store.read())[0].title,'q'); assert.equal(await readFile(file,'utf8'),'## q\n```\n');
    await writeFile(file,'## q\n- one\n- two\n');
    const h=await setup(store), data=()=>feature.questData(h.state);
    assert.equal(data().quests[0].title,'q');
    const prompt=await h.emit('before_agent_start',{systemPrompt:'BASE'}); assert.equal(prompt.systemPrompt,`BASE\n\n${store.instructions()}`); assert.doesNotMatch(prompt.systemPrompt,/- one/);
    let panelEnv={...h.panelEnv, focusPanel:()=>{}, tui:()=>undefined,renderersFor:()=>undefined,keys:createKeybindings({'pieBoy.quest.complete':'c'})};
    const left=PANELS.get('questlist')(panelEnv), right=PANELS.get('questdetail')(panelEnv);
    const frame=p=>renderLayoutFrame(p.component,60,16,()=>{}).lines.map(plain).join('\n');
    assert.match(frame(left),/q/); assert.match(frame(right),/one/); assert.match(frame(left),/c/);
    assert.equal(left.list.key('x'),false); assert.equal(left.list.key('c'),true); await until(()=>!data().busy,'cancel'); assert.equal(h.confirmations,1); assert.match(await readFile(file,'utf8'),/- one/);
    h.setAnswer(true); right.list.key('c'); await until(()=>!data().busy,'complete'); assert.equal(await readFile(file,'utf8'),'## q\n- two\n');
    await writeFile(file,'## external\n- changed\n'); await until(()=>data().quests[0]?.title==='external','watch refresh'); assert.match(frame(right),/changed/);
    // The dialog cannot delete a changed selection or allow another completion in flight.
    let release; h.setAnswer(()=>new Promise(r=>release=r)); left.list.key('c'); left.list.key('c'); assert.equal(h.confirmations,3);
    await writeFile(file,'## modified\n'); await until(()=>data().quests[0]?.title==='modified','watch while dialog open'); release(true); await until(()=>!data().busy,'stale confirmation'); assert.equal(await readFile(file,'utf8'),'## modified\n');
    await h.emit('session_shutdown'); await writeFile(file,'## after shutdown\n'); await sleep(700); assert.notEqual(data().quests[0]?.title,'after shutdown'); assert.equal(await h.emit('before_agent_start',{systemPrompt:'BASE'}),undefined);
    // Keep the second quest and the following subgoal selected after completion.
    await writeFile(file,'## first\nbody\n## second\n- one\n- two\n');
    const second=await setup(store); second.setAnswer(true);
    feature.selectQuest(second.state,feature.questData(second.state).quests[1]);
    const secondEnv={...second.panelEnv,focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined};
    const secondDetail=PANELS.get('questdetail')(secondEnv); frame(secondDetail);
    secondDetail.list.key('x'); await until(()=>!feature.questData(second.state).busy,'second quest complete');
    assert.equal(feature.selectedQuest(second.state).title,'second');
    frame(secondDetail); assert.equal(secondDetail.list.index,0);
    assert.equal(feature.selectedQuest(second.state).objectives[0].text,'two');
    await second.emit('session_shutdown');

    // Narrow detail preserves every character rather than truncating each wrapped row.
    const title='A long quest title with a distinguishable ending';
    const goal='abcdefghijklmnopqrstuvwxyz0123456789';
    await writeFile(file,`## ${title}\n- ${goal}\n`);
    const narrow=await setup(store);
    for (const width of [8,12,20,60]) {
      const detail=PANELS.get('questdetail')({...narrow.panelEnv,focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined});
      const lines=renderLayoutFrame(detail.component,width,80,()=>{}).lines.map(plain);
      const from=1+detail.list.offsets[0], count=detail.list.heights[0];
      const letters=lines.slice(from,from+count).join('').match(/[a-z0-9]/g)?.join('');
      assert.equal(letters,goal,`goal characters at width ${width}`);
      assert.ok(lines.some(line=>line.includes('ending')) || width < 10);
    }
    await narrow.emit('session_shutdown');

    // An operation error is not a global read failure: other fresh targets can still complete.
    const qa={key:'a',title:'ambiguous',description:'',objectives:[]};
    const qb={key:'b',title:'normal',description:'',objectives:[]};
    let normalComplete=0;
    const recovering=await setup({source:'test',initialize:async()=>{},read:async()=>[qa,qb],subscribe:()=>()=>{},instructions:()=> 'GUIDE',complete:async q=>{if(q===qa)throw Error('ambiguous');normalComplete++;}});
    recovering.setAnswer(true);
    await feature.completeQuest(recovering.state,qa); assert.match(feature.questData(recovering.state).error,/ambiguous/);
    feature.selectQuest(recovering.state,qb); await feature.completeQuest(recovering.state,qb); assert.equal(normalComplete,1);
    await recovering.emit('session_shutdown');
    const unreadable=await setup({source:'unreadable',initialize:async()=>{},read:async()=>{throw Error('unreadable');},subscribe:()=>()=>{},instructions:()=> 'GUIDE',complete:async()=>{assert.fail('must not write');}});
    assert.equal((await unreadable.emit('before_agent_start',{systemPrompt:'BASE'})).systemPrompt,'BASE\n\nGUIDE');
    await unreadable.emit('session_shutdown');

    // Same-name quests keep the completed target and the next objective in view.
    await writeFile(file,'## Alpha\n## Same\n- other\n## Same\n- one\n- two\n- three\n');
    const same=await setup(store); same.setAnswer(true);
    feature.selectQuest(same.state,feature.questData(same.state).quests[2]);
    const sameDetail=PANELS.get('questdetail')({...same.panelEnv,focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined}); frame(sameDetail);
    sameDetail.list.move(1); sameDetail.list.key('x'); await until(()=>!feature.questData(same.state).busy,'same-name completion');
    assert.equal(feature.selectedQuest(same.state).title,'Same');
    assert.equal(feature.selectedQuest(same.state).objectives[0].text,'one');
    frame(sameDetail); assert.equal(sameDetail.list.index,1); assert.equal(feature.selectedQuest(same.state).objectives[1].text,'three');
    await same.emit('session_shutdown');
    await writeFile(file,'## JP\n- 日本語本文\n');
    const jp=await setup(store); const jpDetail=PANELS.get('questdetail')({...jp.panelEnv,focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined});
    const jpLines=renderLayoutFrame(jpDetail.component,5,30,()=>{}).lines.map(plain);
    assert.equal(jpLines.slice(1+jpDetail.list.offsets[0],1+jpDetail.list.offsets[0]+jpDetail.list.heights[0]).join('').match(/[日本語本文]/g)?.join(''),'日本語本文');
    await jp.emit('session_shutdown');
    let canRead=false, operationCalls=0;
    const recoverStore={source:'recover',initialize:async()=>{},read:async()=>{if(!canRead)throw Error('temporary');return [qa];},subscribe:()=>()=>{},instructions:()=> 'RECOVERED',complete:async()=>{operationCalls++;}};
    const recover=await setup(recoverStore,false);
    assert.equal((await recover.emit('before_agent_start',{systemPrompt:'B'})).systemPrompt,'B\n\nRECOVERED'); assert.match(feature.questData(recover.state).error,/temporary/);
    canRead=true; assert.match((await recover.emit('before_agent_start',{systemPrompt:'B'})).systemPrompt,/RECOVERED/); assert.equal(feature.questData(recover.state).error,undefined);
    canRead=false; recover.ctx.hasUI=true; recover.shown(); await until(()=>feature.questData(recover.state).quests.length===0,'failed refresh');
    await feature.completeQuest(recover.state,qa); assert.equal(operationCalls,0);
    await recover.emit('session_shutdown');

    const nonui=await setup(store,false); assert.match((await nonui.emit('before_agent_start',{systemPrompt:'BASE'})).systemPrompt,/bash/); await nonui.emit('session_shutdown');
    let init=0,reads=0,subs=0,unsubs=0,notify, completed=0;
    const objective={key:'g',text:'goal'}, quest={key:'q',title:'memory quest',description:'description',objectives:[objective]};
    const memory={source:'memory only',initialize:async()=>{init++;},read:async()=>{reads++;return [quest];},complete:async(q,o)=>{assert.equal(q,quest);assert.equal(o,objective);completed++;},instructions:()=> 'MEMORY INSTRUCTIONS',subscribe:fn=>{subs++;notify=fn;return()=>unsubs++;}};
    const m=await setup(memory); assert.equal(init,1); assert.equal(subs,1); assert.equal((await m.emit('before_agent_start',{systemPrompt:'B'})).systemPrompt,'B\n\nMEMORY INSTRUCTIONS');
    const mp=PANELS.get('questdetail')({...m.panelEnv,focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined}); assert.match(frame(mp),/memory only/); assert.match(frame(mp),/goal/);
    m.setAnswer(true); mp.list.key('x'); await until(()=>!feature.questData(m.state).busy,'memory completion'); assert.equal(completed,1); const before=reads; notify(); await until(()=>reads>before,'memory notification'); await m.emit('session_shutdown'); assert.equal(unsubs,1);
    const bad=await setup({...memory,initialize:async()=>{throw Error('init broken')}}); assert.match(feature.questData(bad.state).error,/init broken/); assert.equal((await bad.emit('before_agent_start',{systemPrompt:'B'})).systemPrompt,'B\n\nMEMORY INSTRUCTIONS'); await bad.emit('session_shutdown');
    let resolveRead; const hh=await harness(), handlers=new Map(); hh.ctx.mode="tui";
    const en={state:hh.state,context:()=>hh.ctx,changed:d=>d.version++,requestRender:()=>{},shows:()=>true,onShownChange:()=>{}};
    feature.setupQuests({on:(name,fn)=>handlers.set(name,fn)},en,{...memory,read:()=>new Promise(r=>resolveRead=r)});
    const starting=handlers.get('session_start')({},hh.ctx); await until(()=>!!resolveRead,'delayed read');
    handlers.get('session_shutdown')({},hh.ctx); resolveRead([quest]); await starting; assert.equal(feature.questData(hh.state).quests.length,0);
    assert.deepEqual((await readdir(join(dir,'pie-boy'))).filter(x=>x.endsWith('.tmp')),[]);
  } finally { await rm(dir,{recursive:true,force:true}); }
}
