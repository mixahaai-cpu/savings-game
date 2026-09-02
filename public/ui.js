// ส่วน UI ที่ใช้ร่วมกันระหว่างโหมดเล่นเครื่องเดียว (game.js) และโหมดออนไลน์ (online.js)
// - สร้างบอร์ด 23 ช่อง + เลเยอร์ตัวเดินแบบอนิเมชัน (เลื่อน + กระโดดทีละช่อง)
// - โมดัล/โทสต์ + เอฟเฟกต์กดปุ่มทุกปุ่ม
import { BOARD } from "./data.js";

export const fmt = (n) => Math.round(n).toLocaleString("th-TH");
export const $ = (sel) => document.querySelector(sel);

/* ---------- โมดัล (Promise-based) ---------- */
export let modalOpen = false;
export function showModal({ icon, title, bodyHTML, buttons, buildBody }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "modal-overlay";
    const m = document.createElement("div");
    m.className = "modal";
    if (title) m.innerHTML = `<h3>${title}</h3>`;
    if (icon) m.insertAdjacentHTML("beforeend", `<div class="big-icon">${icon}</div>`);
    if (bodyHTML) m.insertAdjacentHTML("beforeend", bodyHTML);
    const close = (v) => { overlay.remove(); modalOpen = false; resolve(v); };
    if (buildBody) buildBody(m, close);
    if (buttons && buttons.length) {
      const wrap = document.createElement("div");
      wrap.className = "btns" + (buttons.length > 1 && buttons.every(b => (b.label || "").length <= 14) ? " horiz" : "");
      for (const b of buttons) {
        const btn = document.createElement("button");
        btn.textContent = b.label;
        if (b.cls) btn.className = b.cls;
        if (b.disabled) btn.disabled = true;
        btn.addEventListener("click", () => close(b.value));
        wrap.appendChild(btn);
      }
      m.appendChild(wrap);
    }
    overlay.appendChild(m);
    document.body.appendChild(overlay);
    modalOpen = true;
  });
}
export const infoModal = (icon, title, bodyHTML, btnLabel = "ไปต่อ") =>
  showModal({ icon, title, bodyHTML, buttons: [{ label: btnLabel, cls: "primary", value: true }] });

// หน้าผู้จัดทำ (รายชื่อคณะผู้จัดทำ) — ใช้ได้ทั้งเมนูเครื่องเดียวและล็อบบี้ออนไลน์
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function showCredits(credits, closeLabel = "ปิด") {
  const rows = credits.people.map((p, i) =>
    `<div class="credit-row"><span class="credit-no">${i + 1}</span><span class="credit-name">${esc(p.name)}</span>${p.id ? `<span class="credit-id">${esc(p.id)}</span>` : ""}</div>`
  ).join("");
  const body = `<div class="credit-org"><b>${esc(credits.org)}</b><div class="hint">${esc(credits.major || "")}</div></div>
    <div class="credit-list">${rows}</div>`;
  return showModal({ icon: "👥", title: "คณะผู้จัดทำ", bodyHTML: body, buttons: [{ label: closeLabel, cls: "primary", value: true }] });
}

export function toast(msg, ms = 1800) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------- บอร์ด ---------- */
export function cellGridPos(i) {
  if (i <= 7) return [1, i + 1];
  if (i <= 11) return [i - 6, 8];
  if (i <= 19) return [6, 8 - (i - 12)];
  return [5 - (i - 20), 1]; // 20→r5, 21→r4, 22→r3
}

// centerHTML: ปรับเนื้อกลางบอร์ดได้ (โหมดทั้งห้องส่ง markup แบบ scoped ด้วย class กันชน id ซ้ำ)
export function buildBoard(boardEl, rollLabel, centerHTML) {
  boardEl.innerHTML = "";
  const center = document.createElement("div");
  center.className = "board-center";
  center.style.backgroundImage = "url(./assets/bg_board.webp)";
  center.innerHTML = centerHTML != null ? centerHTML : `<div class="center-ui">
    <div class="turn-label" id="turn-label"></div>
    <div class="dice" id="dice">🎲</div>
    <button id="roll-btn" class="primary">${rollLabel}</button>
  </div>`;
  boardEl.appendChild(center);
  BOARD.forEach((cell, i) => {
    const el = document.createElement("div");
    el.className = `cell t-${cell.type}`;
    el.id = "cell-" + i;
    const [r, c] = cellGridPos(i);
    el.style.gridRow = r; el.style.gridColumn = c;
    const amt = cell.amount ? `<span class="amt ${cell.type === "expense" ? "neg" : "pos"}">${cell.type === "expense" ? "−" : "+"}${fmt(cell.amount)}</span>` : "";
    el.innerHTML = `<span class="num">${cell.n || ""}</span><span class="icon">${cell.icon}</span><span class="nm">${cell.name}</span>${amt}`;
    boardEl.appendChild(el);
  });
  const decor = document.createElement("div");
  decor.className = "cell decor";
  decor.style.gridRow = 2; decor.style.gridColumn = 1;
  decor.textContent = "🐷";
  boardEl.appendChild(decor);
  const layer = document.createElement("div");
  layer.className = "pawn-layer";
  boardEl.appendChild(layer);
}

/* ---------- ตัวเดิน: เลเยอร์ absolute + เลื่อนลื่น + เด้งตอนก้าว ---------- */
// pawns: [{id, color, pos}] — วางทุกตัวตามตำแหน่ง จัดเรียงไม่ทับกันในช่องเดียว
export function placePawns(boardEl, pawns, activePid) {
  const layer = boardEl.querySelector(".pawn-layer");
  if (!layer) return;
  const seen = new Set();
  const byCell = {};
  for (const p of pawns) (byCell[p.pos] = byCell[p.pos] || []).push(p);
  for (const [pos, group] of Object.entries(byCell)) {
    const cell = boardEl.querySelector("#cell-" + pos);
    if (!cell) continue;
    group.forEach((p, i) => {
      seen.add(p.id);
      let el = layer.querySelector(`[data-pid="${p.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "pawn" + (p.id === "__black" ? " black-pawn" : "");
        el.dataset.pid = p.id;
        el.style.background = p.color;
        layer.appendChild(el);
      }
      const pw = el.offsetWidth || 12;
      const cols = Math.min(group.length, 3);
      const col = i % 3, row = Math.floor(i / 3);
      const x = cell.offsetLeft + cell.offsetWidth * ((col + 1) / (cols + 1)) - pw / 2;
      const y = cell.offsetTop + cell.offsetHeight * (row === 0 ? 0.66 : 0.84) - pw / 2;
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.classList.toggle("me-turn", p.id === activePid);
    });
  }
  for (const el of [...layer.children]) if (!seen.has(el.dataset.pid)) el.remove();
  boardEl.querySelectorAll(".cell.active").forEach((el) => el.classList.remove("active"));
  const act = pawns.find((p) => p.id === activePid);
  if (act) boardEl.querySelector("#cell-" + act.pos)?.classList.add("active");
}

// อนิเมชันเดินทีละช่อง: อัปเดตตำแหน่ง pawn ตัวเดียวเป็นสเต็ป พร้อมคลาส hop ให้เด้ง
export async function animateMove(boardEl, pawns, movingPid, from, steps, stepMs = 260) {
  const layer = boardEl.querySelector(".pawn-layer");
  const el = layer && layer.querySelector(`[data-pid="${movingPid}"]`);
  const list = pawns.map((p) => ({ ...p }));
  const mover = list.find((p) => p.id === movingPid);
  if (!mover) return;
  mover.pos = from;
  placePawns(boardEl, list, movingPid);
  await sleep(60);
  for (let i = 1; i <= steps; i++) {
    mover.pos = (from + i) % BOARD.length;
    if (el) {
      el.classList.remove("hop");
      void el.offsetWidth;
      el.classList.add("hop");
    }
    placePawns(boardEl, list, movingPid);
    await sleep(stepMs);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// อนิเมชันทอยเต๋าบน element ที่ระบุ: สุ่มหน้าไปเรื่อย ๆ แล้วหยุดที่ค่าจริง
export async function animateDiceEl(diceEl, finalValue) {
  if (!diceEl) return;
  diceEl.classList.add("rolling");
  for (let t = 0; t < 8; t++) {
    diceEl.textContent = 1 + Math.floor(Math.random() * 6);
    await sleep(80);
  }
  diceEl.classList.remove("rolling");
  diceEl.textContent = finalValue;
  diceEl.classList.remove("landed");
  void diceEl.offsetWidth;
  diceEl.classList.add("landed");
}
export const animateDice = (finalValue) => animateDiceEl($("#dice"), finalValue);
