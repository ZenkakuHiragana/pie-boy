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
    function draw(page, ids, side, binding='c') {
      const env = {...h.panelEnv,theme:()=>theme,focused:id=>id===ids[side],focusPanel:()=>{},tui:()=>undefined,renderersFor:()=>undefined,keys:createKeybindings({'pieBoy.quest.complete':binding})};
      const panels = new Map(ids.map(id=>[id,PANELS.get(id)(env)]));
      const built = buildArrangement(page.layout,id=>panels.get(id).component,()=>theme,{size:()=>({width,height:30}),preview:()=>{}});
      renderLayoutFrame(built.component,width,30,()=>{});
      return renderLayoutFrame(built.component,width,30,()=>{}).lines;
    }
    const qids=['questlist','questdetail'], iids=['promptparts','prompttext'];
    for (const side of [0,1]) {
      const q=draw(questPage,qids,side), inv=draw(invPage,iids,side);
      const qp=q.map(plain), ip=inv.map(plain);
      const context=`${themeName} ${width} focus ${side}`;
      const qHeader=qp.findIndex(s=>s.includes('QUEST  ·  c: complete subgoal'));
      const iHeader=ip.findIndex(s=>s.includes('TEXT  WHOLE PROMPT'));
      assert.ok(qHeader>=0 && iHeader>=0,context);
      if(width>=120) {
        const expected=Math.round(width*0.31);
        assert.equal(qp[0].indexOf('│'),expected,context);
        assert.equal(ip[0].indexOf('│'),expected,context);
        assert.equal(qHeader,0,context);
      } else {
        assert.equal(qHeader,Math.round(30*0.25),context);
        assert.equal(iHeader,qHeader,context);
      }
      const selected=qp.findIndex(s=>s.includes('◆Prepare the night observation'));
      const picked=ip.findIndex(s=>s.includes('◆WHOLE PROMPT'));
      assert.ok(selected>0 && picked>0,context);
      assert.equal(qp[selected].indexOf('◆'),1,context);
      assert.equal(ip[picked].indexOf('◆'),1,context);
      assert.equal(qp[selected][0],side===0?'▌':' ',context);
      assert.equal(ip[picked][0],side===0?'▌':' ',context);
      assert.ok(q[selected].includes(theme.fg('accent','◆')),context);
      assert.ok(inv[picked].includes(theme.fg('accent','◆')),context);
      assert.ok(q[qHeader+1].includes(theme.fg('accent',theme.bold(data[1].title))),context);
      const textCol=width>=120 ? Math.round(width*0.31)+2 : 1;
      const desc=qp.find(s=>s.includes('Make a clear observation plan'));
      const body=ip.find(s=>s.includes('<role>') && s.indexOf('<role>')===textCol);
      assert.equal(desc?.indexOf('Make a clear observation plan'),textCol,context);
      assert.ok(body,context);
      assert.ok(qp.some(s=>s.includes('2025-01-16 session-fixture-002')),context);
      assert.ok(qp.every(s=>!s.includes('<!--')&&!s.includes('-->')),context);
      // Framed titles use the focused heavy rule and unfocused light rule, with theme colors.
      const listStart=side===0?'━━':'──', detailStart=side===1?'━━':'──';
      assert.ok(q[0].includes(theme.fg(side===0?'borderAccent':'borderMuted',listStart)),context);
      assert.ok(q[qHeader].includes(theme.fg(side===1?'borderAccent':'borderMuted',detailStart)),context);
      assert.ok(q[0].includes('c: complete'),context);
      assert.ok(q[qHeader].includes('c: complete subgoal'),context);
      const disabled=draw(questPage,qids,side,[]).map(plain);
      assert.ok(disabled[0].includes('QUESTS  2'),context);
      assert.ok(disabled.some(s=>s.includes('QUEST')),context);
      assert.ok(disabled.every(s=>!s.includes(': complete')),context);
    }
    await handlers.get('session_shutdown')?.({},h.ctx);
  }
}
