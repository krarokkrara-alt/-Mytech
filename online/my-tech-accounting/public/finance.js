titles.bills='บิลค่าใช้จ่าย · Invoice ผู้ขาย';
trelloClientKinds.billSave='bill';trelloClientKinds.billPay='entry';trelloClientKinds.billCancel='bill';trelloUiCollections.bill='bills';
const financeWalletBefore=walletView,financePageActionsBefore=pageActions;
function financeObligations(){
  const r=financialReport(S,filters);
  return `<section class="panel"><div class="panel-head"><div><h2>ยอดค้างจากทุกส่วน</h2><p class="muted">ตามตัวกรอง · แสดงยอดค้างแยกจากรายการที่รับ–จ่ายแล้ว</p></div><a class="signin-link" href="/?page=report">ดูรายงานทั้งหมด →</a></div><div class="report-kpis">${metric('Invoice / ค่าเรียนค้างรับ',r.receivables.total,'arrow','ยังไม่บันทึกเป็นเงินรับ')}${metric('บิล / ใบสั่งซื้อค้างจ่าย',r.payables.business.total,'down','เชื่อมใบสั่งซื้อแล้วไม่บวกซ้ำ')}${owner()?metric('เงินเดือนสุทธิค้างจ่าย',r.payroll.unpaid,'wallet','รวมสลิปที่ยังไม่ยืนยันจ่าย'):''}</div><div class="actions"><a class="signin-link" href="/?page=documents">Invoice ขาย</a><a class="signin-link" href="/?page=bills">บิลค่าใช้จ่าย / Invoice ผู้ขาย</a>${owner()?'<a class="signin-link" href="/?page=payroll">เงินเดือนพนักงาน</a>':''}</div>${owner()&&r.payables.personal.total?`<p>บิลส่วนตัวค้างจ่าย ฿${fmt(r.payables.personal.total)} (แยกจากกิจการ)</p>`:''}</section>`;
}
walletView=function(){return financeObligations()+financeWalletBefore();};views.wallet=walletView;
reportView=function(){return filterToolbar()+reportContents(S,filters,{owner:owner()});};views.report=reportView;
pageActions=function(){if(page==='bills')return btn('เพิ่มบิลค่าใช้จ่าย / Invoice ผู้ขาย','bill:new','');return financePageActionsBefore();};
function financeBillPaid(b){return active().filter(e=>['expense','settlement'].includes(e.type)&&(e.billId===b.id||b.status!=='cancelled'&&b.purchaseId&&e.purchaseId===b.purchaseId)).reduce((a,e)=>a+e.amount,0);}
function billsView(){const records=filtered(S.bills||[]).slice().reverse();return `${filterToolbar()}<div class="notice info">บันทึก Invoice และบิลจากผู้ขายได้ทุกหมวด เช่น ค่าเช่า ค่าไฟ ค่าอะไหล่ และบริการ เลือกใบสั่งซื้อเดิมเมื่อเป็นรายการเดียวกัน เพื่อไม่สร้างยอดค้างซ้ำ เงินเดือนใช้หน้าเงินเดือนพนักงาน</div>${panel('บิลค่าใช้จ่าย / Invoice ผู้ขาย','บิลที่ยังไม่จ่ายอยู่ในยอดค้างจ่าย · ชำระแล้วรวมรายรับ–รายจ่ายและรายงานอัตโนมัติ',records.length?table(['วันที่ / เลขที่','ผู้ขาย / หมวด','ขอบเขต','ยอดบิล / คงค้าง','สถานะ','จัดการ'],records.map(b=>{const paid=financeBillPaid(b),left=b.total-paid;return `<tr><td>${thaiDate(b.date)}<br>${esc(b.number)}<br><small>${esc(b.invoiceNo||'')}</small></td><td>${esc(b.vendor)}<br>${esc(b.category)}<br><small>${esc(b.note)}</small></td><td>${b.scope==='personal'?'ส่วนตัว':'กิจการ'}</td><td class="num">฿${fmt(b.total)}<br>ค้าง ฿${fmt(b.status==='cancelled'?0:left)}</td><td>${badge(b.status==='cancelled'?'ยกเลิก':left?'ค้างจ่าย':'จ่ายครบ',left?'warn':'')}</td><td><div class="actions"><a href="/api/bill?id=${encodeURIComponent(b.id)}" target="_blank" rel="noreferrer">เปิดบันทึก / พิมพ์</a>${b.status==='issued'&&left>0?btn('ชำระบิล','billpay:'+b.id,'small secondary'):''}${b.status==='issued'&&paid===0?btn('แก้ไข','bill:'+b.id,'small secondary'):''}${owner()&&b.status==='issued'&&paid===0?btn('ยกเลิกบิล','billcancel:'+b.id,'small ghost'):''}${btn('แนบหลักฐาน','attach:'+b.id,'small secondary')}</div>${programRecordFiles(b.id)}</td></tr>`;})):empty('ยังไม่มีบิลผู้ขาย','เพิ่มบิลหรือ Invoice ผู้ขาย แล้วบันทึกชำระเมื่อจ่ายเงินจริง'))}`;}
views.bills=billsView;
function financeBillForm(id){
  const b=(S.bills||[]).find(x=>x.id===id);
  openModal(b?'แก้ไขบิลค่าใช้จ่าย':'เพิ่มบิลค่าใช้จ่าย',field('ผู้ขาย / ผู้รับเงิน','vendor','text',{value:b?.vendor||'',extra:'maxlength="120"'})+field('เลข Invoice / บิลของผู้ขาย','invoiceNo','text',{value:b?.invoiceNo||'',optional:true,extra:'maxlength="80"'})+field('หมวดค่าใช้จ่าย','category','text',{value:b?.category||'ค่าใช้จ่ายทั่วไป',extra:'maxlength="100" list="bill-categories"'})+'<datalist id="bill-categories"><option>ค่าเช่า</option><option>ค่าไฟ / ค่าน้ำ</option><option>ค่าอะไหล่ / วัสดุ</option><option>ค่าบริการ</option><option>ค่าเดินทาง</option><option>ค่าใช้จ่ายทั่วไป</option></datalist>'+moneyField('ยอดบิลรวม','amount',{value:b?(b.total/100).toFixed(2):''})+field('วันที่บิล','date','date',{value:b?.date||nowDate()})+field('กำหนดชำระ','due','date',{value:b?.due||'',optional:true})+(owner()?field('ขอบเขต','scope','select',{options:`<option value="business" ${b?.scope!=='personal'?'selected':''}>กิจการ</option><option value="personal" ${b?.scope==='personal'?'selected':''}>ส่วนตัว</option>`,help:b?'บิลเดิมเปลี่ยนขอบเขตไม่ได้ หากกรอกผิดให้ยกเลิกและสร้างใหม่':''}):'')+field('อ้างอิงใบสั่งซื้อเดิม (ถ้าเป็นรายการเดียวกัน)','purchaseId','select',{options:options(S.purchases,p=>p.vendor+' · ฿'+fmt(p.total)+' · '+p.date,b?.purchaseId),optional:true,full:true,help:'ยอดบิลต้องตรงกับใบสั่งซื้อที่เลือก หากไม่มีใบสั่งซื้อให้เว้นว่าง'})+field('โครงการ','project','text',{value:b?.project||'',optional:true})+field('รายละเอียด','note','textarea',{value:b?.note||'',optional:true,full:true}),p=>act('billSave',{...p,id:b?.id}),'บันทึกบิล','billSave');
  if(b)$('#modal-form [name=scope]')?.setAttribute('disabled','');
}
function financeBillPay(id){
  const b=(S.bills||[]).find(x=>x.id===id);if(!b)throw Error('ไม่พบบิล');
  const accounts=S.accounts.filter(a=>a.scope===b.scope);
  openModal('ชำระบิล '+b.number,`<div class="notice info full">${esc(b.vendor)} · คงค้าง ฿${fmt(b.total-financeBillPaid(b))} · การยืนยันจะสร้างรายจ่ายและลดเงินในบัญชี</div>`+field('บัญชีที่จ่าย','accountId','select',{options:options(accounts)})+moneyField('จำนวนชำระ','amount',{value:((b.total-financeBillPaid(b))/100).toFixed(2)})+field('วันที่จ่าย','date','date')+field('รายละเอียด','note','textarea',{value:'จ่ายบิล '+b.number+' · '+b.vendor,optional:true,full:true}),p=>act('billPay',{...p,id}),'ยืนยันชำระ','billPay');
}
async function financeDispatch(command){
  const [cmd,id]=command.split(':');
  if(cmd==='bill'){financeBillForm(id);return true;}
  if(cmd==='billpay'){financeBillPay(id);return true;}
  if(cmd==='billcancel'){openModal('ยกเลิกบิลค่าใช้จ่าย',field('เหตุผลยกเลิก','note','textarea',{full:true}),p=>act('billCancel',{id,note:p.note}),'ยกเลิกบิล','billCancel');return true;}
  if(cmd==='csv'&&page==='report'){
    const csv='\ufeff'+financialReportRows(S,filters,{owner:owner()}).map(row=>row.map(c=>'"'+String(c??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='MYTECH-report-'+nowDate()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }
  if(cmd==='print'&&page==='report'){window.open('/api/report?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v)),'_blank','noopener');return true;}
  return false;
}
