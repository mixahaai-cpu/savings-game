// ระบบเสียงสังเคราะห์ทั้งหมดด้วย WebAudio — ไม่มีไฟล์เสียง/CDN (เกม self-contained)
// นโยบายกันเสียงตีกันในห้องเรียน:
//   จอมอนิเตอร์ (ครู/ลำโพง) = เพลง BGM + เอฟเฟกต์ (default เปิด)
//   มือถือนักเรียน = เอฟเฟกต์เท่านั้น (default ปิด — เปิดเองได้ด้วยปุ่ม 🔊)
//   เครื่องเดียว/กลุ่มเล็ก = BGM + เอฟเฟกต์ (default เปิด)

let ctx = null, master = null, bgmGain = null;
let bgmTimer = null, bgmWanted = false, bgmNextTime = 0, bgmStep = 0;
let role = "local";            // local | player | monitor
let muted = true;

const PREF = (r) => "wangplandee.snd." + r;
const DEFAULT_ON = { local: true, monitor: true, player: false };

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.16;
    bgmGain.connect(master);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx.state !== "closed";
}

// ปลดล็อกเสียงด้วย gesture แรก (นโยบาย autoplay ของเบราว์เซอร์) — ติดตั้งครั้งเดียว
export function installSoundUnlock() {
  document.addEventListener("pointerdown", () => {
    if (muted) return;
    if (ensureCtx() && bgmWanted && !bgmTimer) startBgmLoop();
  }, { capture: true });
}

export function setSoundRole(r) {
  role = r;
  const saved = localStorage.getItem(PREF(r));
  muted = saved != null ? saved === "off" : !DEFAULT_ON[r];
}
export function isMuted() { return muted; }
export function toggleMuted() {
  muted = !muted;
  localStorage.setItem(PREF(role), muted ? "off" : "on");
  if (muted) stopBgm(false); // หยุดเสียงแต่จำไว้ว่าเพลงยังถูกขอ (bgmWanted คงเดิม)
  else if (bgmWanted) { if (ensureCtx()) startBgmLoop(); }
  return muted;
}

/* ---------- เอฟเฟกต์ ---------- */
function tone(freq, t0, dur, { type = "triangle", vol = 0.25, slide = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export function sfx(name) {
  if (muted || !ensureCtx()) return;
  const t = ctx.currentTime + 0.01;
  switch (name) {
    case "dice":      // เต๋ากระทบ 5 ติ๊ก
      for (let i = 0; i < 5; i++) tone(250 + Math.random() * 500, t + i * 0.055, 0.05, { type: "square", vol: 0.12 });
      break;
    case "land":      // ตกลงช่อง
      tone(320, t, 0.12, { slide: 200, vol: 0.2 }); break;
    case "coin":      // ได้เงิน
      tone(880, t, 0.09, { type: "sine", vol: 0.22 });
      tone(1318, t + 0.09, 0.14, { type: "sine", vol: 0.22 });
      break;
    case "bad":       // เสียเงิน/แย่
      tone(300, t, 0.28, { type: "sawtooth", vol: 0.16, slide: -160 }); break;
    case "correct":   // ตอบถูก C-E-G
      [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.09, 0.14, { type: "triangle", vol: 0.22 }));
      break;
    case "wrong":     // ตอบผิด
      tone(140, t, 0.22, { type: "square", vol: 0.14 });
      tone(110, t + 0.18, 0.28, { type: "square", vol: 0.14 });
      break;
    case "popup":     // ป๊อปอัปเด้ง
      tone(620, t, 0.07, { type: "sine", vol: 0.14 }); break;
    case "win":       // จบเกม/แฟนแฟร์
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.13, i === 3 ? 0.5 : 0.15, { type: "triangle", vol: 0.24 }));
      break;
    case "start":     // เริ่มเกม
      [392, 523, 659].forEach((f, i) => tone(f, t + i * 0.1, 0.16, { type: "triangle", vol: 0.2 }));
      break;
  }
}

/* ---------- เพลง Background (ลูปสังเคราะห์ C เพนทาโทนิก สบาย ๆ) ---------- */
const N = { C4: 262, D4: 294, E4: 330, G4: 392, A4: 440, C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, C3: 131, G3: 196, A3: 220, F3: 175 };
const MELODY = [
  N.E5, 0, N.G5, N.E5, N.D5, 0, N.C5, 0, N.A4, 0, N.C5, N.D5, N.E5, 0, N.D5, 0,
  N.C5, 0, N.E5, N.G5, N.A5, 0, N.G5, 0, N.E5, 0, N.D5, N.C5, N.A4, 0, N.C5, 0,
];
const BASS = [
  N.C3, 0, 0, 0, N.G3, 0, 0, 0, N.A3, 0, 0, 0, N.G3, 0, 0, 0,
  N.C3, 0, 0, 0, N.G3, 0, 0, 0, N.F3, 0, 0, 0, N.G3, 0, 0, 0,
];
const STEP_DUR = 0.24; // ~125 BPM (จังหวะเขบ็ตหนึ่งชั้น)

function scheduleBgmStep(t, i) {
  const m = MELODY[i % MELODY.length];
  const b = BASS[i % BASS.length];
  if (m) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = m;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 0.95);
    o.connect(g); g.connect(bgmGain);
    o.start(t); o.stop(t + STEP_DUR);
  }
  if (b) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = b;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 3.6);
    o.connect(g); g.connect(bgmGain);
    o.start(t); o.stop(t + STEP_DUR * 4);
  }
}
function startBgmLoop() {
  if (bgmTimer) return;
  bgmNextTime = ctx.currentTime + 0.1;
  bgmStep = 0;
  bgmTimer = setInterval(() => {
    if (!ctx || muted) return;
    while (bgmNextTime < ctx.currentTime + 0.6) { // จองล่วงหน้า 0.6 วิ
      scheduleBgmStep(bgmNextTime, bgmStep++);
      bgmNextTime += STEP_DUR;
    }
  }, 200);
}
export function bgmStart() {
  bgmWanted = true;
  if (muted) return;
  if (ensureCtx()) startBgmLoop();
}
export function bgmStop() { stopBgm(true); }
function stopBgm(clearWanted) {
  if (clearWanted) bgmWanted = false;
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
}

// สำหรับตรวจสอบอัตโนมัติ
export function _sndDebug() {
  return { role, muted, bgmWanted, bgmRunning: !!bgmTimer, ctxState: ctx ? ctx.state : "none" };
}
