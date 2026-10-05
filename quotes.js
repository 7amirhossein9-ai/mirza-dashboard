"use strict";
/* =========================================================
   وضعیت قیمت‌ها و نمایش کارت‌ها / جدول / نوار بالا
========================================================= */
const quotes = {};       // آخرین قیمت هر بازار
const quoteState = {};   // loading | ok | stale | error
let quotesUpdatedAt = 0;

try{
  const saved = JSON.parse(localStorage.getItem("mirza_quotes_v2") || "{}");
  Object.keys(saved).forEach(function(id){ quotes[id] = saved[id]; quoteState[id] = "stale"; });
}catch(e){}

function saveQuotes(){
  try{ localStorage.setItem("mirza_quotes_v2", JSON.stringify(quotes)); }catch(e){}
}

const faHMS = new Intl.DateTimeFormat("fa-IR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:"Asia/Tehran"});
const faHM  = new Intl.DateTimeFormat("fa-IR",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Tehran"});

function changeHtml(q, dec){
  if(!q || q.change == null) return '<span class="flat">—</span>';
  const cls = dirOf(q.change);
  return '<span class="ltr ' + cls + '">' + arrowOf(q.change) + " " + fmtSigned(q.change, dec) + " (" + fmtPct(q.pct) + ")</span>";
}

function renderCards(){
  const box = $("cards");
  box.innerHTML = FEATURED.map(function(id){
    const m = MARKETS.find(function(x){ return x.id === id; });
    const q = quotes[id];
    const st = quoteState[id];
    const price = q ? fmt(q.price, m.dec) : (st === "error" ? "ناموفق" : "···");
    const range = q && q.lo != null && q.hi != null
      ? 'امروز: <span class="ltr">' + fmt(q.lo, m.dec) + " – " + fmt(q.hi, m.dec) + "</span>"
      : "&nbsp;";
    const meta = q
      ? "منبع: " + q.source + " · " + faHM.format(new Date(q.t)) + (st === "stale" ? " (قدیمی)" : "")
      : (st === "error" ? "دریافت قیمت ممکن نشد" : "در حال دریافت...");
    return '<div class="market-card" role="button" tabindex="0" data-chart="' + m.id + '">' +
      '<div class="mc-head"><span class="mc-name">' + m.icon + " " + m.name + '</span><span class="mc-unit">' + m.unit + "</span></div>" +
      '<div class="mc-price ltr' + (q ? "" : " skeleton") + '">' + price + "</div>" +
      '<div class="mc-change">' + changeHtml(q, m.dec) + "</div>" +
      '<div class="mc-range">' + range + "</div>" +
      '<div class="mc-meta">' + meta + "</div></div>";
  }).join("");
}

function renderTable(){
  $("marketsBody").innerHTML = MARKETS.map(function(m){
    const q = quotes[m.id];
    const st = quoteState[m.id];
    const cls = q ? dirOf(q.change) : "flat";
    const stale = st === "stale" ? " (قدیمی)" : "";
    return '<tr class="row-click" data-chart="' + m.id + '">' +
      "<td>" + m.icon + " " + m.name + "</td>" +
      '<td class="gold"><span class="ltr">' + m.sym + "</span></td>" +
      "<td>" + m.type + "</td>" +
      '<td><span class="ltr gold">' + (q ? fmt(q.price, m.dec) : (st === "error" ? "ناموفق" : "···")) + "</span></td>" +
      '<td><span class="ltr ' + cls + '">' + (q ? fmtSigned(q.change, m.dec) : "—") + "</span></td>" +
      '<td><span class="ltr ' + cls + '">' + (q ? fmtPct(q.pct) : "—") + "</span></td>" +
      '<td><span class="ltr">' + (q && q.lo != null ? fmt(q.lo, m.dec) : "—") + "</span></td>" +
      '<td><span class="ltr">' + (q && q.hi != null ? fmt(q.hi, m.dec) : "—") + "</span></td>" +
      "<td>" + (q ? faHM.format(new Date(q.t)) + stale : "—") + "</td>" +
      '<td><button class="table-btn" type="button">نمودار</button></td></tr>';
  }).join("");
}

function renderTicker(){
  const track = $("tickerTrack");
  const items = MARKETS.filter(function(m){ return quotes[m.id]; });
  if(!items.length){
    track.className = "ticker-track";
    track.innerHTML = '<span class="ticker-msg">در حال دریافت قیمت‌ها...</span>';
    return;
  }
  const one = items.map(function(m){
    const q = quotes[m.id];
    const cls = dirOf(q.change);
    return '<span class="tk"><b>' + m.name + '</b><span>' + fmt(q.price, m.dec) + '</span> ' +
      '<span class="' + cls + '">' + arrowOf(q.change) + " " + fmtPct(q.pct) + "</span></span>";
  }).join("");
  track.innerHTML = one + one;
  track.className = "ticker-track run";
  track.style.animationDuration = Math.max(30, items.length * 6) + "s";
}

function renderQuotes(){
  renderCards();
  renderTable();
  renderTicker();
  renderPulse();
  renderIran();
}

function updateQuotesStatus(){
  const ids = MARKETS.map(function(m){ return m.id; });
  const ok = ids.filter(function(id){ return quoteState[id] === "ok"; }).length;
  const loading = ids.filter(function(id){ return quoteState[id] === "loading"; }).length;
  let txt;
  if(loading) txt = "در حال دریافت قیمت‌ها... (" + ok + " از " + ids.length + ")";
  else if(ok === 0) txt = "دریافت قیمت‌ها ناموفق بود؛ چند لحظه بعد دوباره امتحان کنید.";
  else txt = ok + " از " + ids.length + " بازار به‌روز شد · آخرین به‌روزرسانی " + faHMS.format(new Date(quotesUpdatedAt));
  $("quotesStatus").textContent = txt;
}

let quotesBusy = false;
async function refreshQuotes(){
  if(quotesBusy) return;
  quotesBusy = true;
  MARKETS.forEach(function(m){ if(quoteState[m.id] !== "ok") quoteState[m.id] = quotes[m.id] ? "stale" : "loading"; });
  updateQuotesStatus();
  renderQuotes();

  const queue = MARKETS.slice();
  async function worker(){
    while(queue.length){
      const m = queue.shift();
      try{
        const q = await getQuote(m);
        quotes[m.id] = q;
        quoteState[m.id] = "ok";
      }catch(e){
        console.warn("Quote failed:", m.id, e.details || e.message);
        quoteState[m.id] = quotes[m.id] ? "stale" : "error";
      }
      quotesUpdatedAt = Date.now();
      renderQuotes();
      updateQuotesStatus();
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  saveQuotes();
  quotesBusy = false;
  MARKETS.forEach(function(m){ if(quoteState[m.id] === "ok") quoteState[m.id] = "ok"; });
  updateQuotesStatus();
      }
