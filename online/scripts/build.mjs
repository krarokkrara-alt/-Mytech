import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/document.css':'document.css','/document.js':'document.js'};
const assets={};for(const [url,file] of Object.entries(files)){assets[url]={body:fs.readFileSync(path.join(root,'my-tech-accounting/public',file),'utf8'),type:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'};}
assets['/app.js'].body+='\n'+fs.readFileSync('my-tech-accounting/public/online.js','utf8')+'\n'+fs.readFileSync('my-tech-accounting/public/trello.js','utf8')+'\n'+fs.readFileSync('my-tech-accounting/public/signature.js','utf8')+'\ninit();\n';
const backup=JSON.parse(fs.readFileSync('handoff/MYTECH-backup-2026-11-06.json','utf8'));
if(backup.format!=='MYTECH_BACKUP_V1'||backup.state.entries.length!==0||backup.state.pending.length!==9)throw new Error('Unexpected handoff data; review before publishing');
const generated=`export const assets=${JSON.stringify(assets)};\nexport const seedState=${JSON.stringify(backup.state)};\n`;
fs.writeFileSync('worker/generated.mjs',generated);
const modules=['my-tech-accounting/model.mjs','worker/signature.mjs','my-tech-accounting/documents.mjs','worker/payroll.mjs','worker/receipts.mjs','worker/generated.mjs','worker/trello-sync.mjs','worker/mcp.mjs','worker/index.mjs'];
let bundle=modules.map(file=>fs.readFileSync(file,'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/export (?=(?:async )?(const|function)\b)/g,'')).join('\n');
bundle='const randomUUID=()=>crypto.randomUUID();\n'+bundle;
fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});fs.writeFileSync('dist/server/index.js',bundle);fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built MY TECH online: existing application + D1 + payroll');
