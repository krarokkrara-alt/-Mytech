import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {database,bucket} from './db.mjs';
import {downloadMcpFile} from '../worker/mcp-files.mjs';
import {syncFlush} from '../worker/trello-sync.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'),boardId='a'.repeat(24),listId='b'.repeat(24),target={enabled:true,boardId,listId};
function filesHarness(){const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,6).toString('base64')};let count=0;
  async function api(path,{role='owner',data}={}){const headers={'oai-authenticated-user-id':role+'-id','oai-authenticated-user-email':role+'@example.test'};if(data)Object.assign(headers,{Origin:'https://mytech.test','Content-Type':'application/json','X-CSRF-Token':'same-origin'});const r=await worker.fetch(new Request('https://mytech.test'+path,{headers,method:data?'POST':'GET',...(data?{body:JSON.stringify(data)}:{})}),env);return {status:r.status,body:await r.json()};}
  async function tool(name,args,role='owner'){const r=await api('/mcp',{role,data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});return {error:r.body.result?.isError,result:r.body.result?.structuredContent,raw:r.body};}
  const save=(action,payload,extra={},role='owner')=>tool('mytech_save',{action,payload,requestId:'files-action-'+(++count),...extra},role);
  async function catalog(){await api('/api/state');const row=await DB.prepare('SELECT json FROM app_state WHERE id=1').first(),s=JSON.parse(row.json);Object.assign(s.trello,{boardId,boardName:'Test board',boards:[{id:boardId,name:'Test board'}],lists:[{id:listId,name:'Business'}],cards:[]});await DB.prepare('UPDATE app_state SET json=? WHERE id=1').bind(JSON.stringify(s)).run();}
  return {DB,env,api,tool,save,catalog};}
const chatFile=(id,query='one')=>({file_id:'file_'+id,file_name:id+'.png',mime_type:'image/png',download_url:'https://files.oaiusercontent.com/'+id+'?token='+query});

test('MCP fileParams descriptors declare the complete host file schema',async()=>{
  const h=filesHarness(),r=await h.api('/mcp',{data:{jsonrpc:'2.0',id:1,method:'tools/list'}});
  for(const name of ['mytech_save','mytech_attach_files']){const tool=r.body.result.tools.find(t=>t.name===name);assert.deepEqual(tool._meta['openai/fileParams'],['files']);const schema=tool.inputSchema.properties.files.items;assert.deepEqual(schema.required,['download_url','file_id']);for(const p of ['download_url','file_id','mime_type','file_name'])assert.equal(schema.properties[p].type,'string');}
});

test('chat images attach after income; expired-file retries preserve record and already imported images',async()=>{
  const h=filesHarness(),account=(await h.save('account',{name:'Cash',scope:'business'})).result.result,args={action:'entry',requestId:'income-with-two-images',payload:{type:'income',accountId:account.id,amount:'123.45',date:'2026-11-10',note:'Payment'},files:[chatFile('one'),chatFile('two')]};
  const original=globalThis.fetch,requests=[];let fail=true;globalThis.fetch=async url=>{requests.push(String(url));return String(url).includes('/two?')&&fail?new Response('expired',{status:403}):new Response(png,{headers:{'content-type':'image/png'}});};
  try{const first=await h.tool('mytech_save',args);assert.equal(first.error,false);assert.equal(first.result.success,true);assert.equal(first.result.attachments.complete,false);assert.equal(first.result.attachments.results[0].status,'saved');assert.equal(first.result.attachments.results[1].status,'failed');assert.ok(first.result.notice);assert.ok(!JSON.stringify(first.result).includes('token='));
    fail=false;const replay=await h.tool('mytech_save',{...args,files:args.files.map(f=>({...f,download_url:f.download_url.replace('one','refreshed')}))});assert.equal(replay.result.duplicate,true);assert.equal(replay.result.result.id,first.result.result.id);assert.equal(replay.result.attachments.complete,true);assert.equal(replay.result.attachments.results[0].duplicate,true);assert.equal(requests.filter(u=>u.includes('/one?')).length,1);
    assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,2);const state=(await h.api('/api/state')).body;assert.equal(state.entries.filter(e=>e.type==='income').length,1);assert.equal(state.receipts.length,1);assert.equal(state.summary.income,12345);
  }finally{globalThis.fetch=original;}
});

test('payroll proof filed under a business record remains owner-only, app-only, and survives restore',async()=>{
  const h=filesHarness();await h.catalog();const customer=(await h.save('customer',{name:'Customer'})).result.result;await h.api('/api/trello/auto',{data:target});
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(png,{headers:{'content-type':'image/png'}});
  try{const r=await h.tool('mytech_attach_files',{recordId:customer.id,requestId:'private-payroll-proof',files:[chatFile('salary')],payrollOnly:true,trello:target});assert.equal(r.result.complete,true);const id=r.result.results[0].id;assert.ok(id);assert.equal(r.result.results[0].payrollOnly,true);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,0);
    await h.api('/api/members',{data:{email:'staff@example.test',name:'Staff'}});assert.equal((await h.api('/api/file/'+id,{role:'staff'})).status,403);assert.equal((await h.tool('mytech_list',{collection:'attachments'},'staff')).result.total,0);
    const backup=(await h.api('/api/backup')).body;assert.equal(backup.attachments[0].payrollOnly,true);assert.equal((await h.api('/api/restore',{data:{confirm:'กู้คืนข้อมูล',backup}})).status,200);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM payroll_private_attachments').get().n,1);
    const restored=(await h.api('/api/state')).body.attachmentList[0].id;assert.equal((await h.api('/api/file/'+restored,{role:'staff'})).status,403);
    const state=(await h.api('/api/state')).body;const job={id:'old-private-file-job',kind:'customer',record_id:customer.id,record_key:'customer:'+customer.id,scope:'business',target:JSON.stringify(target),snapshot:JSON.stringify({attachmentId:restored,text:'Payroll evidence'})};h.DB.raw.prepare('INSERT INTO trello_jobs(id,kind,record_id,record_key,scope,target,snapshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,\'uncertain\',0,0)').run(job.id,job.kind,job.record_id,job.record_key,job.scope,job.target,job.snapshot);
    let remoteCalls=0;await syncFlush(h.env,async()=>{remoteCalls++;throw Error('No export allowed');});assert.equal(remoteCalls,0);assert.equal(h.DB.raw.prepare('SELECT status FROM trello_jobs WHERE id=?').get(job.id).status,'cancelled');assert.ok(state.customers.some(c=>c.id===customer.id));
  }finally{globalThis.fetch=original;}
});

test('payroll save, payment, reversal and their evidence never export, including stale queued jobs',async()=>{
  const h=filesHarness();await h.catalog();const account=(await h.save('account',{name:'Bank',scope:'business'})).result.result;await h.save('entry',{type:'opening',accountId:account.id,amount:'1000',date:'2026-11-10',note:'Opening'});await h.api('/api/trello/auto',{data:target});
  const employee=(await h.save('employee',{code:'E1',name:'Employee',baseSalary:'100'}, {trello:target})).result.result;
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(png,{headers:{'content-type':'image/png'}});
  try{const slip=(await h.save('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'100',earnings:[],deductions:[]},{files:[chatFile('slip')],trello:target})).result.result;
    const paid=(await h.save('payrollPay',{id:slip.id,accountId:account.id,date:'2026-11-10'},{trello:target})).result.result;
    const reversed=(await h.save('reverse',{id:paid.paymentEntryId,date:'2026-11-10',note:'Correct salary'},{files:[chatFile('reversal-proof')],trello:target})).result.result;
    assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,2);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,0);
    assert.equal((await h.api('/api/trello/send',{data:{kind:'payroll',recordId:slip.id,requestId:'manual-salary-send',trello:target}})).status,403);
    for(const [i,status]of ['pending','error','working','uncertain'].entries())h.DB.raw.prepare('INSERT INTO trello_jobs(id,kind,record_id,record_key,scope,target,snapshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,0)').run('old-salary-'+i,i%2?'entry':'payroll',i%2?reversed.id:slip.id,'salary-'+i,'private',JSON.stringify(target),'{}',status);
    assert.equal((await h.api('/api/trello/retry',{data:{id:'old-salary-3'}})).status,403);let requests=0;await syncFlush(h.env,async()=>{requests++;});assert.equal(requests,0);assert.equal(h.DB.raw.prepare("SELECT COUNT(*) AS n FROM trello_jobs WHERE status!='cancelled'").get().n,0);
  }finally{globalThis.fetch=original;}
});

test('file imports reject unsafe destinations, cross-host redirects, invalid images, empty and oversized files',async()=>{
  const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});};
  try{for(const url of ['http://files.oaiusercontent.com/a','https://localhost/a','https://files.oaiusercontent.com.evil.test/a','https://user:secret@files.oaiusercontent.com/a'])await assert.rejects(()=>downloadMcpFile({...chatFile('x'),download_url:url}));assert.equal(requests,0);await assert.rejects(()=>downloadMcpFile(chatFile('x')));assert.equal(requests,1);
    globalThis.fetch=async()=>new Response('not image',{headers:{'content-type':'image/png'}});await assert.rejects(()=>downloadMcpFile(chatFile('x')),/PNG/);
    globalThis.fetch=async()=>new Response(new Uint8Array());await assert.rejects(()=>downloadMcpFile(chatFile('x')),/ว่าง/);
    globalThis.fetch=async()=>new Response(png,{headers:{'content-length':'10485761'}});await assert.rejects(()=>downloadMcpFile(chatFile('x')),/10 MB/);
  }finally{globalThis.fetch=original;}
});

test('cross-tool reuse cannot falsely relabel an existing public attachment as payroll-private',async()=>{
  const h=filesHarness(),file=chatFile('same-file'),original=globalThis.fetch;globalThis.fetch=async()=>new Response(png,{headers:{'content-type':'image/png'}});
  try{const saved=await h.save('customer',{name:'Customer'},{requestId:'cross-tool-request-123',files:[file]});assert.equal(saved.result.attachments.complete,true);assert.equal(saved.result.attachments.results[0].payrollOnly,false);
    const changed=await h.tool('mytech_attach_files',{recordId:saved.result.result.id,requestId:'cross-tool-request-123',files:[file],payrollOnly:true});assert.equal(changed.error,true);assert.ok(JSON.stringify(changed.raw).includes('requestId'));
  }finally{globalThis.fetch=original;}
});

test('website file request replay cannot silently upgrade a public file privacy label',async()=>{
  const h=filesHarness(),customer=(await h.save('customer',{name:'Customer'})).result.result,payload={recordId:customer.id,requestId:'website-proof-request',name:'proof.png',mime:'image/png',base64:png.toString('base64'),payrollOnly:false};
  assert.equal((await h.api('/api/attachment',{data:payload})).status,200);const changed=await h.api('/api/attachment',{data:{...payload,payrollOnly:true}});assert.equal(changed.status,400);assert.ok(changed.body.error.includes('คำขอเดิม'));
});
