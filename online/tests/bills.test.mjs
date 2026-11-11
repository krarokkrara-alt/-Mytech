import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,mutate,summary} from '../my-tech-accounting/model.mjs';
import {billsInitial,billMutate,billPaid,validateBills,billHtml} from '../worker/bills.mjs';

const owner={id:'owner',name:'Owner',role:'owner'},staff={id:'staff',name:'Staff',role:'staff'};
function harness(){let state=billsInitial(initial());return {get state(){return state;},set state(value){state=value;},act(action,p,user=owner){const out=action.startsWith('bill')?billMutate(state,action,p,user):mutate(state,action,p,user);state=out.state;return out.result;}};}
function bank(h,name='Business bank',scope='business'){const a=h.act('account',{name,scope});h.act('entry',{type:'opening',accountId:a.id,amount:'10000',date:'2026-11-10',note:'Opening'});return a;}
const billInput={vendor:'Supplier A',invoiceNo:'SUP-001',category:'อุปกรณ์',amount:'1000.50',date:'2026-11-10',due:'2026-11-30',scope:'business',project:'Course A',note:'Supplier invoice'};

test('supplier invoices record an obligation before payment and support exact partial payments without duplicate expense',()=>{
  const h=harness(),a=bank(h),bill=h.act('billSave',billInput);assert.equal(bill.total,100050);assert.equal(bill.number,'BILL-2026-0001');assert.equal(billPaid(h.state,bill),0);assert.equal(summary(h.state).expense,0);
  const first=h.act('billPay',{id:bill.id,accountId:a.id,amount:'400.25',date:'2026-11-10'});assert.equal(first.amount,40025);assert.equal(first.billId,bill.id);assert.equal(first.billRemaining,60025);assert.equal(summary(h.state).expense,40025);
  const second=h.act('billPay',{id:bill.id,accountId:a.id,amount:'600.25',date:'2026-11-11'});assert.equal(second.billRemaining,0);assert.equal(billPaid(h.state,bill),100050);assert.equal(summary(h.state).expense,100050);
  const before=JSON.stringify(h.state);assert.throws(()=>h.act('billPay',{id:bill.id,accountId:a.id,amount:'0.01',date:'2026-11-11'}),/เกินบิล/);assert.equal(JSON.stringify(h.state),before);
  assert.throws(()=>h.act('billSave',{...billInput,id:bill.id,amount:'900'}),/จ่ายแล้ว/);assert.throws(()=>h.act('billCancel',{id:bill.id,note:'Cancel'}),/กลับรายการ/);
  h.act('reverse',{id:first.id,date:'2026-11-11',note:'Wrong payment'});assert.equal(billPaid(h.state,bill),60025);h.act('reverse',{id:second.id,date:'2026-11-11',note:'Wrong payment'});assert.equal(billPaid(h.state,bill),0);
  const cancelled=h.act('billCancel',{id:bill.id,note:'Cancelled supplier invoice'});assert.equal(cancelled.status,'cancelled');assert.equal(summary(h.state).expense,0);validateBills(h.state);
});

test('linked purchase invoices preserve earlier PO payments and reject overpayment through either reference',()=>{
  const h=harness(),a=bank(h),product=h.act('product',{sku:'A',name:'Material',unit:'pcs',kind:'material'}),purchase=h.act('purchase',{productId:product.id,vendor:'Supplier A',quantity:'10',amount:'1000.50',date:'2026-11-10',note:'PO'});
  h.act('entry',{type:'expense',accountId:a.id,amount:'400.25',date:'2026-11-10',note:'PO deposit',purchaseId:purchase.id});
  const bill=h.act('billSave',{...billInput,purchaseId:purchase.id});assert.equal(billPaid(h.state,bill),40025);
  assert.throws(()=>h.act('billSave',{...billInput,invoiceNo:'SUP-002',purchaseId:purchase.id}),/อ้างอิงแล้ว/);assert.throws(()=>h.act('billSave',{...billInput,invoiceNo:'SUP-003',amount:'999',purchaseId:purchase.id}),/ตรงกับใบสั่งซื้อ/);
  const payment=h.act('billPay',{id:bill.id,accountId:a.id,amount:'600.25',date:'2026-11-10'});assert.equal(payment.purchaseId,purchase.id);assert.equal(payment.billId,bill.id);assert.equal(billPaid(h.state,bill),100050);assert.equal(summary(h.state).expense,100050);
  assert.throws(()=>h.act('billPay',{id:bill.id,accountId:a.id,amount:'0.01',date:'2026-11-10'}));validateBills(h.state);
});

test('clearing an advance against a supplier invoice counts expense once while preserving cash',()=>{
  const h=harness(),a=bank(h),bill=h.act('billSave',{...billInput,amount:'700'}),advance=h.act('entry',{type:'advance',accountId:a.id,amount:'500',date:'2026-11-10',note:'Supplier advance'});
  const settled=h.act('billPay',{id:bill.id,accountId:a.id,type:'settlement',advanceId:advance.id,amount:'500',date:'2026-11-10'});assert.equal(settled.cash,0);assert.equal(settled.advanceId,advance.id);assert.equal(billPaid(h.state,bill),50000);
  h.act('billPay',{id:bill.id,accountId:a.id,amount:'200',date:'2026-11-10'});assert.equal(summary(h.state).expense,70000);assert.equal(summary(h.state).cashOut,70000);assert.equal(billPaid(h.state,bill),70000);
});

test('bill roles and scope prevent staff access to personal records and require owner cancellation',()=>{
  const h=harness(),business=bank(h),personal=bank(h,'Personal bank','personal');
  const privateBill=h.act('billSave',{...billInput,vendor:'Personal vendor',scope:'personal'});assert.throws(()=>h.act('billSave',{...billInput,id:privateBill.id,scope:'business'},staff),/เฉพาะเจ้าของ/);assert.throws(()=>h.act('billPay',{id:privateBill.id,accountId:personal.id,amount:'1',date:'2026-11-10'},staff));
  assert.throws(()=>h.act('billSave',{...billInput,scope:'personal'},staff));assert.throws(()=>h.act('billSave',billInput,{role:'viewer',name:'Viewer'}));
  const businessBill=h.act('billSave',{...billInput,invoiceNo:'STAFF-1'},staff);assert.throws(()=>h.act('billPay',{id:businessBill.id,accountId:personal.id,amount:'1',date:'2026-11-10'},staff));assert.throws(()=>h.act('billCancel',{id:businessBill.id,note:'Cancel'},staff),/เจ้าของ/);
  assert.equal(h.act('billPay',{id:businessBill.id,accountId:business.id,amount:'1',date:'2026-11-10'},staff).amount,100);
});

test('supplier invoice validation rejects invalid calendar dates, duplicate references and broken restored links',()=>{
  const h=harness();bank(h);for(const input of [{date:'2026-02-30'},{due:'2026-02-30'},{due:'2026-11-09'},{amount:'0'},{amount:'-1'},{amount:'1.001'}])assert.throws(()=>h.act('billSave',{...billInput,...input}));
  const bill=h.act('billSave',billInput);assert.throws(()=>h.act('billSave',{...billInput,vendor:' supplier   a ',invoiceNo:'sup-001'}),/Invoice.*ซ้ำ/);
  const changed=h.act('billSave',{...billInput,id:bill.id,amount:'1001.25'});assert.equal(changed.number,bill.number);assert.equal(changed.total,100125);
  for(const corrupt of [s=>s.bills[0].total=-1,s=>s.bills[0].due='2026-02-30',s=>s.bills[0].purchaseId='missing',s=>s.bills.push(structuredClone(s.bills[0]))]){const s=structuredClone(h.state);corrupt(s);assert.throws(()=>validateBills(s));}
});

test('editing an unpaid bill preserves its original company and issuer signature snapshot',()=>{
  const h=harness();h.state.company.signature={assetId:'old-image',name:'Original signer'};const bill=h.act('billSave',billInput);h.state.company.signature={assetId:'new-image',name:'Changed signer'};
  const edited=h.act('billSave',{...billInput,id:bill.id,note:'Corrected note'});assert.equal(edited.company.signature.assetId,'old-image');assert.equal(bill.company.signature.name,'Original signer');assert.equal(h.state.company.signature.assetId,'new-image');
});

test('a cancelled linked bill does not inherit payments of its replacement',()=>{
  const h=harness(),a=bank(h),product=h.act('product',{sku:'B',name:'Material',unit:'pcs',kind:'material'}),purchase=h.act('purchase',{productId:product.id,vendor:'Supplier A',quantity:'1',amount:'1000.50',date:'2026-11-10',note:'PO'});
  const first=h.act('billSave',{...billInput,purchaseId:purchase.id});h.act('billCancel',{id:first.id,note:'Replace wrong vendor reference'});
  const replacement=h.act('billSave',{...billInput,purchaseId:purchase.id});h.act('billPay',{id:replacement.id,accountId:a.id,amount:'1000.50',date:'2026-11-11'});
  assert.equal(billPaid(h.state,h.state.bills.find(b=>b.id===first.id)),0);assert.equal(billPaid(h.state,replacement),100050);validateBills(h.state);
});

test('bill scope stays immutable even after reversal so a business Trello route cannot inherit personal data',()=>{
  const h=harness(),a=bank(h);bank(h,'Personal bank','personal');const bill=h.act('billSave',billInput),payment=h.act('billPay',{id:bill.id,accountId:a.id,amount:'1',date:'2026-11-10'});
  h.act('reverse',{id:payment.id,date:'2026-11-10',note:'Wrong bill scope'});
  assert.throws(()=>h.act('billSave',{...billInput,id:bill.id,scope:'personal'}),/เปลี่ยนขอบเขต/);const corrected=h.act('billSave',{...billInput,id:bill.id,note:'Corrected after reversal'});assert.equal(corrected.scope,'business');assert.equal(billPaid(h.state,corrected),0);assert.equal(h.state.entries.find(e=>e.id===payment.id).billId,bill.id);validateBills(h.state);
});

test('bill print is an internal approval record with escaped content, snapshot signature and active payments',()=>{
  const h=harness(),a=bank(h);h.state.company={...h.state.company,name:'Company <script>',signature:{name:'Signer <tag>',title:'Owner & manager'}};
  const bill=h.act('billSave',{...billInput,vendor:'Vendor <img src=x>',note:'<script>alert(1)</script>',project:'A & B'}),payment=h.act('billPay',{id:bill.id,accountId:a.id,amount:'400.25',date:'2026-11-10',note:'Paid <unsafe>'});
  h.state.company.signature.name='New signer';const html=billHtml(h.state,bill);
  for(const id of ['document','print','png','message'])assert.match(html,new RegExp('id="'+id+'"'));assert.match(html,/href="\/document.css"/);assert.match(html,/src="\/document.js"/);assert.match(html,/ผู้บันทึก \/ ผู้อนุมัติ/);assert.match(html,/ไม่ใช่ต้นฉบับ Invoice/);assert.match(html,/Signer &lt;tag&gt;/);assert.doesNotMatch(html,/New signer/);
  assert.match(html,/Vendor &lt;img src=x&gt;/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.match(html,/Paid &lt;unsafe&gt;/);assert.doesNotMatch(html,/<img src=x>|<script>alert/);assert.match(html,/400\.25/);assert.match(html,/600\.25/);
  h.act('reverse',{id:payment.id,date:'2026-11-11',note:'Reverse payment'});const reversed=billHtml(h.state,bill);assert.doesNotMatch(reversed,/Paid &lt;unsafe&gt;/);assert.match(reversed,/ยังไม่มีรายการชำระ/);
});
