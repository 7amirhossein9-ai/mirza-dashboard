"use strict";
/* =========================================================
   تالار سه‌بعدی میرزا
   WebGL خام؛ بدون هیچ کتابخانه‌ی بیرونی (نه three.js، نه CDN).
   بازدیدکننده داخل یک تالار بلند راه می‌رود:
     جلو: تابلوی بازار ایران  |  چپ: ارز دیجیتال  |  راست: بازارهای جهانی
     جلوتر: تحلیل کشورها (چپ: اخبار، راست: سخنان مقامات)
     انتها: تحلیل فنی (چپ: نبض بازار، راست: درباره‌ی میرزا)
   همه‌ی تابلوها از همان داده‌های زنده‌ی داشبورد (quotes، iran، cs، news، st، chart) خوانده می‌شوند.
========================================================= */
(function(){

/* ---------- رنگ‌ها و فونت ---------- */
const COL = {text:"#f3f3f3", muted:"#8a93a0", gold:"#e7c461", up:"#3ac879", down:"#ef5350", warn:"#f0a53a", blue:"#4aa3ff", card:"#111823", line:"#252d3a"};
const FONT = "Vazirmatn, Tahoma, 'DejaVu Sans', Arial, sans-serif";
const LW = 2048, LH = 1024;                 /* اندازه‌ی منطقی بوم هر تابلو */

/* ---------- ابعاد تالار (متر) ---------- */
const HX = 20, ZN = 20, ZF = -80, HY = 11;

/* ---------- وضعیت ---------- */
let canvas, gl, prog, U = {}, A = {};
let opened = false, inited = false, raf = 0, lastT = 0, clock = 0;
let W = 0, H = 0, dpr = 1, lowQ = false;
const meshes = [];          /* {vbo,count,mat} */
const boards = [];
const colliders = [];
const stations = [];
let TX = {};                /* بافت‌های ثابت */
const pos = [0, 1.7, 13];
let yaw = 0, pitch = 0.0, walkPh = 0;
const keys = {};
const joy = {x:0, y:0, id:null, sx:0, sy:0};
let lookTouch = null;
let glide = null, tour = null, curStation = 0;
let hallOpenedAt = 0;      /* زمان اولین ورود؛ برای پیام «منبع پاسخ نمی‌دهد» */
let activeBoard = null;
let locked = false, dragging = false;
const crypto_ = {t:0, list:null, err:""};
let anisoExt = null, anisoMax = 1;
let fontsReady = false;
let crowdOn = false;       /* آدم‌های تالار (crowd3d.js) */

/* =========================================================
   ریاضی ماتریس (ستونی)
========================================================= */
function mul(a, b){
  const o = new Float32Array(16);
  for(let c = 0; c < 4; c++) for(let r = 0; r < 4; r++){
    let s = 0;
    for(let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function persp(fov, asp, n, f){
  const t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
  o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
  return o;
}
function viewM(e, yw, pt){
  const f = [Math.sin(yw) * Math.cos(pt), Math.sin(pt), -Math.cos(yw) * Math.cos(pt)];
  const z = [-f[0], -f[1], -f[2]];
  let x = [z[2], 0, -z[0]];                       /* cross(up, z) با up=(0,1,0) */
  const xl = Math.hypot(x[0], x[1], x[2]) || 1; x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const d = function(a, b){ return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d(x, e), -d(y, e), -d(z, e), 1]);
}
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function ease(t){ return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

/* =========================================================
   ساخت هندسه
========================================================= */
function MB(){ return {p:[], u:[], n:[]}; }
function tri(mb, a, b, c, ua, ub, uc, n){
  mb.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  mb.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  mb.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
}
function quad(mb, a, b, c, d, n, uv){
  uv = uv || [[0, 1], [1, 1], [1, 0], [0, 0]];
  tri(mb, a, b, c, uv[0], uv[1], uv[2], n);
  tri(mb, a, c, d, uv[0], uv[2], uv[3], n);
}
function box(mb, x0, y0, z0, x1, y1, z1){
  quad(mb, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad(mb, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  quad(mb, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  quad(mb, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad(mb, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  quad(mb, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
}
/* mat: mode 0=رنگ ساده با نور، 1=بافت درخشان، 2=بافت با نور، 3=رنگ درخشان */
function commit(mb, mat){
  const n = mb.p.length / 3, data = new Float32Array(n * 8);
  for(let i = 0; i < n; i++){
    data[i * 8] = mb.p[i * 3]; data[i * 8 + 1] = mb.p[i * 3 + 1]; data[i * 8 + 2] = mb.p[i * 3 + 2];
    data[i * 8 + 3] = mb.u[i * 2]; data[i * 8 + 4] = mb.u[i * 2 + 1];
    data[i * 8 + 5] = mb.n[i * 3]; data[i * 8 + 6] = mb.n[i * 3 + 1]; data[i * 8 + 7] = mb.n[i * 3 + 2];
  }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const m = Object.assign({mode:0, color:[1, 1, 1], tex:null, alpha:1, kind:"solid", reflect:false, pulse:0}, mat);
  meshes.push({vbo:vbo, count:n, mat:m});
  return meshes[meshes.length - 1];
}

/* =========================================================
   بافت‌ها
========================================================= */
function makeTex(c, repeat){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  if(anisoExt) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, anisoMax));
  return t;
}
function reupload(tex, c){
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
}
function cv(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

function buildStaticTextures(){
  /* کف: سنگ تیره با خطوط طلایی ظریف */
  let c = cv(512, 512), x = c.getContext("2d");
  let g = x.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, "#161c27"); g.addColorStop(1, "#0d121b");
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  for(let i = 0; i < 1400; i++){ x.fillStyle = "rgba(255,255,255," + (Math.random() * 0.025) + ")"; x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  x.strokeStyle = "rgba(231,196,97,0.35)"; x.lineWidth = 3; x.strokeRect(1.5, 1.5, 509, 509);
  x.strokeStyle = "rgba(231,196,97,0.10)"; x.lineWidth = 1;
  x.beginPath(); x.moveTo(256, 0); x.lineTo(256, 512); x.moveTo(0, 256); x.lineTo(512, 256); x.stroke();
  TX.floor = makeTex(c, true);

  /* دیوار: پنل‌های عمودی */
  c = cv(256, 256); x = c.getContext("2d");
  g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, "#1a2130"); g.addColorStop(1, "#0f141d");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.fillStyle = "rgba(0,0,0,0.35)"; x.fillRect(0, 0, 4, 256); x.fillRect(252, 0, 4, 256);
  x.fillStyle = "rgba(231,196,97,0.18)"; x.fillRect(4, 0, 1, 256);
  x.fillStyle = "rgba(231,196,97,0.12)"; x.fillRect(0, 250, 256, 2);
  TX.wall = makeTex(c, true);

  /* هاله‌ی نرم */
  c = cv(128, 128); x = c.getContext("2d");
  g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  TX.glow = makeTex(c, false);

  /* سفید ساده */
  c = cv(4, 4); x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 4, 4);
  TX.white = makeTex(c, true);
}

/* =========================================================
   ابزار نقاشی روی بوم تابلوها
========================================================= */
function T(c, txt, x, y, o){
  o = o || {};
  txt = String(txt == null ? "" : txt);
  c.save();
  let size = o.s || 36;
  const weight = o.w || 400;
  c.font = weight + " " + size + "px " + FONT;
  c.textBaseline = "middle";
  c.direction = o.dir || "rtl";
  c.textAlign = o.a || (c.direction === "rtl" ? "right" : "left");
  if(o.max){
    while(size > 16 && c.measureText(txt).width > o.max){ size -= 2; c.font = weight + " " + size + "px " + FONT; }
  }
  c.fillStyle = o.c || COL.text;
  c.fillText(txt, x, y);
  c.restore();
}
/* عدد یا متن لاتین: همیشه چپ‌به‌راست و جدا از جمله‌ی فارسی */
function N(c, txt, x, y, o){
  o = Object.assign({dir:"ltr", a:"right"}, o || {});
  T(c, txt, x, y, o);
}
function rrect(c, x, y, w, h, r, fill, stroke){
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  if(fill){ c.fillStyle = fill; c.fill(); }
  if(stroke){ c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
}
function wrapRtl(c, txt, maxW, size, weight, maxLines){
  c.save(); c.font = (weight || 400) + " " + size + "px " + FONT; c.direction = "rtl";
  const words = String(txt).split(/\s+/), lines = []; let cur = "";
  for(let i = 0; i < words.length; i++){
    const t = cur ? cur + " " + words[i] : words[i];
    if(c.measureText(t).width > maxW && cur){ lines.push(cur); cur = words[i]; } else cur = t;
  }
  if(cur) lines.push(cur);
  c.restore();
  if(lines.length > maxLines){
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s*\S*$/, "") + " …";
    return cut;
  }
  return lines;
}
function tehranClock(){
  try{ return new Date().toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit", timeZone:"Asia/Tehran"}); }
  catch(e){ return ""; }
}
function chrome(c, title, sub, accent){
  const g = c.createLinearGradient(0, 0, 0, LH);
  g.addColorStop(0, "#0d121b"); g.addColorStop(1, "#070a10");
  c.fillStyle = g; c.fillRect(0, 0, LW, LH);
  c.strokeStyle = "rgba(231,196,97,0.045)"; c.lineWidth = 1;
  for(let x = 0; x <= LW; x += 64){ c.beginPath(); c.moveTo(x, 150); c.lineTo(x, LH); c.stroke(); }
  for(let y = 150; y <= LH; y += 64){ c.beginPath(); c.moveTo(0, y); c.lineTo(LW, y); c.stroke(); }
  c.fillStyle = "#111823"; c.fillRect(0, 0, LW, 150);
  c.fillStyle = accent || COL.gold; c.fillRect(0, 146, LW, 5);
  T(c, title, 2004, 62, {s:72, w:700, c:COL.gold});
  if(sub) T(c, sub, 2004, 118, {s:32, c:COL.muted, max:1500});
  N(c, tehranClock(), 56, 62, {a:"left", s:46, w:700, c:COL.text});
  c.fillStyle = COL.up; c.beginPath(); c.arc(70, 112, 9, 0, 7); c.fill();
  T(c, "LIVE", 92, 112, {s:28, c:COL.up, dir:"ltr", a:"left", w:700});
  c.strokeStyle = "rgba(231,196,97,0.5)"; c.lineWidth = 6; c.strokeRect(3, 3, LW - 6, LH - 6);
}
function emptyMsg(c, l1, l2){
  /* اگر بیش از ۲۵ ثانیه از ورود گذشته و هنوز داده‌ای نیامده، به‌جای «کمی صبر کنید» علت احتمالی را بگو */
  if(l2 === "کمی صبر کنید…" && hallOpenedAt && Date.now() - hallOpenedAt > 25000){
    l1 = l1.replace("در حال دریافت است", "دریافت نشد");
    l2 = "منبع داده پاسخ نداد (شاید از مرورگر مسدود است). کمی بعد دوباره تلاش می‌شود؛ «داشبورد ساده» را هم می‌توانید ببینید.";
  }
  T(c, l1, LW / 2, 480, {s:64, a:"center", c:COL.text, w:700});
  if(l2) T(c, l2, LW / 2, 580, {s:38, a:"center", c:COL.muted, max:1700});
  c.fillStyle = COL.gold;
  for(let i = 0; i < 3; i++){ c.beginPath(); c.arc(LW / 2 - 40 + i * 40, 680, 9, 0, 7); c.fill(); }
}
function dirCol(v){ return v > 0 ? COL.up : v < 0 ? COL.down : COL.muted; }
function arrow(v){ return v > 0 ? "▲ " : v < 0 ? "▼ " : "● "; }
function strip(s){ return String(s || "").replace(/<[^>]+>/g, ""); }

/* =========================================================
   ابزارهای رسم نمودار روی بوم تابلوها
========================================================= */
const PAL = ["#e7c461", "#4aa3ff", "#3ac879", "#c77dff", "#ff9f43", "#26c6da", "#f06292", "#9ccc65"];
function faNum(n){ return Number.isFinite(n) ? n.toLocaleString("en-US") : "—"; }
function bigNum(v){
  if(v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if(a >= 1e12) return (v / 1e12).toFixed(2) + "T";
  if(a >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if(a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  return faNum(Math.round(v));
}
function pctTxt(p, d){ return p == null || !Number.isFinite(p) ? "—" : (p > 0 ? "+" : p < 0 ? "-" : "") + Math.abs(p).toFixed(d == null ? 2 : d) + "%"; }

/* نمودار خطی کوچک (اسپارک‌لاین). اگر داده نباشد false برمی‌گرداند */
function spark(c, vals, x, y, w, h, col, o){
  o = o || {};
  if(!vals || vals.length < 2) return false;
  let lo = Infinity, hi = -Infinity;
  vals.forEach(function(v){ if(Number.isFinite(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  if(!Number.isFinite(lo)) return false;
  if(hi === lo){ hi += 1; lo -= 1; }
  const n = vals.length;
  const X = function(i){ return x + w * i / (n - 1); }, Y = function(v){ return y + h - (v - lo) / (hi - lo) * h; };
  col = col || dirCol(vals[n - 1] - vals[0]);
  if(o.fill !== false){
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, col + "55"); g.addColorStop(1, col + "00");
    c.beginPath(); c.moveTo(X(0), y + h);
    vals.forEach(function(v, i){ c.lineTo(X(i), Y(v)); });
    c.lineTo(X(n - 1), y + h); c.closePath(); c.fillStyle = g; c.fill();
  }
  c.beginPath();
  vals.forEach(function(v, i){ i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); });
  c.strokeStyle = col; c.lineWidth = o.lw || 3; c.lineJoin = "round"; c.stroke();
  c.fillStyle = col; c.beginPath(); c.arc(X(n - 1), Y(vals[n - 1]), (o.lw || 3) + 1.5, 0, 7); c.fill();
  return true;
}
/* میله‌ی دامنه‌ی روز: جای قیمت میان کمترین و بیشترین */
function rangeBar(c, lo, hi, price, x, y, w, col){
  c.fillStyle = "#1c2430"; rrect(c, x, y, w, 12, 6, "#1c2430");
  if(!(hi > lo)) return;
  const p = clamp((price - lo) / (hi - lo), 0, 1);
  const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, COL.down); g.addColorStop(0.5, COL.warn); g.addColorStop(1, COL.up);
  rrect(c, x, y, w, 12, 6, g);
  c.fillStyle = "#fff"; c.beginPath(); c.arc(x + w * p, y + 6, 11, 0, 7); c.fill();
  c.strokeStyle = col || COL.gold; c.lineWidth = 4; c.stroke();
}
/* حلقه‌ی سهم‌ها */
function donut(c, cx, cy, r, r2, parts){
  const tot = parts.reduce(function(a, p){ return a + Math.max(0, p.v); }, 0) || 1;
  let a0 = -Math.PI / 2;
  parts.forEach(function(p){
    const a1 = a0 + Math.max(0, p.v) / tot * Math.PI * 2;
    c.beginPath(); c.arc(cx, cy, r, a0, a1); c.arc(cx, cy, r2, a1, a0, true); c.closePath();
    c.fillStyle = p.c; c.fill(); c.strokeStyle = "#0d121b"; c.lineWidth = 3; c.stroke();
    a0 = a1;
  });
}
/* ساعت گرایش بازار؛ v بین ۱- تا ۱+ */
function gauge(c, cx, cy, r, v){
  const segs = [[COL.down, 0], [COL.warn, 0.5], [COL.up, 1]];
  for(let i = 0; i < 36; i++){
    const t0 = i / 36, t1 = (i + 1) / 36 - 0.004;
    const a0 = Math.PI + t0 * Math.PI, a1 = Math.PI + t1 * Math.PI;
    const k = (t0 + t1) / 2;
    const col = k < 0.5 ? mix(COL.down, COL.warn, k / 0.5) : mix(COL.warn, COL.up, (k - 0.5) / 0.5);
    c.beginPath(); c.arc(cx, cy, r, a0, a1); c.arc(cx, cy, r - 46, a1, a0, true); c.closePath(); c.fillStyle = col; c.fill();
  }
  const ang = Math.PI + (clamp(v, -1, 1) + 1) / 2 * Math.PI;
  c.strokeStyle = "#f3f3f3"; c.lineWidth = 10; c.lineCap = "round";
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang) * (r - 14), cy + Math.sin(ang) * (r - 14)); c.stroke(); c.lineCap = "butt";
  c.fillStyle = "#f3f3f3"; c.beginPath(); c.arc(cx, cy, 20, 0, 7); c.fill();
  c.fillStyle = "#111823"; c.beginPath(); c.arc(cx, cy, 9, 0, 7); c.fill();
}
function hex2rgb(h){ return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(a, b, t){
  const x = hex2rgb(a), y = hex2rgb(b);
  return "rgb(" + [0, 1, 2].map(function(i){ return Math.round(x[i] + (y[i] - x[i]) * t); }).join(",") + ")";
}
/* چیپ کوچک عددی */
function chip(c, xr, y, label, val, col){
  const w = 250, h = 62;
  rrect(c, xr - w, y, w, h, 12, "#0f1520");
  T(c, label, xr - 14, y + 18, {s:22, c:COL.muted, max:w - 28});
  N(c, val, xr - 14, y + 44, {s:30, w:700, c:col || COL.text, max:w - 28});
}
/* سطر یک بازار: نام | قیمت | درصد | نمودار */
function marketRow(c, colR, y, h, o){
  rrect(c, colR - 940, y, 940, h - 12, 18, COL.card);
  c.fillStyle = o.accent || dirCol(o.pct); c.fillRect(colR - 8, y + 14, 8, h - 40);
  T(c, o.name, colR - 28, y + (o.sub ? 32 : (h - 12) / 2), {s:42, w:700, max:290});
  if(o.sub) T(c, o.sub, colR - 28, y + 72, {s:25, c:COL.muted, max:290});
  N(c, o.price, colR - 338, y + (h - 12) / 2, {s:44, w:700, c:COL.gold, max:222});
  if(o.pctTxt != null) N(c, (o.pct != null ? arrow(o.pct) : "") + o.pctTxt, colR - 590, y + (h - 12) / 2, {s:33, w:700, c:dirCol(o.pct), max:150});
  const cx = colR - 925, cw = 165;
  let drew = false;
  if(o.spark && spark(c, o.spark, cx, y + 16, cw, 48, o.sparkCol)){ drew = true; if(o.sparkCap) T(c, o.sparkCap, cx + cw, y + h - 22, {s:19, c:COL.muted, a:"right", max:cw}); }
  else if(o.lo != null && o.hi != null && o.hi > o.lo){
    rangeBar(c, o.lo, o.hi, o.rawPrice, cx + 8, y + 30, cw - 16, o.accent);
    N(c, o.loTxt, cx + 4, y + h - 24, {s:19, c:COL.muted, a:"left", max:80}); N(c, o.hiTxt, cx + cw - 4, y + h - 24, {s:19, c:COL.muted, a:"right", max:80});
    drew = true;
  }
  if(!drew && o.prev != null && o.rawPrice != null){
    spark(c, [o.prev, o.rawPrice], cx, y + 16, cw, 48, null, {lw:4}); T(c, "دیروز ← امروز", cx + cw, y + h - 22, {s:19, c:COL.muted, a:"right"});
  }
}

/* =========================================================
   محتوای تابلوها
========================================================= */
function drawWelcome(c){
  chrome(c, "به میرزا خوش آمدید", "تالار سه‌بعدی بازارهای مالی", COL.gold);
  const img = document.getElementById("logoImg");
  try{ if(img && img.complete && img.naturalWidth) c.drawImage(img, 1690, 180, 300, 300); }catch(e){}
  T(c, "هر اتفاق، یک اثر؛", 1650, 250, {s:56, w:700, a:"right", c:COL.gold, max:560});
  T(c, "هر اثر، یک تحلیل", 1650, 322, {s:56, w:700, a:"right", max:560});
  T(c, "قیمت زنده و تحلیل بازار", 1650, 392, {s:34, c:COL.muted, max:560});
  T(c, "روی تابلوهای این تالار", 1650, 438, {s:34, c:COL.muted, max:560});
  const rows = [["حرکت", ["W", "A", "S", "D"]], ["دویدن", ["Shift"]], ["نگاه کردن", ["ماوس"]], ["جزئیات تابلو", ["E"]], ["پرش به تابلو", ["1", "…", "9"]]];
  rows.forEach(function(r, i){
    const y = 560 + i * 86;
    T(c, r[0], 1990, y, {s:38, w:700});
    let x = 1640;
    r[1].forEach(function(k){
      const w = k.length > 2 ? 150 : 72;
      rrect(c, x - w, y - 30, w, 60, 12, "#1b2331", COL.line);
      if(/[A-Za-z0-9…]/.test(k)) N(c, k, x - w / 2, y, {a:"center", s:32, w:700, c:COL.gold}); else T(c, k, x - w / 2, y, {a:"center", s:30, c:COL.gold});
      x -= w + 12;
    });
  });
  /* چهار کارت زنده با نمودار */
  const feat = ["gold", "btc", "eth", "oil"];
  feat.forEach(function(id, i){
    const m = MARKETS.find(function(x){ return x.id === id; }), q = quotes[id];
    const x = 40 + (i % 2) * 520, y = 180 + Math.floor(i / 2) * 400, w = 500, h = 384;
    rrect(c, x, y, w, h, 20, COL.card);
    c.fillStyle = q ? dirCol(q.pct) : COL.muted; c.fillRect(x + w - 8, y + 18, 8, h - 36);
    T(c, m.name, x + w - 30, y + 46, {s:40, w:700, max:420});
    T(c, m.unit, x + w - 30, y + 90, {s:25, c:COL.muted, max:420});
    if(!q){ T(c, "در حال دریافت…", x + w - 30, y + 190, {s:34, c:COL.muted}); return; }
    N(c, fmt(q.price, m.dec), x + w - 30, y + 160, {s:64, w:700, c:COL.gold, max:440});
    N(c, arrow(q.pct) + pctTxt(q.pct), x + w - 30, y + 222, {s:42, w:700, c:dirCol(q.pct)});
    if(!spark(c, sparkOf(id), x + 30, y + 250, w - 80, 100, null, {lw:4})){
      if(q.lo != null && q.hi != null){ rangeBar(c, q.lo, q.hi, q.price, x + 50, y + 290, w - 120, COL.gold); N(c, fmt(q.lo, m.dec), x + 50, y + 335, {s:22, c:COL.muted, a:"left"}); N(c, fmt(q.hi, m.dec), x + w - 70, y + 335, {s:22, c:COL.muted, a:"right"}); }
    }
  });
}

function drawIran(c){
  const status = document.getElementById("iranStatus");
  chrome(c, "تابلوی بازار ایران", status ? status.textContent : "طلا، سکه، نقره و ارز", COL.gold);
  const oz = quotes.gold ? quotes.gold.price : null, silver = quotes.silver ? quotes.silver.price : null;
  const R = buildIranRows(IRAN_ROWS, iran.cur, manualUsd, oz, silver);
  const list = R.rows.filter(function(r){ return r.market != null; });
  if(!list.length){
    emptyMsg(c, "قیمت بازار ایران هنوز دریافت نشده", "اگر این پیام می‌ماند: منبع tgju.org از مرورگر مسدود است. Cloudflare Worker را وصل کنید یا نرخ دلار را دستی وارد کنید.");
    return;
  }
  list.slice(0, 14).forEach(function(r, i){
    const col = i < 7 ? 2010 : 1000, row = i % 7, y = 180 + row * 112;
    const d = r.def, sp = iranSparkOf(r.id);
    marketRow(c, col, y, 112, {name:d.title, sub:d.sub, price:fmtInt(r.market), pct:r.pct, pctTxt:r.pct != null ? pctTxt(r.pct) : null,
      spark:sp, sparkCap:"روند ثبت‌شده", lo:r.lo, hi:r.hi, rawPrice:r.market, loTxt:fmtInt(r.lo), hiTxt:fmtInt(r.hi)});
  });
  const up = list.filter(function(r){ return r.pct > 0; }).length, dn = list.filter(function(r){ return r.pct < 0; }).length;
  T(c, "واحد قیمت‌ها: تومان", 2004, 992, {s:28, c:COL.muted});
  if(R.usd) { T(c, "دلار", 1600, 992, {s:28, c:COL.muted}); N(c, fmtInt(R.usd), 1540, 992, {s:30, w:700, c:COL.gold}); }
  if(R.oz) { T(c, "اونس جهانی", 1250, 992, {s:28, c:COL.muted}); N(c, "$" + fmt(R.oz, 2), 1130, 992, {s:30, w:700, c:COL.gold}); }
  T(c, "صعودی", 860, 992, {s:28, c:COL.muted}); N(c, String(up), 760, 992, {s:30, w:700, c:COL.up});
  T(c, "نزولی", 700, 992, {s:28, c:COL.muted}); N(c, String(dn), 640, 992, {s:30, w:700, c:COL.down});
  T(c, "تعداد نمونه‌ی ثبت‌شده", 500, 992, {s:28, c:COL.muted}); N(c, String(iranHist.t.length), 190, 992, {s:30, w:700, c:COL.text});
}

function drawWorld(c){
  const q0 = document.getElementById("quotesStatus");
  chrome(c, "بازارهای جهانی", q0 ? q0.textContent : "", COL.blue);
  const have = MARKETS.filter(function(m){ return quotes[m.id]; });
  if(!have.length){ emptyMsg(c, "قیمت‌های جهانی در حال دریافت است", "کمی صبر کنید…"); return; }
  have.slice(0, 14).forEach(function(m, i){
    const col = i < 7 ? 2010 : 1000, row = i % 7, y = 180 + row * 112, qt = quotes[m.id];
    marketRow(c, col, y, 112, {name:m.name, sub:m.unit, price:fmt(qt.price, m.dec), pct:qt.pct, pctTxt:qt.pct != null ? pctTxt(qt.pct) : null,
      spark:sparkOf(m.id), sparkCap:sparks[m.id] ? "۳۰ روز" : "امروز", lo:qt.lo, hi:qt.hi, rawPrice:qt.price, loTxt:fmt(qt.lo, m.dec), hiTxt:fmt(qt.hi, m.dec), prev:qt.prev});
  });
  const up = have.filter(function(m){ return quotes[m.id].pct > 0; }).length, dn = have.filter(function(m){ return quotes[m.id].pct < 0; }).length;
  const pcts = have.map(function(m){ return quotes[m.id].pct; }).filter(function(v){ return v != null; });
  const avg = pcts.length ? pcts.reduce(function(a, b){ return a + b; }, 0) / pcts.length : null;
  T(c, "بازار صعودی", 2004, 992, {s:28, c:COL.muted}); N(c, up + " / " + have.length, 1790, 992, {s:30, w:700, c:COL.up});
  T(c, "بازار نزولی", 1640, 992, {s:28, c:COL.muted}); N(c, dn + " / " + have.length, 1430, 992, {s:30, w:700, c:COL.down});
  T(c, "میانگین تغییر روز", 1260, 992, {s:28, c:COL.muted}); N(c, pctTxt(avg), 1000, 992, {s:30, w:700, c:dirCol(avg)});
}

const FA_COIN = {bitcoin:"بیت‌کوین", ethereum:"اتریوم", tether:"تتر", binancecoin:"بایننس‌کوین", solana:"سولانا", ripple:"ریپل", "usd-coin":"یواس‌دی‌کوین", dogecoin:"دوج‌کوین", cardano:"کاردانو", tron:"ترون", toncoin:"تون‌کوین", "staked-ether":"استیکد اتر", chainlink:"چین‌لینک", avalanche:"آوالانچ", "the-open-network":"تون‌کوین"};
function drawCrypto(c){
  chrome(c, "بازار ارز دیجیتال", "ده رمزارز برتر بر پایه ارزش بازار · قیمت به دلار", "#f7931a");
  let list = crypto_.list;
  if(!list){
    list = [];
    ["btc", "eth"].forEach(function(id){
      if(quotes[id]) list.push({id:id === "btc" ? "bitcoin" : "ethereum", symbol:id === "btc" ? "BTC" : "ETH", name:id, price:quotes[id].price, pct:quotes[id].pct, mcap:null, spark:sparkOf(id)});
    });
    if(!list.length){ emptyMsg(c, "قیمت رمزارزها در حال دریافت است", crypto_.err ? "منبع CoinGecko پاسخ نداد: " + crypto_.err : "کمی صبر کنید…"); return; }
  }
  list = list.slice(0, 10);
  /* پنل چپ: سهم از ارزش بازار + شمارنده‌ها */
  rrect(c, 40, 180, 570, 820, 20, COL.card);
  const withCap = list.filter(function(k){ return k.mcap != null; });
  const tot = withCap.reduce(function(a, k){ return a + k.mcap; }, 0);
  T(c, "سهم از ارزش بازار", 590, 222, {s:36, w:700, c:COL.gold});
  if(withCap.length){
    const top = withCap.slice(0, 5), others = tot - top.reduce(function(a, k){ return a + k.mcap; }, 0);
    const parts = top.map(function(k, i){ return {v:k.mcap, c:PAL[i]}; }); if(others > 0) parts.push({v:others, c:"#566070"});
    donut(c, 325, 450, 150, 92, parts);
    T(c, "مجموع", 325, 425, {s:26, c:COL.muted, a:"center"}); N(c, "$" + bigNum(tot), 325, 470, {s:38, w:700, a:"center", c:COL.gold, max:170});
    top.concat(others > 0 ? [{symbol:"سایر", mcap:others, other:true}] : []).forEach(function(k, i){
      const y = 650 + i * 48, col = k.other ? "#566070" : PAL[i];
      c.fillStyle = col; c.fillRect(570, y - 11, 22, 22);
      if(k.other) T(c, "سایر", 540, y, {s:30}); else N(c, String(k.symbol || "").toUpperCase(), 540, y, {s:30, w:700});
      N(c, (k.mcap / tot * 100).toFixed(1) + "%", 90, y, {s:30, w:700, c:COL.text, a:"left"});
    });
  }else{
    T(c, "ارزش بازار در دسترس نیست", 325, 450, {s:30, c:COL.muted, a:"center", max:480});
  }
  const upN = list.filter(function(k){ return k.pct > 0; }).length, dnN = list.filter(function(k){ return k.pct < 0; }).length;
  T(c, "صعودی در ۲۴ ساعت", 590, 950, {s:26, c:COL.muted}); N(c, String(upN), 350, 950, {s:34, w:700, c:COL.up});
  T(c, "نزولی", 290, 950, {s:26, c:COL.muted}); N(c, String(dnN), 150, 950, {s:34, w:700, c:COL.down});

  /* جدول */
  T(c, "نام", 1950, 192, {s:26, c:COL.muted}); T(c, "قیمت", 1650, 192, {s:26, c:COL.muted, a:"right"});
  T(c, "۲۴ ساعت", 1410, 192, {s:26, c:COL.muted, a:"right"}); T(c, "ارزش بازار", 1240, 192, {s:26, c:COL.muted, a:"right"}); T(c, "روند ۷ روز", 840, 192, {s:26, c:COL.muted, a:"center"});
  list.forEach(function(k, i){
    const y = 212 + i * 79;
    rrect(c, 640, y, 1368, 71, 14, i % 2 ? "#0f1520" : COL.card);
    N(c, String(i + 1), 1992, y + 36, {s:30, c:COL.muted});
    T(c, FA_COIN[k.id] || k.name, 1950, y + 26, {s:36, w:700, max:260});
    N(c, String(k.symbol || "").toUpperCase(), 1950, y + 58, {s:21, c:COL.muted, a:"right"});
    N(c, "$" + fmt(k.price), 1668, y + 36, {s:38, w:700, c:COL.gold, max:210});
    if(k.pct != null) N(c, arrow(k.pct) + Math.abs(k.pct).toFixed(2) + "%", 1410, y + 36, {s:30, w:700, c:dirCol(k.pct), max:140});
    if(k.mcap != null) N(c, "$" + bigNum(k.mcap), 1240, y + 36, {s:28, c:COL.text, max:150});
    spark(c, k.spark, 668, y + 12, 330, 48, null, {lw:3});
  });
}

function drawCountries(c){
  const ind = curInd();
  const cleanName = ind.name.replace(/\s*\([^)]*\)/g, "");
  chrome(c, "تحلیل و مقایسه‌ی اقتصاد کشورها", "شاخص: " + cleanName, COL.up);
  const rows = cs.rows.filter(function(r){ return r.latest; });
  if(!rows.length){ emptyMsg(c, "داده‌های بانک جهانی در حال دریافت است", "کمی صبر کنید…"); return; }

  /* ستون‌ها: میله‌ها راست، روند چپ */
  T(c, "مقایسه‌ی آخرین مقدار", 2004, 200, {s:36, w:700, c:COL.gold});
  const items = rows.slice().sort(function(a, b){ return b.latest.value - a.latest.value; }).slice(0, 9);
  const mx = Math.max.apply(null, items.map(function(r){ return Math.max(0, r.latest.value); })) || 1;
  items.forEach(function(r, i){
    const y = 235 + i * 66;
    T(c, r.name, 1990, y + 28, {s:36, w:r.code === cs.base ? 700 : 400, c:r.code === cs.base ? COL.gold : COL.text, max:200});
    const w = Math.max(6, clamp(r.latest.value / mx, 0, 1) * 600);
    c.fillStyle = colorOf(r.code); c.fillRect(1770 - w, y + 8, w, 40);
    N(c, fmtWBShort(ind, r.latest.value), 1770 - w - 12, y + 28, {s:32, c:COL.muted, a:"right"});
  });

  /* نمودار روند */
  const years = (cs.axis && cs.axis.length) ? cs.axis : cs.years;
  const L = 90, Rr = 1010, Tp = 290, B = 800, pw = Rr - L, ph = B - Tp;
  T(c, "روند در طول زمان", 1010, 200, {s:36, w:700, c:COL.gold});
  if(years.length > 1){
    let lo = Infinity, hi = -Infinity;
    cs.codes.forEach(function(code){ years.forEach(function(yy){ const v = seriesValue(code, yy); if(v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    const fc = cs.fc;
    if(fc) fc.years.forEach(function(yy, i){ [fc.lo[i], fc.hi[i]].forEach(function(v){ const w = fcVal(v); if(w != null){ lo = Math.min(lo, w); hi = Math.max(hi, w); } }); });
    if(Number.isFinite(lo)){
      if(hi === lo){ hi += 1; lo -= 1; } const pv = (hi - lo) * .06; lo -= pv; hi += pv;
      const X = function(i){ return L + pw * i / (years.length - 1); }, Y = function(v){ return Tp + (hi - v) / (hi - lo) * ph; };
      c.strokeStyle = "#1c2430"; c.lineWidth = 1;
      for(let k = 0; k <= 4; k++){ const yy = Tp + ph * k / 4; c.beginPath(); c.moveTo(L, yy); c.lineTo(Rr, yy); c.stroke(); N(c, cs.index ? (hi - (hi - lo) * k / 4).toFixed(0) : fmtWBShort(ind, hi - (hi - lo) * k / 4), L - 6, yy, {s:24, c:COL.muted, a:"right"}); }
      const step = Math.max(1, Math.ceil(years.length / 8));
      years.forEach(function(yy, i){ if(i % step === 0 || i === years.length - 1) N(c, String(yy), X(i), B + 28, {s:26, c:fc && yy > fc.lastYear ? "#b59a4f" : COL.muted, a:"center"}); });
      if(fc){
        const i0 = years.indexOf(fc.lastYear), la = fcVal(fc.lastValue);
        if(i0 >= 0 && la != null){
          c.fillStyle = "rgba(231,196,97,.14)"; c.beginPath(); c.moveTo(X(i0), Y(la));
          fc.years.forEach(function(yy, k){ c.lineTo(X(years.indexOf(yy)), Y(fcVal(fc.hi[k]))); });
          for(let k = fc.years.length - 1; k >= 0; k--) c.lineTo(X(years.indexOf(fc.years[k])), Y(fcVal(fc.lo[k])));
          c.closePath(); c.fill();
          c.setLineDash([14, 10]); c.strokeStyle = colorOf(cs.base); c.lineWidth = 5; c.beginPath(); c.moveTo(X(i0), Y(la));
          fc.years.forEach(function(yy, k){ c.lineTo(X(years.indexOf(yy)), Y(fcVal(fc.mid[k]))); });
          c.stroke(); c.setLineDash([]);
        }
      }
      cs.codes.forEach(function(code){
        c.beginPath(); let started = false;
        years.forEach(function(yy, i){ const v = seriesValue(code, yy); if(v == null){ started = false; return; } if(!started){ c.moveTo(X(i), Y(v)); started = true; } else c.lineTo(X(i), Y(v)); });
        c.strokeStyle = colorOf(code); c.lineWidth = code === cs.base ? 7 : 4; c.stroke();
      });
    }
  }
  /* نوار پایین: کشور مبنا */
  const base = rows.find(function(r){ return r.code === cs.base; });
  rrect(c, 40, 880, 1968, 110, 18, COL.card);
  if(base){
    T(c, "کشور مبنا", 1980, 912, {s:28, c:COL.muted}); T(c, base.name, 1980, 960, {s:44, w:700, c:COL.gold});
    T(c, "آخرین مقدار", 1650, 912, {s:28, c:COL.muted}); N(c, fmtWBShort(ind, base.latest.value), 1650, 960, {s:44, w:700});
    T(c, "رتبه‌ی جهانی", 1280, 912, {s:28, c:COL.muted}); N(c, base.rank ? base.rank + " / " + base.total : "—", 1280, 960, {s:44, w:700});
    T(c, ind.level ? "رشد سالانه‌ی ترکیبی" : "تغییر در بازه", 900, 912, {s:28, c:COL.muted});
    N(c, base.chg != null ? (base.chg > 0 ? "+" : "") + base.chg.toFixed(2) + (ind.level ? "%" : "") : "—", 900, 960, {s:44, w:700, c:base.chg != null ? dirCol(base.chg) : COL.text});
    if(cs.fc){ const k = cs.fc.years.length - 1; T(c, "پیش‌بینی " + cs.fc.years[cs.fc.years.length - 1], 520, 912, {s:28, c:COL.muted}); N(c, fmtWBShort(ind, cs.fc.mid[k]), 520, 960, {s:40, w:700, c:"#b59a4f", max:420}); }
  }
}



function drawNews(c){
  chrome(c, "آخرین اخبار فارسی", news.shownTitle || "تازه‌ترین", COL.blue);
  const items = news.items;
  if(!items || !items.length){ emptyMsg(c, "اخبار در حال دریافت است", "اگر این پیام می‌ماند، سرویس‌های خبر پاسخ نمی‌دهند."); return; }
  /* پنل چپ: آمار و نمودار */
  rrect(c, 40, 180, 570, 820, 20, COL.card);
  const now = Date.now(), bk = new Array(8).fill(0), src = {};
  let newest = 0;
  items.forEach(function(it){
    if(it.source) src[it.source] = (src[it.source] || 0) + 1;
    if(it.date){ newest = Math.max(newest, it.date); const h = (now - it.date) / 3600000; if(h >= 0 && h < 24) bk[7 - Math.floor(h / 3)]++; }
  });
  const srcList = Object.keys(src).map(function(k){ return [k, src[k]]; }).sort(function(a, b){ return b[1] - a[1]; });
  T(c, "آمار خبرها", 590, 222, {s:36, w:700, c:COL.gold});
  chip(c, 590, 250, "تعداد خبر", String(items.length), COL.gold);
  chip(c, 330, 250, "تعداد منبع", String(srcList.length), COL.blue);
  T(c, "خبر در هر ۳ ساعتِ ۲۴ ساعت اخیر", 590, 352, {s:26, c:COL.muted, max:540});
  const mx = Math.max.apply(null, bk.concat([1])), bx = 70, bw = 56, base = 560;
  bk.forEach(function(v, i){
    const h = v / mx * 150, x = bx + i * 62;
    rrect(c, x, base - Math.max(h, 4), bw, Math.max(h, 4), 8, v ? COL.blue : "#1c2430");
    N(c, String(v), x + bw / 2, base - Math.max(h, 4) - 18, {s:24, c:COL.text, a:"center"});
  });
  T(c, "۲۴ ساعت پیش", 70, base + 28, {s:22, c:COL.muted, a:"left"}); T(c, "اکنون", 570, base + 28, {s:22, c:COL.muted, a:"right"});
  T(c, "پرخبرترین منابع", 590, 650, {s:30, c:COL.muted});
  const smax = srcList.length ? srcList[0][1] : 1;
  srcList.slice(0, 5).forEach(function(s, i){
    const y = 700 + i * 54;
    T(c, s[0], 590, y, {s:26, max:200});
    const w = Math.max(10, s[1] / smax * 200);
    c.fillStyle = PAL[i % PAL.length]; c.fillRect(350 - w, y - 12, w, 24);
    N(c, String(s[1]), 70, y, {s:26, w:700, a:"left"});
  });
  if(newest){ T(c, "تازه‌ترین خبر: " + relTime(newest), 590, 975, {s:24, c:COL.muted, max:540}); }

  /* لیست خبرها */
  items.slice(0, 6).forEach(function(it, i){
    const y = 180 + i * 138;
    rrect(c, 640, y, 1368, 126, 16, COL.card);
    c.fillStyle = COL.blue; c.fillRect(2000, y + 12, 8, 102);
    const lines = wrapRtl(c, it.title, 1280, 36, 700, 2);
    lines.forEach(function(l, k){ T(c, l, 1975, y + 34 + k * 44, {s:36, w:700}); });
    T(c, (it.source || "") + (it.date ? "  ·  " + relTime(it.date) : ""), 1975, y + 112, {s:24, c:COL.muted, max:1200});
  });
}

function drawStatements(c){
  chrome(c, "سخنان و پست‌های مقامات آمریکایی", "تحلیل قاعده‌محور و واکنش بازار", COL.warn);
  let all = [];
  Object.keys(st.cache || {}).forEach(function(k){ all = all.concat(st.cache[k].items || []); });
  all.sort(function(a, b){ return b.date - a.date; });
  all.forEach(function(i){ if(!i.an) i.an = analyzeStatement(i.text); });
  let items = all.filter(function(i){ return i.an.topics.length; });
  if(!items.length) items = all;
  if(!items.length){ emptyMsg(c, "سخنان مقامات در حال دریافت است", "اگر این پیام می‌ماند، منابع پاسخ نمی‌دهند."); return; }

  /* پنل چپ: شمارنده‌ها */
  rrect(c, 40, 180, 570, 820, 20, COL.card);
  T(c, "آمار تحلیل", 590, 222, {s:36, w:700, c:COL.gold});
  chip(c, 590, 250, "کل مورد", String(all.length), COL.gold);
  chip(c, 330, 250, "مرتبط با بازار", String(all.filter(function(i){ return i.an.topics.length; }).length), COL.warn);
  const lv = {high:0, mid:0, low:0}; all.forEach(function(i){ lv[i.an.importance.level]++; });
  T(c, "اهمیت بازاری", 590, 372, {s:28, c:COL.muted});
  [["بالا", lv.high, COL.down], ["متوسط", lv.mid, COL.warn], ["کم", lv.low, COL.muted]].forEach(function(r, i){
    const y = 425 + i * 58, w = Math.max(8, r[1] / (all.length || 1) * 330);
    T(c, r[0], 590, y, {s:28});
    c.fillStyle = r[2]; c.fillRect(470 - w, y - 15, w, 30);
    N(c, String(r[1]), 70, y, {s:28, w:700, a:"left"});
  });
  const tp = {}; all.forEach(function(i){ i.an.topics.forEach(function(t){ tp[t.fa] = (tp[t.fa] || 0) + 1; }); });
  const tl = Object.keys(tp).map(function(k){ return [k, tp[k]]; }).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 5);
  T(c, "پرتکرارترین موضوع‌ها", 590, 640, {s:28, c:COL.muted});
  const tmax = tl.length ? tl[0][1] : 1;
  tl.forEach(function(t, i){
    const y = 695 + i * 56, w = Math.max(10, t[1] / tmax * 200);
    T(c, t[0], 590, y, {s:26, max:230});
    c.fillStyle = PAL[i % PAL.length]; c.fillRect(350 - w, y - 12, w, 24);
    N(c, String(t[1]), 70, y, {s:26, w:700, a:"left"});
  });

  /* کارت‌ها */
  items.slice(0, 4).forEach(function(it, i){
    const y = 180 + i * 208, a = it.an;
    rrect(c, 640, y, 1368, 196, 18, COL.card);
    const lc = a.importance.level === "high" ? COL.down : a.importance.level === "mid" ? COL.warn : COL.muted;
    c.fillStyle = lc; c.fillRect(2000, y + 14, 8, 168);
    T(c, it.who, 1975, y + 32, {s:32, w:700, c:COL.gold, max:1000});
    T(c, a.importance.label, 680, y + 32, {s:24, c:lc, a:"left"});
    const lines = wrapRtl(c, a.summary, 1290, 27, 400, 2);
    lines.forEach(function(l, k){ T(c, l, 1975, y + 76 + k * 36, {s:27, c:"#d5d9e0"}); });
    /* واکنش قیمت ۳۰ دقیقه پس از انتشار */
    let x = 1975, shown = 0;
    if(it.date && Date.now() - it.date >= 30 * 60000){
      REACT_ASSETS.forEach(function(as){
        const d = intra[as.id]; if(!d || !d.rows || !d.rows.length) return;
        const p = reactionPct(d.rows, it.date, 30 * 60000); if(p == null) return;
        rrect(c, x - 230, y + 138, 224, 44, 10, "#0f1520");
        T(c, as.name.replace("آتی ", ""), x - 14, y + 160, {s:22, c:COL.muted, max:96});
        N(c, pctTxt(p), x - 120, y + 160, {s:26, w:700, c:dirCol(p), a:"right", max:100});
        x -= 238; shown++;
      });
    }
    if(!shown) T(c, "واکنش ۳۰ دقیقه‌ای قیمت: هنوز محاسبه نشده", 1975, y + 160, {s:22, c:COL.muted});
  });
}

function drawPulse(c){
  chrome(c, "نبض بازار امروز", "گرایش ریسک‌پذیری یا ریسک‌گریزی", COL.gold);
  const have = MARKETS.filter(function(m){ return quotes[m.id]; });
  if(have.length < 3){ emptyMsg(c, "برای محاسبه‌ی نبض بازار قیمت‌ها لازم است", "کمی صبر کنید…"); return; }
  const p = computePulse(quotes, MARKETS);
  const col = p.cls === "up" ? COL.up : p.cls === "down" ? COL.down : COL.warn;
  /* ساعت گرایش */
  rrect(c, 40, 180, 940, 480, 20, COL.card);
  gauge(c, 510, 500, 300, p.score / 4.5);
  T(c, "ریسک‌گریز", 170, 530, {s:28, c:COL.down, a:"center"}); T(c, "ریسک‌پذیر", 850, 530, {s:28, c:COL.up, a:"center"});
  T(c, "گرایش کلی بازار", 510, 535, {s:26, c:COL.muted, a:"center"});
  T(c, p.label, 510, 590, {s:52, w:700, c:col, a:"center", max:520});
  N(c, "امتیاز " + (p.score > 0 ? "+" : "") + p.score.toFixed(1) + "  از  ±4.5", 510, 640, {s:28, w:700, c:COL.text, a:"center"});
  /* کارت‌های عددی */
  const cards = [];
  if(p.ratios.gs != null) cards.push(["نسبت طلا به نقره", p.ratios.gs.toFixed(1), COL.gold]);
  if(p.ratios.go != null) cards.push(["نسبت طلا به نفت", p.ratios.go.toFixed(1), COL.gold]);
  if(p.ratios.bg != null) cards.push(["بیت‌کوین بر حسب طلا", p.ratios.bg.toFixed(1), COL.gold]);
  if(p.vix != null) cards.push(["شاخص ترس (VIX)", p.vix.toFixed(2), p.vix < 20 ? COL.up : p.vix < 30 ? COL.warn : COL.down]);
  if(p.tnx != null) cards.push(["بازده اوراق ۱۰ ساله", p.tnx.toFixed(2) + "%", COL.gold]);
  cards.slice(0, 4).forEach(function(k, i){
    const x = i % 2 === 0 ? 530 : 40, y = 690 + Math.floor(i / 2) * 160;
    rrect(c, x, y, 450, 146, 16, COL.card);
    T(c, k[0], x + 430, y + 40, {s:28, c:COL.muted, max:400});
    N(c, k[1], x + 430, y + 100, {s:58, w:700, c:k[2], max:400});
  });
  /* نمودار میله‌ای تغییر روزانه */
  rrect(c, 1010, 180, 998, 820, 20, COL.card);
  T(c, "تغییر روزانه‌ی بازارها (درصد)", 1990, 222, {s:34, w:700, c:COL.gold});
  const list = have.filter(function(m){ return quotes[m.id].pct != null; }).sort(function(a, b){ return quotes[b.id].pct - quotes[a.id].pct; }).slice(0, 12);
  const maxA = Math.max.apply(null, list.map(function(m){ return Math.abs(quotes[m.id].pct); }).concat([0.5]));
  const zeroX = 1330, half = 280;
  c.strokeStyle = "#2b3544"; c.lineWidth = 2; c.beginPath(); c.moveTo(zeroX, 250); c.lineTo(zeroX, 980); c.stroke();
  list.forEach(function(m, i){
    const y = 275 + i * 60, v = quotes[m.id].pct, w = Math.max(4, Math.abs(v) / maxA * half);
    T(c, m.name, 1985, y, {s:28, max:330});
    c.fillStyle = dirCol(v);
    if(v >= 0){ c.fillRect(zeroX, y - 15, w, 30); N(c, pctTxt(v), zeroX + w + 10, y, {s:26, w:700, c:COL.text, a:"left"}); }
    else { c.fillRect(zeroX - w, y - 15, w, 30); N(c, pctTxt(v), zeroX - w - 10, y, {s:26, w:700, c:COL.text, a:"right"}); }
  });
}

function drawTech(c){
  chrome(c, "تحلیل فنی نماد انتخاب‌شده", chart.name + " · " + (chart.unit || ""), COL.blue);
  const rows = chart.rows;
  if(!rows || rows.length < 20){ emptyMsg(c, "داده‌ی نمودار هنوز دریافت نشده", "برای تحلیل حداقل ۲۰ کندل لازم است."); return; }
  const closes = rows.map(function(r){ return r.c; }), n = closes.length, last = closes[n - 1];
  const s20 = sma(closes, 20), s50 = sma(closes, 50);
  const hasVol = rows.some(function(r){ return r.v > 0; });
  let lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
  const pv = (hi - lo) * .06 || 1; const lo0 = lo, hi0 = hi; lo -= pv; hi += pv;
  const L = 130, Rr = 1370, Tp = 240, B = hasVol ? 640 : 700, pw = Rr - L, ph = B - Tp;
  const X = function(i){ return L + pw * i / (n - 1); }, Y = function(v){ return Tp + (hi - v) / (hi - lo) * ph; };
  c.strokeStyle = "#1c2430"; c.lineWidth = 1;
  for(let k = 0; k <= 4; k++){ const yy = Tp + ph * k / 4; c.beginPath(); c.moveTo(L, yy); c.lineTo(Rr, yy); c.stroke(); N(c, fmt(hi - (hi - lo) * k / 4, chart.dec), L - 8, yy, {s:24, c:COL.muted, a:"right"}); }
  const g = c.createLinearGradient(0, Tp, 0, B); g.addColorStop(0, "rgba(231,196,97,.25)"); g.addColorStop(1, "rgba(231,196,97,0)");
  c.beginPath(); closes.forEach(function(v, i){ i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); }); c.lineTo(X(n - 1), B); c.lineTo(X(0), B); c.closePath(); c.fillStyle = g; c.fill();
  [[s20, COL.blue], [s50, "#c77dff"]].forEach(function(p){
    c.beginPath(); let st0 = false;
    p[0].forEach(function(v, i){ if(v == null) return; if(!st0){ c.moveTo(X(i), Y(v)); st0 = true; } else c.lineTo(X(i), Y(v)); });
    c.strokeStyle = p[1]; c.lineWidth = 3; c.stroke();
  });
  c.beginPath(); closes.forEach(function(v, i){ i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); }); c.strokeStyle = COL.gold; c.lineWidth = 5; c.stroke();
  const chg = (last / rows[0].c - 1) * 100;
  N(c, fmt(last, chart.dec), L, 200, {s:50, w:700, c:COL.gold, a:"left"});
  N(c, arrow(chg) + pctTxt(chg), L + 330, 200, {s:36, w:700, c:dirCol(chg), a:"left"});
  T(c, "خط طلایی: قیمت", Rr, 200, {s:26, c:COL.gold, a:"right"}); T(c, "آبی: میانگین ۲۰", Rr - 250, 200, {s:26, c:COL.blue, a:"right"}); T(c, "بنفش: میانگین ۵۰", Rr - 500, 200, {s:26, c:"#c77dff", a:"right"});
  let yNext = B + 34;
  if(hasVol){
    const vmax = Math.max.apply(null, rows.map(function(r){ return r.v; })) || 1, vb = B + 130, bw = Math.max(1, pw / n * 0.7);
    T(c, "حجم", Rr, B + 40, {s:24, c:COL.muted});
    rows.forEach(function(r, i){ const h = r.v / vmax * 80; c.fillStyle = r.c >= r.o ? "rgba(58,200,121,.55)" : "rgba(239,83,80,.55)"; c.fillRect(X(i) - bw / 2, vb - h, bw, h); });
    N(c, fmtVol(vmax), L - 8, vb - 70, {s:22, c:COL.muted, a:"right"});
    yNext = vb + 16;
  }
  /* نمودار RSI */
  const rsAll = rsi(closes, 14), rT = yNext + 50, rB = 930;
  T(c, "شاخص قدرت نسبی (RSI)", Rr, yNext + 24, {s:24, c:COL.muted});
  c.fillStyle = "rgba(255,255,255,.03)"; c.fillRect(L, rT, pw, rB - rT);
  [30, 70].forEach(function(lv){ const yy = rB - (lv / 100) * (rB - rT); c.strokeStyle = lv === 70 ? "rgba(239,83,80,.5)" : "rgba(58,200,121,.5)"; c.setLineDash([10, 8]); c.beginPath(); c.moveTo(L, yy); c.lineTo(Rr, yy); c.stroke(); c.setLineDash([]); N(c, String(lv), L - 8, yy, {s:22, c:COL.muted, a:"right"}); });
  c.beginPath(); let rs0 = false;
  rsAll.forEach(function(v, i){ if(v == null) return; const yy = rB - (v / 100) * (rB - rT); if(!rs0){ c.moveTo(X(i), yy); rs0 = true; } else c.lineTo(X(i), yy); });
  c.strokeStyle = "#c77dff"; c.lineWidth = 3; c.stroke();
  const t0 = rows[0].t, t1 = rows[n - 1].t;
  try{ const f = new Intl.DateTimeFormat("en-GB", {day:"2-digit", month:"short", year:"numeric", timeZone:"Asia/Tehran"}); N(c, f.format(new Date(t0)), L, rB + 30, {s:24, c:COL.muted, a:"left"}); N(c, f.format(new Date(t1)), Rr, rB + 30, {s:24, c:COL.muted, a:"right"}); }catch(e){}

  /* ستون شاخص‌ها */
  const rs = lastValid(rsAll), mc = macd(closes, 12, 26, 9), mh = lastValid(mc.hist);
  const a20 = lastValid(s20), a50 = n >= 50 ? lastValid(s50) : null;
  let score = 0;
  if(a20 != null) score += last > a20 ? 1 : -1;
  if(a20 != null && a50 != null) score += a20 > a50 ? 1 : -1;
  if(rs != null) score += rs < 30 ? 1 : rs > 70 ? -1 : 0;
  if(mh != null) score += mh > 0 ? 1 : -1;
  const verdict = score >= 2 ? ["گرایش صعودی", COL.up] : score <= -2 ? ["گرایش نزولی", COL.down] : ["خنثی", COL.warn];
  rrect(c, 1420, 190, 590, 120, 16, COL.card); T(c, "جمع‌بندی اندیکاتورها", 1990, 224, {s:28, c:COL.muted}); T(c, verdict[0], 1990, 274, {s:48, w:700, c:verdict[1]});
  const k = [["شاخص قدرت نسبی", rs != null ? rs.toFixed(1) : "—", rs != null ? (rs > 70 ? COL.down : rs < 30 ? COL.up : COL.gold) : COL.gold],
    ["هیستوگرام MACD", mh != null ? fmtSigned(mh, 2) : "—", mh != null ? dirCol(mh) : COL.gold],
    ["میانگین ۲۰", fmt(a20, chart.dec), COL.blue], ["میانگین ۵۰", a50 != null ? fmt(a50, chart.dec) : "—", "#c77dff"],
    ["بالاترین / پایین‌ترین", fmt(hi0, chart.dec) + " / " + fmt(lo0, chart.dec), COL.text]];
  k.forEach(function(r, i){ const y = 330 + i * 124; rrect(c, 1420, y, 590, 112, 16, COL.card); T(c, r[0], 1990, y + 32, {s:28, c:COL.muted}); N(c, r[1], 1990, y + 82, {s:i === 4 ? 36 : 50, w:700, c:r[2], max:540}); });
  T(c, "فقط محاسبه‌ی آماری روی کندل‌های نمایش‌داده‌شده؛ توصیه‌ی خرید یا فروش نیست.", 1000, 1000, {s:26, c:COL.muted, a:"center"});
}

function drawAbout(c){
  chrome(c, "درباره‌ی میرزا و وضعیت داده‌ها", "هر منبع چند مورد دریافت کرده و آخرین به‌روزرسانی کی بوده", COL.gold);
  const img = document.getElementById("logoImg");
  try{ if(img && img.complete && img.naturalWidth) c.drawImage(img, 1700, 190, 280, 280); }catch(e){}
  T(c, "هر اتفاق، یک اثر؛ هر اثر، یک تحلیل", 1670, 250, {s:42, w:700, a:"right", max:900});
  T(c, "هدف میرزا ارائه‌ی اطلاعات بازار", 1670, 310, {s:30, c:COL.muted, max:900});
  T(c, "به زبان ساده و قابل فهم است.", 1670, 354, {s:30, c:COL.muted, max:900});
  const stN = (function(){ let n = 0; Object.keys(st.cache || {}).forEach(function(k){ n += (st.cache[k].items || []).length; }); return n; })();
  const okQ = MARKETS.filter(function(m){ return quoteState[m.id] === "ok"; }).length, anyQ = MARKETS.filter(function(m){ return quotes[m.id]; }).length;
  const okS = MARKETS.filter(function(m){ return sparkOf(m.id); }).length;
  const csOk = cs.rows.filter(function(r){ return r.latest; }).length;
  const iranN = iran.cur ? IRAN_ROWS.filter(function(d){ return d.key && iran.cur[d.key]; }).length : 0;
  const ago = function(t){ return t ? relTime(t) : "—"; };
  const data = [
    ["قیمت‌های جهانی", "Yahoo · gold-api · CoinGecko", anyQ, MARKETS.length, ago(quotesUpdatedAt), okQ + " زنده"],
    ["نمودار ۳۰ روزه", "Yahoo · Stooq · frankfurter", okS, MARKETS.length, ago(sparksAt), ""],
    ["بازار ایران", "tgju.org", iranN, IRAN_ROWS.filter(function(d){ return d.key; }).length, ago(iran.t), iran.stale ? "قدیمی" : iran.cur ? "زنده" : "ناموفق"],
    ["رمزارزها", "CoinGecko", crypto_.list ? crypto_.list.length : 0, 10, ago(crypto_.t), ""],
    ["اقتصاد کشورها", "World Bank", csOk, cs.codes.length, "", ""],
    ["اخبار فارسی", "Google News · BBC · DW", news.items ? news.items.length : 0, 20, ago(news.t), ""],
    ["سخنان مقامات", "Truth Social · Fed · White House", stN, 20, "", ""],
    ["نمودار فنی", chart.source || "—", chart.rows.length, 100, ago(chart.loadedAt), ""]
  ];
  data.forEach(function(r, i){
    r[3] = Math.max(r[3], r[2]);
    const y = 480 + i * 62, ratio = clamp(r[2] / (r[3] || 1), 0, 1);
    rrect(c, 40, y, 1968, 54, 12, i % 2 ? "#0f1520" : COL.card);
    c.fillStyle = r[2] ? (ratio >= 0.7 ? COL.up : COL.warn) : COL.down; c.beginPath(); c.arc(1980, y + 27, 9, 0, 7); c.fill();
    T(c, r[0], 1950, y + 27, {s:30, w:700, max:300});
    N(c, r[1], 1640, y + 27, {s:23, c:COL.muted, max:240});
    rrect(c, 1010, y + 18, 380, 18, 9, "#1c2430"); if(ratio > 0) rrect(c, 1010, y + 18, Math.max(12, 380 * ratio), 18, 9, ratio >= 0.7 ? COL.up : COL.warn);
    N(c, r[2] + " / " + r[3], 990, y + 27, {s:28, w:700, c:COL.gold, a:"right", max:160});
    if(r[4]) T(c, r[4], 790, y + 27, {s:23, c:COL.muted, max:300});
    if(r[5]) T(c, r[5], 330, y + 27, {s:23, c:COL.muted, a:"right", max:250});
  });
  T(c, "اطلاعات این تالار برای اطلاع‌رسانی است و توصیه‌ی سرمایه‌گذاری محسوب نمی‌شود.", 1000, 1000, {s:26, c:COL.muted, a:"center"});
}

/* ---------- امضای داده‌ها برای تشخیص نیاز به نقاشی دوباره ---------- */
function minuteKey(){ return Math.floor(Date.now() / 60000); }
const SIG = {
  welcome:function(){ const i = document.getElementById("logoImg"); return [i && i.complete && i.naturalWidth, fontsReady, quotesUpdatedAt, sparksAt]; },
  iran:function(){ return [iran.t, iran.stale, iran.failed, manualUsd, quotes.gold && quotes.gold.price, quotes.silver && quotes.silver.price, iranHist.t.length, minuteKey()]; },
  world:function(){ return [quotesUpdatedAt, sparksAt, minuteKey()]; },
  crypto:function(){ return [crypto_.t, quotesUpdatedAt, sparksAt, minuteKey()]; },
  countries:function(){ return [cs.reqId, cs.ind, cs.codes.join(), cs.index, cs.base, cs.rows.map(function(r){ return r.latest && r.latest.value; }), cs.fc && cs.fc.model, minuteKey()]; },
  news:function(){ return [news.items && news.items.length, news.items && news.items[0] && news.items[0].title, news.shownTitle, minuteKey()]; },
  statements:function(){ let n = 0, t = 0; Object.keys(st.cache || {}).forEach(function(k){ n += (st.cache[k].items || []).length; t = Math.max(t, st.cache[k].t); }); return [n, t, Object.keys(intra).map(function(k){ return intra[k].t; }), minuteKey()]; },
  pulse:function(){ return [quotesUpdatedAt, minuteKey()]; },
  tech:function(){ const r = chart.rows; return [r.length, r.length && r[r.length - 1].c, chart.symbol, chart.period, chart.loadedAt, minuteKey()]; },
  about:function(){ const i = document.getElementById("logoImg"); return [i && i.complete && i.naturalWidth, fontsReady, quotesUpdatedAt, sparksAt, iran.t, crypto_.t, news.t, chart.loadedAt, cs.reqId, minuteKey()]; }
};

/* =========================================================
   چیدمان تالار
========================================================= */
/* id، عنوان، بخش کلاسیک، مرکز، جهت رو به بیننده، ابعاد، ایستگاه تماشا */
const BOARD_DEFS = [
  {id:"welcome",    label:"ورودی",          sec:"home",       cx:0,       cy:3.7, cz:4,       nx:0,  nz:1,  w:9,  h:4.5, free:true, fx:4.5, draw:drawWelcome,    spot:[0, 13.5]},
  {id:"iran",       label:"بازار ایران",     sec:"iran",       cx:0,       cy:4.7, cz:-16,     nx:0,  nz:1,  w:16, h:8,   free:true, fx:8,   draw:drawIran,       spot:[0, -4]},
  {id:"crypto",     label:"ارز دیجیتال",     sec:"markets",    cx:-19.85,  cy:4.0, cz:-12,     nx:1,  nz:0,  w:13, h:6.5,                    draw:drawCrypto,     spot:[-11.5, -12]},
  {id:"world",      label:"بازارهای جهانی",  sec:"markets",    cx:19.85,   cy:4.0, cz:-12,     nx:-1, nz:0,  w:13, h:6.5,                    draw:drawWorld,      spot:[11.5, -12]},
  {id:"countries",  label:"تحلیل کشورها",    sec:"countries",  cx:0,       cy:5.7, cz:-44,     nx:0,  nz:1,  w:20, h:10,  free:true, fx:10,  draw:drawCountries,  spot:[0, -27]},
  {id:"news",       label:"اخبار فارسی",     sec:"news",       cx:-19.85,  cy:4.0, cz:-40,     nx:1,  nz:0,  w:13, h:6.5,                    draw:drawNews,       spot:[-11.5, -40]},
  {id:"statements", label:"سخنان مقامات",    sec:"statements", cx:19.85,   cy:4.0, cz:-40,     nx:-1, nz:0,  w:13, h:6.5,                    draw:drawStatements, spot:[11.5, -40]},
  {id:"tech",       label:"تحلیل فنی",       sec:"analysis",   cx:0,       cy:5.7, cz:-79.85,  nx:0,  nz:1,  w:20, h:10,                     draw:drawTech,       spot:[0, -62]},
  {id:"pulse",      label:"نبض بازار",       sec:"pulse",      cx:-19.85,  cy:4.0, cz:-66,     nx:1,  nz:0,  w:13, h:6.5,                    draw:drawPulse,      spot:[-11.5, -66]},
  {id:"about",      label:"درباره‌ی میرزا",  sec:"home",       cx:19.85,   cy:4.0, cz:-66,     nx:-1, nz:0,  w:13, h:6.5,                    draw:drawAbout,      spot:[11.5, -66]}
];

function buildScene(){
  const white = TX.white;
  /* کف (با بازتاب) */
  let mb = MB();
  quad(mb, [-HX, 0, ZN], [HX, 0, ZN], [HX, 0, ZF], [-HX, 0, ZF], [0, 1, 0], [[0, 25], [10, 25], [10, 0], [0, 0]]);
  commit(mb, {mode:2, tex:TX.floor, alpha:0.80, kind:"floor"});

  /* دیوارها */
  const wallMat = {mode:2, tex:TX.wall, color:[0.9, 0.95, 1]};
  mb = MB(); quad(mb, [-HX, 0, ZN], [-HX, 0, ZF], [-HX, HY, ZF], [-HX, HY, ZN], [1, 0, 0], [[0, 2], [25, 2], [25, 0], [0, 0]]); commit(mb, wallMat);
  mb = MB(); quad(mb, [HX, 0, ZF], [HX, 0, ZN], [HX, HY, ZN], [HX, HY, ZF], [-1, 0, 0], [[0, 2], [25, 2], [25, 0], [0, 0]]); commit(mb, wallMat);
  mb = MB(); quad(mb, [HX, 0, ZF], [-HX, 0, ZF], [-HX, HY, ZF], [HX, HY, ZF], [0, 0, 1], [[0, 2], [10, 2], [10, 0], [0, 0]]); commit(mb, wallMat);
  mb = MB(); quad(mb, [-HX, 0, ZN], [HX, 0, ZN], [HX, HY, ZN], [-HX, HY, ZN], [0, 0, -1], [[0, 2], [10, 2], [10, 0], [0, 0]]); commit(mb, wallMat);
  /* سقف */
  mb = MB(); quad(mb, [-HX, HY, ZN], [HX, HY, ZN], [HX, HY, ZF], [-HX, HY, ZF], [0, -1, 0]); commit(mb, {mode:0, color:[0.05, 0.06, 0.09]});

  /* نورهای سقفی (درخشان) */
  mb = MB();
  [-12, 0, 12].forEach(function(x){ box(mb, x - 0.35, HY - 0.15, ZF + 2, x + 0.35, HY - 0.02, ZN - 1); });
  for(let z = ZN - 6; z > ZF; z -= 14) box(mb, -HX + 1, HY - 0.15, z - 0.2, HX - 1, HY - 0.02, z + 0.2);
  commit(mb, {mode:3, color:[1, 0.93, 0.78], reflect:true});

  /* ستون‌ها */
  mb = MB(); const mg = MB();
  [8, -28, -54].forEach(function(z){
    [-15.5, 15.5].forEach(function(x){
      box(mb, x - 0.55, 0, z - 0.55, x + 0.55, HY, z + 0.55);
      box(mg, x - 0.6, 0, z - 0.6, x + 0.6, 0.12, z + 0.6); box(mg, x - 0.6, 3.2, z - 0.6, x + 0.6, 3.3, z + 0.6);
      colliders.push([x - 0.55, z - 0.55, x + 0.55, z + 0.55]);
    });
  });
  commit(mb, {mode:0, color:[0.10, 0.12, 0.17], reflect:true});
  commit(mg, {mode:3, color:[0.85, 0.7, 0.3], reflect:true});

  /* قاب و تابلوها */
  const frame = MB(), gold = MB();
  BOARD_DEFS.forEach(function(d){
    const r = [d.nz, 0, -d.nx], nrm = [d.nx, 0, d.nz];       /* راست بیننده */
    const hw = d.w / 2, hh = d.h / 2, o = 0.03;
    const P = function(s, t, off){ return [d.cx + r[0] * s + nrm[0] * off, d.cy + t, d.cz + r[2] * s + nrm[2] * off]; };
    const b = {def:d, id:d.id, label:d.label, sec:d.sec};
    b.canvas = cv(lowQ ? 1024 : 2048, lowQ ? 512 : 1024);
    b.ctx = b.canvas.getContext("2d");
    b.sc = b.canvas.width / LW;
    b.tex = makeTex(b.canvas, false);
    b.sig = ""; b.dirty = true;
    const bm = MB();
    quad(bm, P(-hw, -hh, o), P(hw, -hh, o), P(hw, hh, o), P(-hw, hh, o), nrm, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    commit(bm, {mode:1, tex:b.tex, color:[1, 1, 1], reflect:true});
    boards.push(b);

    /* قاب تیره و خط طلایی دور تابلو */
    const bt = 0.28, depth = d.free ? 0.45 : 0.18;
    const fx0 = -hw - bt, fx1 = hw + bt, fy0 = -hh - bt, fy1 = hh + bt;
    const slab = function(mbx, s0, s1, t0, t1, d0, d1){
      const a = P(s0, t0, d0), c2 = P(s1, t1, d1);
      box(mbx, Math.min(a[0], c2[0]), Math.min(a[1], c2[1]), Math.min(a[2], c2[2]), Math.max(a[0], c2[0]), Math.max(a[1], c2[1]), Math.max(a[2], c2[2]));
    };
    slab(frame, fx0, fx1, fy0, fy1, -depth, 0.0);                 /* بدنه */
    const gt = 0.07;
    slab(gold, fx0, fx1, fy1 - gt, fy1, -depth, 0.06); slab(gold, fx0, fx1, fy0, fy0 + gt, -depth, 0.06);
    slab(gold, fx0, fx0 + gt, fy0, fy1, -depth, 0.06); slab(gold, fx1 - gt, fx1, fy0, fy1, -depth, 0.06);
    if(d.free){
      /* پایه‌ی ایستاده */
      slab(frame, -0.6, 0.6, -d.cy, fy0, -depth + 0.05, -0.05);
      colliders.push([d.cx - d.fx - 0.4, d.cz - 0.55, d.cx + d.fx + 0.4, d.cz + 0.55]);
    }
    /* هاله‌ی دیوار پشت تابلو و نور کف جلوی آن */
    const hm = MB(), gx = hw + 1.4, gy = hh + 1.4;
    quad(hm, P(-gx, -gy, -depth - 0.02), P(gx, -gy, -depth - 0.02), P(gx, gy, -depth - 0.02), P(-gx, gy, -depth - 0.02), nrm);
    commit(hm, {mode:1, tex:TX.glow, color:[0.9, 0.7, 0.3], alpha:0.38, kind:"glow"});
    b.spot = d.spot;
  });
  commit(frame, {mode:0, color:[0.07, 0.08, 0.11], reflect:true});
  commit(gold, {mode:3, color:[0.95, 0.78, 0.35], reflect:true});

  /* لکه‌ی نور روی کف در محل ایستادن (آهسته می‌تپد) */
  boards.forEach(function(b){
    const m = MB(), s = 3.2, x = b.spot[0], z = b.spot[1];
    quad(m, [x - s, 0.03, z + s], [x + s, 0.03, z + s], [x + s, 0.03, z - s], [x - s, 0.03, z - s], [0, 1, 0]);
    commit(m, {mode:1, tex:TX.glow, color:[0.9, 0.72, 0.3], alpha:0.5, kind:"glow", pulse:1});
  });

  /* ایستگاه‌ها */
  BOARD_DEFS.forEach(function(d, i){
    const dx = d.cx - d.spot[0], dz = d.cz - d.spot[1], dist = Math.hypot(dx, dz);
    stations.push({idx:i, id:d.id, label:d.label, x:d.spot[0], z:d.spot[1], yaw:Math.atan2(dx, -dz), pitch:Math.atan2(d.cy - 1.7, dist) * 0.9});
  });

  /* مرز کل تالار در برخورد؛ (در collide اعمال می‌شود) */
}

/* =========================================================
   WebGL
========================================================= */
const VS = "attribute vec3 aPos;attribute vec2 aUV;attribute vec3 aNor;uniform mat4 uVP;uniform float uMirror;varying vec2 vUV;varying vec3 vW;varying vec3 vN;" +
  "void main(){vec3 p=aPos;vec3 n=aNor;if(uMirror>0.5){p.y=-p.y;n.y=-n.y;}vW=p;vN=n;vUV=aUV;gl_Position=uVP*vec4(p,1.0);}";
const FS = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n" +
  "uniform sampler2D uTex;uniform vec3 uColor;uniform float uMode;uniform float uAlpha;uniform float uAdd;uniform vec3 uEye;uniform vec3 uFog;uniform float uFogD;uniform float uMirror;" +
  "varying vec2 vUV;varying vec3 vW;varying vec3 vN;" +
  "void main(){" +
  "vec3 base=uColor;" +
  "bool tx=(uMode>0.5&&uMode<2.5);" +
  "if(tx){base=texture2D(uTex,vUV).rgb*uColor;}" +
  "vec3 col=base;" +
  "bool lit=(uMode<0.5)||(uMode>1.5&&uMode<2.5);" +
  "if(lit){vec3 n=normalize(vN);float hemi=0.5+0.5*n.y;float d=max(dot(n,normalize(vec3(0.25,0.9,0.35))),0.0);col=base*(0.30+0.35*hemi+0.40*d);}" +
  "float dist=length(vW-uEye);float f=1.0-exp(-pow(uFogD*dist,2.0));" +
  "vec3 fogc=uAdd>0.5?vec3(0.0):uFog;col=mix(col,fogc,f);" +
  "if(uMirror>0.5){col*=0.55;}" +
  "if(uAdd>0.5){gl_FragColor=vec4(col*uAlpha,1.0);}else{gl_FragColor=vec4(col,uAlpha);}" +
  "}";

function compile(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
  return s;
}
function initGL(){
  gl = canvas.getContext("webgl", {antialias:true, alpha:false, powerPreference:"high-performance"}) || canvas.getContext("experimental-webgl");
  if(!gl) throw new Error("WebGL پشتیبانی نمی‌شود");
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, "aPos"); gl.bindAttribLocation(prog, 1, "aUV"); gl.bindAttribLocation(prog, 2, "aNor");
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  ["uVP", "uMirror", "uTex", "uColor", "uMode", "uAlpha", "uAdd", "uEye", "uFog", "uFogD"].forEach(function(n){ U[n] = gl.getUniformLocation(prog, n); });
  anisoExt = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  if(anisoExt) anisoMax = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.02, 0.03, 0.05, 1);
}
function bindMesh(m){
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
}
function drawMesh(m, mirror, t){
  const a = m.mat;
  bindMesh(m);
  gl.uniform3f(U.uColor, a.color[0], a.color[1], a.color[2]);
  gl.uniform1f(U.uMode, a.mode);
  let alpha = a.alpha;
  if(a.pulse) alpha *= 0.75 + 0.25 * Math.sin(t * 2.2);
  gl.uniform1f(U.uAlpha, alpha);
  gl.uniform1f(U.uAdd, a.kind === "glow" ? 1 : 0);
  gl.uniform1f(U.uMirror, mirror ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex || TX.white); gl.uniform1i(U.uTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, m.count);
}
function render(t){
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const eye = [pos[0], pos[1], pos[2]];
  const vp = mul(persp(1.05, canvas.width / canvas.height, 0.1, 160), viewM(eye, yaw, pitch));
  gl.uniformMatrix4fv(U.uVP, false, vp);
  gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]);
  gl.uniform3f(U.uFog, 0.02, 0.03, 0.05);
  gl.uniform1f(U.uFogD, 0.011);
  gl.disable(gl.BLEND); gl.depthMask(true);
  const fwd = [Math.sin(yaw), -Math.cos(yaw)], FOG = [0.02, 0.03, 0.05];
  /* ۱) بازتاب روی کف */
  meshes.forEach(function(m){ if(m.mat.reflect) drawMesh(m, true, t); });
  if(crowdOn){ try{ MirzaCrowd.render(vp, eye, true, fwd, FOG, 0.011); }catch(e){ console.error(e); crowdOn = false; } gl.useProgram(prog); }
  /* ۲) کف نیمه‌شفاف */
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  meshes.forEach(function(m){ if(m.mat.kind === "floor") drawMesh(m, false, t); });
  gl.disable(gl.BLEND);
  if(crowdOn){ try{ MirzaCrowd.renderBlobs(vp, eye, fwd); }catch(e){ console.error(e); crowdOn = false; } gl.useProgram(prog); }
  /* ۳) اجسام مات */
  meshes.forEach(function(m){ if(m.mat.kind === "solid") drawMesh(m, false, t); });
  if(crowdOn){ try{ MirzaCrowd.render(vp, eye, false, fwd, FOG, 0.011); }catch(e){ console.error(e); crowdOn = false; } gl.useProgram(prog); gl.disableVertexAttribArray(3); }
  /* ۴) درخشش‌ها (جمع‌شونده) */
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
  meshes.forEach(function(m){ if(m.mat.kind === "glow") drawMesh(m, false, t); });
  gl.depthMask(true); gl.disable(gl.BLEND);
}

/* =========================================================
   حرکت، برخورد و گشت
========================================================= */
function collide(nx, nz){
  const r = 0.55;
  nx = clamp(nx, -HX + r, HX - r); nz = clamp(nz, ZF + r, ZN - r);
  for(let i = 0; i < colliders.length; i++){
    const b = colliders[i];
    if(nx > b[0] - r && nx < b[2] + r && nz > b[1] - r && nz < b[3] + r){
      const d1 = nx - (b[0] - r), d2 = (b[2] + r) - nx, d3 = nz - (b[1] - r), d4 = (b[3] + r) - nz, m = Math.min(d1, d2, d3, d4);
      if(m === d1) nx = b[0] - r; else if(m === d2) nx = b[2] + r; else if(m === d3) nz = b[1] - r; else nz = b[3] + r;
    }
  }
  if(crowdOn){ const q = MirzaCrowd.collidePlayer(nx, nz); nx = clamp(q[0], -HX + r, HX - r); nz = clamp(q[1], ZF + r, ZN - r); }
  return [nx, nz];
}
function inFrame(x, z){
  for(let i = 0; i < colliders.length; i++){ const b = colliders[i]; if(x > b[0] - 1.2 && x < b[2] + 1.2 && z > b[1] - 1.2 && z < b[3] + 1.2) return true; }
  return false;
}
function pathVia(a, b){
  /* اگر خط مستقیم از قاب تابلوی ایستاده می‌گذرد، از کنار آن عبور کن */
  const pts = [a];
  const free = BOARD_DEFS.filter(function(d){ return d.free; });
  free.forEach(function(d){
    let hit = false;
    for(let k = 0; k <= 40; k++){ const t = k / 40, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; if(Math.abs(x - d.cx) < d.fx + 1.6 && Math.abs(z - d.cz) < 1.9){ hit = true; break; } }
    if(hit){
      const side = (a[0] + b[0]) >= 0 ? 1 : -1, lx = side * (d.fx + 3.2), last = pts[pts.length - 1];
      const before = a[1] > d.cz ? d.cz + 2.4 : d.cz - 2.4, after = a[1] > d.cz ? d.cz - 2.4 : d.cz + 2.4;
      pts.push([lx, before]); pts.push([lx, after]);
    }
  });
  pts.push(b);
  return pts;
}
function startGlide(s, dur){
  const path = pathVia([pos[0], pos[2]], [s.x, s.z]);
  let len = 0; for(let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let dy = s.yaw - yaw; while(dy > Math.PI) dy -= 2 * Math.PI; while(dy < -Math.PI) dy += 2 * Math.PI;
  glide = {path:path, len:len, t:0, dur:dur || Math.max(1.4, len / 11), y0:yaw, dy:dy, p0:pitch, p1:s.pitch, st:s};
  curStation = s.idx;
}
function stepGlide(dt){
  const g = glide; g.t += dt / g.dur;
  const e = ease(clamp(g.t, 0, 1)), want = e * g.len;
  let acc = 0, px = g.path[0][0], pz = g.path[0][1];
  for(let i = 1; i < g.path.length; i++){
    const seg = Math.hypot(g.path[i][0] - g.path[i - 1][0], g.path[i][1] - g.path[i - 1][1]);
    if(acc + seg >= want || i === g.path.length - 1){
      const u = seg ? clamp((want - acc) / seg, 0, 1) : 1;
      px = g.path[i - 1][0] + (g.path[i][0] - g.path[i - 1][0]) * u; pz = g.path[i - 1][1] + (g.path[i][1] - g.path[i - 1][1]) * u; break;
    }
    acc += seg;
  }
  pos[0] = px; pos[2] = pz; pos[1] = 1.7;
  yaw = g.y0 + g.dy * e; pitch = g.p0 + (g.p1 - g.p0) * e;
  if(g.t >= 1){ glide = null; }
}
function update(dt, t){
  if(glide){ stepGlide(dt); }
  else{
    let fw = 0, st_ = 0;
    if(keys.KeyW || keys.ArrowUp) fw += 1; if(keys.KeyS || keys.ArrowDown) fw -= 1;
    if(keys.KeyD) st_ += 1; if(keys.KeyA) st_ -= 1;
    if(keys.ArrowLeft) yaw -= 1.8 * dt; if(keys.ArrowRight) yaw += 1.8 * dt;
    fw += -joy.y; st_ += joy.x;
    const len = Math.hypot(fw, st_);
    if(len > 0.01){
      if(tour) stopTour();
      const sp = (keys.ShiftLeft || keys.ShiftRight ? 11 : 6) * Math.min(1, len);
      const f = [Math.sin(yaw), -Math.cos(yaw)], r = [Math.cos(yaw), Math.sin(yaw)];
      const vx = (f[0] * fw + r[0] * st_) / Math.max(len, 1), vz = (f[1] * fw + r[1] * st_) / Math.max(len, 1);
      const c = collide(pos[0] + vx * sp * dt, pos[2] + vz * sp * dt);
      pos[0] = c[0]; pos[2] = c[1];
      walkPh += dt * sp * 1.6;
      pos[1] = 1.7 + Math.sin(walkPh) * 0.035;
    }else pos[1] += (1.7 - pos[1]) * Math.min(1, dt * 8);
  }
  pitch = clamp(pitch, -1.25, 1.25);
  if(tour){
    tour.wait -= dt;
    if(!glide && tour.wait <= 0){
      tour.i = (tour.i + 1) % tour.order.length;
      startGlide(stations[tour.order[tour.i]]); tour.wait = 8.5;
    }
  }
}

function startTour(){
  tour = {order:[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], i:0, wait:8.5};
  startGlide(stations[0]);
  const b = document.getElementById("hallTour"); if(b) b.textContent = "⏹ توقف جولت";
}
function stopTour(){
  tour = null; const b = document.getElementById("hallTour"); if(b) b.textContent = "🎬 جولت راهنما";
}

/* =========================================================
   رابط (HUD)
========================================================= */
const $h = function(id){ return document.getElementById(id); };

function nearestBoard(){
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);
  let best = null, bd = 1e9;
  boards.forEach(function(b){
    const d = b.def, dx = d.cx - pos[0], dz = d.cz - pos[2], dist = Math.hypot(dx, dz);
    if(dist > 24) return;
    const dot = (dx * fx + dz * fz) / (dist || 1);
    if(dot < 0.8) return;
    const facing = (-dx * d.nx + -dz * d.nz) / (dist || 1);   /* بیننده روبه‌روی تابلو باشد */
    if(facing < 0.15) return;
    if(dist < bd){ bd = dist; best = b; }
  });
  return best;
}
function updateHud(){
  activeBoard = nearestBoard();
  const ttl = $h("hallTitle"), pr = $h("hallPrompt");
  if(activeBoard){
    ttl.textContent = activeBoard.label;
    ttl.classList.add("show");
    pr.hidden = false;
    pr.innerHTML = "برای دیدن جزئیات «" + activeBoard.label + "» <kbd class=\"ltr\">E</kbd> را بزنید یا اینجا کلیک کنید";
  }else{
    ttl.classList.remove("show"); pr.hidden = true;
  }
  /* نقشه‌ی کوچک */
  const m = $h("hallMap"); if(!m) return;
  const x = m.getContext("2d"), mw = m.width, mh = m.height, s = mh / (ZN - ZF + 4);
  const X = function(px){ return mw / 2 + px * s; }, Z = function(pz){ return (pz - ZF + 2) * s; };
  x.clearRect(0, 0, mw, mh);
  x.fillStyle = "rgba(8,10,15,0.78)"; x.fillRect(0, 0, mw, mh);
  x.strokeStyle = "rgba(231,196,97,0.6)"; x.lineWidth = 1.5; x.strokeRect(X(-HX), Z(ZN), 2 * HX * s, (ZF - ZN) * s);
  boards.forEach(function(b){
    const d = b.def, on = b === activeBoard;
    x.fillStyle = on ? "#e7c461" : "rgba(231,196,97,0.45)";
    if(d.nx === 0) x.fillRect(X(d.cx - d.w / 2), Z(d.cz) - 2, d.w * s, 4); else x.fillRect(X(d.cx) - 2, Z(d.cz - d.w / 2), 4, d.w * s);
  });
  x.fillStyle = "#4aa3ff"; x.beginPath(); x.arc(X(pos[0]), Z(pos[2]), 4.5, 0, 7); x.fill();
  x.strokeStyle = "#4aa3ff"; x.lineWidth = 2; x.beginPath(); x.moveTo(X(pos[0]), Z(pos[2])); x.lineTo(X(pos[0]) + Math.sin(yaw) * 14, Z(pos[2]) - Math.cos(yaw) * 14); x.stroke();
}
function buildStationChips(){
  const box = $h("hallStations"); box.innerHTML = "";
  stations.forEach(function(s, i){
    const b = document.createElement("button"); b.type = "button"; b.className = "hall-chip"; b.dataset.i = i;
    b.textContent = (i + 1 <= 9 ? (i + 1) + "  " : "") + s.label;
    b.addEventListener("click", function(){ stopTour(); startGlide(s); });
    box.appendChild(b);
  });
}
function markChips(){
  const box = $h("hallStations"); if(!box) return;
  Array.prototype.forEach.call(box.children, function(b, i){ b.classList.toggle("active", i === curStation); });
}
function openDetails(b){
  if(!b) return;
  close();
  setTimeout(function(){
    const el = document.getElementById(b.sec);
    if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
  }, 60);
}

/* =========================================================
   رویدادها
========================================================= */
function onKeyDown(e){
  if(!opened) return;
  if(/^(Input|Select|Textarea)$/i.test((e.target && e.target.tagName) || "")) return;
  keys[e.code] = true;
  if(e.code === "KeyE" && activeBoard) openDetails(activeBoard);
  if(e.code === "KeyT"){ tour ? stopTour() : startTour(); }
  if(/^Digit[0-9]$/.test(e.code)){
    const n = e.code === "Digit0" ? 9 : parseInt(e.code.slice(5), 10) - 1;
    if(stations[n]){ stopTour(); startGlide(stations[n]); }
  }
  if(e.code === "Escape" && !locked) close();
  if(/^(Arrow|Space)/.test(e.code)) e.preventDefault();
}
function onKeyUp(e){ keys[e.code] = false; }
function onMouseMove(e){
  if(!opened) return;
  if(locked || dragging){
    if(glide) glide = null;
    yaw += (e.movementX || 0) * 0.0023; pitch -= (e.movementY || 0) * 0.0023;
    if(tour && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) stopTour();
  }
}
function setupTouch(){
  const area = $h("hall");
  const J = $h("joy"), K = $h("joyKnob");
  area.addEventListener("touchstart", function(e){
    if(!opened) return;
    for(let i = 0; i < e.changedTouches.length; i++){
      const t = e.changedTouches[i];
      if(e.target.closest && e.target.closest(".hall-top, .hall-prompt, .hall-resume")) continue;
      if(t.clientX < window.innerWidth * 0.45 && joy.id == null){
        joy.id = t.identifier; joy.sx = t.clientX; joy.sy = t.clientY; joy.x = joy.y = 0;
        J.hidden = false; J.style.left = (t.clientX - 60) + "px"; J.style.top = (t.clientY - 60) + "px"; K.style.transform = "translate(0,0)";
      }else if(lookTouch == null){ lookTouch = {id:t.identifier, x:t.clientX, y:t.clientY}; }
    }
  }, {passive:true});
  area.addEventListener("touchmove", function(e){
    if(!opened) return;
    for(let i = 0; i < e.changedTouches.length; i++){
      const t = e.changedTouches[i];
      if(t.identifier === joy.id){
        let dx = t.clientX - joy.sx, dy = t.clientY - joy.sy; const l = Math.hypot(dx, dy), mx = 55;
        if(l > mx){ dx = dx / l * mx; dy = dy / l * mx; }
        joy.x = dx / mx; joy.y = dy / mx; K.style.transform = "translate(" + dx + "px," + dy + "px)";
        if(glide) glide = null; if(tour) stopTour();
      }else if(lookTouch && t.identifier === lookTouch.id){
        yaw += (t.clientX - lookTouch.x) * 0.0045; pitch -= (t.clientY - lookTouch.y) * 0.0045;
        lookTouch.x = t.clientX; lookTouch.y = t.clientY; if(glide) glide = null;
      }
    }
    if(e.cancelable && !(e.target.closest && e.target.closest(".hall-top"))) e.preventDefault();
  }, {passive:false});
  const end = function(e){
    for(let i = 0; i < e.changedTouches.length; i++){
      const t = e.changedTouches[i];
      if(t.identifier === joy.id){ joy.id = null; joy.x = joy.y = 0; J.hidden = true; }
      if(lookTouch && t.identifier === lookTouch.id) lookTouch = null;
    }
  };
  area.addEventListener("touchend", end); area.addEventListener("touchcancel", end);
}

/* =========================================================
   چرخه‌ی نمایش
========================================================= */
function redrawBoard(b){
  const c = b.ctx;
  c.setTransform(b.sc, 0, 0, b.sc, 0, 0);
  c.clearRect(0, 0, LW, LH);
  try{ b.def.draw(c); }
  catch(err){ console.error("[تالار] خطا در تابلوی " + b.id, err); c.fillStyle = "#300"; c.fillRect(0, 0, LW, LH); T(c, "خطا در نمایش این تابلو", LW / 2, LH / 2, {s:60, a:"center"}); }
  reupload(b.tex, b.canvas);
}
function refreshBoards(force){
  boards.forEach(function(b){
    const d = b.def;
    if(!force && Math.hypot(d.cx - pos[0], d.cz - pos[2]) > 48) return;
    let sig;
    try{ sig = JSON.stringify(SIG[b.id]()); }catch(e){ sig = "err"; }
    if(force || sig !== b.sig){ b.sig = sig; redrawBoard(b); }
  });
}
function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, lowQ ? 1.5 : 2);
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
}
function frame(now){
  if(!opened) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000); lastT = now;
  clock += dt;
  update(dt, clock);
  if(crowdOn){ try{ MirzaCrowd.update(dt, clock, pos); }catch(e){ console.error("[تالار] خطا در آدم‌ها:", e); crowdOn = false; } }
  render(clock);
  if(Math.floor(clock * 2) !== Math.floor((clock - dt) * 2)){ updateHud(); markChips(); }
  if(Math.floor(clock) !== Math.floor(clock - dt)) refreshBoards(false);
}

async function loadCrypto(){
  try{
    const r = await timeoutFetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=true&price_change_percentage=24h", 10000);
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if(!Array.isArray(j) || !j.length) throw new Error("پاسخ خالی");
    crypto_.list = j.map(function(k){ return {id:k.id, symbol:k.symbol, name:k.name, price:k.current_price, pct:k.price_change_percentage_24h, mcap:k.market_cap, spark:k.sparkline_in_7d && k.sparkline_in_7d.price ? k.sparkline_in_7d.price.filter(function(_, i){ return i % 4 === 0; }) : null}; });
    crypto_.t = Date.now(); crypto_.err = "";
  }catch(e){ crypto_.err = shortErr(e); }
}

/* =========================================================
   باز و بسته کردن تالار
========================================================= */
function supportsGL(){
  try{ const c = document.createElement("canvas"); return !!(c.getContext("webgl") || c.getContext("experimental-webgl")); }
  catch(e){ return false; }
}
function initCrowd(){
  crowdOn = false;
  try{
    const size = typeof CROWD_SIZE === "number" ? CROWD_SIZE : 1;
    if(!window.MirzaCrowd || size <= 0) return;
    MirzaCrowd.init({gl:gl, boards:BOARD_DEFS, colliders:colliders, bounds:{HX:HX, ZN:ZN, ZF:ZF}, lowQ:lowQ,
      size:size, scarf:typeof CROWD_WOMEN_SCARF === "number" ? CROWD_WOMEN_SCARF : 0.6});
    crowdOn = true;
  }catch(e){ console.error("[تالار] آدم‌ها ساخته نشدند:", e); crowdOn = false; }
}
function ensureInit(){
  if(inited) return true;
  try{
    canvas = $h("hallCanvas");
    lowQ = Math.min(window.innerWidth, window.innerHeight) < 700;
    initGL();
    buildStaticTextures();
    buildScene();
    initCrowd();
    buildStationChips();
    setupTouch();
    window.addEventListener("resize", function(){ if(opened) resize(); });
    document.addEventListener("keydown", onKeyDown); document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", function(e){
      if(!opened) return;
      dragging = true;
      if(canvas.requestPointerLock && !locked){ try{ canvas.requestPointerLock(); }catch(err){} }
    });
    window.addEventListener("mouseup", function(){ dragging = false; });
    document.addEventListener("pointerlockchange", function(){
      locked = document.pointerLockElement === canvas;
      const rs = $h("hallResume"); if(rs) rs.hidden = locked || !opened || ("ontouchstart" in window);
    });
    $h("hallPrompt").addEventListener("click", function(){ openDetails(activeBoard); });
    $h("hallExit").addEventListener("click", function(){ close(); });
    $h("hallTour").addEventListener("click", function(){ tour ? stopTour() : startTour(); });
    const rs = $h("hallResume"); if(rs) rs.addEventListener("click", function(){ try{ canvas.requestPointerLock(); }catch(err){} });
    document.addEventListener("visibilitychange", function(){ if(document.hidden){ cancelAnimationFrame(raf); } else if(opened){ lastT = 0; raf = requestAnimationFrame(frame); } });
    if(document.fonts && document.fonts.load){
      Promise.all([document.fonts.load("400 40px Vazirmatn"), document.fonts.load("700 40px Vazirmatn")]).catch(function(){}).then(function(){ fontsReady = true; if(inited) refreshBoards(true); });
    }
    inited = true;
    return true;
  }catch(e){
    console.error("[تالار] راه‌اندازی ناموفق:", e);
    const msg = $h("hallMsg"); if(msg){ msg.hidden = false; msg.textContent = "نمایش سه‌بعدی روی این دستگاه ممکن نشد: " + (e.message || e); }
    return false;
  }
}
function open(){
  const hall = $h("hall"); hall.hidden = false;
  document.body.classList.add("hall-open");
  const intro = $h("intro"); if(intro) intro.hidden = true;
  if(!ensureInit()){ return; }
  opened = true;
  resize();
  hallOpenedAt = hallOpenedAt || Date.now();
  clearTimeout(open._late); open._late = setTimeout(function(){ if(opened) refreshBoards(true); }, 26000);
  refreshBoards(true);
  loadCrypto().then(function(){ refreshBoards(false); });
  if(!open._timer) open._timer = setInterval(function(){ if(opened) loadCrypto(); }, 90000);
  try{ history.replaceState(null, "", "#hall"); }catch(e){}
  if(!open._placed){ pos[0] = 0; pos[2] = 13.5; yaw = 0; pitch = 0.05; open._placed = true; curStation = 0; }
  lastT = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  const hint = $h("hallHint"); if(hint){ hint.classList.remove("fade"); clearTimeout(open._hint); open._hint = setTimeout(function(){ hint.classList.add("fade"); }, 12000); }
  const rs = $h("hallResume"); if(rs) rs.hidden = true;
  try{ if(canvas.requestPointerLock && !("ontouchstart" in window)) canvas.requestPointerLock(); }catch(e){}
}
function close(){
  opened = false; cancelAnimationFrame(raf); stopTour();
  try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
  Object.keys(keys).forEach(function(k){ keys[k] = false; });
  const hall = $h("hall"); if(hall) hall.hidden = true;
  document.body.classList.remove("hall-open");
  try{ if(location.hash === "#hall") history.replaceState(null, "", location.pathname + location.search); }catch(e){}
}
function init(){
  const ok = supportsGL();
  document.body.classList.toggle("no-webgl", !ok);
  const openers = [$h("hallOpenBtn"), $h("enter3d")];
  openers.forEach(function(b){ if(b){ b.hidden = !ok; b.addEventListener("click", open); } });
  const cl = $h("enterClassic"); if(cl) cl.addEventListener("click", function(){ $h("intro").hidden = true; try{ sessionStorage.setItem("mirza_intro", "1"); }catch(e){} });
  const e3 = $h("enter3d"); if(e3) e3.addEventListener("click", function(){ try{ sessionStorage.setItem("mirza_intro", "1"); }catch(e){} });
  const intro = $h("intro");
  let seen = false; try{ seen = sessionStorage.getItem("mirza_intro") === "1"; }catch(e){}
  if(intro){
    if(!ok){ const n = $h("introNote"); if(n) n.textContent = "مرورگر شما از نمایش سه‌بعدی (WebGL) پشتیبانی نمی‌کند؛ نسخه‌ی ساده‌ی داشبورد در دسترس است."; }
    intro.hidden = seen || location.hash === "#hall";
  }
  if(ok && location.hash === "#hall") open();
}

window.MirzaHall = {
  init:init, open:open, close:close, isOpen:function(){ return opened; },
  _debug:{crowd:function(){ return window.MirzaCrowd && MirzaCrowd.stats ? MirzaCrowd.stats() : null; }, boards:boards, stations:stations, pos:pos, setView:function(x, z, y, p){ pos[0] = x; pos[2] = z; yaw = y || 0; pitch = p || 0; glide = null; }, goto:function(i){ startGlide(stations[i]); }, redraw:function(){ refreshBoards(true); }, tick:function(){ return glide ? "gliding" : "idle"; }}
};
})();
