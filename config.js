"use strict";

/* =========================================================
   تنظیمات
   اگر سرویس‌های واسط رایگان قطع شدند، می‌توانید یک Cloudflare Worker
   شخصی بسازید و آدرسش را اینجا بگذارید، مثلاً:
   const MY_PROXY = "https://my-worker.example.workers.dev/?url=";
========================================================= */
const MY_PROXY = "";

/* لوگو: اگر اسم فایل لوگوی شما چیز دیگری است، همین‌جا بنویسید (حروف کوچک و بزرگ مهم است) */
const LOGO_FILE = "";
const LOGO_SHOW_TEXT = false;   // true = کنار لوگو نوشته‌ی MIRZA هم نمایش داده شود

/* بازارها: y = نماد یاهو، s = نماد استوک، cg = شناسه کوین‌گکو */
const MARKETS = [
  {id:"gold",   icon:"🟡", name:"طلای جهانی",        unit:"دلار / اونس",  type:"فلز گران‌بها", y:"GC=F",     s:"xauusd", sym:"XAUUSD", dec:2},
  {id:"silver", icon:"⚪", name:"نقره",              unit:"دلار / اونس",  type:"فلز گران‌بها", y:"SI=F",     s:"xagusd", sym:"XAGUSD", dec:3},
  {id:"btc",    icon:"₿",  name:"بیت‌کوین",           unit:"دلار",         type:"رمزارز",      y:"BTC-USD",  s:"btcusd", cg:"bitcoin",  sym:"BTCUSD", dec:2},
  {id:"eth",    icon:"Ξ",  name:"اتریوم",             unit:"دلار",         type:"رمزارز",      y:"ETH-USD",  s:"ethusd", cg:"ethereum", sym:"ETHUSD", dec:2},
  {id:"oil",    icon:"🛢", name:"نفت خام وست‌تگزاس", unit:"دلار / بشکه",  type:"انرژی",       y:"CL=F",     s:"cl.f",   sym:"WTI",    dec:2},
  {id:"brent",  icon:"🛢", name:"نفت برنت",           unit:"دلار / بشکه",  type:"انرژی",       y:"BZ=F",     s:null,     sym:"BRENT",  dec:2},
  {id:"dxy",    icon:"💵", name:"شاخص دلار",          unit:"امتیاز",       type:"شاخص",        y:"DX-Y.NYB", s:null,     sym:"DXY",    dec:3},
  {id:"eurusd", icon:"💶", name:"یورو به دلار",       unit:"دلار",         type:"جفت‌ارز",     y:"EURUSD=X", s:"eurusd", sym:"EURUSD", dec:4},
  {id:"gbpusd", icon:"💷", name:"پوند به دلار",       unit:"دلار",         type:"جفت‌ارز",     y:"GBPUSD=X", s:"gbpusd", sym:"GBPUSD", dec:4},
  {id:"usdjpy", icon:"💴", name:"دلار به ین",         unit:"ین",           type:"جفت‌ارز",     y:"JPY=X",    s:"usdjpy", sym:"USDJPY", dec:3},
  {id:"sp500",  icon:"🇺🇸", name:"شاخص اس‌اندپی ۵۰۰", unit:"امتیاز",       type:"شاخص سهام",   y:"^GSPC",    s:"^spx",   sym:"SPX",    dec:2},
  {id:"nasdaq", icon:"💻", name:"شاخص نزدک",          unit:"امتیاز",       type:"شاخص سهام",   y:"^IXIC",    s:null,     sym:"IXIC",   dec:2},
  {id:"vix",    icon:"😨", name:"شاخص ترس (VIX)",     unit:"امتیاز",       type:"شاخص ریسک",   y:"^VIX",     s:null,     sym:"VIX",    dec:2},
  {id:"tnx",    icon:"🏦", name:"بازده اوراق ۱۰ ساله آمریکا", unit:"درصد",  type:"نرخ بهره",    y:"^TNX",     s:null,     sym:"US10Y",  dec:3}
];
const FEATURED = ["gold","btc","eth","oil"];

/* بازه‌های زمانی نمودار */
const PERIODS = {
  "1D":{range:"1d",  interval:"5m",  intLabel:"۵ دقیقه‌ای", intraday:true,  cg:1,   stooqDays:10},
  "5D":{range:"5d",  interval:"30m", intLabel:"۳۰ دقیقه‌ای", intraday:true,  cg:5,   stooqDays:14},
  "1M":{range:"1mo", interval:"1d",  intLabel:"روزانه",      intraday:false, cg:30,  stooqDays:35},
  "3M":{range:"3mo", interval:"1d",  intLabel:"روزانه",      intraday:false, cg:90,  stooqDays:100},
  "6M":{range:"6mo", interval:"1d",  intLabel:"روزانه",      intraday:false, cg:180, stooqDays:190},
  "1Y":{range:"1y",  interval:"1d",  intLabel:"روزانه",      intraday:false, cg:365, stooqDays:370},
  "5Y":{range:"5y",  interval:"1wk", intLabel:"هفتگی",       intraday:false, cg:1825,stooqDays:1830}
};

/* =========================================================
   توابع کمکی عمومی
========================================================= */
const $ = function(id){ return document.getElementById(id); };
const enc = encodeURIComponent;

/* PURE:START */
function num(x){
  const n = typeof x === "number" ? x : parseFloat(x);
  return Number.isFinite(n) ? n : null;
}
function pad2(n){ return String(n).padStart(2,"0"); }

function fmt(n, dec){
  if(n == null || !Number.isFinite(n)) return "—";
  if(dec == null){
    const a = Math.abs(n);
    dec = a >= 100 ? 2 : a >= 1 ? 4 : 6;
  }
  return n.toLocaleString("en-US",{minimumFractionDigits:dec, maximumFractionDigits:dec});
}
function fmtSigned(n, dec){
  if(n == null || !Number.isFinite(n)) return "—";
  return (n > 0 ? "+" : n < 0 ? "-" : "") + fmt(Math.abs(n), dec);
}
function fmtPct(p){
  if(p == null || !Number.isFinite(p)) return "—";
  return (p > 0 ? "+" : p < 0 ? "-" : "") + Math.abs(p).toFixed(2) + "%";
}
function fmtVol(v){
  if(!v) return "—";
  const a = Math.abs(v);
  if(a >= 1e9) return (v/1e9).toFixed(2) + "B";
  if(a >= 1e6) return (v/1e6).toFixed(2) + "M";
  if(a >= 1e3) return (v/1e3).toFixed(1) + "K";
  return String(Math.round(v));
}
function dirOf(x){ return x > 0 ? "up" : x < 0 ? "down" : "flat"; }
function arrowOf(x){ return x > 0 ? "▲" : x < 0 ? "▼" : "●"; }
function shortErr(e){
  if(!e) return "خطای نامشخص";
  if(e.name === "AbortError") return "مهلت پاسخ تمام شد";
  return e.message || String(e);
}

/* ---------- اندیکاتورها ---------- */
function sma(vals, n){
  const out = new Array(vals.length).fill(null);
  let sum = 0;
  for(let i = 0; i < vals.length; i++){
    sum += vals[i];
    if(i >= n) sum -= vals[i-n];
    if(i >= n-1) out[i] = sum / n;
  }
  return out;
}
function ema(vals, n){
  const out = new Array(vals.length).fill(null);
  if(vals.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for(let i = 0; i < n; i++) prev += vals[i];
  prev /= n;
  out[n-1] = prev;
  for(let i = n; i < vals.length; i++){
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsi(vals, n){
  n = n || 14;
  const out = new Array(vals.length).fill(null);
  if(vals.length <= n) return out;
  let g = 0, l = 0;
  for(let i = 1; i <= n; i++){
    const d = vals[i] - vals[i-1];
    if(d >= 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for(let i = n + 1; i < vals.length; i++){
    const d = vals[i] - vals[i-1];
    g = (g * (n-1) + (d > 0 ? d : 0)) / n;
    l = (l * (n-1) + (d < 0 ? -d : 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function macd(vals, f, s, sg){
  f = f || 12; s = s || 26; sg = sg || 9;
  const ef = ema(vals, f), es = ema(vals, s);
  const line = vals.map(function(_, i){
    return ef[i] != null && es[i] != null ? ef[i] - es[i] : null;
  });
  const valid = line.filter(function(x){ return x != null; });
  const sigValid = ema(valid, sg);
  const signal = new Array(vals.length).fill(null);
  let k = 0;
  for(let i = 0; i < line.length; i++){
    if(line[i] != null){ signal[i] = sigValid[k]; k++; }
  }
  const hist = line.map(function(x, i){
    return x != null && signal[i] != null ? x - signal[i] : null;
  });
  return {line:line, signal:signal, hist:hist};
}
function stdev(arr){
  if(arr.length < 2) return null;
  const m = arr.reduce(function(a, b){ return a + b; }, 0) / arr.length;
  const v = arr.reduce(function(a, b){ return a + (b - m) * (b - m); }, 0) / (arr.length - 1);
  return Math.sqrt(v);
}
function lastValid(arr){
  for(let i = arr.length - 1; i >= 0; i--){ if(arr[i] != null) return arr[i]; }
  return null;
}

/* ---------- پارس داده‌ها ---------- */
function parseYahoo(text){
  const j = JSON.parse(text);
  const r = j.chart && j.chart.result && j.chart.result[0];
  if(!r){
    const msg = j.chart && j.chart.error && j.chart.error.description;
    throw new Error(msg || "داده‌ای برای این نماد نیست");
  }
  const ts = r.timestamp || [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const rows = [];
  for(let i = 0; i < ts.length; i++){
    const c = num(q.close && q.close[i]);
    if(c == null) continue;
    const o = num(q.open && q.open[i]);
    const h = num(q.high && q.high[i]);
    const l = num(q.low && q.low[i]);
    rows.push({
      t: ts[i] * 1000,
      o: o == null ? c : o,
      h: h == null ? Math.max(c, o == null ? c : o) : h,
      l: l == null ? Math.min(c, o == null ? c : o) : l,
      c: c,
      v: num(q.volume && q.volume[i]) || 0
    });
  }
  return {meta: r.meta || {}, rows: rows};
}

function parseStooq(text){
  const lines = text.trim().split(/\r?\n/);
  if(lines.length < 2 || !/^date/i.test(lines[0])) throw new Error("پاسخ نامعتبر از استوک");
  const rows = [];
  for(let i = 1; i < lines.length; i++){
    const p = lines[i].split(",");
    const t = Date.parse(p[0] + "T12:00:00Z");
    const o = parseFloat(p[1]), h = parseFloat(p[2]), l = parseFloat(p[3]), c = parseFloat(p[4]);
    const v = parseFloat(p[5]);
    if(!Number.isFinite(t) || !Number.isFinite(c)) continue;
    rows.push({t:t, o:o, h:h, l:l, c:c, v: Number.isFinite(v) ? v : 0});
  }
  if(!rows.length) throw new Error("داده‌ای نیست");
  return {meta:{}, rows:rows};
}

function parseDate(s){
  if(!s) return 0;
  if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s)) s = s.replace(" ", "T") + "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ---------- زبان فارسی ---------- */
function isPersianText(text){
  const letters = (text || "").match(/[A-Za-z\u0600-\u06FF]/g) || [];
  if(!letters.length) return false;
  const fa = (text || "").match(/[\u0600-\u06FF]/g) || [];
  return fa.length / letters.length >= 0.6;
}
function normFa(s){
  return String(s || "")
    .replace(/[\u200c\u200f\u200e]/g, "")
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
function matchesKeywords(title, keywords){
  const t = normFa(title);
  for(let i = 0; i < keywords.length; i++){
    if(t.indexOf(normFa(keywords[i])) !== -1) return true;
  }
  return false;
}
function cleanTitle(title, source){
  let t = (title || "").trim();
  if(source && t.endsWith(" - " + source)){
    t = t.slice(0, t.length - source.length - 3).trim();
  }else{
    t = t.replace(/\s+-\s+[^-]{1,40}$/, "").trim();
  }
  return t;
}
function dedupeNews(items){
  const seenT = new Set(), seenL = new Set(), out = [];
  items.forEach(function(i){
    const k = normFa(i.title);
    if(!k || seenT.has(k) || (i.link && seenL.has(i.link))) return;
    seenT.add(k);
    if(i.link) seenL.add(i.link);
    out.push(i);
  });
  return out;
}
/* PURE:END */
