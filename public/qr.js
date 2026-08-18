// QR code generator แบบ self-contained (byte mode) — ไม่พึ่ง CDN/ไลบรารีภายนอก
// อิงอัลกอริทึมจาก Nayuki "QR Code generator" (public domain) เขียนใหม่ให้คืน matrix
// ใช้แปลงลิงก์ห้องเป็น QR ให้นักเรียนสแกนเข้าเล่น — ตรวจความถูกต้องเทียบไลบรารี qrcode แล้ว
// ตรวจสอบ: scratchpad/qr-verify.mjs (เทียบทุกเวอร์ชัน/ระดับ ECC)

// ---- GF(256) คูณ (พหุนามปฐมฐาน 0x11d) ----
function gmul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

// ---- Reed–Solomon ----
function rsDivisor(degree) {
  const result = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gmul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gmul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= gmul(divisor[i], factor);
  }
  return result;
}

// ---- ตารางจำนวน EC codeword ต่อบล็อก และจำนวนบล็อก (เวอร์ชัน 1–40 × ระดับ L/M/Q/H) ----
const ECC_CW_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
];
const NUM_EC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
];
// ระดับ ECC: {ordinal(index ตาราง), formatBits}
const ECC = {
  L: { o: 0, f: 1 }, M: { o: 1, f: 0 }, Q: { o: 2, f: 3 }, H: { o: 3, f: 2 },
};

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
function numDataCodewords(ver, ecl) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CW_PER_BLOCK[ecl.o][ver] * NUM_EC_BLOCKS[ecl.o][ver];
}

function alignPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---- สร้างสตรีมบิตจากข้อความ (byte mode) เลือกเวอร์ชันเล็กสุดที่พอ ----
function makeCodewords(text, ecl, minVer, maxVer) {
  const bytes = Array.from(new TextEncoder().encode(text)); // UTF-8 bytes
  let ver = minVer;
  for (; ; ver++) {
    const cap = numDataCodewords(ver, ecl) * 8;
    const ccBits = ver <= 9 ? 8 : ver <= 26 ? 16 : 16;
    const need = 4 + ccBits + bytes.length * 8;
    if (need <= cap) break;
    if (ver >= maxVer) throw new Error("ข้อความยาวเกินไปสำหรับ QR");
  }
  const size = ver * 4 + 17;
  const dataCw = numDataCodewords(ver, ecl);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4); // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  // terminator + pad ให้ครบ codeword
  const capBits = dataCw * 8;
  push(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  for (let pad = 0xEC; cw.length < dataCw; pad ^= 0xEC ^ 0x11) cw.push(pad);
  return { ver, size, cw };
}

// ---- ใส่ EC + interleave ----
function addEccInterleave(data, ver, ecl) {
  const numBlocks = NUM_EC_BLOCKS[ecl.o][ver];
  const ecLen = ECC_CW_PER_BLOCK[ecl.o][ver];
  const rawCw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortLen = Math.floor(rawCw / numBlocks) - ecLen;
  const blocks = [];
  const divisor = rsDivisor(ecLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ec = rsRemainder(dat, divisor);
    blocks.push({ dat, ec });
  }
  const result = [];
  const maxDat = shortLen + 1;
  for (let i = 0; i < maxDat; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < blocks[b].dat.length) result.push(blocks[b].dat[i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < numBlocks; b++) result.push(blocks[b].ec[i]);
  }
  return result;
}

// ---- วาด matrix ----
function buildMatrix(text, level, opts) {
  const ecl = ECC[level] || ECC.M;
  const { ver, size, cw } = makeCodewords(text, ecl, (opts && opts.minVer) || 1, 40);
  const codewords = addEccInterleave(cw, ver, ecl);

  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  // finder + separator
  function finder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  // timing
  for (let i = 0; i < size; i++) {
    if (!isFn[6][i]) set(i, 6, i % 2 === 0);
    if (!isFn[i][6]) set(6, i, i % 2 === 0);
  }

  // alignment
  const ap = alignPositions(ver);
  for (const ay of ap) for (const ax of ap) {
    if ((ay <= 8 && ax <= 8) || (ay <= 8 && ax >= size - 9) || (ay >= size - 9 && ax <= 8)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // reserve format info areas
  for (let i = 0; i < 9; i++) { if (!isFn[i][8]) set(8, i, false); if (!isFn[8][i]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
  set(8, size - 8, true); // dark module

  // reserve version info (>=7)
  if (ver >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, false); set(b, a, false);
    }
  }

  // place data (zigzag)
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  const getBit = () => (bitIdx < totalBits ? (codewords[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1 : 0);
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn[y][x]) continue;
        modules[y][x] = getBit() === 1;
        bitIdx++;
      }
    }
  }

  // masks
  const maskFn = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];

  function applyMask(m) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!isFn[y][x] && maskFn[m](x, y)) modules[y][x] = !modules[y][x];
    }
  }
  function drawFormat(m) {
    const data = (ecl.f << 3) | m;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) modules[i][8] = ((bits >>> i) & 1) !== 0;
    modules[7][8] = ((bits >>> 6) & 1) !== 0;
    modules[8][8] = ((bits >>> 7) & 1) !== 0;
    modules[8][7] = ((bits >>> 8) & 1) !== 0;
    for (let i = 9; i < 15; i++) modules[8][14 - i] = ((bits >>> i) & 1) !== 0;
    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = ((bits >>> i) & 1) !== 0;
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = ((bits >>> i) & 1) !== 0;
    modules[size - 8][8] = true;
  }
  function drawVersion() {
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      modules[b][a] = bit; modules[a][b] = bit;
    }
  }

  function penalty() {
    let p = 0;
    // rule 1: แถว/คอลัมน์ที่สีเดียวกันติดกัน >=5
    for (let y = 0; y < size; y++) {
      let runC = modules[y][0], runL = 1;
      for (let x = 1; x < size; x++) {
        if (modules[y][x] === runC) { runL++; if (runL === 5) p += 3; else if (runL > 5) p++; }
        else { runC = modules[y][x]; runL = 1; }
      }
    }
    for (let x = 0; x < size; x++) {
      let runC = modules[0][x], runL = 1;
      for (let y = 1; y < size; y++) {
        if (modules[y][x] === runC) { runL++; if (runL === 5) p += 3; else if (runL > 5) p++; }
        else { runC = modules[y][x]; runL = 1; }
      }
    }
    // rule 2: บล็อก 2x2 สีเดียวกัน
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) p += 3;
    }
    // rule 3: pattern 1:1:3:1:1 มีขอบว่าง 4 ช่อง (0x5D0 / 0x05D) — สแกนหน้าต่าง 11 บิต
    const finderPenalty = (get) => {
      let pen = 0;
      for (let i = 0; i < size; i++) {
        let bits = 0;
        for (let j = 0; j < size; j++) {
          bits = ((bits << 1) & 0x7ff) | (get(i, j) ? 1 : 0);
          if (j >= 10 && (bits === 0x5d0 || bits === 0x05d)) pen += 40;
        }
      }
      return pen;
    };
    p += finderPenalty((i, j) => modules[i][j]);
    p += finderPenalty((i, j) => modules[j][i]);
    // rule 4: สัดส่วนดำ (สูตรตาม node-qrcode: |ceil(%dark/5) - 10| * 10)
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
    const total = size * size;
    p += Math.abs(Math.ceil((dark * 100 / total) / 5) - 10) * 10;
    return p;
  }

  // เลือก mask ที่ penalty ต่ำสุด (หรือใช้ค่าที่บังคับ — สำหรับตรวจสอบ)
  let bestMask = 0;
  if (opts && opts.forceMask != null) {
    bestMask = opts.forceMask;
  } else {
    let bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const pen = penalty();
      if (pen < bestPenalty) { bestPenalty = pen; bestMask = m; }
      applyMask(m); // undo (mask เป็น involution)
    }
  }
  applyMask(bestMask);
  drawFormat(bestMask);
  drawVersion();

  return { size, modules, version: ver };
}

// ---- API ----
export function qrMatrix(text, level = "M", opts) {
  return buildMatrix(text, level, opts);
}
export const _buildMatrix = buildMatrix; // สำหรับสคริปต์ตรวจสอบ

// คืน SVG string (คมชัดทุกขนาด) — margin เป็นหน่วยโมดูล (quiet zone)
export function qrSvg(text, { level = "M", margin = 4, fg = "#2b2b2b", bg = "#ffffff" } = {}) {
  const { size, modules } = buildMatrix(text, level);
  const dim = size + margin * 2;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" width="100%" height="100%">` +
    `<rect width="${dim}" height="${dim}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}
