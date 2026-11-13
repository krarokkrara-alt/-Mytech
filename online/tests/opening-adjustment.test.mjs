import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,mutate,summary,openingAmount,validateOpeningAdjustments} from '../my-tech-accounting/model.mjs';
import {payrollMutate} from '../worker/payroll.mjs';
import {financialReport} from '../my-tech-accounting/reporting.mjs';
import worker from '../worker/index.mjs';
import {database,bucket} from './db.mjs';
const owner={role:'owner',name:'Owner'},date='2026-11-13';
function fixture(amount='1000',allowNegative=false,scope='business'){let s=initial();const run=(action,p,user=owner)=>{const out=action.startsWith('payroll')||action==='employee'?payrollMutate(s,action,p,user):mutate(s,action,p,user);s=out.state;return out.result;};const account=run('account',{name:'Cash',scope}),opening=run('entry',{type:'opening',accountId:account.id,amount,date,note:'Starting balance',allowNegative});return {get s(){return s;},run,account,opening,correct:(amount,extra={})=>run('entry',{type:'opening',correctOpening:true,expectedOpeningRevision:s.accounts[0].openingRevision,accountId:account.id,amount,date,note:'Correct opening balance',...extra})};}

test('opening corrections append the difference and preserve original, income and expense totals',()=>{
  const h=fixture();h.run('entry',{type:'income',accountId:h.account.id,amount:'200',date,note:'Income'});h.run('entry',{type:'expense',accountId:h.account.id,amount:'500',date,note:'Expense'});
  const original=structuredClone(h.s.entries[0]),correction=h.correct('800');assert.equal(correction.type,'opening_adjustment');assert.equal(correction.cash,-20000);assert.equal(correction.openingBefore,100000);assert.equal(correction.openingAfter,80000);assert.equal(correction.openingRevision,2);assert.deepEqual(h.s.entries[0],original);
  assert.equal(openingAmount(h.s,h.account.id),80000);assert.equal(summary(h.s).accounts[0].balance,50000);assert.equal(summary(h.s).income,20000);assert.equal(summary(h.s).expense,50000);assert.equal(financialReport(h.s).business.expense,50000);validateOpeningAdjustments(h.s);
});

test('owner may explicitly enable negative balances, including signed opening and salary payments',()=>{
  const h=fixture('100');h.run('entry',{type:'expense',accountId:h.account.id,amount:'80',date,note:'Expense'});const before=structuredClone(h.s);assert.throws(()=>h.correct('0'),/ติดลบ/);assert.deepEqual(h.s,before);
  h.correct('0',{allowNegative:true});assert.equal(summary(h.s).accounts[0].balance,-8000);const e=h.run('employee',{code:'E1',name:'Employee',baseSalary:'50'}),p=h.run('payrollSave',{employeeId:e.id,month:'2026-11',baseSalary:'50',earnings:[],deductions:[]});h.run('payrollPay',{id:p.id,accountId:h.account.id,date});assert.equal(summary(h.s).accounts[0].balance,-13000);assert.equal(summary(h.s).expense,13000);
  assert.throws(()=>h.correct('0',{allowNegative:false}),/ติดลบ/);h.correct('200',{allowNegative:false});assert.equal(summary(h.s).accounts[0].balance,7000);assert.equal(h.s.accounts[0].allowNegative,false);assert.throws(()=>h.run('entry',{type:'expense',accountId:h.account.id,amount:'100',date,note:'Too much'}),/ไม่พอ/);validateOpeningAdjustments(h.s);
});

test('signed initial opening and subsequent corrections use signed cash and positive entry magnitude',()=>{
  assert.throws(()=>fixture('-100'),/อนุญาต/);const h=fixture('-100',true);assert.equal(h.opening.amount,10000);assert.equal(h.opening.cash,-10000);h.correct('-200');assert.equal(openingAmount(h.s,h.account.id),-20000);assert.equal(summary(h.s).accounts[0].balance,-20000);assert.equal(summary(h.s).income,0);assert.equal(summary(h.s).expense,0);
  for(const e of h.s.entries)assert.throws(()=>h.run('reverse',{id:e.id,date,note:'Reverse'}),/ปุ่มแก้ไขยอดยกมา/);validateOpeningAdjustments(h.s);
});

test('revision prevents stale and ABA edits and owner-only options cannot be smuggled through regular entries',()=>{
  const h=fixture();h.correct('800');h.correct('1000');const before=structuredClone(h.s);assert.throws(()=>h.correct('900',{expectedOpeningRevision:1}),/โหลดใหม่/);assert.deepEqual(h.s,before);
  assert.throws(()=>h.correct('1000'),/เหมือนเดิม/);assert.throws(()=>h.correct('900',{date:'2026-11-12'}),/วันเริ่มต้น/);
  for(const role of ['staff','viewer'])assert.throws(()=>h.run('entry',{type:'opening',correctOpening:true,expectedOpeningRevision:3,accountId:h.account.id,amount:'900',date,note:'Edit'},{role}),/เจ้าของ/);
  assert.throws(()=>h.run('entry',{type:'income',allowNegative:true,accountId:h.account.id,amount:'100',date,note:'Invalid option'}),/เมนูยอดยกมา/);assert.throws(()=>h.run('entry',{type:'opening_adjustment',accountId:h.account.id,amount:'1',date,note:'Direct'}),/ประเภท/);
});

test('negative-enabled accounts permit reversal below zero while default accounts keep the existing guard',()=>{
  const h=fixture('0',true),income=h.run('entry',{type:'income',accountId:h.account.id,amount:'100',date,note:'Income'});h.run('entry',{type:'expense',accountId:h.account.id,amount:'150',date,note:'Expense'});h.run('reverse',{id:income.id,date,note:'Correction'});assert.equal(summary(h.s).accounts[0].balance,-15000);
  const normal=fixture('0'),inc=normal.run('entry',{type:'income',accountId:normal.account.id,amount:'100',date,note:'Income'});normal.run('entry',{type:'expense',accountId:normal.account.id,amount:'100',date,note:'Expense'});assert.throws(()=>normal.run('reverse',{id:inc.id,date,note:'Correction'}),/ติดลบ/);
});

test('backup validation detects broken opening history and accepts legacy openings',()=>{
  const h=fixture();h.correct('500',{allowNegative:true});validateOpeningAdjustments(h.s);
  for(const modify of [s=>s.entries[1].openingBefore++,s=>s.entries[1].cash++,s=>s.entries[1].openingId='missing',s=>s.accounts[0].openingRevision++,s=>s.accounts[0].allowNegative='true']){const copy=structuredClone(h.s);modify(copy);assert.throws(()=>validateOpeningAdjustments(copy));}
  const legacy=fixture();delete legacy.s.accounts[0].allowNegative;delete legacy.s.accounts[0].openingRevision;validateOpeningAdjustments(legacy.s);
});

test('negative historical opening can remain while the owner disables future overdrafts after cash recovers',()=>{
  const h=fixture('-100',true);h.run('entry',{type:'income',accountId:h.account.id,amount:'500',date,note:'Income'});const settings=h.correct('-100',{allowNegative:false});assert.equal(settings.cash,0);assert.equal(h.s.accounts[0].allowNegative,false);assert.equal(summary(h.s).accounts[0].balance,40000);assert.throws(()=>h.run('entry',{type:'expense',accountId:h.account.id,amount:'401',date,note:'Too much'}),/ไม่พอ/);validateOpeningAdjustments(h.s);
});

test('online backup/restore preserves signed opening history and rejects a corrupted difference',async()=>{
  const h=fixture('-100',true);h.correct('-50');const DB=database();DB.raw.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(h.s));const env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test'};
  const call=async(path,data)=>{const r=await worker.fetch(new Request('https://mytech.test'+path,{method:data?'POST':'GET',headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test',origin:'https://mytech.test','Content-Type':'application/json','x-csrf-token':'same-origin'},...(data?{body:JSON.stringify(data)}:{})}),env);return {status:r.status,body:await r.json()};};
  const backup=(await call('/api/backup')).body,broken=structuredClone(backup);broken.state.entries[1].cash++;
  assert.equal((await call('/api/restore',{confirm:'กู้คืนข้อมูล',backup:broken})).status,400);
  assert.equal((await call('/api/restore',{confirm:'กู้คืนข้อมูล',backup})).status,200);const state=(await call('/api/state')).body;assert.equal(openingAmount(state,h.account.id),-5000);assert.equal(state.summary.accounts[0].balance,-5000);assert.equal(state.accounts[0].allowNegative,true);
});

test('online correction remains idempotent and personal account corrections are owner-only on replay',async()=>{
  const h=fixture('1000',false,'personal'),DB=database();DB.raw.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(h.s));const env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test'};
  const call=async(role,data)=>{const r=await worker.fetch(new Request('https://mytech.test/api/action',{method:'POST',headers:{'oai-authenticated-user-id':role,'oai-authenticated-user-email':role+'@example.test',origin:'https://mytech.test','Content-Type':'application/json','x-csrf-token':'same-origin'},body:JSON.stringify(data)}),env);return {status:r.status,body:await r.json()};};
  const data={action:'entry',requestId:'opening-correct-0001',payload:{type:'opening',accountId:h.account.id,amount:'-50',correctOpening:true,expectedOpeningRevision:1,allowNegative:true,date,note:'Correct negative opening'}};
  assert.equal((await call('owner',data)).status,200);assert.equal((await call('owner',data)).body.duplicate,true);assert.equal((await call('staff',data)).status,403);const state=JSON.parse((await DB.prepare('SELECT json FROM app_state WHERE id=1').first()).json);assert.equal(state.entries.length,2);assert.equal(openingAmount(state,h.account.id),-5000);assert.equal(summary(state).accounts[0].balance,-5000);
});
