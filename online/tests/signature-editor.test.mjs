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
