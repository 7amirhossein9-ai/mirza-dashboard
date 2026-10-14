"use strict";
/* =========================================================
   داده‌ی ذخیره‌شده: تا نمودار و قیمت هرگز خالی نماند
   ۱) آخرین نمودار موفق هر نماد در مرورگر خود شما (localStorage)
   ۲) عکس فوری ساعتی که یک کار خودکار در گیت‌هاب برای سایت می‌سازد (پوشه‌ی data)
   اگر منبع زنده جواب ندهد، تازه‌ترین این دو نشان داده می‌شود و روی صفحه هم نوشته می‌شود که ذخیره‌شده است.
========================================================= */
const CHART_CACHE_IDX = "mirza_chart_idx_v1";
const CHART_CACHE_MAX = 24;
const snap = {quotes:null, quotesTried:false, charts:{}};

function chartCacheKey(symbol, period){ return "mirza_chart_v1_" + symbol + "_" + period; }

/* ذخیره‌ی فشرده: هر ردیف یک آرایه؛ فقط ۲۴ نمودار آخر نگه داشته می‌شود تا حافظه‌ی مرورگر پر نشود */
function chartCacheSave(symbol, period, data){
  try{
    const rows = data.rows.slice(-700).map(function(r){ return [r.t, r.o, r.h, r.l, r.c, r.v || 0]; });
    const key = chartCacheKey(symbol, period);
    localStorage.setItem(key, JSON.stringify({t:Date.now(), source:data.source, lineOnly:!!data.lineOnly, rows:rows}));
    let idx = []; try{ idx = JSON.parse(localStorage.getItem(CHART_CACHE_IDX) || "[]"); }catch(e){}
    idx = idx.filter(function(k){ return k !== key; }); idx.push(key);
    while(idx.length > CHART_CACHE_MAX){ try{ localStorage.removeItem(idx.shift()); }catch(e){} }
    localStorage.setItem(CHART_CACHE_IDX, JSON.stringify(idx));
  }catch(e){}
}
function chartCacheLoad(symbol, period){
  try{
    const j = JSON.parse(localStorage.getItem(chartCacheKey(symbol, period)) || "null");
    if(!j || !Array.isArray(j.rows) || j.rows.length < 2) return null;
    return {savedAt:j.t, source:j.source, lineOnly:!!j.lineOnly, rows:j.rows.map(function(a){ return {t:a[0], o:a[1], h:a[2], l:a[3], c:a[4], v:a[5]}; })};
  }catch(e){ return null; }
}

function fetchJsonTimeout(url, ms){
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(function(){ if(ctl) ctl.abort(); }, ms || 8000);
  return fetch(url, {cache:"no-cache", signal:ctl ? ctl.signal : undefined}).then(function(r){
    clearTimeout(t); if(!r.ok) throw new Error("HTTP " + r.status); return r.json();
  }, function(e){ clearTimeout(t); throw e; });
}

/* عکس فوری نمودار یک بازار (روزانه، حدود یک سال) */
async function snapshotChart(m, days){
  if(!m) return null;
  let j = snap.charts[m.id];
  if(j === undefined){
    try{ j = await fetchJsonTimeout("data/charts/" + m.id + ".json", 8000); }catch(e){ j = null; }
    snap.charts[m.id] = j;
  }
  if(!j || !Array.isArray(j.rows) || j.rows.length < 2) return null;
  const from = Date.now() - Math.max(days, 30) * 86400000;
  let rows = j.rows.filter(function(a){ return a[0] >= from; });
  if(rows.length < 2) rows = j.rows.slice(-30);
  return {savedAt:j.updated || rows[rows.length - 1][0], source:"عکس فوری سایت" + (j.source ? " (" + j.source + ")" : ""), lineOnly:!!j.lineOnly,
    rows:rows.map(function(a){ return {t:a[0], o:a[1], h:a[2], l:a[3], c:a[4], v:a[5] || 0}; })};
}

/* تازه‌ترین گزینه‌ی ذخیره‌شده برای نمودار */
async function offlineChart(m, symbol, period, days){
  const a = chartCacheLoad(symbol, period);
  const b = await snapshotChart(m, days);
  const lastT = function(x){ return x ? x.rows[x.rows.length - 1].t : 0; };
  const best = lastT(a) >= lastT(b) ? (a || b) : b;
  return best || null;
}

/* قیمت ذخیره‌شده‌ی همه‌ی بازارها (فایل کوچک data/quotes.json) */
async function snapshotQuotes(){
  if(snap.quotesTried) return snap.quotes;
  snap.quotesTried = true;
  try{ snap.quotes = await fetchJsonTimeout("data/quotes.json", 8000); }catch(e){ snap.quotes = null; }
  return snap.quotes;
}
async function snapshotQuote(m){
  const j = await snapshotQuotes();
  const q = j && j.markets && j.markets[m.id];
  if(!q || !isFinite(q.price)) return null;
  return makeQuote(q.price, q.prev != null ? q.prev : null, q.hi != null ? q.hi : null, q.lo != null ? q.lo : null, q.t || Date.parse(j.updated) || Date.now(), "عکس فوری سایت");
}
