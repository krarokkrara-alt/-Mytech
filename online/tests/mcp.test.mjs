import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {database,bucket} from './db.mjs';

function aiHarness(){
  const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,4).toString('base64')},tasks=[];
  async function request(message,{role='owner',method='POST',origin,contentType='application/json'}={}){
    const headers=new Headers({'content-type':contentType});if(role!=='anonymous'){headers.set('oai-authenticated-user-id',role+'-id');headers.set('oai-authenticated-user-email',role+'@example.test');}if(origin)headers.set('origin',origin);
    const r=await worker.fetch(new Request('https://mytech.test/mcp',{method,headers,...(method==='POST'?{body:typeof message==='string'?message:JSON.stringify(message)}:{})}),env,{waitUntil:p=>tasks.push(p)});
    const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};
  }
  const call=async(name,args={},options)=>{const r=await request({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},options);return {...r,result:r.body.result?.structuredContent,error:r.body.result?.isError};};
  let id=0;const save=(action,payload,options,extra={})=>call('mytech_save',{action,payload,requestId:'request-'+(++id).toString().padStart(8,'0'),...extra},options);
  const state=()=>DB.prepare('SELECT json FROM app_state WHERE id=1').first().then(r=>JSON.parse(r.json));
  return {DB,env,request,call,save,state,settle:()=>Promise.all(tasks)};
}

test('MCP discovery, JSON-RPC validation and cross-origin protection do not expose records',async()=>{
  const h=aiHarness();let r=await h.request({jsonrpc:'2.0',id:1,method:'server/discover'},{role:'anonymous'});assert.deepEqual(r.body.result.supportedVersions,['2026-07-28']);
  r=await h.request({jsonrpc:'2.0',id:2,method:'tools/list'},{role:'anonymous'});assert.equal(r.body.result.tools.length,5);assert.ok(!JSON.stringify(r.body).includes('secrets'));
  assert.equal((await h.request('{bad')).body.error.code,-32700);assert.equal((await h.request([])).body.error.code,-32600);assert.equal((await h.request({method:'ping'})).body.error.code,-32600);
  assert.equal((await h.request({jsonrpc:'2.0',id:3,method:'unknown'})).body.error.code,-32601);
  assert.equal((await h.request(null,{method:'GET'})).status,405);assert.equal((await h.request({}, {contentType:'text/plain'})).status,415);
  assert.equal((await h.request({}, {origin:'https://evil.test'})).status,403);
  assert.equal((await h.call('missing')).error,true);assert.equal((await h.call('mytech_list',{collection:'secrets'})).error,true);
  await h.settle();
});

test('MCP writes exact money once, rejects changed intent replay and reports saved IDs',async()=>{
  const h=aiHarness(),account=(await h.save('account',{name:'AI Bank',scope:'business'})).result.result;
  assert.ok(account.id);await h.save('entry',{type:'opening',accountId:account.id,amount:'1000.00',date:'2026-11-10',note:'Opening'});
  const args={action:'entry',payload:{type:'income',accountId:account.id,amount:'123.45',date:'2026-11-10',note:'AI income'},requestId:'stable-ai-intent-0001'};
  const first=await h.call('mytech_save',args),repeat=await h.call('mytech_save',{...args,payload:{...args.payload}});
  assert.equal(first.error,false);assert.equal(first.result.success,true);assert.equal(first.result.result.amount,12345);assert.ok(first.result.result.id);assert.ok(first.result.receipt.id);
  assert.equal(repeat.result.duplicate,true);assert.equal(repeat.result.result.id,first.result.result.id);
  const changed=await h.call('mytech_save',{...args,payload:{...args.payload,amount:'999.00'}});assert.equal(changed.error,true);
  const s=await h.state();assert.equal(s.entries.filter(x=>x.type==='income').length,1);assert.equal(s.receipts.length,1);assert.ok(s.audit.some(x=>x.by.includes('(AI)')));
  assert.equal((await h.save('entry',{...args.payload,amount:123.45})).error,true);assert.equal((await h.save('entry',{...args.payload,accountId:'invented'})).error,true);
  assert.equal((await h.save('entry',{...args.payload,date:'2026-02-30'})).error,true);await h.settle();
});

test('MCP denies anonymous/viewer writes; staff scope and revocation apply before replay',async()=>{
  const h=aiHarness();for(const role of ['anonymous','viewer']){
    const status=(await h.call('mytech_status',{}, {role})).result;assert.equal(status.canWrite,false);assert.deepEqual(status.actions,[]);assert.equal(status.counts,undefined);
    assert.equal((await h.save('customer',{name:'No'}, {role})).error,true);assert.equal((await h.call('mytech_list',{collection:'customers'},{role})).error,true);
  }
  await h.DB.prepare("INSERT INTO members VALUES(?,'staff',?)").bind('staff@example.test','Staff').run();
  const args={action:'customer',payload:{name:'Owner only replay'},requestId:'same-identifier-both-users'};
  const own=await h.call('mytech_save',args),staff=await h.call('mytech_save',{...args,payload:{name:'Staff record'}},{role:'staff'});
  assert.notEqual(own.result.result.id,staff.result.result.id);assert.equal(staff.result.duplicate,undefined);
  assert.equal((await h.save('employee',{code:'E1',name:'Private',baseSalary:'100'} ,{role:'staff'})).error,true);
  assert.equal((await h.call('mytech_action_schema',{action:'payrollSave'},{role:'staff'})).error,true);
  const status=(await h.call('mytech_status',{}, {role:'staff'})).result;assert.ok(!status.actions.some(x=>x.action==='payrollSave'));
  await h.save('employee',{code:'E1',name:'Secret employee',baseSalary:'100',bank:'Secret bank'});
  await h.save('account',{name:'Private account',scope:'personal'});
  assert.equal((await h.call('mytech_list',{collection:'employees'},{role:'staff'})).error,true);
  assert.ok(!JSON.stringify((await h.call('mytech_list',{collection:'accounts'},{role:'staff'})).result).includes('Private account'));
  await h.DB.prepare('DELETE FROM members WHERE email=?').bind('staff@example.test').run();assert.equal((await h.call('mytech_save',args,{role:'staff'})).error,true);
  await h.settle();
});

test('MCP issues documents and editable payroll drafts through the same model and persists them',async()=>{
  const h=aiHarness(),customer=(await h.save('customer',{name:'Customer'})).result.result;
  const doc=(await h.save('document',{kind:'invoice',customerId:customer.id,date:'2026-11-10',items:[{description:'Service',quantity:'2',price:'100.25'}]})).result.result;assert.equal(doc.total,20050);
  assert.equal((await h.save('document',{kind:'quote',customerId:customer.id,date:'2026-02-01',due:'2026-02-30',items:[{description:'Invalid due',quantity:'1',price:'1'}]})).error,true);
  assert.equal((await h.save('debt',{name:'Debt',amount:'1',scope:'business',due:'2026-02-30',note:'Invalid due'})).error,true);
  const employee=(await h.save('employee',{code:'E001',name:'Employee',baseSalary:'15000.29'})).result.result;
  const payroll=(await h.save('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'15000.29',earnings:[{label:'OT',amount:'1000.11'}],deductions:[{label:'Deduct',amount:'750.25'}]})).result.result;
  assert.equal(payroll.net,1525015);assert.equal(payroll.status,'draft');assert.equal((await h.state()).entries.length,0);
  const read=(await h.call('mytech_list',{collection:'payroll',query:employee.name,limit:1})).result;assert.equal(read.records[0].id,payroll.id);
  const schema=(await h.call('mytech_action_schema',{action:'entry'})).result;assert.equal(schema.moneyInput,'BAHT decimal strings');assert.ok(schema.payloadSchema.required.includes('date'));
  const bad=await h.call('mytech_save',{action:'company',requestId:'not-permitted-action',payload:{name:'Bad'}});assert.equal(bad.error,true);
  await h.settle();
});
