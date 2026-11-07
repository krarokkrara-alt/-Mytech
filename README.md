# MY TECH — บัญชี สต๊อก และเงินเดือน

รุ่นออนไลน์พัฒนาต่อจากโปรแกรมเดิม อยู่ใน [online/](online/README.md) ใช้ Cloudflare Worker, D1 และ R2 ผ่าน Sites มีสิทธิ์ผู้เข้าชม/ผู้แก้ไข/เจ้าของ และเงินเดือนพนักงาน

เว็บไซต์: https://mytech-accounting-payroll.modest-thyme-5086.chatgpt.site

สำหรับพัฒนา: เข้าโฟลเดอร์ online แล้วรัน node scripts/build.mjs และ node --test tests/*.test.mjs my-tech-accounting/tests/model.test.mjs

ซอร์ส local เดิมใน my-tech-accounting/ ยังคงเดิมและเปิดเฉพาะ 127.0.0.1 ห้ามเปิด server.mjs รุ่นไม่มีล็อกอินต่ออินเทอร์เน็ต ข้อมูลจริงและรหัสลับไม่เก็บใน GitHub บัญชีเจ้าของกำหนดผ่าน runtime secret ฝั่งโฮสต์
