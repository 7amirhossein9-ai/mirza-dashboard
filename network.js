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
  {name:"allorigins",     build:function(u){ return "https://api.allorigins.win/raw?url=" + enc(u); }},
  {name:"allorigins-get", build:function(u){ return "https://api.allorigins.win/get?url=" + enc(u); }, wrapped:true},
  {name:"corsproxy",      build:function(u){ return "https://corsproxy.io/?url=" + enc(u); }},
  {name:"codetabs",       build:function(u){ return "https://api.codetabs.com/v1/proxy?quest=" + enc(u); }},
  {name:"thingproxy",     build:function(u){ return "https://thingproxy.freeboard.io/fetch/" + u; }}
);
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

async function getQuote(m){
  const errs = [];
  if(healthy("yahoo")){
    try{
      const d = await yahooChart(m.y, "1d", "5m");
      const q = quoteFromYahoo(d);
      markOk("yahoo");
      return q;
    }catch(e){ markFail("yahoo"); errs.push("Yahoo: " + (e.details ? e.details.join(" | ") : shortErr(e))); }
  }
  if(m.s && healthy("stooq")){
    try{
      const d = await stooqHistory(m.s, 12);
      const n = d.rows.length;
      const last = d.rows[n-1];
      const prev = n > 1 ? d.rows[n-2].c : null;
      const q = makeQuote(last.c, prev, last.h, last.l, last.t, "Stooq (روزانه)");
      markOk("stooq");
      return q;
    }catch(e){ markFail("stooq"); errs.push("Stooq: " + (e.details ? e.details.join(" | ") : shortErr(e))); }
  }
  if(m.cg){
    try{ return await coingeckoQuote(m.cg); }
    catch(e){ errs.push(shortErr(e)); }
  }
  const err = new Error("قیمت دریافت نشد");
  err.details = errs;
  throw err;
      }
