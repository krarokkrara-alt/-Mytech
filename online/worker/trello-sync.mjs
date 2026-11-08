import {uid,assert,active,invoicePaid} from '../my-tech-accounting/model.mjs';
import {documentHtml} from '../my-tech-accounting/documents.mjs';
import {receiptHtml} from './receipts.mjs';
import {payslipHtml,paymentActive} from './payroll.mjs';
import {assets} from './generated.mjs';
import {hydrateSignature} from './signature.mjs';

export const syncCollections={entry:'entries',document:'documents',receipt:'receipts',customer:'customers',enrollment:'enrollments',product:'products',purchase:'purchases',movement:'movements',course:'courses',debt:'debts',payroll:'payroll',employee:'employees',account:'accounts',bom:'boms',attendance:'attendance'};
const syncTitles={entry:'รายการรับ–จ่าย',document:'เอกสาร',receipt:'ใบเสร็จรับเงิน',customer:'ลูกค้า',enrollment:'ลงทะเบียน',product:'สินค้า',purchase:'ใบสั่งซื้อ',movement:'ความเคลื่อนไหวสต๊อก',course:'คอร์ส',debt:'หนี้',payroll:'เงินเดือน',employee:'พนักงาน',account:'บัญชีเงิน',bom:'สูตรประกอบ',attendance:'เข้าร่วมคอร์ส'};
const syncMoney=n=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}).format((n||0)/100);
const syncEntryTypes={income:'รายรับ',expense:'รายจ่าย',advance:'เงินเบิก',settlement:'เคลียร์เงินเบิก',advance_return:'คืนเงินเบิก',opening:'ยอดยกมา',reversal:'กลับรายการ',owner_in:'เจ้าของเติมเงิน',owner_out:'เจ้าของถอนเงิน',debt_repay:'คืนเงินต้น',interest:'ดอกเบี้ย'};
export function syncRecord(s,kind,id){const col=syncCollections[kind];return col?(s[col]||[]).find(r=>r.id===id):null;}
export function syncScope(s,kind,record,depth=0){
  if(['employee','payroll'].includes(kind))return 'private';
  if(kind==='entry'){if(record.reverses){const original=s.entries.find(e=>e.id===record.reverses);return !original||depth>20?'private':syncScope(s,'entry',original,depth+1);}return record.payrollId||s.accounts.find(a=>a.id===record.accountId)?.scope==='personal'?'private':'business';}
  if(kind==='receipt'){const e=s.entries.find(e=>e.id===record.entryId);return e?syncScope(s,'entry',e):'private';}
  if(['account','debt'].includes(kind))return record.scope==='personal'?'private':'business';
  return 'business';
}
export function syncAssertAccess(s,kind,id,user){const r=syncRecord(s,kind,id);assert(r,'ไม่พบรายการสำหรับ Trello');if(syncScope(s,kind,r)==='private'&&user.role!=='owner')throw Object.assign(new Error('เฉพาะเจ้าของส่งข้อมูลส่วนตัวหรือเงินเดือนได้'),{status:403});return r;}
export function syncActionKind(action){return {entry:'entry',reverse:'entry',document:'document',cancelDocument:'document',customer:'customer',enroll:'enrollment',course:'course',product:'product',purchase:'purchase',movement:'movement',assemble:'movement',account:'account',debt:'debt',employee:'employee',payrollSave:'payroll',payrollPay:'payroll',payrollCancel:'payroll',bom:'bom',attendance:'attendance',issueReceipt:'receipt'}[action];}
export function syncSnapshot(s,kind,r,origin,event){
  let title=syncTitles[kind]+': '+(r.number||r.name||r.note||r.vendor||r.month||r.id.slice(0,8)),lines=[syncTitles[kind],r.date?'วันที่: '+r.date:'',r.by?'ผู้บันทึก: '+r.by:''];let html=null,filename=null;
  if(kind==='entry'){title=(syncEntryTypes[r.type]||r.type)+' · '+syncMoney(r.amount)+' บาท · '+r.note;lines.push('ประเภท: '+(syncEntryTypes[r.type]||r.type),'จำนวนเงิน: '+syncMoney(r.amount)+' บาท','บัญชี: '+(s.accounts.find(a=>a.id===r.accountId)?.name||''),'รายละเอียด: '+r.note,'โครงการ: '+(r.project||'—'),'สถานะ: '+(active(s).some(e=>e.id===r.id)?'มีผล':'กลับรายการ/ยกเลิกแล้ว'));if(r.invoiceId)lines.push('Invoice: '+(s.documents.find(d=>d.id===r.invoiceId)?.number||r.invoiceId));}
  else if(kind==='document'){const quote=r.kind==='quote';title=(quote?'ใบเสนอราคา ':'Invoice ')+r.number+' · '+r.customer.name;lines.push('ประเภท: '+(quote?'ใบเสนอราคา':'Invoice'),'เลขที่: '+r.number,'ลูกค้า: '+r.customer.name,'สถานะ: '+r.status,...r.items.map(x=>x.description+' | '+(x.quantity/1000)+' × '+syncMoney(x.unitPrice)+' = '+syncMoney(x.total)+' บาท'),'ส่วนลด: '+syncMoney(r.discount),'รวม: '+syncMoney(r.total)+' บาท',quote?'':'รับแล้ว: '+syncMoney(invoicePaid(s,r))+' / คงเหลือ: '+syncMoney(r.total-invoicePaid(s,r)),'หมายเหตุ: '+r.note);html=documentHtml(s,r);filename=r.number+'.html';}
  else if(kind==='receipt'){title='ใบเสร็จ '+r.number+' · '+r.customer.name;lines.push('เลขที่: '+r.number,'ผู้ชำระ: '+r.customer.name,'จำนวนเงิน: '+syncMoney(r.amount)+' บาท','รายละเอียด: '+r.note,'สถานะ: '+(active(s).some(e=>e.id===r.entryId)?'รับเงินจริง':'ยกเลิก/กลับรายการแล้ว'));html=receiptHtml(s,r);filename=r.number+'.html';}
  else if(kind==='payroll'){title='เงินเดือน '+r.month+' · '+r.employee.name;lines.push('พนักงาน: '+r.employee.name,'เดือน: '+r.month,'ฐานเงินเดือน: '+syncMoney(r.baseSalary),...r.earnings.map(x=>'เพิ่ม '+x.label+': '+syncMoney(x.amount)),...r.deductions.map(x=>'หัก '+x.label+': '+syncMoney(x.amount)),'สุทธิ: '+syncMoney(r.net),'สถานะ: '+(r.status==='cancelled'?'ยกเลิก':paymentActive(s,r)?'จ่ายแล้ว':'ยังไม่จ่าย / กลับรายการจ่ายแล้ว'),'หมายเหตุ: '+r.note);html=payslipHtml(s,r);filename='payroll-'+r.month+'-'+r.employee.code+'.html';}
  else {for(const [key,label] of Object.entries({name:'ชื่อ',code:'รหัส',sku:'รหัสสินค้า',vendor:'ผู้ขาย',note:'รายละเอียด',project:'โครงการ',position:'ตำแหน่ง',month:'เดือน',type:'ประเภท',location:'ที่เก็บ',destination:'ที่เก็บปลายทาง',phone:'โทรศัพท์',line:'LINE',address:'ที่อยู่'}))if(r[key])lines.push(label+': '+r[key]);for(const [key,label] of Object.entries({amount:'ยอดเงิน',total:'ยอดรวม',price:'ราคา',value:'ต้นทุน',baseSalary:'เงินเดือนพื้นฐาน'}))if(Number.isInteger(r[key]))lines.push(label+': '+syncMoney(r[key])+' บาท');if(r.productId)lines.push('สินค้า: '+(s.products.find(p=>p.id===r.productId)?.name||r.productId));if(r.customerId)lines.push('ลูกค้า: '+(s.customers.find(c=>c.id===r.customerId)?.name||r.customerId));if(r.courseId)lines.push('คอร์ส: '+(s.courses.find(c=>c.id===r.courseId)?.name||r.courseId));if(r.quantity)lines.push('จำนวน: '+r.quantity/1000);}
  if(html)html=html.replace('<link rel="stylesheet" href="/document.css">','<style>'+assets['/document.css'].body+'</style>').replace(/<div class="controls">.*?<\/div>/s,'').replace(/<script[^>]*>.*?<\/script>/gs,'');
  lines.push('เหตุการณ์: '+event,'อ้างอิง MY TECH: '+origin+'/?page='+(kind==='document'||kind==='receipt'?'documents':kind==='entry'?'wallet':'dashboard'),'เอกสาร/การ์ดนี้ไม่ลงบัญชีซ้ำ');
  return {title:title.slice(0,160),text:lines.filter(Boolean).join('\n').slice(0,14000),html,filename};
}
export function syncCatalog(s,boardId){if(boardId===s.trello.boardId)return {id:boardId,name:s.trello.boardName,lists:s.trello.lists||[],cards:s.trello.cards||[]};return (s.trello.catalog||[]).find(b=>b.id===boardId);}
export function syncValidateTarget(s,target,user,trusted=false){
  assert(target&&typeof target==='object','เลือกปลายทาง Trello');const boardId=String(target.boardId||s.trello.boardId),catalog=syncCatalog(s,boardId);assert(/^[a-f0-9]{24}$/.test(boardId)&&catalog,'รีเฟรชบอร์ด Trello ก่อนเลือก');
  if(user.role!=='owner')assert(boardId===s.trello.boardId,'ผู้แก้ไขส่งได้เฉพาะบอร์ดหลักที่เจ้าของกำหนด');
  const cardId=String(target.cardId||''),listId=String(target.listId||'');if(cardId){const card=catalog.cards.find(c=>c.id===cardId);assert((card&&(!listId||card.listId===listId))||(trusted&&/^[a-f0-9]{24}$/.test(cardId)&&catalog.lists.some(l=>l.id===listId)),'การ์ดไม่อยู่ในลิสต์/บอร์ดที่เลือก');return {boardId,listId:card?.listId||listId,cardId,title:String(target.title||'').slice(0,160),...(trusted&&target.parentKey?{parentKey:target.parentKey}:{})};}
  assert(catalog.lists.some(l=>l.id===listId),'เลือกลิสต์ปลายทาง');return {boardId,listId,cardId:'',title:String(target.title||'').slice(0,160)};
}
export async function syncPrepare(env,s,user,kind,recordId,explicit,origin,eventId,action,attachmentId=null,parentKey=null){
  const record=syncAssertAccess(s,kind,recordId,user),scope=syncScope(s,kind,record),key=kind+':'+recordId;
  if(explicit?.enabled===false)return {statements:[],queued:false};
  const previous=await env.DB.prepare('SELECT target FROM trello_routes WHERE record_key=?').bind(key).first();
  let raw=explicit?.enabled?explicit:previous?JSON.parse(previous.target):scope==='business'&&s.trello.autoSync?.enabled?s.trello.autoSync:null;
  if(!raw)return {statements:[],queued:false};
  const target=syncValidateTarget(s,raw,user,!explicit?.enabled&&!!previous),renderRecord=structuredClone(record);if(!attachmentId&&['document','receipt','payroll'].includes(kind))renderRecord.company=await hydrateSignature(env,record.company||{...s.company,signature:null});const snapshot=syncSnapshot(s,kind,renderRecord,origin,action);if(parentKey)target.parentKey=parentKey;if(attachmentId){snapshot.attachmentId=attachmentId;snapshot.html=null;snapshot.filename=null;}
  const id=eventId+':'+kind+':'+recordId+(attachmentId?':'+attachmentId:''),now=Date.now(),guard="EXISTS(SELECT 1 FROM app_state WHERE json_extract(json,'$.syncCommitTag')=?)";
  return {queued:true,id,statements:[
    env.DB.prepare('INSERT INTO trello_routes(record_key,kind,record_id,scope,target) SELECT ?,?,?,?,? WHERE '+guard+' ON CONFLICT(record_key) DO UPDATE SET target=excluded.target,scope=excluded.scope').bind(key,kind,recordId,scope,JSON.stringify(target),eventId),
    env.DB.prepare("INSERT OR IGNORE INTO trello_jobs(id,record_key,kind,record_id,scope,target,snapshot,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE "+guard).bind(id,key,kind,recordId,scope,JSON.stringify(target),JSON.stringify(snapshot),now,now,eventId)
  ]};
}
export async function syncVisible(env,user){
  if(user.role==='viewer')return [];
  const row=await env.DB.prepare("SELECT json_extract(json,'$.trello.boardId') AS board FROM app_state WHERE id=1").first();
  return (await env.DB.prepare('SELECT id,kind,record_id AS recordId,scope,target,status,attempts,last_error AS error,created_at AS createdAt,updated_at AS updatedAt FROM trello_jobs '+(user.role==='owner'?'':"WHERE scope='business' ")+"ORDER BY CASE WHEN status IN ('pending','working','error','uncertain') THEN 0 ELSE 1 END,created_at DESC LIMIT 200").all()).results.map(j=>({...j,target:JSON.parse(j.target)})).filter(j=>user.role==='owner'||j.target.boardId===row?.board);
}
async function syncSaveProgress(env,job,progress,phase=null){await env.DB.prepare('UPDATE trello_jobs SET progress=?,phase=?,updated_at=? WHERE id=?').bind(JSON.stringify(progress),phase,Date.now(),job.id).run();job.phase=phase;job.progress=JSON.stringify(progress);}
async function syncComments(api,cardId,marker){let before;for(let page=0;page<10;page++){const rows=await api('GET','cards/'+cardId+'/actions',{filter:'commentCard',limit:1000,...(before?{before}:{})});if(rows.some(a=>a.data?.text?.includes(marker)))return true;if(rows.length<1000)return false;before=rows.at(-1).id;}throw new Error('ความเห็นบนการ์ดมีจำนวนมาก กรุณาตรวจสถานะด้วยตนเองก่อนส่งซ้ำ');}
async function syncPerform(env,job,api){
  const target=JSON.parse(job.target),snapshot=JSON.parse(job.snapshot),progress=JSON.parse(job.progress||'{}'),ambiguous=job.phase,force=progress.allowRetry===true;
  delete progress.allowRetry;const marker='MYTECH-REF:'+job.record_key,eventMarker='MYTECH-EVENT:'+job.id;
  let cardId=progress.cardId||target.cardId;
  if(!cardId&&target.parentKey){const parent=await env.DB.prepare('SELECT target FROM trello_routes WHERE record_key=?').bind(target.parentKey).first();cardId=parent?JSON.parse(parent.target).cardId:null;if(!cardId)throw Object.assign(new Error('รอส่งรายการต้นทางก่อนส่งเอกสารที่เกี่ยวข้อง'),{definite:true});}
  if(!cardId){const route=await env.DB.prepare('SELECT target FROM trello_routes WHERE record_key=?').bind(job.record_key).first();const r=route?JSON.parse(route.target):null;if(r?.boardId===target.boardId&&r?.listId===target.listId)cardId=r.cardId;}
  if(!cardId){
    const cards=await api('GET','boards/'+target.boardId+'/cards',{filter:'all',fields:'id,name,desc,url,idBoard,idList'}),matched=cards.filter(c=>c.desc?.includes(marker));assert(matched.length<=1,'พบการ์ดอ้างอิงซ้ำ กรุณาตรวจ Trello');
    if(matched[0]){cardId=matched[0].id;progress.cardUrl=matched[0].url;}
    else {if(ambiguous==='card'&&!force)throw Object.assign(new Error('ผลสร้างการ์ดยังไม่แน่นอน ตรวจบอร์ดก่อนยืนยันส่งใหม่'),{uncertain:true});const list=await api('GET','lists/'+target.listId,{fields:'idBoard,closed'});assert(list.idBoard===target.boardId&&!list.closed,'ลิสต์ถูกปิดหรือย้ายบอร์ด กรุณาเลือกใหม่');await syncSaveProgress(env,job,progress,'card');const card=await api('POST','cards',{idList:target.listId,name:target.title||snapshot.title,desc:marker+'\n'+snapshot.text});cardId=card.id;progress.cardUrl=card.url;}
    progress.cardId=cardId;target.cardId=cardId;target.url=progress.cardUrl;
    await env.DB.prepare('UPDATE trello_jobs SET target=? WHERE id=?').bind(JSON.stringify(target),job.id).run();
    await env.DB.prepare('UPDATE trello_routes SET target=? WHERE record_key=? AND json_extract(target,\'$.boardId\')=? AND json_extract(target,\'$.listId\')=?').bind(JSON.stringify(target),job.record_key,target.boardId,target.listId).run();await syncSaveProgress(env,job,progress);
  }
  const card=await api('GET','cards/'+cardId,{fields:'id,idBoard,idList,url,closed'});assert(card.idBoard===target.boardId&&!card.closed,'การ์ดถูกปิดหรือย้ายบอร์ด กรุณาเลือกปลายทางใหม่');
  progress.cardId=cardId;progress.cardUrl=card.url;target.cardId=cardId;target.url=card.url;
  await env.DB.prepare('UPDATE trello_jobs SET target=? WHERE id=?').bind(JSON.stringify(target),job.id).run();
  if(!progress.comment){if(await syncComments(api,cardId,eventMarker))progress.comment=true;else{if(ambiguous==='comment'&&!force)throw Object.assign(new Error('ผลเขียนข้อความยังไม่แน่นอน ตรวจการ์ดก่อนยืนยันส่งใหม่'),{uncertain:true});await syncSaveProgress(env,job,progress,'comment');await api('POST','cards/'+cardId+'/actions/comments',{text:snapshot.text+'\n\n'+eventMarker});progress.comment=true;}await syncSaveProgress(env,job,progress);}
  const uploads=[];
  if(snapshot.html)uploads.push({key:'document',name:'MYTECH-'+job.id.replace(/[^a-zA-Z0-9-]/g,'-')+'-'+snapshot.filename,mime:'text/html',bytes:new TextEncoder().encode(snapshot.html)});
  if(snapshot.attachmentId){const a=await env.DB.prepare('SELECT * FROM attachments WHERE id=?').bind(snapshot.attachmentId).first();assert(a,'ไม่พบหลักฐานที่แนบ');const file=a.base64?null:await env.BUCKET.get('attachments/'+a.id);assert(a.base64||file,'ไม่พบไฟล์หลักฐาน');uploads.push({key:'file',name:'MYTECH-'+a.id+'-'+a.name,mime:a.mime,bytes:a.base64?Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0)):new Uint8Array(await file.arrayBuffer())});}
  for(const file of uploads){file.name=file.name.slice(0,250);if(progress[file.key])continue;const remote=await api('GET','cards/'+cardId+'/attachments',{fields:'id,name,url'});const match=remote.find(a=>a.name===file.name);if(match){progress[file.key]=match.id;await syncSaveProgress(env,job,progress);continue;}
    if(ambiguous===file.key&&!force)throw Object.assign(new Error('ผลอัปโหลดไฟล์ยังไม่แน่นอน ตรวจการ์ดก่อนยืนยันส่งใหม่'),{uncertain:true});
    await syncSaveProgress(env,job,progress,file.key);const multipart=new FormData();multipart.set('name',file.name.slice(0,250));multipart.set('mimeType',file.mime);multipart.set('file',new Blob([file.bytes],{type:file.mime}),file.name.slice(0,250));const sent=await api('POST','cards/'+cardId+'/attachments',multipart);progress[file.key]=sent.id;await syncSaveProgress(env,job,progress);
  }
  await env.DB.prepare("UPDATE trello_jobs SET status='done',phase=NULL,progress=?,last_error='',updated_at=? WHERE id=?").bind(JSON.stringify(progress),Date.now(),job.id).run();
}
export async function syncAcquireLock(env){const now=Date.now(),lock=uid();await env.DB.prepare('INSERT OR IGNORE INTO trello_sync_lock VALUES(1,\'\',0)').run();const claimed=await env.DB.prepare('UPDATE trello_sync_lock SET token=?,expires=? WHERE id=1 AND expires<?').bind(lock,now+120000,now).run();return claimed.meta.changes===1?lock:null;}
export async function syncReleaseLock(env,lock){await env.DB.prepare('UPDATE trello_sync_lock SET expires=0 WHERE id=1 AND token=?').bind(lock).run();}
export async function syncFlush(env,api){
  const now=Date.now(),lock=await syncAcquireLock(env);if(!lock)return;
  try{const job=await env.DB.prepare("SELECT * FROM trello_jobs WHERE (status IN ('pending','error') AND next_at<=?) OR (status='working' AND updated_at<?) ORDER BY created_at,id LIMIT 1").bind(now,now-120000).first();if(!job)return;
    await env.DB.prepare("UPDATE trello_jobs SET status='working',attempts=attempts+1,updated_at=? WHERE id=?").bind(now,job.id).run();
    try{await syncPerform(env,job,api);}catch(e){const uncertain=e.uncertain||job.phase&&!e.definite;await env.DB.prepare('UPDATE trello_jobs SET status=?,last_error=?,next_at=?,updated_at=?,phase=? WHERE id=?').bind(uncertain?'uncertain':'error',String(e.message||'ส่ง Trello ไม่สำเร็จ').slice(0,300),Date.now()+60000,Date.now(),e.definite?null:job.phase,job.id).run();}
    return true;
  }finally{await syncReleaseLock(env,lock);}
}
