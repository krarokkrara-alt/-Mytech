import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {initial,summary} from '../my-tech-accounting/model.mjs';
import {assets} from '../worker/generated.mjs';
function ui(){const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',addEventListener(){},prepend(){},append(){},classList:{add(){},remove(){}},showModal(){},close(){}});return nodes.get(selector);};
  const ctx=vm.createContext({console,Intl,Date,crypto,URL,URLSearchParams,Blob,setTimeout,clearTimeout,fetch:()=>new Promise(()=>{}),document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({})},window:{}});
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
  assert.ok(html.includes('/signin-with-chatgpt?return_to=%2F'));assert.ok(html.includes('ดูอย่างเดียว'));assert.ok(!html.includes('data-act="entry:income"'));assert.ok(!html.includes('data-page="payroll"'));assert.ok(html.includes('data-page="access"'));
});
test('permissions are prominent for all visitors while only the owner receives member controls',()=>{
  const h=ui();h.run("page='dashboard';render()");let html=h.node('#app').innerHTML;assert.ok(html.includes('access-top-link'));assert.ok(html.includes('access-dashboard-card'));assert.ok(html.includes('เพิ่มอีเมล / ถอนสิทธิ์ผู้แก้ไข'));assert.ok(html.includes('href="/?page=access"'));
  h.run("S.members=[{name:'Private member',email:'private@example.test'}];U={id:'viewer',name:'Viewer',role:'viewer'};page='access';render()");html=h.node('#app').innerHTML;assert.ok(html.includes('เข้าสู่ระบบด้วยบัญชีเจ้าของ'));assert.ok(!html.includes('private@example.test'));assert.ok(!html.includes('data-act="member"'));assert.ok(!html.includes('data-act="revoke:'));
  h.run("U={id:'owner',name:'Owner',role:'owner'};render()");html=h.node('#app').innerHTML;assert.ok(html.includes('เพิ่มอีเมลผู้แก้ไข'));assert.ok(html.includes('ถอนสิทธิ์แก้ไข'));assert.ok(html.includes('private@example.test'));
});
test('permissions link opens the requested page without permitting arbitrary page names',()=>{
  const h=ui();assert.equal(h.run("requestedPage('?page=access')"),'access');assert.equal(h.run("requestedPage('?page=payroll')"),'payroll');assert.equal(h.run("requestedPage('?page=settings')"),'settings');assert.equal(h.run("requestedPage('?page=unexpected')"),null);h.run("U={id:'visitor',role:'viewer',name:'Visitor'}");assert.equal(h.run("requestedPage('?page=payroll')"),null);assert.equal(h.run("requestedPage('')"),null);
});
test('Trello forms expose targets and proofs while salary requires an explicit choice; status keeps failed files visible',()=>{
  const h=ui();h.run('S.trello.autoSync={enabled:true};S.trelloConfigured=true');const form=h.run("trelloFormFields('entry')+integrationFileFields()");assert.ok(form.includes('สร้างการ์ด / หัวข้อใหม่'));assert.ok(form.includes('syncFiles'));assert.ok(form.includes(' multiple '));
  assert.ok(!h.run("trelloFormFields('payrollSave')").includes('value="auto"'));assert.equal(h.run("fileMime({name:'export.csv',type:'application/vnd.ms-excel'})"),'text/csv');
  h.run("S.syncJobs=[{kind:'entry',recordId:'one',status:'done',createdAt:2},{kind:'entry',recordId:'one',status:'error',createdAt:1}]");assert.ok(h.run("trelloRecordStatus('entry','one')").includes('ส่งไม่สำเร็จ'));
});

test('bills navigation appears once after finance registers its page',()=>{
  const h=ui();h.run('render()');
  assert.equal((h.node('#app').innerHTML.match(/data-page="bills"/g)||[]).length,1);
});

test('project filters include unpaid obligations and course registrations with payroll drafts owner only',()=>{
  const h=ui();
  h.run("S.bills=[{project:'Unpaid bill'}];S.purchases=[{project:'Unpaid purchase'}];S.documents=[{project:'Document <project>'}];S.courses=[{id:'course',name:'Unpaid course'}];S.enrollments=[{courseId:'course'}];S.payroll=[{status:'draft',month:'2026-11'}]");
  let html=h.run('filterToolbar()');
  for(const label of ['Unpaid bill','Unpaid purchase','Document &lt;project&gt;','Unpaid course','เงินเดือน'])assert.ok(html.includes(label),label);
  h.run("U={id:'staff',role:'staff',name:'Staff'}");html=h.run('filterToolbar()');
  assert.ok(!html.includes('เงินเดือน'));
});

test('Invoice payment defaults to enrollment course project while standalone invoices retain their reference',async()=>{
  const h=ui();
  h.run("S.courses=[{id:'course',name:'ECU course'}];S.enrollments=[{id:'enrollment',courseId:'course'}];S.documents=[{id:'invoice',number:'INV-1',enrollmentId:'enrollment'},{id:'standalone',number:'INV-2'}];entryForm=(type,extra)=>({type,extra})");
  const linked=await h.run("documentDispatch('invoicepay','invoice')");
  assert.equal(linked.type,'income');assert.equal(linked.extra.project,'ECU course');assert.equal(linked.extra.enrollmentId,'enrollment');
  const standalone=await h.run("documentDispatch('invoicepay','standalone')");
  assert.equal(standalone.extra.project,'INV-2');
});

test('downloaded report CSV preserves negative monetary cells and protects formula text once',async()=>{
  const h=ui();let blob;
  h.ctx.URL={createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(){}};
  h.ctx.setTimeout=()=>{};h.ctx.document.createElement=()=>({click(){}});
  h.run("page='report';S.accounts=[{id:'business',name:'Cash',scope:'business'}];S.entries=[{id:'expense',accountId:'business',type:'expense',amount:123,cash:-123,date:'2026-11-10',note:'=1+1'}]");
  assert.equal(await h.run("financeDispatch('csv')"),true);
  const csv=await blob.text();
  assert.ok(csv.includes('"-1.23"'));assert.ok(!csv.includes('"\'-1.23"'));
  assert.ok(csv.includes('"\'=1+1"'));assert.ok(!csv.includes('"\'\'=1+1"'));
});
