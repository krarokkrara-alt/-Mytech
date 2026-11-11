import {uid,assert} from '../my-tech-accounting/model.mjs';
const signatureEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function signatureHtml(company){const signature=company?.signature;const image=signature?.image&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(signature.image)?`<img class="issuer-signature" alt="ลายเซ็นผู้ออกเอกสาร" src="${signature.image}">`:'<span class="signature-line">_________________________</span>';return `<div class="signature-block">${image}${signature?.name?'<div>'+signatureEscape(signature.name)+'</div>':''}${signature?.title?'<small>'+signatureEscape(signature.title)+'</small>':''}</div>`;}
export function signatureCompanies(s){return [s.company,...(s.documents||[]).map(d=>d.company),...(s.receipts||[]).map(d=>d.company),...(s.payroll||[]).map(d=>d.company),...(s.bills||[]).map(d=>d.company)].filter(Boolean);}
const signatureAssetId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const signatureMime=value=>['image/png','image/jpeg','image/webp'].includes(value);
export function signatureIsConfigured(company){return signatureAssetId(company?.signature?.assetId)&&signatureMime(company.signature.mime);}
export function signatureReferences(s){const refs=new Map();for(const company of signatureCompanies(s)){const value=company.signature;if(value?.assetId)refs.set(value.assetId,{id:value.assetId,mime:value.mime});}return [...refs.values()];}
export function validateSignature(company){const value=company?.signature;if(!value)return;assert(typeof value.name==='string'&&value.name.length<=120&&typeof value.title==='string'&&value.title.length<=120&&!('image' in value),'ข้อมูลลายเซ็นไม่ถูกต้อง');if(value.assetId)assert(signatureIsConfigured(company),'ไฟล์ลายเซ็นไม่ถูกต้อง');}
const signatureImageAssert=value=>assert(value,'ไฟล์รูปลายเซ็นไม่สมบูรณ์หรือขนาดภาพไม่ถูกต้อง');
const signatureDimensions=(width,height)=>signatureImageAssert(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=8192&&height<=8192&&width*height<=16777216);
const signatureText=(bytes,start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
const signatureRead32=(bytes,start)=>((bytes[start]*0x1000000)+(bytes[start+1]<<16)+(bytes[start+2]<<8)+bytes[start+3])>>>0;
const signatureReadLE32=(bytes,start)=>(bytes[start]+(bytes[start+1]<<8)+(bytes[start+2]<<16)+(bytes[start+3]*0x1000000))>>>0;
function signatureValidatePng(bytes){
  signatureImageAssert(bytes.length>=57&&signatureText(bytes,0,8)==='\x89PNG\r\n\x1a\n');
  let offset=8,header=false,data=false,endedData=false,palette=false,color,depth,compressed=0,zlib=[];
  while(offset+12<=bytes.length){
    const length=signatureRead32(bytes,offset),type=signatureText(bytes,offset+4,4),start=offset+8,end=start+length;
    signatureImageAssert(/^[A-Za-z]{4}$/.test(type)&&end+4<=bytes.length);
    if(!header){
      signatureImageAssert(type==='IHDR'&&length===13);header=true;
      signatureDimensions(signatureRead32(bytes,start),signatureRead32(bytes,start+4));
      depth=bytes[start+8];color=bytes[start+9];
      signatureImageAssert(({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[color]?.includes(depth)&&bytes[start+10]===0&&bytes[start+11]===0&&bytes[start+12]<=1);
    }else if(type==='IHDR'){signatureImageAssert(false);
    }else if(type==='PLTE'){
      signatureImageAssert(!data&&!palette&&length>0&&length<=768&&length%3===0&&color!==0&&color!==4&&(color!==3||length/3<=2**depth));palette=true;
    }else if(type==='IDAT'){
      signatureImageAssert(!endedData&&(color!==3||palette));data=true;compressed+=length;
      for(let i=start;i<end&&zlib.length<2;i++)zlib.push(bytes[i]);
    }else if(type==='IEND'){
      signatureImageAssert(length===0&&data&&compressed>=6&&end+4===bytes.length&&zlib.length===2&&(zlib[0]&15)===8&&(zlib[0]>>>4)<=7&&(zlib[0]*256+zlib[1])%31===0&&(zlib[1]&32)===0);return;
    }else{
      signatureImageAssert(type[0]===type[0].toLowerCase());
      if(data)endedData=true;
    }
    offset=end+4;
  }
  signatureImageAssert(false);
}
function signatureValidateJpeg(bytes){
  signatureImageAssert(bytes.length>=4&&bytes[0]===255&&bytes[1]===216);
  let offset=2,frame=false,scan=false,quantization=false,huffman=false,components=new Set();
  while(offset<bytes.length){
    signatureImageAssert(bytes[offset++]===255);while(bytes[offset]===255)offset++;
    signatureImageAssert(offset<bytes.length);const marker=bytes[offset++];
    if(marker===217){signatureImageAssert(frame&&scan&&offset===bytes.length);return;}
    signatureImageAssert(marker!==0&&marker!==216&&!(marker>=208&&marker<=215)&&offset+2<=bytes.length);
    const length=bytes[offset]*256+bytes[offset+1],start=offset+2,end=offset+length;
    signatureImageAssert(length>=2&&end<=bytes.length);
    if([192,193,194].includes(marker)){
      signatureImageAssert(!frame&&length>=11&&bytes[start]===8);
      const count=bytes[start+5];signatureImageAssert(count>=1&&count<=4&&length===8+3*count);
      signatureDimensions(bytes[start+3]*256+bytes[start+4],bytes[start+1]*256+bytes[start+2]);
      for(let i=0;i<count;i++){const at=start+6+i*3,id=bytes[at],sampling=bytes[at+1];signatureImageAssert(!components.has(id)&&(sampling>>>4)>=1&&(sampling>>>4)<=4&&(sampling&15)>=1&&(sampling&15)<=4&&bytes[at+2]<=3);components.add(id);}frame=true;
    }else if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){signatureImageAssert(false);
    }else if(marker===219){
      let at=start;while(at<end){const table=bytes[at++],precision=table>>>4;signatureImageAssert(precision<=1&&(table&15)<=3);at+=64*(precision+1);signatureImageAssert(at<=end);}signatureImageAssert(at===end&&end>start);quantization=true;
    }else if(marker===196){
      let at=start;while(at<end){signatureImageAssert(at+17<=end);const table=bytes[at++];signatureImageAssert((table>>>4)<=1&&(table&15)<=3);let count=0;for(let i=0;i<16;i++)count+=bytes[at++];signatureImageAssert(count>0&&count<=256&&at+count<=end);at+=count;}signatureImageAssert(at===end&&end>start);huffman=true;
    }else if(marker===218){
      const count=bytes[start];signatureImageAssert(frame&&quantization&&huffman&&count>=1&&count<=components.size&&length===6+2*count);
      const seen=new Set();for(let i=0;i<count;i++){const id=bytes[start+1+2*i],table=bytes[start+2+2*i];signatureImageAssert(components.has(id)&&!seen.has(id)&&(table>>>4)<=3&&(table&15)<=3);seen.add(id);}
      const spectral=start+1+2*count;signatureImageAssert(bytes[spectral]<=bytes[spectral+1]&&bytes[spectral+1]<=63&&(bytes[spectral+2]>>>4)<=13&&(bytes[spectral+2]&15)<=13);
      offset=end;let entropy=0;
      while(offset<bytes.length){
        if(bytes[offset]!==255){entropy++;offset++;continue;}
        signatureImageAssert(offset+1<bytes.length);
        if(bytes[offset+1]===0){entropy++;offset+=2;continue;}
        if(bytes[offset+1]>=208&&bytes[offset+1]<=215){offset+=2;continue;}
        break;
      }
      signatureImageAssert(entropy>0);scan=true;continue;
    }
    offset=end;
  }
  signatureImageAssert(false);
}
function signatureValidateWebp(bytes){
  signatureImageAssert(bytes.length>=26&&signatureText(bytes,0,4)==='RIFF'&&signatureText(bytes,8,4)==='WEBP'&&signatureReadLE32(bytes,4)===bytes.length-8);
  let offset=12,image=false,extended=false,canvas;
  while(offset+8<=bytes.length){
    const type=signatureText(bytes,offset,4),length=signatureReadLE32(bytes,offset+4),start=offset+8,end=start+length;
    signatureImageAssert(end+(length%2)<=bytes.length);
    if(type==='VP8X'){
      signatureImageAssert(offset===12&&!extended&&length===10&&(bytes[start]&0xc3)===0&&(bytes[start]&2)===0&&bytes[start+1]===0&&bytes[start+2]===0&&bytes[start+3]===0);
      canvas=[1+bytes[start+4]+bytes[start+5]*256+bytes[start+6]*65536,1+bytes[start+7]+bytes[start+8]*256+bytes[start+9]*65536];signatureDimensions(...canvas);extended=true;
    }else if(type==='VP8 '){
      signatureImageAssert(!image&&length>=11&&(bytes[start]&1)===0&&(bytes[start]&16)!==0&&signatureText(bytes,start+3,3)==='\x9d\x01\x2a');
      const width=(bytes[start+6]+bytes[start+7]*256)&16383,height=(bytes[start+8]+bytes[start+9]*256)&16383,partition=(bytes[start]+bytes[start+1]*256+bytes[start+2]*65536)>>>5;
      signatureDimensions(width,height);signatureImageAssert(partition>0&&partition<=length-10&&(!canvas||canvas[0]===width&&canvas[1]===height));image=true;
    }else if(type==='VP8L'){
      signatureImageAssert(!image&&length>=6&&bytes[start]===47&&(bytes[start+4]>>>5)===0);
      const packed=signatureReadLE32(bytes,start+1),width=(packed&16383)+1,height=((packed>>>14)&16383)+1;
      signatureDimensions(width,height);signatureImageAssert(!canvas||canvas[0]===width&&canvas[1]===height);image=true;
    }else{
      signatureImageAssert(extended&&!['ANIM','ANMF'].includes(type));
      if(type==='ALPH')signatureImageAssert(!image&&length>=2);
    }
    if(length%2)signatureImageAssert(bytes[end]===0);
    offset=end+(length%2);
  }
  signatureImageAssert(image&&offset===bytes.length);
}
// Structural validation is synchronous for both upload and backup restore. Compressed
// pixel streams are not decoded here; browsers still perform their normal image decode.
export function validateSignatureBytes(bytes,mime){
  assert(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=512*1024,'รูปลายเซ็นต้องไม่เกิน 512 KB');
  assert(signatureMime(mime),'รองรับรูปลายเซ็น PNG, JPG และ WebP เท่านั้น');
  if(mime==='image/png')signatureValidatePng(bytes);else if(mime==='image/jpeg')signatureValidateJpeg(bytes);else signatureValidateWebp(bytes);
}
export async function hydrateSignature(env,company){const copy=structuredClone(company||{}),signature=copy.signature;if(signature?.assetId){const file=await env.BUCKET.get('signatures/'+signature.assetId);assert(file,'ไม่พบไฟล์ลายเซ็น กรุณาตรวจไฟล์สำรอง');const bytes=new Uint8Array(await file.arrayBuffer());validateSignatureBytes(bytes,signature.mime);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));signature.image='data:'+signature.mime+';base64,'+btoa(binary);}return copy;}
export function validateSignatureBackup(backup){for(const company of signatureCompanies(backup.state))validateSignature(company);const files=backup.signatureFiles||[];assert(Array.isArray(files)&&files.length<=500,'ไฟล์ลายเซ็นในข้อมูลสำรองไม่ถูกต้อง');const ids=new Set();for(const file of files){assert(signatureAssetId(file.id)&&!ids.has(file.id)&&signatureMime(file.mime),'รายการไฟล์ลายเซ็นไม่ถูกต้อง');ids.add(file.id);}for(const ref of signatureReferences(backup.state))assert(files.some(f=>f.id===ref.id&&f.mime===ref.mime),'ไฟล์สำรองไม่มีรูปลายเซ็นที่เอกสารอ้างอิง');}
export function prepareSignatureRestore(state,files=[]){const mapped=files.map(f=>({id:uid(),oldId:f.id,mime:f.mime})),copy=structuredClone(state);for(const company of signatureCompanies(copy)){if(company.signature?.assetId){const replacement=mapped.find(f=>f.oldId===company.signature.assetId);assert(replacement,'ไม่พบไฟล์ลายเซ็นในชุดสำรอง');company.signature.assetId=replacement.id;company.signature.mime=replacement.mime;}}return {state:copy,files:mapped};}
