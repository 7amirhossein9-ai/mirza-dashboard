"use strict";
/* =========================================================
   تاریخچه‌ی کوتاه قیمت‌ها (برای نمودارهای کوچک روی تابلوهای تالار)
   - sparks[id]  : حدود ۳۰ روز آخر قیمت هر بازار جهانی
   - iranHist    : نمونه‌های ثبت‌شده‌ی قیمت بازار ایران در همین مرورگر
   هر دو در localStorage ذخیره می‌شوند تا دفعه‌ی بعد تابلوها از همان لحظه‌ی اول نمودار داشته باشند.
========================================================= */
const sparks = {};
let sparksAt = 0;
try{
  const sv = JSON.parse(localStorage.getItem("mirza_sparks_v1") || "{}") || {};
  Object.keys(sv).forEach(function(id){
    if(sv[id] && Array.isArray(sv[id].v) && sv[id].v.length > 2) sparks[id] = sv[id];
  });
}catch(e){}

function downsample(arr, n){
  if(!arr || arr.length <= n) return arr ? arr.slice() : [];
  const out = [];
  for(let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
  return out;
}
function saveSparks(){
  try{ localStorage.setItem("mirza_sparks_v1", JSON.stringify(sparks)); }catch(e){}
}
/* آرایه‌ی قیمت برای رسم نمودار کوچک: اول تاریخچه‌ی ۳۰ روزه، وگرنه روند درون‌روزی همان قیمت */
function applyCachedChanges(){
  MARKETS.forEach(function(m){ if(sparks[m.id]) fillChangeFromHistory(m.id, sparks[m.id].v); });
}
function sparkOf(id){
  if(sparks[id] && sparks[id].v && sparks[id].v.length > 2) return sparks[id].v;
  const q = typeof quotes !== "undefined" ? quotes[id] : null;
  if(q && q.spark && q.spark.length > 2) return q.spark;
  return null;
}

async function fetchSpark(m){
  const tries = [];
  if(m.fx) tries.push(async function(){ const d = await frankfurterChart(m.fx, 45); return d.rows; });
  if(m.cg) tries.push(async function(){ const d = await coingeckoChart(m.cg, 30); return d.rows; });
  tries.push(async function(){
    if(!healthy("yahoo")) throw new Error("Yahoo کنار گذاشته شد");
    const d = await yahooChart(m.y, "1mo", "1d");
    markOk("yahoo");
    return d.rows;
  });
  if(m.s) tries.push(async function(){
    if(!healthy("stooq")) throw new Error("Stooq کنار گذاشته شد");
    const d = await stooqHistory(m.s, 40);
    markOk("stooq");
    return d.rows;
  });
  for(const t of tries){
    try{
      const rows = await t();
      const v = rows.map(function(r){ return r.c; }).filter(function(x){ return Number.isFinite(x); });
      if(v.length > 2) return v;
    }catch(e){}
  }
  return null;
}

/* بعضی منبع‌های قیمت (مثل gold-api) قیمت دیروز نمی‌دهند؛ از تاریخچه‌ی روزانه تغییر روز را می‌سازیم */
function fillChangeFromHistory(id, v){
  const q = quotes[id];
  if(!q || q.prev != null || !v || v.length < 3) return;
  const prev = v[v.length - 2];
  if(!(prev > 0)) return;
  q.prev = prev; q.change = q.price - prev; q.pct = q.change / prev * 100;
  if(q.hi == null || q.lo == null){
    const day = v.slice(-2);
    q.hi = Math.max.apply(null, day.concat([q.price])); q.lo = Math.min.apply(null, day.concat([q.price]));
  }
  try{ saveQuotes(); renderQuotes(); }catch(e){}
}

let sparksBusy = false;
async function loadSparks(force){
  if(sparksBusy) return;
  sparksBusy = true;
  const queue = MARKETS.filter(function(m){
    const s = sparks[m.id];
    return force || !s || Date.now() - s.t > 3 * 3600000;
  });
  async function worker(){
    while(queue.length){
      const m = queue.shift();
      const v = await fetchSpark(m);
      if(v){
        sparks[m.id] = {t:Date.now(), v:downsample(v, 40)}; sparksAt = Date.now();
        fillChangeFromHistory(m.id, v);
      }
    }
  }
  try{ await Promise.all([worker(), worker()]); }catch(e){}
  saveSparks();
  sparksBusy = false;
}

/* ---------- تاریخچه‌ی بازار ایران ---------- */
const iranHist = {t:[], rows:{}};
try{
  const sv = JSON.parse(localStorage.getItem("mirza_iran_hist_v1") || "null");
  if(sv && Array.isArray(sv.t) && sv.rows) { iranHist.t = sv.t; iranHist.rows = sv.rows; }
}catch(e){}

function recordIranHistory(){
  try{
    if(!iran.cur || iran.stale) return;
    const last = iranHist.t.length ? iranHist.t[iranHist.t.length - 1] : 0;
    if(Date.now() - last < 150000) return;
    const oz = quotes.gold ? quotes.gold.price : null, silver = quotes.silver ? quotes.silver.price : null;
    const R = buildIranRows(IRAN_ROWS, iran.cur, manualUsd, oz, silver);
    iranHist.t.push(Date.now());
    R.rows.forEach(function(r){
      const a = iranHist.rows[r.id] || (iranHist.rows[r.id] = []);
      while(a.length < iranHist.t.length - 1) a.push(null);
      a.push(r.market);
    });
    const MAXP = 160;
    if(iranHist.t.length > MAXP){
      const cut = iranHist.t.length - MAXP;
      iranHist.t.splice(0, cut);
      Object.keys(iranHist.rows).forEach(function(k){ iranHist.rows[k].splice(0, cut); });
    }
    localStorage.setItem("mirza_iran_hist_v1", JSON.stringify(iranHist));
  }catch(e){}
}
function iranSparkOf(id){
  const a = iranHist.rows[id];
  if(!a) return null;
  const v = a.filter(function(x){ return x != null && Number.isFinite(x); });
  return v.length > 2 ? v : null;
}
