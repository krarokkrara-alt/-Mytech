export const mcpFileInput={type:'object',properties:{download_url:{type:'string',maxLength:8192,description:'Temporary download URL provided by the chat file host; never invent one'},file_id:{type:'string',minLength:1,maxLength:200,description:'Stable file ID supplied by the chat host'},mime_type:{type:'string',maxLength:150},file_name:{type:'string',maxLength:1024}},required:['download_url','file_id'],additionalProperties:false};
export const mcpFilesInput={type:'array',items:mcpFileInput,maxItems:10,description:'User-selected chat attachments. Up to 10 files, 10 MB each. Payroll evidence must be marked payrollOnly and stay in MY TECH.'};
const mcpFileMimes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
function mcpFileUrl(raw){let url;try{url=new URL(raw);}catch{throw Error('ลิงก์ไฟล์ไม่ถูกต้อง กรุณาแนบไฟล์จากแชตใหม่');}if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(url.hostname==='oaiusercontent.com'||url.hostname.endsWith('.oaiusercontent.com')))throw Error('รับเฉพาะลิงก์ไฟล์แนบจากระบบแชต กรุณาแนบไฟล์ใหม่หรืออัปโหลดผ่านเว็บ MY TECH');return url;}
function mcpCheckFileBytes(bytes,mime){
  const ascii=(start,end)=>new TextDecoder().decode(bytes.slice(start,end));
  if(mime==='image/png'&&![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw Error('ข้อมูลรูป PNG ไม่ถูกต้อง');
  if(mime==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('ข้อมูลรูป JPG ไม่ถูกต้อง');
  if(mime==='image/webp'&&!(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'))throw Error('ข้อมูลรูป WebP ไม่ถูกต้อง');
  if(mime==='application/pdf'&&ascii(0,5)!=='%PDF-')throw Error('ข้อมูล PDF ไม่ถูกต้อง');
  if(mime.includes('officedocument')&&!(bytes[0]===80&&bytes[1]===75))throw Error('ข้อมูลเอกสาร Office ไม่ถูกต้อง');
}
export async function downloadMcpFile(file){
  let url=mcpFileUrl(file.download_url);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),max=10*1024*1024;
  try{
    let response;for(let redirects=0;redirects<4;redirects++){try{response=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'application/octet-stream,*/*'}});}catch{throw Error('โหลดไฟล์ไม่สำเร็จ กรุณาแนบไฟล์ใหม่แล้วลองคำขอเดิม');}
      if(response.status>=300&&response.status<400){const next=response.headers.get('location');await response.body?.cancel();if(!next||redirects===3)throw Error('ลิงก์ไฟล์เปลี่ยนปลายทางมากเกินไป');url=mcpFileUrl(new URL(next,url).href);continue;}break;}
    if(!response.ok){await response.body?.cancel();throw Error(response.status===401||response.status===403?'ลิงก์ไฟล์หมดอายุ กรุณาแนบไฟล์ใหม่แล้วลองคำขอเดิม':'โหลดไฟล์แนบไม่สำเร็จ ('+response.status+')');}
    if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('ไฟล์ต้องไม่เกิน 10 MB');}
    const reader=response.body?.getReader();if(!reader)throw Error('ไฟล์แนบว่าง');const chunks=[];let size=0;for(;;){let read;try{read=await reader.read();}catch{throw Error('โหลดไฟล์ไม่ครบ กรุณาลองคำขอเดิม');}if(read.done)break;size+=read.value.byteLength;if(size>max){await reader.cancel();throw Error('ไฟล์ต้องไม่เกิน 10 MB');}chunks.push(read.value);}if(!size)throw Error('ไฟล์แนบว่าง');
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    const declared=String(file.mime_type||'').toLowerCase(),header=(response.headers.get('content-type')||'').split(';')[0].toLowerCase(),byName=mcpFileMimes[String(file.file_name||'').split('.').pop().toLowerCase()],supported=Object.values(mcpFileMimes),mime=supported.includes(declared)?declared:supported.includes(header)?header:byName;
    if(!mime)throw Error('รองรับรูป PNG, JPG, WebP, PDF, Word, Excel, CSV และ TXT');mcpCheckFileBytes(bytes,mime);
    const extension=Object.entries(mcpFileMimes).find(([,v])=>v===mime)?.[0]||'bin',name=String(file.file_name||file.file_id+'.'+extension).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
    return {bytes,mime,name};
  }finally{clearTimeout(timer);}
}
