// วางแผนดี ชีวิตมีเงินเก็บ — กติกาออนไลน์ (rules module รันฝั่งเซิร์ฟเวอร์ในแพลตฟอร์ม Higgsfield)
// สัญญา: self-contained ES module, ไม่มี import, ไม่มี timer, state เป็น JSON ล้วน
// 2 โหมดในไฟล์เดียว: "turns" ผลัดตา 2–6 คน • "class" ทั้งห้องเล่นพร้อมกันสไตล์ Kahoot 2–50 คน
// 2 โหมดในไฟล์เดียว: "turns" ผลัดตา 2–6 คน • "class" ทั้งห้อง 2–120 คน
//   (แพลตฟอร์มไม่มี timer ฝั่งเซิร์ฟเวอร์ — เก็บ stageDeadline ไว้ใน state ให้ client นับถอยหลัง
//    แล้ว client ใดก็ได้ส่ง cforce เมื่อเลยเวลา เซิร์ฟเวอร์ตรวจ Date.now() ของตัวเองก่อนยอมรับ)
// หมายเหตุ: ข้อมูลบอร์ด/การ์ด/คำถามซ้ำกับ data.js ฝั่ง client โดยตั้งใจ (ไฟล์นี้ import ไม่ได้) — แก้ต้องแก้คู่กัน

const RULES = {
  startMoney: 5000,
  interestPct: 0.10,
  interestCap: 2000,
  withdrawFeePct: 0.10,
  quizReward: 1000,
  quizBigReward: 1500,
  roundChoices: [12, 20, 30],
  defaultRounds: 30,
  turnsMax: 6,
  classMax: 120,
  classRollMs: 20000,     // เวลากดทอยในโหมดทั้งห้อง
  classRespondMs: 40000,  // เวลาตอบคำถาม/ตัดสินใจ
  graceMs: 2500,          // เผื่อ latency ก่อนยอมให้ cforce
  historyCap: 8,         // โหมดทั้งห้อง: เก็บสมุดบัญชีต่อคนล่าสุดกี่รายการ (กัน state บวมเกินขีดจำกัด storage 128KB)
                         // ห้องใหญ่ (>50 คน) ลดอัตโนมัติใน log() ให้รวมทั้งห้อง ~400 รายการ
  hostAwayMs: 90000,     // หัวหน้าเงียบ (ไม่มี action/ping) นานเท่านี้ → คนอื่นขอรับตำแหน่งได้
};

const BOARD = [
  { n: 0, type: "start", name: "START", icon: "🚩" },
  { n: 1, type: "income", name: "รายรับ", desc: "รับเงินเดือน", amount: 2000, icon: "💵" },
  { n: 2, type: "save", name: "การออม", desc: "เก็บออมเพื่ออนาคต", amount: 1000, icon: "🐷" },
  { n: 3, type: "invest", name: "การลงทุน", desc: "ลงทุนให้เงินงอกเงย", icon: "📈" },
  { n: 4, type: "event", name: "เหตุการณ์", icon: "❓" },
  { n: 5, type: "quiz", name: "ความรู้", icon: "📖" },
  { n: 6, type: "expense", name: "รายจ่ายจำเป็น", desc: "จ่ายค่าอาหารและเดินทาง", amount: 1500, icon: "🍜" },
  { n: 7, type: "chance", name: "โอกาส", icon: "🎁" },
  { n: 8, type: "expense", name: "ภาษี", desc: "จ่ายภาษี", amount: 1000, icon: "🧾" },
  { n: 9, type: "shield", name: "เงินสำรองฉุกเฉิน", icon: "🛡️" },
  { n: 10, type: "event", name: "เหตุการณ์", icon: "❓" },
  { n: 11, type: "expense", name: "บริจาค", desc: "แบ่งปันสิ่งดี ๆ", amount: 500, icon: "❤️" },
  { n: 12, type: "expense", name: "พักผ่อน", desc: "ให้รางวัลตัวเอง", amount: 1000, icon: "🏖️" },
  { n: 13, type: "quiz", name: "ความรู้", icon: "📖" },
  { n: 14, type: "income", name: "สร้างรายได้", desc: "หารายได้เสริม", amount: 2000, icon: "🧺" },
  { n: 15, type: "event", name: "เหตุการณ์", icon: "❓" },
  { n: 16, type: "expense", name: "ซ่อมแซม", desc: "ซ่อมของที่เสีย", amount: 1000, icon: "🔧" },
  { n: 17, type: "invest", name: "การลงทุน", desc: "ลงทุนต่อเนื่อง", icon: "📈" },
  { n: 18, type: "chance", name: "โอกาส", icon: "🎁" },
  { n: 19, type: "expense", name: "รายจ่ายฟุ่มเฟือย", desc: "ใช้จ่ายเกินตัว", amount: 1500, icon: "🛍️" },
  { n: 20, type: "quiz", name: "ความรู้", icon: "📖" },
  { n: 21, type: "income", name: "รายรับพิเศษ", desc: "โบนัสพิเศษ", amount: 3000, icon: "💰" },
  { n: 22, type: "event", name: "เหตุการณ์", icon: "❓" },
];

const EVENTS = [
  { icon: "🌊", t: "น้ำท่วมบ้าน", d: "ต้องซ่อมแซมบ้าน", cash: -3000 },
  { icon: "🤒", t: "เจ็บป่วย", d: "เสียค่ารักษาพยาบาล", cash: -2000 },
  { icon: "🏆", t: "ได้รับรางวัลจากการประกวด", d: "ความพยายามให้ผลตอบแทน", cash: 2000 },
  { icon: "💼", t: "ได้โบนัสพิเศษจากบริษัท", d: "ทำงานดีจนหัวหน้าชม", cash: 5500 },
  { icon: "📈", t: "เศรษฐกิจดี", d: "เงินออมได้กำไร 20% (สูงสุด 4,000) — ใครไม่มีเงินออมก็ไม่ได้กำไร!", savingsPct: 0.20, cap: 4000 },
  { icon: "📱", t: "มือถือตกน้ำ", d: "ต้องส่งซ่อมด่วน", cash: -1500 },
  { icon: "🚲", t: "จักรยานยางแตก", d: "ค่าซ่อมและอะไหล่", cash: -800 },
  { icon: "🤝", t: "เพื่อนคืนเงินที่ยืมไป", d: "ให้ยืมอย่างมีสติ ได้คืนครบ", cash: 1000 },
  { icon: "🛒", t: "ขายของออนไลน์ได้กำไร", d: "ไอเดียดีสร้างรายได้", cash: 1500 },
  { icon: "🦷", t: "ปวดฟันกะทันหัน", d: "ค่าหาหมอฟัน", cash: -1200 },
  { icon: "⚡", t: "ลืมปิดแอร์ทั้งคืน", d: "ค่าไฟเดือนนี้พุ่ง", cash: -700 },
  { icon: "🧑‍🍳", t: "ทำงานเสริมวันหยุด", d: "ขยันหารายได้เพิ่ม", cash: 1800 },
];

const CHANCES = [
  { icon: "🧥", t: "เจอเงินในกระเป๋าเสื้อเก่า", d: "โชคเล็ก ๆ ของคนชอบเก็บ", kind: "gain", amount: 300 },
  { icon: "🎟️", t: "ได้คูปองส่วนลด", d: "ซื้อของจำเป็นได้ถูกลง", kind: "gain", amount: 500 },
  { icon: "🏦", t: "โครงการออมทวีคูณ", d: "ฝากเข้าเงินออม 500 บาท ธนาคารสมทบให้อีก 500!", kind: "matchDeposit", amount: 500 },
  { icon: "💹", t: "ดอกเบี้ยพิเศษ", d: "รับดอกเบี้ยพิเศษ 10% ของเงินออม (สูงสุด 1,500)", kind: "savingsPct", pct: 0.10, cap: 1500 },
  { icon: "♻️", t: "ขายของมือสอง", d: "ของไม่ใช้แล้วเปลี่ยนเป็นเงิน", kind: "gain", amount: 800 },
  { icon: "🎓", t: "คอร์สการเงินฟรี", d: "ตอบคำถามพิเศษ ถูกรับ 1,500 บาท!", kind: "bonusQuiz" },
  { icon: "🏅", t: "รางวัลนักออมดีเด่น", d: "เงินออมตั้งแต่ 5,000 รับ 1,000 เข้าเงินออม", kind: "saverPrize", need: 5000, amount: 1000 },
  { icon: "🧁", t: "ชวนเปิดแผงขายขนม", d: "ลงทุน 1,000 ทอยเต๋าได้ 3 ขึ้นไปรับ 2,000", kind: "gamble", cost: 1000, prize: 2000, needRoll: 3 },
];

const QUIZ = [
  { q: "ข้อใดคือการใช้จ่ายที่ \"ไม่จำเป็น\"?", c: ["ค่าอาหาร", "ค่าเดินทางไปโรงเรียน", "ซื้อของตามกระแส", "ค่ารักษาพยาบาล"], a: 2, x: "ของตามกระแสคือ \"อยากได้\" ไม่ใช่ \"จำเป็น\" — ก่อนซื้อให้ถามตัวเองก่อนเสมอ" },
  { q: "หลักการออมที่ดีที่สุดคือข้อใด?", c: ["ใช้ก่อน เหลือแล้วค่อยออม", "ออมก่อน เหลือแล้วค่อยใช้", "ยืมเงินมาออม", "รอมีเงินเยอะแล้วค่อยออม"], a: 1, x: "\"ออมก่อนใช้\" — แบ่งเงินออมทันทีที่มีรายรับ จะออมได้สม่ำเสมอกว่ารอเงินเหลือ" },
  { q: "เงินสำรองฉุกเฉินควรมีอย่างน้อยเท่าไหร่?", c: ["1 เท่าของรายจ่ายต่อเดือน", "3–6 เท่าของรายจ่ายต่อเดือน", "ไม่จำเป็นต้องมี", "20 เท่าของรายจ่ายต่อเดือน"], a: 1, x: "เงินสำรอง 3–6 เดือนช่วยให้ผ่านเหตุไม่คาดฝัน เช่น ป่วยหรือตกงาน โดยไม่ต้องเป็นหนี้" },
  { q: "\"ดอกเบี้ยทบต้น\" หมายถึงอะไร?", c: ["ดอกเบี้ยที่จ่ายให้ธนาคาร", "ดอกเบี้ยที่คิดจากเงินต้นอย่างเดียว", "ดอกเบี้ยที่คิดจากเงินต้นรวมกับดอกเบี้ยสะสม", "ค่าธรรมเนียมบัญชี"], a: 2, x: "ดอกเบี้ยทบต้นทำให้เงินโตเร็วขึ้นเรื่อย ๆ ยิ่งออมนานยิ่งได้มาก" },
  { q: "ถ้าอยากรู้ว่าเงินหายไปไหนทุกเดือน ควรทำอย่างไร?", c: ["เดาเอา", "จดบันทึกรายรับ-รายจ่าย", "เลิกใช้เงิน", "ถามเพื่อน"], a: 1, x: "การจดบันทึกช่วยให้เห็นพฤติกรรมใช้เงินของตัวเอง และหาจุดที่ประหยัดได้" },
  { q: "สูตรแบ่งเงิน 50/30/20 ส่วน 20% คือเงินสำหรับอะไร?", c: ["ของฟุ่มเฟือย", "ค่าอาหาร", "เงินออม", "ค่าเดินทาง"], a: 2, x: "50% จำเป็น • 30% อยากได้ • 20% เก็บออม — สูตรจัดงบง่าย ๆ ที่ใช้ได้จริง" },
  { q: "ข้อใดเป็น \"รายรับ\"?", c: ["ค่าขนม", "เงินเดือน", "ค่าน้ำค่าไฟ", "ค่าเช่าบ้านที่ต้องจ่าย"], a: 1, x: "รายรับคือเงินที่ไหลเข้ามา ส่วนรายจ่ายคือเงินที่ไหลออกไป" },
  { q: "การลงทุนที่ให้ผลตอบแทนสูง มักมาพร้อมกับอะไร?", c: ["ความเสี่ยงสูง", "กำไรแน่นอน", "ไม่มีความเสี่ยง", "ของแถม"], a: 0, x: "High risk, high return — ก่อนลงทุนต้องเข้าใจความเสี่ยงและลงเงินที่เสียได้" },
  { q: "มีคนชวนลงทุน \"กำไร 30% ต่อเดือน การันตี ไม่เสี่ยง\" ควรทำอย่างไร?", c: ["รีบลงทุนทันที", "ชวนเพื่อนมาลงด้วย", "สงสัยว่าเป็นแชร์ลูกโซ่ และไม่ลงทุน", "ขอกู้เงินมาลงทุน"], a: 2, x: "ผลตอบแทนสูงผิดปกติ + การันตี = สัญญาณแชร์ลูกโซ่ อย่าหลงเชื่อเด็ดขาด" },
  { q: "หนี้ข้อใดถือว่าเป็น \"หนี้ดี\" ที่สุด?", c: ["กู้ซื้อของฟุ่มเฟือย", "กู้เพื่อการศึกษา", "กู้มาเที่ยว", "กู้มาเล่นพนัน"], a: 1, x: "หนี้ดีคือหนี้ที่สร้างอนาคตหรือรายได้ เช่น การศึกษา — หนี้เพื่อบริโภคคือหนี้เสีย" },
  { q: "ก่อนซื้อของทุกครั้ง ควรถามตัวเองว่าอะไร?", c: ["ลดราคาไหม", "จำเป็นหรือแค่อยากได้", "เพื่อนมีหรือยัง", "สีสวยไหม"], a: 1, x: "แยก \"Need\" กับ \"Want\" ให้ออก จะช่วยลดรายจ่ายฟุ่มเฟือยได้มาก" },
  { q: "\"เงินเฟ้อ\" ส่งผลอย่างไร?", c: ["ของถูกลง", "ของแพงขึ้น เงินเท่าเดิมซื้อได้น้อยลง", "เงินในบัญชีหายไป", "ไม่มีผลอะไร"], a: 1, x: "เงินเฟ้อทำให้ค่าของเงินลดลง — การออมและลงทุนช่วยให้เงินโตทันราคาของ" },
  { q: "เป้าหมายการออมที่ดีควรเป็นแบบใด?", c: ["ออมไปเรื่อย ๆ ไม่ต้องมีเป้า", "ชัดเจน มีจำนวนเงินและกำหนดเวลา", "ตั้งเป้าสูงจนทำไม่ได้", "แล้วแต่อารมณ์"], a: 1, x: "เป้าหมายชัดเจน เช่น \"เก็บ 3,000 ใน 3 เดือน\" ทำให้มีแรงจูงใจและวัดผลได้" },
  { q: "ฝากเงิน 1,000 บาท ดอกเบี้ย 10% ต่อปี ครบ 1 ปีจะมีเงินเท่าไหร่?", c: ["1,010 บาท", "1,100 บาท", "1,500 บาท", "2,000 บาท"], a: 1, x: "ดอกเบี้ย 10% ของ 1,000 = 100 บาท รวมเป็น 1,100 บาท" },
  { q: "ถ้ามีหนี้อยู่และได้เงินก้อนมา ควรทำอะไรก่อน?", c: ["ซื้อของที่อยากได้", "ชำระหนี้ที่ดอกเบี้ยสูงก่อน", "เก็บเงินสดไว้เฉย ๆ", "ให้เพื่อนยืมต่อ"], a: 1, x: "หนี้ดอกเบี้ยสูงกินเงินเราทุกวัน — ปลดหนี้ก่อนแล้วค่อยออมจะคุ้มกว่า" },
  { q: "ข้อใดช่วยประหยัดค่าไฟได้จริง?", c: ["เปิดแอร์ทั้งวัน", "ปิดไฟและถอดปลั๊กเมื่อไม่ใช้", "เปิดตู้เย็นบ่อย ๆ", "เปิดทีวีทิ้งไว้"], a: 1, x: "นิสัยเล็ก ๆ อย่างปิดไฟ-ถอดปลั๊ก ช่วยลดรายจ่ายประจำได้ทุกเดือน" },
  { q: "มี SMS แจ้งว่า \"คุณถูกรางวัล โอนค่าธรรมเนียมมาก่อน\" ควรทำอย่างไร?", c: ["รีบโอนทันที", "ไม่โอน เพราะเป็นมิจฉาชีพ", "โอนแค่ครึ่งเดียว", "ส่งต่อให้เพื่อน"], a: 1, x: "ของรางวัลจริงไม่มีการให้โอนเงินก่อน — นี่คือกลโกงยอดฮิตของมิจฉาชีพ" },
  { q: "\"อย่าใส่ไข่ทุกฟองในตะกร้าใบเดียว\" สอนเรื่องอะไร?", c: ["การเลี้ยงไก่", "การกระจายการลงทุนเพื่อลดความเสี่ยง", "การเก็บเงินไว้ที่เดียว", "การซื้อของถูก"], a: 1, x: "กระจายเงินไปหลายที่ ถ้าที่หนึ่งเสียหาย ยังเหลือที่อื่น" },
  { q: "ออมวันละ 20 บาท ครบ 1 ปี (365 วัน) จะได้ประมาณเท่าไหร่?", c: ["730 บาท", "3,650 บาท", "7,300 บาท", "73,000 บาท"], a: 2, x: "20 × 365 = 7,300 บาท — เงินเล็ก ๆ ที่สม่ำเสมอกลายเป็นเงินก้อนได้" },
  { q: "บัญชีเงินฝากออมทรัพย์เหมาะกับเงินแบบใด?", c: ["เงินสำรองที่อาจต้องถอนใช้เมื่อจำเป็น", "เงินลงทุนระยะยาว 20 ปี", "เงินเล่นพนัน", "เงินที่ไม่มีวันใช้"], a: 0, x: "ออมทรัพย์ถอนง่าย เหมาะกับเงินสำรองฉุกเฉิน" },
  { q: "สิ่งแรกที่ควรทำเมื่อได้ค่าขนมหรือเงินพิเศษ?", c: ["ซื้อของที่อยากได้ก่อน", "แบ่งไปออมทันทีตามเป้าที่ตั้งไว้", "เลี้ยงเพื่อนทั้งห้อง", "เก็บใส่กระเป๋ารอใช้หมด"], a: 1, x: "Pay yourself first — จ่ายให้ \"ตัวเองในอนาคต\" ก่อนเสมอ" },
  { q: "การกู้เงินนอกระบบอันตรายเพราะอะไร?", c: ["ได้เงินช้า", "ดอกเบี้ยแพงมากและอาจโดนทวงหนี้โหด", "ต้องมีคนค้ำ", "วงเงินน้อย"], a: 1, x: "หนี้นอกระบบดอกเบี้ยสูงลิ่วและไม่มีกฎหมายคุ้มครอง" },
  { q: "\"งบประมาณ\" (Budget) คืออะไร?", c: ["เงินที่รัฐบาลแจก", "แผนการใช้เงินที่วางไว้ล่วงหน้า", "บัญชีธนาคาร", "เงินโบนัส"], a: 1, x: "งบประมาณคือการวางแผนก่อนใช้ ว่าเงินแต่ละส่วนจะไปไหน — ช่วยไม่ให้ใช้เกินตัว" },
  { q: "ทำไมควรเริ่มออมตั้งแต่อายุยังน้อย?", c: ["เพราะโดนบังคับ", "ยิ่งออมนาน ดอกเบี้ยทบต้นยิ่งช่วยให้เงินโตมาก", "เพราะเพื่อนออมกัน", "ไม่มีเหตุผล"], a: 1, x: "เวลาคือเพื่อนที่ดีที่สุดของนักออม — เริ่มก่อน โตกว่า" },
  { q: "การเติมเกมหรือกดกล่องสุ่มในเกมบ่อย ๆ จัดเป็นรายจ่ายแบบใด?", c: ["รายจ่ายจำเป็น", "การลงทุน", "รายจ่ายฟุ่มเฟือยที่ควรตั้งงบจำกัด", "การออมรูปแบบหนึ่ง"], a: 2, x: "เติมเกมคือความบันเทิง ไม่ผิดถ้าอยู่ในงบ — แต่กล่องสุ่มออกแบบมาให้จ่ายไม่รู้จบ ต้องตั้งงบก่อนเสมอ" },
  { q: "ดูไลฟ์ขายของแล้วแม่ค้าบอก \"เหลือชิ้นสุดท้าย รีบกดเลย!\" ควรทำอย่างไร?", c: ["รีบกดสั่งซื้อทันที", "ตั้งสติ ถามตัวเองว่าจำเป็นไหม แล้วเปรียบเทียบราคาก่อน", "ยืมเงินเพื่อนมาซื้อ", "สั่งซื้อ 2 ชิ้นกันพลาด"], a: 1, x: "\"เหลือชิ้นสุดท้าย\" คือเทคนิคเร่งให้รีบตัดสินใจ — เช็คราคาหลายร้านก่อนซื้อเสมอ" },
  { q: "เว็บพนันออนไลน์โฆษณาว่า \"เล่นง่าย ได้เงินไว\" ความจริงคือ?", c: ["เป็นช่องทางหารายได้เสริมที่ดี", "เสี่ยงเสียเงินทั้งหมด และผิดกฎหมายสำหรับเยาวชน", "เล่นน้อย ๆ ไม่เป็นไร", "ได้เงินจริงทุกคน"], a: 1, x: "ระบบพนันถูกออกแบบให้เจ้ามือได้กำไรเสมอ ยิ่งเล่นยิ่งเสีย และยังผิดกฎหมาย" },
  { q: "น้ำผลไม้ A ขวด 1,000 มล. 40 บาท กับ B ขวด 500 มล. 25 บาท ข้อใดคุ้มกว่า?", c: ["ยี่ห้อ A เพราะราคาต่อมิลลิลิตรถูกกว่า", "ยี่ห้อ B เพราะราคาถูกกว่า", "คุ้มเท่ากัน", "ดูจากขวดสวยกว่า"], a: 0, x: "A = 4 สตางค์/มล. ส่วน B = 5 สตางค์/มล. — เปรียบเทียบราคาต่อหน่วยก่อนซื้อ" },
  { q: "เพื่อนขอยืมเงินบ่อยและไม่เคยคืน มาขอยืมอีก ควรทำอย่างไร?", c: ["ให้ยืมทุกครั้งเพราะเกรงใจ", "ปฏิเสธอย่างสุภาพ หรือให้เท่าที่เราเสียได้โดยไม่เดือดร้อน", "ไปยืมคนอื่นมาให้เพื่อน", "ทะเลาะกับเพื่อน"], a: 1, x: "กล้าปฏิเสธเรื่องเงินอย่างสุภาพคือทักษะสำคัญ — ให้ยืมเฉพาะเงินที่ไม่ได้คืนก็ไม่เดือดร้อน" },
  { q: "ได้เงินของขวัญวันเกิด 500 บาท ทางเลือกใดตรงหลัก \"ออมก่อนใช้\" ที่สุด?", c: ["ใช้ให้หมดวันนั้นเลย", "แบ่งเข้าเงินออมทันทีส่วนหนึ่ง แล้วค่อยใช้ที่เหลือ", "เก็บไว้ในกระเป๋ารอใช้เรื่อย ๆ", "ให้เพื่อนยืมทั้งหมด"], a: 1, x: "ออมก่อนใช้ = กันส่วนออมออกทันทีที่เงินถึงมือ — รอใช้เหลือแล้วค่อยออม มักไม่เหลือ" },
];

/* ---------- helpers ---------- */
const die = () => 1 + Math.floor(Math.random() * 6);
const clone = (s) => JSON.parse(JSON.stringify(s));
const fm = (n) => Math.round(n).toLocaleString();
function shuffled(n) {
  const arr = [...Array(n).keys()];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function draw(s, name, source) {
  return source[drawIndex(s, name, source)];
}
// คืน "index" ของการ์ดที่จั่ว (ใช้เก็บอ้างอิงแทนการ copy ข้อความเต็มลง state — สำคัญกับ quiz ในห้องใหญ่)
function drawIndex(s, name, source) {
  const d = s.decks;
  if (d[name + "Idx"] >= d[name].length) {
    d[name] = shuffled(source.length);
    d[name + "Idx"] = 0;
  }
  return d[name][d[name + "Idx"]++];
}
function log(s, pid, label, amt) {
  const p = s.players[pid];
  s.ledger.push({ r: s.round, pid, label, amt, cash: p.cash, sav: p.savings });
  if (s.mode === "class") {
    // จำกัดสมุดบัญชีต่อคน กัน state โตเกินขีดจำกัด storage (128KB)
    // ห้องยิ่งใหญ่ยิ่งเก็บต่อคนน้อยลง (≤50 คน=8 คงเดิม, 100=4, 150=2, 200=1)
    const n = s.roster.length;
    const cap = n <= 50 ? RULES.historyCap : n <= 100 ? 4 : n <= 150 ? 2 : 1;
    let count = 0;
    for (const e of s.ledger) if (e.pid === pid) count++;
    if (count > cap) {
      const idx = s.ledger.findIndex((e) => e.pid === pid);
      s.ledger.splice(idx, 1);
    }
  }
}
function receiveCash(s, pid, amount, label) {
  const p = s.players[pid];
  let rest = amount, paidDebt = 0;
  if (p.debt > 0) {
    paidDebt = Math.min(p.debt, rest);
    p.debt -= paidDebt;
    rest -= paidDebt;
  }
  p.cash += rest;
  log(s, pid, label, amount);
  if (paidDebt > 0) log(s, pid, "ชำระหนี้อัตโนมัติ", -paidDebt);
  return { rest, paidDebt };
}
function gainSavings(s, pid, amount, label) {
  s.players[pid].savings += amount;
  log(s, pid, label, amount);
}
function charge(s, pid, amount, label) {
  const p = s.players[pid];
  const fromCash = Math.min(p.cash, amount);
  p.cash -= fromCash;
  let need = amount - fromCash;
  let wd = 0, fee = 0, debtAdd = 0;
  if (need > 0) {
    wd = Math.min(p.savings, need);
    p.savings -= wd;
    need -= wd;
    fee = Math.round(wd * RULES.withdrawFeePct);
    const feeFromSav = Math.min(p.savings, fee);
    p.savings -= feeFromSav;
    if (fee - feeFromSav > 0) debtAdd += fee - feeFromSav;
  }
  if (need > 0) debtAdd += need;
  p.debt += debtAdd;
  log(s, pid, label, -amount);
  if (wd > 0) log(s, pid, "ถอนเงินออมมาใช้", -wd);
  if (fee > 0) log(s, pid, "ค่าธรรมเนียมถอนก่อนกำหนด", -fee);
  if (debtAdd > 0) log(s, pid, "กู้ยืม (เป็นหนี้)", debtAdd);
  return { fromCash, wd, fee, debtAdd };
}
// ย่อข้อความผลรอบเฉพาะห้องใหญ่ (>50 คน) กัน state เกิน 128KB — ห้องเล็กเก็บครบเหมือนเดิม
function slimText(s, items) {
  if (s.roster.length <= 50) return items;
  return items.slice(0, 3).map((it) => ({ icon: it.icon, text: it.text.length > 60 ? it.text.slice(0, 59) + "…" : it.text }));
}
function chargeItems(b, amount) {
  const items = [{ icon: "💸", text: `จ่าย ${fm(amount)} บาท` }];
  if (b.wd > 0) items.push({ icon: "🏧", text: `เงินสดไม่พอ ถอนเงินออม ${fm(b.wd)} (ค่าธรรมเนียม ${fm(b.fee)})` });
  if (b.debtAdd > 0) items.push({ icon: "⛓️", text: `เงินไม่พอ เป็นหนี้ ${fm(b.debtAdd)} บาท` });
  return items;
}
function pushLast(s, pid, items, extra) {
  s.seq++;
  s.last = Object.assign({ seq: s.seq, pid, items }, extra || {});
}
function finishGame(s) {
  s.phase = "done";
  // ranking เก็บเฉพาะฟิลด์สรุป (ไม่ copy lastText/lastCard/lastQuiz — กัน state ซ้ำซ้อนในห้องใหญ่)
  s.ranking = s.roster
    .map((r) => {
      const p = s.players[r.id];
      return { id: r.id, name: r.name, color: r.color, pos: p.pos, cash: p.cash, savings: p.savings, debt: p.debt, shield: p.shield, quizOk: p.quizOk, quizAll: p.quizAll };
    })
    .sort((a, b) => {
      const ad = a.debt > 0, bd = b.debt > 0;
      if (ad !== bd) return ad ? 1 : -1;
      if (b.savings !== a.savings) return b.savings - a.savings;
      return b.cash - a.cash;
    });
  // เกมจบแล้ว — ข้อมูลแสดงผลรายรอบไม่ใช้แล้ว ล้างทิ้งกัน state บวม (สำคัญมากในห้อง 200 คน)
  for (const id in s.players) {
    const p = s.players[id];
    p.lastText = null; p.lastCard = null; p.lastQuiz = null; p.lastRoll = null;
  }
}
function endTurn(s) {
  s.pending = null;
  s.turnIdx++;
  if (s.turnIdx >= s.roster.length) {
    s.turnIdx = 0;
    s.round++;
    if (s.round > s.rounds) finishGame(s);
    else moveBlackPawn(s); // โหมดผลัดตา: ตัวหมากปริศนาเดิน/เกิดตอนขึ้นรอบใหม่
  }
}

/* ---------- ตัวหมากปริศนาสีดำ (NPC) — เกิดที่ START เดินอัตโนมัติ ตกช่องเดียวกับใครสร้างเหตุการณ์ ---------- */
const BLACK_GOOD = [
  { icon: "🎁", text: "ตัวหมากปริศนาใจดี แบ่งเงินให้", cash: 1500 },
  { icon: "💎", text: "ตัวหมากปริศนาทิ้งสมบัติไว้ให้", cash: 2000 },
  { icon: "🍀", text: "โชคดี! ตัวหมากปริศนาให้เงินก้อน", cash: 1000 },
];
const BLACK_BAD = [
  { icon: "💀", text: "ตัวหมากปริศนาขโมยเงินไป", cash: -1500 },
  { icon: "🌪️", text: "โดนตัวหมากปริศนาป่วน เสียเงิน", cash: -2000 },
  { icon: "🔧", text: "ตัวหมากปริศนาทำของพัง จ่ายค่าซ่อม", cash: -1000 },
  { icon: "🧾", text: "ตัวหมากปริศนาเก็บภาษีเงา", cash: -1200 },
];
function randomBlackEvent() {
  const good = Math.random() < 0.30; // ดี 30% ร้าย 70%
  const list = good ? BLACK_GOOD : BLACK_BAD;
  const e = list[Math.floor(Math.random() * list.length)];
  return { good, icon: e.icon, text: e.text, cash: e.cash };
}
function spawnRoundFor(rounds) {
  return rounds <= 12 ? 3 : rounds <= 20 ? 5 : 7; // สั้น(12)=3 กลาง(20)=5 ยาว(30)=7
}
// เรียกตอนขึ้นรอบใหม่ (ทั้ง 2 โหมด): เกิด/เดิน แล้วสร้างเหตุการณ์ให้คนที่อยู่ช่องเดียวกัน
function moveBlackPawn(s) {
  if (!s.black || s.round < s.blackSpawnRound) return;
  if (!s.black.active) {
    s.black.active = true;
    s.black.pos = 0; // เกิดที่ช่อง START เสมอ (ไม่สุ่ม/ไม่ไปโผล่ตรงคนเล่น)
    s.seq++;
    s.blackEvent = { seq: s.seq, kind: "spawn", pos: 0 };
    return; // รอบแรก: ปรากฏตัวที่ START เฉย ๆ (เตือนให้ระวัง)
  }
  const d = die();
  s.black.pos = (s.black.pos + d) % BOARD.length;
  const hits = [];
  for (const r of s.roster) {
    const p = s.players[r.id];
    if (p.pos !== s.black.pos) continue;
    const ev = randomBlackEvent();
    if (ev.cash >= 0) receiveCash(s, r.id, ev.cash, "⚫ " + ev.text);
    else charge(s, r.id, -ev.cash, "⚫ " + ev.text);
    hits.push({ name: r.name, good: ev.good, icon: ev.icon, text: ev.text, cash: ev.cash });
  }
  s.seq++;
  s.blackEvent = { seq: s.seq, kind: "move", pos: s.black.pos, roll: d, hits };
}

/* ---------- เครื่องยนต์กติกากลาง (ใช้ทั้ง 2 โหมด) ---------- */

// ดอกเบี้ยเมื่อเดินผ่าน START — คืน items ที่เกิดขึ้น
function lapInterest(s, pid) {
  const p = s.players[pid];
  const interest = Math.min(RULES.interestCap, Math.round((p.savings * RULES.interestPct) / 10) * 10);
  if (interest > 0) {
    gainSavings(s, pid, interest, "ดอกเบี้ยเงินออม (ครบรอบบอร์ด)");
    return [{ icon: "🏦", text: `ครบรอบบอร์ด! ดอกเบี้ยเงินออม +${fm(interest)} บาท` }];
  }
  return [{ icon: "🏦", text: "ครบรอบบอร์ด แต่ยังไม่มีเงินออม เลยไม่ได้ดอกเบี้ย" }];
}

// ผลของการตกช่องปัจจุบัน — คืน {items, card, pend} โดยไม่แตะเรื่องตา/รอบ
function resolveCell(s, pid) {
  const p = s.players[pid];
  const cell = BOARD[p.pos];
  const items = [];
  let card = null, pend = null;
  const allocOrItems = (amount, rest, paidDebt, title, icon) => {
    if (rest > 0) {
      pend = { kind: "alloc", pid, title, icon, amount, rest, paidDebt };
    } else {
      items.push({ icon, text: `${title} +${fm(amount)} บาท` });
      if (paidDebt > 0) items.push({ icon: "⛓️", text: `หักชำระหนี้ ${fm(paidDebt)} บาท` });
    }
  };
  switch (cell.type) {
    case "start": break;
    case "income": {
      const { rest, paidDebt } = receiveCash(s, pid, cell.amount, cell.name);
      allocOrItems(cell.amount, rest, paidDebt, `${cell.name}: ${cell.desc}`, cell.icon);
      break;
    }
    case "save":
      gainSavings(s, pid, cell.amount, "การออม: เก็บออมเพื่ออนาคต");
      items.push({ icon: "🐷", text: `เก็บออมเพื่ออนาคต +${fm(cell.amount)} เข้าเงินออม` });
      break;
    case "invest": {
      const options = [500, 1000, 2000].filter((v) => v <= p.cash);
      if (options.length) pend = { kind: "invest", pid, options };
      else items.push({ icon: "📈", text: "เงินสดไม่พอลงทุน รอบหน้าลองใหม่" });
      break;
    }
    case "quiz": {
      const qi = drawIndex(s, "quiz", QUIZ);
      pend = { kind: "quiz", pid, qi, reward: RULES.quizReward };
      break;
    }
    case "event": {
      const ev = draw(s, "event", EVENTS);
      card = { icon: ev.icon, t: ev.t, d: ev.d, deck: "event" };
      if (ev.cash > 0) {
        const { rest, paidDebt } = receiveCash(s, pid, ev.cash, ev.t);
        allocOrItems(ev.cash, rest, paidDebt, ev.t, ev.icon);
      } else if (ev.cash < 0) {
        if (p.shield) {
          p.shield = false;
          log(s, pid, `🛡️ โล่ป้องกัน: ${ev.t}`, 0);
          items.push({ icon: "🛡️", text: `โล่เงินสำรองช่วยไว้! ไม่ต้องจ่าย ${fm(-ev.cash)} บาท` });
        } else {
          items.push(...chargeItems(charge(s, pid, -ev.cash, ev.t), -ev.cash));
        }
      } else if (ev.savingsPct != null) {
        const gain = Math.min(ev.cap, Math.round((p.savings * ev.savingsPct) / 100) * 100);
        if (gain > 0) {
          gainSavings(s, pid, gain, ev.t);
          items.push({ icon: "📈", text: `เงินออมได้กำไร +${fm(gain)} บาท — ยิ่งออมยิ่งได้!` });
        } else {
          items.push({ icon: "😅", text: "ไม่มีเงินออม เลยพลาดกำไรครั้งนี้" });
        }
      }
      break;
    }
    case "chance": {
      const ch = draw(s, "chance", CHANCES);
      card = { icon: ch.icon, t: ch.t, d: ch.d, deck: "chance" };
      switch (ch.kind) {
        case "gain": {
          const { rest, paidDebt } = receiveCash(s, pid, ch.amount, ch.t);
          allocOrItems(ch.amount, rest, paidDebt, ch.t, ch.icon);
          break;
        }
        case "savingsPct": {
          const gain = Math.min(ch.cap, Math.round((p.savings * ch.pct) / 100) * 100);
          if (gain > 0) {
            gainSavings(s, pid, gain, ch.t);
            items.push({ icon: "💹", text: `ดอกเบี้ยพิเศษ +${fm(gain)} บาท` });
          } else {
            items.push({ icon: "😅", text: "ยังไม่มีเงินออม จึงไม่ได้ดอกเบี้ย — ออมก่อน ได้ก่อน!" });
          }
          break;
        }
        case "matchDeposit":
          if (p.cash >= ch.amount) pend = { kind: "choice", sub: "match", pid, amount: ch.amount, title: ch.t, desc: ch.d, icon: ch.icon };
          else items.push({ icon: "😅", text: `เงินสดไม่พอเข้าร่วม (ต้องมี ${fm(ch.amount)})` });
          break;
        case "bonusQuiz": {
          const qi = drawIndex(s, "quiz", QUIZ);
          pend = { kind: "quiz", pid, qi, reward: RULES.quizBigReward };
          break;
        }
        case "saverPrize":
          if (p.savings >= ch.need) {
            gainSavings(s, pid, ch.amount, ch.t);
            items.push({ icon: "🏅", text: `นักออมดีเด่น! +${fm(ch.amount)} เข้าเงินออม` });
          } else {
            items.push({ icon: "🏅", text: `เงินออมยังไม่ถึง ${fm(ch.need)} — สะสมต่อ รางวัลรออยู่!` });
          }
          break;
        case "gamble":
          if (p.cash >= ch.cost) pend = { kind: "choice", sub: "gamble", pid, cost: ch.cost, prize: ch.prize, needRoll: ch.needRoll, title: ch.t, desc: ch.d, icon: ch.icon };
          else items.push({ icon: "😅", text: "เงินสดไม่พอลงทุนครั้งนี้" });
          break;
      }
      break;
    }
    case "shield":
      if (!p.shield) {
        p.shield = true;
        log(s, pid, "รับโล่เงินสำรองฉุกเฉิน", 0);
        items.push({ icon: "🛡️", text: "ได้รับโล่เงินสำรองฉุกเฉิน ป้องกันเหตุการณ์ร้าย 1 ครั้ง" });
      } else {
        gainSavings(s, pid, 500, "รางวัลเตรียมพร้อม (มีโล่อยู่แล้ว)");
        items.push({ icon: "🛡️", text: "เตรียมพร้อมอยู่แล้ว! +500 เข้าเงินออม" });
      }
      break;
    case "expense": {
      items.push({ icon: cell.icon, text: `${cell.name}: ${cell.desc}` });
      items.push(...chargeItems(charge(s, pid, cell.amount, `${cell.name}: ${cell.desc}`), cell.amount));
      break;
    }
  }
  return { items, card, pend };
}

// ตัดสินใจกับ pend ที่ค้าง — คืน {items, quiz}
function decide(s, pid, pend, action) {
  const p = s.players[pid];
  const items = [];
  let quiz = null;
  if (pend.kind === "alloc") {
    const save = action.save;
    if (save > 0) {
      p.cash -= save;
      p.savings += save;
      log(s, pid, "แบ่งเข้าเงินออม", save);
    }
    items.push({ icon: pend.icon, text: `${pend.title} +${fm(pend.amount)} บาท` });
    if (pend.paidDebt > 0) items.push({ icon: "⛓️", text: `หักชำระหนี้ ${fm(pend.paidDebt)} บาท` });
    items.push({ icon: "🐷", text: save > 0 ? `แบ่งเข้าเงินออม ${fm(save)} บาท` : "เก็บเป็นเงินสดทั้งหมด" });
  } else if (pend.kind === "quiz") {
    const Q = QUIZ[pend.qi];
    p.quizAll++;
    const ok = action.i === Q.a;
    if (ok) {
      p.quizOk++;
      gainSavings(s, pid, pend.reward, "โบนัสความรู้ (เข้าเงินออม)");
      items.push({ icon: "🎉", text: `ตอบถูก! รับ ${fm(pend.reward)} บาทเข้าเงินออม` });
    } else {
      items.push({ icon: "🤔", text: "ยังไม่ถูก ลองจำเฉลยไว้นะ" });
    }
    quiz = { q: Q.q, c: Q.c, correct: Q.a, picked: action.i, x: Q.x, ok };
  } else if (pend.kind === "invest") {
    const amt = Math.min(action.amount, p.cash);
    if (amt > 0) {
      charge(s, pid, amt, "เงินลงทุน");
      const d = die();
      const win = d >= 3;
      const back = win ? Math.round(amt * 1.5) : Math.round(amt * 0.5);
      receiveCash(s, pid, back, win ? `ผลตอบแทนการลงทุน (ทอยได้ ${d})` : `เงินลงทุนคืนบางส่วน (ทอยได้ ${d})`);
      items.push({ icon: "🎲", text: `ลงทุน ${fm(amt)} ทอยได้ ${d}` });
      items.push(win
        ? { icon: "📈", text: `กำไร! ได้คืน ${fm(back)} บาท` }
        : { icon: "📉", text: `ขาดทุน ได้คืนแค่ ${fm(back)} — การลงทุนมีความเสี่ยงเสมอ` });
    } else {
      items.push({ icon: "🙅", text: "เลือกไม่ลงทุนรอบนี้" });
    }
  } else if (pend.kind === "choice") {
    if (pend.sub === "match") {
      if (action.yes && p.cash >= pend.amount) {
        p.cash -= pend.amount;
        p.savings += pend.amount;
        log(s, pid, "ฝากโครงการออมทวีคูณ", pend.amount);
        gainSavings(s, pid, pend.amount, "เงินสมทบจากธนาคาร");
        items.push({ icon: "🏦", text: `ฝาก ${fm(pend.amount)} + สมทบ ${fm(pend.amount)} = เงินออมเพิ่ม ${fm(pend.amount * 2)}` });
      } else {
        items.push({ icon: "🙅", text: "ไม่เข้าร่วมโครงการรอบนี้" });
      }
    } else if (pend.sub === "gamble") {
      if (action.yes && p.cash >= pend.cost) {
        charge(s, pid, pend.cost, "ลงทุนแผงขายขนม");
        const d = die();
        if (d >= pend.needRoll) {
          receiveCash(s, pid, pend.prize, `กำไรแผงขายขนม (ทอยได้ ${d})`);
          items.push({ icon: "🎲", text: `ทอยได้ ${d} — สำเร็จ! รับ ${fm(pend.prize)} บาท` });
        } else {
          items.push({ icon: "🎲", text: `ทอยได้ ${d} — ขาดทุน ${fm(pend.cost)} บาท ลงทุนมีความเสี่ยง` });
        }
      } else {
        items.push({ icon: "🙅", text: "ไม่ลงทุนรอบนี้" });
      }
    }
  }
  return { items, quiz };
}

// การตัดสินใจอัตโนมัติเมื่อหมดเวลา (โหมดทั้งห้อง): คำถามสุ่มตอบ, เงินออมออมครึ่ง, ที่เหลือเลือกทางปลอดภัย
function autoAction(pend) {
  if (pend.kind === "quiz") return { i: Math.floor(Math.random() * 4) };
  if (pend.kind === "alloc") return { save: Math.max(0, Math.round(pend.rest / 2 / 100) * 100) };
  if (pend.kind === "invest") return { amount: 0 };
  return { yes: false };
}


// เก็บผลคำถามแบบย่อใน state (โหมดทั้งห้อง 50 คน — ประหยัดพื้นที่ storage)
function slimQuiz(quiz) {
  return quiz ? { ok: quiz.ok, picked: quiz.picked, correct: quiz.correct, correctText: quiz.c[quiz.correct], x: quiz.x } : null;
}
/* ---------- โหมดทั้งห้อง: จังหวะรอบ ---------- */
function classStartStage(s, stage) {
  s.stage = stage;
  s.stageDeadline = Date.now() + (stage === "roll" ? RULES.classRollMs : RULES.classRespondMs) + RULES.graceMs;
}
function classDoRoll(s, pid, auto) {
  const p = s.players[pid];
  const d = die();
  const from = p.pos;
  const passed = from + d >= BOARD.length;
  p.pos = (from + d) % BOARD.length;
  s.rolls[pid] = d;
  const items = [{ icon: "🎲", text: `${auto ? "หมดเวลา ระบบทอยให้ — " : ""}ทอยได้ ${d} แต้ม` }];
  if (passed) items.push(...lapInterest(s, pid));
  const out = resolveCell(s, pid);
  items.push(...out.items);
  p.lastRoll = { d, from, to: p.pos, r: s.round };
  p.lastText = slimText(s, items);
  p.lastCard = out.card || null;
  p.lastQuiz = null;
  if (out.pend) s.cpend[pid] = out.pend;
}
function classNextRound(s) {
  s.rolls = {};
  s.cpend = {};
  s.round++;
  if (s.round > s.rounds) {
    finishGame(s);
    s.stage = null;
  } else {
    moveBlackPawn(s); // ตัวหมากปริศนาเดิน/เกิดตอนขึ้นรอบใหม่
    classStartStage(s, "roll");
  }
}
function classAfterAction(s) {
  if (s.stage === "roll" && Object.keys(s.rolls).length >= s.roster.length) {
    if (Object.keys(s.cpend).length) classStartStage(s, "respond");
    else classNextRound(s);
  } else if (s.stage === "respond" && Object.keys(s.cpend).length === 0) {
    classNextRound(s);
  }
}

/* ---------- สัญญา 6 ฟังก์ชัน ---------- */
export const meta = { game: "วางแผนดี ชีวิตมีเงินเก็บ", minPlayers: 2, maxPlayers: 121 }; // 120 ผู้เล่น + 1 เจ้าของห้อง (จอมอนิเตอร์) — จำกัดที่ 120 ให้ state อยู่ใต้ 128KB อย่างมี margin

// หัวหน้าห้อง = ผู้สร้างห้อง (คนแรกที่เชื่อมต่อ) ถ้ามี ไม่งั้นคนแรกที่กดเข้าร่วม
// → นักเรียนกดเข้าร่วมก่อนครูก็ไม่แย่งตำแหน่ง และครูคุมห้องได้แม้ไม่ลงเล่น (จอผู้ชม)
function hostOf(state) {
  if (state.ownerId) return state.ownerId;
  return state.roster.length ? state.roster[0].id : null;
}

export function setup(players) {
  return {
    phase: "lobby",           // lobby | play (turns) | cplay (class) | done
    mode: "class",            // class (ค่าเริ่มต้น: ทั้งห้องเล่นพร้อมกัน) | turns (กลุ่มเล็กผลัดตา)
    ownerId: (players && players[0]) || null,  // ผู้สร้างห้อง (คนแรกที่เชื่อมต่อ)
    hostSeen: Date.now(),                      // เวลาที่หัวหน้าห้องขยับล่าสุด (action/ping)
    rounds: RULES.defaultRounds,
    roster: [],               // [{id, name, color}] ตามลำดับกดเข้าร่วม
    players: {},              // id -> {pos,cash,savings,debt,shield,quizOk,quizAll,...}
    decks: { event: [], eventIdx: 9999, chance: [], chanceIdx: 9999, quiz: [], quizIdx: 9999 },
    round: 0,
    turnIdx: 0,
    pending: null,            // turns: การตัดสินใจที่ค้าง
    stage: null,              // class: roll | respond
    stageDeadline: 0,
    rolls: {},                // class: pid -> แต้มที่ทอยในรอบนี้
    cpend: {},                // class: pid -> การตัดสินใจที่ค้าง
    seq: 0,
    last: null,
    lastMove: null,
    ledger: [],
    black: { active: false, pos: 0 }, // ตัวหมากปริศนา
    blackSpawnRound: 0,
    blackEvent: null,
  };
}

const no = (error) => ({ ok: false, error });
const DECISION_KIND = { alloc: "alloc", answer: "quiz", invest: "invest", choice: "choice" };

function validateDecisionPayload(pend, action) {
  if (action.type === "alloc" && !(Number.isInteger(action.save) && action.save >= 0 && action.save <= pend.rest))
    return no("จำนวนเงินออมไม่ถูกต้อง");
  if (action.type === "answer" && !(Number.isInteger(action.i) && action.i >= 0 && action.i <= 3))
    return no("คำตอบไม่ถูกต้อง");
  if (action.type === "invest" && action.amount !== 0 && !pend.options.includes(action.amount))
    return no("จำนวนเงินลงทุนไม่ถูกต้อง");
  if (action.type === "choice" && typeof action.yes !== "boolean")
    return no("คำตอบไม่ถูกต้อง");
  return { ok: true };
}

export function validateAction(state, playerId, action) {
  if (!state || !action || typeof action.type !== "string") return no("คำสั่งไม่ถูกต้อง");
  const inRoster = state.roster.some((r) => r.id === playerId);
  const host = hostOf(state);
  const isClass = state.mode === "class";
  switch (action.type) {
    case "sit": {
      if (state.phase !== "lobby") return no("เกมเริ่มไปแล้ว รอรอบหน้านะ");
      if (inRoster) return no("เข้าร่วมแล้ว");
      if (isClass && playerId === host) return no("เจ้าของห้องเป็นจอมอนิเตอร์ ไม่ได้ลงเล่น");
      const cap = isClass ? RULES.classMax : RULES.turnsMax;
      if (state.roster.length >= cap) return no(`ห้องเต็มแล้ว (สูงสุด ${cap} คน)`);
      if (!action.name || !String(action.name).trim()) return no("กรุณาใส่ชื่อก่อนเข้าร่วม");
      return { ok: true };
    }
    case "mode":
      if (state.phase !== "lobby") return no("เกมเริ่มไปแล้ว");
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่ตั้งค่าได้");
      if (action.mode !== "turns" && action.mode !== "class") return no("โหมดไม่ถูกต้อง");
      if (action.mode === "turns" && state.roster.length > RULES.turnsMax) return no(`โหมดผลัดตารับได้สูงสุด ${RULES.turnsMax} คน`);
      return { ok: true };
    case "config":
      if (state.phase !== "lobby") return no("เกมเริ่มไปแล้ว");
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่ตั้งค่าได้");
      if (!RULES.roundChoices.includes(action.rounds)) return no("จำนวนรอบไม่ถูกต้อง");
      return { ok: true };
    case "begin":
      if (state.phase !== "lobby") return no("เกมเริ่มไปแล้ว");
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่เริ่มเกมได้");
      if (state.roster.length < 2) return no("ต้องมีผู้เล่นอย่างน้อย 2 คน");
      return { ok: true };
    case "restart":
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่รีเซ็ตห้องได้");
      return { ok: true };
    case "stop":
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่หยุดเกมได้");
      if (state.phase !== "play" && state.phase !== "cplay") return no("เกมยังไม่เริ่ม");
      return { ok: true };
    case "kick":
      if (state.phase !== "lobby") return no("เชิญออกได้เฉพาะในล็อบบี้");
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่เชิญออกได้");
      if (action.id === playerId) return no("เชิญตัวเองออกไม่ได้");
      if (!state.roster.some((r) => r.id === action.id)) return no("ไม่พบผู้เล่นคนนี้");
      return { ok: true };
    case "transfer":
      if (playerId !== host) return no("หัวหน้าห้องเท่านั้นที่มอบตำแหน่งได้");
      if (!state.roster.some((r) => r.id === action.to)) return no("ผู้รับตำแหน่งต้องอยู่ในห้อง");
      if (action.to === playerId) return no("เป็นหัวหน้าห้องอยู่แล้ว");
      return { ok: true };
    case "ping":
      // ชีพจรหัวหน้าห้อง — client ของหัวหน้าส่งเป็นระยะ ให้คนอื่นรู้ว่ายังอยู่
      if (playerId !== host) return no("เฉพาะหัวหน้าห้อง");
      return { ok: true };
    case "claim": {
      // ขอรับตำแหน่งเมื่อหัวหน้าหายไป (เครื่องพัง/ปิดแท็บถาวร) — ห้องจะได้ไม่ค้าง
      if (!inRoster) return no("ต้องเข้าร่วมเกมก่อนจึงขอเป็นหัวหน้าได้");
      if (playerId === host) return no("เป็นหัวหน้าห้องอยู่แล้ว");
      const away = !state.hostSeen || Date.now() - state.hostSeen > RULES.hostAwayMs;
      if (!away) return no("หัวหน้าห้องยังออนไลน์อยู่ — ปุ่มนี้ใช้ได้เมื่อหัวหน้าหายไปเกิน 1.5 นาที");
      return { ok: true };
    }
    case "roll":
      if (state.phase !== "play") return no("ยังไม่ถึงช่วงเล่น");
      if (state.roster[state.turnIdx].id !== playerId) return no("ยังไม่ถึงตาของคุณ");
      if (state.pending) return no("มีการตัดสินใจค้างอยู่");
      return { ok: true };
    case "croll":
      if (state.phase !== "cplay") return no("ยังไม่ถึงช่วงเล่น");
      if (!inRoster) return no("คุณเป็นผู้ชม");
      if (state.stage !== "roll") return no("ยังไม่ถึงช่วงทอยเต๋า");
      if (state.rolls[playerId] != null) return no("ทอยไปแล้วในรอบนี้");
      return { ok: true };
    case "cforce": {
      if (state.phase !== "cplay") return no("ยังไม่ถึงช่วงเล่น");
      if (!inRoster && playerId !== host) return no("คุณเป็นผู้ชม"); // เจ้าของห้อง (มอนิเตอร์) ดันเกมต่อได้
      if (Date.now() < state.stageDeadline) return no("ยังไม่หมดเวลา");
      const incomplete = state.stage === "roll"
        ? Object.keys(state.rolls).length < state.roster.length
        : Object.keys(state.cpend).length > 0;
      if (!incomplete) return no("ช่วงนี้จบไปแล้ว");
      return { ok: true };
    }
    case "alloc": case "answer": case "invest": case "choice": {
      const kind = DECISION_KIND[action.type];
      if (state.phase === "cplay") {
        if (state.stage !== "respond") return no("ยังไม่ถึงช่วงตอบ");
        const pend = state.cpend[playerId];
        if (!pend || pend.kind !== kind) return no("ไม่มีรายการค้างอยู่");
        return validateDecisionPayload(pend, action);
      }
      if (state.phase !== "play") return no("ยังไม่ถึงช่วงเล่น");
      const pend = state.pending;
      if (!pend || pend.kind !== kind || pend.pid !== playerId) return no("ไม่มีรายการค้างอยู่");
      return validateDecisionPayload(pend, action);
    }
    default:
      return no("ไม่รู้จักคำสั่ง: " + action.type);
  }
}

export function applyAction(state, playerId, action) {
  const s = clone(state);
  if (playerId === hostOf(s)) s.hostSeen = Date.now(); // ทุก action ของหัวหน้า = ยังอยู่
  switch (action.type) {
    case "ping":
      return s;
    case "claim":
      s.ownerId = playerId;
      s.hostSeen = Date.now();
      s.seq++;
      return s;
    case "sit":
      s.roster.push({ id: playerId, name: String(action.name).trim().slice(0, 12), color: s.roster.length });
      s.seq++;
      return s;
    case "mode":
      s.mode = action.mode;
      s.seq++;
      return s;
    case "config":
      s.rounds = action.rounds;
      s.seq++;
      return s;
    case "restart": {
      // ล้างเกมกลับล็อบบี้ว่าง — คงผู้สร้างห้อง/โหมด/จำนวนรอบไว้ ทุกคนกดเข้าร่วมใหม่
      const keep = { ownerId: s.ownerId, mode: s.mode, rounds: s.rounds, seq: s.seq + 1 };
      const fresh = setup([]);
      return Object.assign(fresh, keep);
    }
    case "stop": {
      // หัวหน้าหยุดเกมกลางคัน → จบทันที จัดอันดับจากสถานะปัจจุบัน
      finishGame(s);
      s.stage = null;
      s.seq++;
      return s;
    }
    case "kick": {
      s.roster = s.roster.filter((r) => r.id !== action.id);
      s.roster.forEach((r, i) => { r.color = i; }); // จัดสีใหม่ กันสีซ้ำหลังมีคนออก
      delete s.players[action.id];
      s.seq++;
      return s;
    }
    case "transfer": {
      s.ownerId = action.to;
      s.seq++;
      return s;
    }
    case "begin": {
      s.round = 1;
      s.blackSpawnRound = spawnRoundFor(s.rounds); // ตั้งรอบเกิดของตัวหมากตามความยาวเกม
      s.black = { active: false, pos: 0 };
      s.blackEvent = null;
      for (const r of s.roster) {
        s.players[r.id] = {
          pos: 0, cash: RULES.startMoney, savings: 0, debt: 0, shield: false,
          quizOk: 0, quizAll: 0, lastRoll: null, lastText: null, lastQuiz: null, lastCard: null,
        };
        log(s, r.id, "เงินตั้งต้น", RULES.startMoney);
      }
      if (s.mode === "class") {
        s.phase = "cplay";
        classStartStage(s, "roll");
      } else {
        s.phase = "play";
        s.turnIdx = 0;
        pushLast(s, s.roster[0].id, [{ icon: "🎉", text: `เริ่มเกม! ${s.rounds} รอบ ทุกคนได้เงินตั้งต้น ${fm(RULES.startMoney)} บาท` }]);
      }
      s.seq++;
      return s;
    }
    /* ----- โหมดผลัดตา ----- */
    case "roll": {
      const p = s.players[playerId];
      const d = die();
      const from = p.pos;
      const passed = from + d >= BOARD.length;
      p.pos = (from + d) % BOARD.length;
      s.seq++;
      s.lastMove = { seq: s.seq, pid: playerId, from, steps: d };
      const items = [{ icon: "🎲", text: `ทอยได้ ${d} แต้ม` }];
      if (passed) items.push(...lapInterest(s, playerId));
      const out = resolveCell(s, playerId);
      items.push(...out.items);
      pushLast(s, playerId, items, out.card ? { card: out.card } : undefined);
      if (out.pend) s.pending = out.pend;
      else endTurn(s);
      return s;
    }
    /* ----- โหมดทั้งห้อง ----- */
    case "croll": {
      classDoRoll(s, playerId, false);
      s.seq++;
      classAfterAction(s);
      return s;
    }
    case "cforce": {
      if (s.stage === "roll") {
        for (const r of s.roster) if (s.rolls[r.id] == null) classDoRoll(s, r.id, true);
      } else {
        for (const [pid, pend] of Object.entries(s.cpend)) {
          const { items, quiz } = decide(s, pid, pend, Object.assign({ type: "auto" }, autoAction(pend)));
          const p = s.players[pid];
          p.lastText = slimText(s, [{ icon: "⏰", text: "หมดเวลา ระบบเลือกให้" }, ...items]);
          p.lastQuiz = slimQuiz(quiz);
          delete s.cpend[pid];
        }
      }
      s.seq++;
      classAfterAction(s);
      return s;
    }
    /* ----- การตัดสินใจ (ทั้ง 2 โหมด) ----- */
    case "alloc": case "answer": case "invest": case "choice": {
      if (s.phase === "cplay") {
        const pend = s.cpend[playerId];
        const { items, quiz } = decide(s, playerId, pend, action);
        const p = s.players[playerId];
        p.lastText = slimText(s, items);
        p.lastQuiz = slimQuiz(quiz);
        delete s.cpend[playerId];
        s.seq++;
        classAfterAction(s);
        return s;
      }
      const pend = s.pending;
      const { items, quiz } = decide(s, playerId, pend, action);
      pushLast(s, playerId, items, quiz ? { quiz } : undefined);
      endTurn(s);
      return s;
    }
    default:
      return s;
  }
}

export function isGameOver(state) {
  if (!state || state.phase !== "done") return { over: false };
  const top = state.ranking[0];
  if (top.debt > 0) return { over: true, draw: true, noWinner: true, ranking: state.ranking };
  return { over: true, winner: top.id, ranking: state.ranking };
}

export function viewFor(state, playerId) {
  // โหมดทั้งห้องตอนเล่น: ส่ง view แบบย่อ (50 คน × broadcast ทุก action — ต้องเบา)
  if (state.phase === "cplay") {
    const me = state.players[playerId] || null;
    const myPend = state.cpend[playerId] || null;
    return {
      mode: "class",
      phase: "cplay",
      me: playerId,
      hostId: hostOf(state),
      hostSeen: state.hostSeen || 0,
      rounds: state.rounds,
      round: state.round,
      stage: state.stage,
      stageDeadline: state.stageDeadline,
      now: Date.now(),
      seq: state.seq,
      waiting: {
        rolled: Object.keys(state.rolls).length,
        undecided: Object.keys(state.cpend).length,
        total: state.roster.length,
      },
      board: state.roster.map((r) => {
        const q = state.players[r.id];
        return { id: r.id, name: r.name, color: r.color, pos: q.pos, cash: q.cash, savings: q.savings, debt: q.debt, shield: q.shield, quizOk: q.quizOk, quizAll: q.quizAll };
      }),
      myself: me ? clone(me) : null,
      blackPos: state.black && state.black.active ? state.black.pos : null,
      blackEvent: state.blackEvent,
      myRolled: state.rolls[playerId] != null,
      myPend: myPend
        ? (myPend.kind === "quiz" ? { kind: "quiz", q: QUIZ[myPend.qi].q, c: QUIZ[myPend.qi].c, reward: myPend.reward } : clone(myPend))
        : null,
      myHistory: state.ledger.filter((e) => e.pid === playerId),
    };
  }
  const v = clone(state);
  delete v.decks; // ลำดับการ์ด/คำถามเป็นความลับของเซิร์ฟเวอร์
  delete v.rolls;
  delete v.cpend;
  if (v.pending && v.pending.kind === "quiz") {
    // ขยาย qi → q/c ให้ client (เฉลย a/x ไม่ส่งไปก่อนตอบ)
    const Q = QUIZ[v.pending.qi];
    v.pending = { kind: "quiz", pid: v.pending.pid, q: Q.q, c: Q.c, reward: v.pending.reward };
  }
  if (v.mode === "class") {
    // จบเกมโหมดทั้งห้อง: ตัด lastText/lastQuiz ของคนอื่นออกให้ payload เบา
    for (const pid of Object.keys(v.players)) {
      if (pid !== playerId) {
        v.players[pid].lastText = null;
        v.players[pid].lastQuiz = null;
        v.players[pid].lastCard = null;
      }
    }
  }
  v.me = playerId;
  v.hostId = hostOf(state);
  v.now = Date.now();
  v.turnId = v.phase === "play" ? v.roster[v.turnIdx].id : null;
  v.blackPos = state.black && state.black.active ? state.black.pos : null; // ตำแหน่งตัวหมาก (ผลัดตา)
  delete v.black; delete v.blackSpawnRound; // internal — client ใช้ blackPos/blackEvent
  return v;
}
