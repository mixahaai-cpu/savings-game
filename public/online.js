// โหมดออนไลน์ — client วาดภาพจาก state ที่เซิร์ฟเวอร์ (logic.js) ส่งมาเท่านั้น
// โปรโตคอล: ส่ง {join|action|reset} รับ {state|error} — ห้ามสะสม state ฝั่ง client
import { STR } from "./strings.js";
import { PLAYER_COLORS, BOARD } from "./data.js";
import { fmt, $, showModal, toast, buildBoard, placePawns, animateMove, animateDice, animateDiceEl } from "./ui.js";
import { qrSvg } from "./qr.js";
import { installSoundUnlock, setSoundRole, isMuted, toggleMuted, sfx, bgmStart, bgmStop } from "./sound.js";
import { addBot, clearBots, botCount } from "./botclient.js";

const DEV = new URLSearchParams(location.search).has("dev"); // ?dev=1 = โชว์เครื่องมือทดสอบ (ปุ่มเพิ่มบอท)

// บทบาทเสียงปัจจุบัน (monitor = BGM+SFX default เปิด / player = default ปิด กันเสียงตีกันในห้อง)
let sndRole = "";
function applySoundRole(v) {
  const r = (v.mode === "class" || v.phase === "cplay") && v.hostId === v.me ? "monitor" : "player";
  if (r !== sndRole) { sndRole = r; setSoundRole(r); }
}
function soundBtnLabel() { return isMuted() ? "🔇" : "🔊"; }

const NAME_KEY = "wangplandee.name";
let ws = null;
let cur = null;            // state ล่าสุดจากเซิร์ฟเวอร์
let seenMoveSeq = 0;       // อนิเมชันเดินที่เล่นไปแล้ว
let seenLastSeq = 0;       // แบนเนอร์เหตุการณ์ที่แสดงไปแล้ว
let renderChain = Promise.resolve(); // ประมวลผล state ทีละอัน (กันอนิเมชันตีกัน)

const colorOf = (r) => PLAYER_COLORS[r.color % PLAYER_COLORS.length].hex;

export function startOnline() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  // บัตรประจำตัวเก็บ "ประจำเครื่อง" (localStorage) — ปิดแท็บแล้วเปิดใหม่ยังเป็นคนเดิม
  // ครูได้ตำแหน่งหัวหน้าคืน นักเรียนได้ที่นั่ง/เงินคืน (sessionStorage เดิมหายทันทีที่ปิดแท็บ)
  let playerId = sessionStorage.getItem("mp-player-id") || localStorage.getItem("wangplandee.pid");
  if (!playerId) playerId = "p-" + Math.random().toString(36).slice(2, 10);
  localStorage.setItem("wangplandee.pid", playerId);
  sessionStorage.setItem("mp-player-id", playerId);
  const base = location.pathname.replace(/\/+$/, "");
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + base + "/ws/" + room;

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  window.__sendAction = (action) => send({ type: "action", action });

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => send({ type: "join", playerId });
    ws.onclose = () => {
      const st = $("#ol-status");
      if (st) st.textContent = STR.onlineDisconnected;
      setTimeout(connect, 1500);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "error") { toast("⚠️ " + msg.error, 2500); return; }
      if (msg.type !== "state") return;
      renderChain = renderChain.then(() => renderState(msg)).catch(console.error);
    };
  }

  setupChrome(send);
  installSoundUnlock(); // ปลดล็อกเสียงด้วยการแตะครั้งแรก (นโยบาย autoplay)
  showLobbyShell();
  connect();

  // ชีพจรหัวหน้าห้อง: ถ้าเราเป็นหัวหน้า ส่ง ping ทุก 45 วิ ให้เซิร์ฟเวอร์รู้ว่ายังอยู่
  // (หัวหน้าเงียบเกิน 1.5 นาที คนอื่นจะกดขอรับตำแหน่งได้)
  setInterval(() => {
    const v = cur && cur.view;
    if (cur && cur.status === "playing" && v && v.hostId === v.me) send({ type: "ping" });
  }, 45000);
}

async function claimHostFlow() {
  const ok = await showModal({
    icon: "🆘", title: STR.claimHost,
    bodyHTML: `<div class="note">${STR.claimHostAsk}</div>`,
    buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }],
  });
  if (ok) window.__sendAction({ type: "claim" });
}

/* ---------------- โครงหน้าจอ + ปุ่มบนแถบเกม ---------------- */
function setupChrome(send) {
  $("#btn-ledger").textContent = "📒 " + STR.ledger;
  $("#btn-ledger").onclick = openLedger;
  $("#btn-restart").textContent = STR.hostReset;
  $("#btn-restart").onclick = hostResetFlow;
  const stopBtn = $("#btn-stop");
  if (stopBtn) { stopBtn.textContent = STR.hostStop; stopBtn.onclick = hostStopFlow; }
  $("#btn-claim").title = STR.claimHost;
  $("#btn-claim").onclick = claimHostFlow;
  const sb = $("#btn-sound");
  if (sb) {
    sb.classList.remove("hidden");
    sb.textContent = soundBtnLabel();
    sb.onclick = () => { toggleMuted(); sb.textContent = soundBtnLabel(); if (!isMuted()) sfx("popup"); };
  }
  $("#btn-menu").textContent = STR.onlineLeave;
  $("#btn-menu").onclick = async () => {
    const ok = await showModal({ icon: "🚪", title: STR.onlineLeave + "?", buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
    if (ok) location.href = location.pathname;
  };
  $("#btn-font").onclick = () => {
    const b = document.body;
    if (b.classList.contains("fs-xl")) b.classList.remove("fs-lg", "fs-xl");
    else if (b.classList.contains("fs-lg")) { b.classList.remove("fs-lg"); b.classList.add("fs-xl"); }
    else b.classList.add("fs-lg");
  };
  $("#end-again").textContent = STR.playAgain;
  $("#end-again").onclick = () => send({ type: "reset" });
  $("#end-menu").textContent = STR.onlineLeave;
  $("#end-menu").onclick = () => (location.href = location.pathname);
  $("#end-ledger").textContent = "📒 " + STR.ledger;
  $("#end-ledger").onclick = openLedger;
  $("#end-csv").textContent = STR.exportCsv;
  $("#end-csv").onclick = exportCsv;
  const es = $("#end-stats");
  if (es) { es.textContent = "📊 " + STR.menuStats; es.classList.remove("hidden"); es.onclick = openOnlineStats; }
  addEventListener("resize", () => { if (cur && screenShown() === "game") renderPawnsNow(); });
}

function screens() { return ["menu", "setup", "game", "end", "online", "class"]; }
function showScreen(name) {
  for (const s of screens()) {
    const el = $("#" + s + "-screen");
    if (el) el.classList.toggle("hidden", s !== name);
  }
}
function screenShown() {
  for (const s of screens()) {
    const el = $("#" + s + "-screen");
    if (el && !el.classList.contains("hidden")) return s;
  }
  return null;
}

// ลิงก์แชร์ที่สะอาด — ตัด __raw ที่แพลตฟอร์มเติมให้ iframe ออก เหลือ URL ห้องจริง
function roomShareUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete("__raw");
    return u.toString();
  } catch (e) { return location.href; }
}

function showLobbyShell() {
  showScreen("online");
  const link = roomShareUrl();
  let qr = "";
  try { qr = qrSvg(link, { level: "M", margin: 3 }); } catch (e) { qr = ""; }
  $("#online-panel").innerHTML = `
    <h2>🌐 ${STR.onlineLobbyTitle}</h2>
    <div class="hint" id="ol-status">${STR.onlineConnecting}</div>
    <div class="share-box">
      <div class="hint">${STR.onlineShare}</div>
      ${qr ? `<div class="qr-box" id="ol-qr">${qr}</div><div class="hint">${STR.qrScan}</div>` : ""}
      <input readonly id="ol-link" value="${escapeHtml(link)}">
      <div class="btns horiz">
        <button id="ol-copy" class="teal">${STR.onlineCopy} 🔗</button>
        ${qr ? `<button id="ol-qr-big">${STR.qrBig}</button>` : ""}
      </div>
    </div>
    <div id="ol-lobby"></div>`;
  $("#ol-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(link); } catch { $("#ol-link").select(); document.execCommand("copy"); }
    toast(STR.onlineCopied);
  };
  const big = $("#ol-qr-big");
  if (big) big.onclick = showBigQr;
}

// QR เต็มจอ (สำหรับฉายโปรเจกเตอร์ให้ทั้งห้องสแกน)
function showBigQr() {
  const link = roomShareUrl();
  const room = new URLSearchParams(location.search).get("room") || "";
  const qr = qrSvg(link, { level: "M", margin: 2 });
  showModal({
    buildBody: (m, close) => {
      m.classList.add("qr-modal");
      m.innerHTML = `<div class="qr-big">${qr}</div>
        <div class="qr-code-text">${STR.qrRoomCode}: <b>${escapeHtml(room)}</b></div>
        <div class="hint" style="text-align:center;word-break:break-all">${escapeHtml(link)}</div>`;
      const b = document.createElement("button");
      b.textContent = STR.close;
      b.className = "primary";
      b.onclick = () => close(null);
      m.appendChild(b);
    },
  });
}

/* ---------------- เรนเดอร์จาก state ---------------- */
async function renderState(s) {
  cur = s;
  if (s.status === "waiting" || !s.view) { clsPrevPhase = ""; bgmStop(); renderWaiting(s); return; }
  const v = s.view;
  applySoundRole(v);
  if (s.status === "over") { clsPrevPhase = ""; bgmStop(); renderEnd(s); return; }
  if (v.phase === "lobby") { clsPrevPhase = ""; onlineGameStart = 0; savedEndSig = ""; bgmStop(); renderLobby(s); return; }
  if (!onlineGameStart) onlineGameStart = Date.now(); // จับเวลาเริ่มเกม (ไว้คำนวณระยะเวลาเล่น)
  bgmStart(); // เล่นจริงเฉพาะเครื่องที่ไม่ mute (มอนิเตอร์ default เปิด / นักเรียน default ปิด)
  if (v.phase === "cplay") { renderClass(s); return; } // โหมดทั้งห้อง
  clsPrevPhase = "";
  await renderPlay(s); // phase === "play" (ผลัดตา)
}

// เก็บผลเกมออนไลน์ลงประวัติ (localStorage เดียวกับโหมดเครื่องเดียว) — เดิมบันทึกเฉพาะโหมดเครื่องเดียว
const HIST_KEY = "wangplandee.history.v1";
let onlineGameStart = 0;
let savedEndSig = "";
function saveOnlineHistory(s) {
  const rank = (s.result && s.result.ranking) || [];
  if (!rank.length) return false;
  const sig = s.view.round + ":" + rank.map((r) => r.id + r.savings).join(",");
  if (sig === savedEndSig) return false; // กันบันทึกซ้ำ (renderEnd ถูกเรียกทุก broadcast ตอนจบ)
  savedEndSig = sig;
  const winner = s.result && !s.result.noWinner ? rank[0] : null;
  const mins = onlineGameStart ? Math.max(1, Math.round((Date.now() - onlineGameStart) / 60000)) : Math.max(1, s.view.rounds || 12);
  const rec = {
    date: new Date().toISOString(),
    mode: s.view.mode === "class" ? "ทั้งห้อง" : "ผลัดตา",
    rounds: s.view.rounds,
    durationMin: mins,
    winner: winner ? winner.name : "-",
    players: rank.map((p) => ({ name: p.name, savings: p.savings, cash: p.cash, debt: p.debt, quizOk: p.quizOk || 0, quizAll: p.quizAll || 0 })),
  };
  try {
    const h = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    h.unshift(rec);
    localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50)));
  } catch (e) { /* localStorage อาจถูกปิด — ข้ามไป */ }
  return true; // บันทึกครั้งแรกของเกมนี้
}

function openOnlineStats() {
  let h = [];
  try { h = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch (e) { h = []; }
  showModal({
    title: `📊 ${STR.statsTitle}`,
    buildBody: (m, close) => {
      if (!h.length) {
        m.insertAdjacentHTML("beforeend", `<div class="note">${STR.statsEmpty}</div>`);
      } else {
        let best = { name: "-", savings: 0 }, qOk = 0, qAll = 0;
        for (const g of h) for (const p of g.players) {
          if (p.savings > best.savings) best = p;
          qOk += p.quizOk || 0; qAll += p.quizAll || 0;
        }
        m.insertAdjacentHTML("beforeend", `<div class="note good">${STR.statsGames(h.length)}<br>${STR.statsBest(best.name, fmt(best.savings))}<br>${qAll ? STR.statsQuiz(Math.round(qOk / qAll * 100)) : ""}</div>`);
        const list = document.createElement("div");
        list.className = "history-list";
        h.slice(0, 12).forEach((g) => {
          const d = new Date(g.date);
          const el = document.createElement("div");
          el.className = "history-item";
          el.innerHTML = `<b>${STR.historyItem(d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }), g.winner)}${g.mode ? ` • ${g.mode}` : ""}</b><br>
            <span class="hint">${g.players.map((p) => `${escapeHtml(p.name)}: 🐷${fmt(p.savings)}${p.debt > 0 ? "⛓️" : ""}`).join(" • ")}</span>`;
          list.appendChild(el);
        });
        m.appendChild(list);
      }
      const b = document.createElement("button");
      b.textContent = STR.close;
      b.className = "primary";
      b.onclick = () => close(null);
      m.appendChild(b);
    },
  });
}

function renderWaiting(s) {
  if (screenShown() !== "online") showLobbyShell();
  $("#ol-status").textContent = `👥 ${s.connected || 1} คนในห้อง — ${STR.onlineWaitMin}`;
  $("#ol-lobby").innerHTML = "";
}

function renderLobby(s) {
  if (screenShown() !== "online") showLobbyShell();
  const v = s.view;
  const meSat = v.roster.some((r) => r.id === v.me);
  const isHost = v.hostId === v.me;
  const isClass = v.mode === "class";
  const isMonitor = isClass && isHost; // เจ้าของห้องในโหมดทั้งห้อง = จอมอนิเตอร์ (ไม่ลงเล่น)
  const cap = isClass ? 120 : 6;
  $("#ol-status").textContent = STR.onlineSat(v.roster.length, cap);
  const box = $("#ol-lobby");
  box.innerHTML = "";

  // เลือกรูปแบบการเล่น — หัวหน้าห้องกดสลับได้ คนอื่นเห็นเฉย ๆ
  const modeBox = document.createElement("div");
  modeBox.innerHTML = `<div><b>${STR.modeTitle}</b></div>`;
  const modeRow = document.createElement("div");
  modeRow.className = "opt-row";
  [["class", STR.modeClass], ["turns", STR.modeTurns]].forEach(([m, label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (v.mode === m) b.classList.add("sel");
    b.disabled = !isHost;
    b.onclick = () => window.__sendAction({ type: "mode", mode: m });
    modeRow.appendChild(b);
  });
  modeBox.appendChild(modeRow);
  if (isClass) modeBox.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-bottom:8px">${STR.modeClassHint}</div>`);
  box.appendChild(modeBox);

  const list = document.createElement("div");
  list.className = "roster";
  v.roster.forEach((r) => {
    const el = document.createElement("div");
    el.className = "roster-item";
    el.innerHTML = `<span class="dot" style="background:${colorOf(r)}"></span>
      <b>${escapeHtml(r.name)}</b>
      <span class="hint">${r.id === v.hostId ? "👑 " + STR.onlineHost : ""} ${r.id === v.me ? STR.onlineYou : ""}</span>`;
    if (isHost && r.id !== v.me) {
      // เครื่องมือหัวหน้าห้อง: มอบตำแหน่ง / เชิญออก
      const tools = document.createElement("span");
      tools.className = "roster-tools";
      const tr = document.createElement("button");
      tr.textContent = "👑";
      tr.title = STR.hostTransfer;
      tr.onclick = async () => {
        const ok = await showModal({ icon: "👑", title: STR.hostTransferAsk(r.name), buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
        if (ok) window.__sendAction({ type: "transfer", to: r.id });
      };
      const kk = document.createElement("button");
      kk.textContent = "❌";
      kk.title = STR.hostKick;
      kk.onclick = async () => {
        const ok = await showModal({ icon: "❌", title: STR.hostKickAsk(r.name), buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
        if (ok) window.__sendAction({ type: "kick", id: r.id });
      };
      tools.append(tr, kk);
      el.appendChild(tools);
    }
    list.appendChild(el);
  });
  box.appendChild(list);
  if (isMonitor) box.insertAdjacentHTML("beforeend", `<div class="note good">🖥️ ${STR.monitorNote}</div>`);
  else if (isHost && !meSat) box.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-bottom:8px">👑 ${STR.hostOwnerNote}</div>`);

  if (!meSat && !isMonitor && v.roster.length < cap) {
    const row = document.createElement("div");
    row.className = "name-row";
    const input = document.createElement("input");
    input.placeholder = STR.onlineYourName;
    input.maxLength = 12;
    input.value = localStorage.getItem(NAME_KEY) || "";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = STR.onlineSit;
    btn.onclick = () => {
      const name = input.value.trim();
      if (!name) { toast("ใส่ชื่อก่อนนะ"); input.focus(); return; }
      localStorage.setItem(NAME_KEY, name);
      window.__sendAction({ type: "sit", name });
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    row.append(input, btn);
    box.appendChild(row);
  } else if (!meSat) {
    box.insertAdjacentHTML("beforeend", `<div class="note">${STR.onlineSpectator}</div>`);
  }

  if (isHost) {
    const cfg = document.createElement("div");
    cfg.innerHTML = `<div style="margin-top:10px"><b>${STR.setupRounds}</b></div>`;
    const row = document.createElement("div");
    row.className = "opt-row";
    [[12, 10], [20, 18], [30, 28]].forEach(([r, m]) => {
      const b = document.createElement("button");
      b.textContent = `${r} รอบ ≈ ${m} นาที`;
      if (v.rounds === r) b.classList.add("sel");
      b.onclick = () => window.__sendAction({ type: "config", rounds: r });
      row.appendChild(b);
    });
    cfg.appendChild(row);
    const begin = document.createElement("button");
    begin.className = "primary";
    begin.style.cssText = "width:100%;margin-top:12px";
    begin.textContent = `▶ ${STR.onlineBegin}`;
    begin.disabled = v.roster.length < 2;
    begin.title = v.roster.length < 2 ? STR.onlineNeedTwo : "";
    begin.onclick = () => window.__sendAction({ type: "begin" });
    cfg.appendChild(begin);
    if (v.roster.length < 2) cfg.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-top:6px">${STR.onlineNeedTwo}</div>`);
    const rst = document.createElement("button");
    rst.textContent = STR.hostReset;
    rst.style.cssText = "width:100%;margin-top:8px";
    rst.onclick = hostResetFlow;
    cfg.appendChild(rst);

    // เครื่องมือทดสอบ (dev เท่านั้น): เพิ่มบอทเข้ามาเล่นเอง — จะได้ทดสอบเกมคนเดียว
    if (DEV) {
      const room = new URLSearchParams(location.search).get("room") || "";
      const dev = document.createElement("div");
      dev.style.cssText = "margin-top:12px;padding-top:10px;border-top:1px dashed var(--line,#ccc)";
      dev.innerHTML = `<div class="hint">🧪 โหมดทดสอบ (dev): เพิ่มบอทเข้ามาเล่นเอง</div>`;
      const drow = document.createElement("div");
      drow.className = "opt-row";
      const addB = document.createElement("button");
      const updateLabel = () => { addB.textContent = `🤖 เพิ่มบอท (มี ${botCount()})`; };
      updateLabel();
      addB.onclick = () => { addBot(room); updateLabel(); };
      const clrB = document.createElement("button");
      clrB.textContent = "🗑️ ลบบอท";
      clrB.title = "ปิดการเชื่อมต่อบอททั้งหมด (ถ้ายังอยู่ใน roster ให้กด ❌ เตะออก)";
      clrB.onclick = () => { clearBots(); updateLabel(); };
      drow.append(addB, clrB);
      dev.appendChild(drow);
      cfg.appendChild(dev);
    }
    box.appendChild(cfg);
  } else if (meSat) {
    box.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-top:10px">⏳ ${STR.onlineWaitHost}</div>`);
  }
  if (meSat && !isHost) {
    const cl = document.createElement("button");
    cl.className = "ghost";
    cl.style.cssText = "margin-top:10px;font-size:.9em";
    cl.textContent = STR.claimHost;
    cl.onclick = claimHostFlow;
    box.appendChild(cl);
  }
}

/* ---------------- ช่วงเล่นเกม ---------------- */
// ตัวหมากปริศนาสีดำ (ถ้าเกิดแล้ว) — ต่อท้าย list ตัวเดิน
const blackToken = (v) => (v && v.blackPos != null ? [{ id: "__black", color: "#111", pos: v.blackPos }] : []);
const pawnList = (v) => [...v.roster.map((r) => ({ id: r.id, color: colorOf(r), pos: v.players[r.id].pos })), ...blackToken(v)];
function renderPawnsNow() {
  const v = cur && cur.view;
  if (!v || v.phase !== "play") return;
  placePawns($("#board"), pawnList(v), v.turnId);
}

async function renderPlay(s) {
  const v = s.view;
  if (screenShown() !== "game") {
    showScreen("game");
    $("#board").innerHTML = "";
  }
  const board = $("#board");
  if (!board.hasChildNodes()) {
    buildBoard(board, STR.roll);
    $("#roll-btn").addEventListener("click", () => {
      sfx("dice");
      window.__sendAction({ type: "roll" });
      $("#roll-btn").disabled = true; // เซิร์ฟเวอร์จะยืนยันด้วย state ใหม่
    });
    seenMoveSeq = v.lastMove ? v.lastMove.seq : 0; // เข้าระหว่างเกม — ไม่ต้องเล่นย้อน
    seenLastSeq = v.last ? v.last.seq : 0;
    seenBlackSeq = v.blackEvent ? v.blackEvent.seq : 0;
    renderPawnsNow();
  }

  // อนิเมชันเดิน: เล่นเฉพาะการทอยครั้งใหม่ที่ยังไม่เคยเห็น
  if (v.lastMove && v.lastMove.seq > seenMoveSeq) {
    seenMoveSeq = v.lastMove.seq;
    const mover = v.roster.find((r) => r.id === v.lastMove.pid);
    if (mover) {
      await animateDice(v.lastMove.steps);
      await animateMove(board, pawnList(v), mover.id, v.lastMove.from, v.lastMove.steps);
    }
  }
  renderPawnsNow();
  renderHud(v);
  if (v.last && v.last.seq > seenLastSeq) {
    seenLastSeq = v.last.seq;
    showLastBanner(v);
  }
  renderPending(v);
  maybeBlackNotify(v); // ⚫ แจ้งเตือนตัวหมากปริศนา (โหมดผลัดตา)
}

function renderHud(v) {
  $("#round-chip").textContent = STR.round(Math.min(v.round, v.rounds), v.rounds);
  const panel = $("#players-panel");
  panel.innerHTML = "";
  v.roster.forEach((r) => {
    const p = v.players[r.id];
    const isTurn = r.id === v.turnId;
    const card = document.createElement("div");
    card.className = "player-card" + (isTurn ? " current" : "");
    card.innerHTML = `
      <div class="row1"><span class="dot" style="background:${colorOf(r)}"></span>${escapeHtml(r.name)}${r.id === v.me ? " " + STR.onlineYou : ""}
        <span class="badges">${p.shield ? "🛡️" : ""}${isTurn ? " 👈" : ""}</span></div>
      <div class="money-row">
        <span class="cash">${fmt(p.cash)}</span>
        <span class="sav">${fmt(p.savings)}</span>
        ${p.debt > 0 ? `<span class="debt">${fmt(p.debt)}</span>` : ""}
      </div>`;
    panel.appendChild(card);
  });
  const meSat = v.roster.some((r) => r.id === v.me);
  const myTurn = v.turnId === v.me;
  const turnName = (v.roster.find((r) => r.id === v.turnId) || {}).name || "";
  const tl = $("#turn-label");
  if (tl) tl.textContent = !meSat ? "👀 ผู้ชม — " + STR.onlineTurnOf(turnName) : myTurn ? "🎯 " + STR.onlineYourTurn : STR.onlineTurnOf(turnName);
  const rb = $("#roll-btn");
  if (rb) rb.disabled = !(meSat && myTurn && !v.pending);
  $("#btn-restart").classList.toggle("hidden", v.hostId !== v.me);
  const sBtn = $("#btn-stop");
  if (sBtn) sBtn.classList.toggle("hidden", v.hostId !== v.me);
  $("#btn-claim").classList.toggle("hidden", !(meSat && v.hostId !== v.me));
}

/* แบนเนอร์สรุปเหตุการณ์ — แสดงเฉพาะผลของตัวเอง (ไม่เล่ารายละเอียดการเล่นของคนอื่น) */
function showLastBanner(v) {
  const last = v.last;
  if (last.pid !== v.me) return;
  const who = v.roster.find((r) => r.id === last.pid);
  let el = $("#last-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "last-banner";
    $("#game-screen").appendChild(el);
  }
  let html = who ? `<div class="lb-who"><span class="dot" style="background:${colorOf(who)}"></span><b>${escapeHtml(who.name)}</b></div>` : "";
  if (last.card) html += `<div class="lb-card">${last.card.icon} <b>${last.card.t}</b> — ${last.card.d}</div>`;
  html += last.items.map((it) => `<div class="lb-item">${it.icon} ${it.text}</div>`).join("");
  if (last.quiz) {
    const qz = last.quiz;
    html += `<div class="lb-quiz"><b>${qz.q}</b><br>✅ เฉลย: ${"กขคง"[qz.correct]}. ${qz.c[qz.correct]}<br><span class="hint">💡 ${qz.x}</span></div>`;
  }
  el.innerHTML = html;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(el._h);
  el._h = setTimeout(() => el.classList.remove("show"), last.quiz ? 9000 : 5000);
}

/* ---------------- โมดัลการตัดสินใจ (pending จากเซิร์ฟเวอร์) ---------------- */
let pendingKey = "";
function renderPending(v) {
  const holder = () => {
    let o = $("#pending-overlay");
    if (!o) {
      o = document.createElement("div");
      o.id = "pending-overlay";
      document.body.appendChild(o);
    }
    return o;
  };
  if (!v.pending) {
    pendingKey = "";
    const o = $("#pending-overlay");
    if (o) o.remove();
    return;
  }
  const key = v.seq + ":" + v.pending.kind + ":" + (v.pending.pid === v.me);
  if (key === pendingKey) return;
  pendingKey = key;
  const pend = v.pending;
  const mine = pend.pid === v.me;
  const who = (v.roster.find((r) => r.id === pend.pid) || {}).name || "";
  const o = holder();
  const send = (action) => window.__sendAction(action);

  if (!mine) {
    // ไม่เผยรายละเอียดว่าคนอื่นกำลังทำอะไร — บอกแค่ว่ารอใครอยู่
    o.className = "as-strip";
    o.innerHTML = `<div class="pending-strip">${STR.turnsWaitOther(escapeHtml(who))}</div>`;
    return;
  }

  // ตาของเรา — โมดัลโต้ตอบ
  o.className = "as-modal";
  let inner = "";
  if (pend.kind === "alloc") {
    const q = Math.round(pend.rest / 4 / 100) * 100;
    const h = Math.round(pend.rest / 2 / 100) * 100;
    const opts = [[pend.rest, `${STR.allocAll} (${fmt(pend.rest)})`, "primary"], [h, `${STR.allocHalf} (${fmt(h)})`, ""], [q, `${STR.allocQuarter} (${fmt(q)})`, ""], [0, STR.allocNone, ""]]
      .filter(([val], i, arr) => arr.findIndex((z) => z[0] === val) === i);
    inner = `<div class="big-icon">${pend.icon || "💰"}</div><h3>${STR.allocTitle(fmt(pend.amount))}</h3>
      ${pend.paidDebt > 0 ? `<div class="note bad">${STR.debtPaid(fmt(pend.paidDebt))}</div>` : ""}
      <div class="desc">${escapeHtml(pend.title)} — ${STR.allocAsk}</div>
      <div class="btns">${opts.map(([val, label, cls]) => `<button class="${cls}" data-save="${val}">${label}</button>`).join("")}</div>`;
  } else if (pend.kind === "quiz") {
    inner = `<h3>📖 ${STR.quizCard}</h3><div class="card-face"><b>${pend.q}</b></div>
      <div class="hint">ตอบถูกรับ ${fmt(pend.reward)} บาทเข้าเงินออม</div>
      <div class="quiz-choices">${pend.c.map((c, i) => `<button data-ans="${i}">${"กขคง"[i]}. ${c}</button>`).join("")}</div>`;
  } else if (pend.kind === "invest") {
    inner = `<div class="big-icon">📈</div><h3>${STR.investTitle}</h3><div class="desc">${STR.investAsk}</div>
      <div class="btns">${pend.options.map((vv, i) => `<button data-inv="${vv}" class="${i === pend.options.length - 1 ? "primary" : ""}">ลงทุน ${fmt(vv)}</button>`).join("")}
      <button data-inv="0">${STR.investNone}</button></div>`;
  } else if (pend.kind === "choice") {
    const desc = pend.sub === "match"
      ? `ฝาก ${fmt(pend.amount)} บาท ธนาคารสมทบอีก ${fmt(pend.amount)} บาท!`
      : `ลงทุน ${fmt(pend.cost)} บาท ทอยเต๋าได้ ${pend.needRoll} ขึ้นไป รับ ${fmt(pend.prize)} บาท`;
    inner = `<div class="big-icon">${pend.icon}</div><h3>${pend.title}</h3><div class="desc">${desc}</div>
      <div class="btns horiz"><button class="primary" data-yes="1">${STR.yes}</button><button data-yes="0">${STR.no}</button></div>`;
  }
  o.innerHTML = `<div class="modal">${inner}</div>`;
  o.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => send({ type: "alloc", save: +b.dataset.save })));
  o.querySelectorAll("[data-inv]").forEach((b) => (b.onclick = () => send({ type: "invest", amount: +b.dataset.inv })));
  o.querySelectorAll("[data-yes]").forEach((b) => (b.onclick = () => send({ type: "choice", yes: b.dataset.yes === "1" })));
  o.querySelectorAll("[data-ans]").forEach((b) => (b.onclick = () => {
    o.querySelectorAll("[data-ans]").forEach((x) => (x.disabled = true));
    send({ type: "answer", i: +b.dataset.ans });
  }));
}

/* ---------------- จบเกม ---------------- */
function renderEnd(s) {
  const o = $("#pending-overlay");
  if (o) o.remove();
  if (saveOnlineHistory(s)) sfx("win"); // เสียงแฟนแฟร์ครั้งเดียวตอนจบเกม
  showScreen("end");
  const rank = (s.result && s.result.ranking) || [];
  const winner = s.result && !s.result.noWinner ? rank[0] : null;
  const meWon = winner && winner.id === s.view.me;
  $("#end-title").textContent = winner ? (meWon ? "🏆 คุณชนะ! ยอดนักออมตัวจริง" : STR.winner(winner.name)) : STR.noWinner;
  $("#end-sub").textContent = winner ? STR.winnerRule : "";
  const qOk = rank.reduce((t, p) => t + (p.quizOk || 0), 0);
  const qAll = rank.reduce((t, p) => t + (p.quizAll || 0), 0);
  $("#end-meta").textContent = STR.quizScore(qOk, qAll);
  const list = $("#rank-list");
  list.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉", "4", "5", "6"];
  rank.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "rank-item" + (i === 0 && !(p.debt > 0) ? " first" : "");
    el.innerHTML = `<span class="medal">${medals[i]}</span>
      <span class="dot" style="width:16px;height:16px;border-radius:50%;background:${PLAYER_COLORS[p.color % PLAYER_COLORS.length].hex};border:2px solid var(--brown)"></span>
      <span class="who">${escapeHtml(p.name)}${p.id === s.view.me ? " " + STR.onlineYou : ""}</span>
      <span class="sum">🐷 ${fmt(p.savings)}<br>💵 ${fmt(p.cash)}${p.debt > 0 ? ` • <span style="color:var(--red)">⛓️ ${STR.hasDebt} ${fmt(p.debt)}</span>` : ""}</span>`;
    list.appendChild(el);
  });
}

/* ---------------- สมุดบัญชี (อ่านจาก view) ---------------- */
function nameOf(pid) {
  const v = cur && cur.view;
  const r = v && v.roster.find((x) => x.id === pid);
  return r ? r.name : "?";
}
function openLedger() {
  const v = cur && cur.view;
  if (!v || !v.ledger) return;
  showModal({
    title: `📒 ${STR.ledgerTitle}`,
    buildBody: (m, close) => {
      const wrap = document.createElement("div");
      wrap.className = "ledger-wrap";
      const rows = v.ledger.map((e) => `
        <tr><td>${e.r}</td><td>${escapeHtml(nameOf(e.pid))}</td><td class="item">${e.label}</td>
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
      ex.onclick = exportCsv;
      const cl = document.createElement("button");
      cl.textContent = STR.close;
      cl.className = "primary";
      cl.onclick = () => close(null);
      btns.append(ex, cl);
      m.appendChild(btns);
    },
  });
}
function exportCsv() {
  const v = cur && cur.view;
  if (!v || !v.ledger) return;
  const head = "รอบ,ผู้เล่น,รายการ,จำนวนเงิน,เงินสดคงเหลือ,เงินออมคงเหลือ";
  const lines = v.ledger.map((e) =>
    [e.r, nameOf(e.pid), `"${e.label.replace(/"/g, '""')}"`, e.amt, e.cash, e.sav].join(","));
  const blob = new Blob(["﻿" + head + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "บันทึกเกมออมเงิน-ออนไลน์.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/* ================= โหมดทั้งห้อง (สไตล์ Kahoot) =================
   เซิร์ฟเวอร์ไม่มี timer — client นับถอยหลังจาก stageDeadline (ปรับ offset นาฬิกาด้วย view.now)
   หมดเวลา: ทอย/ตอบให้อัตโนมัติจากเครื่องตัวเอง + เครื่องไหนก็ได้ส่ง cforce เผื่อเพื่อนหลุด */
let clsTimer = null;          // interval อัปเดตแถบเวลา
let clsStageKey = "";         // round:stage ที่กำลังนับอยู่
let clsEndAt = 0;             // เวลาหมด (นาฬิกาเครื่องเรา)
let clsAutoDone = false;      // ส่ง auto-action ของตัวเองไปแล้ว
let clsForceDone = false;     // ส่ง cforce ไปแล้ว
let clsShowHistory = false;
// สถานะกระดานเศรษฐีบนมือถือนักเรียน (โหมดทั้งห้อง) — กระดานสร้างครั้งเดียว คงอยู่ข้าม re-render
let clsAnimating = false;      // กำลังเล่นอนิเมชันเดิน (พักการ sync ตำแหน่ง)
let clsAnimSince = 0;          // เวลาเริ่มอนิเมชัน (กันค้างเมื่อเครื่องช้า)
let clsAnimatedRoll = -1;      // รอบที่เล่นภาพการทอยไปแล้ว
let clsRolledSentRound = -1;   // รอบที่กดทอยส่งไปแล้ว (กันปุ่มเด้งกลับ/กดซ้ำ)
let clsPrevPhase = "";         // เฟสก่อนหน้า (รู้ว่าเพิ่งเข้าเกมใหม่)
let clsMainSig = "";           // ลายเซ็นพาเนลหลัก — ไม่เปลี่ยน = ไม่วาดใหม่ (กันปุ่มตัดสินใจถูกรีเซ็ต)
let clsRankSig = "";           // ลายเซ็นตารางอันดับ
let clsLandedRoll = -1;        // การทอยที่เด้งป๊อปอัป "ตกลงช่อง" ไปแล้ว
let clsHadPendRoll = -1;       // การทอยที่มีการตัดสินใจ (ต้องเด้งผลตอนตอบเสร็จ)
let clsResultRoll = -1;        // การทอยที่เด้งป๊อปอัป "ผลการตัดสินใจ" ไปแล้ว
let clsEventClose = null;      // ตัวปิดป๊อปอัป (auto-dismiss)
let seenBlackSeq = 0;          // เหตุการณ์ตัวหมากปริศนาที่แจ้งเตือนไปแล้ว (ทุกจอ)

function classAutoAct(v) {
  if (!v.myself) return; // ผู้ชมไม่ต้องทำอะไร
  if (v.stage === "roll" && !v.myRolled) { window.__sendAction({ type: "croll" }); return; }
  if (v.stage === "respond" && v.myPend) {
    const pd = v.myPend;
    if (pd.kind === "quiz") window.__sendAction({ type: "answer", i: Math.floor(Math.random() * 4) });
    else if (pd.kind === "alloc") window.__sendAction({ type: "alloc", save: Math.max(0, Math.round(pd.rest / 2 / 100) * 100) });
    else if (pd.kind === "invest") window.__sendAction({ type: "invest", amount: 0 });
    else window.__sendAction({ type: "choice", yes: false });
  }
}

function classTickSetup(v) {
  const key = v.round + ":" + v.stage;
  if (key === clsStageKey) return;
  clsStageKey = key;
  clsAutoDone = false;
  clsForceDone = false;
  clsEndAt = Date.now() + Math.max(0, v.stageDeadline - v.now); // แปลงเป็นนาฬิกาเครื่องเรา
  clearInterval(clsTimer);
  clsTimer = setInterval(() => {
    const left = clsEndAt - Date.now();
    const total = v.stage === "roll" ? 20000 : 40000;
    const bar = $("#cls-timebar-fill");
    const num = $("#cls-timenum");
    // แสดงเวลาแบบไม่รวม grace ของเซิร์ฟเวอร์ (นับถอยจากช่วงจริง)
    const shown = Math.max(0, left - 2500);
    if (bar) bar.style.width = Math.max(0, Math.min(100, (shown / total) * 100)) + "%";
    if (num) num.textContent = Math.ceil(shown / 1000);
    const vv = cur && cur.view;
    if (!vv || vv.phase !== "cplay") { clearInterval(clsTimer); return; }
    if (shown <= 0 && !clsAutoDone) { clsAutoDone = true; classAutoAct(vv); }
    if (left <= -800 && !clsForceDone) {
      const incomplete = vv.stage === "roll" ? vv.waiting.rolled < vv.waiting.total : vv.waiting.undecided > 0;
      // ผู้เล่นหรือจอมอนิเตอร์ (เจ้าของห้อง) ดันเกมต่อเมื่อเลยเวลา
      if (incomplete && (vv.myself || vv.hostId === vv.me)) { clsForceDone = true; window.__sendAction({ type: "cforce" }); }
    }
  }, 200);
}

async function hostResetFlow() {
  const ok = await showModal({ icon: "🔄", title: STR.hostReset, bodyHTML: `<div class="note">${STR.hostResetAsk}</div>`, buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
  if (ok) { window.__sendAction({ type: "restart" }); toast(STR.hostResetDone); }
}

async function hostStopFlow() {
  const ok = await showModal({ icon: "🏁", title: STR.hostStop, bodyHTML: `<div class="note">${STR.hostStopAsk}</div>`, buttons: [{ label: STR.hostStopYes, cls: "primary", value: true }, { label: STR.no, value: false }] });
  if (ok) { window.__sendAction({ type: "stop" }); toast(STR.hostStopDone); }
}

function rankBoard(board) {
  return [...board].sort((a, b) => {
    const ad = a.debt > 0, bd = b.debt > 0;
    if (ad !== bd) return ad ? 1 : -1;
    if (b.savings !== a.savings) return b.savings - a.savings;
    return b.cash - a.cash;
  });
}

function renderClass(s) {
  const v = s.view;
  showScreen("class");
  classTickSetup(v);
  // เพิ่งเข้าเกมใหม่ (จาก lobby/จบเกม) → รีเซ็ตสถานะอนิเมชัน
  if (clsPrevPhase !== "cplay") {
    clsAnimatedRoll = -1; clsRolledSentRound = -1; clsAnimating = false;
    clsLandedRoll = -1; clsHadPendRoll = -1; clsResultRoll = -1;
    seenBlackSeq = v.blackEvent ? v.blackEvent.seq : 0; // เข้ากลางเกม — ไม่เล่นแจ้งเตือนย้อนหลัง
    if (clsEventClose) { clsEventClose(); clsEventClose = null; }
  }
  clsPrevPhase = "cplay";

  ensureClassSkeleton(v);            // สร้างโครง (กระดาน+พาเนล) ครั้งเดียว
  updateClassTop(v);                 // แถบบน + ปุ่มหัวหน้า/ออก
  if (v.myself) {
    updateClassPos(v); updateClassBoard(v); // ผู้เล่น: ตำแหน่ง + ตัวเดิน/ลูกเต๋า
    renderClassPanel(v);
    maybePopups(v);                  // เด้ง 2 จังหวะ: ตอนตกลงช่อง + ตอนตัดสินใจเสร็จ
  } else {
    updateMonitorBoard(v);           // จอมอนิเตอร์: ภาพรวมทุกตัวเดิน + สถิติ + อันดับ
    renderMonitorPanel(v);
  }
  maybeBlackNotify(v);               // ⚫ แจ้งเตือนตัวหมากปริศนา (ทุกจอ)
}

// ---- จอมอนิเตอร์ (เจ้าของห้อง/ผู้ชม) : ภาพรวมกระดาน + สถิติ + อันดับเศรษฐี ----
function rankByMoney(board) {
  const net = (p) => p.savings + p.cash - p.debt;
  return [...board].sort((a, b) => net(b) - net(a));
}
function updateMonitorBoard(v) {
  const host = $("#cls-board-host");
  if (!host) return;
  const pawns = [...v.board.map((r) => ({ id: r.id, color: colorOf(r), pos: r.pos })), ...blackToken(v)];
  placePawns(host, pawns, null); // วางทุกตัวเดิน + ตัวหมากปริศนา ไม่ไฮไลต์ใคร
  const cturn = $("#cls-cturn");
  if (cturn) cturn.textContent = v.stage === "roll" ? "🎲 ช่วงทอย" : "🤔 ช่วงตอบ";
}
let clsMonSig = "";
function renderMonitorPanel(v) {
  const panel = $("#cls-panel");
  if (!panel) return;
  const rank = rankByMoney(v.board);
  const sig = v.round + ":" + v.stage + ":" + rank.map((r) => r.id + r.savings + r.cash + r.debt + r.pos).join(",");
  if (sig === clsMonSig) return; // ไม่มีอะไรเปลี่ยน — ข้ามการวาด (กันกระพริบ)
  clsMonSig = sig;

  const n = v.board.length;
  const totalSav = v.board.reduce((s, p) => s + p.savings, 0);
  const inDebt = v.board.filter((p) => p.debt > 0).length;
  const qOk = v.board.reduce((s, p) => s + (p.quizOk || 0), 0);
  const qAll = v.board.reduce((s, p) => s + (p.quizAll || 0), 0);
  const medals = ["🥇", "🥈", "🥉"];

  let html = `<div class="cls-card mon-stats">
    <div>${STR.monStatPlayers(n)}</div>
    <div>${STR.monStatTotalSav(fmt(totalSav))}</div>
    <div>${STR.monStatAvgSav(fmt(n ? totalSav / n : 0))}</div>
    <div>${STR.monStatDebt(inDebt)}</div>
    ${qAll ? `<div>${STR.monStatQuiz(Math.round(qOk / qAll * 100))}</div>` : ""}
  </div>`;
  html += `<div class="cls-card"><b>${STR.monRankTitle}</b><div class="cls-board mon-rank">` +
    rank.map((r, i) => {
      const cell = BOARD[r.pos];
      const net = r.savings + r.cash - r.debt;
      return `<div class="cls-brow ${i < 3 ? "top" : ""}">
        <span class="cls-medal">${medals[i] || i + 1}</span>
        <span class="dot" style="background:${PLAYER_COLORS[r.color % PLAYER_COLORS.length].hex}"></span>
        <span class="cls-bname">${escapeHtml(r.name)} <span class="hint">${STR.monCell(r.pos, cell.name)}</span></span>
        <span class="cls-bsum">💰 ${fmt(net)}<br><span class="hint">🐷${fmt(r.savings)} 💵${fmt(r.cash)}${r.debt > 0 ? " ⛓️" + fmt(r.debt) : ""}</span></span>
      </div>`;
    }).join("") + `</div></div>`;
  panel.innerHTML = html;
}

// เด้งป๊อปอัป 2 จังหวะต่อการทอย 1 ครั้ง (ผูกกับ lastRoll.r กันรอบเลื่อนทันทีตอนตัดสินใจคนสุดท้าย):
//  (1) ตอนตกลงช่อง — บอกว่าเจอช่อง/เหตุการณ์อะไร
//  (2) ตอนตอบคำถาม/ตัดสินใจเสร็จ — บอกผล (ถูก/ผิด + เฉลย ฯลฯ) เฉพาะช่องที่มีการตัดสินใจ
function maybePopups(v) {
  const me = v.myself;
  if (!me || !me.lastRoll || !me.lastText || clsAnimating) return;
  const r = me.lastRoll.r;
  // (1) ป๊อปอัปตกลงช่อง — ครั้งเดียวต่อการทอย (เด้งได้แม้มีการตัดสินใจค้างอยู่)
  if (clsLandedRoll !== r) {
    clsLandedRoll = r;
    const { title, body } = buildLandingPopup(v);
    showPopup(title, body, "popup");
  }
  if (v.myPend) clsHadPendRoll = r; // การทอยนี้มีการตัดสินใจ
  // (2) ป๊อปอัปผลการตัดสินใจ — หลังตอบเสร็จ (myPend หาย) เฉพาะการทอยที่เคยมีการตัดสินใจ
  if (clsHadPendRoll === r && !v.myPend && clsResultRoll !== r) {
    clsResultRoll = r;
    const { title, body } = buildResultPopup(v);
    const me = v.myself;
    showPopup(title, body, me.lastQuiz ? (me.lastQuiz.ok ? "correct" : "wrong") : "coin");
  }
}

function buildLandingPopup(v) {
  const me = v.myself;
  const cell = BOARD[me.pos];
  const card = me.lastCard;
  let title, body = "";
  if (card) {
    title = card.deck === "event" ? "❓ " + STR.eventCard : "🎁 " + STR.chanceCard;
    body += `<div class="big-icon">${card.icon}</div>
      <div class="card-face flip-in"><b>${escapeHtml(card.t)}</b><br><span class="desc">${escapeHtml(card.d)}</span></div>`;
  } else {
    title = STR.landOn;
    body += `<div class="big-icon">${cell.icon}</div>
      <div class="card-face flip-in"><b>${escapeHtml(cell.name)}</b>${cell.desc ? `<br><span class="desc">${escapeHtml(cell.desc)}</span>` : ""}</div>`;
  }
  const fx = me.lastText.filter((it) => !/ทอยได้ \d/.test(it.text)); // ตัดบรรทัดทอย (เห็นบนกระดานแล้ว)
  if (fx.length) body += `<div class="evt-items">` + fx.map((it) => `<div class="lb-item">${it.icon} ${it.text}</div>`).join("") + `</div>`;
  if (v.myPend) {
    const pd = v.myPend;
    const hint = pd.kind === "quiz" ? `📖 มีคำถามรอให้ตอบ! (ตอบถูกรับ ${fmt(pd.reward)} บาท)`
      : pd.kind === "alloc" ? `💰 ได้รับ ${fmt(pd.amount)} บาท — เลือกแบ่งออมด้านล่าง`
      : pd.kind === "invest" ? `📈 เลือกจำนวนเงินลงทุนด้านล่าง`
      : `🤔 มีตัวเลือกให้ตัดสินใจด้านล่าง`;
    body += `<div class="note good">${hint}</div>`;
  }
  return { title, body };
}

function buildResultPopup(v) {
  const me = v.myself;
  const title = me.lastQuiz ? "📖 " + STR.answerResult : "✨ " + STR.classResult;
  let body = `<div class="evt-items">` +
    me.lastText.map((it) => `<div class="lb-item">${it.icon} ${it.text}</div>`).join("") + `</div>`;
  if (me.lastQuiz) {
    const qz = me.lastQuiz;
    body += `<div class="lb-quiz">${qz.ok ? "🎉 ตอบถูก!" : "🤔 ยังไม่ถูก"} เฉลย: ${"กขคง"[qz.correct]}. ${escapeHtml(qz.correctText)}<br><span class="hint">💡 ${escapeHtml(qz.x)}</span></div>`;
  }
  return { title, body };
}

function showPopup(title, body, sound) {
  if (clsEventClose) { clsEventClose(); clsEventClose = null; }
  if (sound) sfx(sound);
  const p = showModal({ title, bodyHTML: body, buttons: [{ label: STR.next + " 👍", cls: "primary", value: true }] });
  const close = () => { const o = $("#modal-overlay"); if (o) o.remove(); };
  clsEventClose = close;
  const timer = setTimeout(() => { if (clsEventClose === close) { close(); clsEventClose = null; } }, 5000);
  p.then(() => { clearTimeout(timer); if (clsEventClose === close) clsEventClose = null; });
}

// ⚫ แจ้งเตือนตัวหมากปริศนาบนทุกจอ (นักเรียนทุกคน + มอนิเตอร์ + โหมดผลัดตา) เมื่อเกิด/เดิน
function maybeBlackNotify(v) {
  const be = v.blackEvent;
  if (!be || be.seq <= seenBlackSeq) return;
  seenBlackSeq = be.seq;
  const cell = BOARD[be.pos];
  let title, body;
  if (be.kind === "spawn") {
    title = STR.blackSpawn;
    body = `<div class="big-icon">⚫</div>
      <div class="card-face flip-in black-card"><b>${STR.blackSpawn}</b><br><span class="desc">${STR.blackSpawnDesc}</span></div>`;
  } else {
    title = STR.blackMove;
    body = `<div class="big-icon">⚫</div>
      <div class="card-face flip-in black-card"><b>${STR.blackMoveDesc(be.roll, be.pos, cell.name)}</b></div>`;
    if (be.hits && be.hits.length) {
      body += `<div class="evt-items">` + be.hits.map((h) =>
        `<div class="lb-item ${h.good ? "" : "black-bad"}">${h.icon} <b>${escapeHtml(h.name)}</b>: ${h.text} ${h.cash >= 0 ? "+" : "−"}${fmt(Math.abs(h.cash))} บาท</div>`).join("") + `</div>`;
    } else body += `<div class="hint" style="text-align:center">${STR.blackSafe}</div>`;
  }
  showPopup(title, body, "bad");
}

// โครงหน้าจอ: สร้างครั้งเดียวตามว่าเป็นนักเรียน (มีกระดาน) หรือผู้ชม
function ensureClassSkeleton(v) {
  const root = $("#class-screen");
  const want = v.myself ? "player" : "spectator";
  if (root.getAttribute("data-cls") === want && $("#cls-panel")) return;
  root.setAttribute("data-cls", want);
  clsMainSig = ""; clsRankSig = ""; clsMonSig = ""; clsAnimatedRoll = -1; clsAnimating = false;
  const timebar = `<div class="cls-top" id="cls-top"></div>
    <div class="cls-timerwrap">
      <div class="cls-timebig">⏱ <span id="cls-timenum"></span> <span class="u">วิ</span></div>
      <div class="cls-timebar"><div id="cls-timebar-fill"></div></div>
    </div>`;
  if (v.myself) {
    root.innerHTML = `<div class="cls-wrap">${timebar}
      <div class="cls-card cls-pos" id="cls-pos-top"></div>
      <div class="board cls-board-visual" id="cls-board-host"></div>
      <div id="cls-panel"></div></div>`;
    buildBoard($("#cls-board-host"), "", `<div class="center-ui">
      <div class="cls-cturn" id="cls-cturn"></div>
      <div class="dice cls-cdice" id="cls-cdice">🎲</div>
      <button class="primary cls-croll" id="cls-croll"></button>
    </div>`);
  } else {
    // จอมอนิเตอร์: กระดานภาพรวมทุกตัวเดิน + พาเนลสถิติ/อันดับ
    root.innerHTML = `<div class="cls-wrap">${timebar}
      <div class="hint" style="text-align:center">${STR.monitorTitle} — ${STR.monBoardHint}</div>
      <div class="board cls-board-visual" id="cls-board-host"></div>
      <div id="cls-panel"></div></div>`;
    buildBoard($("#cls-board-host"), "", `<div class="center-ui"><div class="cls-cturn" id="cls-cturn"></div></div>`);
  }
}

// ตำแหน่งปัจจุบัน (แสดงเหนือกระดาน) — อัปเดตทุกเรนเดอร์ (เล็ก/ถูก)
function updateClassPos(v) {
  const el = $("#cls-pos-top");
  if (!el || !v.myself) return;
  const cell = BOARD[v.myself.pos];
  el.innerHTML = `<span class="hint">${STR.classYourPos}:</span> <b>${cell.icon} ช่อง ${v.myself.pos} — ${cell.name}</b>`;
}

function updateClassTop(v) {
  const isHost = v.hostId === v.me;
  const top = $("#cls-top");
  if (!top) return;
  top.innerHTML = `
    <span class="round-chip">${STR.classRound(Math.min(v.round, v.rounds), v.rounds)}</span>
    <span class="cls-stage">${v.stage === "roll" ? "🎲 " + STR.classStageRoll : "🤔 " + STR.classStageRespond}</span>
    <button id="cls-sound" title="เปิด/ปิดเสียง">${soundBtnLabel()}</button>
    ${isHost ? `<button id="cls-stop" title="${STR.hostStop}">🏁</button>` : ""}
    ${isHost ? `<button id="cls-reset" title="${STR.hostReset}">🔄</button>` : ""}
    <button id="cls-leave">${STR.onlineLeave}</button>`;
  $("#cls-sound").onclick = () => { toggleMuted(); $("#cls-sound").textContent = soundBtnLabel(); if (!isMuted()) sfx("popup"); };
  const stp = $("#cls-stop");
  if (stp) stp.onclick = hostStopFlow;
  const rst = $("#cls-reset");
  if (rst) rst.onclick = hostResetFlow;
  $("#cls-leave").onclick = async () => {
    const ok = await showModal({ icon: "🚪", title: STR.onlineLeave + "?", buttons: [{ label: STR.yes, cls: "primary", value: true }, { label: STR.no, value: false }] });
    if (ok) location.href = location.pathname;
  };
}

// อัปเดตกระดาน: ตัวเดินของฉัน + ลูกเต๋า/ปุ่มทอยตรงกลาง (element ถาวร ไม่วาดใหม่)
function updateClassBoard(v) {
  const host = $("#cls-board-host");
  if (!host) return;
  const me = v.myself;
  // กันเหนียว: ถ้าอนิเมชันค้างเกิน 3.5 วิ (เครื่องช้า/พื้นหลังหลุด) ปลดล็อกเอง แล้วให้ snap ตำแหน่งจริง
  if (clsAnimating && Date.now() - clsAnimSince > 3500) clsAnimating = false;
  const myColor = colorOf(v.board.find((b) => b.id === v.me) || { color: 0 });
  const cturn = $("#cls-cturn"), cdice = $("#cls-cdice"), croll = $("#cls-croll");
  const rolledThisRound = me.lastRoll && me.lastRoll.r === v.round;
  const sentThisRound = clsRolledSentRound === v.round;

  if (v.stage === "roll" && !v.myRolled && !sentThisRound) {
    if (croll) {
      croll.style.display = "";
      croll.textContent = STR.classRollNow;
      croll.disabled = false;
      croll.onclick = () => { croll.disabled = true; clsRolledSentRound = v.round; sfx("dice"); window.__sendAction({ type: "croll" }); };
    }
    if (cturn) cturn.textContent = "🎲 " + STR.classStageRoll;
    if (cdice && !clsAnimating) cdice.textContent = "🎲";
  } else {
    if (croll) croll.style.display = "none";
    if (cturn) cturn.textContent = v.stage === "roll" ? "⏳ รอจบรอบ" : "🤔 ตัดสินใจ";
    if (cdice && rolledThisRound && !clsAnimating) cdice.textContent = me.lastRoll.d;
  }

  // อนิเมชันเดิน: เมื่อมีการทอยใหม่ของรอบนี้ที่ยังไม่ได้เล่นภาพ
  if (rolledThisRound && me.lastRoll.r !== clsAnimatedRoll && !clsAnimating) {
    clsAnimatedRoll = me.lastRoll.r;
    clsAnimating = true;
    clsAnimSince = Date.now();
    (async () => {
      await animateDiceEl(cdice, me.lastRoll.d);
      await animateMove(host, [{ id: v.me, color: myColor, pos: me.lastRoll.from }, ...blackToken(v)], v.me, me.lastRoll.from, me.lastRoll.d, 190);
      sfx("land");
      clsAnimating = false;
      const vv = cur && cur.view; // snap ตำแหน่งล่าสุด (เผื่อ state ขยับระหว่างอนิเมชัน)
      if (vv && vv.myself) placePawns(host, [{ id: vv.me, color: myColor, pos: vv.myself.pos }, ...blackToken(vv)], vv.me);
    })();
  } else if (!clsAnimating) {
    placePawns(host, [{ id: v.me, color: myColor, pos: me.pos }, ...blackToken(v)], v.me);
  }
}

// พาเนลข้อมูล — วาดใหม่เฉพาะเมื่อลายเซ็นเปลี่ยน (กันปุ่มตัดสินใจถูกรีเซ็ตตอนคนอื่น broadcast)
function renderClassPanel(v) {
  const panel = $("#cls-panel");
  if (!panel) return;
  const me = v.myself;
  const rank = rankBoard(v.board);
  const isHost = v.hostId === v.me;
  const medals = ["🥇", "🥈", "🥉"];

  if (!me) {
    // จอผู้ชม/ครู: อันดับสดทั้งห้อง (มีตารางเดียว อัปเดตทุกครั้ง)
    const sig = "spec:" + v.stage + ":" + rank.map((r) => r.id + r.savings + r.debt).join(",");
    if (sig === clsMainSig) return;
    clsMainSig = sig;
    panel.innerHTML = `<div class="cls-card"><b>${STR.classSpectator}</b></div>
      <div class="cls-card"><b>🏆 ${STR.classLeaderboard}</b><div class="cls-board">` +
      rank.map((r, i) => `<div class="cls-brow ${i < 3 ? "top" : ""}">
        <span class="cls-medal">${medals[i] || i + 1}</span>
        <span class="dot" style="background:${PLAYER_COLORS[r.color % PLAYER_COLORS.length].hex}"></span>
        <span class="cls-bname">${escapeHtml(r.name)}${r.shield ? " 🛡️" : ""}</span>
        <span class="cls-bsum">🐷 ${fmt(r.savings)}${r.debt > 0 ? ` ⛓️${fmt(r.debt)}` : ""}</span>
      </div>`).join("") + `</div></div>
      <div class="cls-card hint">${v.stage === "roll" ? STR.classWaitRollEnd : STR.classWaitRespondEnd}</div>`;
    return;
  }

  const myRank = rank.findIndex((r) => r.id === v.me) + 1;
  // ลายเซ็นส่วนหลัก (ไม่รวมอันดับคนอื่น) — ป้องกันการวาดปุ่มตัดสินใจใหม่ตอนเพื่อน broadcast
  const mainSig = [v.stage, v.round, me.pos, me.cash, me.savings, me.debt, me.shield,
    v.myPend ? v.myPend.kind + (v.myPend.q || "") : "", me.lastText ? me.lastText.length + (me.lastQuiz ? "q" : "") : "",
    v.myRolled, clsShowHistory].join("|");

  if (mainSig !== clsMainSig) {
    clsMainSig = mainSig;
    let html = "";
    // (ตำแหน่งปัจจุบันย้ายไปแสดงเหนือกระดานแล้ว — ดู updateClassPos)
    // การตัดสินใจ / ผลรอบนี้
    if (v.stage === "respond" && v.myPend) {
      html += `<div class="cls-card cls-pend" id="cls-pend"></div>`;
    } else if (v.stage === "respond" && !v.myPend) {
      html += renderClassResult(me) + `<div class="cls-card hint">${STR.classWaitRespondEnd}</div>`;
    } else if (v.stage === "roll" && me.lastText && !v.myRolled && me.lastRoll && me.lastRoll.r === v.round - 1) {
      html += renderClassResult(me); // ต้นรอบใหม่ โชว์ผลรอบก่อน
    }
    // เงินของฉัน
    html += `<div class="cls-card cls-money">
      <span class="cash">${fmt(me.cash)}</span><span class="sav">${fmt(me.savings)}</span>
      ${me.debt > 0 ? `<span class="debt">${fmt(me.debt)}</span>` : ""}${me.shield ? `<span>🛡️</span>` : ""}</div>`;
    // อันดับ (ช่องแยก อัปเดตต่างหาก)
    html += `<div class="cls-card"><b>🏆 ${STR.classLeaderboard}</b> <span class="hint" id="cls-myrank"></span><div class="cls-board" id="cls-rank"></div></div>`;
    // ประวัติกิจกรรม
    html += `<div class="cls-card"><button id="cls-hist-toggle" class="ghost">📒 ${STR.classHistory} ${clsShowHistory ? "▲" : "▼"}</button>
      ${clsShowHistory ? `<div class="cls-hist">` + [...v.myHistory].reverse().map((e) =>
        `<div class="cls-hrow"><span class="hint">ร.${e.r}</span> ${e.label}
         <span class="${e.amt > 0 ? "pos" : e.amt < 0 ? "neg" : ""}">${e.amt === 0 ? "" : (e.amt > 0 ? "+" : "−") + fmt(Math.abs(e.amt))}</span></div>`).join("") + `</div>` : ""}</div>`;
    if (!isHost) html += `<button id="cls-claim" class="ghost" style="font-size:.85em">${STR.claimHost}</button>`;
    panel.innerHTML = html;
    const clBtn = $("#cls-claim");
    if (clBtn) clBtn.onclick = claimHostFlow;
    const ht = $("#cls-hist-toggle");
    if (ht) ht.onclick = () => { clsShowHistory = !clsShowHistory; clsMainSig = ""; renderClassPanel(cur.view); };
    if (v.stage === "respond" && v.myPend) renderClassPend(v);
    clsRankSig = ""; // บังคับวาดอันดับใหม่หลังสร้างช่อง
  }

  // อันดับ (ย่อ: 3 อันดับแรก + ฉัน) — อัปเดตแยกเมื่อยอดเปลี่ยน
  const rankSig = rank.slice(0, 3).map((r) => r.id + r.savings).join(",") + "|" + myRank + ":" + me.savings;
  const rankBox = $("#cls-rank");
  if (rankBox && rankSig !== clsRankSig) {
    clsRankSig = rankSig;
    const myrankEl = $("#cls-myrank");
    if (myrankEl) myrankEl.textContent = STR.classMyRank(myRank, rank.length);
    rankBox.innerHTML = rank.slice(0, 3).map((r, i) => `<div class="cls-brow top ${r.id === v.me ? "meline" : ""}">
        <span class="cls-medal">${medals[i]}</span>
        <span class="dot" style="background:${PLAYER_COLORS[r.color % PLAYER_COLORS.length].hex}"></span>
        <span class="cls-bname">${escapeHtml(r.name)}</span>
        <span class="cls-bsum">🐷 ${fmt(r.savings)}</span></div>`).join("") +
      (myRank > 3 ? `<div class="cls-brow meline"><span class="cls-medal">${myRank}</span>
        <span class="dot" style="background:${PLAYER_COLORS[rank[myRank - 1].color % PLAYER_COLORS.length].hex}"></span>
        <span class="cls-bname">${escapeHtml(rank[myRank - 1].name)}</span>
        <span class="cls-bsum">🐷 ${fmt(me.savings)}</span></div>` : "");
  }
}

function renderClassResult(me) {
  if (!me.lastText) return "";
  let html = `<div class="cls-card cls-result"><b>✨ ${STR.classResult}</b>`;
  if (me.lastCard) html += `<div class="lb-card">${me.lastCard.icon} <b>${me.lastCard.t}</b> — ${me.lastCard.d}</div>`;
  html += me.lastText.map((it) => `<div class="lb-item">${it.icon} ${it.text}</div>`).join("");
  if (me.lastQuiz) {
    const qz = me.lastQuiz;
    html += `<div class="lb-quiz">${qz.ok ? "🎉 ตอบถูก!" : "🤔 ยังไม่ถูก"} เฉลย: ${"กขคง"[qz.correct]}. ${qz.correctText}<br><span class="hint">💡 ${qz.x}</span></div>`;
  }
  return html + `</div>`;
}

// การ์ดตัดสินใจของฉัน (ช่วง respond) — ปุ่มส่ง action ตรงตามชนิด
function renderClassPend(v) {
  const pd = v.myPend;
  const box = $("#cls-pend");
  if (!box) return;
  const send = (action) => { box.querySelectorAll("button").forEach((b) => (b.disabled = true)); window.__sendAction(action); };
  let inner = "";
  if (pd.kind === "quiz") {
    inner = `<b>📖 ${STR.quizCard}</b><div class="card-face"><b>${pd.q}</b></div>
      <div class="hint">ตอบถูกรับ ${fmt(pd.reward)} บาทเข้าเงินออม</div>
      <div class="quiz-choices">${pd.c.map((c, i) => `<button data-a="${i}">${"กขคง"[i]}. ${c}</button>`).join("")}</div>`;
  } else if (pd.kind === "alloc") {
    const q = Math.round(pd.rest / 4 / 100) * 100;
    const h = Math.round(pd.rest / 2 / 100) * 100;
    const opts = [[pd.rest, `${STR.allocAll} (${fmt(pd.rest)})`, "primary"], [h, `${STR.allocHalf} (${fmt(h)})`, ""], [q, `${STR.allocQuarter} (${fmt(q)})`, ""], [0, STR.allocNone, ""]]
      .filter(([val], i, arr) => arr.findIndex((z) => z[0] === val) === i);
    inner = `<b>${pd.icon || "💰"} ${STR.allocTitle(fmt(pd.amount))}</b>
      ${pd.paidDebt > 0 ? `<div class="note bad">${STR.debtPaid(fmt(pd.paidDebt))}</div>` : ""}
      <div class="desc">${escapeHtml(pd.title)} — ${STR.allocAsk}</div>
      <div class="btns">${opts.map(([val, label, cls]) => `<button class="${cls}" data-s="${val}">${label}</button>`).join("")}</div>`;
  } else if (pd.kind === "invest") {
    inner = `<b>📈 ${STR.investTitle}</b><div class="desc">${STR.investAsk}</div>
      <div class="btns">${pd.options.map((vv, i) => `<button data-v="${vv}" class="${i === pd.options.length - 1 ? "primary" : ""}">ลงทุน ${fmt(vv)}</button>`).join("")}
      <button data-v="0">${STR.investNone}</button></div>`;
  } else if (pd.kind === "choice") {
    const desc = pd.sub === "match"
      ? `ฝาก ${fmt(pd.amount)} บาท ธนาคารสมทบอีก ${fmt(pd.amount)} บาท!`
      : `ลงทุน ${fmt(pd.cost)} บาท ทอยเต๋าได้ ${pd.needRoll} ขึ้นไป รับ ${fmt(pd.prize)} บาท`;
    inner = `<b>${pd.icon} ${pd.title}</b><div class="desc">${desc}</div>
      <div class="btns horiz"><button class="primary" data-y="1">${STR.yes}</button><button data-y="0">${STR.no}</button></div>`;
  }
  box.innerHTML = inner;
  box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => send({ type: "answer", i: +b.dataset.a })));
  box.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => send({ type: "alloc", save: +b.dataset.s })));
  box.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => send({ type: "invest", amount: +b.dataset.v })));
  box.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => send({ type: "choice", yes: b.dataset.y === "1" })));
}
