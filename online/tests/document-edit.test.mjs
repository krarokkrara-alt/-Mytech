import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,mutate,summary,invoicePaid} from '../my-tech-accounting/model.mjs';
import {documentHtml} from '../my-tech-accounting/documents.mjs';
import worker from '../worker/index.mjs';
import {database,bucket} from './db.mjs';

const owner={role:'owner',name:'Owner'},staff={role:'staff',name:'Staff'},date='2026-11-11';
const item=(price='100.00')=>[{description:'Original service',quantity:'1',price}];
function fixture(){let s=initial();const run=(action,p,user=owner)=>{const out=mutate(s,action,p,user);s=out.state;return out.result;};const c=run('customer',{name:'Original customer'});return {get s(){return s;},run,c,create:(p={})=>run('document',{kind:'invoice',customerId:c.id,date,items:item(),...p})};}
const edit=(d,extra={})=>({id:d.id,expectedRevision:d.revision||1,editReason:'Correct document data',kind:d.kind,customerId:d.customerId,date:d.date,items:d.items.map(x=>({description:x.description,quantity:String(x.quantity/1000),price:(x.unitPrice/100).toFixed(2)})),...extra});

test('unpaid Invoice edits in place, preserves number/signature, stores owner audit and recalculates debt without income',()=>{
  const h=fixture();h.s.company.signature={name:'Signer',title:'Manager',assetId:'11111111-1111-4111-8111-111111111111',mime:'image/png'};
  const d=h.create();h.s.company.signature=null;
  const changed=h.run('document',edit(d,{items:item('125.55'),customerName:'Corrected customer',customerAddress:'Correct address',due:'2026-12-01',note:'Updated note'}),staff);
  assert.equal(changed.id,d.id);assert.equal(changed.number,d.number);assert.equal(changed.revision,2);assert.equal(h.s.documents.length,1);
  assert.deepEqual(changed.company,d.company);assert.equal(changed.customer.name,'Corrected customer');assert.equal(h.s.customers[0].name,'Original customer');
  assert.equal(summary(h.s).receivable,12555);assert.equal(summary(h.s).income,0);assert.equal(h.s.entries.length,0);
  const history=h.s.audit.find(a=>a.action==='documentRevision');assert.deepEqual(history.beforeDocument,d);assert.equal(history.by,'Staff');assert.equal(history.note,'Correct document data');
  const snapshot=structuredClone(h.s);assert.throws(()=>h.run('document',edit(d,{items:item('1')})),/โหลดใหม่/);assert.deepEqual(h.s,snapshot);
  const next=h.run('document',edit(changed,{clearDue:true}));assert.equal(next.revision,3);assert.equal(next.due,null);
});

test('paid invoices allow corrections above received money while protecting payer and enrollment links',()=>{
  const h=fixture(),d=h.create(),ac=h.run('account',{name:'Cash',scope:'business'});
  const payment=h.run('entry',{type:'income',accountId:ac.id,invoiceId:d.id,amount:'40',date,note:'Partial payment'});
  const corrected=h.run('document',edit(d,{due:'2026-12-01',note:'Clarify payment terms',customerPhone:''}));
  assert.equal(invoicePaid(h.s,corrected),4000);assert.equal(summary(h.s).receivable,6000);assert.equal(summary(h.s).income,4000);
  assert.throws(()=>h.run('document',edit(corrected,{items:item('39.99')})),/ต่ำกว่าเงินที่รับชำระ/);
  const second=h.run('customer',{name:'Another payer'});assert.throws(()=>h.run('document',edit(corrected,{customerId:second.id})),/เปลี่ยนผู้ชำระ/);
  const adjusted=h.run('document',edit(corrected,{items:item('150'),customerName:'Corrected spelling',date:'2026-11-10'}));
  assert.equal(adjusted.total,15000);assert.equal(invoicePaid(h.s,adjusted),4000);assert.equal(summary(h.s).income,4000);assert.equal(summary(h.s).receivable,11000);
  h.run('reverse',{id:payment.id,date,note:'Payment correction'});assert.equal(h.run('document',edit(adjusted,{items:item('30'),customerId:second.id})).total,3000);
});

test('converted quote protects source while its Invoice can edit without treating itself as a duplicate conversion',()=>{
  const h=fixture(),q=h.create({kind:'quote'}),d=h.create({sourceQuoteId:q.id});
  assert.throws(()=>h.run('document',edit(q,{items:item('120')})),/Invoice อ้างอิง/);
  assert.equal(h.run('document',edit(q,{note:'Clarification'})).revision,2);
  const revised=h.run('document',edit(d,{items:item('120')}));assert.equal(revised.total,12000);assert.equal(revised.sourceQuoteId,q.id);
  assert.throws(()=>h.run('document',edit(revised,{sourceQuoteId:null})),/ใบเสนอราคาอ้างอิง/);
});

test('enrollment edits exclude their own Invoice from duplicate detection and cannot create a second course debt',()=>{
  const h=fixture(),course=h.run('course',{name:'Course',price:'100',cohort:'Nov'}),en=h.run('enroll',{customerId:h.c.id,courseId:course.id}),d=h.create({enrollmentId:en.id});
  h.run('document',edit(d,{note:'Clarification'}));assert.equal(summary(h.s).receivable,10000);
  assert.throws(()=>h.create({enrollmentId:en.id}),/มี Invoice/);assert.throws(()=>h.run('document',edit(h.s.documents[0],{items:item('101')})),/ตรงกับค่าคอร์ส/);
});

test('legacy signatures stay absent, dates are real, and editing document year never recycles its original number',()=>{
  const h=fixture(),d=h.create();delete h.s.documents[0].revision;delete h.s.documents[0].company;
  h.s.company.signature={name:'New signer',title:'',assetId:'11111111-1111-4111-8111-111111111111',mime:'image/png'};
  const revised=h.run('document',edit(d,{date:'2027-01-02'}));assert.equal(revised.revision,2);assert.equal(revised.company.signature,null);assert.equal(revised.number,'INV-2026-0001');
  assert.equal(h.create().number,'INV-2026-0002');assert.equal(h.create({date:'2027-01-02'}).number,'INV-2027-0001');
  assert.throws(()=>h.run('document',edit(revised,{due:'2027-02-30'})),/เป็นวันจริง/);
  assert.throws(()=>h.run('document',edit(revised,{editReason:''})),/เหตุผล/);assert.throws(()=>h.run('document',edit(revised),{role:'viewer'}),/ไม่มีสิทธิ์/);
});

function apiHarness(){const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test'};let counter=0;
  async function request(path,{role='owner',data}={}){const headers=new Headers({'oai-authenticated-user-id':role,'oai-authenticated-user-email':role+'@example.test'});if(data){headers.set('Content-Type','application/json');headers.set('origin','https://mytech.test');headers.set('x-csrf-token','same-origin');}const res=await worker.fetch(new Request('https://mytech.test'+path,{method:data?'POST':'GET',headers,...(data?{body:JSON.stringify(data)}:{})}),env);const text=await res.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:res.status,body};}
  return {DB,request,action:(action,payload,extra={})=>request('/api/action',{...extra,data:{action,payload,requestId:'invoice-edit-'+String(++counter).padStart(6,'0')}})};
}

test('online edit is idempotent, preserves paid receipt snapshots, hides audit from viewers and exposes edit link only to writers',async()=>{
  const h=apiHarness(),c=(await h.action('customer',{name:'Customer'})).body.result,d=(await h.action('document',{kind:'invoice',customerId:c.id,date,items:item()})).body.result;
  const data={action:'document',payload:edit(d,{items:item('200'),customerName:'Revised name'}),requestId:'fixed-invoice-edit-0001'};
  const saved=await h.request('/api/action',{data});assert.equal(saved.status,200);const repeated=await h.request('/api/action',{data});assert.equal(repeated.body.duplicate,true);assert.equal(repeated.body.result.revision,2);
  const ac=(await h.action('account',{name:'Cash',scope:'business'})).body.result;
  const income=await h.action('entry',{type:'income',accountId:ac.id,invoiceId:d.id,amount:'50',date,note:'Received'}),receipt=income.body.receipt;
  const update=await h.action('document',edit(saved.body.result,{note:'Clarified terms',customerName:'Corrected customer spelling'}));assert.equal(update.status,200);
  const state=(await h.request('/api/state')).body;assert.equal(state.documents.length,1);assert.equal(state.summary.receivable,15000);assert.equal(state.summary.income,5000);assert.deepEqual(state.receipts[0],receipt);
  const viewer=(await h.request('/api/state',{role:'viewer'})).body;assert.deepEqual(viewer.audit,[]);assert.ok(!JSON.stringify(viewer).includes('beforeDocument'));
  assert.equal((await h.action('document',edit(state.documents[0]),{role:'viewer'})).status,403);
  const ownerHtml=(await h.request('/api/document?id='+d.id)).body,publicHtml=(await h.request('/api/document?id='+d.id,{role:'viewer'})).body;
  assert.ok(ownerHtml.includes('edit-document'));assert.ok(ownerHtml.includes('ฉบับแก้ไข 3'));assert.ok(!publicHtml.includes('edit-document'));
  assert.ok(documentHtml(state,state.documents[0]).includes('กลับรายการเอกสาร'));
});
