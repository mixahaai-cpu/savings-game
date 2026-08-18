// ทดสอบกติกาฝั่งเซิร์ฟเวอร์ (public/logic.js) แบบจำลองในเครื่อง — ไม่ต้อง deploy/WebSocket
// ยืนยัน: ค่า RULES ใหม่ • เล่นจบทั้ง 2 โหมด • action "stop" • ขนาด state ที่ 200 คน < 128KB
//   node test/test-logic.mjs

import * as G from "../public/logic.js";

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; } else { fail++; console.error("  ❌ " + label); } }
function section(t) { console.log("\n— " + t); }

// เรียก validate แล้ว apply (เหมือน kernel) — คืน state ใหม่ หรือโยน error ถ้า invalid
function apply(state, pid, action) {
  const v = G.validateAction(state, pid, action);
  if (!v.ok) throw new Error(`invalid ${action.type}: ${v.error}`);
  return G.applyAction(state, pid, action);
}

// ตัดสินใจจาก pend หนึ่งรายการ (ใช้ view ที่ตัดเฉลยแล้วไม่ได้ — ที่นี่ดู state ตรง ๆ เพื่อความง่าย)
function actionFor(pend) {
  switch (pend.kind) {
    case "alloc":  return { type: "alloc", save: Math.max(0, Math.round(pend.rest / 2 / 100) * 100) };
    case "quiz":   return { type: "answer", i: pend.a != null ? pend.a : 0 }; // state ยังมีเฉลย a
    case "invest": return { type: "invest", amount: (pend.options && pend.options[0]) || 0 };
    case "choice": return { type: "choice", yes: true };
    default:       return { type: "auto" };
  }
}

function seatPlayers(state, hostId, playerIds, mode, rounds) {
  let s = state;
  if (s.mode !== mode) s = apply(s, hostId, { type: "mode", mode });
  s = apply(s, hostId, { type: "config", rounds });
  for (const pid of playerIds) s = apply(s, pid, { type: "sit", name: pid.slice(0, 12) });
  return s;
}

// ----- เล่นโหมด class จนจบ (หรือหยุดที่ maxRounds ถ้ากำหนด) -----
function playClass(s, opts = {}) {
  let guard = 0;
  while (s.phase === "cplay" && guard++ < 100000) {
    if (opts.stopAtRound && s.round >= opts.stopAtRound) return { s, stopped: true };
    if (s.stage === "roll") {
      for (const r of s.roster) if (s.rolls[r.id] == null) s = apply(s, r.id, { type: "croll" });
    } else if (s.stage === "respond") {
      for (const pid of Object.keys(s.cpend)) s = apply(s, pid, actionFor(s.cpend[pid]));
    }
  }
  return { s, stopped: false };
}

function playTurns(s) {
  let guard = 0;
  while (s.phase === "play" && guard++ < 100000) {
    const pid = s.roster[s.turnIdx].id;
    if (s.pending) s = apply(s, pid, actionFor(s.pending));
    else s = apply(s, pid, { type: "roll" });
  }
  return s;
}

const ids = (n, pre = "p") => Array.from({ length: n }, (_, i) => `${pre}${i + 1}`);

// ============ 1) ค่า RULES ใหม่ (ผ่าน setup/meta) ============
section("ค่าคงที่ใหม่");
const s0 = G.setup(["host"]);
ok(s0.rounds === 30, `defaultRounds = 30 (ได้ ${s0.rounds})`);
ok(G.meta.maxPlayers === 121, `meta.maxPlayers = 121 (ได้ ${G.meta.maxPlayers})`);
// classRollMs สะท้อนใน stageDeadline: หลัง begin โหมด class, deadline ≈ now + 20000 + grace(2500)
{
  let s = seatPlayers(G.setup(["host"]), "host", ["a", "b"], "class", 12);
  s = apply(s, "host", { type: "begin" });
  const budget = s.stageDeadline - Date.now();
  ok(budget > 21000 && budget < 23500, `ช่วงทอย ≈ 22.5 วิ (20+grace) — ได้ ${Math.round(budget / 1000)} วิ`);
}

// ============ 2) เล่นจบโหมด class ============
section("โหมด class เล่นจนจบ (5 คน, 12 รอบ)");
{
  let s = seatPlayers(G.setup(["host"]), "host", ids(5), "class", 12);
  ok(s.roster.length === 5, `นั่ง 5 คน (host ไม่นั่ง)`);
  s = apply(s, "host", { type: "begin" });
  const { s: end } = playClass(s);
  ok(end.phase === "done", "จบเกม (phase done)");
  ok(Array.isArray(end.ranking) && end.ranking.length === 5, "มีอันดับครบ 5 คน");
  const over = G.isGameOver(end);
  ok(over.over === true, "isGameOver = over");
}

// ============ 3) เล่นจบโหมด turns ============
section("โหมด turns เล่นจนจบ (4 คน, 12 รอบ)");
{
  let s = seatPlayers(G.setup(["host"]), "host", ["host", ...ids(3)], "turns", 12);
  ok(s.roster.length === 4, `นั่ง 4 คน (host เล่นด้วยในโหมด turns)`);
  s = apply(s, "host", { type: "begin" });
  s = playTurns(s);
  ok(s.phase === "done", "จบเกม (phase done)");
  ok(s.ranking.length === 4, "อันดับครบ 4 คน");
}

// ============ 4) ปุ่มหยุดเกม (stop) ============
section("action stop");
{
  let s = seatPlayers(G.setup(["host"]), "host", ids(4), "class", 30);
  s = apply(s, "host", { type: "begin" });
  const { s: mid } = playClass(s, { stopAtRound: 5 }); // เล่นถึงรอบ 5 แล้วหยุด
  ok(mid.phase === "cplay" && mid.round >= 5, `หยุดกลางเกมได้ที่รอบ ${mid.round}`);
  // ผู้เล่นธรรมดา stop ไม่ได้
  ok(!G.validateAction(mid, "p1", { type: "stop" }).ok, "ผู้เล่นธรรมดากด stop ไม่ได้");
  // หัวหน้า stop ได้ → จบทันที
  const stopped = apply(mid, "host", { type: "stop" });
  ok(stopped.phase === "done", "หัวหน้ากด stop → phase done");
  ok(stopped.ranking.length === 4, "stop แล้วมีอันดับครบ");
  ok(G.isGameOver(stopped).over === true, "stop แล้ว isGameOver = over");
  // stop ตอนอยู่ lobby ไม่ได้
  ok(!G.validateAction(G.setup(["host"]), "host", { type: "stop" }).ok, "stop ตอนยังไม่เริ่มไม่ได้");
}

// ============ 5) รับ 120 คน + ขนาด state < 128KB (worst-case: id ยาว + ชื่อไทย 12 ตัว) ============
section("120 คน (สูงสุด) — สเกล + ขนาด state (worst-case)");
{
  const rid = (i) => "bot-" + String(i).padStart(4, "0") + "xyz"; // id ยาวแบบจริง
  const thaiName = "กขคงจฉชซฌญฎฏ"; // 12 ตัวอักษรไทย = 36 ไบต์ (ยาวสุดที่อนุญาต)
  const MAX = 120;
  // คนที่ 121 (เกิน classMax 120) ต้องนั่งไม่ได้
  let s = G.setup(["host-monitor-1"]);
  s = apply(s, "host-monitor-1", { type: "config", rounds: 30 });
  for (let i = 1; i <= MAX; i++) s = apply(s, rid(i), { type: "sit", name: thaiName });
  ok(s.roster.length === MAX, `นั่งครบ ${MAX} คน (ได้ ${s.roster.length})`);
  ok(!G.validateAction(s, rid(MAX + 1), { type: "sit", name: "เกิน" }).ok, `คนที่ ${MAX + 1} นั่งไม่ได้ (เต็ม)`);

  s = apply(s, "host-monitor-1", { type: "begin" });
  // เล่น 30 รอบเต็ม แล้ววัดขนาด state สูงสุด
  let maxBytes = 0;
  let guard = 0;
  while (s.phase === "cplay" && guard++ < 100000) {
    if (s.stage === "roll") { for (const r of s.roster) if (s.rolls[r.id] == null) s = apply(s, r.id, { type: "croll" }); }
    else { for (const pid of Object.keys(s.cpend)) s = apply(s, pid, actionFor(s.cpend[pid])); }
    const bytes = Buffer.byteLength(JSON.stringify(s), "utf8");
    if (bytes > maxBytes) maxBytes = bytes;
  }
  ok(s.phase === "done", "200 คนเล่นจบ 30 รอบได้");
  const kb = (maxBytes / 1024).toFixed(1);
  // เผื่อ margin: ต้อง < 118KB (มี headroom ~10KB ใต้ขีด 128KB ของแพลตฟอร์ม)
  ok(maxBytes < 118 * 1024, `ขนาด state สูงสุด ${kb} KB < 118 KB (มี margin ใต้ 128KB)`);
  console.log(`     (state ใหญ่สุดระหว่างเล่น worst-case = ${kb} KB)`);
}

// ============ 6) quiz เก็บเป็น index — เฉลยต้องไม่หลุดไป view ============
section("quiz refactor: เฉลยไม่หลุดไป client");
{
  // เล่น class จนเจอ cpend เป็น quiz แล้วตรวจ viewFor
  let s = seatPlayers(G.setup(["host"]), "host", ids(6), "class", 30);
  s = apply(s, "host", { type: "begin" });
  let checked = false, guard = 0;
  while (s.phase === "cplay" && !checked && guard++ < 100000) {
    if (s.stage === "roll") {
      for (const r of s.roster) if (s.rolls[r.id] == null) s = apply(s, r.id, { type: "croll" });
    } else {
      // หา player ที่ค้าง quiz
      const quizPid = Object.keys(s.cpend).find((pid) => s.cpend[pid].kind === "quiz");
      if (quizPid) {
        const view = G.viewFor(s, quizPid);
        const mp = view.myPend;
        ok(mp && mp.kind === "quiz", "view มี myPend quiz");
        ok(typeof mp.q === "string" && mp.q.length > 0, "myPend มีคำถาม (q)");
        ok(Array.isArray(mp.c) && mp.c.length === 4, "myPend มีตัวเลือก 4 ข้อ (c)");
        ok(mp.a === undefined && mp.x === undefined && mp.qi === undefined, "เฉลย a/x และ qi ไม่หลุดไป view");
        // เก็บสถานะ state ยังมี qi (ไว้ใช้เช็คภายใน)
        ok(s.cpend[quizPid].qi !== undefined, "state ภายในยังเก็บ qi ไว้เกรดคำตอบ");
        checked = true;
      }
      for (const pid of Object.keys(s.cpend)) s = apply(s, pid, actionFor(s.cpend[pid]));
    }
  }
  ok(checked, "เจอช่อง quiz และตรวจ view สำเร็จ");
}

// ============ สรุป ============
console.log(`\n${fail === 0 ? "✅" : "❌"} ผ่าน ${pass} / ${pass + fail} เทสต์` + (fail ? ` — ล้มเหลว ${fail}` : ""));
process.exit(fail ? 1 : 0);
