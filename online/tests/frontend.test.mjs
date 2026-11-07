import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {initial,summary} from '../my-tech-accounting/model.mjs';
import {assets} from '../worker/generated.mjs';
function ui(){const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',addEventListener(){},prepend(){},append(){},classList:{add(){},remove(){}},showModal(){},close(){}});return nodes.get(selector);};
  const ctx=vm.createContext({console,Intl,Date,crypto,URL,Blob,setTimeout,clearTimeout,fetch:()=>new Promise(()=>{}),document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({})},window:{}});
  assert.ok(!assets['/'].body.includes('/online.js'));
  vm.runInContext(assets['/app.js'].body,ctx);
  const s={...initial(),employees:[],payroll:[],members:[],attachmentList:[],trelloConfigured:false};s.summary=summary(s);ctx.fixture=s;vm.runInContext("S=fixture; U={id:'owner',name:'Owner',role:'owner'}",ctx);return {ctx,node,run:code=>vm.runInContext(code,ctx)};
}
test('online scripts load together, all owner views render and payroll has configurable rows',()=>{
  const h=ui();for(const page of ['dashboard','wallet','customers','stock','purchase','debt','report','documents','trello','review','settings','payroll','access'])assert.equal(typeof h.run(`views['${page}']()`),'string');
  const row=h.run("salaryRow({label:'OT <unsafe>',amount:12345})");assert.ok(row.includes('OT &lt;unsafe&gt;'));assert.ok(row.includes('123.45'));
  const pattern=row.match(/pattern="([^"]+)"/)[1];const re=new RegExp('^(?:'+pattern+')$');assert.ok(re.test('123.45'));assert.ok(!re.test('123x45'));assert.ok(!re.test('-1'));
  h.run("page='payroll';render()");assert.ok(h.node('#app').innerHTML.includes('สร้างเงินเดือน'));assert.ok(h.node('#app').innerHTML.includes('เงินเดือนพนักงาน'));
});
test('visitor page suppresses mutation controls and links to the platform sign-in route',()=>{
  const h=ui();h.run("U={id:'visitor',name:'Visitor',role:'viewer'};render()");const html=h.node('#app').innerHTML;
  assert.ok(html.includes('/signin-with-chatgpt?return_to=%2F'));assert.ok(html.includes('ดูอย่างเดียว'));assert.ok(!html.includes('data-act="entry:income"'));assert.ok(!html.includes('data-page="payroll"'));assert.ok(!html.includes('data-page="access"'));
});
