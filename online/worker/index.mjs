import {initial,mutate,summary,active,uid,assert} from '../my-tech-accounting/model.mjs';
import {documentHtml} from '../my-tech-accounting/documents.mjs';
import {payrollInitial,payrollMutate,payslipHtml,validatePayroll} from './payroll.mjs';
import {assets,seedState} from './generated.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function reply(body,status=200,type='application/json; charset=utf-8',extra={}){return new Response(type.startsWith('application/json')?JSON.stringify(body):body,{status,headers:{...headers,'Content-Type':type,...extra}});}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const email=v=>String(v||'').trim().toLowerCase();
const requireOwner=u=>{if(u.role!=='owner')fail('เฉพาะเจ้าของเท่านั้น',403);};
const requireWriter=u=>{if(!['owner','staff'].includes(u.role))fail('คุณมีสิทธิ์ดูอย่างเดียว กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์',403);};
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
  return {revision:row.revision,state:payrollInitial({...initial(),...JSON.parse(row.json)})};
}
const sanitizeCustomer=c=>({...c,phone:'',line:'',address:'',taxId:'',note:''});
export function visibleState(s,u){
  const copy=structuredClone(s);
  if(u.role!=='owner'){
    copy.accounts=copy.accounts.filter(a=>a.scope==='business');const ids=new Set(copy.accounts.map(a=>a.id));
    copy.entries=copy.entries.filter(e=>ids.has(e.accountId));copy.debts=copy.debts.filter(d=>d.scope==='business');
    const salaryIds=new Set(copy.entries.filter(e=>e.payrollId).map(e=>e.id)),totals=new Map();
    for(const e of active(copy).filter(e=>e.payrollId)){
      const key=e.accountId+':'+e.date,prev=totals.get(key)||{id:'salary-summary-'+key,date:e.date,accountId:e.accountId,type:'expense',amount:0,cash:0,project:'เงินเดือนรวม',note:'ค่าใช้จ่ายเงินเดือนรวมประจำวัน · รายละเอียดเฉพาะเจ้าของ',by:'ระบบสรุป',createdAt:e.createdAt};
      prev.amount+=e.amount;prev.cash+=e.cash;totals.set(key,prev);
    }
    copy.entries=copy.entries.filter(e=>!salaryIds.has(e.id)&&!salaryIds.has(e.reverses)).concat([...totals.values()]);
    copy.pending=[];copy.audit=[];copy.employees=[];copy.payroll=[];copy.requests=[];
    delete copy.restoreId;
    if(u.role==='viewer'){
      copy.customers=copy.customers.map(sanitizeCustomer);
      copy.documents=copy.documents.map(d=>({...d,customer:sanitizeCustomer(d.customer),...(d.company?{company:{...d.company,paymentInfo:'',taxId:'',address:'',phone:''}}:{})}));
      copy.company={...copy.company,paymentInfo:'',taxId:'',address:'',phone:''};
      copy.trello={...copy.trello,cards:[],lists:[]};copy.links=[];
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
async function recordAction(env,u,b){
  if(['employee','payrollSave','payrollPay','payrollCancel'].includes(b.action))requireOwner(u);
  validRequest(b);const row=await readState(env);
  if(row.state.requests.includes(b.requestId))return {duplicate:true};
  const out=['employee','payrollSave','payrollPay','payrollCancel'].includes(b.action)?payrollMutate(row.state,b.action,b.payload||{},u):mutate(row.state,b.action,b.payload||{},u);
  out.state.requests.push(b.requestId);await commit(env,row,out.state);return {result:out.result};
}
const toBase64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
const fromBase64=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));
async function attachmentRows(env){return (await env.DB.prepare('SELECT * FROM attachments').all()).results;}
function backupResponse(env,state,rows,filename='MYTECH-backup.json'){
  const encoder=new TextEncoder();
  async function* chunks(){yield JSON.stringify({format:'MYTECH_BACKUP_V1',createdAt:new Date().toISOString(),state}).slice(0,-1)+',"attachments":[';
    for(let i=0;i<rows.length;i++){const a=rows[i],file=a.base64?null:await env.BUCKET.get('attachments/'+a.id);assert(a.base64||file,'ไม่พบไฟล์หลักฐาน');const body=a.base64||toBase64(new Uint8Array(await file.arrayBuffer()));yield (i?',':'')+JSON.stringify({id:a.id,record_id:a.record_id,name:a.name,mime:a.mime,body,by_user:a.by_user});}
    yield ']}';
  }
  const iterator=chunks();return reply(new ReadableStream({async pull(controller){try{const r=await iterator.next();if(r.done)controller.close();else controller.enqueue(encoder.encode(r.value));}catch(e){controller.error(e);}}}),200,'application/octet-stream',{'Content-Disposition':'attachment; filename="'+filename+'"'});
}
async function saveRecovery(env,row){const id=uid(),key='recovery/'+id+'.json',createdAt=new Date().toISOString(),attachments=await attachmentRows(env);const current=await env.DB.prepare('SELECT revision FROM app_state WHERE id=1').first();if(current.revision!==row.revision)fail('ข้อมูลเปลี่ยนระหว่างสำรองก่อนกู้คืน กรุณาเริ่มใหม่',409);await env.BUCKET.put(key,JSON.stringify({state:row.state,attachments}));await env.DB.prepare('INSERT INTO recovery_backups VALUES(?,?,?)').bind(id,createdAt,key).run();}
function attachmentMetadata(a){assert(a&&typeof a.record_id==='string'&&typeof a.name==='string'&&a.name.length<=180&&['image/png','image/jpeg','image/webp','application/pdf'].includes(a.mime),'ไฟล์แนบไม่ถูกต้อง');return {id:uid(),record_id:a.record_id,name:a.name,mime:a.mime,by_user:String(a.by_user||'owner').slice(0,200),base64:''};}
async function applyRestore(env,u,row,next,files){
  const tag=uid();next.restoreId=tag;next.audit.push({id:uid(),by:u.name,action:'restore',createdAt:new Date().toISOString(),note:'กู้คืนข้อมูล'});
  await saveRecovery(env,row);
  const guard="EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.restoreId')=?)",extra=[env.DB.prepare('DELETE FROM attachments WHERE '+guard).bind(tag)];
  if(files.length)extra.push(env.DB.prepare("INSERT INTO attachments SELECT json_extract(value,'$.id'),json_extract(value,'$.record_id'),json_extract(value,'$.name'),json_extract(value,'$.mime'),'',json_extract(value,'$.by_user') FROM json_each(?) WHERE "+guard).bind(JSON.stringify(files),tag));
  await commit(env,row,next,extra);
}
async function loadStage(env,id,u){assert(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'ไม่พบชุดกู้คืน');const file=await env.BUCKET.get('restore/'+id+'.json');assert(file,'ไม่พบชุดกู้คืน');const stage=JSON.parse(await file.text());assert(stage.ownerId===u.id&&Date.now()-stage.createdAt<3600000,'ชุดกู้คืนหมดอายุ กรุณาเลือกไฟล์ใหม่');return stage;}
async function seal(env,value){assert(env.DATA_KEY,'ยังไม่ได้ตั้งกุญแจเข้ารหัสฝั่งเซิร์ฟเวอร์');const key=await crypto.subtle.importKey('raw',fromBase64(env.DATA_KEY),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));return JSON.stringify({iv:toBase64(iv),data:toBase64(new Uint8Array(enc))});}
async function unseal(env,value){const v=JSON.parse(value),key=await crypto.subtle.importKey('raw',fromBase64(env.DATA_KEY),'AES-GCM',false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(v.iv)},key,fromBase64(v.data))));}
async function trello(env,method,endpoint,params={}){
  const row=await env.DB.prepare("SELECT value FROM secrets WHERE id='trello'").first();assert(row,'ตั้งค่า Trello ก่อนใช้งาน');const c=await unseal(env,row.value),url=new URL('https://api.trello.com/1/'+endpoint);url.searchParams.set('key',c.key);url.searchParams.set('token',c.token);
  const options={method,signal:AbortSignal.timeout(20000)};if(method==='GET'){for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));}else{options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(params);}
  let r;try{r=await fetch(url,options);}catch{fail('ติดต่อ Trello ไม่สำเร็จ ตรวจสถานะก่อนลองเขียนอีกครั้ง',502);}if(!r.ok)fail('Trello ตอบกลับผิดพลาด ('+r.status+') กรุณาตรวจสิทธิ์การเชื่อมต่อ',502);return r.json();
}
function validateRestore(backup){
  assert(backup?.format==='MYTECH_BACKUP_V1'&&backup.state?.version===1,'ไฟล์สำรองไม่ถูกต้อง');
  const s=backup.state,base=initial();assert(Object.keys(base).every(k=>k in s),'โครงสร้างข้อมูลไม่ครบ');
  for(const [k,v] of Object.entries(base))if(Array.isArray(v))assert(Array.isArray(s[k]),'ข้อมูล '+k+' ต้องเป็นรายการ');
  assert(s.company&&typeof s.company.name==='string'&&s.trello&&Array.isArray(s.trello.cards),'ข้อมูลกิจการไม่ครบ');
  for(const k of ['accounts','entries','products','lots','customers','documents','debts','payroll','employees']){const rows=s[k]||[];assert(Array.isArray(rows),'ข้อมูล '+k+' ไม่ถูกต้อง');const ids=new Set();for(const row of rows){assert(row&&typeof row.id==='string'&&!ids.has(row.id),'รหัสรายการ '+k+' ซ้ำหรือไม่ถูกต้อง');ids.add(row.id);}}
  assert(s.entries.every(e=>s.accounts.some(a=>a.id===e.accountId)&&Number.isSafeInteger(e.amount)&&Number.isSafeInteger(e.cash)),'รายการเงินไม่ถูกต้อง');
  assert(s.lots.every(l=>s.products.some(p=>p.id===l.productId)&&Number.isSafeInteger(l.quantity)&&l.quantity>=0&&Number.isSafeInteger(l.value)&&l.value>=0),'ข้อมูลสต๊อกไม่ถูกต้อง');
  summary(s);
  validatePayroll(payrollInitial(s));
  assert(Array.isArray(backup.attachments||[])&&(backup.attachments||[]).length<=500,'ไฟล์แนบเกินจำนวนที่รองรับ');
  return payrollInitial(s);
}
async function handle(req,env){
  const url=new URL(req.url),p=url.pathname;
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
  if(p==='/api/state'&&req.method==='GET'){
    const {state}=await readState(env),out=visibleState(state,u);out.attachmentList=[];
    if(u.role!=='viewer'){const ids=new Set([...out.entries,...out.movements,...out.purchases,...out.customers].map(x=>x.id));out.attachmentList=(await env.DB.prepare('SELECT id,record_id AS recordId,name,mime FROM attachments').all()).results.filter(a=>u.role==='owner'||ids.has(a.recordId));}
    out.trelloConfigured=u.role==='owner'&&!!await env.DB.prepare("SELECT id FROM secrets WHERE id='trello'").first();
    out.members=u.role==='owner'?(await env.DB.prepare('SELECT email,name,role FROM members ORDER BY email').all()).results:[];
    return reply(out);
  }
  if(p==='/api/action'&&req.method==='POST')return reply(await recordAction(env,u,await body(req)));
  if(p==='/api/members'&&req.method==='POST'){
    requireOwner(u);const b=await body(req),mail=email(b.email);assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)&&mail.length<=254,'กรอกอีเมลให้ถูกต้อง');assert(mail!==email(env.OWNER_EMAIL),'บัญชีเจ้าของเปลี่ยนสิทธิ์จากหน้านี้ไม่ได้');
    if(b.remove===true)await env.DB.prepare('DELETE FROM members WHERE email=?').bind(mail).run();else{assert(typeof b.name==='string'&&b.name.trim()&&b.name.length<=100,'กรอกชื่อผู้แก้ไข');await env.DB.prepare("INSERT INTO members(email,role,name) VALUES(?,'staff',?) ON CONFLICT(email) DO UPDATE SET name=excluded.name").bind(mail,b.name.trim()).run();}
    return reply({ok:true});
  }
  if(p==='/api/document'&&req.method==='GET'){
    const {state}=await readState(env),s=visibleState(state,u),doc=s.documents.find(d=>d.id===url.searchParams.get('id'));assert(doc,'ไม่พบเอกสาร');return reply(documentHtml(s,doc),200,'text/html; charset=utf-8');
  }
  if(p==='/api/payslip'&&req.method==='GET'){requireOwner(u);const {state}=await readState(env),slip=state.payroll.find(x=>x.id===url.searchParams.get('id'));assert(slip,'ไม่พบสลิป');return reply(payslipHtml(state,slip),200,'text/html; charset=utf-8');}
  if(p==='/api/backup'&&req.method==='GET'){
    requireOwner(u);const row=await readState(env),attachments=await attachmentRows(env),current=await env.DB.prepare('SELECT revision FROM app_state WHERE id=1').first();if(current.revision!==row.revision)fail('ข้อมูลเปลี่ยนระหว่างสำรอง กรุณาดาวน์โหลดอีกครั้ง',409);return backupResponse(env,row.state,attachments);
  }
  if(p==='/api/recovery'&&req.method==='GET'){requireOwner(u);const id=url.searchParams.get('id');if(!id)return reply((await env.DB.prepare('SELECT id,created_at FROM recovery_backups ORDER BY created_at DESC LIMIT 20').all()).results);const r=await env.DB.prepare('SELECT json FROM recovery_backups WHERE id=?').bind(id).first();assert(r,'ไม่พบสำเนา');const file=await env.BUCKET.get(r.json);assert(file,'ไม่พบไฟล์สำเนา');const saved=JSON.parse(await file.text());return backupResponse(env,saved.state,saved.attachments,'MYTECH-before-restore.json');}
  if(p==='/api/restore/prepare'&&req.method==='POST'){
    requireOwner(u);const b=await body(req);assert(b.confirm==='กู้คืนข้อมูล','พิมพ์คำยืนยันให้ถูกต้อง');const next=validateRestore(b.backup),row=await readState(env),id=uid(),files=(b.backup.attachments||[]).map(attachmentMetadata);
    const validRecords=new Set([...next.entries,...next.movements,...next.purchases,...next.customers].map(x=>x.id));assert(files.every(a=>validRecords.has(a.record_id)),'ไฟล์แนบอ้างอิงรายการที่ไม่มีอยู่');
    await env.BUCKET.put('restore/'+id+'.json',JSON.stringify({ownerId:u.id,createdAt:Date.now(),revision:row.revision,state:next,files}));return reply({id,count:files.length});
  }
  if(p==='/api/restore/file'&&req.method==='POST'){
    requireOwner(u);const b=await body(req),stage=await loadStage(env,b.id,u),a=stage.files[b.index];assert(Number.isInteger(b.index)&&a&&typeof b.base64==='string','ไม่พบไฟล์ในชุดกู้คืน');const bytes=fromBase64(b.base64);assert(bytes.length>0&&bytes.length<=10*1024*1024,'ไฟล์หลักฐานเกิน 10 MB');await env.BUCKET.put('attachments/'+a.id,bytes);return reply({ok:true});
  }
  if(p==='/api/restore/commit'&&req.method==='POST'){
    requireOwner(u);const b=await body(req),stage=await loadStage(env,b.id,u),row=await readState(env);if(row.revision!==stage.revision)fail('ข้อมูลเปลี่ยนระหว่างกู้คืน กรุณาตรวจรายการล่าสุดแล้วเริ่มกู้คืนใหม่',409);
    for(const a of stage.files)assert(await env.BUCKET.get('attachments/'+a.id),'ยังส่งไฟล์หลักฐานไม่ครบ');
    await applyRestore(env,u,row,stage.state,stage.files);return reply({ok:true});
  }
  if(p==='/api/restore'&&req.method==='POST'){
    requireOwner(u);const b=await body(req);assert(b.confirm==='กู้คืนข้อมูล','พิมพ์คำยืนยันให้ถูกต้อง');const next=validateRestore(b.backup),row=await readState(env),files=[];
    for(const a of b.backup.attachments||[]){const meta=attachmentMetadata(a),bytes=fromBase64(a.body);assert(bytes.length>0&&bytes.length<=10*1024*1024,'ไฟล์หลักฐานเกิน 10 MB');await env.BUCKET.put('attachments/'+meta.id,bytes);files.push(meta);}
    await applyRestore(env,u,row,next,files);return reply({ok:true});
  }
  if(p==='/api/attachment'&&req.method==='POST'){
    const b=await body(req),row=await readState(env),s=visibleState(row.state,u);assert([...row.state.entries,...row.state.movements,...row.state.purchases,...row.state.customers].some(x=>x.id===b.recordId),'ไม่พบรายการต้นฉบับ');assert([...s.entries,...s.movements,...s.purchases,...s.customers].some(x=>x.id===b.recordId),'ไม่พบรายการที่แนบ');assert(['image/png','image/jpeg','image/webp','application/pdf'].includes(b.mime),'รองรับ PNG, JPG, WebP, PDF');const bytes=fromBase64(b.base64);assert(bytes.length>0&&bytes.length<=10*1024*1024,'ไฟล์ต้องไม่เกิน 10 MB');if(b.mime==='application/pdf')assert(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-','ไฟล์ PDF ไม่ถูกต้อง');const id=uid();await env.BUCKET.put('attachments/'+id,bytes);row.state.attachmentRevision=id;
    await commit(env,row,row.state,[env.DB.prepare("INSERT INTO attachments SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.attachmentRevision')=?)").bind(id,b.recordId,String(b.name).slice(0,180),b.mime,'',u.id,id)]);return reply({id});
  }
  if(p.startsWith('/api/file/')&&req.method==='GET'){
    requireWriter(u);const a=await env.DB.prepare('SELECT * FROM attachments WHERE id=?').bind(p.split('/').pop()).first();assert(a,'ไม่พบไฟล์');const {state}=await readState(env),s=visibleState(state,u);if(u.role!=='owner')assert([...s.entries,...s.movements,...s.purchases,...s.customers].some(x=>x.id===a.record_id),'ไม่พบไฟล์');const file=a.base64?null:await env.BUCKET.get('attachments/'+a.id);assert(a.base64||file,'ไม่พบไฟล์หลักฐาน');return reply(a.base64?fromBase64(a.base64):await file.arrayBuffer(),200,a.mime,{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(a.name)});
  }
  if(p.startsWith('/api/trello/')&&req.method==='POST'){
    requireOwner(u);const b=await body(req);
    if(p==='/api/trello/config'){assert(/^[a-fA-F0-9]{32}$/.test(b.key)&&typeof b.token==='string'&&b.token.length>=30&&b.token.length<=512,'ตรวจ API Key/Token');await env.DB.prepare("INSERT OR REPLACE INTO secrets VALUES('trello',?)").bind(await seal(env,{key:b.key,token:b.token})).run();return reply({ok:true});}
    if(p==='/api/trello/refresh'){
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
export default {async fetch(req,env){try{return await handle(req,env);}catch(e){const known=e.status||!/^D1_|SQLITE|Cannot |Unexpected|.*is not/.test(e.message||'');return reply({error:known?(e.message?.includes('UNIQUE')?'รายการนี้มีอยู่แล้ว':e.message||'ทำรายการไม่สำเร็จ'):'ระบบขัดข้อง กรุณาลองอีกครั้ง'},e.status|| (known?400:500));}}};
