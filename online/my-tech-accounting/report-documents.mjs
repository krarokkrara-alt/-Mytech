import {financialReport} from './reporting.mjs';
import {signatureHtml} from '../worker/signature.mjs';

const reportEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reportBaht=value=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}).format((value||0)/100);
const reportTypeNames={opening:'ยอดยกมา',income:'รับเงิน',expense:'จ่ายค่าใช้จ่าย',settlement:'เคลียร์เงินเบิก',advance:'เงินเบิก',advance_return:'คืนเงินเบิก',owner_in:'เจ้าของเติมเงิน',owner_out:'เจ้าของถอนเงิน',debt_repay:'คืนต้นหนี้',interest:'ดอกเบี้ยจ่าย'};
const reportCell=value=>`<td>${reportEscape(value)}</td>`;
const reportAmount=value=>`<td class="num">${reportBaht(value)}</td>`;
const reportTable=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${reportEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>'<tr>'+row+'</tr>').join(''):`<tr><td colspan="${heads.length}">ไม่มีรายการตามตัวกรอง</td></tr>`}</tbody></table></div>`;
const reportSection=(title,sub,content)=>`<section class="panel"><div class="panel-head"><div><h2>${reportEscape(title)}</h2><p class="muted">${reportEscape(sub)}</p></div></div>${content}</section>`;
const reportMetric=(label,amount,foot)=>`<div class="metric"><div class="metric-top">${reportEscape(label)}</div><div class="metric-value"><span class="currency">฿</span>${reportBaht(amount)}</div><div class="metric-foot">${reportEscape(foot)}</div></div>`;

function reportPresentationState(s,options){
  if(options.owner===true)return s;
  const accounts=(s.accounts||[]).filter(a=>a.scope==='business'),accountIds=new Set(accounts.map(a=>a.id));
  const entries=(s.entries||[]).filter(e=>accountIds.has(e.accountId)),reversed=new Set(entries.filter(e=>e.reverses).map(e=>e.reverses));
  const payments=new Set((s.payroll||[]).map(p=>p.paymentEntryId).filter(Boolean)),totals=new Map(),visible=[];
  for(const e of entries.filter(e=>!e.reverses&&!reversed.has(e.id))){
    if(e.type==='expense'&&(e.payrollId||payments.has(e.id)||String(e.id).startsWith('salary-summary-'))){
      const key=e.accountId+':'+e.date,row=totals.get(key)||{id:'salary-summary-'+key,date:e.date,accountId:e.accountId,type:'expense',amount:0,cash:0,project:'เงินเดือน',note:'ค่าใช้จ่ายเงินเดือนรวมประจำวัน'};
      row.amount+=e.amount;row.cash+=e.cash;totals.set(key,row);
    }else visible.push(e);
  }
  return {...s,accounts,entries:visible.concat([...totals.values()]),payroll:[],employees:[],
    bills:(s.bills||[]).filter(b=>b.scope!=='personal'),debts:(s.debts||[]).filter(d=>d.scope==='business')};
}

export function reportContents(s,filter={},options={}){
  const r=financialReport(reportPresentationState(s,options),filter),owner=options.owner===true;
  const scopeSection=(scope,label)=>reportSection(label,'ยอดรับ–จ่ายที่ยังมีผล ตามวันที่ทำรายการ · บาท',`<div class="report-kpis">${reportMetric('รายรับที่รับแล้ว',scope.income,'เฉพาะรายรับจากลูกค้า')}${reportMetric('ค่าใช้จ่ายที่บันทึกแล้ว',scope.expense,'รวมเงินเดือนสุทธิ เคลียร์เบิก และดอกเบี้ย')}${reportMetric('เงินออกจากบัญชีทั้งหมด',scope.cashOut,'รวมเบิกเงิน คืนเงินต้น และเจ้าของถอน')}</div>`+reportTable(['หมวดค่าใช้จ่าย','จำนวนเงิน'],scope.expenses.map(x=>reportCell(x.label)+reportAmount(x.amount)))+reportTable(['ประเภทเงินออก','จำนวนเงิน'],scope.outflows.map(x=>reportCell(x.label)+reportAmount(x.amount)))+reportTable(['วันที่','ประเภท','บัญชี','รายละเอียด / อ้างอิง','จำนวนเงิน','เงินเข้า / ออก'],scope.entries.map(e=>reportCell(e.date)+reportCell(reportTypeNames[e.type]||e.type)+reportCell(e.accountName)+reportCell([e.note,e.invoiceNumber,e.customerName,e.vendor,e.employeeName,e.project].filter(Boolean).join(' · '))+reportAmount(e.amount)+reportAmount(e.cash))));
  const status=row=>row.status==='cancelled'?'ยกเลิก':row.outstanding===0?'ชำระครบ':'ค้างชำระ';
  let html=`<div class="notice info">รวมข้อมูลเงิน เอกสาร และภาระค้างจ่ายจากทุกส่วนที่คุณมีสิทธิ์ดู ยอดค้างจะแสดงแยกจากยอดที่รับ–จ่ายแล้ว เพื่อไม่บวกซ้ำเมื่อชำระเงินจริง</div><div class="report-kpis">${reportMetric('ลูกหนี้ค้างรับ',r.receivables.total,'Invoice และค่าเรียนที่ยังไม่รับชำระ')}${reportMetric(owner?'ผู้ขายและเงินเดือนค้างจ่าย':'ผู้ขายค้างจ่าย',r.payables.business.totalWithPayroll,owner?'บิล + ใบสั่งซื้อที่ยังไม่ซ้ำบิล + เงินเดือนสุทธิ':'บิลและใบสั่งซื้อที่ยังไม่ซ้ำบิล')}${reportMetric('คืนต้นหนี้กิจการคงเหลือ',r.debts.business.outstanding,'แสดงแยกจากค่าใช้จ่ายและเจ้าหนี้ผู้ขาย')}</div>`;
  html+=scopeSection(r.business,'รายรับ–รายจ่ายกิจการ');
  html+=reportSection('Invoice ขาย / ลูกหนี้','รวมยอดเอกสาร รับแล้ว และคงค้าง · เอกสารยกเลิกไม่รวมยอด',reportTable(['วันที่','Invoice','ลูกค้า','สถานะ','ยอดเอกสาร','รับแล้ว','คงค้าง'],r.invoices.rows.map(d=>reportCell(d.date)+reportCell(d.number)+reportCell(d.customerName)+reportCell(status(d))+reportAmount(d.total)+reportAmount(d.paid)+reportAmount(d.status==='cancelled'?0:d.outstanding))));
  html+=reportSection('ค่าเรียนและทะเบียนลูกหนี้','ทะเบียนที่มี Invoice ในรายงานแสดงประกอบเอกสาร และไม่บวกลูกหนี้ซ้ำ · หาก Invoice อยู่นอกตัวกรอง ใช้ทะเบียนเป็นยอดแทน',reportTable(['วันที่ลงทะเบียน','ลูกค้า / คอร์ส','Invoice อ้างอิง','ยอดตกลง','รับแล้ว','คงค้าง','เพิ่มในลูกหนี้รวม'],r.enrollments.rows.map(e=>reportCell(e.date)+reportCell(e.customerName+' · '+e.courseName)+reportCell(e.invoiceNumbers||'ยังไม่มี Invoice')+reportAmount(e.price)+reportAmount(e.paid)+reportAmount(e.outstanding)+reportAmount(e.coveredByInvoicesInReport||!e.includedInTotals?0:e.outstanding))));
  html+=reportSection('Invoice ผู้ขาย / บิลค่าใช้จ่าย','ยอดบิลและยอดจ่ายเชื่อมกัน · รายจ่ายที่ชำระแล้วอยู่ในตารางเงินด้านบน',reportTable(['วันที่','บิล / Invoice ผู้ขาย','ผู้ขาย / หมวด','ขอบเขต','สถานะ','ยอดบิล','จ่ายแล้ว','คงค้าง'],r.bills.rows.map(b=>reportCell(b.date)+reportCell(b.number+' · '+b.invoiceNo)+reportCell(b.vendor+' · '+b.category)+reportCell(b.scope==='personal'?'ส่วนตัว':'กิจการ')+reportCell(status(b))+reportAmount(b.total)+reportAmount(b.paid)+reportAmount(b.status==='cancelled'?0:b.outstanding))));
  html+=reportSection('ใบสั่งซื้อ','ใบสั่งซื้อที่มีบิลในรายงานจะไม่บวกเจ้าหนี้ซ้ำ',reportTable(['วันที่','ผู้ขาย / สินค้า','ยอดสั่งซื้อ','จ่ายแล้ว','คงค้าง','เชื่อมบิล'],r.purchases.rows.map(p=>reportCell(p.date)+reportCell(p.vendor+' · '+(p.productName||''))+reportAmount(p.total)+reportAmount(p.paid)+reportAmount(p.outstanding)+reportCell(p.coveredByBills?'มีบิลแล้ว':'ยังไม่มีบิล'))));
  if(owner){html+=reportSection('เงินเดือนพนักงาน','กรองตามเดือนเงินเดือน · รวมสุทธิที่ยังไม่จ่ายในภาระค้างจ่าย · รายการหักแสดงเพื่อเทียบยอด ไม่บวกซ้ำ',`<div class="report-kpis">${reportMetric('รายได้ก่อนหัก',r.payroll.gross,'เงินเดือนพื้นฐานและรายการเพิ่ม')}${reportMetric('รายการหัก',r.payroll.deductions,'รายละเอียดตามสลิป')}${reportMetric('สุทธิยังไม่จ่าย',r.payroll.unpaid,'ยังไม่ตัดเงินจากบัญชี')}</div>`+reportTable(['เดือน','พนักงาน','สถานะ','ก่อนหัก','หัก','สุทธิ','จ่ายแล้ว','ค้างจ่าย'],r.payroll.rows.map(p=>reportCell(p.month)+reportCell(p.employee?.name)+reportCell(p.status==='cancelled'?'ยกเลิก':p.isPaid?'จ่ายแล้ว':'ยังไม่จ่าย')+reportAmount(p.gross)+reportAmount(p.totalDeductions??p.deductions?.reduce((a,x)=>a+x.amount,0))+reportAmount(p.net)+reportAmount(p.paidAmount)+reportAmount(p.unpaidAmount))));
    html+=scopeSection(r.personal,'รายรับ–รายจ่ายส่วนตัว');
    html+=reportSection('บิลส่วนตัวค้างจ่าย','แยกจากยอดกิจการ',reportTable(['หมวด','คงค้าง'],[reportCell('ผู้ขายส่วนตัว')+reportAmount(r.payables.personal.total)]));}
  html+=reportSection('หนี้และการคืนต้นหนี้','เงินคืนต้นหนี้เป็นเงินออก ดอกเบี้ยเป็นค่าใช้จ่าย · ยอดค้างหักเงินคืนที่ยังมีผลทุกวันที่',reportTable(['เจ้าหนี้','ขอบเขต','เงินต้น','คืนแล้ว','คงเหลือ'],r.debts.rows.map(d=>reportCell(d.name)+reportCell(d.scope==='personal'?'ส่วนตัว':'กิจการ')+reportAmount(d.amount)+reportAmount(d.repaid)+reportAmount(d.outstanding))));
  html+=reportSection('ต้นทุนวัสดุใช้ในโครงการ','เบิกสุทธิหลังคืน · ต้นทุนวัสดุแสดงแยกจากเงินซื้อของและไม่บวกเป็นค่าใช้จ่ายซ้ำ',reportTable(['โครงการ','ต้นทุนใช้สุทธิ'],r.materials.rows.map(m=>reportCell(m.project)+reportAmount(m.cost))));
  html+=`<p class="muted report-basis">${reportEscape(r.basis.description)} · เงินเดือนใช้เดือนของสลิป · Invoice/บิลใช้วันที่เอกสาร · ทะเบียน/หนี้ใช้วันที่สร้างรายการ</p>`;
  return html;
}

export function financialReportHtml(s,filter={},options={}){
  const company=options.company||{...s.company,signature:null};
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>รายงานรายรับ–รายจ่าย MY TECH</title><link rel="stylesheet" href="/document.css"><style>.panel{margin:24px 0}.report-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{padding:12px;border:1px solid #ddd;border-radius:8px}.metric-value{font-size:21px}.metric-foot,.muted{font-size:12px;color:#555}.table-wrap{overflow:auto}th,td{overflow-wrap:anywhere}.num{text-align:right;white-space:nowrap}.notice{padding:12px;background:#f0f5ff}@media(max-width:600px){.report-kpis{grid-template-columns:1fr}}@media print{#document{width:auto;padding:0}.table-wrap{overflow:visible}tr,.metric{break-inside:avoid}h2{break-after:avoid}table{font-size:10px}}</style></head><body><div class="controls"><button id="print">พิมพ์ / บันทึก PDF</button><button id="png">ดาวน์โหลดภาพ PNG</button><span id="message"></span><a href="/?page=report">กลับรายงาน</a></div><main id="document"><header><div><div class="brand">${reportEscape(company.name)}</div><p>${reportEscape(company.address)}</p></div><div class="doc-title"><h1>รายงานรายรับ–รายจ่าย</h1><p>${reportEscape(filter.from||'เริ่มต้น')} ถึง ${reportEscape(filter.to||'ปัจจุบัน')}</p><p>${reportEscape([filter.project,filter.search].filter(Boolean).join(' · '))}</p></div></header>${reportContents(s,filter,options)}<div class="signatures"><div>ผู้จัดทำ / ผู้อนุมัติรายงาน${signatureHtml(company)}</div></div></main><script src="/document.js"></script></body></html>`;
}

export function financialReportRows(s,filter={},options={}){
  const r=financialReport(reportPresentationState(s,options),filter),rows=[['หมวด','วันที่ / เดือน','เลขอ้างอิง','ชื่อ / รายละเอียด','ขอบเขต','ยอดรวมบาท','ชำระแล้วบาท','คงค้างบาท','เงินเข้าออกบาท','สถานะ','ก่อนหักบาท','รายการหักบาท','การรวมยอด']];
  const amount=n=>n==null?'':(n/100).toFixed(2);
  const add=(kind,date,id,note,scope,total,paid,outstanding,cash,status,gross=null,deductions=null,inclusion='รายละเอียดประกอบ ไม่รวมข้ามหมวด')=>rows.push([kind,date||'',id||'',note||'',scope,...[total,paid,outstanding,cash].map(amount),status||'',amount(gross),amount(deductions),inclusion]);
  for(const scope of options.owner===true?[r.business,r.personal]:[r.business]){
    for(const [label,value] of [['รายรับที่รับแล้ว',scope.income],['ค่าใช้จ่ายที่บันทึกแล้ว',scope.expense],['เงินเข้าบัญชีทั้งหมด',scope.cashIn],['เงินออกจากบัญชีทั้งหมด',scope.cashOut],['เงินเข้าสุทธิ',scope.netCash]])add('สรุป · '+label,'','','',scope.scope,value,null,null,null,'สรุปตามตัวกรอง',null,null,'ยอดสรุปคนละฐาน ห้ามบวกข้ามแถว');
    for(const category of scope.expenses)add('สรุปหมวดค่าใช้จ่าย','','',category.label,scope.scope,category.amount,null,null,null,'รวมอยู่ในค่าใช้จ่ายที่บันทึกแล้ว');
  }
  add('สรุป · ลูกหนี้ค้างรับ','','','','business',null,null,r.receivables.total,null,'Invoice + ทะเบียนที่ไม่ซ้ำ Invoice');
  add('สรุป · ผู้ขายค้างจ่าย','','','','business',null,null,r.payables.business.total,null,'บิล + ใบสั่งซื้อที่ไม่ซ้ำบิล');
  if(options.owner===true){
    add('สรุป · เงินเดือนสุทธิค้างจ่าย','','','','business',null,null,r.payroll.unpaid,null,'ไม่รวมเป็นรายจ่ายที่จ่ายแล้ว');
    add('สรุป · บิลส่วนตัวค้างจ่าย','','','','personal',null,null,r.payables.personal.total,null,'แยกจากกิจการ');
  }
  for(const e of r.entries)add(reportTypeNames[e.type]||e.type,e.date,e.id,[e.note,e.invoiceNumber,e.customerName,e.vendor,e.employeeName,e.project].filter(Boolean).join(' · '),e.accountScope,e.amount,null,null,e.cash,'มีผล');
  for(const d of r.invoices.rows)add('Invoice ขาย',d.date,d.number,d.customerName,'business',d.total,d.paid,d.status==='cancelled'?0:d.outstanding,null,d.status);
  for(const e of r.enrollments.rows)add('ค่าเรียน / ทะเบียน',e.date,e.id,e.customerName+' · '+e.courseName,'business',e.price,e.paid,e.outstanding,null,e.invoiceNumbers,null,null,e.coveredByInvoicesInReport?'แสดงประกอบ Invoice ไม่เพิ่มลูกหนี้ซ้ำ':'รวมในลูกหนี้ค้างรับผ่านทะเบียน');
  for(const b of r.bills.rows)add('บิลผู้ขาย',b.date,b.number,b.vendor+' · '+(b.invoiceNo||''),b.scope,b.total,b.paid,b.status==='cancelled'?0:b.outstanding,null,b.status);
  for(const p of r.purchases.rows)add('ใบสั่งซื้อ',p.date,p.id,p.vendor,'business',p.total,p.paid,p.outstanding,null,p.coveredByBills?'มีบิล':'ยังไม่มีบิล',null,null,p.coveredByBillsInReport?'แสดงประกอบบิล ไม่เพิ่มเจ้าหนี้ซ้ำ':'รวมในเจ้าหนี้ผ่านใบสั่งซื้อ');
  if(options.owner===true)for(const p of r.payroll.rows)add('เงินเดือนสุทธิ',p.month,p.id,p.employee?.name,'business',p.net,p.paidAmount,p.unpaidAmount,null,p.status==='cancelled'?'ยกเลิก':p.isPaid?'จ่ายแล้ว':'ค้างจ่าย',p.gross,p.totalDeductions);
  for(const d of r.debts.rows)add('หนี้เงินต้น',d.date,d.id,d.name,d.scope,d.amount,d.repaid,d.outstanding,null,d.estimated?'ประมาณ':'ยืนยัน');
  for(const m of r.materials.rows)add('ต้นทุนวัสดุโครงการ','','',m.project,'business',m.cost,null,null,null,'เบิกสุทธิหลังคืน',null,null,'แสดงแยก ไม่เพิ่มค่าใช้จ่ายจากเงินซื้อซ้ำ');
  add('คำอธิบาย','','',r.basis.description,'',null,null,null,null,'',null,null,'ตารางต่างฐาน ห้ามรวมตัวเลขทุกแถวเข้าด้วยกัน');
  // Preserve numeric cells while preventing user text from becoming spreadsheet formulas.
  return rows.map(row=>row.map((value,index)=>![5,6,7,8,10,11].includes(index)&&typeof value==='string'&&/^[\s]*[=+\-@]/.test(value)?"'"+value:value));
}
