import {money,prorate,mutate,active,uid,today,assert} from '../my-tech-accounting/model.mjs';

const text=(v,max=200)=>{assert(typeof v==='string'&&v.trim()&&v.length<=max,'กรอกข้อความให้ครบและไม่เกิน '+max+' ตัวอักษร');return v.trim();};
const amount=v=>money(v??'0');
const items=rows=>{assert(Array.isArray(rows)&&rows.length<=40,'เพิ่มรายการได้ไม่เกิน 40 รายการต่อประเภท');return rows.map(x=>({label:text(x.label,100),amount:amount(x.amount)}));};
export const payrollInitial=s=>({...s,employees:s.employees||[],payroll:s.payroll||[]});
export const paymentActive=(s,p)=>!!p.paymentEntryId&&active(s).some(e=>e.id===p.paymentEntryId);
export function validatePayroll(s){
  for(const e of s.employees||[])assert(typeof e.code==='string'&&e.code&&typeof e.name==='string'&&e.name&&typeof e.active==='boolean'&&Number.isSafeInteger(e.baseSalary)&&e.baseSalary>=0,'ข้อมูลพนักงานไม่ถูกต้อง');
  const unique=new Set();
  for(const p of s.payroll||[]){
    assert(s.employees.some(e=>e.id===p.employeeId)&&/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)&&p.employee&&typeof p.employee.name==='string'&&typeof p.employee.code==='string','ข้อมูลพนักงานหรือเดือนในเงินเดือนไม่ถูกต้อง');
    assert(['draft','paid','cancelled'].includes(p.status)&&Number.isSafeInteger(p.baseSalary)&&p.baseSalary>=0,'สถานะหรือฐานเงินเดือนไม่ถูกต้อง');
    for(const xs of [p.earnings,p.deductions])assert(Array.isArray(xs)&&xs.length<=40&&xs.every(x=>typeof x.label==='string'&&x.label.trim()&&Number.isSafeInteger(x.amount)&&x.amount>=0),'รายการเพิ่มหรือหักไม่ถูกต้อง');
    const gross=p.baseSalary+p.earnings.reduce((a,x)=>a+x.amount,0),deductions=p.deductions.reduce((a,x)=>a+x.amount,0);
    assert(Number.isSafeInteger(gross)&&gross<=1e12&&p.gross===gross&&p.totalDeductions===deductions&&p.net===gross-deductions&&p.net>=0,'ยอดเงินเดือนไม่ตรงกับรายละเอียด');
    if(p.status!=='cancelled'){const key=p.employeeId+':'+p.month;assert(!unique.has(key),'รายการเงินเดือนซ้ำในเดือนเดียวกัน');unique.add(key);}
    if(p.paymentEntryId){const entry=s.entries.find(e=>e.id===p.paymentEntryId);assert(entry&&entry.type==='expense'&&entry.payrollId===p.id&&entry.amount===p.net,'รายการจ่ายเงินเดือนไม่ตรงกับบัญชี');}
    if(p.status==='paid')assert(p.paymentEntryId,'เงินเดือนที่จ่ายแล้วไม่มีรายการจ่าย');
  }
}
export function payrollMutate(old,action,p,user){
  assert(user.role==='owner','เฉพาะเจ้าของจัดการเงินเดือนได้');
  let s=structuredClone(payrollInitial(old));
  const stamp={id:uid(),createdAt:new Date().toISOString(),by:user.name};
  let result;
  if(action==='employee'){
    const prev=p.id?s.employees.find(e=>e.id===p.id):null;
    assert(!p.id||prev,'ไม่พบพนักงาน');
    const code=text(p.code,40);assert(!s.employees.some(e=>e.code===code&&e.id!==prev?.id),'รหัสพนักงานซ้ำ');
    result={...(prev||stamp),code,name:text(p.name,120),position:String(p.position||'').slice(0,120),baseSalary:amount(p.baseSalary),bank:String(p.bank||'').slice(0,200),note:String(p.note||'').slice(0,500),active:p.active!==false&&p.active!=='false'};
    if(prev)s.employees[s.employees.indexOf(prev)]=result;else s.employees.push(result);
  }else if(action==='payrollSave'){
    const prev=p.id?s.payroll.find(x=>x.id===p.id):null;
    assert(!p.id||prev,'ไม่พบรายการเงินเดือน');assert(!prev||(!paymentActive(s,prev)&&prev.status!=='cancelled'),'เงินเดือนจ่ายแล้วหรือยกเลิกแล้ว แก้ไขไม่ได้');
    const employee=s.employees.find(e=>e.id===p.employeeId);assert(employee&&employee.active,'เลือกพนักงานที่ยังทำงาน');
    assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month),'เลือกเดือนเงินเดือน');
    assert(!s.payroll.some(x=>x.id!==prev?.id&&x.employeeId===employee.id&&x.month===p.month&&x.status!=='cancelled'),'มีเงินเดือนพนักงานคนนี้ในเดือนนี้แล้ว');
    const baseSalary=amount(p.baseSalary),earnings=items(p.earnings||[]),deductions=items(p.deductions||[]);
    const gross=baseSalary+earnings.reduce((a,x)=>a+x.amount,0),totalDeductions=deductions.reduce((a,x)=>a+x.amount,0),net=gross-totalDeductions;
    assert(Number.isSafeInteger(gross)&&gross<=1e12&&net>=0,'รายการหักต้องไม่เกินรายได้รวม');
    result={...(prev||stamp),employeeId:employee.id,employee:{code:employee.code,name:employee.name,position:employee.position,bank:employee.bank},month:p.month,baseSalary,earnings,deductions,gross,totalDeductions,net,note:String(p.note||'').slice(0,500),status:'draft',paymentEntryId:null,updatedAt:new Date().toISOString()};
    if(prev)s.payroll[s.payroll.indexOf(prev)]=result;else s.payroll.push(result);
  }else if(action==='payrollPay'){
    const slip=s.payroll.find(x=>x.id===p.id);assert(slip&&slip.status!=='cancelled','ไม่พบเงินเดือนที่จ่ายได้');assert(!paymentActive(s,slip),'เงินเดือนนี้จ่ายแล้ว');assert(slip.net>0,'ยอดสุทธิต้องมากกว่า 0 เพื่อบันทึกจ่าย');
    const account=s.accounts.find(a=>a.id===p.accountId);assert(account?.scope==='business','เลือกบัญชีกิจการ');
    const payment=mutate(s,'entry',{type:'expense',accountId:account.id,amount:(slip.net/100).toFixed(2),date:p.date||today(),project:'เงินเดือน',note:'จ่ายเงินเดือนงวด '+slip.month},user);
    s=payment.state;result=s.payroll.find(x=>x.id===p.id);result.paymentEntryId=payment.result.id;result.status='paid';result.paidAt=p.date||today();
    payment.result.payrollId=slip.id;
    s.entries.find(x=>x.id===payment.result.id).payrollId=slip.id;
  }else if(action==='payrollCancel'){
    result=s.payroll.find(x=>x.id===p.id);assert(result&&result.status!=='cancelled','ไม่พบรายการที่ยกเลิกได้');assert(!paymentActive(s,result),'ต้องกลับรายการจ่ายเงินก่อนยกเลิก');result.status='cancelled';result.cancelReason=text(p.note,500);
  }else throw new Error('ไม่รองรับคำสั่งเงินเดือน');
  s.revision++;s.audit.push({...stamp,action,recordId:result.id,note:action==='employee'?result.code:(result.month||'')});
  return {state:s,result};
}

export function payslipHtml(s,p){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
  const rows=xs=>xs.map(x=>`<tr><td>${esc(x.label)}</td><td class="num">${fmt(x.amount)}</td></tr>`).join('');
  const status=p.status==='cancelled'?'ยกเลิก':paymentActive(s,p)?'จ่ายแล้ว':'ยังไม่จ่าย';
  return `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>สลิปเงินเดือน ${esc(p.month)}</title><link rel="stylesheet" href="/document.css"><body><div class="controls"><button id="print">พิมพ์ / บันทึก PDF</button><button id="png">ดาวน์โหลดภาพ PNG</button><span id="message"></span><a href="/">กลับหน้าระบบ</a></div><main id="document"><header><div><div class="brand">${esc(s.company.name)}</div><p>${esc(s.company.address)}</p></div><div><h1>สลิปเงินเดือน</h1><p>งวด ${esc(p.month)} · ${status}</p>${p.status==='cancelled'?'<b class="cancelled">ยกเลิก · '+esc(p.cancelReason)+'</b>':''}</div></header><section class="customer"><h2>${esc(p.employee.name)}</h2><p>รหัส ${esc(p.employee.code)} · ${esc(p.employee.position)}</p><p>บัญชีรับเงิน: ${esc(p.employee.bank)}</p></section><h2>รายได้</h2><table><tbody>${rows([{label:'เงินเดือนพื้นฐาน',amount:p.baseSalary},...p.earnings])}<tr><th>รวมรายได้</th><th class="num">${fmt(p.gross)}</th></tr></tbody></table><h2>รายการหัก</h2><table><tbody>${rows(p.deductions)}<tr><th>รวมหัก</th><th class="num">${fmt(p.totalDeductions)}</th></tr></tbody></table><section class="summary"><div>${esc(p.note)}</div><div class="totals"><p class="grand"><span>สุทธิ (บาท)</span><b>${fmt(p.net)}</b></p><p>${paymentActive(s,p)?'วันที่จ่าย '+esc(p.paidAt):p.status==='cancelled'?'เอกสารนี้ยกเลิกแล้ว':'เอกสารนี้ยังไม่ยืนยันการจ่ายเงิน'}</p></div></section><footer>ยอดเพิ่มและหักตามที่ผู้จัดทำระบุ · ไม่มีการคำนวณภาษีหรือประกันสังคมอัตโนมัติ</footer></main><script src="/document.js"></script></body></html>`;
}
