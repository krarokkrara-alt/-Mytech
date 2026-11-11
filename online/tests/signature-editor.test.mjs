import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function editor({signature,role='owner'}={}){
  let alpha=0,save,releaseSave;const images=[],calls=[],nodes=new Map(),drawing={globalCompositeOperation:'source-over',beginPath(){},arc(x,y){drawing.lastPoint=[x,y];},moveTo(){},lineTo(){},fill(){alpha=drawing.globalCompositeOperation==='destination-out'?0:255;},stroke(){drawing.fill();},clearRect(){alpha=0;},drawImage(){alpha=255;},getImageData(){return {data:new Uint8ClampedArray([0,0,0,alpha])};},putImageData(p){alpha=p.data[3];}};
  const node=key=>{if(!nodes.has(key))nodes.set(key,{disabled:false,style:{},setAttribute(k,v){this[k]=v;}});return nodes.get(key);};
  const canvas=node('#signature-pad');Object.assign(canvas,{width:900,height:300,isConnected:true,getContext:()=>drawing,toDataURL:()=> 'data:image/png;base64,RURJVEVE',getBoundingClientRect:()=>({left:10,top:20,width:300,height:100}),setPointerCapture(id){this.pointer=id;},hasPointerCapture(id){return this.pointer===id;},releasePointerCapture(){this.pointer=null;}});
  node('#modal').open=true;
  const context=vm.createContext({console,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Image:class{constructor(){this.width=900;this.height=300;images.push(this);}set src(v){this.url=v;}},S:{company:{signature}},titles:{},views:{},owner:()=>role==='owner',settingsView:()=>'',panel:(a,b,c)=>c,btn:()=>'',esc:v=>v||'',field:()=>'',toast:()=>{},$:node,openModal:(title,html,callback)=>{save=callback;},api:async(path,payload)=>{calls.push({path,payload});}});
  vm.runInContext(fs.readFileSync(new URL('../my-tech-accounting/public/signature.js',import.meta.url),'utf8'),context);
  const event=(pointerId=1,extra={})=>({pointerId,isPrimary:true,pointerType:'touch',button:0,clientX:110,clientY:70,preventDefault(){},...extra});
  return {run:code=>vm.runInContext(code,context),node,canvas,drawing,images,calls,event,get alpha(){return alpha;},save:data=>save(data||{signatureName:'Name',signatureTitle:'Title'}),deferSave(){context.api=async(path,payload)=>{calls.push({path,payload});await new Promise(resolve=>{releaseSave=resolve;});};},releaseSave:()=>releaseSave()};
}

test('signature drawing supports tap, scaled touch input, single pointer, eraser, undo and empty-save protection',async()=>{
  const h=editor();await h.run("signatureUiDispatch('signature')");await assert.rejects(()=>h.save(),/กรุณาเขียนลายเซ็น/);
  h.canvas.onpointerdown(h.event());assert.deepEqual(h.drawing.lastPoint,[300,150]);assert.equal(h.node('#modal-form [type=submit]').disabled,true);
  h.canvas.onpointerdown(h.event(2,{isPrimary:false}));h.canvas.onpointerup(h.event(2));assert.equal(h.node('#modal-form [type=submit]').disabled,true);
  h.canvas.onpointerup(h.event());assert.equal(h.alpha,255);assert.equal(h.node('#signature-undo').disabled,false);await h.save();assert.equal(h.calls[0].payload.image.base64,'RURJVEVE');
  h.node('#signature-eraser').onclick();h.canvas.onpointerdown(h.event());h.canvas.onpointercancel(h.event());assert.equal(h.alpha,0);await assert.rejects(()=>h.save(),/กรุณาเขียนลายเซ็น/);
  h.node('#signature-undo').onclick();assert.equal(h.alpha,255);h.node('#signature-clear').onclick();assert.equal(h.alpha,0);h.node('#signature-undo').onclick();assert.equal(h.alpha,255);
});

test('signature preload blocks submission, name-only changes preserve existing image and drawing edits it',async()=>{
  const h=editor({signature:{assetId:'old-image',name:'Old'}}),ready=h.run("signatureUiDispatch('signature')");
  assert.equal(h.images[0].url,'/api/signature/old-image');assert.equal(h.node('#signature-upload').disabled,true);assert.equal(h.node('#signature-clear').disabled,true);await assert.rejects(()=>h.save(),/รอให้โหลด/);
  h.images[0].onload();await ready;assert.equal(h.alpha,255);assert.equal(h.node('#modal-form [type=submit]').disabled,false);await h.save();assert.equal(h.calls[0].payload.image,undefined);
  h.canvas.onpointerdown(h.event());h.canvas.onpointerup(h.event());await h.save();assert.ok(h.calls[1].payload.image);
  h.node('#signature-undo').onclick();await h.save();assert.equal(h.calls[2].payload.image,undefined);
});

test('closed or replaced signature editors ignore a delayed image and nonowners cannot open the editor',async()=>{
  const h=editor({signature:{assetId:'old-image'}}),ready=h.run("signatureUiDispatch('signature')");h.canvas.isConnected=false;h.node('#modal').open=false;h.images[0].onload();await ready;assert.equal(h.alpha,0);assert.equal(h.calls.length,0);
  const staff=editor({role:'staff'});assert.equal(await staff.run("signatureUiDispatch('signature')"),true);assert.equal(staff.images.length,0);assert.equal(staff.calls.length,0);assert.ok(staff.run('views.signature()').includes('เจ้าของระบบเท่านั้น'));
});

test('pending signature save locks drawing and editor tools until the captured image is saved',async()=>{
  const h=editor();await h.run("signatureUiDispatch('signature')");h.canvas.onpointerdown(h.event());h.canvas.onpointerup(h.event());h.deferSave();const saved=h.save();
  for(const key of ['#signature-pen','#signature-eraser','#signature-clear','#signature-undo','#signature-upload'])assert.equal(h.node(key).disabled,true);
  assert.equal(h.canvas.style.pointerEvents,'none');h.node('#signature-clear').onclick();assert.equal(h.alpha,255);h.canvas.onpointerdown(h.event());assert.equal(h.node('#signature-pad').pointer,null);
  h.releaseSave();await saved;assert.equal(h.node('#signature-clear').disabled,false);assert.equal(h.canvas.style.pointerEvents,'');
});

test('signature settings show verified readiness and unsigned document counts, hiding application without a usable image',()=>{
  const h=editor({signature:{assetId:'stored-image',name:'Owner'}});
  h.run("btn=(label,command)=>'<button data-action=\"'+command+'\">'+label+'</button>';S.signatureStatus={configured:false,error:'ไม่พบไฟล์ลายเซ็น',unsigned:{documents:2,receipts:1,payroll:3,bills:4,total:10}}");
  let html=h.run('signaturePanel()');assert.ok(html.includes('ไม่พบไฟล์ลายเซ็น'));assert.ok(html.includes('10 ฉบับ'));assert.ok(html.includes('สลิปเงินเดือน: 3 ฉบับ'));assert.ok(html.includes('บันทึกบิลค่าใช้จ่าย: 4 ฉบับ'));assert.ok(!html.includes('signature-apply-unsigned'));assert.ok(!html.includes('<img'));
  h.run('S.signatureStatus.configured=true');html=h.run('signaturePanel()');assert.ok(html.includes('ตรวจพบไฟล์รูปลายเซ็นจริง'));assert.ok(html.includes('signature-apply-unsigned'));assert.ok(html.includes('<img'));assert.ok(html.includes('รายงานการเงินใช้ลายเซ็นปัจจุบัน'));
  h.run('S.signatureStatus.unsigned={documents:0,receipts:0,payroll:0,bills:0,total:0}');assert.ok(!h.run('signaturePanel()').includes('signature-apply-unsigned'));
});

test('applying the current signature requires an owner confirmation listing every unsigned collection',async()=>{
  const h=editor();h.run("S.signatureStatus={configured:true,unsigned:{documents:2,receipts:1,payroll:3,bills:4,total:10}};openModal=(title,html,callback)=>{globalThis.signatureTestModal={title,html,callback}};");
  assert.equal(await h.run("signatureUiDispatch('signature-apply-unsigned')"),true);assert.equal(h.calls.length,0);
  const html=h.run('signatureTestModal.html');for(const value of ['10 ฉบับ','ใบเสนอราคา / Invoice: 2','ใบเสร็จรับเงิน: 1','สลิปเงินเดือน: 3','บันทึกบิลค่าใช้จ่าย: 4','เอกสารที่มีลายเซ็นแล้วจะเก็บลายเซ็นเดิม'])assert.ok(html.includes(value));
  await h.run('signatureTestModal.callback()');assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/company/signature/apply-unsigned');assert.equal(Object.keys(h.calls[0].payload).length,0);
  const absent=editor();await absent.run("signatureUiDispatch('signature-apply-unsigned')");assert.equal(absent.calls.length,0);
  const staff=editor({role:'staff'});staff.run('S.signatureStatus={configured:true,unsigned:{documents:1}}');await staff.run("signatureUiDispatch('signature-apply-unsigned')");assert.equal(staff.calls.length,0);
});
