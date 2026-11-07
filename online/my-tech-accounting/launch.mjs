import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const url='http://127.0.0.1:4317';
let ready=false;try{const r=await fetch(url+'/api/session',{signal:AbortSignal.timeout(1200)});ready=r.ok;}catch{}
if(!ready){const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});child.unref();for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,200));try{if((await fetch(url+'/api/session')).ok){ready=true;break;}}catch{}}}
if(!ready){console.error('เปิดระบบไม่สำเร็จ กรุณาตรวจว่ามีโปรแกรมอื่นใช้พอร์ต 4317 อยู่หรือไม่');process.exitCode=1;}else{spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,detached:true,stdio:'ignore'}).unref();}

