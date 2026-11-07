import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {initial,mutate,summary} from '../my-tech-accounting/model.mjs';
import {payrollMutate,paymentActive,payslipHtml} from '../worker/payroll.mjs';
import {database,bucket} from './db.mjs';

const owner={id:'owner-id',name:'Owner',role:'owner'},staff={id:'staff-id',name:'Staff',role:'staff'};
function harness(){let s=initial();return {get s(){return s;},do(action,p={}){const result=['employee','payrollSave','payrollPay','payrollCancel'].includes(action)?payrollMutate(s,action,p,owner):mutate(s,action,p,owner);s=result.state;return result.result;}};}
test('payroll exact amounts, configurable additions/deductions, snapshots and one expense per payment',()=>{
  const h=harness(),account=h.do('account',{name:'Bank',scope:'business'});h.do('entry',{type:'opening',accountId:account.id,amount:'100000',date:'2026-11-08',note:'Opening'});
  const e=h.do('employee',{code:'E01',name:'Employee <script>',baseSalary:'15000.29',bank:'Private'});
  const p=h.do('payrollSave',{employeeId:e.id,month:'2026-11',baseSalary:'15000.29',earnings:[{label:'OT',amount:'1000.11'},{label:'Bonus',amount:'500'}],deductions:[{label:'Tax manual',amount:'750.25'}]});
  assert.equal(p.net,1575015);assert.equal(summary(h.s).expense,0);assert.equal(summary(h.s).accounts[0].balance,10000000);
  assert.throws(()=>h.do('payrollSave',{employeeId:e.id,month:'2026-11',baseSalary:'100',earnings:[],deductions:[]}));
  h.do('employee',{id:e.id,code:'E01',name:'Changed name',baseSalary:'20000'});assert.equal(h.s.payroll[0].employee.name,'Employee <script>');
  const paid=h.do('payrollPay',{id:p.id,accountId:account.id,date:'2026-11-08'});assert.ok(paymentActive(h.s,paid));assert.equal(summary(h.s).expense,1575015);assert.equal(summary(h.s).accounts[0].balance,8424985);
  assert.throws(()=>h.do('payrollPay',{id:p.id,accountId:account.id}));assert.throws(()=>h.do('payrollSave',{...p,baseSalary:'1'}));assert.throws(()=>h.do('payrollCancel',{id:p.id,note:'test'}));
  const html=payslipHtml(h.s,paid);assert.ok(html.includes('Employee &lt;script&gt;'));assert.ok(!html.includes('Employee <script>'));
  h.do('reverse',{id:paid.paymentEntryId,note:'Incorrect payment',date:'2026-11-08'});assert.equal(summary(h.s).expense,0);assert.ok(!paymentActive(h.s,h.s.payroll[0]));
  h.do('payrollPay',{id:p.id,accountId:account.id});assert.equal(summary(h.s).expense,1575015);
});
test('payroll rejects unauthorized changes, negative and excessive deductions, invalid months and inactive employees',()=>{
  assert.throws(()=>payrollMutate(initial(),'employee',{code:'1',name:'A',baseSalary:'1'},staff));const h=harness(),e=h.do('employee',{code:'1',name:'A',baseSalary:'100'});
  for(const p of [{month:'2026-13',baseSalary:'100'},{month:'2026-11',baseSalary:'-1'},{month:'2026-11',baseSalary:'100',deductions:[{label:'Too much',amount:'101'}]}])assert.throws(()=>h.do('payrollSave',{employeeId:e.id,...p}));
  h.do('employee',{id:e.id,code:'1',name:'A',baseSalary:'100',active:false});assert.throws(()=>h.do('payrollSave',{employeeId:e.id,month:'2026-11',baseSalary:'100'}));
});
function apiHarness(){const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,5).toString('base64')};let counter=0;
  const call=async(path,{role='viewer',method='GET',data,origin='https://mytech.test',csrf='same-origin'}={})=>{
    const headers=new Headers();if(role!=='anonymous'){headers.set('oai-authenticated-user-id',role+'-id');headers.set('oai-authenticated-user-email',role+'@example.test');}
    if(method==='POST'){headers.set('Origin',origin);headers.set('Content-Type','application/json');headers.set('x-csrf-token',csrf);}
    const r=await worker.fetch(new Request('https://mytech.test'+path,{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body,headers:r.headers};
  };
  return {DB,env,call,action:(action,payload,role='owner',requestId='request-'+(++counter).toString().padStart(8,'0'))=>call('/api/action',{role,method:'POST',data:{action,payload,requestId}})};
}
test('online permissions: anonymous read, fixed owner, grant/revoke, protected payroll and backups, CSRF',async()=>{
  const h=apiHarness();let r=await h.call('/api/session',{role:'anonymous'});assert.equal(r.body.user.role,'viewer');
  r=await h.call('/api/state',{role:'anonymous'});assert.equal(r.status,200);assert.equal(r.body.pending.length,0);assert.deepEqual(r.body.payroll,[]);
  assert.equal((await h.action('account',{name:'no'},'anonymous')).status,403);
  assert.equal((await h.call('/api/backup',{role:'anonymous'})).status,403);
  assert.equal((await h.call('/api/payslip?id=no',{role:'viewer'})).status,403);
  assert.equal((await h.call('/api/members',{role:'viewer',method:'POST',data:{email:'x@y.z',name:'x'}})).status,403);
  assert.equal((await h.call('/api/session',{role:'owner'})).body.user.role,'owner');
  assert.equal((await h.call('/api/members',{role:'owner',method:'POST',origin:'https://evil.test',data:{email:'staff@example.test',name:'Staff'}})).status,403);
  assert.equal((await h.call('/api/members',{role:'owner',method:'POST',csrf:'wrong',data:{email:'staff@example.test',name:'Staff'}})).status,403);
  assert.equal((await h.call('/api/members',{role:'owner',method:'POST',data:{email:'staff@example.test',name:'Staff'}})).status,200);
  assert.equal((await h.call('/api/session',{role:'staff'})).body.user.role,'staff');
  assert.equal((await h.action('customer',{name:'Customer',phone:'secret-phone',address:'secret-address'},'staff')).status,200);
  assert.equal((await h.action('employee',{code:'E1',name:'Secret Employee',baseSalary:'100'},'staff')).status,403);
  assert.equal((await h.action('employee',{code:'E1',name:'Secret Employee',baseSalary:'100'})).status,200);
  const publicState=(await h.call('/api/state',{role:'anonymous'})).body;assert.equal(publicState.customers[0].phone,'');assert.equal(publicState.customers[0].address,'');assert.ok(!JSON.stringify(publicState).includes('Secret Employee'));
  assert.equal((await h.call('/api/members',{role:'owner',method:'POST',data:{email:'staff@example.test',remove:true}})).status,200);
  assert.equal((await h.action('customer',{name:'No longer allowed'},'staff')).status,403);
  delete h.env.OWNER_EMAIL;assert.equal((await h.call('/api/session',{role:'owner'})).body.user.role,'viewer');assert.equal((await h.action('account',{name:'Takeover'},'owner')).status,403);
});
test('online idempotency, persistence across requests, payroll payment, backup/restore and recovery',async()=>{
  const h=apiHarness();let r=await h.action('account',{name:'Bank',scope:'business'},'owner','same-request-123');const account=r.body.result;assert.equal(r.status,200);
  r=await h.action('account',{name:'Bank',scope:'business'},'owner','same-request-123');assert.equal(r.body.duplicate,true);
  await h.action('entry',{type:'opening',accountId:account.id,amount:'1000',date:'2026-11-08',note:'Opening'});
  const employee=(await h.action('employee',{code:'E1',name:'Person',baseSalary:'100'})).body.result;
  const slip=(await h.action('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'100',earnings:[{label:'Extra',amount:'5.01'}],deductions:[{label:'Deduct',amount:'1'}]})).body.result;
  assert.equal((await h.action('payrollPay',{id:slip.id,accountId:account.id})).status,200);
  assert.equal((await h.action('payrollPay',{id:slip.id,accountId:account.id})).status,400);
  assert.equal((await h.call('/api/state',{role:'owner'})).body.summary.expense,10401);
  const viewer=(await h.call('/api/state',{role:'anonymous'})).body;assert.equal(viewer.summary.expense,10401);assert.ok(viewer.entries.some(e=>e.id.startsWith('salary-summary-')));assert.ok(!viewer.entries.some(e=>e.payrollId));assert.ok(!JSON.stringify(viewer).includes(slip.id));
  r=await h.call('/api/payslip?id='+slip.id,{role:'owner'});assert.equal(r.status,200);assert.ok(r.body.includes('Person'));
  const backup=(await h.call('/api/backup',{role:'owner'})).body;assert.equal(backup.state.payroll.length,1);assert.ok(!('secrets' in backup));
  await h.action('customer',{name:'After backup'});
  assert.equal((await h.call('/api/restore',{role:'owner',method:'POST',data:{confirm:'wrong',backup}})).status,400);
  r=await h.call('/api/restore',{role:'owner',method:'POST',data:{confirm:'กู้คืนข้อมูล',backup}});assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal((await h.call('/api/state',{role:'owner'})).body.customers.length,0);
  const recovery=(await h.call('/api/recovery',{role:'owner'})).body;assert.equal(recovery.length,1);
  const recovered=await h.call('/api/recovery?id='+recovery[0].id,{role:'owner'});assert.equal(recovered.body.state.customers[0].name,'After backup');
});
test('optimistic concurrency rejects a stale update without overwriting newer state',async()=>{
  const h=apiHarness();await h.call('/api/state');const batch=h.DB.batch.bind(h.DB);h.DB.batch=async statements=>{h.DB.raw.exec('UPDATE app_state SET revision=revision+1');return batch(statements);};
  assert.equal((await h.action('customer',{name:'Stale'})).status,409);assert.equal((await h.call('/api/state',{role:'owner'})).body.customers.length,0);
});
test('Trello credentials encrypted at rest and absent from backup and public state',async()=>{
  const h=apiHarness(),token='private-token-'.repeat(5),key='a'.repeat(32);
  assert.equal((await h.call('/api/trello/config',{role:'owner',method:'POST',data:{key,token}})).status,200);
  const row=h.DB.raw.prepare('SELECT value FROM secrets').get();assert.ok(!row.value.includes(token));assert.ok(!row.value.includes(key));
  assert.ok(!JSON.stringify((await h.call('/api/backup',{role:'owner'})).body).includes(token));
  assert.equal((await h.call('/api/state',{role:'anonymous'})).body.trelloConfigured,false);
});
test('staged restore handles backups larger than the request limit, preserving each file in R2',async()=>{
  const h=apiHarness(),customer=(await h.action('customer',{name:'Proof customer'})).body.result;
  const bytes=Buffer.alloc(6*1024*1024,65),encoded=bytes.toString('base64');
  for(let i=0;i<2;i++){const r=await h.call('/api/attachment',{role:'owner',method:'POST',data:{recordId:customer.id,mime:'image/png',name:'proof-'+i+'.png',base64:encoded}});assert.equal(r.status,200);}
  const backup=(await h.call('/api/backup',{role:'owner'})).body;assert.ok(JSON.stringify(backup).length>15*1024*1024);
  const stage=(await h.call('/api/restore/prepare',{role:'owner',method:'POST',data:{confirm:'กู้คืนข้อมูล',backup:{...backup,attachments:backup.attachments.map(({body,...meta})=>meta)}}})).body;
  assert.equal((await h.call('/api/restore/commit',{role:'owner',method:'POST',data:{id:stage.id}})).status,400);
  for(let i=0;i<2;i++)assert.equal((await h.call('/api/restore/file',{role:'owner',method:'POST',data:{id:stage.id,index:i,base64:backup.attachments[i].body}})).status,200);
  assert.equal((await h.call('/api/restore/commit',{role:'owner',method:'POST',data:{id:stage.id}})).status,200);
  const restored=(await h.call('/api/backup',{role:'owner'})).body;assert.equal(restored.attachments.length,2);assert.equal(restored.attachments[1].body,encoded);
  assert.equal(h.DB.raw.prepare('SELECT base64 FROM attachments LIMIT 1').get().base64,'');
  const recovery=(await h.call('/api/recovery',{role:'owner'})).body;assert.equal((await h.call('/api/recovery?id='+recovery[0].id,{role:'owner'})).body.attachments.length,2);
});
test('attachment writes participate in revision and stale uploads do not leave metadata',async()=>{
  const h=apiHarness(),customer=(await h.action('customer',{name:'Before'})).body.result,backup=(await h.call('/api/backup',{role:'owner'})).body;
  const stage=(await h.call('/api/restore/prepare',{role:'owner',method:'POST',data:{confirm:'กู้คืนข้อมูล',backup}})).body;
  const upload=()=>h.call('/api/attachment',{role:'owner',method:'POST',data:{recordId:customer.id,mime:'image/png',name:'Proof.png',base64:'QUJD'}});
  assert.equal((await upload()).status,200);assert.equal((await h.call('/api/restore/commit',{role:'owner',method:'POST',data:{id:stage.id}})).status,409);
  assert.equal((await h.call('/api/state',{role:'owner'})).body.attachmentList.length,1);
  const put=h.env.BUCKET.put.bind(h.env.BUCKET);let changed=false;h.env.BUCKET.put=async(key,data)=>{await put(key,data);if(key.startsWith('attachments/')&&!changed){changed=true;await h.action('customer',{name:'Concurrent'});}};
  assert.equal((await upload()).status,409);assert.equal((await h.call('/api/state',{role:'owner'})).body.attachmentList.length,1);
});
test('restore rejects broken payroll data without changing current records, cancelled slips show cancellation',async()=>{
  const h=apiHarness(),backup=(await h.call('/api/backup',{role:'owner'})).body;backup.state.payroll=[{id:'broken-slip'}];
  assert.equal((await h.call('/api/restore',{role:'owner',method:'POST',data:{confirm:'กู้คืนข้อมูล',backup}})).status,400);
  assert.equal((await h.call('/api/state',{role:'owner'})).body.payroll.length,0);
  const e=(await h.action('employee',{code:'E1',name:'A',baseSalary:'10'})).body.result,p=(await h.action('payrollSave',{employeeId:e.id,month:'2026-11',baseSalary:'10'})).body.result;
  await h.action('payrollCancel',{id:p.id,note:'Duplicate schedule'});
  const html=(await h.call('/api/payslip?id='+p.id,{role:'owner'})).body;assert.ok(html.includes('ยกเลิก · Duplicate schedule'));
});
