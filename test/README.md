# บอททดสอบเกม "วางแผนดี ชีวิตมีเงินเก็บ"

บอทผู้เล่นอัตโนมัติสำหรับทดสอบโหมดออนไลน์ (WebSocket) — ใช้ **WebSocket ในตัวของ Node 21+** ไม่ต้องลงแพ็กเกจอะไรเพิ่ม

## ไฟล์
- `bot.mjs` — คลาส `Bot` + CLI รันบอทเดี่ยว 1 ตัว
- `run-test.mjs` — orchestrator: สร้างหัวหน้าห้อง 1 + ผู้เล่นบอท N คน เล่นจนจบเกมในโปรเซสเดียว แล้วสรุปอันดับ

## รันเทสต์เต็มรูปแบบ (แนะนำ)
```bash
node test/run-test.mjs                                  # class 12 รอบ 3 ผู้เล่น (ค่าเริ่มต้น)
node test/run-test.mjs --mode class --rounds 20 --players 8
node test/run-test.mjs --mode turns --rounds 12 --players 3
node test/run-test.mjs --room myroom --url https://elegant-gnome-812.higgsfield.gg/
```
พารามิเตอร์: `--mode class|turns` • `--rounds 12|20|30` • `--players N` • `--room <ชื่อห้อง>` • `--url <base>` • `--verbose`

## รันบอทเดี่ยว (ไปเข้าห้องที่คนจริงเล่นอยู่ได้)
```bash
# หัวหน้าห้อง (มอนิเตอร์ในโหมด class) — ตั้งค่า+เริ่มเกมเอง แล้วสั่ง begin ด้วยมือทีหลัง
node test/bot.mjs --room test1 --name ครู --host --start --mode class --rounds 12

# ผู้เล่นบอทเข้าไปสมทบห้องที่คุณสร้างจากหน้าเว็บ
node test/bot.mjs --room test1 --name บอท1
node test/bot.mjs --room test1 --name บอท2
```
ธง: `--host` (จองตำแหน่งหัวหน้า) • `--start` (config โหมด/รอบให้อัตโนมัติ) • `--smart false` (สุ่มตอบ quiz แทนตอบถูก)

## บอทเล่นยังไง
- **โหมดทั้งห้อง (class):** stage `roll` → ส่ง `croll` • stage `respond` → ตัดสินใจตาม `myPend` • หัวหน้า/มอนิเตอร์คอยส่ง `cforce` เมื่อหมดเวลา
- **โหมดผลัดตา (turns):** ถึงตา → `roll` • มี `pending` ของตัวเอง → ตัดสินใจ
- **การตัดสินใจ:** รายรับแบ่งเข้าเงินออมครึ่งหนึ่ง • quiz โหมด smart ดึงเฉลยจาก `../public/data.js` มาตอบถูก (ปิดด้วย `--smart false`) • ลงทุนก้อนกลาง • โอกาส (match/gamble) ตอบรับเสมอ

## ข้อจำกัด
- ต้องรันกับ **URL ที่ deploy แล้ว** เท่านั้น (WebSocket kernel อยู่ฝั่งเซิร์ฟเวอร์ Higgsfield) — `python -m http.server` ทดสอบได้เฉพาะโหมดเครื่องเดียว ไม่มี WS
- บอทเดี่ยว 1 ตัวเริ่มเกมไม่ได้ (กติกาต้องมีผู้เล่น ≥ 2)
