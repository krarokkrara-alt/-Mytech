import http from 'node:http';
import worker from '../dist/server/index.js';
import {database,bucket} from '../tests/db.mjs';
const DB=database(),env={DB,BUCKET:bucket(),OWNER_EMAIL:'owner@example.test',DATA_KEY:Buffer.alloc(32,1).toString('base64')};
http.createServer(async(req,res)=>{try{const origin='http://127.0.0.1:4318',body=[];for await(const part of req)body.push(part);const h=new Headers(req.headers);for(const key of [...h.keys()])if(key.startsWith('oai-'))h.delete(key);
  const cookie=req.headers.cookie||'';const role=cookie.match(/preview-role=(owner|staff)/)?.[1];if(role){h.set('oai-authenticated-user-id','preview-'+role);h.set('oai-authenticated-user-email',role+'@example.test');}
  if(req.url.startsWith('/preview-role/')){const role=req.url.split('/').pop();res.writeHead(302,{'Set-Cookie':'preview-role='+role+'; Path=/; SameSite=Strict','Location':'/'});res.end();return;}
  if(req.url.startsWith('/signin-with-chatgpt')){res.writeHead(302,{Location:'/preview-role/owner'});res.end();return;}
  const r=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:h,...(body.length?{body:Buffer.concat(body),duplex:'half'}:{})}),env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
}catch(e){res.writeHead(500);res.end(e.message);}}).listen(4318,'127.0.0.1',()=>console.log('MY TECH local preview: http://127.0.0.1:4318 (mock identity, ephemeral test database only)'));
