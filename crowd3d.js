"use strict";
/* =========================================================
   جمعیت تالار: آدم‌های سه‌بعدی (زن و مرد) که تابلوها را تماشا می‌کنند
   - بدون کتابخانه‌ی بیرونی؛ هر آدم یک مدل اسکلت‌دار (۱۱ استخوان) است که روی GPU حرکت می‌کند
   - گروهی جلوی تابلوها ایستاده‌اند، سر می‌چرخانند، اشاره می‌کنند، با تبلت یا موبایل کار می‌کنند
   - بعضی‌ها هر چند ثانیه راه می‌افتند و به تابلوی دیگری می‌روند
   - اگر بازدیدکننده نزدیک شود، کنار می‌روند؛ و بازدیدکننده هم از داخل آن‌ها رد نمی‌شود
   تنظیمات در config.js:  CROWD_SIZE  و  CROWD_WOMEN_SCARF
========================================================= */
(function(){

const NB = 11;
const PELVIS = 0, CHEST = 1, HEAD = 2, LUA = 3, LLA = 4, RUA = 5, RLA = 6, LUL = 7, LLL = 8, RUL = 9, RLL = 10;
const PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];

let gl = null, P = null, PB = null, U = {}, UB = {};
let agents = [], api = null, ready = false, low = false;
let blobBuf = null, blobData = null;
let rngState = 12345;
function rnd(){ rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; }
function rr(a, b){ return a + (b - a) * rnd(); }
function pick(arr){ return arr[Math.floor(rnd() * arr.length)]; }
function pickW(arr){ /* [[value, weight], ...] */
  let t = 0; arr.forEach(function(a){ t += a[1]; });
  let x = rnd() * t;
  for(let i = 0; i < arr.length; i++){ x -= arr[i][1]; if(x <= 0) return arr[i][0]; }
  return arr[arr.length - 1][0];
}
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function hex(h){ return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }
function shade(c, k){ return [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)]; }

/* =========================================================
   هندسه‌ی بدن (شبکه‌ی اندیس‌دار با رنگ و استخوان برای هر رأس)
========================================================= */
function G(){ return {p:[], n:[], c:[], b:[], i:[]}; }

/* بیضوی (کره، سر، دست، موی کوتاه...). phi0..phi1: برش از بالا تا پایین (۰ تا π) */
function ellipsoid(g, cx, cy, cz, rx, ry, rz, col, bone, o){
  o = o || {};
  const su = o.su || (low ? 8 : 12), sv = o.sv || (low ? 5 : 8);
  const p0 = o.p0 || 0, p1 = o.p1 == null ? Math.PI : o.p1, em = o.em || 0;
  const base = g.p.length / 3;
  for(let v = 0; v <= sv; v++){
    const ph = p0 + (p1 - p0) * v / sv, sp = Math.sin(ph), cp = Math.cos(ph);
    for(let u = 0; u < su; u++){
      const th = Math.PI * 2 * u / su, ct = Math.cos(th), st = Math.sin(th);
      const nx = sp * ct / rx, ny = cp / ry, nz = sp * st / rz, nl = Math.hypot(nx, ny, nz) || 1;
      g.p.push(cx + rx * sp * ct, cy + ry * cp, cz + rz * sp * st);
      g.n.push(nx / nl, ny / nl, nz / nl);
      g.c.push(col[0], col[1], col[2], em); g.b.push(bone);
    }
  }
  for(let v = 0; v < sv; v++) for(let u = 0; u < su; u++){
    const a = base + v * su + u, b = base + v * su + (u + 1) % su, c = base + (v + 1) * su + u, d = base + (v + 1) * su + (u + 1) % su;
    g.i.push(a, c, b, b, c, d);
  }
}
/* پوسته‌ی لوفت: حلقه‌های بیضی روی هم (تنه، دامن، مانتو، ساق) */
function loft(g, rings, col, bone, o){
  o = o || {};
  const seg = o.seg || (low ? 8 : 12), base = g.p.length / 3, em = o.em || 0;
  rings.forEach(function(r){
    for(let u = 0; u < seg; u++){
      const th = Math.PI * 2 * u / seg, ct = Math.cos(th), st = Math.sin(th);
      g.p.push((r.cx || 0) + r.rx * ct, r.y, (r.cz || 0) + r.rz * st);
      g.n.push(ct, 0, st);
      const cc = r.col || col;
      g.c.push(cc[0], cc[1], cc[2], em); g.b.push(bone);
    }
  });
  for(let k = 0; k < rings.length - 1; k++) for(let u = 0; u < seg; u++){
    const a = base + k * seg + u, b = base + k * seg + (u + 1) % seg, c = base + (k + 1) * seg + u, d = base + (k + 1) * seg + (u + 1) % seg;
    g.i.push(a, c, b, b, c, d);
  }
  /* درپوش بالا و پایین */
  [[0, false], [rings.length - 1, true]].forEach(function(e){
    const r = rings[e[0]], ci = g.p.length / 3, cc = r.col || col;
    g.p.push(r.cx || 0, r.y, r.cz || 0); g.n.push(0, e[1] ? 1 : -1, 0); g.c.push(cc[0], cc[1], cc[2], em); g.b.push(bone);
    for(let u = 0; u < seg; u++){ const a = base + e[0] * seg + u, b = base + e[0] * seg + (u + 1) % seg; if(e[1]) g.i.push(ci, b, a); else g.i.push(ci, a, b); }
  });
  smooth(g, base);
}
/* نرمال‌های هموار برای لوفت (از روی مثلث‌ها) */
function smooth(g, base){
  const n = g.p.length / 3, acc = new Float32Array((n - base) * 3);
  for(let t = 0; t < g.i.length; t += 3){
    const a = g.i[t], b = g.i[t + 1], c = g.i[t + 2];
    if(a < base || b < base || c < base) continue;
    const ax = g.p[a * 3], ay = g.p[a * 3 + 1], az = g.p[a * 3 + 2];
    const ux = g.p[b * 3] - ax, uy = g.p[b * 3 + 1] - ay, uz = g.p[b * 3 + 2] - az;
    const vx = g.p[c * 3] - ax, vy = g.p[c * 3 + 1] - ay, vz = g.p[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    [a, b, c].forEach(function(k){ acc[(k - base) * 3] += nx; acc[(k - base) * 3 + 1] += ny; acc[(k - base) * 3 + 2] += nz; });
  }
  for(let k = base; k < n; k++){
    const x = acc[(k - base) * 3], y = acc[(k - base) * 3 + 1], z = acc[(k - base) * 3 + 2], l = Math.hypot(x, y, z);
    if(l > 1e-9){ g.n[k * 3] = x / l; g.n[k * 3 + 1] = y / l; g.n[k * 3 + 2] = z / l; }
  }
}
/* استوانه‌ی مخروطی میان دو نقطه (دست و پا) با توپ‌های مفصل */
function limb(g, a, b, r0, r1, col, bone, o){
  o = o || {};
  const seg = low ? 6 : 8;
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
  /* دو بردار عمود بر محور */
  let ux = 1, uy = 0, uz = 0; if(Math.abs(dx) > 0.9){ ux = 0; uy = 0; uz = 1; }
  let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux; let vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
  ux = vy * dz - vz * dy; uy = vz * dx - vx * dz; uz = vx * dy - vy * dx;
  const base = g.p.length / 3;
  [[a, r0], [b, r1]].forEach(function(e){
    for(let s = 0; s < seg; s++){
      const th = Math.PI * 2 * s / seg, ct = Math.cos(th), st = Math.sin(th);
      const nx = ux * ct + vx * st, ny = uy * ct + vy * st, nz = uz * ct + vz * st;
      g.p.push(e[0][0] + nx * e[1], e[0][1] + ny * e[1], e[0][2] + nz * e[1]); g.n.push(nx, ny, nz);
      g.c.push(col[0], col[1], col[2], 0); g.b.push(bone);
    }
  });
  for(let s = 0; s < seg; s++){ const s2 = (s + 1) % seg; g.i.push(base + s, base + seg + s, base + s2, base + s2, base + seg + s, base + seg + s2); }
  if(!o.noCaps){
    ellipsoid(g, a[0], a[1], a[2], r0, r0, r0, col, bone, {su:seg, sv:4});
    ellipsoid(g, b[0], b[1], b[2], r1, r1, r1, col, bone, {su:seg, sv:4});
  }
}
/* جعبه (کفش، تبلت، کیف، کراوات) */
function box(g, cx, cy, cz, sx, sy, sz, col, bone, em){
  const hx = sx / 2, hy = sy / 2, hz = sz / 2, e = em || 0;
  const faces = [
    [[0, 0, 1], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    [[0, 0, -1], [hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
    [[-1, 0, 0], [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]],
    [[1, 0, 0], [hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]],
    [[0, 1, 0], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]],
    [[0, -1, 0], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]
  ];
  faces.forEach(function(f){
    const base = g.p.length / 3;
    for(let k = 1; k <= 4; k++){ g.p.push(cx + f[k][0], cy + f[k][1], cz + f[k][2]); g.n.push(f[0][0], f[0][1], f[0][2]); g.c.push(col[0], col[1], col[2], e); g.b.push(bone); }
    g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
}

/* =========================================================
   رنگ‌ها و ظاهرها
========================================================= */
const SKIN = [["#f2cba6", 20], ["#e4b28a", 30], ["#d39d70", 26], ["#be8657", 14], ["#a26b41", 8], ["#8a5632", 4]];
const HAIR_M = [["#13100e", 52], ["#2a1d15", 26], ["#4a3222", 10], ["#6a4a30", 4], ["#8a8a8a", 8]];
const HAIR_F = [["#13100e", 42], ["#2a1d15", 28], ["#4a3222", 14], ["#6a4a30", 8], ["#8a3a24", 4], ["#b08a58", 4]];
const SUIT = ["#262a33", "#1c2740", "#3d424c", "#4a3a2e", "#14161a", "#2d3b36", "#565c66"];
const CASUAL = ["#2f6f7a", "#7a2f3a", "#5d6b3a", "#6e7686", "#b0813a", "#3c4a63", "#8a6a4a"];
const SHIRT = ["#f2f2f0", "#cfe0f1", "#e8dcc8", "#a7c4d8"];
const TIE = ["#a6283a", "#1f4e8c", "#c9a23a", "#2f6f4f", "#5c2e6e", "#222"];
const TROUSER = ["#1b1e25", "#2a3040", "#3a3f48", "#5a4b3a", "#242a24"];
const MANTEAU = ["#16181d", "#22304a", "#b9a58a", "#6b2b3a", "#4d5a3a", "#2f6a73", "#5a5e66", "#c49a3a", "#b88a94", "#3a2f4a"];
const SCARF = ["#151518", "#ece6dc", "#d7b1ba", "#d6a93a", "#233450", "#6a2a3a", "#7a8aa0", "#2f5f58"];
const FSKIRT = ["#17181c", "#26283a", "#3a2f2a", "#2b3b3a", "#5a3a3a"];
const BLAZER = ["#1d2030", "#3a3f4a", "#7a5a48", "#2c4a52", "#5a2f3a", "#b9b4aa"];
const SHOE = ["#15130f", "#2a1f16", "#101216", "#3a2a20"];

function makeSpec(gender, scarfProb){
  const f = gender === "f", older = rnd() < 0.22;
  const sp = {gender:gender, older:older};
  sp.sc = f ? rr(0.89, 0.98) : rr(0.96, 1.05);
  sp.w = f ? rr(0.92, 1.08) : rr(0.95, 1.12);
  sp.skin = hex(pickW(SKIN));
  sp.hairCol = hex(older && rnd() < 0.6 ? "#8a8a8a" : pickW(f ? HAIR_F : HAIR_M));
  sp.shoe = hex(pick(SHOE));
  if(!f){
    sp.style = pickW([["suit", 56], ["casual", 30], ["shirt", 14]]);
    sp.top = hex(sp.style === "casual" ? pick(CASUAL) : pick(SUIT));
    sp.shirt = hex(pick(SHIRT)); sp.tie = hex(pick(TIE));
    sp.trouser = hex(pick(TROUSER));
    sp.hair = pickW([["short", 56], ["bald", 10], ["side", 20], ["long", 14]]);
    sp.beard = rnd() < 0.34; sp.glasses = rnd() < 0.24;
    if(sp.style === "shirt") sp.top = hex(pick(SHIRT));
  }else{
    sp.covered = rnd() < scarfProb;
    sp.style = sp.covered ? "manteau" : pickW([["blazerSkirt", 45], ["blazerPants", 35], ["manteau", 20]]);
    sp.top = hex(sp.style === "manteau" ? pick(MANTEAU) : pick(BLAZER));
    sp.blouse = hex(pick(["#f2f2f0", "#d7b1ba", "#cfe0f1", "#2a2a30", "#c9a23a"]));
    sp.scarf = hex(pick(SCARF));
    sp.skirt = hex(pick(FSKIRT)); sp.trouser = hex(pick(FSKIRT));
    sp.hair = pickW([["long", 40], ["bob", 22], ["pony", 24], ["bun", 14]]);
    sp.glasses = rnd() < 0.18; sp.legs = hex(rnd() < 0.5 ? "#17181c" : "#6a5a50");
  }
  sp.prop = pickW([["none", 38], ["tablet", 18], ["phone", 16], ["case", f ? 0 : 14], ["bag", f ? 24 : 4], ["papers", 10]]);
  return sp;
}

/* ساخت یک نفر؛ همه‌ی اندازه‌ها بر حسب متر و با ضریب قد */
function buildPerson(sp){
  const g = G(), s = sp.sc, f = sp.gender === "f", w = sp.w;
  const hipY = 0.93 * s, kneeY = 0.50 * s, shY = (f ? 1.40 : 1.45) * s, neckY = (f ? 1.48 : 1.53) * s, headY = (f ? 1.60 : 1.66) * s;
  const shX = (f ? 0.175 : 0.215) * w, hipX = (f ? 0.085 : 0.09) * w;
  const uaL = 0.29 * s, laL = 0.26 * s;
  const piv = [];
  piv[PELVIS] = [0, hipY, 0]; piv[CHEST] = [0, hipY + 0.08 * s, 0]; piv[HEAD] = [0, neckY, 0];
  piv[LUA] = [shX, shY, 0]; piv[LLA] = [shX, shY - uaL, 0]; piv[RUA] = [-shX, shY, 0]; piv[RLA] = [-shX, shY - uaL, 0];
  piv[LUL] = [hipX, hipY, 0]; piv[LLL] = [hipX, kneeY, 0]; piv[RUL] = [-hipX, hipY, 0]; piv[RLL] = [-hipX, kneeY, 0];
  const skin = sp.skin, skinD = shade(sp.skin, 0.78);
  const topC = sp.top;
  const trC = f ? (sp.style === "blazerSkirt" ? sp.legs : sp.trouser) : sp.trouser;
  const sleeveC = (!f && sp.style === "shirt") ? sp.top : topC;

  /* --- پاها --- */
  [[1, LUL, LLL], [-1, RUL, RLL]].forEach(function(e){
    const x = e[0] * hipX, th = e[1], sh = e[2];
    limb(g, [x, hipY - 0.01, 0], [x, kneeY, 0], 0.078 * w, 0.056 * w, trC, th);
    limb(g, [x, kneeY, 0], [x, 0.085 * s, 0], 0.054 * w, 0.040 * w, trC, sh);
    box(g, x, 0.04 * s, 0.05, 0.095, 0.075, 0.27, sp.shoe, sh);
  });
  /* --- لگن و تنه --- */
  const hw = (f ? 0.168 : 0.162) * w;
  if(f && (sp.style === "manteau")){
    /* مانتو بلند تا میانه‌ی ران؛ نیمه‌ی پایین روی لگن، بالا روی تنه */
    loft(g, [{y:hipY - 0.34 * s, rx:hw + 0.065, rz:0.135}, {y:hipY - 0.16 * s, rx:hw + 0.035, rz:0.12}, {y:hipY + 0.06 * s, rx:hw, rz:0.105}], topC, PELVIS);
  }else if(f && sp.style === "blazerSkirt"){
    loft(g, [{y:hipY - 0.40 * s, rx:hw + 0.07, rz:0.135, col:sp.skirt}, {y:hipY - 0.2 * s, rx:hw + 0.035, rz:0.12, col:sp.skirt}, {y:hipY + 0.06 * s, rx:hw - 0.005, rz:0.1, col:sp.skirt}], sp.skirt, PELVIS);
  }else{
    loft(g, [{y:hipY - 0.1 * s, rx:hw, rz:0.105}, {y:hipY + 0.06 * s, rx:hw - 0.005, rz:0.1}], trC, PELVIS);
  }
  const chestRX = (f ? 0.165 : 0.205) * w, waistRX = (f ? 0.125 : 0.16) * w;
  loft(g, [
    {y:hipY + 0.04 * s, rx:hw - 0.005, rz:0.10},
    {y:hipY + 0.18 * s, rx:waistRX, rz:0.092},
    {y:hipY + 0.34 * s, rx:chestRX, rz:f ? 0.108 : 0.112},
    {y:shY - 0.03 * s, rx:chestRX + (f ? 0.012 : 0.022), rz:0.1},
    {y:shY + 0.025 * s, rx:0.09 * w, rz:0.075}
  ], topC, CHEST);
  if(f && sp.style === "manteau"){
    /* یقه و دکمه‌ها: نوار روشن‌تر جلو */
    box(g, 0, hipY + 0.2 * s, 0.108, 0.012, 0.52 * s, 0.006, shade(topC, 1.35), CHEST);
  }
  if(!f && sp.style !== "casual"){
    /* پیراهن و کراوات */
    box(g, 0, shY - 0.1 * s, 0.108, 0.075, 0.2 * s, 0.012, sp.shirt, CHEST);
    if(sp.style === "suit") box(g, 0, shY - 0.15 * s, 0.116, 0.024, 0.2 * s, 0.01, sp.tie, CHEST);
  }
  if(f && (sp.style === "blazerSkirt" || sp.style === "blazerPants")) box(g, 0, shY - 0.09 * s, 0.108, 0.085, 0.16 * s, 0.012, sp.blouse, CHEST);
  /* گردن */
  limb(g, [0, neckY - 0.07 * s, 0], [0, neckY + 0.03 * s, 0.005], 0.047 * w, 0.042 * w, skinD, HEAD, {noCaps:true});

  /* --- دست‌ها --- */
  [[1, LUA, LLA], [-1, RUA, RLA]].forEach(function(e){
    const x = e[0] * shX, ua = e[1], la = e[2], elbY = shY - uaL, wrY = elbY - laL;
    limb(g, [x, shY - 0.005, 0], [x, elbY, 0], 0.046 * w, 0.039 * w, sleeveC, ua);
    const fore = (f && sp.style === "blazerPants" && false) ? skin : sleeveC;
    limb(g, [x, elbY, 0], [x, wrY, 0.0], 0.038 * w, 0.03 * w, fore, la);
    ellipsoid(g, x, wrY - 0.05 * s, 0.01, 0.033, 0.058, 0.04, skin, la, {su:8, sv:5});
  });

  /* --- سر --- */
  ellipsoid(g, 0, headY, 0.005, 0.086 * (f ? 0.96 : 1), 0.108, 0.102, skin, HEAD, {su:low ? 10 : 14, sv:low ? 7 : 10});
  ellipsoid(g, 0, headY - 0.065, 0.026, 0.066, 0.056, 0.07, skin, HEAD, {su:8, sv:5});             /* چانه */
  ellipsoid(g, 0, headY - 0.012, 0.105, 0.014, 0.022, 0.022, shade(skin, 0.9), HEAD, {su:6, sv:4}); /* بینی */
  [1, -1].forEach(function(e){
    ellipsoid(g, e * 0.038, headY + 0.014, 0.092, 0.012, 0.009, 0.008, hex("#17120f"), HEAD, {su:6, sv:4});   /* چشم */
    ellipsoid(g, e * 0.089, headY - 0.004, 0.0, 0.012, 0.028, 0.02, skinD, HEAD, {su:6, sv:4});               /* گوش */
    if(!f || rnd() < 0.5) box(g, e * 0.038, headY + 0.036, 0.094, 0.034, 0.006, 0.006, shade(sp.hairCol, 0.9), HEAD);  /* ابرو */
  });
  if(sp.glasses){
    [1, -1].forEach(function(e){ box(g, e * 0.038, headY + 0.012, 0.107, 0.05, 0.036, 0.004, hex("#202428"), HEAD); });
    box(g, 0, headY + 0.016, 0.108, 0.02, 0.005, 0.004, hex("#202428"), HEAD);
  }
  /* لب */
  box(g, 0, headY - 0.05, 0.1, 0.03, 0.006, 0.006, shade(skin, 0.7), HEAD);
  /* مو، روسری */
  const hc = sp.hairCol;
  if(f && sp.covered){
    ellipsoid(g, 0, headY + 0.006, -0.014, 0.105, 0.124, 0.118, sp.scarf, HEAD, {p1:Math.PI * 0.8, su:low ? 10 : 14, sv:low ? 7 : 9});
    loft(g, [{y:shY - 0.2 * s, rx:chestRX + 0.03, rz:0.12}, {y:shY - 0.1 * s, rx:chestRX + 0.04, rz:0.12}, {y:shY + 0.01 * s, rx:chestRX + 0.045, rz:0.125, cz:-0.01}, {y:shY + 0.07 * s, rx:0.095, rz:0.085, cz:-0.012}], sp.scarf, CHEST);
  }else if(sp.hair === "bald" || (sp.hair === "short" && false)){
    /* بدون مو */
  }else if(sp.hair === "short" || sp.hair === "side"){
    ellipsoid(g, 0, headY + 0.014, -0.012, 0.093, 0.106, 0.108, hc, HEAD, {p1:Math.PI * 0.62, su:low ? 10 : 14, sv:low ? 6 : 8});
    if(sp.hair === "side") ellipsoid(g, 0.03, headY + 0.085, 0.045, 0.06, 0.03, 0.06, hc, HEAD, {su:8, sv:4});
  }else if(sp.hair === "long"){
    ellipsoid(g, 0, headY + 0.014, -0.014, 0.096, 0.108, 0.11, hc, HEAD, {p1:Math.PI * 0.66, su:low ? 10 : 14, sv:low ? 6 : 8});
    ellipsoid(g, 0, headY - 0.1, -0.058, 0.104, 0.19, 0.075, hc, HEAD, {su:10, sv:7});
  }else if(sp.hair === "bob"){
    ellipsoid(g, 0, headY + 0.014, -0.014, 0.098, 0.108, 0.11, hc, HEAD, {p1:Math.PI * 0.66, su:low ? 10 : 14, sv:low ? 6 : 8});
    ellipsoid(g, 0, headY - 0.045, -0.03, 0.108, 0.085, 0.098, hc, HEAD, {su:10, sv:6});
  }else if(sp.hair === "pony"){
    ellipsoid(g, 0, headY + 0.014, -0.012, 0.094, 0.106, 0.108, hc, HEAD, {p1:Math.PI * 0.62, su:low ? 10 : 14, sv:low ? 6 : 8});
    ellipsoid(g, 0, headY + 0.02, -0.125, 0.04, 0.045, 0.045, hc, HEAD, {su:6, sv:4});
    ellipsoid(g, 0, headY - 0.07, -0.15, 0.035, 0.11, 0.04, hc, HEAD, {su:6, sv:5});
  }else if(sp.hair === "bun"){
    ellipsoid(g, 0, headY + 0.014, -0.012, 0.094, 0.106, 0.108, hc, HEAD, {p1:Math.PI * 0.62, su:low ? 10 : 14, sv:low ? 6 : 8});
    ellipsoid(g, 0, headY + 0.1, -0.07, 0.05, 0.05, 0.05, hc, HEAD, {su:8, sv:5});
  }
  if(!f && sp.beard){
    ellipsoid(g, 0, headY - 0.07, 0.03, 0.074, 0.062, 0.078, shade(hc, 1.0), HEAD, {p0:Math.PI * 0.2, su:10, sv:5});
  }
  /* --- وسایل --- */
  const handY = shY - uaL - laL - 0.05 * s;
  const wy = shY - uaL - laL - 0.06 * s;
  if(sp.prop === "tablet"){
    box(g, -shX, wy, 0.03, 0.2, 0.17, 0.012, hex("#1a1d24"), RLA);
    box(g, -shX, wy, 0.0385, 0.185, 0.155, 0.004, hex("#5aa9ff"), RLA, 0.9);
  }else if(sp.prop === "phone"){
    box(g, -shX, wy, 0.03, 0.07, 0.14, 0.01, hex("#111318"), RLA);
    box(g, -shX, wy, 0.0355, 0.06, 0.125, 0.003, hex("#7fe0c0"), RLA, 0.9);
  }else if(sp.prop === "case"){
    box(g, shX + 0.02, handY - 0.2 * s, 0.0, 0.06, 0.3, 0.42, hex("#2a1f16"), LLA);
    box(g, shX + 0.02, handY - 0.03 * s, 0.0, 0.015, 0.03, 0.16, hex("#111"), LLA);
  }else if(sp.prop === "bag"){
    box(g, shX + 0.1, hipY - 0.06, -0.02, 0.1, 0.24, 0.32, hex(pick(["#2a1f16", "#6b2b3a", "#22304a", "#8a6a4a"])), CHEST);
    box(g, shX + 0.03, shY - 0.08, -0.02, 0.012, 0.2, 0.05, hex("#222"), CHEST);
  }else if(sp.prop === "papers"){
    box(g, shX, wy, 0.03, 0.2, 0.27, 0.01, hex("#f1efe8"), LLA);
  }
  return {g:g, piv:piv, hipY:hipY, shY:shY, headY:headY};
}

/* =========================================================
   ریاضی ماتریس (ستونی)
========================================================= */
function rx3(a){ const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; }
function ry3(a){ const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
function rz3(a){ const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; }
function mul3(a, b){
  const o = new Array(9);
  for(let c = 0; c < 3; c++) for(let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}
/* ماتریس ۴×۴ چرخش حول محور مفصل: [R | P - R·P] */
function local(out, R, Pv){
  out[0] = R[0]; out[1] = R[1]; out[2] = R[2]; out[3] = 0;
  out[4] = R[3]; out[5] = R[4]; out[6] = R[5]; out[7] = 0;
  out[8] = R[6]; out[9] = R[7]; out[10] = R[8]; out[11] = 0;
  out[12] = Pv[0] - (R[0] * Pv[0] + R[3] * Pv[1] + R[6] * Pv[2]);
  out[13] = Pv[1] - (R[1] * Pv[0] + R[4] * Pv[1] + R[7] * Pv[2]);
  out[14] = Pv[2] - (R[2] * Pv[0] + R[5] * Pv[1] + R[8] * Pv[2]);
  out[15] = 1;
}
function mul4(o, a, b){
  for(let c = 0; c < 4; c++) for(let r = 0; r < 4; r++){
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
}
const TMP = new Float32Array(16), TMP2 = new Float32Array(16);

/* =========================================================
   رفتار: حالت‌های ایستادن، راه رفتن و ژست‌ها
========================================================= */
const ARM = {
  idle:    {L:{p:0.0, a:0.07, f:0.22, y:0},   R:{p:0.0, a:0.07, f:0.22, y:0}},
  clasp:   {L:{p:0.42, a:0.0, f:1.05, y:0.55}, R:{p:0.42, a:0.0, f:1.05, y:0.55}},
  pocket:  {L:{p:-0.18, a:0.12, f:0.55, y:0.0}, R:{p:-0.18, a:0.12, f:0.55, y:0.0}},
  pointR:  {L:{p:0.0, a:0.07, f:0.22, y:0},  R:{p:1.35, a:0.18, f:0.12, y:0.05}},
  pointL:  {L:{p:1.35, a:0.18, f:0.12, y:0.05}, R:{p:0.0, a:0.07, f:0.22, y:0}},
  chin:    {L:{p:0.3, a:-0.05, f:1.95, y:0.95}, R:{p:0.62, a:0.0, f:2.15, y:0.35}},
  crossed: {L:{p:0.38, a:-0.12, f:2.0, y:1.05}, R:{p:0.38, a:-0.12, f:2.0, y:1.05}},
  tablet:  {L:{p:0.55, a:0.0, f:1.55, y:0.5},  R:{p:0.58, a:0.0, f:1.5, y:0.5}},
  phone:   {L:{p:0.0, a:0.07, f:0.22, y:0},  R:{p:0.75, a:0.0, f:1.95, y:0.45}}
};
function posesFor(a){
  const sp = a.spec;
  if(sp.prop === "tablet") return [["tablet", 6], ["idle", 1], ["chin", 1]];
  if(sp.prop === "phone") return [["phone", 6], ["idle", 1], ["pointR", 1]];
  if(sp.prop === "case") return [["idle", 4], ["pocket", 1]];
  if(sp.prop === "papers") return [["idle", 3], ["pocket", 1]];
  return [["idle", 3], ["clasp", 2], ["pocket", 2], ["pointR", 1.4], ["pointL", 1], ["chin", 1.4], ["crossed", 1.6]];
}
function setPose(a, name){
  const P = ARM[name], t = a.target;
  t.L = P.L; t.R = P.R; a.poseName = name;
  a.headDown = (name === "tablet" || name === "phone") ? 0.32 : 0;
}

/* =========================================================
   WebGL: برنامه‌ی سایه‌زن آدم‌ها و لکه‌ی سایه‌ی زیر پا
========================================================= */
const VS = "attribute vec3 aPos;attribute vec3 aNor;attribute vec4 aCol;attribute float aBone;uniform mat4 uVP;uniform mat4 uB[" + NB + "];uniform float uMirror;varying vec3 vN;varying vec4 vC;varying vec3 vW;varying float vMir;" +
  "void main(){vMir=uMirror;mat4 M=uB[int(aBone+0.5)];vec4 wp=M*vec4(aPos,1.0);vec3 n=(M*vec4(aNor,0.0)).xyz;if(uMirror>0.5){wp.y=-wp.y;n.y=-n.y;}vW=wp.xyz;vN=n;vC=aCol;gl_Position=uVP*wp;}";
const FS = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nuniform vec3 uEye;uniform vec3 uFog;uniform float uFogD;varying vec3 vN;varying vec4 vC;varying vec3 vW;varying float vMir;" +
  "void main(){vec3 n=normalize(vN);vec3 L=normalize(vec3(0.25,0.9,0.35));float hemi=0.5+0.5*n.y;float d=max(dot(n,L),0.0);vec3 base=vC.rgb;" +
  "vec3 col=base*(0.34+0.36*hemi+0.40*d);vec3 V=normalize(uEye-vW);float rim=pow(1.0-max(dot(n,V),0.0),3.0);col+=vec3(0.60,0.48,0.30)*rim*0.20;" +
  "col=mix(col,base*1.25,vC.a);float dist=length(vW-uEye);float f=1.0-exp(-pow(uFogD*dist,2.0));col=mix(col,uFog,f);if(vMir>0.5){col*=0.55;}gl_FragColor=vec4(col,1.0);}";
const VSB = "attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uVP;varying vec2 vUV;void main(){vUV=aUV;gl_Position=uVP*vec4(aPos,1.0);}";
const FSB = "precision mediump float;varying vec2 vUV;void main(){float d=length(vUV*2.0-1.0);float a=(1.0-smoothstep(0.15,1.0,d))*0.5;gl_FragColor=vec4(0.0,0.0,0.0,a);}";

function compile(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("crowd shader: " + gl.getShaderInfoLog(s));
  return s;
}
function link(vs, fs, attrs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  attrs.forEach(function(n, i){ gl.bindAttribLocation(p, i, n); });
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("crowd link: " + gl.getProgramInfoLog(p));
  return p;
}

/* =========================================================
   جای ایستادن، مسیر و حرکت
========================================================= */
function boardOf(i){ return api.boards[i]; }
function slotNear(bi, avoid){
  const d = boardOf(bi), r = [d.nz, -d.nx], hw = d.w / 2;
  for(let k = 0; k < 40; k++){
    const s = rr(-0.86, 0.86) * hw, dd = rr(3.0, 6.4);
    const x = d.cx + r[0] * s + d.nx * dd, z = d.cz + r[1] * s + d.nz * dd;
    if(!insideHall(x, z, 1.0)) continue;
    if(inStatic(x, z, 0.9)) continue;
    if(Math.hypot(x - 0, z - 13.5) < 2.2) continue;
    let ok = true;
    for(let j = 0; j < avoid.length; j++) if(Math.hypot(avoid[j][0] - x, avoid[j][1] - z) < 1.0){ ok = false; break; }
    if(ok) return [x, z];
  }
  return null;
}
function insideHall(x, z, m){ const B = api.bounds; return x > -B.HX + m && x < B.HX - m && z > B.ZF + m && z < B.ZN - m; }
function inStatic(x, z, m){
  const C = api.colliders;
  for(let i = 0; i < C.length; i++){ const b = C[i]; if(x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m) return true; }
  return false;
}
const LANE = 12.6, CROSS = [10, -8, -30, -58];
function planPath(from, to){
  const path = [];
  const sideF = Math.abs(from[0]) > 11 ? Math.sign(from[0]) : (to[0] >= 0 ? 1 : -1);
  const sideT = Math.abs(to[0]) > 11 ? Math.sign(to[0]) : sideF;
  if(Math.abs(from[0]) < LANE - 0.8) path.push([sideF * LANE, from[1]]);
  if(sideF !== sideT){
    const mid = (from[1] + to[1]) / 2; let zc = CROSS[0];
    CROSS.forEach(function(c){ if(Math.abs(c - mid) < Math.abs(zc - mid)) zc = c; });
    path.push([sideF * LANE, zc]); path.push([sideT * LANE, zc]);
  }
  path.push([sideT * LANE, to[1]]);
  path.push(to);
  return path;
}
function chooseBoard(a){
  let t = 0; const w = api.boards.map(function(d, i){ const v = d.w * (i === a.board ? 0.2 : 1); t += v; return v; });
  let x = rnd() * t;
  for(let i = 0; i < w.length; i++){ x -= w[i]; if(x <= 0) return i; }
  return 0;
}
function sendTo(a, bi){
  const avoid = agents.map(function(o){ return o.dest || [o.x, o.z]; });
  const s = slotNear(bi, avoid);
  if(!s) return false;
  a.board = bi; a.dest = s; a.path = planPath([a.x, a.z], s); a.state = "walk"; a.stay = rr(25, 80);
  return true;
}

/* =========================================================
   ساخت و بارگذاری
========================================================= */
function upload(a, built){
  const g = built.g, n = g.p.length / 3, data = new Float32Array(n * 11);
  for(let i = 0; i < n; i++){
    data[i * 11] = g.p[i * 3]; data[i * 11 + 1] = g.p[i * 3 + 1]; data[i * 11 + 2] = g.p[i * 3 + 2];
    data[i * 11 + 3] = g.n[i * 3]; data[i * 11 + 4] = g.n[i * 3 + 1]; data[i * 11 + 5] = g.n[i * 3 + 2];
    data[i * 11 + 6] = g.c[i * 4]; data[i * 11 + 7] = g.c[i * 4 + 1]; data[i * 11 + 8] = g.c[i * 4 + 2]; data[i * 11 + 9] = g.c[i * 4 + 3];
    data[i * 11 + 10] = g.b[i];
  }
  a.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, a.vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  a.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, a.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.i), gl.STATIC_DRAW);
  a.count = g.i.length; a.verts = n;
}

function init(opts){
  api = opts; gl = opts.gl; low = !!opts.lowQ;
  rngState = 20261016;
  P = link(VS, FS, ["aPos", "aNor", "aCol", "aBone"]);
  ["uVP", "uMirror", "uEye", "uFog", "uFogD"].forEach(function(n){ U[n] = gl.getUniformLocation(P, n); });
  U.uB = gl.getUniformLocation(P, "uB[0]");
  PB = link(VSB, FSB, ["aPos", "aUV"]);
  UB.uVP = gl.getUniformLocation(PB, "uVP");

  const size = typeof opts.size === "number" ? opts.size : 1;
  const scarfProb = typeof opts.scarf === "number" ? opts.scarf : 0.6;
  const scale = (low ? 0.55 : 1) * size;
  const per = api.boards.map(function(d){ return Math.max(2, Math.round(d.w / 2.7 * scale)); });
  const roamers = Math.round(8 * scale);
  const total = per.reduce(function(a, b){ return a + b; }, 0) + roamers;
  agents = [];
  let gi = 0;
  const place = function(bi){
    const avoid = agents.map(function(o){ return [o.x, o.z]; });
    const s = slotNear(bi, avoid);
    if(!s) return null;
    const gender = (gi++ % 2 === 0) !== (rnd() < 0.15) ? "f" : "m";
    const spec = makeSpec(gender, scarfProb), built = buildPerson(spec);
    const a = {spec:spec, built:built, board:bi, x:s[0], z:s[1], yaw:0, vx:0, vz:0, speed:0, phase:rnd() * 6.28, state:"stand", stay:rr(6, 70),
      path:[], dest:null, target:{L:ARM.idle.L, R:ARM.idle.R}, cur:{L:Object.assign({}, ARM.idle.L), R:Object.assign({}, ARM.idle.R)},
      poseT:rr(1, 8), headYaw:0, headTarget:0, glanceT:rr(2, 9), headPitch:0, headDown:0, breath:rnd() * 6.28, bones:null, views:null, moveBlend:0, walkSpeed:rr(1.05, 1.4)};
    upload(a, built);
    a.bones = new Float32Array(NB * 16); a.views = []; for(let q = 0; q < NB; q++) a.views.push(new Float32Array(a.bones.buffer, q * 64, 16));
    a.built = null;
    a.piv = built.piv;
    setPose(a, "idle");
    agents.push(a);
    a.yaw = faceBoard(a);
    return a;
  };
  api.boards.forEach(function(d, bi){ for(let k = 0; k < per[bi]; k++) place(bi); });
  for(let k = 0; k < roamers; k++){ const bi = Math.floor(rnd() * api.boards.length); const a = place(bi); if(a){ a.stay = rr(1, 6); } }
  agents.forEach(function(a){ setPose(a, pickW(posesFor(a))); Object.keys(a.cur).forEach(function(k){ Object.assign(a.cur[k], a.target[k]); }); });
  blobData = new Float32Array(agents.length * 6 * 5);
  blobBuf = gl.createBuffer();
  ready = true;
}

function faceBoard(a){
  const d = boardOf(a.board);
  return Math.atan2(d.cx - a.x, d.cz - a.z);
}

/* =========================================================
   به‌روزرسانی هر فریم
========================================================= */
function wrapA(x){ while(x > Math.PI) x -= 2 * Math.PI; while(x < -Math.PI) x += 2 * Math.PI; return x; }
function ease(cur, tgt, k){ return cur + (tgt - cur) * k; }

function update(dt, t, player){
  if(!ready) return;
  const px = player[0], pz = player[2];
  for(let i = 0; i < agents.length; i++){
    const a = agents[i];
    /* حالت‌ها */
    if(a.state === "stand"){
      a.stay -= dt;
      if(a.stay <= 0){ if(!sendTo(a, chooseBoard(a))) a.stay = rr(10, 30); }
    }else if(a.state === "walk"){
      const wp = a.path[0];
      if(!wp){ a.state = "stand"; a.stay = rr(25, 80); }
      else{
        const dx = wp[0] - a.x, dz = wp[1] - a.z, d = Math.hypot(dx, dz);
        if(d < 0.45 && a.path.length > 1){ a.path.shift(); }
        else if(d < 0.12){ a.path.shift(); }
        else{
          const want = a.walkSpeed * (a.path.length === 1 ? clamp(d / 1.2, 0.35, 1) : 1);
          a.vx = ease(a.vx, dx / d * want, Math.min(1, dt * 4)); a.vz = ease(a.vz, dz / d * want, Math.min(1, dt * 4));
        }
      }
    }
    if(a.state === "stand"){ a.vx = ease(a.vx, 0, Math.min(1, dt * 5)); a.vz = ease(a.vz, 0, Math.min(1, dt * 5)); }
    /* فاصله از بازدیدکننده و از دیگران */
    let ax = 0, az = 0;
    const pd = Math.hypot(a.x - px, a.z - pz);
    if(pd < 1.35){ const k = (1.35 - pd) / 1.35 * 2.4; ax += (a.x - px) / (pd || 1) * k; az += (a.z - pz) / (pd || 1) * k; }
    for(let j = 0; j < agents.length; j++){
      if(j === i) continue;
      const o = agents[j], dx = a.x - o.x, dz = a.z - o.z, d2 = dx * dx + dz * dz;
      if(d2 < 0.64 && d2 > 1e-6){ const d = Math.sqrt(d2), k = (0.8 - d) / 0.8 * 1.6; ax += dx / d * k; az += dz / d * k; }
    }
    let mx = a.vx + ax, mz = a.vz + az;
    const nx0 = a.x + mx * dt, nz0 = a.z + mz * dt;
    let nx = nx0, nz = nz0;
    const B = api.bounds; nx = clamp(nx, -B.HX + 0.5, B.HX - 0.5); nz = clamp(nz, B.ZF + 0.5, B.ZN - 0.5);
    const C = api.colliders;
    for(let k = 0; k < C.length; k++){
      const b = C[k], m = 0.4;
      if(nx > b[0] - m && nx < b[2] + m && nz > b[1] - m && nz < b[3] + m){
        const d1 = nx - (b[0] - m), d2 = (b[2] + m) - nx, d3 = nz - (b[1] - m), d4 = (b[3] + m) - nz, mm = Math.min(d1, d2, d3, d4);
        if(mm === d1) nx = b[0] - m; else if(mm === d2) nx = b[2] + m; else if(mm === d3) nz = b[1] - m; else nz = b[3] + m;
      }
    }
    a.x = nx; a.z = nz;
    const sp = Math.hypot(mx, mz);
    a.speed = ease(a.speed, sp, Math.min(1, dt * 6));
    /* جهت بدن */
    let wantYaw;
    if(a.speed > 0.4 && a.state === "walk") wantYaw = Math.atan2(mx, mz); else wantYaw = faceBoard(a);
    a.yaw += wrapA(wantYaw - a.yaw) * Math.min(1, dt * (a.speed > 0.4 ? 6 : 2.5));
    a.walk = clamp((a.speed - 0.15) / 0.6, 0, 1);
    a.phase += dt * (Math.PI * 2 * Math.max(a.speed, 0.3) / 1.45);

    /* ژست‌ها */
    a.poseT -= dt;
    if(a.poseT <= 0){ setPose(a, pickW(posesFor(a))); a.poseT = rr(5, 15); }
    const k = Math.min(1, dt * 3.5);
    ["L", "R"].forEach(function(s){ const c = a.cur[s], g = a.target[s]; c.p = ease(c.p, g.p, k); c.a = ease(c.a, g.a, k); c.f = ease(c.f, g.f, k); c.y = ease(c.y, g.y, k); });
    /* نگاه */
    a.glanceT -= dt;
    if(a.glanceT <= 0){ a.glanceT = rr(2.5, 9); a.headTarget = rnd() < 0.45 ? rr(-0.9, 0.9) : rr(-0.28, 0.28); }
    a.headYaw = ease(a.headYaw, a.headTarget + Math.sin(t * 0.5 + a.breath) * 0.06, Math.min(1, dt * 3));
    const d = boardOf(a.board), dist = Math.hypot(d.cx - a.x, d.cz - a.z);
    const up = Math.atan2(d.cy - 1.6, Math.max(dist, 2)) * 0.85;
    a.headPitch = ease(a.headPitch, a.walk > 0.5 ? 0.05 : (up - a.headDown * 0), Math.min(1, dt * 3));
    poseSkin(a, t);
  }
}

function poseSkin(a, t){
  const sw = a.walk, ph = a.phase, S = a.bones, piv = a.piv;
  const sway = Math.sin(t * 0.6 + a.breath) * (1 - sw), br = Math.sin(t * 1.5 + a.breath) * 0.004;
  /* ریشه */
  const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
  const bob = sw * (0.022 * Math.cos(2 * ph)) + br;
  const rootR = mul3(ry3(a.yaw), mul3(rz3(sway * 0.018 + sw * Math.sin(ph) * 0.03), rx3(0)));
  const W = new Float32Array(16);
  W[0] = rootR[0]; W[1] = rootR[1]; W[2] = rootR[2]; W[4] = rootR[3]; W[5] = rootR[4]; W[6] = rootR[5]; W[8] = rootR[6]; W[9] = rootR[7]; W[10] = rootR[8];
  W[12] = a.x + sway * 0.012 * cy; W[13] = bob; W[14] = a.z - sway * 0.012 * sy; W[15] = 1;
  const rot = new Array(NB);
  const stand = 1 - sw;
  rot[PELVIS] = mul3(ry3(sw * Math.sin(ph) * 0.07), rz3(0));
  rot[CHEST] = mul3(ry3(-sw * Math.sin(ph) * 0.1 + sway * 0.015), rx3(-0.01 + stand * 0.0));
  /* سر: چرخش و بالا/پایین */
  const hp = a.headPitch - a.headDown;
  rot[HEAD] = mul3(ry3(a.headYaw), rx3(-hp));
  /* دست‌ها */
  const armRot = function(s, side){
    const c = a.cur[side === 1 ? "L" : "R"];
    const swing = sw * 0.38 * Math.sin(ph + (side === 1 ? Math.PI : 0));
    const ua = mul3(rz3(side * c.a), rx3(-(c.p * (1 - sw * 0.9) + swing)));
    const fl = mul3(ry3(-side * c.y * (1 - sw * 0.9)), rx3(-(c.f * (1 - sw * 0.85) + sw * (0.28 + 0.2 * Math.max(0, Math.sin(ph + (side === 1 ? Math.PI : 0)))))));
    return [ua, fl];
  };
  const l = armRot(0, 1), r = armRot(0, -1);
  rot[LUA] = l[0]; rot[LLA] = l[1]; rot[RUA] = r[0]; rot[RLA] = r[1];
  /* پاها */
  const legRot = function(side){
    const p = ph + (side === 1 ? 0 : Math.PI);
    const hip = sw * 0.46 * Math.sin(p) + stand * (side === 1 ? 0.03 : -0.02) * Math.sin(t * 0.3 + a.breath);
    const knee = sw * (0.08 + 0.85 * Math.pow(Math.max(0, Math.cos(p)), 2)) + stand * 0.04;
    return [rx3(-hip), rx3(knee)];
  };
  const ll = legRot(1), rl = legRot(-1);
  rot[LUL] = ll[0]; rot[LLL] = ll[1]; rot[RUL] = rl[0]; rot[RLL] = rl[1];
  for(let i = 0; i < NB; i++){
    local(TMP, rot[i], piv[i]);
    const p = PARENT[i];
    if(p < 0) mul4(a.views[i], W, TMP);
    else mul4(a.views[i], a.views[p], TMP);
  }
}

/* =========================================================
   نقاشی
========================================================= */
function bindAttrs(a){
  gl.bindBuffer(gl.ARRAY_BUFFER, a.vbo);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 44, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 44, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 44, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 44, 40);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, a.ibo);
}
function visible(a, eye, fwd, maxD){
  const dx = a.x - eye[0], dz = a.z - eye[2], d2 = dx * dx + dz * dz;
  if(d2 > maxD * maxD) return false;
  const d = Math.sqrt(d2) || 1;
  if(d > 3 && (dx * fwd[0] + dz * fwd[1]) / d < -0.35) return false;
  return true;
}
function render(vp, eye, mirror, fwd, fog, fogD){
  if(!ready) return;
  gl.useProgram(P);
  gl.uniformMatrix4fv(U.uVP, false, vp);
  gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]);
  gl.uniform3f(U.uFog, fog[0], fog[1], fog[2]);
  gl.uniform1f(U.uFogD, fogD);
  gl.uniform1f(U.uMirror, mirror ? 1 : 0);
  const maxD = mirror ? 40 : 85;
  for(let i = 0; i < agents.length; i++){
    const a = agents[i];
    if(!visible(a, eye, fwd, maxD)) continue;
    bindAttrs(a);
    gl.uniformMatrix4fv(U.uB, false, a.bones);
    gl.drawElements(gl.TRIANGLES, a.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.disableVertexAttribArray(3);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}
function renderBlobs(vp, eye, fwd){
  if(!ready) return;
  let n = 0;
  for(let i = 0; i < agents.length; i++){
    const a = agents[i];
    if(!visible(a, eye, fwd, 85)) continue;
    const r = 0.46, y = 0.03, x = a.x, z = a.z, o = n * 30;
    const v = [[x - r, y, z - r, 0, 0], [x + r, y, z - r, 1, 0], [x + r, y, z + r, 1, 1], [x - r, y, z - r, 0, 0], [x + r, y, z + r, 1, 1], [x - r, y, z + r, 0, 1]];
    v.forEach(function(q, k){ blobData.set(q, o + k * 5); });
    n++;
  }
  if(!n) return;
  gl.useProgram(PB);
  gl.uniformMatrix4fv(UB.uVP, false, vp);
  gl.bindBuffer(gl.ARRAY_BUFFER, blobBuf);
  gl.bufferData(gl.ARRAY_BUFFER, blobData.subarray(0, n * 30), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(3);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, n * 6);
  gl.depthMask(true); gl.disable(gl.BLEND);
}

/* بازدیدکننده از میان آدم‌ها رد نمی‌شود */
function collidePlayer(x, z){
  if(!ready) return [x, z];
  const R = 0.5 + 0.3;
  for(let i = 0; i < agents.length; i++){
    const a = agents[i], dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz);
    if(d < R){ const k = d > 1e-5 ? R / d : 1; x = d > 1e-5 ? a.x + dx * k : a.x + R; z = d > 1e-5 ? a.z + dz * k : a.z; }
  }
  return [x, z];
}

window.MirzaCrowd = {
  init:init, update:update, render:render, renderBlobs:renderBlobs, collidePlayer:collidePlayer,
  isReady:function(){ return ready; },
  stats:function(){ let v = 0, f = 0, m = 0, walk = 0; agents.forEach(function(a){ v += a.verts; if(a.spec.gender === "f") f++; else m++; if(a.state === "walk") walk++; }); return {people:agents.length, women:f, men:m, walking:walk, vertices:v}; },
  _agents:function(){ return agents; }
};
})();
