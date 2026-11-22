import * as fs from "node:fs";
import * as zlib from "node:zlib";

// The picture that tastes of one ingredient: a single giant glossy strawberry.
// Deterministic painterly renderer, no dependencies, custom PNG encoder.

const SS: number = 2;
const OUT: number = 768;
const W: number = OUT * SS;
const H: number = OUT * SS;

function mulberry32(seed: number): () => number {
  let a: number = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t: number = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand: () => number = mulberry32(20261122);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(a: number, b: number, x: number): number {
  const t: number = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function mix3(
  c0: number[], c1: number[], c2: number[], t: number, out: number[]
): void {
  if (t < 0.5) {
    const k: number = t * 2;
    out[0] = lerp(c0[0], c1[0], k);
    out[1] = lerp(c0[1], c1[1], k);
    out[2] = lerp(c0[2], c1[2], k);
  } else {
    const k: number = (t - 0.5) * 2;
    out[0] = lerp(c1[0], c2[0], k);
    out[1] = lerp(c1[1], c2[1], k);
    out[2] = lerp(c1[2], c2[2], k);
  }
}

// Pixel buffer at supersampled resolution, RGB floats 0..255.
const buf: Float32Array = new Float32Array(W * H * 3);

function setPx(x: number, y: number, r: number, g: number, b: number): void {
  const i: number = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}
function blendPx(
  x: number, y: number, r: number, g: number, b: number, a: number
): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i: number = (y * W + x) * 3;
  const ia: number = 1 - a;
  buf[i] = buf[i] * ia + r * a;
  buf[i + 1] = buf[i + 1] * ia + g * a;
  buf[i + 2] = buf[i + 2] * ia + b * a;
}

// ---- Strawberry geometry -------------------------------------------------
const CX: number = W * 0.5;
const TOP: number = H * 0.235;
const BOTTOM: number = H * 0.845;
const MAXW: number = W * 0.335;

function halfWidth(v: number): number {
  const s: number = Math.sqrt(Math.max(0, 1 - v));
  const bulge: number = 0.82 + 0.38 * (4 * v * (1 - v));
  return MAXW * s * bulge;
}
function topEdge(x: number): number {
  const d: number = clamp((x - CX) / (MAXW * 0.84), -1, 1);
  return TOP + H * 0.02 * (1 - d * d) + H * 0.006 * Math.abs(d);
}
function berryDist(x: number, y: number): number {
  // Signed-ish distance proxy: >0 inside, <0 outside (in pixels, approx).
  const v: number = (y - TOP) / (BOTTOM - TOP);
  if (v < -0.05 || v > 1.05) return -999;
  const hw: number = halfWidth(clamp(v, 0, 1));
  const dxEdge: number = hw - Math.abs(x - CX);
  const dyTop: number = y - topEdge(x);
  const dyBot: number = BOTTOM - y;
  let d: number = Math.min(dxEdge, dyTop, dyBot + hw * 0.4);
  if (v > 0.9) d = Math.min(d, dxEdge + (1 - v) * 60);
  return d;
}

// ---- Base pass: background, shadow, berry body ---------------------------
const bgCenter: number[] = [52, 30, 20];
const bgMid: number[] = [30, 16, 11];
const bgEdge: number[] = [10, 5, 4];
const redDeep: number[] = [122, 8, 22];
const redMid: number[] = [196, 18, 36];
const redBright: number[] = [244, 62, 62];
const tmp: number[] = [0, 0, 0];

const LX: number = W * 0.36;
const LY: number = H * 0.3;

for (let y: number = 0; y < H; y++) {
  for (let x: number = 0; x < W; x++) {
    const nx: number = x / W;
    const ny: number = y / H;
    // Warm dark background with radial glow behind the fruit + vignette.
    const bd: number = Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.44) * (ny - 0.44));
    mix3(bgCenter, bgMid, bgEdge, clamp(bd * 1.7, 0, 1), tmp);
    let r: number = tmp[0];
    let g: number = tmp[1];
    let b: number = tmp[2];
    // Soft warm pool of light on the "table" beneath the berry.
    const poolX: number = (nx - 0.5) * (nx - 0.5) / 0.09;
    const poolY: number = (ny - 0.86) * (ny - 0.86) / 0.006;
    const pool: number = Math.exp(-(poolX + poolY));
    r += 26 * pool;
    g += 13 * pool;
    b += 6 * pool;
    // Contact shadow under the fruit.
    const shx: number = (x - CX) / (W * 0.31);
    const shy: number = (y - H * 0.855) / (H * 0.045);
    const shadow: number = Math.exp(-(shx * shx + shy * shy) * 2.2);
    r *= 1 - 0.62 * shadow;
    g *= 1 - 0.62 * shadow;
    b *= 1 - 0.62 * shadow;

    const d: number = berryDist(x, y);
    if (d > -2) {
      const v: number = clamp((y - TOP) / (BOTTOM - TOP), 0, 1);
      const hw: number = Math.max(1, halfWidth(v));
      const u: number = (x - CX) / hw; // -1..1 across the body
      // Light falls from upper left; form shading across the round body.
      const ldx: number = (x - LX) / W;
      const ldy: number = (y - LY) / H;
      const ld: number = Math.sqrt(ldx * ldx + ldy * ldy);
      const glow: number = Math.exp(-ld * ld * 5.2);
      const side: number = clamp(0.5 - u * 0.42 - v * 0.12 + glow * 0.55, 0, 1);
      mix3(redDeep, redMid, redBright, side, tmp);
      r = tmp[0];
      g = tmp[1];
      b = tmp[2];
      // Plump roundness: darken the silhouette rim, lift the belly.
      const rim: number = smooth(0.72, 1.0, Math.abs(u));
      r *= 1 - 0.34 * rim;
      g *= 1 - 0.34 * rim;
      b *= 1 - 0.3 * rim;
      const belly: number = Math.exp(-((u * u) / 0.2 + ((v - 0.42) * (v - 0.42)) / 0.09));
      r += 22 * belly;
      g += 6 * belly;
      // Slightly deeper, richer tip.
      const tip: number = smooth(0.72, 1.0, v);
      r *= 1 - 0.13 * tip;
      g *= 1 - 0.1 * tip;
      // Fine painterly grain, deterministic hash noise, very low amplitude.
      const n: number =
        Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const grain: number = (n - Math.floor(n) - 0.5) * 5;
      r += grain;
      g += grain * 0.7;
      b += grain * 0.5;
      // Anti-aliased silhouette edge against the background.
      if (d < 2) {
        const ea: number = clamp((d + 2) / 4, 0, 1);
        const bi: number = (y * W + x) * 3;
        // Recompute background value for blending from stored pixel.
        r = buf[bi] * (1 - ea) + r * ea;
        g = buf[bi + 1] * (1 - ea) + g * ea;
        b = buf[bi + 2] * (1 - ea) + b * ea;
      }
    }
    setPx(x, y, r, g, b);
  }
}

// ---- Shape helpers -------------------------------------------------------
function fillEllipse(
  cx: number, cy: number, rx: number, ry: number, rot: number,
  cr: number, cg: number, cb: number, alpha: number, soft: number
): void {
  const ext: number = Math.max(rx, ry) + 3;
  const x0: number = Math.max(0, Math.floor(cx - ext));
  const x1: number = Math.min(W - 1, Math.ceil(cx + ext));
  const y0: number = Math.max(0, Math.floor(cy - ext));
  const y1: number = Math.min(H - 1, Math.ceil(cy + ext));
  const cosr: number = Math.cos(rot);
  const sinr: number = Math.sin(rot);
  for (let y: number = y0; y <= y1; y++) {
    for (let x: number = x0; x <= x1; x++) {
      const dx: number = x - cx;
      const dy: number = y - cy;
      const lx: number = dx * cosr + dy * sinr;
      const ly: number = -dx * sinr + dy * cosr;
      const q: number = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
      if (q < 1.25) {
        const a: number = alpha * smooth(1.25, 1.25 - soft, q);
        blendPx(x, y, cr, cg, cb, a);
      }
    }
  }
}

function fillLeaf(
  bx: number, by: number, len: number, wid: number, ang: number,
  cr: number, cg: number, cb: number
): void {
  const ext: number = len + wid + 4;
  const x0: number = Math.max(0, Math.floor(bx - ext));
  const x1: number = Math.min(W - 1, Math.ceil(bx + ext));
  const y0: number = Math.max(0, Math.floor(by - ext));
  const y1: number = Math.min(H - 1, Math.ceil(by + ext));
  const cosr: number = Math.cos(ang);
  const sinr: number = Math.sin(ang);
  for (let y: number = y0; y <= y1; y++) {
    for (let x: number = x0; x <= x1; x++) {
      const dx: number = x - bx;
      const dy: number = y - by;
      const u: number = (dx * cosr + dy * sinr) / len; // 0 base .. 1 tip
      if (u < 0 || u > 1) continue;
      const wLocal: number = (-dx * sinr + dy * cosr) / wid;
      const profile: number =
        Math.sin(Math.PI * Math.pow(u, 0.75)) * (1 - 0.25 * u) + 0.001;
      const q: number = Math.abs(wLocal) / profile;
      if (q < 1.15) {
        const a: number = smooth(1.15, 0.85, q);
        const shade: number = 0.78 + 0.3 * u - 0.25 * Math.abs(wLocal);
        const vein: number = 1 - 0.22 * Math.exp(-wLocal * wLocal * 30);
        blendPx(
          x, y,
          cr * shade * vein, cg * shade * vein, cb * shade * vein, a
        );
      }
    }
  }
}

// ---- Seed pits (achenes) ---------------------------------------------------
// Staggered rows following the body; each pit is a soft dimple holding one
// small cream seed tilted toward the tip.
interface Pit { x: number; y: number; s: number; tilt: number }
const pits: Pit[] = [];
const rows: number = 11;
for (let ri: number = 0; ri < rows; ri++) {
  const v: number = 0.13 + (ri / (rows - 1)) * 0.76;
  const y: number = TOP + v * (BOTTOM - TOP);
  const hw: number = halfWidth(v) * 0.86;
  const cols: number = Math.max(2, Math.round(7 - v * 3.4));
  const off: number = ri % 2 === 0 ? 0 : 0.5;
  for (let ci: number = 0; ci < cols; ci++) {
    const f: number = cols === 1 ? 0 : (ci + off * 0.6) / (cols - 0.4) - 0.5;
    const x: number = CX + f * 2 * hw;
    if (berryDist(x, y) < 26) continue;
    const s: number = (1 - v * 0.38) * (1 - Math.abs(f) * 0.22);
    pits.push({ x: x, y: y, s: s, tilt: f * 0.5 + (rand() - 0.5) * 0.15 });
  }
}
for (const p of pits) {
  const pr: number = 17 * p.s * SS * 0.5;
  // Dimple: soft dark hollow, lit on its lower rim.
  fillEllipse(p.x, p.y, pr * 0.95, pr * 1.2, p.tilt, 96, 4, 16, 0.55, 0.55);
  fillEllipse(p.x, p.y + pr * 0.55, pr * 0.8, pr * 0.5, p.tilt, 255, 92, 84, 0.28, 0.6);
  // The seed itself: warm cream, shaded at its base, tiny top highlight.
  fillEllipse(p.x, p.y, pr * 0.52, pr * 0.78, p.tilt, 244, 224, 168, 0.96, 0.35);
  fillEllipse(p.x, p.y + pr * 0.3, pr * 0.4, pr * 0.45, p.tilt, 214, 178, 116, 0.55, 0.5);
  fillEllipse(p.x - pr * 0.14, p.y - pr * 0.3, pr * 0.2, pr * 0.3, p.tilt, 255, 246, 214, 0.8, 0.5);
}

// ---- Gloss: long soft specular highlight, upper left ----------------------
fillEllipse(W * 0.385, H * 0.4, W * 0.05, H * 0.16, 0.32, 255, 214, 205, 0.34, 0.9);
fillEllipse(W * 0.375, H * 0.385, W * 0.026, H * 0.1, 0.32, 255, 238, 232, 0.5, 0.9);
fillEllipse(W * 0.368, H * 0.36, W * 0.012, H * 0.05, 0.32, 255, 255, 250, 0.65, 0.8);
// Gentle sheen sweeping the right shoulder.
fillEllipse(W * 0.63, H * 0.36, W * 0.035, H * 0.09, -0.4, 255, 170, 160, 0.16, 0.9);

// ---- Water droplets ---------------------------------------------------------
interface Drop { x: number; y: number; r: number }
const drops: Drop[] = [];
const dropSpots: number[][] = [
  [0.42, 0.47], [0.565, 0.545], [0.465, 0.63], [0.6, 0.4],
  [0.375, 0.575], [0.53, 0.72], [0.44, 0.33], [0.585, 0.66],
];
for (const spot of dropSpots) {
  const x: number = spot[0] * W + (rand() - 0.5) * 14;
  const y: number = spot[1] * H + (rand() - 0.5) * 14;
  if (berryDist(x, y) < 20) continue;
  drops.push({ x: x, y: y, r: (7 + rand() * 8) * SS * 0.9 });
}
for (const d of drops) {
  fillEllipse(d.x + d.r * 0.18, d.y + d.r * 0.3, d.r * 1.02, d.r * 1.14, 0, 70, 2, 10, 0.35, 0.7);
  fillEllipse(d.x, d.y, d.r, d.r * 1.12, 0, 255, 196, 188, 0.34, 0.65);
  fillEllipse(d.x, d.y + d.r * 0.34, d.r * 0.72, d.r * 0.6, 0, 255, 232, 226, 0.4, 0.7);
  fillEllipse(d.x - d.r * 0.3, d.y - d.r * 0.38, d.r * 0.3, d.r * 0.22, -0.5, 255, 255, 255, 0.95, 0.5);
}

// ---- Calyx: fresh green sepals + stem --------------------------------------
const leafBaseX: number = CX;
const leafBaseY: number = TOP + H * 0.028;
// Back leaves first (darker), then front leaves (brighter).
fillLeaf(leafBaseX, leafBaseY, W * 0.21, H * 0.035, Math.PI * 1.08, 34, 92, 30);
fillLeaf(leafBaseX, leafBaseY, W * 0.22, H * 0.036, Math.PI * 0.94, 38, 102, 32);
fillLeaf(leafBaseX, leafBaseY, W * 0.19, H * 0.033, Math.PI * 1.24, 30, 84, 27);
fillLeaf(leafBaseX, leafBaseY, W * 0.185, H * 0.032, Math.PI * 0.78, 36, 98, 31);
fillLeaf(leafBaseX, leafBaseY, W * 0.155, H * 0.03, Math.PI * 1.42, 44, 116, 38);
fillLeaf(leafBaseX, leafBaseY, W * 0.15, H * 0.03, Math.PI * 0.6, 48, 124, 40);
fillLeaf(leafBaseX, leafBaseY, W * 0.13, H * 0.028, Math.PI * 1.55, 52, 132, 44);
fillLeaf(leafBaseX, leafBaseY, W * 0.125, H * 0.027, Math.PI * 0.45, 56, 140, 46);
// Central star of small sepals hugging the crown.
fillLeaf(leafBaseX, leafBaseY + 6, W * 0.1, H * 0.024, Math.PI * 1.02, 62, 148, 50);
fillLeaf(leafBaseX, leafBaseY + 6, W * 0.095, H * 0.023, Math.PI * 0.86, 58, 142, 47);
// Stem rising from the crown.
fillLeaf(leafBaseX - 4, leafBaseY - H * 0.1, W * 0.075, H * 0.016, Math.PI * 1.52, 66, 138, 52);
fillEllipse(leafBaseX, leafBaseY, W * 0.028, H * 0.014, 0, 74, 158, 56, 0.9, 0.5);

// ---- Downsample 2x2 ---------------------------------------------------------
const outData: Uint8Array = new Uint8Array(OUT * OUT * 3);
for (let y: number = 0; y < OUT; y++) {
  for (let x: number = 0; x < OUT; x++) {
    let r: number = 0;
    let g: number = 0;
    let b: number = 0;
    for (let dy: number = 0; dy < SS; dy++) {
      for (let dx: number = 0; dx < SS; dx++) {
        const i: number = ((y * SS + dy) * W + (x * SS + dx)) * 3;
        r += buf[i];
        g += buf[i + 1];
        b += buf[i + 2];
      }
    }
    const o: number = (y * OUT + x) * 3;
    const n: number = SS * SS;
    outData[o] = clamp(Math.round(r / n), 0, 255);
    outData[o + 1] = clamp(Math.round(g / n), 0, 255);
    outData[o + 2] = clamp(Math.round(b / n), 0, 255);
  }
}

// ---- Minimal PNG encoder ----------------------------------------------------
const crcTable: Int32Array = new Int32Array(256);
for (let n: number = 0; n < 256; n++) {
  let c: number = n;
  for (let k: number = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}
function crc32(data: Buffer): number {
  let c: number = 0xffffffff;
  for (let i: number = 0; i < data.length; i++) {
    c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len: Buffer = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body: Buffer = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc: Buffer = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr: Buffer = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const stride: number = OUT * 3 + 1;
const raw: Buffer = Buffer.alloc(stride * OUT);
for (let y: number = 0; y < OUT; y++) {
  raw[y * stride] = 0; // filter: none
  Buffer.from(outData.buffer, y * OUT * 3, OUT * 3).copy(raw, y * stride + 1);
}
const idat: Buffer = zlib.deflateSync(raw, { level: 9 });

const png: Buffer = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync("/output", { recursive: true });
fs.writeFileSync("/output/entry.png", png);
console.log("wrote /output/entry.png", png.length, "bytes");
