import test from 'node:test';
import assert from 'node:assert/strict';
import {reportContents, financialReportHtml, financialReportRows} from '../my-tech-accounting/report-documents.mjs';

function fixture(){
  return {company:{name:'MY TECH',address:'Test address'},accounts:[{id:'business',name:'Business cash',scope:'business'},{id:'personal',name:'Private account',scope:'personal'}],
    entries:[],customers:[],courses:[],enrollments:[],documents:[],bills:[],purchases:[],payroll:[],debts:[],products:[],movements:[]};
}
const entry=(id,amount,extra={})=>({id,accountId:'business',date:'2026-11-10',type:'expense',amount,cash:-amount,project:'',note:id,...extra});
const csvRow=(rows,label)=>rows.find(row=>row[0]===label);

test('report HTML and CSV use net salary, totalDeductions and project material cost fields',()=>{
  const s=fixture();
  s.payroll=[{id:'salary',month:'2026-11',employee:{name:'Employee'},status:'draft',gross:12345,totalDeductions:123,net:12222,deductions:[{label:'Deduction',amount:123}]}];
  s.products=[{id:'material',kind:'material',name:'Parts'}];
  s.movements=[{id:'issue',productId:'material',date:'2026-11-10',type:'issue',project:'Workshop',value:5432}];
  const html=reportContents(s,{}, {owner:true}),rows=financialReportRows(s,{}, {owner:true});
  assert.ok(html.includes('123.45'));assert.ok(html.includes('1.23'));assert.ok(html.includes('122.22'));assert.ok(html.includes('54.32'));
  const salary=csvRow(rows,'เงินเดือนสุทธิ');
  assert.equal(salary[5],'122.22');assert.equal(salary[7],'122.22');assert.equal(salary[10],'123.45');assert.equal(salary[11],'1.23');
  assert.equal(csvRow(rows,'ต้นทุนวัสดุโครงการ')[5],'54.32');
  assert.equal(csvRow(rows,'สรุป · เงินเดือนสุทธิค้างจ่าย')[7],'122.22');
});

test('public presentation hides personal records and salary identities while retaining daily salary expense',()=>{
  const s=fixture();
  s.payroll=[{id:'salary1',month:'2026-11',employee:{name:'SECRET EMPLOYEE'},gross:1000,totalDeductions:0,net:1000,paymentEntryId:'payment1'},
    {id:'salary2',month:'2026-11',employee:{name:'SECOND EMPLOYEE'},gross:2000,totalDeductions:0,net:2000,paymentEntryId:'payment2'}];
  s.entries=[entry('payment1',1000,{payrollId:'salary1',note:'SECRET EMPLOYEE'}),entry('payment2',2000,{payrollId:'salary2',note:'SECOND EMPLOYEE'}),
    entry('private',7777,{accountId:'personal',note:'SECRET PERSONAL EXPENSE'})];
  s.bills=[{id:'private-bill',number:'SECRET PERSONAL BILL',scope:'personal',date:'2026-11-01',total:8888,status:'issued'}];
  s.debts=[{id:'private-debt',name:'SECRET PERSONAL DEBT',scope:'personal',createdAt:'2026-11-01T00:00:00Z',amount:9999}];
  const html=reportContents(s),rows=financialReportRows(s),text=html+JSON.stringify(rows);
  for(const secret of ['SECRET','SECOND EMPLOYEE','Private account','เงินเดือนพนักงาน'])assert.ok(!text.includes(secret),secret);
  assert.equal(csvRow(rows,'สรุป · ค่าใช้จ่ายที่บันทึกแล้ว')[5],'30.00');
  const salaryRows=rows.filter(row=>String(row[2]).startsWith('salary-summary-'));
  assert.equal(salaryRows.length,1);assert.equal(salaryRows[0][5],'30.00');
  assert.ok(!rows.some(row=>row[0]==='เงินเดือนสุทธิ'));
  assert.equal(financialReportRows(s,{search:'SECRET EMPLOYEE'}).filter(row=>row[2].startsWith('salary-summary-')).length,0);
});

test('existing sanitized salary summaries remain accurate after repeated presentation sanitization',()=>{
  const s=fixture();
  s.entries=[entry('salary-summary-business:2026-11-10',3000,{project:'เงินเดือนรวม',note:'ค่าใช้จ่ายเงินเดือนรวม'})];
  const rows=financialReportRows(s,{project:'เงินเดือน'});
  assert.equal(csvRow(rows,'สรุป · ค่าใช้จ่ายที่บันทึกแล้ว')[5],'30.00');
  assert.equal(rows.filter(row=>String(row[2]).startsWith('salary-summary-')).length,1);
});

test('owner personal balances are separated and CSV includes explicit summary rows',()=>{
  const s=fixture();
  s.entries=[entry('business-expense',1000),entry('private-expense',2000,{accountId:'personal'})];
  s.bills=[{id:'private-bill',number:'PERSONAL BILL',scope:'personal',date:'2026-11-01',total:8888,status:'issued',vendor:'Private vendor'}];
  const html=reportContents(s,{}, {owner:true}),rows=financialReportRows(s,{}, {owner:true});
  assert.ok(html.includes('รายรับ–รายจ่ายส่วนตัว'));assert.ok(html.includes('PERSONAL BILL'));
  const expenses=rows.filter(row=>row[0]==='สรุป · ค่าใช้จ่ายที่บันทึกแล้ว');
  assert.deepEqual(expenses.map(row=>[row[4],row[5]]),[['business','10.00'],['personal','20.00']]);
  assert.equal(csvRow(rows,'สรุป · ผู้ขายค้างจ่าย')[7],'0.00');
  assert.equal(csvRow(rows,'สรุป · บิลส่วนตัวค้างจ่าย')[7],'88.88');
  assert.ok(rows.every(row=>row.length===rows[0].length));
});

test('enrollment and purchase details explain deduplication and summary receivables do not add them twice',()=>{
  const s=fixture();
  s.customers=[{id:'student',name:'Student'}];s.courses=[{id:'course',name:'ECU'}];
  s.enrollments=[{id:'enrollment',customerId:'student',courseId:'course',price:10000,createdAt:'2026-11-01T00:00:00Z'}];
  s.documents=[{id:'invoice',kind:'invoice',number:'INV-1',date:'2026-11-01',total:10000,status:'issued',enrollmentId:'enrollment'}];
  s.purchases=[{id:'purchase',date:'2026-11-01',vendor:'Vendor',total:8000}];
  s.bills=[{id:'bill',number:'BILL-1',date:'2026-11-01',vendor:'Vendor',total:8000,status:'issued',scope:'business',purchaseId:'purchase'}];
  const html=reportContents(s,{}, {owner:true}),rows=financialReportRows(s,{}, {owner:true});
  assert.ok(html.includes('เพิ่มในลูกหนี้รวม'));assert.ok(html.includes('ไม่บวกลูกหนี้ซ้ำ'));
  assert.equal(csvRow(rows,'สรุป · ลูกหนี้ค้างรับ')[7],'100.00');assert.equal(csvRow(rows,'สรุป · ผู้ขายค้างจ่าย')[7],'80.00');
  assert.equal(csvRow(rows,'ค่าเรียน / ทะเบียน')[12],'แสดงประกอบ Invoice ไม่เพิ่มลูกหนี้ซ้ำ');
  assert.equal(csvRow(rows,'ใบสั่งซื้อ')[12],'แสดงประกอบบิล ไม่เพิ่มเจ้าหนี้ซ้ำ');
});

test('HTML escapes record, filter and issuer text and preserves the selected report signature',()=>{
  const s=fixture(),attack='<img src=x onerror="alert(1)">';
  s.entries=[entry('expense',1000,{note:attack})];
  const company={name:attack,address:'<script>bad()</script>',signature:{image:'data:image/png;base64,AA==',name:'Signer <b>',title:'Approver & owner'}};
  const html=financialReportHtml(s,{project:attack},{owner:true,company});
  assert.ok(!html.includes(attack));assert.ok(!html.includes('<script>bad()'));
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Signer &lt;b&gt;'));assert.ok(html.includes('Approver &amp; owner'));
  assert.ok(html.includes('src="data:image/png;base64,AA=="'));assert.ok(html.includes('/document.js'));
  assert.ok(!financialReportHtml({...s,company}).includes('data:image/png')); // No implicit signature substitution.
  assert.ok(reportContents(s,{}, {owner:true}).includes('&lt;img'));
});

test('CSV prevents formula injection in user text while preserving negative numeric cash',()=>{
  const s=fixture();s.entries=[entry('danger',123,{note:'=HYPERLINK("https://example.com")'})];
  const rows=financialReportRows(s,{}, {owner:true}),record=rows.find(row=>row[2]==='danger');
  assert.equal(record[3],"'=HYPERLINK(\"https://example.com\")");assert.equal(record[8],'-1.23');
  assert.equal(csvRow(rows,'คำอธิบาย')[10],'');assert.equal(csvRow(rows,'คำอธิบาย')[11],'');
});
