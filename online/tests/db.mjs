import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function bucket(){const files=new Map();return {async put(key,data){files.set(key,typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data));},async get(key){const b=files.get(key);return b?{async arrayBuffer(){return b.slice().buffer;},async text(){return new TextDecoder().decode(b);}}:null;}};}
export function database(filename=':memory:'){
  const raw=new DatabaseSync(filename);for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())raw.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const wrap=(sql,args=[])=>({sql,args,bind(...values){return wrap(sql,values);},async first(){return raw.prepare(sql).get(...args)||null;},async all(){return {results:raw.prepare(sql).all(...args)};},async run(){const r=raw.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}});
  return {raw,prepare:sql=>wrap(sql),async batch(statements){raw.exec('BEGIN IMMEDIATE');try{const out=[];for(const st of statements)out.push(await st.run());raw.exec('COMMIT');return out;}catch(e){raw.exec('ROLLBACK');throw e;}}};
}
