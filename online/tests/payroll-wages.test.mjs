import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,mutate,summary} from '../my-tech-accounting/model.mjs';
import {wageCalculation,validateWage} from '../my-tech-accounting/wages.mjs';
import {payrollMutate,validatePayroll,payslipHtml} from '../worker/payroll.mjs';
import {financialReport} from '../my-tech-accounting/reporting.mjs';
import worker from '../worker/index.mjs';
import {database,bucket} from './db.mjs';
const owner={role:'owner',name:'Owner'},date='2026-11-13';
function fixture(balance='1000'){let s=initial();const run=(action,p,user=owner)=>{const out=['employee','payrollSave','payrollPay','payrollCancel'].includes(action)?payrollMutate(s,action,p,user):mutate(s,action,p,user);s=out.state;return out.result;};const account=run('account',{name:'Bank',scope:'business'});run('entry',{type:'opening',accountId:account.id,date,amount:balance,note:'Opening'});const employee=run('employee',{code:'E1',name:'Private employee',baseSalary:'100',bank:'Private bank'});return {get s(){return s;},run,account,employee,save:extra=>run('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'100',earnings:[],deductions:[],...extra})};}
const adjustment={baseSalary:'100',wage:{enabled:true,unit:'hour',quantity:'7.5',rate:'50'},earnings:[{label:'Bonus',amount:'10'}],deductions:[{label:'Deduct',amount:'5'}],note:'Corrected wages',editReason:'Correct actual hours and rate'};

test('daily/hourly wages use exact integer rounding and reject invalid units, precision, zero, overflow and altered stored totals',()=>{
  assert.deepEqual(wageCalculation({unit:'day',quantity:'2.5',rate:'500.25'}),{unit:'day',quantity:2500,rate:50025,amount:125063});
  assert.equal(wageCalculation({unit:'hour',quantity:'7.5',rate:'42.10'}).amount,31575);
  assert.equal(wageCalculation({unit:'hour',quantity:'1.333',rate:'1.01'}).amount,135);
  assert.equal(wageCalculation({enabled:false}),null);
  for(const value of [{unit:'month',quantity:'1',rate:'1'},{unit:'day',quantity:'0',rate:'1'},{unit:'hour',quantity:'1.2345',rate:'1'},{unit:'hour',quantity:'1',rate:'-1'},{unit:'day',quantity:'1000000000',rate:'10000000000'}])assert.throws(()=>wageCalculation(value));
  assert.throws(()=>validateWage({unit:'hour',quantity:1000,rate:100,amount:101}));
});

test('salary, daily/hourly wage and additions/deductions appear once in slip, reports and paid expense',()=>{
  const h=fixture('10000'),p=h.save({baseSalary:'1000.11',wage:{unit:'hour',quantity:'7.5',rate:'42.10'},earnings:[{label:'Bonus',amount:'50.10'}],deductions:[{label:'Deduct',amount:'100.25'}]});
  assert.equal(p.gross,136596);assert.equal(p.net,126571);assert.equal(summary(h.s).expense,0);assert.equal(financialReport(h.s).payroll.unpaid,126571);
  const paid=h.run('payrollPay',{id:p.id,expectedRevision:1,accountId:h.account.id,date});
  assert.equal(summary(h.s).expense,126571);assert.equal(summary(h.s).accounts[0].balance,873429);assert.equal(financialReport(h.s).business.salaryPaid,126571);assert.equal(financialReport(h.s).payroll.unpaid,0);
  assert.ok(payslipHtml(h.s,paid).includes('ค่าแรง 7.5 ชั่วโมง × 42.10 บาท'));validatePayroll(h.s);
});

test('adjusting wages in the pay operation is atomic, audited and creates only one expense',()=>{
  const h=fixture(),p=h.save(),paid=h.run('payrollPay',{id:p.id,expectedRevision:1,accountId:h.account.id,date,adjustment});
  assert.equal(paid.net,48000);assert.equal(paid.revision,2);assert.equal(h.s.payroll.length,1);assert.equal(h.s.entries.filter(e=>e.payrollId===p.id).length,1);assert.equal(summary(h.s).expense,48000);assert.equal(summary(h.s).accounts[0].balance,52000);
  const audit=h.s.audit.find(a=>a.action==='payrollAdjustment');assert.equal(audit.beforePayroll.net,10000);assert.equal(audit.note,adjustment.editReason);
  const state=structuredClone(h.s);assert.throws(()=>h.run('payrollPay',{id:p.id,expectedRevision:2,accountId:h.account.id,date,adjustment}));assert.deepEqual(h.s,state);validatePayroll(h.s);
});

test('failed/stale/unauthorized payouts preserve the original slip and account, and unchanged previews need no adjustment reason',()=>{
  const h=fixture('100'),p=h.save(),before=structuredClone(h.s),payload={id:p.id,expectedRevision:1,accountId:h.account.id,date,adjustment};
  assert.throws(()=>h.run('payrollPay',payload),/ยอดเงินในบัญชีไม่พอ/);assert.deepEqual(h.s,before);
  assert.throws(()=>h.run('payrollPay',{...payload,expectedRevision:2}),/โหลดใหม่/);assert.deepEqual(h.s,before);
  assert.throws(()=>h.run('payrollPay',{...payload,expectedRevision:undefined}),/ค่าแรงล่าสุด/);
  assert.throws(()=>h.run('payrollPay',{...payload,adjustment:{...adjustment,editReason:''}}),/กรอกข้อความ/);
  assert.throws(()=>h.run('payrollPay',payload,{role:'staff'}),/เจ้าของ/);
  const paid=h.run('payrollPay',{...payload,adjustment:{baseSalary:'100',wage:{enabled:false},earnings:[],deductions:[],note:''}});assert.equal(paid.net,10000);assert.equal(summary(h.s).expense,10000);
});

test('draft edits preserve issued signature and protect concurrent wages; existing inactive employee can finish a draft',()=>{
  const h=fixture();h.s.company.signature={name:'Original signer',title:'',assetId:'11111111-1111-4111-8111-111111111111',mime:'image/png'};const p=h.save();h.s.company.signature=null;
  h.run('employee',{id:h.employee.id,code:'E1',name:'Private employee',baseSalary:'100',active:false});
  const changed=h.save({id:p.id,expectedRevision:1,wage:{unit:'day',quantity:'2',rate:'300'}});assert.deepEqual(changed.company,p.company);assert.equal(changed.net,70000);assert.equal(changed.revision,2);
  assert.throws(()=>h.save({id:p.id,expectedRevision:1}),/โหลดใหม่/);validatePayroll(h.s);
});

test('reversal then wage correction and repayment reconciles reports without duplicating expense',()=>{
  const h=fixture(),p=h.save(),paid=h.run('payrollPay',{id:p.id,expectedRevision:1,accountId:h.account.id,date});h.run('reverse',{id:paid.paymentEntryId,date,note:'Correct wages'});
  const corrected=h.save({id:p.id,expectedRevision:2,wage:{unit:'day',quantity:'1',rate:'200'}});assert.equal(financialReport(h.s).payroll.unpaid,30000);
  h.run('payrollPay',{id:p.id,expectedRevision:corrected.revision,accountId:h.account.id,date});assert.equal(summary(h.s).expense,30000);assert.equal(financialReport(h.s).payroll.unpaid,0);validatePayroll(h.s);
});

test('online adjusted payout is idempotent and app-only even with explicit Trello target; public state excludes wage detail',async()=>{
  const h=fixture('10000'),p=h.save(),DB=database();h.s.trello={...h.s.trello,boardId:'a'.repeat(24),lists:[{id:'b'.repeat(24),name:'List'}]};DB.raw.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(h.s));const env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test'};
  const call=async(path,role='owner',data)=>{const headers={'oai-authenticated-user-id':role,'oai-authenticated-user-email':role+'@example.test',origin:'https://mytech.test','Content-Type':'application/json','x-csrf-token':'same-origin'},res=await worker.fetch(new Request('https://mytech.test'+path,{method:data?'POST':'GET',headers,...(data?{body:JSON.stringify(data)}:{})}),env);return {status:res.status,body:await res.json()};};
  const data={action:'payrollPay',payload:{id:p.id,expectedRevision:1,accountId:h.account.id,date,adjustment},requestId:'adjusted-wage-pay-0001',trello:{enabled:true,boardId:'a'.repeat(24),listId:'b'.repeat(24)}};
  assert.equal((await call('/api/action','staff',data)).status,403);assert.equal((await call('/api/action','owner',data)).status,200);assert.equal((await call('/api/action','owner',data)).body.duplicate,true);
  const state=(await call('/api/state')).body;assert.equal(state.summary.expense,48000);assert.equal(state.payroll[0].net,48000);assert.equal((await DB.prepare('SELECT count(*) AS n FROM trello_jobs').first()).n,0);
  const publicState=(await call('/api/state','viewer')).body;assert.deepEqual(publicState.payroll,[]);assert.deepEqual(publicState.audit,[]);assert.ok(!JSON.stringify(publicState).includes('Private employee'));assert.equal(publicState.summary.expense,48000);
  const corrupt=structuredClone(state);corrupt.payroll[0].wage.amount++;assert.throws(()=>validatePayroll(corrupt));
});
