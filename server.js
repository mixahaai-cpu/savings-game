// server.js — เซิร์ฟเวอร์รันเกม "วางแผนดี ชีวิตมีเงินเก็บ" แบบไม่ต้องพึ่ง Higgsfield
// แทน "kernel" ของแพลตฟอร์ม: เสิร์ฟไฟล์ static + จัดการห้อง WebSocket + ขับ logic.js
//
// โปรโตคอล (ตรงกับที่ public/online.js ใช้):
//   client → server : {type:"join", playerId} | {type:"action", action} | {type:"ping"} | {type:"reset"}
//   server → client : {type:"state", status:"playing", view:<viewFor>} | {type:"error", error}
//
// รัน:  node server.js           (พอร์ตเริ่มต้น 3000)
//       PORT=8080 node server.js (กำหนดพอร์ตเอง)
// เปิด: http://localhost:3000/   (สร้างห้องแล้วแชร์ลิงก์ ?room=... ให้เพื่อน/นักเรียน)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { WebSocketServer } from "ws";
import * as game from "./public/logic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;

/* ---------- เสิร์ฟไฟล์ static จาก public/ ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  // ตัด query ออก แล้ว default "/" → index.html
  let urlPath = decodeURIComponent((req.url.split("?")[0]) || "/");
  if (urlPath === "/") urlPath = "/index.html";
  // กัน path traversal: normalize แล้วต้องอยู่ใต้ PUBLIC เท่านั้น
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // ไฟล์ไม่เจอ → คืน index.html (เผื่อ client-side routing / เปิดตรง ?room=)
      fs.readFile(path.join(PUBLIC, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); res.end("Not found"); }
        else { res.writeHead(200, { "Content-Type": MIME[".html"] }); res.end(html); }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

/* ---------- ห้องเกม + WebSocket ---------- */
// rooms: roomId -> { state, clients:Map<ws,playerId> }
const rooms = new Map();

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) { r = { state: null, clients: new Map() }; rooms.set(id, r); }
  return r;
}

function broadcast(room) {
  const s = room.state;
  for (const [ws, pid] of room.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    let view = null;
    try { view = game.viewFor(s, pid); } catch (e) { continue; }
    ws.send(JSON.stringify({ type: "state", status: "playing", view }));
  }
}

function sendState(ws, room) {
  if (ws.readyState !== ws.OPEN) return;
  let view = null;
  try { view = game.viewFor(room.state, ws.__pid); } catch (e) { return; }
  ws.send(JSON.stringify({ type: "state", status: "playing", view }));
}

function sendError(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", error: msg }));
}

// รีเซ็ตห้องเป็นล็อบบี้ว่าง — คงเจ้าของห้อง/โหมด/จำนวนรอบไว้ (เหมือนปุ่ม "เล่นอีกครั้ง")
function resetState(old) {
  const fresh = game.setup(old && old.ownerId ? [old.ownerId] : []);
  if (old) { fresh.mode = old.mode; fresh.rounds = old.rounds; fresh.ownerId = old.ownerId; }
  return fresh;
}

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // path ต้องเป็น /ws/<room>
  const m = (req.url || "").split("?")[0].match(/\/ws\/([^/]+)\/?$/);
  if (!m) { socket.destroy(); return; }
  const roomId = decodeURIComponent(m[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.__roomId = roomId;
    ws.__pid = null;
    const room = getRoom(roomId);
    room.clients.set(ws, null);

    ws.on("message", (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch (e) { return; }

      if (msg.type === "join") {
        ws.__pid = String(msg.playerId || "").slice(0, 40) || ("p-" + Math.random().toString(36).slice(2, 10));
        room.clients.set(ws, ws.__pid);
        // ห้องใหม่ → คนแรกที่ต่อเป็นเจ้าของห้อง (โหมดทั้งห้อง = จอมอนิเตอร์)
        if (!room.state) room.state = game.setup([ws.__pid]);
        sendState(ws, room);
        return;
      }

      if (!ws.__pid || !room.state) return; // ต้อง join ก่อน

      if (msg.type === "action") {
        const action = msg.action;
        if (!action || typeof action.type !== "string") return;
        const v = game.validateAction(room.state, ws.__pid, action);
        if (!v.ok) { sendError(ws, v.error || "คำสั่งไม่ถูกต้อง"); return; }
        room.state = game.applyAction(room.state, ws.__pid, action);
        broadcast(room);
        return;
      }

      if (msg.type === "ping") {
        // ชีพจรหัวหน้าห้อง — apply เป็น action ให้ hostSeen อัปเดต (เงียบถ้าไม่ผ่าน)
        const v = game.validateAction(room.state, ws.__pid, { type: "ping" });
        if (v.ok) { room.state = game.applyAction(room.state, ws.__pid, { type: "ping" }); }
        return;
      }

      if (msg.type === "reset") {
        room.state = resetState(room.state);
        broadcast(room);
        return;
      }
    });

    ws.on("close", () => {
      room.clients.delete(ws);
      // ห้องว่าง (ไม่มีใครต่อ) → ลบทิ้งกันหน่วยความจำรั่ว
      if (room.clients.size === 0) rooms.delete(roomId);
    });

    ws.on("error", () => {});
  });
});

/* ---------- start ---------- */
function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log("🎲 วางแผนดี ชีวิตมีเงินเก็บ — เซิร์ฟเวอร์ทำงานแล้ว");
  console.log("   เครื่องนี้:      http://localhost:" + PORT + "/");
  for (const ip of lanIPs()) console.log("   ในวง LAN/WiFi:  http://" + ip + ":" + PORT + "/   (นักเรียนสแกน/เปิดลิงก์นี้)");
  console.log("   วิธีเล่น: เปิดหน้าแรก → กด 'เล่นออนไลน์' สร้างห้อง → แชร์ QR/ลิงก์ ?room=... ให้ทุกคน");
});
