import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {initial} from '../my-tech-accounting/model.mjs';
import {database,bucket} from './db.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const date='2026-11-10';
function financeHarness(){
  const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,9).toString('base64')};let sequence=0;
  DB.raw.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(initial()));
  DB.raw.prepare("INSERT INTO members VALUES(?,'staff',?)").run('staff@example.test','Staff');
  async function call(path,{role='owner',data}={}){
    const headers={};if(role!=='public'){headers['oai-authenticated-user-id']=role+'-id';headers['oai-authenticated-user-email']=role+'@example.test';}
    if(data!==undefined)Object.assign(headers,{Origin:'https://finance.test','Content-Type':'application/json','X-CSRF-Token':'same-origin'});
    const response=await worker.fetch(new Request('https://finance.test'+path,{method:data===undefined?'GET':'POST',headers,...(data!==undefined?{body:JSON.stringify(data)}:{})}),env),text=await response.text();let body;try{body=JSON.parse(text);}catch{body=text;}
    return {status:response.status,headers:response.headers,body};
  }
  const action=(action,payload,role='owner')=>call('/api/action',{role,data:{action,payload,requestId:'finance-integration-'+(++sequence)}});
  async function save(kind,payload,role='owner'){const response=await action(kind,payload,role);assert.equal(response.status,200,JSON.stringify(response.body));return response.body.result;}
  async function account(name,scope='business',amount='10000'){const account=await save('account',{name,scope});await save('entry',{type:'opening',accountId:account.id,amount,date,note:'Opening'});return account;}
  const raw=()=>JSON.parse(DB.raw.prepare('SELECT json FROM app_state WHERE id=1').get().json);
  const sign=(name='Finance approver')=>call('/api/company/signature',{data:{name,title:'Director',image:{mime:'image/png',base64:png}}});
  return {DB,env,call,action,save,account,raw,sign};
}
const metricValues=(html,label)=>[...html.matchAll(new RegExp('<div class="metric-top">'+label+'</div><div class="metric-value"><span class="currency">฿</span>([\\d,.]+)</div>','g'))].map(m=>Number(m[1].replaceAll(',','')));
const snapshots=s=>Object.fromEntries(['documents','receipts','payroll','bills'].map(key=>[key,(s[key]||[]).map(r=>({id:r.id,company:r.company}))]));

test('online report reconciles interest, supplier PO/bill and Invoice payments once while separating draft salary obligations and personal money',async()=>{
  const h=financeHarness(),bank=await h.account('Business bank'),personal=await h.account('Personal account','personal');
  await h.sign();await h.save('entry',{type:'interest',accountId:bank.id,amount:'12.34',date,note:'Business interest'});
  await h.save('entry',{type:'expense',accountId:personal.id,amount:'7.89',date,note:'PRIVATE owner purchase'});
  const customer=await h.save('customer',{name:'Report customer'}),invoice=await h.save('document',{kind:'invoice',customerId:customer.id,date,items:[{description:'Service',quantity:'1',price:'1000'}]});
  await h.save('entry',{type:'income',invoiceId:invoice.id,accountId:bank.id,amount:'200',date,note:'Customer instalment'});
  const product=await h.save('product',{sku:'FIN-1',name:'Parts',unit:'pcs',kind:'material'}),purchase=await h.save('purchase',{productId:product.id,vendor:'Business supplier',quantity:'1',amount:'500',date,note:'Full order'});
  await h.save('entry',{type:'expense',purchaseId:purchase.id,accountId:bank.id,amount:'100',date,note:'PO payment before bill'});
  const bill=await h.save('billSave',{vendor:'Business supplier',invoiceNo:'SUP-FIN-1',category:'Materials',purchaseId:purchase.id,amount:'500',date});
  await h.save('billPay',{id:bill.id,accountId:bank.id,amount:'150',date});
  await h.save('billSave',{vendor:'PRIVATE personal supplier',amount:'50',date,scope:'personal'});
  const employee=await h.save('employee',{code:'SECRET-EMPLOYEE',name:'PRIVATE employee name',baseSalary:'320',bank:'PRIVATE payroll bank'}),salary=await h.save('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'320',deductions:[{label:'PRIVATE deduction detail',amount:'20'}],note:'PRIVATE salary note'});
  const state=(await h.call('/api/state')).body;assert.equal(state.summary.expense,26234);assert.equal(state.summary.income,20000);assert.equal(state.summary.payable,25000);
  const report=await h.call('/api/report?from=2026-11-01&to=2026-11-30');assert.equal(report.status,200);assert.deepEqual(metricValues(report.body,'ค่าใช้จ่ายที่บันทึกแล้ว'),[262.34,7.89]);assert.deepEqual(metricValues(report.body,'รายรับที่รับแล้ว'),[200,0]);assert.deepEqual(metricValues(report.body,'ลูกหนี้ค้างรับ'),[800]);assert.deepEqual(metricValues(report.body,'ผู้ขายและเงินเดือนค้างจ่าย'),[550]);assert.match(report.body,new RegExp(invoice.number));assert.match(report.body,new RegExp(bill.number));assert.match(report.body,/PRIVATE employee name/);assert.match(report.body,/PRIVATE personal supplier/);
  const paid=await h.save('payrollPay',{id:salary.id,accountId:bank.id,date});assert.ok(paid.paymentEntryId);
  const after=(await h.call('/api/report')).body;assert.deepEqual(metricValues(after,'ค่าใช้จ่ายที่บันทึกแล้ว'),[562.34,7.89]);assert.deepEqual(metricValues(after,'ผู้ขายและเงินเดือนค้างจ่าย'),[250]);assert.equal((await h.call('/api/state')).body.summary.expense,56234);
  for(const role of ['staff','public']){
    const rendered=await h.call('/api/report',{role});assert.equal(rendered.status,200);assert.deepEqual(metricValues(rendered.body,'ค่าใช้จ่ายที่บันทึกแล้ว'),[562.34]);assert.deepEqual(metricValues(rendered.body,'ผู้ขายค้างจ่าย'),[250]);
    assert.doesNotMatch(rendered.body,/PRIVATE|SECRET-EMPLOYEE|<h2>เงินเดือนพนักงาน<\/h2>|<h2>รายรับ–รายจ่ายส่วนตัว<\/h2>/);
    assert.equal(rendered.body.includes('data:image/png;base64,'+png),role==='staff');assert.equal(rendered.body.includes('Finance approver'),role==='staff');
  }
  assert.match(after,/data:image\/png;base64,/);assert.match(after,/id="document"/);assert.match(after,/id="print"/);assert.match(after,/id="png"/);assert.equal(report.headers.get('cache-control'),'no-store');
});

test('report route rejects invalid filters and preserves escaped supplier text in HTML',async()=>{
  const h=financeHarness();await h.save('billSave',{vendor:'<script>alert("vendor")</script>',amount:'12.34',date,note:'<img src=x onerror=alert(1)>'});
  const report=await h.call('/api/report');assert.equal(report.status,200);assert.match(report.body,/&lt;script&gt;alert\(&quot;vendor&quot;\)&lt;\/script&gt;/);assert.doesNotMatch(report.body,/<script>alert|<img src=x/);
  for(const query of ['from=2026-02-30','to=not-a-date','from=2026-11-11&to=2026-11-10','search='+encodeURIComponent('a'.repeat(501))])assert.equal((await h.call('/api/report?'+query)).status,400,query);
});

test('applying a default signature requires owner and a readable real image, then signs only unsigned snapshots without replacing company history',async()=>{
  const h=financeHarness();await h.save('company',{name:'Original company'});const bank=await h.account('Signature account'),customer=await h.save('customer',{name:'Unsigned customer'});
  const quote=await h.save('document',{kind:'quote',customerId:customer.id,date,items:[{description:'Quote',quantity:'1',price:'10'}]}),invoice=await h.save('document',{kind:'invoice',customerId:customer.id,date,items:[{description:'Invoice',quantity:'1',price:'10'}]});
  await h.save('entry',{type:'income',accountId:bank.id,amount:'1',date,note:'Unsigned receipt'});
  const employee=await h.save('employee',{code:'UNSIGNED-1',name:'Unsigned employee',baseSalary:'10'}),payroll=await h.save('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'10'}),bill=await h.save('billSave',{vendor:'Unsigned supplier',amount:'10',date});
  const before=snapshots(h.raw());
  for(const role of ['staff','public'])assert.equal((await h.call('/api/company/signature/apply-unsigned',{role,data:{}})).status,403);
  assert.equal((await h.call('/api/company/signature/apply-unsigned',{data:{}})).status,400);assert.deepEqual(snapshots(h.raw()),before);
  assert.equal((await h.call('/api/company/signature',{data:{name:'Typed name only',title:'Director'}})).status,200);
  assert.equal((await h.call('/api/company/signature/apply-unsigned',{data:{}})).status,400);assert.deepEqual(snapshots(h.raw()),before);
  assert.equal((await h.sign('Signer A')).status,200);const asset=h.raw().company.signature.assetId;
  await h.env.BUCKET.put('signatures/'+asset,new Uint8Array([1,2,3]));assert.equal((await h.call('/api/company/signature/apply-unsigned',{data:{}})).status,400);assert.deepEqual(snapshots(h.raw()),before);
  await h.env.BUCKET.put('signatures/'+asset,Buffer.from(png,'base64'));await h.save('company',{name:'Current company'});
  const applied=await h.call('/api/company/signature/apply-unsigned',{data:{}});assert.equal(applied.status,200,JSON.stringify(applied.body));assert.deepEqual(applied.body.applied,{documents:2,receipts:1,payroll:1,bills:1,total:5});
  const signed=snapshots(h.raw());for(const records of Object.values(signed))for(const r of records){assert.equal(r.company.name,'Original company');assert.equal(r.company.signature.assetId,asset);assert.equal(r.company.signature.name,'Signer A');}
  await h.sign('Signer B');const reapplied=await h.call('/api/company/signature/apply-unsigned',{data:{}});assert.equal(reapplied.status,200);assert.equal(reapplied.body.applied.total,0);assert.deepEqual(snapshots(h.raw()),signed);
  const receipt=h.raw().receipts[0];for(const path of ['/api/document?id='+quote.id,'/api/document?id='+invoice.id,'/api/receipt?id='+receipt.id,'/api/payslip?id='+payroll.id,'/api/bill?id='+bill.id]){const rendered=await h.call(path);assert.equal(rendered.status,200,path);assert.match(rendered.body,/Signer A/);assert.match(rendered.body,/data:image\/png;base64,/);assert.doesNotMatch(rendered.body,/Signer B|Current company/);}
  assert.ok(h.raw().audit.some(a=>a.action==='signature_apply_unsigned'));
});

test('base entry route canonicalizes PO/bill links and rejects overpayment, wrong scope and cancelled bill references',async()=>{
  const h=financeHarness(),bank=await h.account('PO account'),personal=await h.account('Personal PO account','personal'),product=await h.save('product',{sku:'GUARD-1',name:'Guard material',unit:'pcs',kind:'material'}),purchase=await h.save('purchase',{productId:product.id,vendor:'Guard supplier',quantity:'1',amount:'100',date,note:'PO guard'}),bill=await h.save('billSave',{vendor:'Guard supplier',purchaseId:purchase.id,amount:'100',date});
  const entry={type:'expense',accountId:bank.id,amount:'60',date,note:'Direct PO payment'};
  const first=await h.save('billPay',{id:bill.id,accountId:bank.id,amount:'40',date}),second=await h.save('entry',{...entry,purchaseId:purchase.id});assert.equal(second.billId,bill.id);assert.equal(second.purchaseId,purchase.id);
  const before=h.raw();for(const link of [{billId:bill.id},{purchaseId:purchase.id}])assert.equal((await h.action('entry',{...entry,...link,amount:'0.01'})).status,400);assert.deepEqual(h.raw(),before);assert.equal((await h.call('/api/state')).body.summary.expense,10000);
  assert.equal((await h.action('entry',{...entry,accountId:personal.id,purchaseId:purchase.id,amount:'0.01'})).status,400);
  assert.equal((await h.action('billCancel',{id:bill.id,note:'Cannot cancel paid bill'})).status,400);
  for(const e of [first,second])await h.save('reverse',{id:e.id,date,note:'Reverse payment for cancellation'});await h.save('billCancel',{id:bill.id,note:'Cancelled bill guard'});
  assert.equal((await h.action('entry',{...entry,billId:bill.id,amount:'1'})).status,400);assert.equal((await h.action('billPay',{id:bill.id,accountId:bank.id,amount:'1',date})).status,400);
  const replacement=await h.save('billSave',{vendor:'Replacement supplier',purchaseId:purchase.id,amount:'100',date});const paid=await h.save('entry',{...entry,billId:replacement.id,amount:'100'});assert.equal(paid.purchaseId,purchase.id);assert.equal((await h.call('/api/state')).body.summary.expense,10000);
  const report=(await h.call('/api/report')).body;assert.deepEqual(metricValues(report,'ผู้ขายและเงินเดือนค้างจ่าย'),[0]);assert.deepEqual(metricValues(report,'ค่าใช้จ่ายที่บันทึกแล้ว'),[100,0]);
});
