import assert from 'node:assert/strict';
import { harness, load, renderLayoutFrame, plain, themes, system, user } from './support.mjs';

// Exercise the actual arrangements and frames, not individual panel render methods.
export default async function questUI() {
  await load('panels/quests.ts');
  await load('panels/inv.ts');
  const { PANELS } = await load('panels/registry.ts');
  const { buildArrangement } = await load('screen/layout.ts');
  const { createTabs } = await load('layout.ts');
  const { DEFAULT_CONFIG } = await load('config.ts');
  const { createKeybindings } = await load('keybindings.ts');
  const quest = await load('features/quests.ts');
  const tabs = createTabs({...DEFAULT_CONFIG, quest:{enabled:true}});
  const questPage = tabs.find(t => t.label === 'DATA').pages.find(p => p.label === 'QUEST');
  const invPage = tabs.find(t => t.label === 'INV').pages.find(p => p.label === 'PROMPT');
  const data = [
    {key:'one', title:'Map the observatory', description:'First description', objectives:[]},
    {key:'two', title:'Prepare the night observation', description:'Make a clear observation plan and check that the equipment is ready before sunset.', provenance:'<!-- 2025-01-16 session-fixture-002 -->', objectives:[{key:'a',text:'Check the telescope alignment'}]},
  ];
  const store = {source:'fixture://observatory/TODO.md', initialize:async()=>{}, read:async()=>data, complete:async()=>{throw Error('read-only');}, instructions:()=>'', subscribe:()=>()=>{}};
  const prompt = '<role>\nYou are an observatory assistant. Help prepare a safe and useful observing session.\n</role>\n\n<guidelines>\nExplain the plan clearly.\n</guidelines>';
  for (const themeName of ['dark','light']) for (const width of [120,160,80]) {
    const theme = themes.getThemeByName(themeName); assert.ok(theme); themes.setThemeInstance(theme);
    const h = await harness({messages:[system(prompt),user('Prepare an observing plan.')]});
    const handlers = new Map();
    h.ctx.mode = 'tui'; h.ctx.ui = {confirm:async()=>false};
    quest.setupQuests({on:(name,fn)=>handlers.set(name,fn)}, {state:h.state,context:()=>h.ctx,changed:d=>d.version++,requestRender:()=>{},shows:()=>true,onShownChange:()=>{}}, store);
    await handlers.get('session_start')({},h.ctx);
    quest.selectQuest(h.state,data[1]);
    h.fallback = prompt; await h.capture();
    function draw(page, ids, side, binding='ctrl+e') {
      const env = {...h.panelEnv,theme:()=>theme,focused:id=>id===ids[side],focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined,keys:createKeybindings({'pieBoy.quest.complete':binding})};
      const panels = new Map(ids.map(id=>[id,PANELS.get(id)(env)]));
      const built = buildArrangement(page.layout,id=>panels.get(id).component,()=>theme,{size:()=>({width,height:30}),preview:()=>{}});
      renderLayoutFrame(built.component,width,30,()=>{});
      return {lines:renderLayoutFrame(built.component,width,30,()=>{}).lines, titles:ids.map(id=>panels.get(id).title())};
    }
    const qids=['questlist','questdetail'], iids=['promptparts','prompttext'];
    for (const side of [0,1]) {
      const qDraw=draw(questPage,qids,side), iDraw=draw(invPage,iids,side);
      const q=qDraw.lines, inv=iDraw.lines;
      const qp=q.map(plain), ip=inv.map(plain);
      const context=`${themeName} ${width} focus ${side}`;
      const qHeader=qp.findIndex(s=>s.includes(qDraw.titles[1]));
      const iHeader=ip.findIndex(s=>s.includes(iDraw.titles[1]));
      assert.ok(qHeader>=0 && iHeader>=0,context);
      assert.equal(qHeader,iHeader,context);
      assert.equal(qp[qHeader].indexOf(qDraw.titles[1]),ip[iHeader].indexOf(iDraw.titles[1]),context);
      if (qHeader===0) {
        const boundary=ip[0].indexOf('│');
        assert.ok(boundary>0,context);
        assert.equal(qp[0].indexOf('│'),boundary,context);
      }
      const selected=qp.findIndex(s=>s.includes('◆'+data[1].title));
      const picked=ip.findIndex(s=>s.startsWith(' ◆') || s.startsWith('▌◆'));
      assert.ok(selected>0 && picked>0,context);
      assert.equal(qp[selected].indexOf('◆'),ip[picked].indexOf('◆'),context);
      assert.equal(qp[selected][0],side===0?'▌':' ',context);
      assert.equal(ip[picked][0],side===0?'▌':' ',context);
      assert.ok(q[selected].includes(theme.fg('accent','◆')),context);
      assert.ok(inv[picked].includes(theme.fg('accent','◆')),context);
      assert.ok(q[qHeader+1].includes(theme.fg('accent',theme.bold(data[1].title))),context);
      const descStart=data[1].description.split(' ').slice(0,4).join(' ');
      const desc=qp.find(s=>s.includes(descStart));
      const promptStart=prompt.split('\n')[0];
      const body=ip.slice(iHeader+1).find(s=>s.includes(promptStart));
      assert.ok(desc && body,context);
      assert.equal(desc.indexOf(descStart),body.indexOf(promptStart),context);
      const origin=data[1].provenance.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
      assert.ok(qp.some(s=>s.includes(origin)),context);
      assert.ok(qp.every(s=>!s.includes('<!--')&&!s.includes('-->')),context);
      // Framed titles use the focused heavy rule and unfocused light rule, with theme colors.
      const listStart=side===0?'━━':'──', detailStart=side===1?'━━':'──';
      assert.ok(q[0].includes(theme.fg(side===0?'borderAccent':'borderMuted',listStart)),context);
      assert.ok(q[qHeader].includes(theme.fg(side===1?'borderAccent':'borderMuted',detailStart)),context);
      assert.ok(qDraw.titles.every(title=>title.includes('ctrl+e')),context);
      assert.ok(qp[0].includes(qDraw.titles[0]),context);
      assert.ok(qp[qHeader].includes(qDraw.titles[1]),context);
      const disabled=draw(questPage,qids,side,[]);
      assert.ok(disabled.titles.every(title=>!title.includes('ctrl+e')),context);
      assert.ok(disabled.titles.every(title=>disabled.lines.map(plain).some(line=>line.includes(title))),context);
      assert.ok(disabled.lines.map(plain).every(line=>!line.includes('ctrl+e')),context);
    }
    await handlers.get('session_shutdown')?.({},h.ctx);
  }
}
