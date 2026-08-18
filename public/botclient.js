// บอทผู้เล่นในเบราว์เซอร์ — เปิด WebSocket ของตัวเองเข้าห้องเดียวกัน เล่นอัตโนมัติ
// ใช้สำหรับ "ทดสอบเกมคนเดียว" (ปุ่ม ➕ เพิ่มบอท ในล็อบบี้ โหมด dev)
// ลอจิกตรงกับ test/bot.mjs (ทดสอบผ่านแล้ว) แต่รันในเบราว์เซอร์
import { QUIZ } from "./data.js";

const QUIZ_KEY = new Map(QUIZ.map((it) => [it.q, it.a])); // คำถาม -> index คำตอบที่ถูก
const now = () => Date.now();
const rint = (n) => Math.floor(Math.random() * n);

let bots = [];        // บอทที่กำลังทำงานอยู่
let botSeq = 0;       // นับชื่อบอท

function wsUrlFor(room) {
  const base = location.pathname.replace(/\/+$/, "");
  return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + base + "/ws/" + room;
}

class BrowserBot {
  constructor(room, name) {
    this.room = room;
    this.name = name;
    this.playerId = "bot-" + Math.random().toString(36).slice(2, 10);
    this.ws = null;
    this.dead = false;         // ถูกลบ/เตะแล้ว — หยุดทุกอย่าง
    this.wasSeated = false;    // เคยอยู่ใน roster แล้ว (ใช้ตรวจว่าโดนเตะ)
    this._acted = new Set();
    this._sitSentAt = 0;
    this._lastView = null;
    this.forceTimer = null;
  }

  start() {
    if (this.dead) return;
    this.ws = new WebSocket(wsUrlFor(this.room));
    this.ws.onopen = () => this.send({ type: "join", playerId: this.playerId });
    this.ws.onmessage = (e) => this.onMessage(e);
    this.ws.onclose = () => { if (!this.dead) setTimeout(() => this.start(), 1500); };
    this.ws.onerror = () => {};
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  act(a) { this.send({ type: "action", action: a }); }

  kill() {
    this.dead = true;
    if (this.forceTimer) clearInterval(this.forceTimer);
    try { this.ws && this.ws.close(); } catch {}
  }

  onMessage(e) {
    if (this.dead) return;
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type !== "state") return;
    const v = msg.view;
    if (v) this._lastView = v;

    if (msg.status === "over") { this.kill(); return; }
    if (!v) return; // status waiting — ยังไม่มี state อย่ายิง action

    if (v.phase === "lobby") this.lobbyStep(v);
    else if (v.phase === "cplay") this.playClass(v);
    else if (v.phase === "play") this.playTurns(v);
  }

  lobbyStep(v) {
    const seated = (v.roster || []).some((r) => r.id === this.playerId);
    if (seated) this.wasSeated = true;
    // เคยนั่งแล้วหายจาก roster = โดนหัวหน้าเตะ → เลิกยุ่ง (กันแย่งนั่งกลับ)
    if (!seated && this.wasSeated) { this.kill(); return; }
    // บอทไม่เป็นหัวหน้า/มอนิเตอร์ — นั่งอย่างเดียว (โหมด class หัวหน้าห้องนั่งไม่ได้ แต่บอทไม่ใช่หัวหน้า)
    if (!seated && now() - this._sitSentAt > 1200) {
      this._sitSentAt = now();
      this.act({ type: "sit", name: this.name });
    }
  }

  playClass(v) {
    this.armForce(); // บอทช่วยดันเกมต่อเมื่อหมดเวลา (คนทดสอบจะได้ไม่ต้องกดเอง)
    if (v.stage === "roll") {
      if (!v.myRolled && this.inRoster(v)) {
        const k = "roll:" + v.round;
        if (!this._acted.has(k)) { this._acted.add(k); this.act({ type: "croll" }); }
      }
    } else if (v.stage === "respond" && v.myPend) {
      const k = "resp:" + v.round + ":" + v.myPend.kind;
      if (!this._acted.has(k)) { this._acted.add(k); this.decide(v.myPend); }
    }
  }

  armForce() {
    if (this.forceTimer) return;
    this.forceTimer = setInterval(() => {
      const v = this._lastView;
      if (this.dead || !v || v.phase !== "cplay" || !v.stage || !v.waiting) return;
      if (now() < (v.stageDeadline || 0)) return;
      const incomplete = v.stage === "roll"
        ? (v.waiting.rolled < v.waiting.total)
        : (v.waiting.undecided > 0);
      if (incomplete) this.act({ type: "cforce" });
    }, 1000);
  }

  inRoster(v) {
    if (Array.isArray(v.board)) return v.board.some((b) => b.id === this.playerId);
    if (Array.isArray(v.roster)) return v.roster.some((r) => r.id === this.playerId);
    return this.wasSeated;
  }

  playTurns(v) {
    if (v.pending && v.pending.pid === this.playerId) {
      const k = "tresp:" + v.round + ":" + v.turnIdx + ":" + v.pending.kind;
      if (!this._acted.has(k)) { this._acted.add(k); this.decide(v.pending); }
      return;
    }
    if (v.turnId === this.playerId && !v.pending) {
      const k = "troll:" + v.round + ":" + v.turnIdx;
      if (!this._acted.has(k)) { this._acted.add(k); this.act({ type: "roll" }); }
    }
  }

  decide(pend) {
    switch (pend.kind) {
      case "alloc": {
        const save = Math.max(0, Math.round(pend.rest / 2 / 100) * 100);
        this.act({ type: "alloc", save: Math.min(save, pend.rest) });
        break;
      }
      case "quiz": {
        const i = QUIZ_KEY.has(pend.q) ? QUIZ_KEY.get(pend.q) : rint(4);
        this.act({ type: "answer", i });
        break;
      }
      case "invest": {
        const opts = pend.options || [];
        this.act({ type: "invest", amount: opts.length ? opts[Math.min(1, opts.length - 1)] : 0 });
        break;
      }
      case "choice":
        this.act({ type: "choice", yes: true });
        break;
    }
  }
}

// ---- API สำหรับ online.js ----
export function addBot(room) {
  botSeq++;
  const bot = new BrowserBot(room, "🤖 บอท " + botSeq);
  bots.push(bot);
  bot.start();
  return bot;
}
export function clearBots() {
  bots.forEach((b) => b.kill());
  bots = [];
  botSeq = 0;
}
export function botCount() { return bots.filter((b) => !b.dead).length; }
