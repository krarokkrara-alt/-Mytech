// Never cache accounting pages, APIs or customer documents on shared devices.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(()=>new Response(
    '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MY TECH</title><body style="font-family:system-ui;padding:32px;background:#f6f7f2;color:#173a32"><h1>MY TECH</h1><h2>กรุณาเชื่อมต่ออินเทอร์เน็ต</h2><p>เชื่อมต่อแล้วเปิดแอพใหม่เพื่อใช้ข้อมูลบัญชีล่าสุด</p><a href="/">ลองอีกครั้ง</a></body></html>',
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
  )));
});
