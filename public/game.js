// วางแผนดี ชีวิตมีเงินเก็บ — ตัวเกมหลัก
// โหมดเล่นเครื่องเดียว (pass-and-play) อยู่ในไฟล์นี้ • มี ?room= ใน URL → ส่งต่อให้ online.js
import { STR } from "./strings.js";
import { RULES, PLAYER_COLORS, BOARD, EVENTS, CHANCES, QUIZ } from "./data.js";
import {
  fmt, $, showModal, infoModal, toast, buildBoard, placePawns,
  animateMove, animateDice,
} from "./ui.js";
import * as UI from "./ui.js";
import { installSoundUnlock, setSoundRole, isMuted, toggleMuted, sfx, bgmStart, bgmStop } from "./sound.js";

const SAVE_KEY = "wangplandee.save.v1";
const HIST_KEY = "wangplandee.history.v1";

/* ---------------- RNG (seeded — เกมเดิม ลำดับสุ่มเดิม) ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
  };
}
let S = null; // เกมปัจจุบัน
function rand() {
  const [v, newState] = mulberry32(S.rngState)();
  S.rngState = newState;
  return v;
}
const die = () => 1 + Math.floor(rand() * 6);
function shuffled(n) {
  const arr = [...Array(n).keys()];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- บันทึก/โหลด ---------------- */
function saveGame() { if (S) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
function loadGame() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function clearSave() { localStorage.removeItem(SAVE_KEY); }
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; }
}
function pushHistory(rec) {
  const h = loadHistory();
  h.unshift(rec);
  localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50)));
}

/* ---------------- บัญชี: รับ/จ่าย/โอนเข้าออม (ทุกอย่างลงสมุดบัญชี) ---------------- */
function log(p, label, amt) {
  S.ledger.push({ r: S.round, pi: p.i, label, amt, cash: p.cash, sav: p.savings });
}
function receiveCash(p, amount, label) {
  let rest = amount;
  let paidDebt = 0;
  if (p.debt > 0) {
    paidDebt = Math.min(p.debt, rest);
    p.debt -= paidDebt;
    rest -= paidDebt;
  }
  p.cash += rest;
  log(p, label, amount);
  if (paidDebt > 0) log(p, "ชำระหนี้อัตโนมัติ", -paidDebt);
  return { rest, paidDebt };
}
function depositSavings(p, amount, label) {
  p.cash -= amount;
  p.savings += amount;
  log(p, label || "แบ่งเข้าเงินออม", amount);
}
function gainSavings(p, amount, label) {
  p.savings += amount;
  log(p, label, amount);
}
function charge(p, amount, label) {
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
    const feeShort = fee - feeFromSav;
    if (feeShort > 0) debtAdd += feeShort;
  }
  if (need > 0) debtAdd += need;
  p.debt += debtAdd;
  log(p, label, -amount);
  if (wd > 0) log(p, "ถอนเงินออมมาใช้", -wd);
  if (fee > 0) log(p, "ค่าธรรมเนียมถอนก่อนกำหนด", -fee);
  if (debtAdd > 0) log(p, "กู้ยืม (เป็นหนี้)", debtAdd);
  return { fromCash, wd, fee, debtAdd };
}

/* ---------------- โมดัลรับเงิน + เลือกแบ่งออม ---------------- */
async function incomeFlow(p, amount, title, icon = "💰") {
  const { rest, paidDebt } = receiveCash(p, amount, title);
  const notes = [];
  if (paidDebt > 0) notes.push(`<div class="note bad">${STR.debtPaid(fmt(paidDebt))}</div>`);
  if (rest <= 0) {
    await infoModal(icon, STR.allocTitle(fmt(amount)), notes.join(""));
    renderHud(); saveGame();
    return;
  }
  const q = Math.round(rest / 4 / 100) * 100;
  const h = Math.round(rest / 2 / 100) * 100;
  const opts = [
    { label: `${STR.allocAll} (${fmt(rest)})`, value: rest, cls: "primary" },
    { label: `${STR.allocHalf} (${fmt(h)})`, value: h },
    { label: `${STR.allocQuarter} (${fmt(q)})`, value: q },
    { label: STR.allocNone, value: 0 },
  ].filter((o, idx, arr) => o.value >= 0 && arr.findIndex(z => z.value === o.value) === idx);
  const save = await showModal({
    icon, title: STR.allocTitle(fmt(amount)),
    bodyHTML: notes.join("") + `<div class="desc">${STR.allocAsk}</div>`,
    buttons: opts,
  });
  if (save > 0) depositSavings(p, save, "แบ่งเข้าเงินออม");
  toast(STR.allocDone(fmt(save), fmt(p.cash)));
  renderHud(); saveGame();
}

/* ---------------- โมดัลจ่ายเงิน ---------------- */
async function expenseFlow(p, amount, title, icon = "💸", detail = "") {
  const b = charge(p, amount, title);
  const lines = [];
  if (b.fromCash > 0) lines.push(STR.paidCash(fmt(b.fromCash)));
  if (b.wd > 0) lines.push(STR.withdrew(fmt(b.wd), fmt(b.fee)));
  if (b.debtAdd > 0) lines.push(STR.wentDebt(fmt(b.debtAdd)));
  await infoModal(icon, STR.payTitle(fmt(amount)),
    (detail ? `<div class="desc">${detail}</div>` : "") +
    `<div class="amount-line neg">−${fmt(amount)} ${STR.baht}</div>` +
    `<div class="note ${b.debtAdd > 0 ? "bad" : ""}">${lines.join("<br>")}</div>`);
  renderHud(); saveGame();
}

/* ---------------- คำถามความรู้ ---------------- */
function nextQuiz() {
  if (S.decks.quizIdx >= S.decks.quiz.length) {
    S.decks.quiz = shuffled(QUIZ.length);
    S.decks.quizIdx = 0;
  }
  return QUIZ[S.decks.quiz[S.decks.quizIdx++]];
}
async function quizFlow(p, reward) {
  const q = nextQuiz();
  p.quizAll++;
  const picked = await showModal({
    title: `📖 ${STR.quizCard}`,
    buildBody: (m, close) => {
      m.insertAdjacentHTML("beforeend", `<div class="card-face"><b>${q.q}</b></div>`);
      const wrap = document.createElement("div");
      wrap.className = "quiz-choices";
      q.c.forEach((c, i) => {
        const btn = document.createElement("button");
        btn.textContent = `${"กขคง"[i]}. ${c}`;
        btn.addEventListener("click", () => {
          wrap.querySelectorAll("button").forEach((bb, j) => {
            bb.disabled = true;
            if (j === q.a) bb.classList.add("correct");
            else if (j === i && i !== q.a) bb.classList.add("wrong");
          });
          setTimeout(() => close(i), 900);
        });
        wrap.appendChild(btn);
      });
      m.appendChild(wrap);
    },
  });
  const ok = picked === q.a;
  sfx(ok ? "correct" : "wrong");
  if (ok) {
    p.quizOk++;
    const dest = await showModal({
      icon: "🎉", title: STR.quizReward(fmt(reward)),
      bodyHTML: `<div class="note good"><b>${STR.quizExplain}</b> ${q.x}</div>`,
      buttons: [
        { label: "เก็บเข้าเงินออมเลย 🐷", cls: "primary", value: "sav" },
        { label: "เก็บเป็นเงินสด 💵", value: "cash" },
      ],
    });
    if (dest === "sav") gainSavings(p, reward, "โบนัสความรู้ (เข้าออม)");
    else receiveCash(p, reward, "โบนัสความรู้");
  } else {
    await infoModal("🤔", STR.quizWrong,
      `<div class="note"><b>${STR.quizExplain}</b> ${q.x}</div>`);
  }
  renderHud(); saveGame();
  return ok;
}

/* ---------------- การ์ดเหตุการณ์ / โอกาส ---------------- */
function drawFrom(deckName, source) {
  const d = S.decks;
  if (d[deckName + "Idx"] >= d[deckName].length) {
    d[deckName] = shuffled(source.length);
    d[deckName + "Idx"] = 0;
  }
  return source[d[deckName][d[deckName + "Idx"]++]];
}
async function eventFlow(p) {
  const card = drawFrom("event", EVENTS);
  const isBad = (card.cash || 0) < 0;
  await infoModal(card.icon, `❓ ${STR.eventCard}`,
    `<div class="card-face flip-in"><b>${card.t}</b><br><span class="desc">${card.d}</span>` +
    (card.cash ? `<div class="amount-line ${card.cash > 0 ? "pos" : "neg"}">${card.cash > 0 ? "+" : "−"}${fmt(Math.abs(card.cash))} ${STR.baht}</div>` : "") +
    `</div>`, STR.ok);
  if (isBad && p.shield) {
    p.shield = false;
    log(p, `🛡️ โล่ป้องกัน: ${card.t}`, 0);
    await infoModal("🛡️", STR.shieldUsed, `<div class="note good">${card.t} — ไม่เสียเงินเพราะเตรียมเงินสำรองไว้!</div>`);
    renderHud(); saveGame();
    return;
  }
  if (card.savingsPct != null) {
    const gain = Math.min(card.cap, Math.round(p.savings * card.savingsPct / 100) * 100);
    if (gain > 0) {
      gainSavings(p, gain, `${card.t} (+${Math.round(card.savingsPct * 100)}% ของเงินออม)`);
      await infoModal("📈", card.t, `<div class="amount-line pos">+${fmt(gain)} ${STR.baht}</div><div class="note good">ยิ่งออมมาก ยิ่งได้ประโยชน์จากโอกาสแบบนี้!</div>`);
    } else {
      await infoModal("😅", card.t, `<div class="note">ยังไม่มีเงินออม เลยพลาดกำไรครั้งนี้ — เริ่มออมตั้งแต่วันนี้นะ</div>`);
    }
    renderHud(); saveGame();
  } else if (card.cash > 0) {
    await incomeFlow(p, card.cash, card.t, card.icon);
  } else if (card.cash < 0) {
    await expenseFlow(p, -card.cash, card.t, card.icon, card.d);
  }
}
async function chanceFlow(p) {
  const card = drawFrom("chance", CHANCES);
  const face = `<div class="card-face flip-in"><b>${card.t}</b><br><span class="desc">${card.d}</span></div>`;
  switch (card.kind) {
    case "gain":
      await infoModal(card.icon, `🎁 ${STR.chanceCard}`, face, STR.ok);
      await incomeFlow(p, card.amount, card.t, card.icon);
      break;
    case "savingsPct": {
      await infoModal(card.icon, `🎁 ${STR.chanceCard}`, face, STR.ok);
      const gain = Math.min(card.cap, Math.round(p.savings * card.pct / 100) * 100);
      if (gain > 0) {
        gainSavings(p, gain, card.t);
        await infoModal("💹", card.t, `<div class="amount-line pos">+${fmt(gain)} ${STR.baht}</div><div class="note good">ดอกเบี้ยคือรางวัลของนักออม</div>`);
      } else {
        await infoModal("😅", card.t, `<div class="note">ยังไม่มีเงินออม จึงไม่ได้ดอกเบี้ย — ออมก่อน ได้ก่อน!</div>`);
      }
      renderHud(); saveGame();
      break;
    }
    case "matchDeposit": {
      if (p.cash >= card.amount) {
        const yes = await showModal({
          icon: card.icon, title: `🎁 ${STR.chanceCard}`, bodyHTML: face,
          buttons: [{ label: `ฝาก ${fmt(card.amount)} รับสมทบ ${fmt(card.amount)}!`, cls: "primary", value: true }, { label: STR.no, value: false }],
        });
        if (yes) {
          depositSavings(p, card.amount, "ฝากโครงการออมทวีคูณ");
          gainSavings(p, card.amount, "เงินสมทบจากธนาคาร");
          toast(`เงินออม +${fmt(card.amount * 2)}`);
        }
      } else {
        await infoModal(card.icon, `🎁 ${STR.chanceCard}`, face + `<div class="note">เงินสดไม่พอเข้าร่วมครั้งนี้ (ต้องมี ${fmt(card.amount)})</div>`);
      }
      renderHud(); saveGame();
      break;
    }
    case "bonusQuiz":
      await infoModal(card.icon, `🎁 ${STR.chanceCard}`, face, STR.drawCard);
      await quizFlow(p, RULES.quizBigReward);
      break;
    case "saverPrize":
      if (p.savings >= card.need) {
        gainSavings(p, card.amount, card.t);
        await infoModal("🏅", card.t, face + `<div class="amount-line pos">+${fmt(card.amount)} ${STR.baht}</div>`);
      } else {
        await infoModal(card.icon, card.t, face + `<div class="note">เงินออมยังไม่ถึง ${fmt(card.need)} — สะสมต่อ รางวัลรออยู่!</div>`);
      }
      renderHud(); saveGame();
      break;
    case "gamble": {
      if (p.cash >= card.cost) {
        const yes = await showModal({
          icon: card.icon, title: `🎁 ${STR.chanceCard}`, bodyHTML: face,
          buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }],
        });
        if (yes) {
          charge(p, card.cost, `ลงทุน: ${card.t}`);
          const d = die();
          if (d >= card.needRoll) {
            receiveCash(p, card.prize, `กำไร: ${card.t} (ทอยได้ ${d})`);
            await infoModal("🎲", STR.rolled(d), `<div class="amount-line pos">+${fmt(card.prize)} ${STR.baht}</div><div class="note good">ลงทุนสำเร็จ!</div>`);
          } else {
            await infoModal("🎲", STR.rolled(d), `<div class="amount-line neg">−${fmt(card.cost)} ${STR.baht}</div><div class="note bad">ขาดทุน… การลงทุนมีความเสี่ยง ควรลงเงินที่เสียได้เท่านั้น</div>`);
          }
        }
      } else {
        await infoModal(card.icon, `🎁 ${STR.chanceCard}`, face + `<div class="note">เงินสดไม่พอลงทุนครั้งนี้</div>`);
      }
      renderHud(); saveGame();
      break;
    }
  }
}

/* ---------------- ช่องการลงทุน ---------------- */
async function investFlow(p) {
  const options = [500, 1000, 2000].filter(v => v <= p.cash);
  if (options.length === 0) {
    await infoModal("📈", STR.investTitle, `<div class="note">${STR.investNoCash}</div>`);
    return;
  }
  const buttons = options.map(v => ({ label: `ลงทุน ${fmt(v)}`, value: v, cls: v === options[options.length - 1] ? "primary" : "" }));
  buttons.push({ label: STR.investNone, value: 0 });
  const amt = await showModal({ icon: "📈", title: STR.investTitle, bodyHTML: `<div class="desc">${STR.investAsk}</div>`, buttons });
  if (!amt) return;
  charge(p, amt, "เงินลงทุน");
  const d = die();
  const win = d >= 3;
  const back = win ? Math.round(amt * 1.5) : Math.round(amt * 0.5);
  receiveCash(p, back, win ? `ผลตอบแทนการลงทุน (ทอยได้ ${d})` : `เงินลงทุนคืนบางส่วน (ทอยได้ ${d})`);
  await infoModal("🎲", STR.rolled(d),
    `<div class="amount-line ${win ? "pos" : "neg"}">${win ? "+" : "−"}${fmt(Math.abs(back - amt))} ${STR.baht}</div>` +
    `<div class="note ${win ? "good" : "bad"}">${win ? STR.investWin(fmt(amt), fmt(back)) : STR.investLose(fmt(amt), fmt(back))}</div>`);
  renderHud(); saveGame();
}

/* ---------------- เดินและจัดการช่อง ---------------- */
function cur() { return S.players[S.turnIdx]; }
const pawnList = () => S.players.map(p => ({ id: "p" + p.i, color: p.color, pos: p.pos }));

async function resolveSpace(p) {
  const cell = BOARD[p.pos];
  switch (cell.type) {
    case "start": break;
    case "income":
      await infoModal(cell.icon, `${cell.name}`, `<div class="card-face flip-in"><b>${cell.desc}</b><div class="amount-line pos">+${fmt(cell.amount)} ${STR.baht}</div></div>`, STR.ok);
      await incomeFlow(p, cell.amount, cell.name, cell.icon);
      break;
    case "save":
      gainSavings(p, cell.amount, `${cell.name}: ${cell.desc}`);
      await infoModal("🐷", cell.name, `<div class="card-face flip-in"><b>${cell.desc}</b><div class="amount-line pos">+${fmt(cell.amount)} ${STR.baht} เข้าเงินออม</div></div><div class="note good">ออมสม่ำเสมอ คือหัวใจของเงินเก็บ</div>`);
      renderHud(); saveGame();
      break;
    case "invest": await investFlow(p); break;
    case "event": await eventFlow(p); break;
    case "chance": await chanceFlow(p); break;
    case "quiz": await quizFlow(p, RULES.quizReward); break;
    case "shield":
      if (!p.shield) {
        p.shield = true;
        log(p, "รับโล่เงินสำรองฉุกเฉิน", 0);
        await infoModal("🛡️", cell.name, `<div class="note good">${STR.shieldGain}</div>`);
      } else {
        gainSavings(p, 500, "รางวัลเตรียมพร้อม (มีโล่อยู่แล้ว)");
        await infoModal("🛡️", cell.name, `<div class="note good">${STR.shieldAlready}</div>`);
      }
      renderHud(); saveGame();
      break;
    case "expense":
      await expenseFlow(p, cell.amount, `${cell.name}: ${cell.desc}`, cell.icon, cell.desc);
      break;
  }
}

async function onRoll() {
  if (S.phase !== "idle" || UI.modalOpen) return;
  S.phase = "busy";
  $("#roll-btn").disabled = true;
  sfx("dice");
  const n = die();
  await animateDice(n);
  sfx("land");
  toast(STR.rolled(n), 1200);
  const p = cur();
  const from = p.pos;
  const passedStart = from + n >= BOARD.length;
  p.pos = (from + n) % BOARD.length;
  await animateMove($("#board"), pawnList(), "p" + p.i, from, n);
  renderPawns();
  if (passedStart) {
    p.laps++;
    const interest = Math.min(RULES.interestCap, Math.round(p.savings * RULES.interestPct / 10) * 10);
    if (interest > 0) {
      gainSavings(p, interest, "ดอกเบี้ยเงินออม (ครบรอบบอร์ด)");
      await infoModal("🏦", STR.passStart, `<div class="amount-line pos">+${fmt(interest)} ${STR.baht}</div><div class="note good">${STR.interestGain(fmt(interest))}</div>`);
    } else {
      await infoModal("🏦", STR.passStart, `<div class="note">${STR.interestNone}</div>`);
    }
    renderHud();
  }
  await resolveSpace(p);
  endTurn();
}

function endTurn() {
  S.turnIdx++;
  if (S.turnIdx >= S.players.length) {
    S.turnIdx = 0;
    S.round++;
    if (S.round > S.settings.totalRounds) { endGame(); return; }
  }
  S.phase = "idle";
  saveGame();
  renderAll();
}

/* ---------------- เริ่ม/จบเกม ---------------- */
function newGame(settings) {
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) | 0;
  S = {
    screen: "game",
    settings,
    rngState: seed,
    round: 1,
    turnIdx: 0,
    phase: "idle",
    startedAt: Date.now(),
    players: settings.players.map((pl, i) => ({
      i, name: pl.name, color: PLAYER_COLORS[pl.colorIdx].hex,
      pos: 0, cash: RULES.startMoney, savings: 0, debt: 0,
      shield: false, quizOk: 0, quizAll: 0, laps: 0,
    })),
    decks: { event: [], eventIdx: 999, chance: [], chanceIdx: 999, quiz: [], quizIdx: 999 },
    ledger: [],
  };
  for (const p of S.players) log(p, "เงินตั้งต้น", RULES.startMoney);
  saveGame();
  showScreen("game");
  $("#board").innerHTML = "";
  renderAll();
}

function ranking() {
  return [...S.players].sort((a, b) => {
    const ad = a.debt > 0, bd = b.debt > 0;
    if (ad !== bd) return ad ? 1 : -1;
    if (b.savings !== a.savings) return b.savings - a.savings;
    return b.cash - a.cash;
  });
}

function endGame() {
  const rank = ranking();
  const winner = rank[0].debt > 0 ? null : rank[0];
  const mins = Math.max(1, Math.round((Date.now() - S.startedAt) / 60000));
  pushHistory({
    date: new Date().toISOString(),
    rounds: S.settings.totalRounds,
    durationMin: mins,
    winner: winner ? winner.name : "-",
    players: rank.map(p => ({ name: p.name, savings: p.savings, cash: p.cash, debt: p.debt, quizOk: p.quizOk, quizAll: p.quizAll })),
  });
  S.screen = "end";
  S.endData = { mins };
  clearSave();
  showScreen("end");
  sfx("win");
  renderEnd();
}

/* ---------------- เรนเดอร์ ---------------- */
function showScreen(name) {
  for (const s of ["menu", "setup", "game", "end"]) $("#" + s + "-screen").classList.toggle("hidden", s !== name);
  if (name === "menu") renderMenu();
  if (name === "game") bgmStart(); else bgmStop(); // เพลงพื้นหลังเฉพาะตอนเล่น
}

function renderPawns() {
  placePawns($("#board"), pawnList(), "p" + cur().i);
}

function renderHud() {
  $("#round-chip").textContent = STR.round(Math.min(S.round, S.settings.totalRounds), S.settings.totalRounds);
  const panel = $("#players-panel");
  panel.innerHTML = "";
  S.players.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "player-card" + (i === S.turnIdx ? " current" : "");
    card.innerHTML = `
      <div class="row1"><span class="dot" style="background:${p.color}"></span>${p.name}
        <span class="badges">${p.shield ? "🛡️" : ""}${i === S.turnIdx ? " 👈" : ""}</span></div>
      <div class="money-row">
        <span class="cash">${fmt(p.cash)}</span>
        <span class="sav">${fmt(p.savings)}</span>
        ${p.debt > 0 ? `<span class="debt">${fmt(p.debt)}</span>` : ""}
      </div>`;
    panel.appendChild(card);
  });
  const tl = $("#turn-label");
  if (tl) tl.textContent = STR.turnOf(cur().name);
  const rb = $("#roll-btn");
  if (rb) rb.disabled = S.phase !== "idle";
  renderDev();
}

function renderAll() {
  const board = $("#board");
  if (!board.hasChildNodes()) {
    buildBoard(board, STR.roll);
    $("#roll-btn").addEventListener("click", onRoll);
  }
  renderPawns();
  renderHud();
}

/* ---------------- สมุดบัญชี ---------------- */
let ledgerFilter = -1; // -1 = ทุกคน
function ledgerRows() {
  return ledgerFilter < 0 ? S.ledger : S.ledger.filter(e => e.pi === ledgerFilter);
}
function openLedger() {
  showModal({
    title: `📒 ${STR.ledgerTitle}`,
    buildBody: (m, close) => {
      const tabs = document.createElement("div");
      tabs.className = "ledger-tabs";
      const mk = (label, val) => {
        const b = document.createElement("button");
        b.textContent = label;
        if (ledgerFilter === val) b.classList.add("sel");
        b.addEventListener("click", () => { ledgerFilter = val; close("reopen"); });
        tabs.appendChild(b);
      };
      mk("ทุกคน", -1);
      S.players.forEach((p) => mk(p.name, p.i));
      m.appendChild(tabs);
      const wrap = document.createElement("div");
      wrap.className = "ledger-wrap";
      const rows = ledgerRows().map(e => `
        <tr><td>${e.r}</td><td>${S.players[e.pi].name}</td><td class="item">${e.label}</td>
        <td class="${e.amt > 0 ? "pos" : e.amt < 0 ? "neg" : ""}">${e.amt === 0 ? "—" : (e.amt > 0 ? "+" : "−") + fmt(Math.abs(e.amt))}</td>
        <td>${fmt(e.cash)}</td><td>${fmt(e.sav)}</td></tr>`).join("");
      wrap.innerHTML = `<table class="ledger"><thead><tr>
        <th>${STR.ledgerRound}</th><th>ผู้เล่น</th><th style="text-align:left">${STR.ledgerItem}</th>
        <th>${STR.ledgerAmount}</th><th>${STR.ledgerCash}</th><th>${STR.ledgerSavings}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">ยังไม่มีรายการ</td></tr>`}</tbody></table>`;
      m.appendChild(wrap);
      const btns = document.createElement("div");
      btns.className = "btns horiz";
      const ex = document.createElement("button");
      ex.textContent = STR.exportCsv;
      ex.addEventListener("click", exportCsv);
      const cl = document.createElement("button");
      cl.textContent = STR.close;
      cl.className = "primary";
      cl.addEventListener("click", () => close(null));
      btns.append(ex, cl);
      m.appendChild(btns);
    },
  }).then(v => { if (v === "reopen") openLedger(); });
}
function exportCsv() {
  const head = "รอบ,ผู้เล่น,รายการ,จำนวนเงิน,เงินสดคงเหลือ,เงินออมคงเหลือ";
  const lines = ledgerRows().map(e =>
    [e.r, S.players[e.pi].name, `"${e.label.replace(/"/g, '""')}"`, e.amt, e.cash, e.sav].join(","));
  const blob = new Blob(["﻿" + head + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "บันทึกเกมออมเงิน.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- หน้าจบเกม ---------------- */
function renderEnd() {
  const rank = ranking();
  const winner = rank[0].debt > 0 ? null : rank[0];
  $("#end-title").textContent = winner ? STR.winner(winner.name) : STR.noWinner;
  $("#end-sub").textContent = winner ? STR.winnerRule : "";
  const quizOk = S.players.reduce((s, p) => s + p.quizOk, 0);
  const quizAll = S.players.reduce((s, p) => s + p.quizAll, 0);
  $("#end-meta").textContent = `${STR.gameDuration(S.endData.mins)} • ${STR.quizScore(quizOk, quizAll)}`;
  const list = $("#rank-list");
  list.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉", "4", "5", "6"];
  rank.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "rank-item" + (i === 0 && !p.debt ? " first" : "");
    el.innerHTML = `<span class="medal">${medals[i]}</span>
      <span class="dot" style="width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid var(--brown)"></span>
      <span class="who">${p.name}</span>
      <span class="sum">🐷 ${fmt(p.savings)}<br>💵 ${fmt(p.cash)}${p.debt > 0 ? ` • <span style="color:var(--red)">⛓️ ${STR.hasDebt} ${fmt(p.debt)}</span>` : ""}</span>`;
    list.appendChild(el);
  });
}

/* ---------------- สถิติ ---------------- */
function openStats() {
  const h = loadHistory();
  showModal({
    title: `📊 ${STR.statsTitle}`,
    buildBody: (m, close) => {
      if (h.length === 0) {
        m.insertAdjacentHTML("beforeend", `<div class="note">${STR.statsEmpty}</div>`);
      } else {
        let best = { name: "-", savings: 0 };
        let qOk = 0, qAll = 0;
        for (const g of h) for (const p of g.players) {
          if (p.savings > best.savings) best = p;
          qOk += p.quizOk || 0; qAll += p.quizAll || 0;
        }
        m.insertAdjacentHTML("beforeend", `<div class="note good">
          ${STR.statsGames(h.length)}<br>${STR.statsBest(best.name, fmt(best.savings))}<br>
          ${qAll ? STR.statsQuiz(Math.round(qOk / qAll * 100)) : ""}</div>`);
        const list = document.createElement("div");
        list.className = "history-list";
        h.slice(0, 10).forEach(g => {
          const d = new Date(g.date);
          const el = document.createElement("div");
          el.className = "history-item";
          el.innerHTML = `<b>${STR.historyItem(d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }), g.winner)}</b><br>
            <span class="hint">${g.players.map(p => `${p.name}: 🐷${fmt(p.savings)}${p.debt > 0 ? "⛓️" : ""}`).join(" • ")}</span>`;
          list.appendChild(el);
        });
        m.appendChild(list);
      }
      const btns = document.createElement("div");
      btns.className = "btns horiz";
      if (h.length) {
        const clr = document.createElement("button");
        clr.textContent = STR.statsClear;
        clr.addEventListener("click", async () => {
          close(null);
          const ok = await showModal({ icon: "🗑️", title: STR.statsClearAsk, buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
          if (ok) { localStorage.removeItem(HIST_KEY); toast("ล้างประวัติแล้ว"); }
        });
        btns.appendChild(clr);
      }
      const cl = document.createElement("button");
      cl.textContent = STR.close;
      cl.className = "primary";
      cl.addEventListener("click", () => close(null));
      btns.appendChild(cl);
      m.appendChild(btns);
    },
  });
}

/* ---------------- หน้าเมนู + ตั้งค่า ---------------- */
function renderMenu() {
  const hasSave = !!loadGame();
  $("#btn-continue").classList.toggle("hidden", !hasSave);
}
let setupState = { count: 4, roundIdx: 1, names: [] };
function renderSetup() {
  const p = $("#setup-panel");
  const rounds = RULES.roundOptions;
  p.innerHTML = `<h2>${STR.setupTitle}</h2>
    <div><b>${STR.setupPlayers}</b></div><div class="opt-row" id="cnt-row"></div>
    <div><b>${STR.setupRounds}</b> <span class="hint" id="round-hint"></span></div><div class="opt-row" id="round-row"></div>
    <div id="names"></div>
    <div class="btns horiz" style="display:flex;gap:8px;margin-top:12px">
      <button id="btn-setup-back">${STR.back}</button>
      <button id="btn-setup-start" class="primary" style="flex:1">${STR.setupStart}</button>
    </div>`;
  const cntRow = $("#cnt-row");
  for (let c = RULES.minPlayers; c <= RULES.maxPlayers; c++) {
    const b = document.createElement("button");
    b.textContent = c + " คน";
    if (c === setupState.count) b.classList.add("sel");
    b.addEventListener("click", () => { setupState.count = c; renderSetup(); });
    cntRow.appendChild(b);
  }
  const roundRow = $("#round-row");
  rounds.forEach((r, i) => {
    const b = document.createElement("button");
    b.textContent = r.rounds + " รอบ";
    if (i === setupState.roundIdx) b.classList.add("sel");
    b.addEventListener("click", () => { setupState.roundIdx = i; renderSetup(); });
    roundRow.appendChild(b);
  });
  $("#round-hint").textContent = STR.setupRoundHint(rounds[setupState.roundIdx].rounds, rounds[setupState.roundIdx].minutes);
  const names = $("#names");
  for (let i = 0; i < setupState.count; i++) {
    const row = document.createElement("div");
    row.className = "name-row";
    row.innerHTML = `<span class="dot" style="background:${PLAYER_COLORS[i].hex}"></span>`;
    const input = document.createElement("input");
    input.placeholder = STR.setupName(i + 1);
    input.maxLength = 12;
    input.value = setupState.names[i] || "";
    input.addEventListener("input", () => (setupState.names[i] = input.value));
    row.appendChild(input);
    names.appendChild(row);
  }
  $("#btn-setup-back").addEventListener("click", () => showScreen("menu"));
  $("#btn-setup-start").addEventListener("click", () => {
    newGame({
      totalRounds: rounds[setupState.roundIdx].rounds,
      players: Array.from({ length: setupState.count }, (_, i) => ({
        name: (setupState.names[i] || "").trim() || STR.defaultName(i + 1),
        colorIdx: i,
      })),
    });
  });
}

/* ---------------- Dev overlay (?dev=1) ---------------- */
const devMode = new URLSearchParams(location.search).has("dev");
function renderDev() {
  if (!devMode || !S) return;
  const el = $("#dev-overlay");
  el.style.display = "block";
  el.querySelector(".dev-state").textContent =
    `r${S.round}/${S.settings.totalRounds} t${S.turnIdx} ${S.phase} | ` +
    S.players.map(p => `${p.name[0]}:${p.pos} c${p.cash} s${p.savings} d${p.debt}`).join(" ");
}

/* ---------------- คีย์บอร์ด (physical key codes) ---------------- */
addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.code !== "Enter" && e.code !== "NumpadEnter") return;
  if (UI.modalOpen) {
    const prim = document.querySelectorAll("#modal-overlay .modal button.primary");
    if (prim.length === 1 && !prim[0].disabled) { e.preventDefault(); prim[0].click(); }
    return;
  }
  if (S && S.screen === "game" && !$("#game-screen").classList.contains("hidden") && S.phase === "idle") {
    e.preventDefault();
    onRoll();
  }
});
addEventListener("resize", () => { if (S && S.screen === "game") renderPawns(); });

/* ---------------- เริ่มระบบ ---------------- */
function init() {
  // มี ?room= = โหมดออนไลน์ — ส่งต่อให้ online.js ทั้งหมด
  if (new URLSearchParams(location.search).get("room")) {
    import("./online.js").then((m) => m.startOnline());
    return;
  }
  // เสียงโหมดเครื่องเดียว: BGM+เอฟเฟกต์ default เปิด (เครื่องเดียวไม่มีเสียงตีกัน)
  setSoundRole("local");
  installSoundUnlock();
  const sb = $("#btn-sound");
  sb.classList.remove("hidden");
  sb.textContent = isMuted() ? "🔇" : "🔊";
  sb.onclick = () => { toggleMuted(); sb.textContent = isMuted() ? "🔇" : "🔊"; if (!isMuted()) sfx("popup"); };
  $("#menu-title").innerHTML = `${STR.title.replace("ชีวิตมีเงินเก็บ", "")}<span class="accent">ชีวิตมีเงินเก็บ</span>`;
  $("#menu-sub").textContent = STR.subtitle;
  $("#btn-new").textContent = STR.menuNew;
  $("#btn-online").textContent = STR.menuOnline;
  $("#btn-continue").textContent = "▶ " + STR.menuContinue;
  $("#btn-how").textContent = STR.menuHow;
  $("#btn-stats").textContent = STR.menuStats;
  $("#btn-credits").textContent = STR.menuCredits;
  const foot = $("#menu-credit-foot");
  if (foot) foot.textContent = STR.credits.org + " • " + STR.credits.major;

  $("#btn-new").addEventListener("click", () => { renderSetup(); showScreen("setup"); });
  $("#btn-online").addEventListener("click", () => {
    const room = Math.random().toString(36).slice(2, 8);
    location.search = "?room=" + room; // โหลดหน้าใหม่เข้าโหมดออนไลน์
  });
  $("#btn-continue").addEventListener("click", () => {
    const s = loadGame();
    if (!s) return;
    S = s;
    S.phase = "idle";
    showScreen("game");
    $("#board").innerHTML = "";
    renderAll();
  });
  $("#btn-how").addEventListener("click", () =>
    infoModal("📘", STR.howTitle, `<div class="note" style="text-align:left">${STR.howText.join("<br><br>")}</div>`, STR.close));
  $("#btn-stats").addEventListener("click", openStats);
  $("#btn-credits").addEventListener("click", () => UI.showCredits(STR.credits, STR.close));

  $("#btn-ledger").textContent = "📒 " + STR.ledger;
  $("#btn-ledger").addEventListener("click", openLedger);
  $("#btn-menu").textContent = STR.menu;
  $("#btn-menu").addEventListener("click", async () => {
    const ok = await showModal({ icon: "🚪", title: STR.confirmQuit, buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
    if (ok) { saveGame(); showScreen("menu"); }
  });
  $("#btn-font").addEventListener("click", () => {
    const b = document.body;
    if (b.classList.contains("fs-xl")) b.classList.remove("fs-lg", "fs-xl");
    else if (b.classList.contains("fs-lg")) { b.classList.remove("fs-lg"); b.classList.add("fs-xl"); }
    else b.classList.add("fs-lg");
  });

  $("#end-again").textContent = STR.playAgain;
  $("#end-again").addEventListener("click", () => { newGame(S.settings); });
  $("#end-menu").textContent = STR.backToMenu;
  $("#end-menu").addEventListener("click", () => showScreen("menu"));
  $("#end-ledger").textContent = "📒 " + STR.ledger;
  $("#end-ledger").addEventListener("click", openLedger);
  $("#end-csv").textContent = STR.exportCsv;
  $("#end-csv").addEventListener("click", exportCsv);

  if (devMode) {
    $("#dev-skip").addEventListener("click", () => {
      if (!S || S.screen !== "game") return;
      S.round = S.settings.totalRounds + 1;
      endGame();
    });
    $("#dev-rich").addEventListener("click", () => {
      if (!S || S.screen !== "game") return;
      const p = cur();
      p.cash += 5000; gainSavings(p, 3000, "dev bonus");
      renderHud(); saveGame();
    });
  }

  showScreen("menu");
}
init();
