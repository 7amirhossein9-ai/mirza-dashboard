"use strict";
function timeoutFetch(url, ms){
  const controller = new AbortController();
  const timer = setTimeout(function(){ controller.abort(); }, ms);
  return fetch(url, {cache:"no-store", signal:controller.signal})
    .finally(function(){ clearTimeout(timer); });
}

/* =========================================================
   لایه‌ی شبکه: سرویس‌های واسط (برای عبور از محدودیت CORS)
========================================================= */
const PROXIES = [];
if(MY_PROXY) PROXIES.push({name:"my-proxy", build:function(u){ return MY_PROXY + enc(u); }});
PROXIES.push(
  {name:"allorigins",    build:function(u){ return "https://api.allorigins.win/raw?url=" + enc(u); }},
  {name:"codetabs",       build:function(u){ return "https://api.codetabs.com/v1/proxy?quest=" + enc(u); }},
  {name:"corsproxy",      build:function(u){ return "https://corsproxy.io/?url=" + enc(u); }},
  {name:"allorigins-get", build:function(u){ return "https://api.allorigins.win/get?url=" + enc(u); }, wrapped:true}
);
/* توجه: این‌ها سرویس‌های رایگان و ناپایدارند. برای پایداری کامل، فایل worker.js را در
   Cloudflare Worker (رایگان) بسازید و آدرسش را در MY_PROXY (فایل config.js) بگذارید. */
let proxyPref = 0;

async function viaProxy(p, target, validate, ms){
  try{
    const res = await timeoutFetch(p.build(target), ms);
    if(!res.ok) throw new Error("HTTP " + res.status);
    let text = await res.text();
    if(p.wrapped){
      const j = JSON.parse(text);
      text = j.contents || "";
    }
    if(!text || !text.trim()) throw new Error("پاسخ خالی");
    return {value: validate(text), via: p.name};
  }catch(e){
    throw new Error(p.name + ": " + shortErr(e));
  }
}

/* امتحان پشت‌سرهم؛ آخرین سرویس موفق اول امتحان می‌شود */
async function fetchSequential(target, validate, opts){
  opts = opts || {};
  const ms = opts.ms || 7000;
  const max = opts.max || PROXIES.length;
  const errors = [];
  for(let k = 0; k < max; k++){
    const idx = (proxyPref + k) % PROXIES.length;
    try{
      const r = await viaProxy(PROXIES[idx], target, validate, ms);
      proxyPref = idx;
      return r;
    }catch(e){
      errors.push(e.message);
    }
  }
  const err = new Error("همه‌ی سرویس‌های واسط ناموفق بودند");
  err.details = errors;
  throw err;
}

/* درخواست هم‌زمان؛ اولین پاسخ درست برنده است */
function fetchRace(target, validate, extra, ms){
  const jobs = PROXIES.map(function(p){ return viaProxy(p, target, validate, ms || 9000); });
  (extra || []).forEach(function(x){ jobs.push(x); });
  return Promise.any(jobs).catch(function(agg){
    const err = new Error("همه‌ی سرویس‌ها ناموفق بودند");
    err.details = (agg.errors || []).map(function(e){ return e.message; });
    throw err;
  });
}

/* سلامت هر منبع داده: بعد از چند خطای پشت‌سرهم چند ثانیه نادیده گرفته می‌شود */
const health = {};
function healthy(n){ const h = health[n]; return !h || h.until <= Date.now(); }
function markFail(n){
  const h = health[n] || (health[n] = {fails:0, until:0});
  h.fails++;
  if(h.fails >= 3){ h.until = Date.now() + 90000; h.fails = 0; }
}
function markOk(n){ health[n] = {fails:0, until:0}; }

/* =========================================================
   منابع داده‌ی قیمت
========================================================= */
async function yahooChart(symbol, range, interval){
  const path = "/v8/finance/chart/" + enc(symbol) +
    "?range=" + range + "&interval=" + interval + "&includePrePost=false";
  try{
    const r = await fetchSequential("https://query1.finance.yahoo.com" + path, parseYahoo);
    return r.value;
  }catch(e1){
    try{
      const r2 = await fetchSequential("https://query2.finance.yahoo.com" + path, parseYahoo, {max:2});
      return r2.value;
    }catch(e2){
      e1.details = (e1.details || [e1.message]).concat(e2.details || []);
      throw e1;
    }
  }
}

function ymd(ms){
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
}
async function stooqHistory(sym, days){
  const now = Date.now();
  const url = "https://stooq.com/q/d/l/?s=" + enc(sym) + "&i=d&d1=" + ymd(now - days * 86400000) + "&d2=" + ymd(now + 86400000);
  const r = await fetchSequential(url, parseStooq);
  return r.value;
}

async function coingeckoChart(id, days){
  const res = await timeoutFetch("https://api.coingecko.com/api/v3/coins/" + id + "/market_chart?vs_currency=usd&days=" + days, 9000);
  if(!res.ok) throw new Error("CoinGecko: HTTP " + res.status);
  const j = await res.json();
  const rows = (j.prices || []).map(function(p){
    return {t:p[0], o:p[1], h:p[1], l:p[1], c:p[1], v:0};
  });
  if(!rows.length) throw new Error("CoinGecko: بدون داده");
  return {meta:{}, rows:rows, lineOnly:true};
}
async function coingeckoQuote(id){
  const res = await timeoutFetch("https://api.coingecko.com/api/v3/simple/price?ids=" + id + "&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", 9000);
  if(!res.ok) throw new Error("CoinGecko: HTTP " + res.status);
  const j = await res.json();
  const d = j[id];
  if(!d || num(d.usd) == null) throw new Error("CoinGecko: بدون قیمت");
  const price = d.usd;
  const pct = num(d.usd_24h_change);
  const prev = pct != null ? price / (1 + pct / 100) : null;
  return makeQuote(price, prev, null, null, (d.last_updated_at || 0) * 1000, "CoinGecko");
}

function makeQuote(price, prev, hi, lo, t, source){
  if(price == null || !Number.isFinite(price)) throw new Error("قیمت نامعتبر");
  const change = prev ? price - prev : null;
  const pct = prev ? change / prev * 100 : null;
  return {price:price, prev:prev, change:change, pct:pct, hi:hi, lo:lo, t:t || Date.now(), source:source};
}

function quoteFromYahoo(data){
  const meta = data.meta || {};
  const rows = data.rows || [];
  const last = rows.length ? rows[rows.length - 1] : null;
  let price = num(meta.regularMarketPrice);
  if(price == null && last) price = last.c;
  let prev = num(meta.chartPreviousClose);
  if(prev == null) prev = num(meta.previousClose);
  if(prev == null && rows.length) prev = rows[0].o;
  let hi = num(meta.regularMarketDayHigh);
  let lo = num(meta.regularMarketDayLow);
  if(hi == null && rows.length) hi = Math.max.apply(null, rows.map(function(r){ return r.h; }));
  if(lo == null && rows.length) lo = Math.min.apply(null, rows.map(function(r){ return r.l; }));
  const t = (meta.regularMarketTime || 0) * 1000 || (last && last.t);
  return makeQuote(price, prev, hi, lo, t, "Yahoo Finance");
}

/* =========================================================
   منابع مستقیم (بدون نیاز به سرویس واسط؛ اجازه‌ی دسترسی مرورگر دارند)
========================================================= */
async function goldApiQuote(sym){
  const res = await timeoutFetch("https://api.gold-api.com/price/" + sym, 8000);
  if(!res.ok) throw new Error("gold-api: HTTP " + res.status);
  const j = await res.json();
  const price = num(j.price);
  if(price == null) throw new Error("gold-api: بدون قیمت");
  return makeQuote(price, null, null, null, Date.parse(j.updatedAt) || Date.now(), "gold-api.com");
}

function isoDay(ms){ return new Date(ms).toISOString().slice(0, 10); }
async function frankfurterSeries(base, quote, days){
  const from = isoDay(Date.now() - days * 86400000);
  const res = await timeoutFetch("https://api.frankfurter.dev/v1/" + from + "..?base=" + base + "&symbols=" + quote, 9000);
  if(!res.ok) throw new Error("frankfurter: HTTP " + res.status);
  const j = await res.json();
  const days_ = Object.keys(j.rates || {}).sort();
  if(!days_.length) throw new Error("frankfurter: بدون داده");
  return days_.map(function(d){ return {t:Date.parse(d + "T12:00:00Z"), c:j.rates[d][quote]}; }).filter(function(r){ return num(r.c) != null; });
}
async function frankfurterQuote(pair){
  const rows = await frankfurterSeries(pair[0], pair[1], 12);
  const n = rows.length;
  if(!n) throw new Error("frankfurter: بدون داده");
  return makeQuote(rows[n-1].c, n > 1 ? rows[n-2].c : null, null, null, rows[n-1].t, "frankfurter (بانک مرکزی اروپا)");
}
async function frankfurterChart(pair, days){
  const rows = await frankfurterSeries(pair[0], pair[1], Math.min(days, 1800));
  if(rows.length < 2) throw new Error("frankfurter: داده‌ی کافی نیست");
  return {meta:{}, rows:rows.map(function(r){ return {t:r.t, o:r.c, h:r.c, l:r.c, c:r.c, v:0}; }), lineOnly:true};
}

async function directQuote(m){
  if(m.ga) return goldApiQuote(m.ga);
  if(m.fx) return frankfurterQuote(m.fx);
  if(m.cg) return coingeckoQuote(m.cg);
  throw new Error("منبع مستقیم ندارد");
}

/* =========================================================
   دریافت قیمت: با MY_PROXY اول یاهو (کامل‌ترین)، وگرنه اول منبع مستقیم
========================================================= */
async function getQuote(m){
  const errs = [];
  const hasDirect = !!(m.ga || m.fx || m.cg);

  async function tryYahoo(){
    if(!healthy("yahoo")) throw new Error("Yahoo: موقتاً کنار گذاشته شد");
    try{
      const d = await yahooChart(m.y, "1d", "5m");
      const q = quoteFromYahoo(d);
      markOk("yahoo");
      return q;
    }catch(e){ markFail("yahoo"); throw new Error("Yahoo: " + (e.details ? e.details.join(" | ") : shortErr(e))); }
  }
  async function tryDirect(){
    if(!hasDirect) throw new Error("منبع مستقیم ندارد");
    try{ return await directQuote(m); }
    catch(e){ throw new Error("مستقیم: " + shortErr(e)); }
  }
  async function tryStooq(){
    if(!m.s || !healthy("stooq")) throw new Error("Stooq: در دسترس نیست");
    try{
      const d = await stooqHistory(m.s, 12);
      const n = d.rows.length;
      const last = d.rows[n-1];
      const prev = n > 1 ? d.rows[n-2].c : null;
      const q = makeQuote(last.c, prev, last.h, last.l, last.t, "Stooq (روزانه)");
      markOk("stooq");
      return q;
    }catch(e){ markFail("stooq"); throw new Error("Stooq: " + (e.details ? e.details.join(" | ") : shortErr(e))); }
  }

  const order = MY_PROXY ? [tryYahoo, tryDirect, tryStooq] : [tryDirect, tryYahoo, tryStooq];
  for(const step of order){
    try{ return await step(); }
    catch(e){ errs.push(e.message); }
  }
  const err = new Error("قیمت دریافت نشد");
  err.details = errs;
  throw err;
}
