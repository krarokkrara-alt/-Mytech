import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {database,bucket} from './db.mjs';
import {initial} from '../my-tech-accounting/model.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
function signatureHarness(){const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,1).toString('base64')};DB.raw.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(initial()));let id=0;
  const call=async(path,{role='owner',data}={})=>{const headers={'oai-authenticated-user-id':role+'-id','oai-authenticated-user-email':role+'@example.test'};if(data)Object.assign(headers,{Origin:'https://example.test','Content-Type':'application/json','X-CSRF-Token':'same-origin'});const r=await worker.fetch(new Request('https://example.test'+path,{method:data?'POST':'GET',headers,...(data?{body:JSON.stringify(data)}:{})}),env),text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body};};
  return {DB,env,call,action:(action,payload)=>call('/api/action',{data:{action,payload,requestId:'signature-action-'+(++id)}}),sign:(name='Signer A',role='owner')=>call('/api/company/signature',{role,data:{name,title:'Director',image:{mime:'image/png',base64:png}}})};
}
test('signature is private, included in signed-in documents, and immutable for previously issued documents',async()=>{
  const h=signatureHarness();assert.equal((await h.sign()).status,200);
  const customer=(await h.action('customer',{name:'Customer'})).body.result,quote=(await h.action('document',{kind:'quote',customerId:customer.id,date:'2026-11-08',items:[{description:'Service',quantity:'1',price:'100'}]})).body.result;
  const asset=(await h.call('/api/state')).body.company.signature.assetId;assert.ok(asset);assert.ok(!(await h.call('/api/state',{role:'viewer'})).body.company.signature);
  assert.equal((await h.call('/api/signature/'+asset,{role:'viewer'})).status,403);assert.equal((await h.sign('No','viewer')).status,403);
  await h.sign('Signer B');await h.action('company',{name:'Updated company'});
  const signed=await h.call('/api/document?id='+quote.id);assert.equal(signed.status,200);assert.ok(signed.body.includes('data:image/png;base64,'));assert.ok(signed.body.includes('Signer A'));assert.ok(!signed.body.includes('Signer B'));
  const publicDoc=(await h.call('/api/document?id='+quote.id,{role:'viewer'})).body;assert.ok(!publicDoc.includes('data:image/png'));assert.ok(!publicDoc.includes('Signer A'));
  assert.equal((await h.call('/api/state')).body.company.signature.name,'Signer B');
});
test('signature backup and staged restore preserve old and current images using new private asset IDs',async()=>{
  const h=signatureHarness();await h.sign('Signer A');const customer=(await h.action('customer',{name:'A'})).body.result;await h.action('document',{kind:'quote',customerId:customer.id,date:'2026-11-08',items:[{description:'A',quantity:'1',price:'100'}]});await h.sign('Signer B');
  const backup=(await h.call('/api/backup')).body;assert.equal(backup.signatureFiles.length,2);assert.ok(!JSON.stringify(backup.state).includes(png));const oldId=backup.state.company.signature.assetId;
  const prepare=await h.call('/api/restore/prepare',{data:{confirm:'กู้คืนข้อมูล',backup:{...backup,signatureFiles:backup.signatureFiles.map(({body,...rest})=>rest)}}});assert.equal(prepare.status,200,JSON.stringify(prepare.body));
  assert.equal((await h.call('/api/restore/commit',{data:{id:prepare.body.id}})).status,400);
  for(let i=0;i<backup.signatureFiles.length;i++)assert.equal((await h.call('/api/restore/file',{data:{id:prepare.body.id,index:i,signature:true,base64:backup.signatureFiles[i].body}})).status,200);
  assert.equal((await h.call('/api/restore/commit',{data:{id:prepare.body.id}})).status,200);
  const restored=(await h.call('/api/state')).body;assert.notEqual(restored.company.signature.assetId,oldId);assert.equal((await h.call('/api/backup')).body.signatureFiles.length,2);
  const doc=(await h.call('/api/document?id='+restored.documents[0].id)).body;assert.ok(doc.includes('Signer A'));assert.ok(doc.includes(png));
});
test('signature validation rejects active content and missing backup images; removing the default keeps historical documents',async()=>{
  const h=signatureHarness();assert.equal((await h.call('/api/company/signature',{data:{name:'A',title:'B',image:{mime:'image/svg+xml',base64:Buffer.from('<svg/>').toString('base64')}}})).status,400);
  await h.sign();const backup=(await h.call('/api/backup')).body;delete backup.signatureFiles;assert.equal((await h.call('/api/restore',{data:{confirm:'กู้คืนข้อมูล',backup}})).status,400);
  const customer=(await h.action('customer',{name:'A'})).body.result,doc=(await h.action('document',{kind:'invoice',customerId:customer.id,date:'2026-11-08',items:[{description:'A',quantity:'1',price:'100'}]})).body.result;
  assert.equal((await h.call('/api/company/signature',{data:{name:'',title:'',remove:true}})).status,200);assert.equal((await h.call('/api/state')).body.company.signature,null);assert.ok((await h.call('/api/document?id='+doc.id)).body.includes('Signer A'));
});
test('receipts and payroll snapshot their own signatures; legacy payroll never inherits a later signature',async()=>{
  const h=signatureHarness();await h.sign('Signer A');const account=(await h.action('account',{name:'Bank',scope:'business'})).body.result;
  const income=(await h.action('entry',{type:'income',accountId:account.id,amount:'10',date:'2026-11-08',note:'Payment'})).body.result;
  const employee=(await h.action('employee',{code:'E1',name:'Employee',baseSalary:'100'})).body.result,payroll=(await h.action('payrollSave',{employeeId:employee.id,month:'2026-11',baseSalary:'100'})).body.result;
  await h.sign('Signer B');const state=(await h.call('/api/state')).body,receipt=state.receipts.find(r=>r.entryId===income.id);
  for(const path of ['/api/receipt?id='+receipt.id,'/api/payslip?id='+payroll.id]){const r=await h.call(path);assert.equal(r.status,200);assert.ok(r.body.includes('Signer A'));assert.ok(r.body.includes('data:image/png'));assert.ok(!r.body.includes('Signer B'));}
  assert.ok(!(await h.call('/api/receipt?id='+receipt.id,{role:'viewer'})).body.includes('data:image/png'));
  const raw=JSON.parse(h.DB.raw.prepare('SELECT json FROM app_state').get().json);delete raw.payroll[0].company;h.DB.raw.prepare('UPDATE app_state SET json=?').run(JSON.stringify(raw));
  const legacy=(await h.call('/api/payslip?id='+payroll.id)).body;assert.ok(!legacy.includes('data:image/png'));assert.ok(!legacy.includes('Signer B'));
});
