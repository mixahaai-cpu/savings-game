// ทดสอบเกมอัตโนมัติ: สร้างหัวหน้าห้อง 1 + ผู้เล่นบอท N คน เล่นจนจบ แล้วสรุปผล
// รันในโปรเซสเดียว (ใช้ WebSocket ในตัวของ Node 21+)
//
//   node test/run-test.mjs                         # ค่าเริ่มต้น: class 12 รอบ 3 ผู้เล่น
//   node test/run-test.mjs --mode class --rounds 20 --players 6
//   node test/run-test.mjs --mode turns --rounds 12 --players 3
//   node test/run-test.mjs --url http://localhost:8734/   # (โหมดออนไลน์ต้องมี WS kernel — ใช้ URL ที่ deploy แล้ว)

import { Bot } from "./bot.mjs";

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2), next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) o[k] = true;
    else { o[k] = next; i++; }
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const url = a.url || undefined;
  const mode = a.mode || "class";
  const rounds = a.rounds ? Number(a.rounds) : 12;
  const nPlayers = a.players ? Number(a.players) : 3;
  const room = a.room || "auto-" + Math.random().toString(36).slice(2, 7);
  const verbose = a.verbose === true || a.verbose === "true";

  console.log(`\n🎮 ทดสอบ: mode=${mode} rounds=${rounds} players=${nPlayers} room=${room}`);
  console.log(`   ${url || "https://elegant-gnome-812.higgsfield.gg/"}\n`);

  let done = false;
  const finish = (view) => {
    if (done) return;
    done = true;
    console.log("\n=== ✅ จบเกม — อันดับ ===");
    const rank = (view && view.ranking) || [];
    if (!rank.length) console.log("  (ไม่มีข้อมูลอันดับใน view)");
    rank.forEach((r, i) => {
      const net = (r.savings || 0) + (r.cash || 0) - (r.debt || 0);
      console.log(`  ${i + 1}. ${r.name.padEnd(10)} ออม=${String(r.savings).padStart(6)} สด=${String(r.cash).padStart(6)} หนี้=${String(r.debt).padStart(5)}  (รวมสุทธิ=${net})`);
    });
    setTimeout(() => process.exit(0), 500);
  };

  // หัวหน้าห้อง (ต่อคนแรกเสมอ = ownerId) — class: เป็นมอนิเตอร์+ดันเกม / turns: เล่นด้วย
  const host = new Bot({ baseUrl: url, room, name: "ครู", host: true, start: true, mode, rounds, verbose, onEnd: finish });
  await host.connect();
  await sleep(800); // ให้ host จองตำแหน่ง owner ก่อน

  const players = [];
  for (let i = 0; i < nPlayers; i++) {
    const b = new Bot({ baseUrl: url, room, name: "บอท" + (i + 1), mode, verbose, onEnd: finish });
    players.push(b);
    await b.connect();
    await sleep(250);
  }

  // รอให้ทุกคนนั่งครบ (turns: หัวหน้านั่งด้วย +1) แล้วหัวหน้าเริ่มเกม
  const expected = nPlayers + (mode === "turns" ? 1 : 0);
  const deadline = now() + 12000;
  while (now() < deadline) {
    const roster = (host._lastView && host._lastView.roster) || [];
    if (roster.length >= expected) break;
    await sleep(300);
  }
  const rosterN = ((host._lastView && host._lastView.roster) || []).length;
  console.log(`👥 นั่งแล้ว ${rosterN}/${expected} คน`);
  if (!host.began) {
    host.began = true;
    host.act({ type: "begin" });
    console.log("▶️  หัวหน้าเริ่มเกม\n");
  }

  // กันค้าง: timeout รวม
  const maxMs = 1000 * 60 * Math.max(4, rounds * (mode === "class" ? 1.2 : 2));
  setTimeout(() => {
    if (!done) { console.error(`\n⏱️  หมดเวลาทดสอบ (${Math.round(maxMs / 1000)}s) — เกมยังไม่จบ`); process.exit(2); }
  }, maxMs);
}

main().catch((e) => { console.error("test error:", e); process.exit(1); });
