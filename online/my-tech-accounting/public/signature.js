const signatureSettingsBefore=settingsView;
const signatureUiCollections=[['documents','ใบเสนอราคา / Invoice'],['receipts','ใบเสร็จรับเงิน'],['payroll','สลิปเงินเดือน'],['bills','บันทึกบิลค่าใช้จ่าย']];
const signatureUiCount=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const signatureUiUnsigned=()=>signatureUiCollections.reduce((total,[key])=>total+signatureUiCount(S.signatureStatus?.unsigned?.[key]),0);
const signatureUiCountList=()=>'<ul>'+signatureUiCollections.map(([key,label])=>`<li>${label}: ${signatureUiCount(S.signatureStatus?.unsigned?.[key])} ฉบับ</li>`).join('')+'</ul>';
function signaturePanel(){
  const status=S.signatureStatus,configured=status?.configured===true,unsigned=signatureUiUnsigned();
  const readiness=configured?'<div class="notice info" role="status"><strong>พร้อมใช้งาน: ตรวจพบไฟล์รูปลายเซ็นจริงในระบบแล้ว</strong></div>':`<div class="notice" role="status"><strong>${status?'ลายเซ็นยังไม่พร้อมใช้งาน':'กำลังตรวจสอบไฟล์ลายเซ็น'}</strong><p>${esc(status?.error||'ต้องบันทึกและตรวจสอบไฟล์รูปลายเซ็นก่อนนำไปใส่เอกสาร')}</p><p>ชื่อผู้ลงนามหรือเส้นลงนามเพียงอย่างเดียวยังไม่ใช่รูปลายเซ็น เอกสารที่ไม่มีรูปจะแสดงเพียงช่องลงนาม</p></div>`;
  const missing=status?`<div class="notice"><strong>เอกสารที่ยังไม่มีรูปลายเซ็น: ${unsigned} ฉบับ</strong>${signatureUiCountList()}${unsigned?'<p>เอกสารเหล่านี้ยังไม่มีรูปลายเซ็น ต้องกดปุ่มด้านล่างเพื่อใส่ลายเซ็นปัจจุบันอย่างชัดเจน</p>':''}</div>`:'';
  return panel('เขียน / แก้ไขลายเซ็น','วาดด้วยเมาส์ นิ้ว หรือปากกา อัปโหลดภาพ และแก้ไขลายเซ็นเดิมได้',`${readiness}<div class="signature-settings"><div>${configured&&S.company.signature?.assetId?`<img class="signature-settings-image" src="/api/signature/${encodeURIComponent(S.company.signature.assetId)}" alt="ลายเซ็นที่ตรวจสอบไฟล์แล้ว">`:'<p class="muted">ยังไม่มีรูปลายเซ็นที่พร้อมใช้งาน</p>'}<strong>${esc(S.company.signature?.name||'')}</strong><p class="muted">${esc(S.company.signature?.title||'')}</p></div><div class="actions">${btn('เขียน / แก้ไขลายเซ็น','signature','')}${S.company.signature?.assetId?btn('นำลายเซ็นออกจากเอกสารใหม่','signature-remove','secondary'):''}</div></div><p class="muted">ลายเซ็นที่บันทึกใช้กับใบเสนอราคา Invoice ใบเสร็จรับเงิน สลิปเงินเดือน และบันทึกบิลค่าใช้จ่ายที่สร้างใหม่ รายงานการเงินใช้ลายเซ็นปัจจุบัน ส่วนเอกสารที่มีลายเซ็นแล้วจะเก็บลายเซ็นเดิม</p>${missing}${configured&&unsigned>0?btn('ใส่ลายเซ็นให้เอกสารที่ยังไม่มี','signature-apply-unsigned',''):''}`);
}
settingsView=function(){return signaturePanel()+signatureSettingsBefore();};
titles.signature='เขียน / แก้ไขลายเซ็น';
views.settings=settingsView;
views.signature=()=>owner()?signaturePanel():'<div class="notice info">เจ้าของระบบเท่านั้นที่จัดการลายเซ็นได้</div>';
async function signatureUiDispatch(command){
  if(!['signature','signature-remove','signature-apply-unsigned'].includes(command))return false;
  if(!owner()){toast('เจ้าของระบบเท่านั้นที่จัดการลายเซ็นได้');return true;}
  if(command==='signature-apply-unsigned'){
    const count=signatureUiUnsigned();
    if(!S.signatureStatus?.configured||!count){toast('ต้องมีไฟล์ลายเซ็นที่พร้อมใช้งานและเอกสารที่ยังไม่มีลายเซ็นก่อน');return true;}
    openModal('ใส่ลายเซ็นให้เอกสารที่ยังไม่มี',`<section class="full"><p>ยืนยันใส่รูปลายเซ็นปัจจุบันให้เอกสารต่อไปนี้ รวม ${count} ฉบับ</p>${signatureUiCountList()}<p>คำสั่งนี้จะบันทึกลายเซ็นลงในเอกสารที่ยังไม่มีเท่านั้น เอกสารที่มีลายเซ็นแล้วจะเก็บลายเซ็นเดิม แม้เปลี่ยนลายเซ็นปัจจุบันในภายหลัง</p><p>รายงานการเงินใช้ลายเซ็นปัจจุบันเมื่อเปิดรายงาน</p></section>`,()=>api('/api/company/signature/apply-unsigned',{}),'ยืนยันใส่ลายเซ็น');return true;
  }
  if(command==='signature-remove'){openModal('นำลายเซ็นออกจากเอกสารใหม่','<p class="full">เอกสารที่เคยออกแล้วจะเก็บลายเซ็นเดิมไว้ เอกสารใหม่จะไม่มีลายเซ็นจนกว่าจะตั้งค่าอีกครั้ง</p>',()=>api('/api/company/signature',{name:'',title:'',remove:true}),'นำออก');return true;}
  const signature=S.company.signature||{};let dirty=false,hasInk=false,loading=false,saving=false,activePointer=null,mode='pen';const undo=[];
  openModal('เขียน / แก้ไขลายเซ็น',field('ชื่อผู้ลงนาม','signatureName','text',{value:signature.name||'',optional:true,extra:'maxlength="120"'})+field('ตำแหน่ง','signatureTitle','text',{value:signature.title||'',optional:true,extra:'maxlength="120"'})+`<section class="full signature-editor"><h3>เขียนลายเซ็นในช่องด้านล่าง</h3><p class="muted">วาดด้วยเมาส์ นิ้ว หรือปากกา ใช้ยางลบและย้อนกลับเพื่อแก้ไข หรืออัปโหลดรูป PNG / JPG / WebP</p><div class="signature-tools" role="group" aria-label="เครื่องมือแก้ลายเซ็น"><button type="button" id="signature-pen" aria-pressed="true">ปากกา</button><button type="button" id="signature-eraser" class="secondary" aria-pressed="false">ยางลบ</button><button type="button" id="signature-undo" class="secondary" disabled>ย้อนกลับ</button><button type="button" id="signature-clear" class="secondary">ล้างเพื่อเขียนใหม่</button>${signature.assetId?'<button type="button" id="signature-restore" class="secondary">โหลดลายเซ็นเดิม</button>':''}</div><canvas id="signature-pad" width="900" height="300" aria-label="ช่องเขียนและแก้ไขลายเซ็น"></canvas><label><span>อัปโหลดรูปลายเซ็น</span><input id="signature-upload" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="signature-editor-message" class="muted" aria-live="polite"></div></section>`,async p=>{
    if(loading||saving||activePointer!==null)throw Error('รอให้โหลดรูปหรือเขียนเสร็จก่อนบันทึก');
    if((dirty||!signature.assetId)&&!hasInk)throw Error('กรุณาเขียนลายเซ็นก่อนบันทึก หรือนำลายเซ็นออกจากหน้าจัดการลายเซ็น');
    const image=dirty?{mime:'image/png',base64:canvas.toDataURL('image/png').split(',')[1]}:undefined;
    saving=true;update();try{await api('/api/company/signature',{name:p.signatureName||'',title:p.signatureTitle||'',image});}finally{saving=false;update();}
  },'บันทึกลายเซ็น');
  const canvas=$('#signature-pad'),context=canvas.getContext('2d'),modal=$('#modal'),message=$('#signature-editor-message'),submit=$('#modal-form [type=submit]'),upload=$('#signature-upload'),pen=$('#signature-pen'),eraser=$('#signature-eraser'),back=$('#signature-undo'),clear=$('#signature-clear'),restore=$('#signature-restore');
  const alive=()=>canvas.isConnected&&modal.open;
  const pixelsPresent=()=>context.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);
  const update=()=>{if(!alive())return;const locked=loading||saving||activePointer!==null;for(const el of [submit,upload,pen,eraser,clear,restore])if(el)el.disabled=locked;back.disabled=locked||!undo.length;canvas.style.pointerEvents=loading||saving?'none':'';pen.setAttribute('aria-pressed',String(mode==='pen'));eraser.setAttribute('aria-pressed',String(mode==='eraser'));};
  const snapshot=()=>{undo.push({pixels:context.getImageData(0,0,canvas.width,canvas.height),dirty,hasInk});if(undo.length>10)undo.shift();};
  pen.onclick=()=>{mode='pen';update();};eraser.onclick=()=>{mode='eraser';update();};
  back.onclick=()=>{if(loading||saving||activePointer!==null||!undo.length)return;const prior=undo.pop();context.putImageData(prior.pixels,0,0);dirty=prior.dirty;hasInk=prior.hasInk;message.textContent='ย้อนกลับแล้ว กดบันทึกเมื่อแก้ไขเสร็จ';update();};
  clear.onclick=()=>{if(loading||saving||activePointer!==null)return;snapshot();context.clearRect(0,0,canvas.width,canvas.height);dirty=true;hasInk=false;upload.value='';message.textContent='ล้างพื้นที่แล้ว เขียนลายเซ็นใหม่ก่อนกดบันทึก';update();};
  const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
  canvas.onpointerdown=e=>{if(loading||saving||activePointer!==null||e.isPrimary===false||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();snapshot();activePointer=e.pointerId;context.lineCap='round';context.lineJoin='round';context.lineWidth=mode==='eraser'?24:5;context.globalCompositeOperation=mode==='eraser'?'destination-out':'source-over';context.strokeStyle='#182a24';context.fillStyle='#182a24';const [x,y]=point(e);context.beginPath();context.arc(x,y,context.lineWidth/2,0,Math.PI*2);context.fill();context.beginPath();context.moveTo(x,y);dirty=true;hasInk=true;canvas.setPointerCapture(e.pointerId);update();};
  canvas.onpointermove=e=>{if(e.pointerId!==activePointer)return;e.preventDefault();const [x,y]=point(e);context.lineTo(x,y);context.stroke();};
  const finish=e=>{if(e.pointerId!==activePointer)return;activePointer=null;hasInk=pixelsPresent();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);message.textContent='แก้ไขแล้ว กดบันทึกลายเซ็นเพื่อนำไปใช้กับเอกสารใหม่';update();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=finish;
  async function loadImage(source,original,label){
    loading=true;update();message.textContent='กำลังโหลดรูปลายเซ็น…';const image=new Image();
    try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('โหลดรูปลายเซ็นไม่สำเร็จ ลองโหลดใหม่หรืออัปโหลดรูปอีกครั้ง'));image.src=source;});if(!alive())return;if(!original||undo.length||dirty)snapshot();context.globalCompositeOperation='source-over';context.clearRect(0,0,canvas.width,canvas.height);const scale=Math.min(canvas.width/image.width,canvas.height/image.height);context.drawImage(image,(canvas.width-image.width*scale)/2,(canvas.height-image.height*scale)/2,image.width*scale,image.height*scale);dirty=!original;hasInk=pixelsPresent();mode='pen';message.textContent=label;}catch(err){if(alive())message.textContent=err.message;}finally{loading=false;update();}
  }
  if(restore)restore.onclick=()=>loadImage('/api/signature/'+encodeURIComponent(signature.assetId),true,'โหลดลายเซ็นเดิมแล้ว สามารถเขียนหรือใช้ยางลบแก้ไขต่อได้');
  upload.onchange=async e=>{const file=e.target.files?.[0];if(!file||loading||saving||activePointer!==null)return;try{if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('เลือกไฟล์ PNG, JPG หรือ WebP');if(file.size>10*1024*1024)throw Error('เลือกภาพต้นฉบับไม่เกิน 10 MB');const url=URL.createObjectURL(file);try{await loadImage(url,false,'โหลดรูปแล้ว เขียนเพิ่มหรือใช้ยางลบได้ จากนั้นกดบันทึกลายเซ็น');}finally{URL.revokeObjectURL(url);}}catch(err){if(alive())message.textContent=err.message;}};
  if(signature.assetId)await loadImage('/api/signature/'+encodeURIComponent(signature.assetId),true,'โหลดลายเซ็นเดิมแล้ว สามารถเขียนหรือใช้ยางลบแก้ไขต่อได้');else{message.textContent='เขียนลายเซ็นหรืออัปโหลดรูป แล้วกดบันทึกลายเซ็น';update();}
  return true;
}
