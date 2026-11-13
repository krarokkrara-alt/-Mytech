import {initial,mutate,summary,active,uid,assert,validateOpeningAdjustments} from '../my-tech-accounting/model.mjs';
import {documentHtml} from '../my-tech-accounting/documents.mjs';
import {payrollInitial,payrollMutate,payslipHtml,validatePayroll} from './payroll.mjs';
import {assets,seedState} from './generated.mjs';
import {receiptsInitial,issueReceipt,receiptHtml} from './receipts.mjs';
import {syncCollections,syncRecord,syncScope,syncAssertAccess,syncActionKind,syncPrepare,syncProgramOnly,syncJobProgramOnly,syncVisible,syncValidateTarget,syncFlush,syncAcquireLock,syncReleaseLock} from './trello-sync.mjs';
import {signatureReferences,signatureCompanies,validateSignatureBackup,validateSignatureBytes,hydrateSignature,prepareSignatureRestore} from './signature.mjs';
import {signatureStatus,applyUnsignedSignatures} from './signature-status.mjs';
import {handleMcp} from './mcp.mjs';
import {billsInitial,billMutate,validateBills,billHtml} from './bills.mjs';
import {financialReportHtml} from '../my-tech-accounting/report-documents.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function reply(body,status=200,type='application/json; charset=utf-8',extra={}){return new Response(type.startsWith('application/json')?JSON.stringify(body):body,{status,headers:{...headers,'Content-Type':type,...extra}});}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const email=v=>String(v||'').trim().toLowerCase();
const requireOwner=u=>{if(u.role!=='owner')fail('เฉพาะเจ้าของเท่านั้น',403);};
const requireWriter=u=>{if(!['owner','staff'].includes(u.role))fail('คุณมีสิทธิ์ดูอย่างเดียว กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์',403);};
const supportedFiles=['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
function recordForAttachment(s,id,u){for(const [kind,col] of Object.entries(syncCollections)){const r=(s[col]||[]).find(r=>r.id===id);if(r){syncAssertAccess(s,kind,id,u);return {kind,record:r};}}assert(false,'ไม่พบรายการที่แนบ');}
async function userFor(req,env){
  const id=req.headers.get('oai-authenticated-user-id'),mail=email(req.headers.get('oai-authenticated-user-email'));
  if(!id||!mail)return {id:'visitor',name:'ผู้เข้าชม',role:'viewer',csrf:'same-origin'};
  if(env.OWNER_EMAIL&&mail===email(env.OWNER_EMAIL))return {id,email:mail,name:'เจ้าของ MY TECH',role:'owner',csrf:'same-origin'};
  const row=await env.DB.prepare('SELECT role,name FROM members WHERE email=?').bind(mail).first();
  return {id,email:mail,name:row?.name||'ผู้เข้าชมที่เข้าสู่ระบบ',role:row?.role||'viewer',csrf:'same-origin'};
}
async function readState(env){
  await env.DB.prepare('INSERT OR IGNORE INTO app_state(id,revision,json) VALUES(1,0,?)').bind(JSON.stringify(payrollInitial({...initial(),...seedState}))).run();
  const row=await env.DB.prepare('SELECT revision,json FROM app_state WHERE id=1').first();
  return {revision:row.revision,state:billsInitial(receiptsInitial(payrollInitial({...initial(),...JSON.parse(row.json)})))};
}
const sanitizeCustomer=c=>({...c,phone:'',line:'',address:'',taxId:'',note:''});
export function visibleState(s,u){
  const copy=structuredClone(s);
  if(u.role!=='owner'){
    copy.accounts=copy.accounts.filter(a=>a.scope==='business');const ids=new Set(copy.accounts.map(a=>a.id));
    copy.entries=copy.entries.filter(e=>ids.has(e.accountId));copy.bills=(copy.bills||[]).filter(b=>b.scope==='business');copy.debts=copy.debts.filter(d=>d.scope==='business');
    const salaryIds=new Set(copy.entries.filter(e=>e.payrollId).map(e=>e.id)),totals=new Map();
    for(const e of active(copy).filter(e=>e.payrollId)){
      const key=e.accountId+':'+e.date,prev=totals.get(key)||{id:'salary-summary-'+key,date:e.date,accountId:e.accountId,type:'expense',amount:0,cash:0,project:'เงินเดือน',note:'ค่าใช้จ่ายเงินเดือนรวมประจำวัน · รายละเอียดเฉพาะเจ้าของ',by:'ระบบสรุป',createdAt:e.createdAt};
      prev.amount+=e.amount;prev.cash+=e.cash;totals.set(key,prev);
    }
    copy.entries=copy.entries.filter(e=>!salaryIds.has(e.id)&&!salaryIds.has(e.reverses)).concat([...totals.values()]);
    copy.pending=[];copy.audit=[];copy.employees=[];copy.payroll=[];copy.requests=[];
    copy.receipts=(copy.receipts||[]).filter(r=>copy.entries.some(e=>e.id===r.entryId));
    delete copy.syncCommitTag;
    copy.trello.catalog=[];copy.trello.boards=copy.trello.boardId?[{id:copy.trello.boardId,name:copy.trello.boardName}]:[];
    delete copy.restoreId;
    if(u.role==='viewer'){
      copy.customers=copy.customers.map(sanitizeCustomer);
      copy.documents=copy.documents.map(d=>({...d,customer:sanitizeCustomer(d.customer),...(d.company?{company:{...d.company,paymentInfo:'',taxId:'',address:'',phone:''}}:{})}));
      copy.company={...copy.company,paymentInfo:'',taxId:'',address:'',phone:''};
      copy.trello={...copy.trello,cards:[],lists:[]};copy.links=[];
      copy.trello.boards=[];copy.trello.autoSync={enabled:false};copy.receipts=copy.receipts.map(r=>({...r,customer:sanitizeCustomer(r.customer),company:{...r.company,paymentInfo:'',phone:'',address:'',taxId:''}}));
      for(const company of signatureCompanies(copy))delete company.signature;
    }
  }
  return {...copy,summary:summary(copy)};
}
async function body(req){const chunks=[];let size=0;const reader=req.body?.getReader();if(!reader)return {};for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>15*1024*1024){await reader.cancel();fail('ข้อมูลเกิน 15 MB',413);}chunks.push(value);}const bytes=new Uint8Array(size);let n=0;for(const b of chunks){bytes.set(b,n);n+=b.length;}try{return JSON.parse(new TextDecoder().decode(bytes)||'{}');}catch{fail('รูปแบบ JSON ไม่ถูกต้อง');}}
function validRequest(b){assert(typeof b.requestId==='string'&&b.requestId.length>=10&&b.requestId.length<=80,'ไม่พบเลขคำขอ');}
async function commit(env,row,state,extra=[]){
  const result=await env.DB.batch([env.DB.prepare('UPDATE app_state SET json=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(state),row.revision),...extra]);
  if(result[0].meta.changes!==1)fail('ข้อมูลถูกเปลี่ยนจากอีกเครื่อง กรุณาโหลดใหม่และตรวจรายการก่อนลองอีกครั้ง',409);
}
async function recordAction(env,u,b,origin){
  if(['employee','payrollSave','payrollPay','payrollCancel'].includes(b.action))requireOwner(u);
  validRequest(b);const row=await readState(env);
  const saved=await env.DB.prepare('SELECT scope,response FROM action_results WHERE request_id=?').bind(b.requestId).first();if(saved){if(saved.scope==='private')requireOwner(u);return {...JSON.parse(saved.response),duplicate:true};}
  if(row.state.requests.includes(b.requestId))fail('รายการนี้เคยบันทึกแล้ว กรุณาโหลดหน้าใหม่และตรวจรายการก่อนส่งอีกครั้ง',409);
  let out;if(b.action==='issueReceipt'){const state=structuredClone(row.state),e=syncAssertAccess(state,'entry',b.payload?.entryId,u);out={state,result:issueReceipt(state,e,u,b.payload)};state.revision++;}else out=['billSave','billPay','billCancel'].includes(b.action)?billMutate(row.state,b.action,b.payload||{},u):['employee','payrollSave','payrollPay','payrollCancel'].includes(b.action)?payrollMutate(row.state,b.action,b.payload||{},u):mutate(row.state,b.action,b.payload||{},u);
  const s=out.state;s.receipts ||= [];const kind=syncActionKind(b.action),records=[],payload=b.payload||{};let primary=out.result;
  if(!primary&&kind){const col=syncCollections[kind];primary=syncRecord(s,kind,payload.id)||(s[col]||[]).find(r=>!(row.state[col]||[]).some(old=>old.id===r.id));}
  if(primary&&kind)records.push({kind,id:primary.id,explicit:b.trello});
  if(b.action==='entry'&&primary?.type==='income'){const receipt=issueReceipt(s,primary,u,payload);records.push({kind:'receipt',id:receipt.id,explicit:b.trello,parentKey:'entry:'+primary.id});}
  if(b.action==='reverse'){const original=s.entries.find(e=>e.id===payload.id),receipt=s.receipts.find(r=>r.entryId===original?.id);if(receipt){receipt.status='cancelled';records.push({kind:'receipt',id:receipt.id});}if(original?.invoiceId)records.push({kind:'document',id:original.invoiceId});if(original?.payrollId)records.push({kind:'payroll',id:original.payrollId});}
  if(primary?.billId)records.push({kind:'bill',id:primary.billId});
  if(b.action==='reverse'){const e=s.entries.find(e=>e.id===payload.id);if(e?.billId)records.push({kind:'bill',id:e.billId});}
  if(primary?.invoiceId&&b.action==='entry')records.push({kind:'document',id:primary.invoiceId});
  const courseEntry=b.action==='reverse'?s.entries.find(e=>e.id===payload.id):primary;if(courseEntry?.enrollmentId)for(const d of s.documents.filter(d=>d.kind==='invoice'&&d.enrollmentId===courseEntry.enrollmentId))records.push({kind:'document',id:d.id});
  const tag=uid(),extra=[],jobs=[];s.syncCommitTag=tag;
  const uniqueRecords=new Set();for(const record of records){const key=record.kind+':'+record.id;if(uniqueRecords.has(key))continue;uniqueRecords.add(key);const explicit=record.explicit||(b.trello?.enabled===false?b.trello:undefined),prepared=await syncPrepare(env,s,u,record.kind,record.id,explicit,origin,tag,b.action,null,record.parentKey);extra.push(...prepared.statements);if(prepared.queued)jobs.push(prepared.id);}
  const response={result:out.result||primary,jobs,receipt:s.receipts.find(r=>r.entryId===primary?.id)},scope=kind&&primary?syncScope(s,kind,primary):u.role==='owner'?'private':'business';
  extra.push(env.DB.prepare("INSERT OR IGNORE INTO action_results SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.syncCommitTag')=?)").bind(b.requestId,scope,JSON.stringify(response),tag));
  s.requests.push(b.requestId);await commit(env,row,s,extra);return response;
}
const toBase64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
const fromBase64=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));
async function attachmentRows(env){return (await env.DB.prepare('SELECT a.*,p.attachment_id AS payrollOnly FROM attachments a LEFT JOIN payroll_private_attachments p ON p.attachment_id=a.id').all()).results.map(a=>({...a,payrollOnly:!!a.payrollOnly}));}
function backupResponse(env,state,rows,filename='MYTECH-backup.json'){
  const encoder=new TextEncoder();
  async function* chunks(){yield JSON.stringify({format:'MYTECH_BACKUP_V1',createdAt:new Date().toISOString(),state}).slice(0,-1)+',"attachments":[';
    for(let i=0;i<rows.length;i++){const a=rows[i],file=a.base64?null:await env.BUCKET.get('attachments/'+a.id);assert(a.base64||file,'ไม่พบไฟล์หลักฐาน');const body=a.base64||toBase64(new Uint8Array(await file.arrayBuffer()));yield (i?',':'')+JSON.stringify({id:a.id,record_id:a.record_id,name:a.name,mime:a.mime,body,by_user:a.by_user,payrollOnly:!!a.payrollOnly});}
    yield '],"signatureFiles":[';const refs=signatureReferences(state);for(let i=0;i<refs.length;i++){const ref=refs[i],file=await env.BUCKET.get('signatures/'+ref.id);assert(file,'ไม่พบไฟล์ลายเซ็นในข้อมูลสำรอง');yield (i?',':'')+JSON.stringify({...ref,body:toBase64(new Uint8Array(await file.arrayBuffer()))});}yield ']}';
  }
  const iterator=chunks();return reply(new ReadableStream({async pull(controller){try{const r=await iterator.next();if(r.done)controller.close();else controller.enqueue(encoder.encode(r.value));}catch(e){controller.error(e);}}}),200,'application/octet-stream',{'Content-Disposition':'attachment; filename="'+filename+'"'});
}
async function saveRecovery(env,row){const id=uid(),key='recovery/'+id+'.json',createdAt=new Date().toISOString(),attachments=await attachmentRows(env);const current=await env.DB.prepare('SELECT revision FROM app_state WHERE id=1').first();if(current.revision!==row.revision)fail('ข้อมูลเปลี่ยนระหว่างสำรองก่อนกู้คืน กรุณาเริ่มใหม่',409);await env.BUCKET.put(key,JSON.stringify({state:row.state,attachments}));await env.DB.prepare('INSERT INTO recovery_backups VALUES(?,?,?)').bind(id,createdAt,key).run();}
function attachmentMetadata(a){assert(a&&typeof a.record_id==='string'&&typeof a.name==='string'&&a.name.length<=180&&supportedFiles.includes(a.mime),'ไฟล์แนบไม่ถูกต้อง');return {id:uid(),record_id:a.record_id,name:a.name,mime:a.mime,by_user:String(a.by_user||'owner').slice(0,200),base64:'',payrollOnly:a.payrollOnly===true};}
async function applyRestore(env,u,row,next,files){
  const lock=await syncAcquireLock(env);if(!lock)fail('กำลังส่ง Trello กรุณารอให้เสร็จก่อนกู้คืน',409);try{
  const tag=uid();next.restoreId=tag;next.audit.push({id:uid(),by:u.name,action:'restore',createdAt:new Date().toISOString(),note:'กู้คืนข้อมูล'});
  await saveRecovery(env,row);
  const guard="EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.restoreId')=?)",extra=[env.DB.prepare('DELETE FROM attachments WHERE '+guard).bind(tag),env.DB.prepare('DELETE FROM payroll_private_attachments WHERE '+guard).bind(tag)];
  if(files.length)extra.push(env.DB.prepare("INSERT INTO attachments SELECT json_extract(value,'$.id'),json_extract(value,'$.record_id'),json_extract(value,'$.name'),json_extract(value,'$.mime'),'',json_extract(value,'$.by_user') FROM json_each(?) WHERE "+guard).bind(JSON.stringify(files),tag));
  if(files.some(a=>a.payrollOnly))extra.push(env.DB.prepare("INSERT INTO payroll_private_attachments SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_extract(value,'$.payrollOnly')=1 AND "+guard).bind(JSON.stringify(files),tag));
  extra.push(env.DB.prepare("UPDATE trello_jobs SET status='cancelled',last_error='ยกเลิกจากการกู้คืนข้อมูล' WHERE status!='done' AND "+guard).bind(tag),env.DB.prepare('DELETE FROM trello_routes WHERE '+guard).bind(tag));
  extra.push(env.DB.prepare('DELETE FROM attachment_requests WHERE '+guard).bind(tag));
  extra.push(env.DB.prepare('DELETE FROM action_results WHERE '+guard).bind(tag));
  await commit(env,row,next,extra);
  }finally{await syncReleaseLock(env,lock);}
}
async function loadStage(env,id,u){assert(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'ไม่พบชุดกู้คืน');const file=await env.BUCKET.get('restore/'+id+'.json');assert(file,'ไม่พบชุดกู้คืน');const stage=JSON.parse(await file.text());assert(stage.ownerId===u.id&&Date.now()-stage.createdAt<3600000,'ชุดกู้คืนหมดอายุ กรุณาเลือกไฟล์ใหม่');return stage;}
async function seal(env,value){assert(env.DATA_KEY,'ยังไม่ได้ตั้งกุญแจเข้ารหัสฝั่งเซิร์ฟเวอร์');const key=await crypto.subtle.importKey('raw',fromBase64(env.DATA_KEY),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));return JSON.stringify({iv:toBase64(iv),data:toBase64(new Uint8Array(enc))});}
async function unseal(env,value){const v=JSON.parse(value),key=await crypto.subtle.importKey('raw',fromBase64(env.DATA_KEY),'AES-GCM',false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(v.iv)},key,fromBase64(v.data))));}
async function trello(env,method,endpoint,params={}){
  const row=await env.DB.prepare("SELECT value FROM secrets WHERE id='trello'").first();assert(row,'ตั้งค่า Trello ก่อนใช้งาน');const c=await unseal(env,row.value),url=new URL('https://api.trello.com/1/'+endpoint);url.searchParams.set('key',c.key);url.searchParams.set('token',c.token);
  const options={method,signal:AbortSignal.timeout(8000)};if(method==='GET'){for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));}else if(params instanceof FormData){options.body=params;}else{options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(params);}
  let r;try{r=await fetch(url,options);}catch{throw Object.assign(new Error('ติดต่อ Trello ไม่สำเร็จ ตรวจสถานะก่อนลองเขียนอีกครั้ง'),{status:502});}if(!r.ok)throw Object.assign(new Error('Trello ตอบกลับผิดพลาด ('+r.status+') กรุณาตรวจสิทธิ์การเชื่อมต่อ'),{status:502,definite:r.status<500});return r.json();
}
async function integrationApi(req,env,u,url){
  const p=url.pathname;if(!['/api/trello/jobs','/api/trello/retry','/api/trello/catalog','/api/trello/auto','/api/trello/main-board','/api/trello/send'].includes(p))return null;
  requireWriter(u);
  if(p==='/api/trello/jobs'&&req.method==='GET')return reply({jobs:await syncVisible(env,u)});
  if(req.method!=='POST')return reply({error:'ไม่รองรับวิธีนี้'},405);
  const b=await body(req),row=await readState(env),s=row.state;
  if(p==='/api/trello/catalog'){
    const boardId=String(b.boardId||s.trello.boardId);assert(/^[a-f0-9]{24}$/.test(boardId),'รหัสบอร์ดไม่ถูกต้อง');if(u.role!=='owner')assert(boardId===s.trello.boardId,'เฉพาะบอร์ดหลักที่เจ้าของอนุญาต');
    const [board,lists,cards]=await Promise.all([trello(env,'GET','boards/'+boardId,{fields:'name,url'}),trello(env,'GET','boards/'+boardId+'/lists',{filter:'open',fields:'name'}),trello(env,'GET','boards/'+boardId+'/cards',{filter:'open',fields:'name,desc,url,idList'})]);
    const catalog={id:boardId,name:board.name,url:board.url,lists:lists.map(l=>({id:l.id,name:l.name})),cards:cards.map(c=>({id:c.id,name:c.name,url:c.url,listId:c.idList}))};s.trello.catalog=[...(s.trello.catalog||[]).filter(c=>c.id!==boardId),catalog];if(boardId===s.trello.boardId)Object.assign(s.trello,{boardName:catalog.name,boardUrl:catalog.url,lists:catalog.lists,cards:catalog.cards,connected:true,lastSync:new Date().toISOString()});await commit(env,row,s);return reply(catalog);
  }
  if(p==='/api/trello/main-board'){
    requireOwner(u);assert((s.trello.boards||[]).some(x=>x.id===b.boardId),'เลือกบอร์ดจากรายการที่เชื่อม');
    const [board,lists,cards]=await Promise.all([trello(env,'GET','boards/'+b.boardId,{fields:'name,url'}),trello(env,'GET','boards/'+b.boardId+'/lists',{filter:'open',fields:'name'}),trello(env,'GET','boards/'+b.boardId+'/cards',{filter:'open',fields:'name,url,idList'})]);
    Object.assign(s.trello,{boardId:b.boardId,boardName:board.name,boardUrl:board.url,lists:lists.map(l=>({id:l.id,name:l.name})),cards:cards.map(c=>({id:c.id,name:c.name,url:c.url,listId:c.idList})),autoSync:{enabled:false},connected:true,lastSync:new Date().toISOString()});await commit(env,row,s);return reply({ok:true});
  }
  if(p==='/api/trello/auto'){requireOwner(u);const enabled=b.enabled===true;if(enabled)assert(!b.boardId||b.boardId===s.trello.boardId,'ค่าอัตโนมัติใช้บอร์ดหลักที่เจ้าของกำหนด');s.trello.autoSync=enabled?{...syncValidateTarget(s,b,u),enabled:true}:{enabled:false};await commit(env,row,s);return reply({ok:true});}
  if(p==='/api/trello/retry'){
    const job=await env.DB.prepare('SELECT * FROM trello_jobs WHERE id=?').bind(b.id).first();assert(job,'ไม่พบงานส่ง');if(await syncJobProgramOnly(env,s,job))fail('ข้อมูลเงินเดือนและหลักฐานเก็บเฉพาะในโปรแกรม',403);if(job.scope==='private')requireOwner(u);assert(!['working','done','cancelled'].includes(job.status),'งานนี้กำลังส่ง ส่งเสร็จ หรือถูกยกเลิกแล้ว');syncAssertAccess(s,job.kind,job.record_id,u);
    if(u.role!=='owner')assert(JSON.parse(job.target).boardId===s.trello.boardId,'ส่งได้เฉพาะบอร์ดหลัก');
    const progress=JSON.parse(job.progress||'{}');if(b.confirm==='ตรวจ Trello แล้ว ส่งใหม่')progress.allowRetry=true;
    await env.DB.prepare("UPDATE trello_jobs SET status='pending',next_at=0,progress=? WHERE id=?").bind(JSON.stringify(progress),job.id).run();return reply({ok:true});
  }
  if(p==='/api/trello/send'){
    validRequest(b);if(syncProgramOnly(s,b.kind,syncRecord(s,b.kind,b.recordId)))fail('ข้อมูลเงินเดือนและหลักฐานเก็บเฉพาะในโปรแกรม',403);if(s.requests.includes(b.requestId))return reply({duplicate:true});const tag=uid();s.syncCommitTag=tag;const jobs=[],extra=[];
    const prepared=await syncPrepare(env,s,u,b.kind,b.recordId,b.trello,url.origin,tag,'ส่งจากหน้ารายการ');assert(prepared.queued,'เลือกปลายทาง Trello ก่อนส่ง');extra.push(...prepared.statements);jobs.push(prepared.id);
    const files=(await env.DB.prepare('SELECT id FROM attachments WHERE record_id=? LIMIT 100').bind(b.recordId).all()).results;for(const f of files){const q=await syncPrepare(env,s,u,b.kind,b.recordId,b.trello,url.origin,tag,'แนบหลักฐาน',f.id);extra.push(...q.statements);if(q.queued)jobs.push(q.id);}
    s.requests.push(b.requestId);await commit(env,row,s,extra);return reply({ok:true,jobs});
  }
  return null;
}
function validateRestore(backup){
  assert(backup?.format==='MYTECH_BACKUP_V1'&&backup.state?.version===1,'ไฟล์สำรองไม่ถูกต้อง');
  const s=billsInitial(backup.state),base=initial();assert(Object.keys(base).every(k=>k in s),'โครงสร้างข้อมูลไม่ครบ');
  for(const [k,v] of Object.entries(base))if(Array.isArray(v))assert(Array.isArray(s[k]),'ข้อมูล '+k+' ต้องเป็นรายการ');
  assert(s.company&&typeof s.company.name==='string'&&s.trello&&Array.isArray(s.trello.cards),'ข้อมูลกิจการไม่ครบ');
  for(const k of ['accounts','entries','products','lots','customers','documents','debts','payroll','employees','receipts','bills']){const rows=s[k]||[];assert(Array.isArray(rows),'ข้อมูล '+k+' ไม่ถูกต้อง');const ids=new Set();for(const row of rows){assert(row&&typeof row.id==='string'&&!ids.has(row.id),'รหัสรายการ '+k+' ซ้ำหรือไม่ถูกต้อง');ids.add(row.id);}}
  assert(s.entries.every(e=>s.accounts.some(a=>a.id===e.accountId)&&Number.isSafeInteger(e.amount)&&Number.isSafeInteger(e.cash)),'รายการเงินไม่ถูกต้อง');
  assert(s.lots.every(l=>s.products.some(p=>p.id===l.productId)&&Number.isSafeInteger(l.quantity)&&l.quantity>=0&&Number.isSafeInteger(l.value)&&l.value>=0),'ข้อมูลสต๊อกไม่ถูกต้อง');
  summary(s);
  validateOpeningAdjustments(s);validatePayroll(payrollInitial(s));validateBills(s);
  assert(Array.isArray(backup.attachments||[])&&(backup.attachments||[]).length<=500,'ไฟล์แนบเกินจำนวนที่รองรับ');
  const receiptEntries=new Set(),receiptNumbers=new Set();assert(Array.isArray(s.receipts||[]),'ข้อมูลใบเสร็จไม่ถูกต้อง');for(const r of s.receipts||[]){const entry=s.entries.find(e=>e.id===r.entryId&&e.type==='income'&&e.amount===r.amount);assert(entry&&r.date===entry.date&&typeof r.number==='string'&&r.number&&typeof r.note==='string'&&r.customer&&typeof r.customer.name==='string'&&!receiptEntries.has(r.entryId)&&!receiptNumbers.has(r.number),'ข้อมูลใบเสร็จไม่ถูกต้อง');receiptEntries.add(r.entryId);receiptNumbers.add(r.number);}validateSignatureBackup(backup);return billsInitial(receiptsInitial(payrollInitial(s)));
}
async function recordAttachment(env,u,b,origin,rawBytes=null){
  requireWriter(u);assert(b.payrollOnly===undefined||typeof b.payrollOnly==='boolean','ประเภทหลักฐานไม่ถูกต้อง');if(b.payrollOnly)requireOwner(u);const row=await readState(env),found=recordForAttachment(row.state,b.recordId,u);if(b.requestId){assert(typeof b.requestId==='string'&&b.requestId.length<=160,'เลขคำขอไฟล์ไม่ถูกต้อง');const old=await env.DB.prepare('SELECT r.attachment_id,a.record_id,p.attachment_id AS payrollOnly FROM attachment_requests r JOIN attachments a ON a.id=r.attachment_id LEFT JOIN payroll_private_attachments p ON p.attachment_id=a.id WHERE r.request_id=?').bind(b.requestId).first();if(old){assert(!b.payrollOnly||!!old.payrollOnly,'คำขอเดิมเป็นไฟล์ทั่วไป กรุณาตรวจไฟล์เดิมและใช้คำขอใหม่สำหรับหลักฐานเงินเดือน');assert(old.record_id===b.recordId,'เลขคำขอไฟล์อ้างอิงรายการอื่น');if(old.payrollOnly)requireOwner(u);return {id:old.attachment_id,duplicate:true,payrollOnly:!!old.payrollOnly};}}assert(supportedFiles.includes(b.mime),'รองรับ PNG, JPG, WebP, PDF');const bytes=rawBytes||fromBase64(b.base64);assert(bytes.length>0&&bytes.length<=10*1024*1024,'ไฟล์ต้องไม่เกิน 10 MB');if(b.mime==='application/pdf')assert(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-','ไฟล์ PDF ไม่ถูกต้อง');const id=uid();await env.BUCKET.put('attachments/'+id,bytes);row.state.attachmentRevision=id;const tag=uid();row.state.syncCommitTag=tag;const payrollOnly=b.payrollOnly===true||syncProgramOnly(row.state,found.kind,found.record),queue=payrollOnly?{statements:[],queued:false}:await syncPrepare(env,row.state,u,found.kind,b.recordId,b.trello,origin,tag,'แนบหลักฐาน',id);
    await commit(env,row,row.state,[env.DB.prepare("INSERT INTO attachments SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.attachmentRevision')=?)").bind(id,b.recordId,String(b.name).slice(0,180),b.mime,'',u.id,id),...(b.requestId?[env.DB.prepare("INSERT OR IGNORE INTO attachment_requests SELECT ?,? WHERE EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.attachmentRevision')=?)").bind(b.requestId,id,id)]:[]),...(payrollOnly?[env.DB.prepare("INSERT OR IGNORE INTO payroll_private_attachments SELECT ? WHERE EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.attachmentRevision')=?)").bind(id,id)]:[]),...queue.statements]);return {id,payrollOnly,jobs:queue.queued?[queue.id]:[]};
}
function mcpHandlers(req,env,url){
  async function access(u,recordId,payrollOnly=false){const current=await userFor(req,env);requireWriter(current);assert(current.id===u.id,'บัญชีผู้เรียกเปลี่ยน');if(payrollOnly)requireOwner(current);const {state}=await readState(env),found=recordForAttachment(state,recordId,current);return {user:current,programOnly:payrollOnly||syncProgramOnly(state,found.kind,found.record)};}
  return {parse:()=>body(req),respond:reply,session:()=>userFor(req,env),load:async u=>{const state=(await readState(env)).state,out=visibleState(state,u),ids=new Set(Object.values(syncCollections).flatMap(col=>(out[col]||[]).map(x=>x.id)));if(u.role==='owner')out.signatureStatus=await signatureStatus(env,state);out.attachments=(await attachmentRows(env)).filter(a=>u.role==='owner'||!a.payrollOnly&&ids.has(a.record_id)).map(a=>({id:a.id,recordId:a.record_id,name:a.name,mime:a.mime,payrollOnly:a.payrollOnly}));return out;},save:async(u,b)=>{const current=await userFor(req,env);requireWriter(current);return recordAction(env,{...current,name:current.name+' (AI)'},b,url.origin);},lookup:key=>env.DB.prepare('SELECT fingerprint FROM ai_requests WHERE id=?').bind(key).first(),remember:(key,fingerprint)=>env.DB.prepare('INSERT OR IGNORE INTO ai_requests(id,fingerprint) VALUES(?,?)').bind(key,fingerprint).run(),authorizeAttachment:async(u,id,privateFile)=>(await access(u,id,privateFile)).programOnly,existingAttachment:async(u,id,key)=>{const current=await access(u,id),file=await env.DB.prepare('SELECT a.id,a.record_id,a.name,p.attachment_id AS payrollOnly FROM attachment_requests r JOIN attachments a ON a.id=r.attachment_id LEFT JOIN payroll_private_attachments p ON p.attachment_id=a.id WHERE r.request_id=?').bind(key).first();if(!file)return null;assert(file.record_id===id,'คำขอไฟล์อ้างอิงรายการอื่น');if(file.payrollOnly)requireOwner(current.user);return {...file,payrollOnly:!!file.payrollOnly};},attach:async(u,b,bytes)=>{const current=await access(u,b.recordId,b.payrollOnly);return recordAttachment(env,current.user,b,url.origin,bytes);}};
}
async function handle(req,env){
  const url=new URL(req.url),p=url.pathname;
  if(p==='/mcp')return handleMcp(req,mcpHandlers(req,env,url));
  if(req.method==='GET'&&assets[p]){const a=assets[p];return reply(a.body,200,a.type);}
  if(p==='/api/health')return reply({ok:true,storage:'D1',version:'2.0'});
  if(!p.startsWith('/api/'))return reply({error:'ไม่พบหน้า'},404);
  const u=await userFor(req,env);
  if(req.method==='GET'&&p==='/api/session')return reply({setup:false,user:u,mode:'online',signIn:'/signin-with-chatgpt?return_to=%2F',signOut:'/signout-with-chatgpt?return_to=%2F'});
  if(req.method!=='GET'&&req.method!=='POST')return reply({error:'ไม่รองรับวิธีนี้'},405);
  if(req.method==='POST'){
    if(req.headers.get('origin')!==url.origin)fail('คำขอจากแหล่งอื่นถูกปฏิเสธ',403);
    if(!req.headers.get('content-type')?.startsWith('application/json')||req.headers.get('x-csrf-token')!=='same-origin')fail('คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่',403);
    requireWriter(u);
  }
  if(p==='/api/company/signature/apply-unsigned'&&req.method==='POST'){
    requireOwner(u);await body(req);const row=await readState(env),status=await signatureStatus(env,row.state);assert(status.configured,status.error||'กรุณาบันทึกรูปลายเซ็นก่อน');const applied=applyUnsignedSignatures(row.state,row.state.company.signature);row.state.revision++;row.state.audit.push({id:uid(),by:u.name,action:'signature_apply_unsigned',createdAt:new Date().toISOString(),note:'ใช้ลายเซ็นปัจจุบันกับเอกสารที่ยังไม่มี '+applied.total+' ฉบับ'});await commit(env,row,row.state);return reply({ok:true,applied});
  }
  if(p==='/api/company/signature'&&req.method==='POST'){

    requireOwner(u);const b=await body(req),row=await readState(env);assert(typeof b.name==='string'&&b.name.length<=120&&typeof b.title==='string'&&b.title.length<=120,'ชื่อและตำแหน่งต้องไม่เกิน 120 ตัวอักษร');
    let signature=b.remove?null:{...(row.state.company.signature||{}),name:b.name.trim(),title:b.title.trim()};
    if(signature&&b.image){assert(typeof b.image.base64==='string','รูปแบบรูปลายเซ็นไม่ถูกต้อง');const bytes=fromBase64(b.image.base64);validateSignatureBytes(bytes,b.image.mime);const id=uid();await env.BUCKET.put('signatures/'+id,bytes);signature={...signature,assetId:id,mime:b.image.mime};}
    row.state.company.signature=signature;row.state.revision++;row.state.audit.push({id:uid(),by:u.name,action:'signature',createdAt:new Date().toISOString(),note:signature?'ตั้งลายเซ็นผู้ออกเอกสาร':'นำลายเซ็นออกจากเอกสารใหม่'});await commit(env,row,row.state);return reply({ok:true});
  }
  if(p.startsWith('/api/signature/')&&req.method==='GET'){
    requireOwner(u);const id=p.split('/').pop(),{state}=await readState(env),ref=signatureReferences(state).find(r=>r.id===id);assert(ref,'ไม่พบลายเซ็น');const file=await env.BUCKET.get('signatures/'+id);assert(file,'ไม่พบไฟล์ลายเซ็น');return reply(await file.arrayBuffer(),200,ref.mime);
  }
  if(p==='/api/state'&&req.method==='GET'){
    const {state}=await readState(env),out=visibleState(state,u);out.attachmentList=[];if(u.role==='owner')out.signatureStatus=await signatureStatus(env,state);
    if(u.role!=='viewer'){const ids=new Set(Object.values(syncCollections).flatMap(col=>(out[col]||[]).map(x=>x.id)));out.attachmentList=(await env.DB.prepare('SELECT a.id,a.record_id AS recordId,a.name,a.mime,p.attachment_id AS payrollOnly FROM attachments a LEFT JOIN payroll_private_attachments p ON p.attachment_id=a.id').all()).results.filter(a=>u.role==='owner'||!a.payrollOnly&&ids.has(a.recordId));}
    out.trelloConfigured=u.role!=='viewer'&&!!await env.DB.prepare("SELECT id FROM secrets WHERE id='trello'").first();
    out.syncJobs=await syncVisible(env,u);out.syncRoutes=u.role==='viewer'?[]:(await env.DB.prepare('SELECT kind,record_id AS recordId,target FROM trello_routes '+(u.role==='owner'?'':"WHERE scope='business'")).all()).results.map(r=>({...r,target:JSON.parse(r.target)})).filter(r=>u.role==='owner'||r.target.boardId===state.trello.boardId);
    out.members=u.role==='owner'?(await env.DB.prepare('SELECT email,name,role FROM members ORDER BY email').all()).results:[];
    return reply(out);
  }
  const integration=await integrationApi(req,env,u,url);if(integration)return integration;
  if(p==='/api/action'&&req.method==='POST')return reply(await recordAction(env,u,await body(req),url.origin));
  if(p==='/api/members'&&req.method==='POST'){
    requireOwner(u);const b=await body(req),mail=email(b.email);assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)&&mail.length<=254,'กรอกอีเมลให้ถูกต้อง');assert(mail!==email(env.OWNER_EMAIL),'บัญชีเจ้าของเปลี่ยนสิทธิ์จากหน้านี้ไม่ได้');
    if(b.remove===true)await env.DB.prepare('DELETE FROM members WHERE email=?').bind(mail).run();else{assert(typeof b.name==='string'&&b.name.trim()&&b.name.length<=100,'กรอกชื่อผู้แก้ไข');await env.DB.prepare("INSERT INTO members(email,role,name) VALUES(?,'staff',?) ON CONFLICT(email) DO UPDATE SET name=excluded.name").bind(mail,b.name.trim()).run();}
    return reply({ok:true});
  }
  if(p==='/api/document'&&req.method==='GET'){
    const {state}=await readState(env),s=visibleState(state,u),doc=s.documents.find(d=>d.id===url.searchParams.get('id'));assert(doc,'ไม่พบเอกสาร');if(u.role!=='viewer')doc.company=await hydrateSignature(env,doc.company||{...s.company,signature:null});return reply(documentHtml(s,doc,{canEdit:['owner','staff'].includes(u.role)}),200,'text/html; charset=utf-8');
  }
  if(p==='/api/receipt'&&req.method==='GET'){const {state}=await readState(env),s=visibleState(state,u),receipt=(s.receipts||[]).find(r=>r.id===url.searchParams.get('id'));assert(receipt,'ไม่พบใบเสร็จ');if(u.role!=='viewer')receipt.company=await hydrateSignature(env,receipt.company||{...s.company,signature:null});return reply(receiptHtml(s,receipt),200,'text/html; charset=utf-8');}
  if(p==='/api/bill'&&req.method==='GET'){const {state}=await readState(env),s=visibleState(state,u);syncAssertAccess(state,'bill',url.searchParams.get('id'),u);const bill=(s.bills||[]).find(b=>b.id===url.searchParams.get('id'));assert(bill,'ไม่พบบิล');if(u.role!=='viewer')bill.company=await hydrateSignature(env,bill.company||{...s.company,signature:null});return reply(billHtml(s,bill),200,'text/html; charset=utf-8');}
  if(p==='/api/report'&&req.method==='GET'){const {state}=await readState(env),s=visibleState(state,u),filter={};for(const key of ['from','to','project','search']){const value=url.searchParams.get(key)||'';assert(value.length<=500,'ตัวกรองยาวเกินกำหนด');if(value)filter[key]=value;}for(const key of ['from','to'])if(filter[key])assert(/^\d{4}-\d{2}-\d{2}$/.test(filter[key])&&!Number.isNaN(Date.parse(filter[key]))&&new Date(filter[key]).toISOString().slice(0,10)===filter[key],'วันที่ไม่ถูกต้อง');assert(!filter.from||!filter.to||filter.from<=filter.to,'ช่วงวันที่ไม่ถูกต้อง');const company=u.role==='viewer'?{...s.company,signature:null}:await hydrateSignature(env,s.company);return reply(financialReportHtml(s,filter,{owner:u.role==='owner',company}),200,'text/html; charset=utf-8');}
  if(p==='/api/payslip'&&req.method==='GET'){requireOwner(u);const {state}=await readState(env),slip=state.payroll.find(x=>x.id===url.searchParams.get('id'));assert(slip,'ไม่พบสลิป');slip.company=await hydrateSignature(env,slip.company||{...state.company,signature:null});return reply(payslipHtml(state,slip),200,'text/html; charset=utf-8');}
  if(p==='/api/backup'&&req.method==='GET'){
    requireOwner(u);const row=await readState(env),attachments=await attachmentRows(env),current=await env.DB.prepare('SELECT revision FROM app_state WHERE id=1').first();if(current.revision!==row.revision)fail('ข้อมูลเปลี่ยนระหว่างสำรอง กรุณาดาวน์โหลดอีกครั้ง',409);return backupResponse(env,row.state,attachments);
  }
  if(p==='/api/recovery'&&req.method==='GET'){requireOwner(u);const id=url.searchParams.get('id');if(!id)return reply((await env.DB.prepare('SELECT id,created_at FROM recovery_backups ORDER BY created_at DESC LIMIT 20').all()).results);const r=await env.DB.prepare('SELECT json FROM recovery_backups WHERE id=?').bind(id).first();assert(r,'ไม่พบสำเนา');const file=await env.BUCKET.get(r.json);assert(file,'ไม่พบไฟล์สำเนา');const saved=JSON.parse(await file.text());return backupResponse(env,saved.state,saved.attachments,'MYTECH-before-restore.json');}
  if(p==='/api/restore/prepare'&&req.method==='POST'){
    requireOwner(u);const b=await body(req);assert(b.confirm==='กู้คืนข้อมูล','พิมพ์คำยืนยันให้ถูกต้อง');const signaturePlan=prepareSignatureRestore(validateRestore(b.backup),b.backup.signatureFiles||[]),next=signaturePlan.state,row=await readState(env),id=uid(),files=(b.backup.attachments||[]).map(attachmentMetadata);
    const validRecords=new Set(Object.values(syncCollections).flatMap(col=>(next[col]||[]).map(x=>x.id)));assert(files.every(a=>validRecords.has(a.record_id)),'ไฟล์แนบอ้างอิงรายการที่ไม่มีอยู่');
    await env.BUCKET.put('restore/'+id+'.json',JSON.stringify({ownerId:u.id,createdAt:Date.now(),revision:row.revision,state:next,files,signatureFiles:signaturePlan.files}));return reply({id,count:files.length});
  }
  if(p==='/api/restore/file'&&req.method==='POST'){
    requireOwner(u);const b=await body(req),stage=await loadStage(env,b.id,u),a=(b.signature?stage.signatureFiles:stage.files)?.[b.index];assert(Number.isInteger(b.index)&&a&&typeof b.base64==='string','ไม่พบไฟล์ในชุดกู้คืน');const bytes=fromBase64(b.base64);if(b.signature)validateSignatureBytes(bytes,a.mime);else assert(bytes.length>0&&bytes.length<=10*1024*1024,'ไฟล์หลักฐานเกิน 10 MB');await env.BUCKET.put((b.signature?'signatures/':'attachments/')+a.id,bytes);return reply({ok:true});
  }
  if(p==='/api/restore/commit'&&req.method==='POST'){
    requireOwner(u);const b=await body(req),stage=await loadStage(env,b.id,u),row=await readState(env);if(row.revision!==stage.revision)fail('ข้อมูลเปลี่ยนระหว่างกู้คืน กรุณาตรวจรายการล่าสุดแล้วเริ่มกู้คืนใหม่',409);
    for(const a of stage.signatureFiles||[])assert(await env.BUCKET.get('signatures/'+a.id),'ยังส่งรูปลายเซ็นไม่ครบ');
    for(const a of stage.files)assert(await env.BUCKET.get('attachments/'+a.id),'ยังส่งไฟล์หลักฐานไม่ครบ');
    await applyRestore(env,u,row,stage.state,stage.files);return reply({ok:true});
  }
  if(p==='/api/restore'&&req.method==='POST'){
    requireOwner(u);const b=await body(req);assert(b.confirm==='กู้คืนข้อมูล','พิมพ์คำยืนยันให้ถูกต้อง');const signaturePlan=prepareSignatureRestore(validateRestore(b.backup),b.backup.signatureFiles||[]),next=signaturePlan.state,row=await readState(env),files=[];for(let i=0;i<signaturePlan.files.length;i++){const a=signaturePlan.files[i],bytes=fromBase64(b.backup.signatureFiles[i].body);validateSignatureBytes(bytes,a.mime);await env.BUCKET.put('signatures/'+a.id,bytes);}
    for(const a of b.backup.attachments||[]){const meta=attachmentMetadata(a),bytes=fromBase64(a.body);assert(bytes.length>0&&bytes.length<=10*1024*1024,'ไฟล์หลักฐานเกิน 10 MB');await env.BUCKET.put('attachments/'+meta.id,bytes);files.push(meta);}
    await applyRestore(env,u,row,next,files);return reply({ok:true});
  }
  if(p==='/api/attachment'&&req.method==='POST')return reply(await recordAttachment(env,u,await body(req),url.origin));
  if(p.startsWith('/api/file/')&&req.method==='GET'){
    requireWriter(u);const a=await env.DB.prepare('SELECT * FROM attachments WHERE id=?').bind(p.split('/').pop()).first();assert(a,'ไม่พบไฟล์');if(await env.DB.prepare('SELECT attachment_id FROM payroll_private_attachments WHERE attachment_id=?').bind(a.id).first())requireOwner(u);const {state}=await readState(env),s=visibleState(state,u);recordForAttachment(state,a.record_id,u);const file=a.base64?null:await env.BUCKET.get('attachments/'+a.id);assert(a.base64||file,'ไม่พบไฟล์หลักฐาน');return reply(a.base64?fromBase64(a.base64):await file.arrayBuffer(),200,a.mime,{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(a.name)});
  }
  if(p.startsWith('/api/trello/')&&req.method==='POST'){
    requireOwner(u);const b=await body(req);
    if(p==='/api/trello/config'){assert(/^[a-fA-F0-9]{32}$/.test(b.key)&&typeof b.token==='string'&&b.token.length>=30&&b.token.length<=512,'ตรวจ API Key/Token');await env.DB.prepare("INSERT OR REPLACE INTO secrets VALUES('trello',?)").bind(await seal(env,{key:b.key,token:b.token})).run();return reply({ok:true});}
    if(p==='/api/trello/refresh'){
      const boards=await trello(env,'GET','members/me/boards',{filter:'open',fields:'name,url,closed'});const initialRow=await readState(env);initialRow.state.trello.boards=boards.filter(x=>!x.closed).map(x=>({id:x.id,name:x.name,url:x.url}));await commit(env,initialRow,initialRow.state);
      const row=await readState(env),s=row.state;const [board,lists,cards]=await Promise.all([trello(env,'GET','boards/'+s.trello.boardId,{fields:'name,url'}),trello(env,'GET','boards/'+s.trello.boardId+'/lists',{filter:'open',fields:'name'}),trello(env,'GET','boards/'+s.trello.boardId+'/cards',{filter:'open',fields:'name,desc,url,idList',limit:500})]);
      s.trello={...s.trello,boardName:board.name,boardUrl:board.url,lists:lists.map(x=>({id:x.id,name:x.name})),cards:cards.map(x=>({id:x.id,name:x.name,desc:x.desc,url:x.url,listId:x.idList})),connected:true,lastSync:new Date().toISOString()};await commit(env,row,s);return reply({ok:true});
    }
    if(p==='/api/trello/push'){
      const row=await readState(env),s=row.state,col={customer:'customers',enrollment:'enrollments',purchase:'purchases',product:'products'}[b.kind];assert(col,'ประเภทไม่ถูกต้อง');const rec=s[col].find(x=>x.id===b.recordId);assert(rec,'ไม่พบรายการ');assert(s.trello.lists.some(x=>x.id===b.listId),'เลือกลิสต์จากบอร์ด');const marker='MYTECH-REF:'+b.kind+':'+rec.id;
      const previous=s.links.find(x=>x.recordId===rec.id&&x.kind===b.kind),existing=await trello(env,'GET','boards/'+s.trello.boardId+'/cards',{fields:'id,name,desc,url',filter:'all',limit:1000}),matched=existing.filter(x=>x.desc?.includes(marker)||x.url===previous?.url);assert(matched.length<=1,'พบการ์ดอ้างอิงซ้ำ กรุณาตรวจ Trello');
      let name=rec.name||rec.vendor||'รายการคอร์ส';if(b.kind==='enrollment')name=s.customers.find(x=>x.id===rec.customerId).name+' • '+s.courses.find(x=>x.id===rec.courseId).name;
      const desc=marker+'\nรายการจาก MY TECH\n'+String(b.note||'').slice(0,1000)+'\nอ้างอิง: '+url.origin+'\nติดตามงานเท่านั้น ไม่ลงบัญชีหรือตัดสต๊อก';
      const card=matched[0]?await trello(env,'PUT','cards/'+matched[0].id,{name,idList:b.listId,desc:matched[0].desc?.includes(marker)?matched[0].desc:matched[0].desc+'\n'+desc}):await trello(env,'POST','cards',{name,idList:b.listId,desc});
      const fresh=await readState(env);fresh.state.links=fresh.state.links.filter(x=>!(x.recordId===rec.id&&x.kind===b.kind));fresh.state.links.push({id:uid(),recordId:rec.id,kind:b.kind,url:card.url,cardId:card.id,syncedAt:new Date().toISOString()});fresh.state.audit.push({id:uid(),by:u.name,action:'trello_push',createdAt:new Date().toISOString(),note:card.url});await commit(env,fresh,fresh.state);return reply({ok:true,url:card.url});
    }
  }
  return reply({error:'ไม่พบคำสั่ง'},404);
}
export default {async fetch(req,env,ctx){try{const response=await handle(req,env);const path=new URL(req.url).pathname;if(ctx?.waitUntil&&response.status<400&&((path==='/mcp'&&response.headers.get('X-Mytech-Flush')==='1')||['/api/action','/api/attachment','/api/trello/send','/api/trello/retry','/api/trello/jobs','/api/trello/config'].includes(path)))ctx.waitUntil((async()=>{const until=Date.now()+20000;for(let i=0;i<5&&Date.now()<until;i++){const count=await syncFlush(env,(method,endpoint,params)=>trello(env,method,endpoint,params));if(!count)break;}})().catch(()=>{}));return response;}catch(e){const known=e.status||!/^D1_|SQLITE|Cannot |Unexpected|.*is not/.test(e.message||'');return reply({error:known?(e.message?.includes('UNIQUE')?'รายการนี้มีอยู่แล้ว':e.message||'ทำรายการไม่สำเร็จ'):'ระบบขัดข้อง กรุณาลองอีกครั้ง'},e.status|| (known?400:500));}}};
