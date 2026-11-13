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

test('account settings expose opening correction, history and negative option while ledger prevents deleting adjustments',async()=>{
  const h=ui();h.run("S.accounts=[{id:'a',name:'Cash',scope:'business',openingSet:true,allowNegative:true,openingRevision:2}];S.summary.accounts=[{...S.accounts[0],balance:-5000}];S.entries=[{id:'opening',accountId:'a',type:'opening',amount:10000,cash:10000,date:'2026-11-13',note:'Initial'},{id:'correction',accountId:'a',type:'opening_adjustment',amount:15000,cash:-15000,openingBefore:10000,openingAfter:-5000,allowNegativeAfter:true,date:'2026-11-13',note:'Correction reason'}]");
  const html=h.run('settingsView()');assert.ok(html.includes('data-act="openingedit:a"'));assert.ok(html.includes('ประวัติยอดยกมา'));assert.ok(html.includes('อนุญาตยอดติดลบ'));assert.ok(html.includes('-50.00'));assert.ok(html.includes('Correction reason'));
  const ledger=h.run('entryTable(S.entries)');assert.ok(ledger.includes('ปรับยอดยกมา'));assert.ok(!ledger.includes('data-act="reverse:correction"'));
  h.run('openingForm=(id,edit)=>{globalThis.openingTest={id,edit}}');await h.run("dispatch('openingedit:a')");assert.equal(h.run('openingTest.id'),'a');assert.equal(h.run('openingTest.edit'),true);
});

test('wage payment chooser shows pending slips and opens the adjustment payment flow; browser arithmetic matches stored satang',async()=>{
  const h=ui();h.run("S.payroll=[{id:'pending',employee:{name:'Pending worker'},month:'2026-11',net:125063,status:'draft'},{id:'paid',employee:{name:'Paid worker'},month:'2026-10',net:10000,status:'paid',paymentEntryId:'paid-entry'},{id:'cancelled',employee:{name:'Cancelled worker'},month:'2026-09',net:10000,status:'cancelled'}];S.entries=[{id:'paid-entry',payrollId:'paid',type:'expense',amount:10000,cash:-10000}]");
  const html=h.run('wagePayrollPicker()');assert.ok(html.includes('Pending worker'));assert.ok(html.includes('1,250.63'));assert.ok(!html.includes('Paid worker'));assert.ok(!html.includes('Cancelled worker'));assert.ok(html.includes('ปรับแก้และจ่ายค่าแรง'));
  assert.equal(h.run("wageCalculation({unit:'day',quantity:'2.5',rate:'500.25'}).amount"),125063);
  assert.equal(h.run("wageMoneyInput('0.00')"),0);assert.equal(h.run("wageMoneyInput('1.01')"),101);assert.throws(()=>h.run("wageMoneyInput('-1')"));
  h.run('salaryForm=(id,mode)=>{globalThis.wageOpen={id,mode}}');await h.run("onlineDispatch('payrollpay:pending')");assert.equal(h.run('wageOpen.mode'),'pay');assert.equal(h.run('wageOpen.id'),'pending');
  h.node('#wage-payroll').value='pending';await h.run("onlineDispatch('wagepay')");assert.equal(h.run('wageOpen.mode'),'pay');
});

test('payroll CSV separates calculated wages from other earnings without double counting',async()=>{
  const h=ui();let blob;h.ctx.URL={createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(){}};h.ctx.setTimeout=()=>{};h.ctx.document.createElement=()=>({click(){}});
  h.run("S.payroll=[{month:'2026-11',employee:{code:'W1',name:'Worker'},baseSalary:10000,wage:{unit:'hour',quantity:7500,rate:5000,amount:37500},gross:48500,totalDeductions:500,net:48000,status:'draft'}]");await h.run("onlineDispatch('payrollcsv')");const csv=await blob.text();
  assert.ok(csv.includes('ค่าแรงตามจำนวน'));assert.ok(csv.includes('"100.00","375.00","ชั่วโมง","7.5","50.00","10.00","5.00","480.00"'));
});

test('Invoice edit controls are visible to writers, prefill the existing document and submit its original ID/revision',async()=>{
  const h=ui();h.run("S.customers=[{id:'customer',name:'Registry name'}];S.documents=[{id:'invoice',number:'INV-2026-0001',kind:'invoice',status:'issued',date:'2026-10-30',due:'2026-11-20',customerId:'customer',customer:{name:'Snapshot name',address:'Old address'},items:[{description:'ECU service',quantity:1500,unitPrice:12345,total:18518}],subtotal:18518,discount:0,total:18518,note:'Original conditions',revision:2}];openModal=(title,content,callback,label)=>{globalThis.editCapture={title,content,callback,label}};setupTrelloForm=(action,id)=>{globalThis.editRoute={action,id}};act=async(action,payload)=>({action,payload});");
  assert.ok(h.run('documentsView()').includes('data-act="editdoc:invoice"'));
  h.run("documentDispatch('editdoc','invoice')");let content=h.run('editCapture.content');
  for(const value of ['INV-2026-0001','Snapshot name','ECU service','123.45','2026-10-30','2026-11-20','Original conditions','editReason'])assert.ok(content.includes(value));
  assert.equal(h.run('editRoute.id'),'invoice');assert.equal(h.run('editCapture.label'),'บันทึกการแก้ไข');
  h.ctx.document.querySelectorAll=()=>[{querySelector:selector=>({value:selector==='.description'?'Changed service':selector==='.quantity'?'1.5':'200.25'})}];
  const saved=await h.run("editCapture.callback({customerId:'customer',date:'2026-10-30',discount:'0',note:'Changed',editReason:'Correct service'})");
  assert.equal(saved.action,'document');assert.equal(saved.payload.id,'invoice');assert.equal(saved.payload.expectedRevision,2);assert.equal(saved.payload.items[0].price,'200.25');
  h.run("U={id:'visitor',name:'Visitor',role:'viewer'}");assert.ok(!h.run('documentsView()').includes('data-act="editdoc:'));
  h.run("U={id:'owner',name:'Owner',role:'owner'};S.documents[0].status='cancelled'");assert.ok(!h.run('documentsView()').includes('data-act="editdoc:'));
});
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
