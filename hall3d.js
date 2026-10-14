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
const vel = [0, 0];            /* سرعت افقی هموارشده (حرکت نرم‌تر، بدون پرش) */
let yaw = 0, pitch = 0.0, walkPh = 0;
/* رزولوشن تطبیقی: اگر کارت گرافیک نمی‌رسد، نرم‌افزار خودش وضوح را کم و دوباره زیاد می‌کند */
let renderScale = 1, scaleCeil = 1, perfAcc = 0, perfN = 0, perfBase = 1e9, perfWin = 0, perfLast = 0, perfLastUp = 0;
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
  if(anisoExt) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, anisoMax));
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

/* ردیف قیمت (برای تابلوهای بازار ایران و جهانی) */
function priceRow(c, colR, y, h, name, sub, priceTxt, pctVal, pctTxt, accent){
  rrect(c, colR - 940, y, 940, h - 12, 18, COL.card);
  c.fillStyle = accent || dirCol(pctVal); c.fillRect(colR - 8, y + 14, 8, h - 40);
  T(c, name, colR - 28, y + (sub ? 30 : (h - 12) / 2), {s:44, w:700, max:300});
  if(sub) T(c, sub, colR - 28, y + 72, {s:26, c:COL.muted, max:300});
  N(c, priceTxt, colR - 360, y + (h - 12) / 2, {s:50, w:700, c:COL.gold, max:330});
  if(pctTxt != null) N(c, (pctVal != null ? arrow(pctVal) : "") + pctTxt, colR - 700, y + (h - 12) / 2, {s:38, w:700, c:dirCol(pctVal), max:230});
}

/* =========================================================
   محتوای تابلوها
========================================================= */
function drawWelcome(c){
  chrome(c, "به میرزا خوش آمدید", "تالار سه‌بعدی بازارهای مالی", COL.gold);
  const img = document.getElementById("logoImg");
  try{ if(img && img.complete && img.naturalWidth) c.drawImage(img, 1560, 220, 380, 380); }catch(e){}
  T(c, "هر اتفاق، یک اثر؛ هر اثر، یک تحلیل", 1500, 300, {s:62, w:700, a:"right", max:1300});
  T(c, "قیمت زنده، تحلیل بازار و اخبار فارسی؛ همه روی تابلوهای این تالار", 1500, 390, {s:38, c:COL.muted, max:1300});
  const rows = [["حرکت", ["W", "A", "S", "D"]], ["دویدن", ["Shift"]], ["نگاه کردن", ["ماوس"]], ["جزئیات تابلو", ["E"]], ["پرش به تابلو", ["1", "…", "9"]]];
  rows.forEach(function(r, i){
    const y = 520 + i * 90;
    T(c, r[0], 1960, y, {s:42, w:700});
    let x = 1640;
    r[1].forEach(function(k){
      const w = k.length > 2 ? 150 : 76;
      rrect(c, x - w, y - 32, w, 64, 12, "#1b2331", COL.line);
      if(/[A-Za-z0-9…]/.test(k)) N(c, k, x - w / 2, y, {a:"center", s:34, w:700, c:COL.gold}); else T(c, k, x - w / 2, y, {a:"center", s:32, c:COL.gold});
      x -= w + 14;
    });
  });
  T(c, "برای ورود به هر بخش به تابلوی آن نزدیک شوید و دکمه‌ی E را بزنید", 1000, 975, {s:32, c:COL.muted, a:"center"});
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
    const col = i < 7 ? 2010 : 1000, row = i % 7, y = 180 + row * 118;
    const d = r.def;
    priceRow(c, col, y, 118, d.title, d.sub, fmtInt(r.market), r.pct, r.pct != null ? fmtPct(r.pct) : null);
  });
  const usd = R.usd;
  if(usd) T(c, "واحد قیمت‌ها: تومان", 2004, 1000, {s:30, c:COL.muted});
}

function drawWorld(c){
  const q = document.getElementById("quotesStatus");
  chrome(c, "بازارهای جهانی", q ? q.textContent : "", COL.blue);
  const have = MARKETS.filter(function(m){ return quotes[m.id]; });
  if(!have.length){ emptyMsg(c, "قیمت‌های جهانی در حال دریافت است", "کمی صبر کنید…"); return; }
  have.slice(0, 14).forEach(function(m, i){
    const col = i < 7 ? 2010 : 1000, row = i % 7, y = 180 + row * 118, qt = quotes[m.id];
    priceRow(c, col, y, 118, m.name, m.unit, fmt(qt.price, m.dec), qt.pct, qt.pct != null ? fmtPct(qt.pct) : null);
  });
}

const FA_COIN = {bitcoin:"بیت‌کوین", ethereum:"اتریوم", tether:"تتر", binancecoin:"بایننس‌کوین", solana:"سولانا", ripple:"ریپل", "usd-coin":"یواس‌دی‌کوین", dogecoin:"دوج‌کوین", cardano:"کاردانو", tron:"ترون", toncoin:"تون‌کوین", "staked-ether":"استیکد اتر", chainlink:"چین‌لینک", avalanche:"آوالانچ", "the-open-network":"تون‌کوین"};
function drawCrypto(c){
  chrome(c, "بازار ارز دیجیتال", "ده رمزارز برتر بر پایه ارزش بازار · قیمت به دلار", "#f7931a");
  let list = crypto_.list;
  if(!list){
    list = [];
    ["btc", "eth"].forEach(function(id){
      if(quotes[id]) list.push({id:id === "btc" ? "bitcoin" : "ethereum", symbol:id === "btc" ? "BTC" : "ETH", name:id, price:quotes[id].price, pct:quotes[id].pct, mcap:null, spark:null});
    });
    if(!list.length){ emptyMsg(c, "قیمت رمزارزها در حال دریافت است", crypto_.err ? "منبع قیمت رمزارزها پاسخ نداد؛ کمی بعد دوباره تلاش می‌شود." : "کمی صبر کنید…"); return; }
  }
  const x = {rank:1996, name:1930, price:1290, pct:900, spark:820, mcap:96};
  T(c, "نام", x.name, 190, {s:30, c:COL.muted}); T(c, "قیمت", x.price, 190, {s:30, c:COL.muted, a:"right"});
  T(c, "تغییر ۲۴ ساعته", x.pct, 190, {s:30, c:COL.muted, a:"right"}); T(c, "روند ۷ روز", x.spark - 140, 190, {s:30, c:COL.muted, a:"center"});
  T(c, "ارزش بازار", 340, 190, {s:30, c:COL.muted, a:"left", dir:"rtl"});
  list.slice(0, 10).forEach(function(k, i){
    const y = 220 + i * 78;
    rrect(c, 40, y, 1968, 68, 14, i % 2 ? "#0f1520" : COL.card);
    N(c, String(i + 1), x.rank, y + 34, {s:34, c:COL.muted});
    T(c, FA_COIN[k.id] || k.name, x.name, y + 34, {s:40, w:700, max:330});
    N(c, String(k.symbol || "").toUpperCase(), x.name - 360, y + 34, {s:30, c:COL.muted, a:"right"});
    N(c, "$" + fmt(k.price), x.price, y + 34, {s:44, w:700, c:COL.gold, max:340});
    if(k.pct != null) N(c, arrow(k.pct) + Math.abs(k.pct).toFixed(2) + "%", x.pct, y + 34, {s:38, w:700, c:dirCol(k.pct)});
    if(k.spark && k.spark.length > 3){
      const s = k.spark, lo = Math.min.apply(null, s), hi = Math.max.apply(null, s), sx = 560, sw = 260;
      c.strokeStyle = dirCol(s[s.length - 1] - s[0]); c.lineWidth = 3; c.beginPath();
      s.forEach(function(v, j){ const px = sx + sw * j / (s.length - 1), py = y + 58 - (v - lo) / ((hi - lo) || 1) * 46; j ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.stroke();
    }
    if(k.mcap != null) N(c, "$" + (k.mcap >= 1e12 ? (k.mcap / 1e12).toFixed(2) + "T" : (k.mcap / 1e9).toFixed(1) + "B"), 340, y + 34, {s:32, c:COL.muted});
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
    if(cs.fc){ const k = cs.fc.years.length - 1; T(c, "پیش‌بینی", 520, 912, {s:28, c:COL.muted}); N(c, fmtWBShort(ind, cs.fc.mid[k]) + "  (" + cs.fc.years[k] + ")", 520, 960, {s:40, w:700, c:"#b59a4f", max:420}); }
  }
}

function drawNews(c){
  chrome(c, "آخرین اخبار فارسی", news.shownTitle || "تازه‌ترین", COL.blue);
  const items = news.items;
  if(!items || !items.length){ emptyMsg(c, "اخبار در حال دریافت است", "اگر این پیام می‌ماند، سرویس‌های خبر پاسخ نمی‌دهند."); return; }
  items.slice(0, 7).forEach(function(it, i){
    const y = 178 + i * 118;
    rrect(c, 40, y, 1968, 106, 16, COL.card);
    c.fillStyle = COL.blue; c.fillRect(2000, y + 12, 8, 82);
    const lines = wrapRtl(c, it.title, 1840, 36, 700, 2);
    lines.forEach(function(l, k){ T(c, l, 1970, y + 30 + k * 44, {s:36, w:700}); });
    T(c, (it.source || "") + (it.date ? "  ·  " + relTime(it.date) : ""), 1970, y + 96, {s:24, c:COL.muted, max:1500});
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
  items.slice(0, 4).forEach(function(it, i){
    const y = 178 + i * 208, a = it.an;
    rrect(c, 40, y, 1968, 196, 18, COL.card);
    c.fillStyle = a.importance.level === "high" ? COL.down : a.importance.level === "mid" ? COL.warn : COL.muted; c.fillRect(2000, y + 14, 8, 168);
    T(c, it.who, 1970, y + 34, {s:36, w:700, c:COL.gold, max:1400});
    T(c, a.importance.label, 560, y + 34, {s:28, c:a.importance.level === "high" ? COL.down : a.importance.level === "mid" ? COL.warn : COL.muted, a:"left"});
    const lines = wrapRtl(c, a.summary, 1880, 31, 400, 3);
    lines.forEach(function(l, k){ T(c, l, 1970, y + 84 + k * 42, {s:31, c:"#d5d9e0"}); });
  });
}

function drawPulse(c){
  chrome(c, "نبض بازار امروز", "گرایش ریسک‌پذیری یا ریسک‌گریزی", COL.gold);
  const have = MARKETS.filter(function(m){ return quotes[m.id]; }).length;
  if(have < 3){ emptyMsg(c, "برای محاسبه‌ی نبض بازار قیمت‌ها لازم است", "کمی صبر کنید…"); return; }
  const p = computePulse(quotes, MARKETS);
  T(c, "گرایش کلی بازار", 1990, 215, {s:36, c:COL.muted});
  T(c, p.label, 1990, 305, {s:96, w:700, c:p.cls === "up" ? COL.up : p.cls === "down" ? COL.down : COL.warn});
  p.factors.slice(0, 6).forEach(function(f, i){
    const y = 400 + i * 86;
    rrect(c, 1010, y, 980, 74, 14, COL.card);
    T(c, f.name, 1960, y + 37, {s:36, w:700, max:420});
    N(c, fmtPct(f.pct), 1500, y + 37, {s:38, w:700, c:dirCol(f.pct)});
    T(c, f.effect > 0 ? "به نفع ریسک‌پذیری" : f.effect < 0 ? "به نفع ریسک‌گریزی" : "بی‌اثر", 1260, y + 37, {s:28, c:COL.muted, a:"right", max:240});
  });
  const cards = [];
  if(p.ratios.gs != null) cards.push(["نسبت طلا به نقره", p.ratios.gs.toFixed(1)]);
  if(p.ratios.go != null) cards.push(["نسبت طلا به نفت", p.ratios.go.toFixed(1)]);
  if(p.ratios.bg != null) cards.push(["بیت‌کوین بر حسب طلا", p.ratios.bg.toFixed(1)]);
  if(p.vix != null) cards.push(["شاخص ترس", p.vix.toFixed(2)]);
  if(p.tnx != null) cards.push(["بازده اوراق ۱۰ ساله", p.tnx.toFixed(2) + "%"]);
  cards.slice(0, 5).forEach(function(k, i){
    const y = 215 + i * 150;
    rrect(c, 50, y, 900, 134, 16, COL.card);
    T(c, k[0], 920, y + 40, {s:34, c:COL.muted, max:600});
    N(c, k[1], 920, y + 96, {s:62, w:700, c:COL.gold});
  });
}

function drawTech(c){
  chrome(c, "تحلیل فنی نماد انتخاب‌شده", chart.name + " · " + (chart.unit || ""), COL.blue);
  const rows = chart.rows;
  if(!rows || rows.length < 20){ emptyMsg(c, "داده‌ی نمودار هنوز دریافت نشده", "برای تحلیل حداقل ۲۰ کندل لازم است."); return; }
  const closes = rows.map(function(r){ return r.c; }), n = closes.length, last = closes[n - 1];
  const s20 = sma(closes, 20), s50 = sma(closes, 50);
  let lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
  const pv = (hi - lo) * .06 || 1; lo -= pv; hi += pv;
  const L = 130, Rr = 1370, Tp = 230, B = 900, pw = Rr - L, ph = B - Tp;
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
  N(c, fmt(last, chart.dec), L, 195, {s:50, w:700, c:COL.gold, a:"left"});
  T(c, "خط طلایی: قیمت", Rr, 195, {s:26, c:COL.gold, a:"right"}); T(c, "آبی: میانگین ۲۰", Rr - 250, 195, {s:26, c:COL.blue, a:"right"}); T(c, "بنفش: میانگین ۵۰", Rr - 500, 195, {s:26, c:"#c77dff", a:"right"});
  const t0 = rows[0].t, t1 = rows[n - 1].t;
  try{ const f = new Intl.DateTimeFormat("en-GB", {day:"2-digit", month:"short", year:"numeric", timeZone:"Asia/Tehran"}); N(c, f.format(new Date(t0)), L, B + 36, {s:24, c:COL.muted, a:"left"}); N(c, f.format(new Date(t1)), Rr, B + 36, {s:24, c:COL.muted, a:"right"}); }catch(e){}

  /* ستون شاخص‌ها */
  const rs = lastValid(rsi(closes, 14)), mc = macd(closes, 12, 26, 9), mh = lastValid(mc.hist);
  const a20 = lastValid(s20), a50 = n >= 50 ? lastValid(s50) : null;
  let score = 0;
  if(a20 != null) score += last > a20 ? 1 : -1;
  if(a20 != null && a50 != null) score += a20 > a50 ? 1 : -1;
  if(rs != null) score += rs < 30 ? 1 : rs > 70 ? -1 : 0;
  if(mh != null) score += mh > 0 ? 1 : -1;
  const verdict = score >= 2 ? ["گرایش صعودی", COL.up] : score <= -2 ? ["گرایش نزولی", COL.down] : ["خنثی", COL.warn];
  rrect(c, 1420, 190, 590, 130, 16, COL.card); T(c, "جمع‌بندی اندیکاتورها", 1990, 225, {s:30, c:COL.muted}); T(c, verdict[0], 1990, 280, {s:52, w:700, c:verdict[1]});
  const k = [["شاخص قدرت نسبی", rs != null ? rs.toFixed(1) : "—", rs != null ? (rs > 70 ? COL.down : rs < 30 ? COL.up : COL.gold) : COL.gold], ["هیستوگرام MACD", mh != null ? fmtSigned(mh, 2) : "—", mh != null ? dirCol(mh) : COL.gold], ["میانگین ۲۰", fmt(a20, chart.dec), COL.blue], ["میانگین ۵۰", a50 != null ? fmt(a50, chart.dec) : "—", "#c77dff"]];
  k.forEach(function(r, i){ const y = 340 + i * 138; rrect(c, 1420, y, 590, 124, 16, COL.card); T(c, r[0], 1990, y + 36, {s:30, c:COL.muted}); N(c, r[1], 1990, y + 90, {s:54, w:700, c:r[2], max:540}); });
  T(c, "فقط محاسبه‌ی آماری روی کندل‌های نمایش‌داده‌شده؛ توصیه‌ی خرید یا فروش نیست.", 1000, 985, {s:28, c:COL.muted, a:"center"});
}

function drawAbout(c){
  chrome(c, "درباره‌ی میرزا", "منبع داده و توضیحات", COL.gold);
  const img = document.getElementById("logoImg");
  try{ if(img && img.complete && img.naturalWidth) c.drawImage(img, 1620, 200, 340, 340); }catch(e){}
  T(c, "هر اتفاق، یک اثر؛ هر اثر، یک تحلیل", 1560, 270, {s:52, w:700, a:"right", max:1400});
  T(c, "هدف میرزا ارائه‌ی اطلاعات بازار به زبان ساده و قابل فهم است.", 1560, 350, {s:34, c:COL.muted, max:1400});
  const src = [["قیمت‌ها و نمودارها", "Yahoo Finance · CoinGecko · gold-api.com"], ["بازار ایران", "tgju.org"], ["اقتصاد کشورها", "World Bank"], ["اخبار فارسی", "Google News · BBC · DW · Euronews"], ["سخنان مقامات", "Truth Social · Fed · White House"]];
  src.forEach(function(r, i){
    const y = 460 + i * 86; rrect(c, 60, y, 1940, 74, 14, COL.card);
    T(c, r[0], 1970, y + 37, {s:36, w:700}); N(c, r[1], 80, y + 37, {s:32, c:COL.gold, a:"left", max:1100});
  });
  T(c, "اطلاعات این تالار برای اطلاع‌رسانی است و توصیه‌ی سرمایه‌گذاری محسوب نمی‌شود.", 1000, 985, {s:30, c:COL.muted, a:"center"});
}

/* ---------- امضای داده‌ها برای تشخیص نیاز به نقاشی دوباره ---------- */
function minuteKey(){ return Math.floor(Date.now() / 60000); }
const SIG = {
  welcome:function(){ const i = document.getElementById("logoImg"); return [i && i.complete && i.naturalWidth, fontsReady]; },
  iran:function(){ return [iran.t, iran.stale, iran.failed, manualUsd, quotes.gold && quotes.gold.price, quotes.silver && quotes.silver.price, minuteKey()]; },
  world:function(){ return [quotesUpdatedAt, minuteKey()]; },
  crypto:function(){ return [crypto_.t, quotesUpdatedAt, minuteKey()]; },
  countries:function(){ return [cs.reqId, cs.ind, cs.codes.join(), cs.index, cs.base, cs.rows.map(function(r){ return r.latest && r.latest.value; }), cs.fc && cs.fc.model, minuteKey()]; },
  news:function(){ return [news.items && news.items.length, news.items && news.items[0] && news.items[0].title, news.shownTitle, minuteKey()]; },
  statements:function(){ let n = 0, t = 0; Object.keys(st.cache || {}).forEach(function(k){ n += (st.cache[k].items || []).length; t = Math.max(t, st.cache[k].t); }); return [n, t, minuteKey()]; },
  pulse:function(){ return [quotesUpdatedAt, minuteKey()]; },
  tech:function(){ const r = chart.rows; return [r.length, r.length && r[r.length - 1].c, chart.symbol, chart.period, chart.loadedAt, minuteKey()]; },
  about:function(){ const i = document.getElementById("logoImg"); return [i && i.complete && i.naturalWidth, fontsReady]; }
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
    b.canvas = cv(lowQ ? 1536 : 2048, lowQ ? 768 : 1024);
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
  "if(tx){float bias=(uMirror>0.5)?2.2:0.0;base=texture2D(uTex,vUV,bias).rgb*uColor;}" +
  "vec3 col=base;" +
  "bool lit=(uMode<0.5)||(uMode>1.5&&uMode<2.5);" +
  "if(lit){vec3 n=normalize(vN);float hemi=0.5+0.5*n.y;float d=max(dot(n,normalize(vec3(0.25,0.9,0.35))),0.0);col=base*(0.30+0.35*hemi+0.40*d);}" +
  "float dist=length(vW-uEye);float fk=uFogD*dist;float f=1.0-exp(-fk*fk);" +
  "vec3 fogc=uAdd>0.5?vec3(0.0):uFog;col=mix(col,fogc,f);" +
  "if(uMirror>0.5){float h=clamp(-vW.y/9.0,0.0,1.0);col*=0.50*(1.0-h*h);}" +
  "if(uAdd>0.5){gl_FragColor=vec4(col*uAlpha,1.0);}else{gl_FragColor=vec4(col,uAlpha);}" +
  "}";

function compile(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
  return s;
}
function initGL(){
  gl = canvas.getContext("webgl", {antialias:(window.devicePixelRatio || 1) < 1.75, alpha:false, depth:true, stencil:false, powerPreference:"high-performance"}) || canvas.getContext("experimental-webgl");
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
  const vp = mul(persp(1.05, canvas.width / canvas.height, 0.3, 140), viewM(eye, yaw, pitch));
  gl.uniformMatrix4fv(U.uVP, false, vp);
  gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]);
  gl.uniform3f(U.uFog, 0.02, 0.03, 0.05);
  gl.uniform1f(U.uFogD, 0.011);
  gl.disable(gl.BLEND); gl.depthMask(true);
  /* ۱) بازتاب روی کف */
  meshes.forEach(function(m){ if(m.mat.reflect) drawMesh(m, true, t); });
  /* ۲) کف نیمه‌شفاف */
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  meshes.forEach(function(m){ if(m.mat.kind === "floor") drawMesh(m, false, t); });
  gl.disable(gl.BLEND);
  /* ۳) اجسام مات */
  meshes.forEach(function(m){ if(m.mat.kind === "solid") drawMesh(m, false, t); });
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
  if(glide){ stepGlide(dt); vel[0] = vel[1] = 0; }
  else{
    let fw = 0, st_ = 0;
    if(keys.KeyW || keys.ArrowUp) fw += 1; if(keys.KeyS || keys.ArrowDown) fw -= 1;
    if(keys.KeyD) st_ += 1; if(keys.KeyA) st_ -= 1;
    if(keys.ArrowLeft) yaw -= 1.8 * dt; if(keys.ArrowRight) yaw += 1.8 * dt;
    fw += -joy.y; st_ += joy.x;
    const len = Math.hypot(fw, st_);
    let tx = 0, tz = 0;
    if(len > 0.01){
      if(tour) stopTour();
      const sp = (keys.ShiftLeft || keys.ShiftRight ? 11 : 6) * Math.min(1, len);
      const f = [Math.sin(yaw), -Math.cos(yaw)], r = [Math.cos(yaw), Math.sin(yaw)];
      tx = (f[0] * fw + r[0] * st_) / Math.max(len, 1) * sp;
      tz = (f[1] * fw + r[1] * st_) / Math.max(len, 1) * sp;
    }
    /* شتاب و ترمز نرم: سرعت به‌جای پرش ناگهانی، در حدود یک‌دهم ثانیه به مقصد می‌رسد */
    const k = Math.min(1, dt * (len > 0.01 ? 10 : 14));
    vel[0] += (tx - vel[0]) * k; vel[1] += (tz - vel[1]) * k;
    const speed = Math.hypot(vel[0], vel[1]);
    if(speed > 0.03){
      const c = collide(pos[0] + vel[0] * dt, pos[2] + vel[1] * dt);
      pos[0] = c[0]; pos[2] = c[1];
      walkPh += dt * speed * 1.4;
      pos[1] = 1.7 + Math.sin(walkPh) * 0.02 * Math.min(1, speed / 6);   /* لرزش سر ملایم و متناسب با سرعت */
    }else{
      vel[0] = vel[1] = 0;
      pos[1] += (1.7 - pos[1]) * Math.min(1, dt * 8);
    }
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
    if(force || sig !== b.sig){ b.sig = sig; b.need = true; }
  });
}
/* هر فریم حداکثر یک تابلو را دوباره می‌کشد (نزدیک‌ترین اول)؛ پس دیگر لگ ناگهانی هر دقیقه نیست */
function pumpBoards(){
  let best = null, bd = 1e9;
  boards.forEach(function(b){
    if(!b.need) return;
    const d = Math.hypot(b.def.cx - pos[0], b.def.cz - pos[2]);
    if(d < bd){ bd = d; best = b; }
  });
  if(best){ best.need = false; redrawBoard(best); }
}
function flushBoards(){ boards.forEach(function(b){ if(b.need){ b.need = false; redrawBoard(b); } }); }
/* انتخاب خودکار وضوح بر پایه‌ی سرعت واقعی فریم‌ها */
function adaptRes(rawMs){
  if(!(rawMs > 0) || rawMs > 500) return;                 /* پرش زمانی بعد از عوض شدن تب را نادیده بگیر */
  perfAcc += rawMs; perfN++; if(rawMs < perfBase) perfBase = rawMs;
  if(++perfWin > 240){ perfWin = 0; perfBase = rawMs; }
  if(perfN < 45) return;
  const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
  const now = performance.now();
  if(now - perfLast < 2500) return;
  if(avg > 20 && avg > perfBase * 1.3 && renderScale > 0.55){
    if(now - perfLastUp < 12000) scaleCeil = Math.max(0.55, renderScale * 0.95);   /* بالا رفتن جواب نداد؛ مدتی بالاتر نرو */
    renderScale = Math.max(0.55, renderScale * 0.85); perfLast = now; resize();
  }else if(avg < perfBase * 1.12 && renderScale < scaleCeil){
    renderScale = Math.min(scaleCeil, renderScale * 1.1); perfLast = perfLastUp = now; resize();
  }
}
function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, lowQ ? 1.5 : 1.75) * renderScale;
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
}
function frame(now){
  if(!opened) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
  if(lastT) adaptRes(now - lastT);
  lastT = now;
  clock += dt;
  update(dt, clock);
  render(clock);
  pumpBoards();
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
function ensureInit(){
  if(inited) return true;
  try{
    canvas = $h("hallCanvas");
    lowQ = Math.min(window.innerWidth, window.innerHeight) < 700;
    initGL();
    buildStaticTextures();
    buildScene();
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
/* ---------- میان‌بر: نصب روی صفحه‌ی اصلی یا کپی لینک مستقیم تالار ---------- */
let installEvt = null;
window.addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); installEvt = e; });
function hallToast(text){
  const t = $h("hallToast"); if(!t) return;
  t.textContent = text; t.hidden = false;
  clearTimeout(hallToast._t); hallToast._t = setTimeout(function(){ t.hidden = true; }, 6000);
}
function directLink(){ return location.origin + location.pathname + "#hall"; }
async function makeShortcut(){
  if(installEvt){
    try{ installEvt.prompt(); const r = await installEvt.userChoice; installEvt = null; if(r && r.outcome === "accepted"){ hallToast("میان‌بر روی دستگاه شما اضافه شد."); return; } }catch(e){}
  }
  let copied = false;
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(directLink()); copied = true; } }catch(e){}
  hallToast((copied ? "لینک مستقیم تالار کپی شد. " : "لینک مستقیم تالار: " + directLink() + " . ") +
    "برای میان‌بر روی صفحه‌ی اصلی، در منوی مرورگر «افزودن به صفحه‌ی اصلی» (Add to Home screen) را بزنید.");
}
function init(){
  const ok = supportsGL();
  const sc = $h("hallShortcut"); if(sc) sc.addEventListener("click", makeShortcut);
  /* کلید H از هرجای داشبورد، تالار را باز می‌کند */
  document.addEventListener("keydown", function(e){
    if(opened || !ok || e.ctrlKey || e.metaKey || e.altKey || e.code !== "KeyH") return;
    const tg = e.target && e.target.tagName; if(tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT" || (e.target && e.target.isContentEditable)) return;
    open();
  });
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
  _debug:{boards:boards, stations:stations, pos:pos, setView:function(x, z, y, p){ pos[0] = x; pos[2] = z; yaw = y || 0; pitch = p || 0; glide = null; }, goto:function(i){ startGlide(stations[i]); }, redraw:function(){ refreshBoards(true); flushBoards(); }, flush:flushBoards, scale:function(){ return renderScale; }, adapt:adaptRes, tick:function(){ return glide ? "gliding" : "idle"; }}
};
})();
