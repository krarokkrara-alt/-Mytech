import {initial, mutate, summary, uid} from './model.mjs';
import {documentHtml} from './documents.mjs';
import seed from './seed.json' with {type:'json'};

class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
const check=(ok,status,message)=>{if(!ok)throw new ApiError(status,message);};
const normalEmail=v=>String(v||'').trim().toLowerCase();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200)=>Response.json(body,{status,headers});
export async function actor(db,env,identity){
  if(!identity?.userId||!identity?.email)return {id:'visitor',name:'ผู้เยี่ยมชม',role:'viewer'};
  const email=normalEmail(identity.email);
  const role=env.MYTECH_OWNER_EMAIL&&email===normalEmail(env.MYTECH_OWNER_EMAIL)?'owner':
    await db.prepare('SELECT email FROM accounting_editors WHERE email=?').bind(email).first()?'staff':'viewer';
  return {id:identity.userId,name:identity.displayName||email,email,role};
}
export async function loadState(db){
  // Insert the retained backup only once. A fresh visitor never receives ownership.
  await db.prepare('INSERT OR IGNORE INTO accounting_state(id,revision,json) VALUES(1,0,?)').bind(JSON.stringify(seed.state)).run();
  const row=await db.prepare('SELECT revision,json FROM accounting_state WHERE id=1').first();
  return {state:{...initial(),...JSON.parse(row.json)},revision:row.revision};
}
async function saveState(db,s,revision){
  const encoded=JSON.stringify(s);
  check(new TextEncoder().encode(encoded).length<=1500000,413,'ข้อมูลเกินขนาดที่รองรับ กรุณาสำรองข้อมูลและติดต่อผู้ดูแล');
  const r=await db.prepare('UPDATE accounting_state SET json=?,revision=revision+1 WHERE id=1 AND revision=?').bind(encoded,revision).run();
  check(r.meta.changes===1,409,'ข้อมูลเปลี่ยนจากอีกเครื่อง กรุณาโหลดใหม่ก่อนทำรายการอีกครั้ง');
}
export function visibleState(s,u){
  const out=structuredClone(s);
  if(u.role!=='owner'){
    out.accounts=out.accounts.filter(x=>x.scope==='business');
    const ids=new Set(out.accounts.map(x=>x.id));
    out.entries=out.entries.filter(x=>ids.has(x.accountId));
    out.debts=out.debts.filter(x=>x.scope==='business');
    out.pending=[];out.audit=[];out.requests=[];
  }
  const totals=summary(out);
  if(u.role==='viewer'){
    // Public visitors see business figures and stock, without personal/customer records.
    out.company={name:out.company.name};out.customers=[];out.courses=[];out.enrollments=[];out.attendance=[];out.documents=[];
    out.debts=[];out.purchases=[];out.links=[];out.boms=[];
    out.accounts=out.accounts.map(({id,name,scope,openingSet})=>({id,name,scope,openingSet}));
    out.entries=out.entries.map(({id,date,type,accountId,amount,cash,reverses})=>({id,date,type,accountId,amount,cash,reverses,note:'รายการกิจการ',project:''}));
    out.products=out.products.map(x=>({...x,note:'',by:undefined}));
    out.movements=out.movements.map(x=>({...x,note:'',project:'',by:undefined}));
    out.trello=initial().trello;
    totals.accounts=totals.accounts.map(({id,name,scope,openingSet,balance})=>({id,name,scope,openingSet,balance}));
  }
  return {...out,summary:totals,attachmentList:[],trelloConfigured:false};
}
async function readBody(req){
  check(Number(req.headers.get('content-length')||0)<=12*1024*1024,413,'คำขอใหญ่เกิน 12 MB');
  const reader=req.body?.getReader();let size=0;const chunks=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw new ApiError(413,'คำขอใหญ่เกิน 12 MB');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes)||'{}');}catch{throw new ApiError(400,'ข้อมูล JSON ไม่ถูกต้อง');}
}
const recordAllowed=(s,id)=>[...s.entries,...s.movements,...s.purchases,...s.customers].some(x=>x.id===id);
const ownerOnly=u=>check(u.role==='owner',403,'เฉพาะเจ้าของเท่านั้น');
export async function handleApi(req,env,identity){
  try{
    check(env.DB,503,'ฐานข้อมูลยังไม่พร้อม');const db=env.DB,url=new URL(req.url),p=url.pathname;
    const u=await actor(db,env,identity);
    if(req.method==='GET'&&p==='/api/session')return json({setup:false,user:u,mode:'online',ownerConfigured:!!env.MYTECH_OWNER_EMAIL});
    // Every mutation is authorized here, before parsing the request or touching records.
    if(req.method!=='GET'){
      check(req.method==='POST',405,'ไม่รองรับคำขอนี้');
      check(u.role==='owner'||u.role==='staff',identity?403:401,'กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์แก้ไข');
      check(req.headers.get('origin')===url.origin,403,'คำขอจากแหล่งอื่นถูกปฏิเสธ');
      check(req.headers.get('content-type')?.startsWith('application/json'),415,'ต้องส่งข้อมูล JSON');
    }
    if(p==='/api/editors'){
      ownerOnly(u);
      if(req.method==='GET')return json({editors:(await db.prepare('SELECT email,created_at AS createdAt FROM accounting_editors ORDER BY email').all()).results});
      const b=await readBody(req),email=normalEmail(b.email);
      check(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'กรุณาระบุอีเมลให้ถูกต้อง');
      check(email!==normalEmail(env.MYTECH_OWNER_EMAIL),400,'ไม่สามารถเปลี่ยนสิทธิ์เจ้าของจากหน้านี้');
      check(['grant','revoke'].includes(b.operation),400,'คำสั่งไม่ถูกต้อง');
      if(b.operation==='grant')await db.prepare('INSERT OR IGNORE INTO accounting_editors VALUES(?,?,?)').bind(email,u.id,new Date().toISOString()).run();
      else await db.prepare('DELETE FROM accounting_editors WHERE email=?').bind(email).run();
      return json({ok:true});
    }
    const {state:s,revision}=await loadState(db);
    if(req.method==='GET'&&p==='/api/state'){
      const out=visibleState(s,u);
      if(u.role!=='viewer')out.attachmentList=(await db.prepare('SELECT id,record_id AS recordId,name,mime FROM accounting_attachments').all()).results.filter(x=>recordAllowed(out,x.recordId));
      return json(out);
    }
    if(req.method==='GET'&&p==='/api/document'){
      check(u.role!=='viewer',403,'กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์');
      const doc=s.documents.find(x=>x.id===url.searchParams.get('id'));check(doc,404,'ไม่พบเอกสาร');
      return new Response(documentHtml(s,doc),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"}});
    }
    if(req.method==='POST'&&p==='/api/action'){
      const b=await readBody(req);check(typeof b.requestId==='string'&&b.requestId.length>0&&b.requestId.length<=80,400,'ไม่พบเลขคำขอ');
      if(s.requests.includes(b.requestId))return json({duplicate:true});
      check(b.payload&&typeof b.payload==='object'&&!Array.isArray(b.payload),400,'ข้อมูลรายการไม่ถูกต้อง');
      const {state:next,result}=mutate(s,b.action,b.payload,u);next.requests.push(b.requestId);
      await saveState(db,next,revision);return json({result});
    }
    if(req.method==='POST'&&p==='/api/attachment'){
      const b=await readBody(req);check(recordAllowed(visibleState(s,u),b.recordId),404,'ไม่พบรายการ');
      check(['image/png','image/jpeg','image/webp','application/pdf'].includes(b.mime),400,'รองรับ PNG, JPG, WebP และ PDF');
      check(typeof b.base64==='string'&&b.base64.length<=1400000&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64),413,'ไฟล์หลักฐานต้องไม่เกิน 1 MB');
      let data;try{data=Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0));}catch{throw new ApiError(400,'ไฟล์ไม่ถูกต้อง');}
      check(data.length>0&&data.length<=1024*1024,413,'ไฟล์หลักฐานต้องไม่เกิน 1 MB');
      const id=uid();await db.prepare('INSERT INTO accounting_attachments VALUES(?,?,?,?,?,?)').bind(id,b.recordId,String(b.name||'หลักฐาน').slice(0,180),b.mime,b.base64,u.id).run();return json({id});
    }
    if(req.method==='GET'&&p.startsWith('/api/file/')){
      check(u.role!=='viewer',403,'กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์');
      const a=await db.prepare('SELECT * FROM accounting_attachments WHERE id=?').bind(p.split('/').pop()).first();
      check(a&&recordAllowed(visibleState(s,u),a.record_id),404,'ไม่พบไฟล์');
      return new Response(Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)),{headers:{...headers,'Content-Type':a.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`}});
    }
    if(req.method==='GET'&&p==='/api/backup'){
      ownerOnly(u);return json({format:'MYTECH_BACKUP_V1',createdAt:new Date().toISOString(),state:s,attachments:(await db.prepare('SELECT * FROM accounting_attachments').all()).results});
    }
    if(req.method==='POST'&&p==='/api/restore'){
      ownerOnly(u);const b=await readBody(req),v=b.backup?.state;
      check(b.confirm==='กู้คืนข้อมูล'&&b.backup?.format==='MYTECH_BACKUP_V1'&&v?.version===1,400,'ไฟล์สำรองหรือคำยืนยันไม่ถูกต้อง');
      for(const [k,value]of Object.entries(initial()))check(k in v&&(Array.isArray(value)?Array.isArray(v[k]):typeof value===typeof v[k]),400,'โครงสร้างไฟล์สำรองไม่ครบ');
      check(Array.isArray(b.backup.attachments)&&b.backup.attachments.length===0,400,'รุ่นออนไลน์ยังกู้คืนได้เฉพาะไฟล์สำรองที่ไม่มีหลักฐานแนบ');
      check((await db.prepare('SELECT id FROM accounting_attachments LIMIT 1').first())===null,400,'มีหลักฐานแนบอยู่ กรุณาเก็บสำเนาและติดต่อผู้ดูแลก่อนกู้คืน');
      v.audit.push({id:uid(),by:u.name,action:'restore',createdAt:new Date().toISOString(),note:'กู้คืนข้อมูลออนไลน์'});
      const encoded=JSON.stringify(v);check(new TextEncoder().encode(encoded).length<=1500000,413,'ข้อมูลใหญ่เกิน 1.5 MB');
      // Snapshot and compare-and-swap occur atomically; no stale restore may overwrite another device.
      const results=await db.batch([
        db.prepare('INSERT INTO accounting_snapshots SELECT ?,json,? FROM accounting_state WHERE id=1 AND revision=?').bind(uid(),new Date().toISOString(),revision),
        db.prepare('UPDATE accounting_state SET json=?,revision=revision+1 WHERE id=1 AND revision=?').bind(encoded,revision)
      ]);check(results[1].meta.changes===1,409,'ข้อมูลเปลี่ยนจากอีกเครื่อง กรุณาโหลดใหม่');return json({ok:true});
    }
    if(p.startsWith('/api/trello/')){ownerOnly(u);throw new ApiError(501,'การเชื่อม Trello ออนไลน์ยังไม่เปิดใช้งาน สำเนาการ์ดเดิมยังอยู่ในข้อมูลสำรอง');}
    throw new ApiError(404,'ไม่พบคำสั่ง');
  }catch(e){return json({error:e.status?e.message:e.message?.includes('D1')?'ฐานข้อมูลขัดข้อง กรุณาลองใหม่':e.message||'ทำรายการไม่สำเร็จ'},e.status||400);}
}
