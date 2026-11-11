import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../lib/accounting/online.mjs';

function setup(){
  const sql=new DatabaseSync(':memory:');
  for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')))sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
  const db={prepare(query){let args=[];const st=sql.prepare(query);return {bind(...v){args=v;return this;},async first(){return st.get(...args)||null;},async all(){return {results:st.all(...args)};},async run(){return {meta:{changes:st.run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const st of statements)result.push(await st.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const env={DB:db,MYTECH_OWNER_EMAIL:'owner@example.test'};
  const identity=email=>({userId:email,email,displayName:email});
  const call=async(path,{email,body,origin='https://mytech.test',method=body?'POST':'GET'}={})=>{
    const request=new Request('https://mytech.test/api/'+path,{method,headers:body?{'Content-Type':'application/json',origin}:{},body:body?JSON.stringify(body):undefined});
    const r=await handleApi(request,env,email?identity(email):null);return {status:r.status,body:await r.json()};
  };
  return {db,env,sql,call};
}
test('anonymous and unapproved accounts cannot mutate, including setup and grant endpoints',async()=>{
  const {call,sql}=setup();
  for(const path of ['action','setup','user','attachment','restore','trello/config','editors']){
    assert.equal((await call(path,{body:{}})).status,401,path);
    assert.equal((await call(path,{email:'stranger@example.test',body:{}})).status,403,path);
  }
  assert.equal(sql.prepare('SELECT count(*) n FROM accounting_state').get().n,0);
});
test('owner is configured out of source; first signed-in visitor cannot claim ownership',async()=>{
  const {call,env}=setup();delete env.MYTECH_OWNER_EMAIL;
  assert.equal((await call('session',{email:'first@example.test'})).body.user.role,'viewer');
  assert.equal((await call('editors',{email:'first@example.test',body:{email:'first@example.test',operation:'grant'}})).status,403);
});
test('owner grant and revocation apply on every request; staff cannot grant or backup',async()=>{
  const {call}=setup(),owner='OWNER@example.test',email='editor@example.test';
  assert.equal((await call('editors',{email:owner,body:{email,operation:'grant'}})).status,200);
  assert.equal((await call('session',{email})).body.user.role,'staff');
  assert.equal((await call('editors',{email,body:{email:'other@example.test',operation:'grant'}})).status,403);
  assert.equal((await call('backup',{email})).status,403);
  const action={action:'customer',payload:{name:'ลูกค้าทดสอบ'},requestId:'editor-request'};
  assert.equal((await call('action',{email,body:action})).status,200);
  assert.equal((await call('editors',{email:owner,body:{email,operation:'revoke'}})).status,200);
  assert.equal((await call('action',{email,body:{...action,requestId:'after-revoke'}})).status,403);
});
test('write requests reject foreign origins and unsupported methods',async()=>{
  const {call}=setup();
  assert.equal((await call('action',{email:'owner@example.test',body:{},origin:'https://evil.test'})).status,403);
  assert.equal((await call('action',{email:'owner@example.test',body:{},method:'PUT'})).status,405);
});
test('retained backup imports exactly once with 9 pending items, no confirmed revenue',async()=>{
  const {call}=setup();
  const owner='owner@example.test';
  const state=(await call('state',{email:owner})).body;
  assert.equal(state.pending.length,9);assert.equal(state.entries.length,0);
  assert.equal((await call('state',{email:owner})).body.pending.length,9);
  const pub=(await call('state')).body;
  assert.equal(pub.pending.length,0);assert.equal(pub.audit.length,0);assert.equal(pub.customers.length,0);
});
test('idempotent retries do not duplicate records and concurrent writes cannot lose a record',async()=>{
  const {call}=setup(),email='owner@example.test';
  const body={action:'customer',payload:{name:'หนึ่ง'},requestId:'once'};
  assert.equal((await call('action',{email,body})).status,200);
  assert.equal((await call('action',{email,body})).body.duplicate,true);
  const result=await Promise.all(['two','three'].map(requestId=>call('action',{email,body:{...body,requestId}})));
  assert.deepEqual(result.map(x=>x.status).sort(),[200,409]);
  assert.equal((await call('state',{email})).body.customers.length,2);
});
test('public read omits personal data, customer contacts, attachments, document snapshots and audit',async()=>{
  const {call}=setup(),email='owner@example.test';
  await call('action',{email,body:{action:'customer',payload:{name:'Private name',phone:'0811111111'},requestId:'c'}});
  await call('action',{email,body:{action:'account',payload:{name:'Private bank',scope:'personal'},requestId:'a'}});
  const pub=(await call('state')).body;
  assert.equal(pub.accounts.length,0);assert.equal(pub.customers.length,0);
  assert(!JSON.stringify(pub).includes('0811111111'));assert(!JSON.stringify(pub).includes('Private bank'));
  assert.equal((await call('document?id=unknown')).status,403);
  assert.equal((await call('file/unknown')).status,403);
});
test('restore creates a snapshot and does not change editor grants',async()=>{
  const {call,sql}=setup(),email='owner@example.test';
  await call('editors',{email,body:{email:'editor@example.test',operation:'grant'}});
  const backup=(await call('backup',{email})).body;
  const result=await call('restore',{email,body:{confirm:'กู้คืนข้อมูล',backup}});
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(sql.prepare('SELECT count(*) n FROM accounting_snapshots').get().n,1);
  assert.equal((await call('editors',{email})).body.editors.length,1);
});
