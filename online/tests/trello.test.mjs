import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {initial,mutate,summary} from '../my-tech-accounting/model.mjs';
import {database,bucket} from './db.mjs';
import {syncFlush,syncAcquireLock,syncReleaseLock} from '../worker/trello-sync.mjs';

const boardId='a'.repeat(24),listId='b'.repeat(24),user={id:'owner-id',name:'Owner',role:'owner'};
function trelloHarness(){
  const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,7).toString('base64')};let state=initial();state.trello={...state.trello,boardId,boardName:'MY TECH test',lists:[{id:listId,name:'บัญชี'}],cards:[],boards:[{id:boardId,name:'MY TECH test'}]};
  const account=mutate(state,'account',{name:'Bank',scope:'business'},user);state=account.state;state=mutate(state,'entry',{type:'opening',accountId:account.result.id,amount:'100000',date:'2026-11-08',note:'Opening'},user).state;
  DB.raw.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(state));let counter=0;
  const call=async(path,{role='owner',method='GET',data}={})=>{const headers={'oai-authenticated-user-id':role+'-id','oai-authenticated-user-email':role+'@example.test'};if(method==='POST')Object.assign(headers,{'Origin':'https://mytech.test','Content-Type':'application/json','X-CSRF-Token':'same-origin'});const r=await worker.fetch(new Request('https://mytech.test'+path,{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body};};
  return {DB,env,accountId:account.result.id,call,async action(action,payload,trello,role='owner',requestId='action-request-'+(++counter)){return call('/api/action',{role,method:'POST',data:{action,payload,trello,requestId}});},post:(path,data,role='owner')=>call(path,{method:'POST',data,role})};
}
function remoteTrello(){const cards=[],comments=[],files=[];let timeout=null,attempts=0,wrongList=false;return {cards,comments,files,set timeout(value){timeout=value;},set wrongList(value){wrongList=value;},get attempts(){return attempts;},async api(method,path,params={}){
  if(method==='GET'&&path===`boards/${boardId}/cards`)return cards;
  if(method==='GET'&&path===`lists/${listId}`)return {id:listId,idBoard:wrongList?'c'.repeat(24):boardId,closed:false};
  if(method==='POST'&&path==='cards'){attempts++;const card={id:(cards.length+1).toString(16).padStart(24,'0'),idBoard:boardId,idList:params.idList,name:params.name,desc:params.desc,url:'https://trello.com/c/test'+cards.length,closed:false};cards.push(card);if(timeout==='card'){timeout=null;throw Error('connection lost after card accepted');}return card;}
  const match=path.match(/^cards\/([^/]+)(?:\/(.*))?$/);if(match){const card=cards.find(c=>c.id===match[1]);assert.ok(card,'unknown remote card');const tail=match[2];
    if(method==='GET'&&!tail)return card;
    if(method==='GET'&&tail==='actions')return comments.filter(c=>c.cardId===card.id);
    if(method==='POST'&&tail==='actions/comments'){const result={id:'comment-'+comments.length,cardId:card.id,data:{text:params.text}};comments.push(result);if(timeout==='comment'){timeout=null;throw Error('connection lost after comment accepted');}return result;}
    if(method==='GET'&&tail==='attachments')return files.filter(f=>f.cardId===card.id);
    if(method==='POST'&&tail==='attachments'){assert.ok(params instanceof FormData);const blob=params.get('file'),result={id:'file-'+files.length,cardId:card.id,name:params.get('name'),mime:params.get('mimeType'),bytes:new Uint8Array(await blob.arrayBuffer())};files.push(result);if(timeout==='file'){timeout=null;throw Error('connection lost after upload accepted');}return result;}
  }
  throw Error('Unexpected mock request '+method+' '+path);
}};}
const newTarget={enabled:true,boardId,listId,cardId:''};
async function drain(h,remote,max=20){for(let i=0;i<max;i++)if(!await syncFlush(h.env,remote.api.bind(remote)))break;}

test('income atomically creates a receipt and queues both to the selected card without counting money twice',async()=>{
  const h=trelloHarness(),remote=remoteTrello(),payload={type:'income',accountId:h.accountId,amount:'1234.56',date:'2026-11-08',note:'มัดจำคอร์ส รายละเอียดจากโปรแกรม',receiptName:'ลูกค้าทดสอบ'};
  const result=await h.action('entry',payload,newTarget,'owner','same-income-request');assert.equal(result.status,200);assert.equal(result.body.jobs.length,2);assert.equal(result.body.receipt.amount,123456);
  const replay=await h.action('entry',payload,newTarget,'owner','same-income-request');assert.equal(replay.body.duplicate,true);assert.equal(replay.body.result.id,result.body.result.id);assert.equal(replay.body.receipt.id,result.body.receipt.id);
  assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,2);
  await drain(h,remote);assert.equal(remote.cards.length,1);assert.equal(remote.comments.length,2);assert.equal(remote.files.length,1);assert.ok(remote.comments.some(c=>c.data.text.includes(payload.note)));assert.ok(remote.files[0].name.endsWith('.html'));
  const state=(await h.call('/api/state')).body;assert.equal(state.summary.income,123456);assert.equal(state.receipts.length,1);assert.equal(state.syncJobs.filter(j=>j.status==='done').length,2);
  const html=await h.call('/api/receipt?id='+state.receipts[0].id);assert.equal(html.status,200);assert.ok(html.body.includes('ลูกค้าทดสอบ'));
});
test('new card then file upload uses the trusted route without refresh, and attachment request IDs prevent duplicate uploads',async()=>{
  const h=trelloHarness(),remote=remoteTrello(),customer=(await h.action('customer',{name:'Customer',note:'ข้อมูลลูกค้า'},newTarget)).body.result;await drain(h,remote);assert.equal(remote.cards.length,1);
  const upload={recordId:customer.id,name:'สลิป.txt',mime:'text/plain',base64:Buffer.from('proof').toString('base64'),requestId:'one-proof-request'};
  let r=await h.post('/api/attachment',upload);assert.equal(r.status,200,JSON.stringify(r.body));r=await h.post('/api/attachment',upload);assert.equal(r.body.duplicate,true);
  await drain(h,remote);assert.equal(remote.cards.length,1);assert.equal(remote.files.length,1);assert.equal(new TextDecoder().decode(remote.files[0].bytes),'proof');assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,1);
});
test('uncertain card, comment and file writes reconcile markers before retry, without duplicate remote effects',async()=>{
  for(const phase of ['card','comment','file']){
    const h=trelloHarness(),remote=remoteTrello();remote.timeout=phase;
    const customer=(await h.action('customer',{name:'Customer'},newTarget)).body.result;
    if(phase==='file'){await drain(h,remote);await h.post('/api/attachment',{recordId:customer.id,name:'proof.txt',mime:'text/plain',base64:'QUJD',requestId:'upload-proof'});}
    await drain(h,remote);const job=h.DB.raw.prepare("SELECT * FROM trello_jobs WHERE status='uncertain'").get();assert.ok(job,phase);
    assert.equal((await h.post('/api/trello/retry',{id:job.id})).status,200);await drain(h,remote);
    assert.equal(remote.cards.length,1);assert.equal(h.DB.raw.prepare('SELECT status FROM trello_jobs WHERE id=?').get(job.id).status,'done');assert.equal(remote.comments.length,phase==='file'?2:1);if(phase==='file')assert.equal(remote.files.length,1);
  }
});
test('a moved list is rejected before creating a card and failed accounting CAS does not enqueue tasks',async()=>{
  const h=trelloHarness(),remote=remoteTrello();remote.wrongList=true;await h.action('customer',{name:'Customer'},newTarget);await drain(h,remote);assert.equal(remote.cards.length,0);
  const count=h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,original=h.DB.batch.bind(h.DB);h.DB.batch=async statements=>{h.DB.raw.exec('UPDATE app_state SET revision=revision+1');return original(statements);};
  assert.equal((await h.action('customer',{name:'Conflicting'},newTarget)).status,409);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,count);
});
test('private receipts and queued metadata are owner-only; staff cannot select an arbitrary board',async()=>{
  const h=trelloHarness();await h.post('/api/members',{name:'Staff',email:'staff@example.test'});
  const personal=(await h.action('account',{name:'Personal',scope:'personal'})).body.result;
  const r=await h.action('entry',{type:'income',accountId:personal.id,amount:'100',date:'2026-11-08',note:'Private income'},newTarget);assert.equal(r.status,200);
  const viewer=(await h.call('/api/state',{role:'viewer'})).body;assert.equal(viewer.receipts.length,0);assert.equal(viewer.syncJobs.length,0);
  assert.equal((await h.call('/api/receipt?id='+r.body.receipt.id,{role:'staff'})).status,400);assert.equal((await h.call('/api/trello/jobs',{role:'staff'})).body.jobs.length,0);
  assert.equal((await h.action('customer',{name:'Other board'},{...newTarget,boardId:'c'.repeat(24)},'staff')).status,400);
  assert.equal((await h.post('/api/trello/send',{kind:'entry',recordId:r.body.result.id,trello:newTarget,requestId:'private-send-attempt'},'staff')).status,403);
});
test('restore takes the sender lock and cancels stale tasks atomically',async()=>{
  const h=trelloHarness();await h.action('customer',{name:'Before restore'},newTarget);const backup=(await h.call('/api/backup')).body;
  const lock=await syncAcquireLock(h.env);assert.ok(lock);assert.equal((await h.post('/api/restore',{confirm:'กู้คืนข้อมูล',backup})).status,409);await syncReleaseLock(h.env,lock);
  assert.equal((await h.post('/api/restore',{confirm:'กู้คืนข้อมูล',backup})).status,200);assert.equal(h.DB.raw.prepare('SELECT status FROM trello_jobs').get().status,'cancelled');assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_routes').get().n,0);
});
test('explicit opt-out is respected for both records and proofs when business auto-sync is enabled',async()=>{
  const h=trelloHarness();assert.equal((await h.post('/api/trello/auto',newTarget)).status,200);
  const entry=(await h.action('entry',{type:'income',accountId:h.accountId,amount:'10',date:'2026-11-08',note:'Do not send'},{enabled:false})).body.result;
  assert.equal((await h.post('/api/attachment',{recordId:entry.id,name:'private.txt',mime:'text/plain',base64:'QUJD',trello:{enabled:false}})).status,200);
  assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,0);
});
test('restore rejects receipts with missing dates and private action replays remain owner-only',async()=>{
  const h=trelloHarness(),personal=(await h.action('account',{name:'Personal',scope:'personal'})).body.result;
  const r=await h.action('entry',{type:'income',accountId:personal.id,amount:'5',date:'2026-11-08',note:'Private'},undefined,'owner','private-replay-key');
  await h.post('/api/members',{email:'staff@example.test',name:'Staff'});assert.equal((await h.action('entry',{},undefined,'staff','private-replay-key')).status,403);
  const backup=(await h.call('/api/backup')).body;delete backup.state.receipts[0].date;
  assert.equal((await h.post('/api/restore',{confirm:'กู้คืนข้อมูล',backup})).status,400);assert.equal((await h.call('/api/state')).body.receipts[0].id,r.body.receipt.id);
});
test('invoice, quote and automatic receipt export standalone Thai document files; reversal updates linked receipt and invoice',async()=>{
  const h=trelloHarness(),remote=remoteTrello(),customer=(await h.action('customer',{name:'Customer'})).body.result;
  const payload={customerId:customer.id,date:'2026-11-08',items:[{description:'บริการภาษาไทย',quantity:'1',price:'1000'}],discount:'0',note:'รายละเอียดเอกสาร'};
  const quote=(await h.action('document',{...payload,kind:'quote'},newTarget)).body.result;
  const invoice=(await h.action('document',{...payload,kind:'invoice',sourceQuoteId:quote.id},newTarget)).body.result;
  const income=(await h.action('entry',{type:'income',accountId:h.accountId,amount:'200',date:'2026-11-08',note:'งวดที่ 1',invoiceId:invoice.id},newTarget)).body.result;await drain(h,remote);
  assert.ok(remote.files.some(f=>f.name.includes('QT-')));assert.ok(remote.files.some(f=>f.name.includes('INV-')));assert.ok(remote.files.some(f=>f.name.includes('RC-')));
  const documentFile=remote.files.find(f=>f.name.includes('QT-'));assert.ok(new TextDecoder().decode(documentFile.bytes).includes('<style>'));assert.ok(!new TextDecoder().decode(documentFile.bytes).includes('src="/document.js"'));
  await h.action('reverse',{id:income.id,date:'2026-11-08',note:'ยกเลิกรับงวดนี้'});await drain(h,remote);
  const state=(await h.call('/api/state')).body;assert.equal(state.summary.income,0);assert.equal(state.receipts[0].status,'cancelled');assert.ok(remote.comments.some(c=>c.data.text.includes('ยกเลิก/กลับรายการแล้ว')));
});
test('salary and its reversal remain app-only even when an explicit Trello target is supplied',async()=>{
  const h=trelloHarness(),remote=remoteTrello();await h.post('/api/trello/auto',newTarget);
  const employee=(await h.action('employee',{code:'P1',name:'Private person',baseSalary:'200'})).body.result;
  const salary=(await h.action('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'200'},newTarget)).body.result;
  const paid=(await h.action('payrollPay',{id:salary.id,accountId:h.accountId,date:'2026-11-08'})).body.result;await drain(h,remote);
  await h.action('reverse',{id:paid.paymentEntryId,date:'2026-11-08',note:'Reverse payroll'});await drain(h,remote);
  const jobs=h.DB.raw.prepare('SELECT kind,scope,snapshot FROM trello_jobs').all();assert.equal(jobs.length,0);assert.equal(remote.comments.length,0);assert.equal(remote.cards.length,0);assert.equal(remote.files.length,0);
});
test('entry opt-out also suppresses related invoice and automatic receipt updates',async()=>{
  const h=trelloHarness(),customer=(await h.action('customer',{name:'A'})).body.result,invoice=(await h.action('document',{customerId:customer.id,date:'2026-11-08',kind:'invoice',items:[{description:'A',quantity:'1',price:'500'}]},newTarget)).body.result;
  const before=h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n;await h.post('/api/trello/auto',newTarget);
  const r=await h.action('entry',{type:'income',accountId:h.accountId,date:'2026-11-08',amount:'100',note:'No Trello for this event',invoiceId:invoice.id},{enabled:false});assert.equal(r.status,200);assert.equal(h.DB.raw.prepare('SELECT COUNT(*) AS n FROM trello_jobs').get().n,before);
});
test('selected Trello document exports include the issued signature without modifying stored company metadata',async()=>{
  const h=trelloHarness(),remote=remoteTrello(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  assert.equal((await h.post('/api/company/signature',{name:'Signer',title:'Director',image:{mime:'image/png',base64:png}})).status,200);
  const customer=(await h.action('customer',{name:'A'})).body.result;await h.action('document',{kind:'quote',customerId:customer.id,date:'2026-11-08',items:[{description:'A',quantity:'1',price:'100'}]},newTarget);await drain(h,remote);
  assert.ok(remote.files.some(f=>new TextDecoder().decode(f.bytes).includes('data:image/png;base64,'+png)));assert.ok(!JSON.stringify((await h.call('/api/state')).body.company).includes(png));
});

test('supplier bill exports its signed internal record and payments, while personal bills stay owner-only',async()=>{
  const h=trelloHarness(),remote=remoteTrello(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  assert.equal((await h.post('/api/company/signature',{name:'Bill approver',title:'Director',image:{mime:'image/png',base64:png}})).status,200);
  await h.post('/api/members',{name:'Staff',email:'staff@example.test'});
  const created=await h.action('billSave',{vendor:'Supplier test',invoiceNo:'SUP-100',category:'Materials',amount:'1000',date:'2026-11-08',scope:'business',note:'Supplier bill details'},newTarget);assert.equal(created.status,200,JSON.stringify(created.body));const bill=created.body.result;
  await drain(h,remote);assert.equal(remote.cards.length,1);const document=remote.files.find(f=>f.name.endsWith(bill.number+'.html'));assert.ok(document);const html=new TextDecoder().decode(document.bytes);assert.match(html,/บันทึกภายใน/);assert.match(html,/data:image\/png;base64,/);assert.match(html,/Bill approver/);assert.match(html,/<style>/);assert.doesNotMatch(html,/src="\/document.js"/);
  const paid=await h.action('billPay',{id:bill.id,accountId:h.accountId,amount:'250',date:'2026-11-08'},newTarget);assert.equal(paid.status,200,JSON.stringify(paid.body));assert.equal(paid.body.result.billId,bill.id);await drain(h,remote);assert.ok(remote.comments.some(c=>c.data.text.includes('บิลค่าใช้จ่าย: '+bill.number)));assert.equal((await h.call('/api/state')).body.summary.expense,25000);
  const personal=(await h.action('billSave',{vendor:'Personal supplier',amount:'10',date:'2026-11-08',scope:'personal'},newTarget)).body.result;
  assert.equal((await h.post('/api/trello/send',{kind:'bill',recordId:personal.id,trello:newTarget,requestId:'private-bill-send'},'staff')).status,403);
  assert.equal((await h.call('/api/bill?id='+personal.id,{role:'staff'})).status,403);
  const staffState=(await h.call('/api/state',{role:'staff'})).body;assert.ok(!staffState.bills.some(b=>b.id===personal.id));assert.ok(!staffState.syncJobs.some(j=>j.recordId===personal.id));
});
