import {money,mutate,active,uid,assert} from '../my-tech-accounting/model.mjs';
import {signatureHtml} from './signature.mjs';

const billText=(value,max=500)=>{assert(typeof value==='string'&&value.trim()&&value.length<=max,'กรอกข้อความบิลให้ครบและไม่เกิน '+max+' ตัวอักษร');return value.trim();};
const billDate=value=>{assert(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'วันที่บิลไม่ถูกต้อง');return value;};
const billScope=(scope,user)=>{assert(['owner','staff'].includes(user?.role),'บัญชีนี้ไม่มีสิทธิ์แก้ไขบิล');assert(['business','personal'].includes(scope),'ขอบเขตบิลไม่ถูกต้อง');if(scope==='personal')assert(user.role==='owner','บิลส่วนตัวเฉพาะเจ้าของ');};
const billVendorKey=value=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase();
const billMoney=value=>{const amount=money(value);assert(amount>0,'ยอดบิลและยอดชำระต้องมากกว่า 0');return amount;};
export const billsInitial=s=>({...s,bills:s.bills||[]});
const billPayments=(s,bill)=>active(s).filter(e=>['expense','settlement'].includes(e.type)&&(e.billId===bill.id||bill.status!=='cancelled'&&bill.purchaseId&&e.purchaseId===bill.purchaseId));
export function billPaid(s,bill){return billPayments(s,bill).reduce((sum,e)=>sum+e.amount,0);}

export function validateBills(s){
  assert(Array.isArray(s.bills||[]),'ข้อมูลบิลไม่ถูกต้อง');const ids=new Set(),numbers=new Set(),invoices=new Set(),purchases=new Set();
  for(const bill of s.bills||[]){
    assert(bill&&typeof bill.id==='string'&&bill.id&&!ids.has(bill.id),'รหัสบิลซ้ำหรือไม่ถูกต้อง');ids.add(bill.id);
    assert(typeof bill.number==='string'&&bill.number&&!numbers.has(bill.number),'เลขที่บิลซ้ำหรือไม่ถูกต้อง');numbers.add(bill.number);
    billText(bill.vendor,120);billText(bill.category,100);billDate(bill.date);if(bill.due)assert(billDate(bill.due)>=bill.date,'กำหนดชำระต้องไม่ก่อนวันที่บิล');
    assert(['business','personal'].includes(bill.scope)&&['issued','cancelled'].includes(bill.status),'ขอบเขตหรือสถานะบิลไม่ถูกต้อง');
    assert(Number.isSafeInteger(bill.total)&&bill.total>0&&bill.total<=1e12,'ยอดบิลไม่ถูกต้อง');
    assert(typeof bill.invoiceNo==='string'&&bill.invoiceNo.length<=80&&typeof bill.note==='string'&&bill.note.length<=500&&typeof bill.project==='string'&&bill.project.length<=120,'รายละเอียดบิลไม่ถูกต้อง');
    if(bill.invoiceNo&&bill.status!=='cancelled'){const key=JSON.stringify([billVendorKey(bill.vendor),billVendorKey(bill.invoiceNo)]);assert(!invoices.has(key),'เลข Invoice ผู้ขายซ้ำ');invoices.add(key);}
    if(bill.purchaseId){const purchase=s.purchases.find(p=>p.id===bill.purchaseId);assert(purchase&&bill.scope==='business'&&purchase.total===bill.total,'บิลไม่ตรงกับใบสั่งซื้อ');if(bill.status!=='cancelled'){assert(!purchases.has(bill.purchaseId),'ใบสั่งซื้อมีบิลอ้างอิงแล้ว');purchases.add(bill.purchaseId);}}
    const paid=billPaid(s,bill);assert(Number.isSafeInteger(paid)&&paid>=0&&paid<=bill.total,'ยอดจ่ายบิลเกินยอดรวม');if(bill.status==='cancelled')assert(paid===0,'บิลยกเลิกยังมีรายการจ่ายที่มีผล');
  }
  const activeIds=new Set(active(s).map(e=>e.id));
  for(const entry of s.entries||[]){if(!entry.billId)continue;const bill=(s.bills||[]).find(b=>b.id===entry.billId),account=s.accounts.find(a=>a.id===entry.accountId);assert(bill&&account&&['expense','settlement'].includes(entry.type),'รายการจ่ายอ้างอิงบิลไม่ถูกต้อง');if(activeIds.has(entry.id)){assert(account.scope===bill.scope,'บัญชีจ่ายต้องตรงกับขอบเขตบิล');assert((entry.purchaseId||null)===(bill.purchaseId||null),'รายการจ่ายบิลไม่ตรงกับใบสั่งซื้อ');}}
}

export function billHtml(s,b){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),format=value=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
  const company=b.company||{...s.company,signature:null},payments=billPayments(s,b),paid=billPaid(s,b),purchase=(s.purchases||[]).find(p=>p.id===b.purchaseId);
  const paymentRows=payments.map(e=>`<tr><td>${esc(e.date)}</td><td>${esc((s.accounts||[]).find(a=>a.id===e.accountId)?.name||'')}<br>${esc(e.note)}${e.type==='settlement'?'<br>เคลียร์เงินเบิก':''}</td><td>${format(e.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.number)} • MY TECH</title><link rel="stylesheet" href="/document.css"></head><body><div class="controls"><button id="print">พิมพ์ / บันทึก PDF</button><button id="png">ดาวน์โหลดภาพ PNG</button><span id="message"></span><a href="/">กลับระบบ</a></div><main id="document"><header><div><div class="brand">${esc(company.name)}</div><p>${esc(company.address)}</p><p>${esc(company.phone)}</p></div><div class="doc-title"><h1>บันทึกบิลค่าใช้จ่าย</h1><p>Invoice ผู้ขาย · ${esc(b.number)}</p><p>วันที่ ${esc(b.date)}${b.due?'<br>กำหนดชำระ '+esc(b.due):''}</p>${b.status==='cancelled'?'<b class="cancelled">ยกเลิก · '+esc(b.cancelReason)+'</b>':''}</div></header><section class="customer"><small>ผู้ขาย / ผู้รับเงิน</small><h2>${esc(b.vendor)}</h2><p>เลข Invoice ผู้ขาย: ${esc(b.invoiceNo||'ไม่ได้ระบุ')}<br>หมวด: ${esc(b.category)} · ${b.scope==='personal'?'ส่วนตัว':'กิจการ'}${b.project?'<br>โครงการ: '+esc(b.project):''}${purchase?'<br>อ้างอิงใบสั่งซื้อ: '+esc(purchase.id):''}</p></section><table><thead><tr><th>รายละเอียด</th><th>หมายเหตุ</th><th>จำนวนเงิน (บาท)</th></tr></thead><tbody><tr><td>${esc(b.category)}</td><td>${esc(b.note)}</td><td>${format(b.total)}</td></tr></tbody></table><section class="summary"><div class="notes">บันทึกภายในจากข้อมูลบิลผู้ขายที่กรอกในระบบ<br>เอกสารนี้ไม่ใช่ต้นฉบับ Invoice หรือใบกำกับภาษีจากผู้ขาย</div><div class="totals"><p><span>ยอดบิล</span><b>${format(b.total)}</b></p><p><span>ชำระแล้ว</span><b>${format(paid)}</b></p><p class="grand"><span>${b.status==='cancelled'?'ยอดยกเลิก':'คงค้าง'}</span><b>${format(b.status==='cancelled'?b.total:b.total-paid)}</b></p></div></section><h2>รายการชำระที่มีผล</h2><table><thead><tr><th>วันที่</th><th>บัญชี / รายละเอียด</th><th>จำนวนเงิน (บาท)</th></tr></thead><tbody>${paymentRows||'<tr><td colspan="3">ยังไม่มีรายการชำระที่มีผล</td></tr>'}</tbody></table><div class="signatures"><div>ผู้บันทึก / ผู้อนุมัติ${signatureHtml(company)}</div><div>บันทึกโดย ${esc(b.by)}<br>ลายเซ็นข้างต้นเป็นการอนุมัติบันทึกภายใน</div></div><footer>บิลที่ยังไม่จ่ายเป็นภาระค้างจ่าย · รายการจ่ายเงินจริงและเคลียร์เงินเบิกนับค่าใช้จ่ายเพียงครั้งเดียว · รายการที่กลับแล้วไม่รวมในยอดชำระ</footer></main><script src="/document.js"></script></body></html>`;
}

export function billMutate(old,action,p,user){
  assert(['owner','staff'].includes(user?.role),'บัญชีนี้ไม่มีสิทธิ์แก้ไขบิล');let s=structuredClone(billsInitial(old));const stamp={id:uid(),createdAt:new Date().toISOString(),by:user.name};let result;
  if(action==='billSave'){
    const previous=p.id?s.bills.find(b=>b.id===p.id):null;assert(!p.id||previous,'ไม่พบบิล');if(previous){billScope(previous.scope,user);assert(previous.status==='issued','บิลยกเลิกแล้วแก้ไขไม่ได้');assert(billPaid(s,previous)===0,'บิลมีรายการจ่ายแล้ว ต้องกลับรายการจ่ายก่อนแก้ไข');}
    const scope=p.scope||previous?.scope||'business';billScope(scope,user);assert(!previous||scope===previous.scope,'เปลี่ยนขอบเขตบิลเดิมไม่ได้ ให้ยกเลิกและสร้างบิลใหม่');const total=billMoney(p.amount),date=billDate(p.date),due=p.due?billDate(p.due):null;assert(!due||due>=date,'กำหนดชำระต้องไม่ก่อนวันที่บิล');
    const vendor=billText(p.vendor,120),category=billText(p.category||previous?.category||'ค่าใช้จ่ายทั่วไป',100),invoiceNo=String(p.invoiceNo??previous?.invoiceNo??'').trim();assert(invoiceNo.length<=80,'เลข Invoice ผู้ขายต้องไม่เกิน 80 ตัวอักษร');
    assert(!invoiceNo||!s.bills.some(b=>b.id!==previous?.id&&b.status!=='cancelled'&&billVendorKey(b.vendor)===billVendorKey(vendor)&&billVendorKey(b.invoiceNo)===billVendorKey(invoiceNo)),'เลข Invoice ผู้ขายซ้ำ');
    const purchaseId=p.purchaseId===undefined?previous?.purchaseId||null:p.purchaseId||null;if(purchaseId){const purchase=s.purchases.find(x=>x.id===purchaseId);assert(purchase&&scope==='business'&&purchase.total===total,'ยอดบิลต้องตรงกับใบสั่งซื้อกิจการ');assert(!s.bills.some(b=>b.id!==previous?.id&&b.status!=='cancelled'&&b.purchaseId===purchaseId),'ใบสั่งซื้อมีบิลอ้างอิงแล้ว');}
    const project=String(p.project??previous?.project??''),note=String(p.note??previous?.note??'');assert(project.length<=120&&note.length<=500,'รายละเอียดบิลยาวเกินกำหนด');
    const year=date.slice(0,4),seq=s.bills.filter(b=>b.number?.startsWith('BILL-'+year+'-')).length+1;result={...(previous||stamp),number:previous?.number||'BILL-'+year+'-'+String(seq).padStart(4,'0'),invoiceNo,vendor,category,date,due,total,scope,status:'issued',purchaseId,project,note,company:structuredClone(previous?.company||s.company),updatedAt:new Date().toISOString()};
    assert(billPaid(s,result)<=total,'ยอดบิลน้อยกว่ายอดที่จ่ายใบสั่งซื้อไปแล้ว');if(previous)s.bills[s.bills.indexOf(previous)]=result;else s.bills.push(result);
  }else if(action==='billPay'){
    const bill=s.bills.find(b=>b.id===p.id);assert(bill&&bill.status==='issued','ไม่พบบิลที่จ่ายได้');billScope(bill.scope,user);const account=s.accounts.find(a=>a.id===p.accountId);assert(account&&account.scope===bill.scope,'บัญชีจ่ายต้องตรงกับขอบเขตบิล');
    const amount=billMoney(p.amount),date=billDate(p.date),paid=billPaid(s,bill);assert(Number.isSafeInteger(paid)&&paid+amount<=bill.total,'ยอดจ่ายเกินบิลคงเหลือ');const type=p.type||'expense';assert(['expense','settlement'].includes(type),'ประเภทการจ่ายบิลไม่ถูกต้อง');
    const out=mutate(s,'entry',{type,accountId:account.id,amount:p.amount,date,billId:bill.id,...(bill.purchaseId?{purchaseId:bill.purchaseId}:{}),...(p.advanceId?{advanceId:p.advanceId}:{}),project:p.project??bill.project,note:p.note?billText(p.note):'จ่ายบิล '+bill.number+' · '+bill.vendor},user);
    s=out.state;const entry=s.entries.find(e=>e.id===out.result.id);entry.billId=bill.id;if(bill.purchaseId)entry.purchaseId=bill.purchaseId;
    result={...entry,billNumber:bill.number,billPaid:billPaid(s,bill),billRemaining:bill.total-billPaid(s,bill)};
  }else if(action==='billCancel'){
    assert(user.role==='owner','เฉพาะเจ้าของยกเลิกบิลได้');result=s.bills.find(b=>b.id===p.id);assert(result&&result.status==='issued','ไม่พบบิลที่ยกเลิกได้');billScope(result.scope,user);assert(billPaid(s,result)===0,'ต้องกลับรายการจ่ายก่อนยกเลิกบิล');result.status='cancelled';result.cancelReason=billText(p.note);result.updatedAt=new Date().toISOString();
  }else throw new Error('ไม่รองรับคำสั่งบิล');
  s.revision++;s.audit.push({...stamp,action,recordId:result.id,note:action==='billSave'?result.vendor:p.note||result.billNumber||result.number});validateBills(s);return {state:s,result};
}
