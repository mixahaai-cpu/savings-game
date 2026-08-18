// บอทผู้เล่นสำหรับทดสอบเกม "วางแผนดี ชีวิตมีเงินเก็บ"
// ใช้ WebSocket ในตัวของ Node 21+ (ไม่ต้องลงแพ็กเกจ ws)
//
// รันเดี่ยว:
//   node test/bot.mjs --room test1 --name บอท1
//   node test/bot.mjs --room test1 --name ครู --host --mode class --rounds 12 --start
//
// หรือ import { Bot } ไปใช้ในสคริปต์ orchestrator (ดู run-test.mjs)

import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_URL = "https://elegant-gnome-812.higgsfield.gg/";

// ---------- เฉลย quiz (โหมด smart) — ดึงจาก public/data.js โดยตรง ----------
let QUIZ_KEY = null; // Map: คำถาม -> index คำตอบที่ถูก
async function loadQuizKey() {
  if (QUIZ_KEY) return QUIZ_KEY;
  QUIZ_KEY = new Map();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dataPath = path.resolve(here, "../public/data.js");
    const mod = await import(pathToFileURL(dataPath).href);
    for (const item of mod.QUIZ || []) QUIZ_KEY.set(item.q, item.a);
  } catch (e) {
    // ดึงเฉลยไม่ได้ → บอทจะเดาแทน (ไม่ทำให้ทดสอบพัง)
  }
  return QUIZ_KEY;
}

const now = () => Date.now();
const rint = (n) => Math.floor(Math.random() * n);

export class Bot {
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_URL).replace(/\/+$/, "") + "/";
    this.room = opts.room || "bottest";
    this.name = opts.name || "บอท";
    this.playerId = opts.playerId || "bot-" + Math.random().toString(36).slice(2, 10);
    this.isHost = !!opts.host;          // ตั้งใจให้เป็นหัวหน้าห้อง (ต่อคนแรก)
    this.wantStart = !!opts.start;      // ให้หัวหน้า config+begin เอง
    this.mode = opts.mode || "class";   // class | turns
    this.rounds = opts.rounds || 12;    // 12 | 20 | 30
    this.smart = opts.smart !== false;  // true = ตอบ quiz ถูก (ดึงเฉลย), false = เดา
    this.verbose = !!opts.verbose;
    this.onEnd = opts.onEnd || null;    // callback เมื่อจบเกม (view over)
    this.onEvent = opts.onEvent || null;

    this.ws = null;
    this.closedByUs = false;
    this.joined = false;
    this.sat = false;
    this.began = false;
    this.lastSeq = -1;
    this.lastStageKey = "";
    this.ended = false;
    this.forceTimer = null;
    this._acted = new Set(); // กันส่ง action ซ้ำในสถานะเดิม
  }

  log(...a) { if (this.verbose) console.log(`[${this.name}]`, ...a); }

  wsUrl() {
    const u = new URL(this.baseUrl);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    const base = u.pathname.replace(/\/+$/, "");
    return `${proto}//${u.host}${base}/ws/${this.room}`;
  }

  connect() {
    return new Promise((resolve) => {
      const url = this.wsUrl();
      this.log("connecting", url);
      this.ws = new WebSocket(url);
      this.ws.addEventListener("open", () => {
        this.log("open → join");
        this.send({ type: "join", playerId: this.playerId });
        resolve();
      });
      this.ws.addEventListener("message", (e) => this.onMessage(e));
      this.ws.addEventListener("close", () => {
        if (this.closedByUs || this.ended) return;
        this.log("closed → reconnect in 1.5s");
        setTimeout(() => this.connect(), 1500);
      });
      this.ws.addEventListener("error", (e) => this.log("ws error", e.message || e));
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
  act(action) { this.send({ type: "action", action }); }

  onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "error") { this.log("server error:", msg.error); return; }
    if (msg.type !== "state") return;
    this.handleState(msg);
  }

  async handleState(msg) {
    const status = msg.status;
    const v = msg.view;

    if (status === "over") {
      if (!this.ended) {
        this.ended = true;
        this.log("GAME OVER");
        if (this.onEnd) this.onEnd(v, this);
        this.close();
      }
      return;
    }
    if (status === "waiting" || !v) {
      // ยังอยู่ล็อบบี้ (เซิร์ฟเวอร์ส่ง waiting ก่อน begin ในบางจังหวะ)
      await this.lobbyStep(v);
      return;
    }

    // playing
    await this.lobbyStep(v);         // เผื่อ view ล็อบบี้มากับ status playing
    if (v.phase === "cplay") await this.playClass(v);
    else if (v.phase === "play") await this.playTurns(v);
  }

  // ----- ล็อบบี้: นั่ง/ตั้งค่า/เริ่ม -----
  async lobbyStep(v) {
    // ต้องมี view จริง (phase lobby) เท่านั้น — ตอน status "waiting" v ว่าง
    // เซิร์ฟเวอร์จะ reject action ("game is not in progress") ถ้ายิงตอนยังไม่มี state
    if (!v || v.phase !== "lobby") return;

    const amHost = v.hostId === this.playerId;

    // หัวหน้า: ตั้งโหมด/จำนวนรอบ (ครั้งเดียว)
    if (this.isHost && amHost && this.wantStart && !this._acted.has("cfg")) {
      this._acted.add("cfg");
      if (v.mode !== this.mode) this.act({ type: "mode", mode: this.mode });
      this.act({ type: "config", rounds: this.rounds });
      this.log(`host config: mode=${this.mode} rounds=${this.rounds}`);
    }

    // นั่งลงเล่น — โหมด class หัวหน้าห้องนั่งไม่ได้ (เป็นจอมอนิเตอร์)
    // เช็คจาก roster จริง (retry ได้ถ้า sit ก่อนหน้าไม่ผ่าน) + กันยิงซ้ำถี่ ๆ ด้วย cooldown
    const seated = (v.roster || []).some((r) => r.id === this.playerId);
    this.sat = seated;
    const canSit = !(v.mode === "class" && amHost);
    if (canSit && !seated && now() - (this._sitSentAt || 0) > 1200) {
      this._sitSentAt = now();
      this.act({ type: "sit", name: this.name });
      this.log("sit as", this.name);
    }
  }

  // ----- โหมดทั้งห้อง (Kahoot) -----
  async playClass(v) {
    // หัวหน้า/มอนิเตอร์: ดันเกมต่อเมื่อหมดเวลา (cforce)
    const amHost = v.hostId === this.playerId;
    if (amHost) this.armForce();

    if (v.stage === "roll") {
      if (!v.myRolled && this.inRoster(v)) {
        const key = "roll:" + v.round;
        if (!this._acted.has(key)) { this._acted.add(key); this.act({ type: "croll" }); this.log(`R${v.round} croll`); }
      }
    } else if (v.stage === "respond") {
      if (v.myPend) {
        const key = "resp:" + v.round + ":" + v.myPend.kind;
        if (!this._acted.has(key)) { this._acted.add(key); await this.decide(v.myPend); }
      }
    }
  }

  // หัวหน้า/มอนิเตอร์ตรวจ deadline ทุก 1 วิ แล้วส่ง cforce ถ้าค้าง
  armForce() {
    if (this.forceTimer) return;
    this.forceTimer = setInterval(() => {
      const last = this._lastView;
      if (!last || last.phase !== "cplay" || !last.stage) return;
      if (now() < (last.stageDeadline || 0)) return;
      const incomplete = last.stage === "roll"
        ? (last.waiting.rolled < last.waiting.total)
        : (last.waiting.undecided > 0);
      if (incomplete) { this.act({ type: "cforce" }); this.log("cforce (timeout)"); }
    }, 1000);
  }

  inRoster(v) {
    if (Array.isArray(v.board)) return v.board.some((b) => b.id === this.playerId);
    if (Array.isArray(v.roster)) return v.roster.some((r) => r.id === this.playerId);
    return this.sat;
  }

  // ----- โหมดผลัดตา -----
  async playTurns(v) {
    // หัวหน้าเริ่มเกมถ้ายังไม่เริ่ม (จัดการใน lobbyStep แล้ว) — ที่นี่แค่เล่น
    if (v.pending && v.pending.pid === this.playerId) {
      const key = "tresp:" + v.round + ":" + v.turnIdx + ":" + v.pending.kind;
      if (!this._acted.has(key)) { this._acted.add(key); await this.decide(v.pending); }
      return;
    }
    if (v.turnId === this.playerId && !v.pending) {
      const key = "troll:" + v.round + ":" + v.turnIdx;
      if (!this._acted.has(key)) { this._acted.add(key); this.act({ type: "roll" }); this.log(`R${v.round} roll`); }
    }
  }

  // ----- ตัดสินใจตาม pend (ใช้ทั้ง 2 โหมด) -----
  async decide(pend) {
    switch (pend.kind) {
      case "alloc": {
        // แบ่งเข้าเงินออมครึ่งหนึ่ง (ปัดลง 100)
        const save = Math.max(0, Math.round(pend.rest / 2 / 100) * 100);
        this.act({ type: "alloc", save: Math.min(save, pend.rest) });
        this.log(`alloc save=${save}/${pend.rest}`);
        break;
      }
      case "quiz": {
        let i = rint(4);
        if (this.smart) {
          const key = await loadQuizKey();
          if (key.has(pend.q)) i = key.get(pend.q);
        }
        this.act({ type: "answer", i });
        this.log(`answer i=${i}${this.smart ? " (smart)" : ""}`);
        break;
      }
      case "invest": {
        // ลงทุนก้อนกลาง ถ้ามีตัวเลือก
        const opts = pend.options || [];
        const amount = opts.length ? opts[Math.min(1, opts.length - 1)] : 0;
        this.act({ type: "invest", amount });
        this.log(`invest ${amount}`);
        break;
      }
      case "choice": {
        // ตอบรับโอกาส (match/gamble) เสมอ เพื่อทดสอบเส้นทางนั้น
        this.act({ type: "choice", yes: true });
        this.log("choice yes");
        break;
      }
      default:
        this.log("unknown pend kind:", pend.kind);
    }
  }

  // เก็บ view ล่าสุดไว้ให้ armForce ใช้ + เรียก decide จาก handleState
  _remember(v) { this._lastView = v; }

  close() {
    this.closedByUs = true;
    if (this.forceTimer) clearInterval(this.forceTimer);
    try { this.ws && this.ws.close(); } catch {}
  }
}

// ให้ handleState เก็บ view ล่าสุดไว้ (สำหรับ armForce)
const _origHandle = Bot.prototype.handleState;
Bot.prototype.handleState = async function (msg) {
  if (msg && msg.type === "state" && msg.view) this._remember(msg.view);
  return _origHandle.call(this, msg);
};

// ---------------- CLI ----------------
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { o[k] = true; }
    else { o[k] = next; i++; }
  }
  return o;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const bot = new Bot({
    baseUrl: a.url,
    room: a.room,
    name: a.name,
    host: a.host,
    start: a.start,
    mode: a.mode,
    rounds: a.rounds ? Number(a.rounds) : undefined,
    smart: a.smart !== "false",
    verbose: true,
    onEnd: (view) => {
      console.log("\n=== จบเกม ===");
      const rank = (view && view.ranking) || [];
      rank.forEach((r, i) => console.log(`${i + 1}. ${r.name}  ออม=${r.savings} สด=${r.cash} หนี้=${r.debt}`));
      process.exit(0);
    },
  });
  bot.connect();
  console.log(`บอท "${bot.name}" เข้าห้อง "${bot.room}" ที่ ${bot.baseUrl}`);
}
