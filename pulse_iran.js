"use strict";
/* =========================================================
   نبض بازار
========================================================= */
function renderPulse(){
  const have = MARKETS.filter(function(m){ return quotes[m.id]; }).length;
  if(have < 3){
    $("pulseSummary").textContent = "برای محاسبه‌ی نبض بازار، منتظر دریافت قیمت‌ها باشید...";
    $("pulseGrid").innerHTML = "";
    return;
  }
  const p = computePulse(quotes, MARKETS);
  const L = function(v){ return '<span class="ltr">' + v + "</span>"; };
  $("pulseLabel").textContent = p.label;
  let s = "گرایش کلی بازار امروز: <b class=\"" + p.cls + "\">" + p.label + "</b>.";
  if(p.movers){
    s += " بیشترین رشد: " + p.movers.top.name + " (" + L(fmtPct(p.movers.top.pct)) + ") و بیشترین افت: " + p.movers.bottom.name + " (" + L(fmtPct(p.movers.bottom.pct)) + ").";
  }
  $("pulseSummary").innerHTML = s;

  const factors = p.factors.map(function(f){
    return "<li>" + f.name + ": " + L('<span class="' + dirOf(f.pct) + '">' + fmtPct(f.pct) + "</span>") +
      " ← " + (f.effect > 0 ? "به نفع ریسک‌پذیری" : f.effect < 0 ? "به نفع ریسک‌گریزی" : "بی‌اثر") + "</li>";
  }).join("");
  let html = techCard("جهت‌گیری ریسک", p.label, 'امتیاز: ' + L((p.score > 0 ? "+" : "") + p.score.toFixed(1)) +
    '<ul class="signal-list">' + factors + "</ul>", p.cls, true);
  if(p.ratios.gs != null) html += techCard("نسبت طلا به نقره", L(p.ratios.gs.toFixed(1)), "هر اونس طلا معادل " + L(p.ratios.gs.toFixed(1)) + " اونس نقره است. هرچه عدد بالاتر باشد، طلا نسبت به نقره گران‌تر است.", "gold");
  if(p.ratios.go != null) html += techCard("نسبت طلا به نفت", L(p.ratios.go.toFixed(1)), "هر اونس طلا معادل " + L(p.ratios.go.toFixed(1)) + " بشکه نفت خام است.", "gold");
  if(p.ratios.bg != null) html += techCard("بیت‌کوین بر حسب طلا", L(p.ratios.bg.toFixed(1)), "قیمت هر بیت‌کوین معادل " + L(p.ratios.bg.toFixed(1)) + " اونس طلاست.", "gold");
  if(p.vix != null){
    const lvl = p.vix < 15 ? "آرام" : p.vix < 20 ? "عادی" : p.vix < 30 ? "نگرانی" : "نگرانی شدید";
    html += techCard("شاخص ترس (VIX)", L(p.vix.toFixed(2)), "وضعیت: " + lvl + ". معمولاً زیر ۲۰ آرام و بالای ۳۰ نشانه‌ی نگرانی شدید است.", p.vix < 20 ? "up" : p.vix < 30 ? "warn" : "down");
  }
  if(p.tnx != null) html += techCard("بازده اوراق ۱۰ ساله آمریکا", L(p.tnx.toFixed(3) + "%"), "نرخ بهره‌ی بلندمدت؛ افزایش آن معمولاً به ضرر طلا و سهام رشدی است.", "gold");
  $("pulseGrid").innerHTML = html;
}

/* =========================================================
   بازار ایران: طلا، سکه، نقره، ارز
========================================================= */
const IRAN_ROWS = [
  {id:"usd",    icon:"💵", title:"دلار آمریکا",       sub:"هر دلار",  key:"price_dollar_rl", kind:"fx"},
  {id:"eur",    icon:"💶", title:"یورو",              sub:"هر یورو",  key:"price_eur",       kind:"fx"},
  {id:"aed",    icon:"🇦🇪", title:"درهم امارات",       sub:"هر درهم",  key:"price_aed",       kind:"fx"},
  {id:"g18",    icon:"🟡", title:"طلای ۱۸ عیار",      sub:"هر گرم",   key:"geram18",         kind:"gold", pure:0.75},
  {id:"g24",    icon:"🥇", title:"طلای ۲۴ عیار",      sub:"هر گرم",   key:"geram24",         kind:"gold", pure:1},
  {id:"mesghal",icon:"🟡", title:"مثقال طلا",         sub:"هر مثقال", key:"mesghal",         kind:"gold", pure:4.6083 * 0.75},
  {id:"sekee",  icon:"🪙", title:"سکه امامی",         sub:"تمام‌سکه", key:"sekee",           kind:"coin", pure:8.133 * 0.9},
  {id:"sekeb",  icon:"🪙", title:"سکه بهار آزادی",    sub:"تمام‌سکه", key:"sekeb",           kind:"coin", pure:8.133 * 0.9},
  {id:"nim",    icon:"🪙", title:"نیم‌سکه",           sub:"هر عدد",   key:"nim",             kind:"coin", pure:4.0665 * 0.9},
  {id:"rob",    icon:"🪙", title:"ربع‌سکه",           sub:"هر عدد",   key:"rob",             kind:"coin", pure:2.03325 * 0.9},
  {id:"gerami", icon:"🪙", title:"سکه گرمی",          sub:"هر عدد",   key:"gerami",          kind:"coin", pure:0.9},
  {id:"s999",   icon:"⚪", title:"نقره ۹۹۹",          sub:"هر گرم",   kind:"silver", purity:0.999},
  {id:"s925",   icon:"⚪", title:"نقره عیار ۹۲۵",     sub:"هر گرم",   kind:"silver", purity:0.925}
];

const iran = {cur:null, via:"", t:0, stale:false, failed:false};
let manualUsd = null;
try{ manualUsd = parseFloat(localStorage.getItem("mirza_manual_usd")) || null; }catch(e){}
try{
  const sv = JSON.parse(localStorage.getItem("mirza_tgju_v1") || "null");
  if(sv && sv.cur){ iran.cur = sv.cur; iran.t = sv.t; iran.stale = true; iran.via = "ذخیره‌شده"; }
}catch(e){}

function fmtInt(n){ return n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"); }

async function fetchTgju(){
  const errs = [];
  for(const h of ["call1", "call5"]){
    const url = "https://" + h + ".tgju.org/ajax.json";
    try{
      const res = await timeoutFetch(url, 6000);
      if(res.ok) return {cur:parseTgju(await res.text()), via:"مستقیم"};
    }catch(e){}
    try{
      const r = await fetchSequential(url, parseTgju, {max:3, ms:8000});
      return {cur:r.value, via:r.via};
    }catch(e){
      (e.details || [e.message]).forEach(function(d){ errs.push(h + " → " + d); });
    }
  }
  const err = new Error("منبع بازار ایران پاسخ نداد");
  err.details = errs;
  throw err;
}

async function refreshIran(){
  $("iranStatus").textContent = "در حال دریافت...";
  try{
    const r = await fetchTgju();
    iran.cur = r.cur; iran.via = r.via; iran.t = Date.now(); iran.stale = false; iran.failed = false;
    try{ localStorage.setItem("mirza_tgju_v1", JSON.stringify({cur:r.cur, t:iran.t})); }catch(e){}
  }catch(e){
    console.warn("tgju failed:", e.details || e.message);
    iran.failed = true;
    if(iran.cur) iran.stale = true;
  }
  renderIran();
}

function renderIran(){
  const oz = quotes.gold ? quotes.gold.price : null;
  const silver = quotes.silver ? quotes.silver.price : null;
  const R = buildIranRows(IRAN_ROWS, iran.cur, manualUsd, oz, silver);
  const L = function(v, c){ return '<span class="ltr' + (c ? " " + c : "") + '">' + v + "</span>"; };

  let st;
  if(iran.cur && !iran.stale) st = "منبع: tgju.org · به‌روزرسانی " + faHMS.format(new Date(iran.t));
  else if(iran.cur) st = "منبع در دسترس نیست؛ آخرین داده‌ی ذخیره‌شده (" + faHM.format(new Date(iran.t)) + ")";
  else if(manualUsd) st = "قیمت بازار ایران دریافت نشد؛ ارزش‌ها با نرخ دستی محاسبه شد";
  else st = "قیمت بازار ایران دریافت نشد؛ نرخ دلار را دستی وارد کنید";
  $("iranStatus").textContent = st;

  const srcName = {tgju:"tgju.org", calc:"محاسبه‌شده", manual:"ورودی دستی"};
  $("iranBody").innerHTML = R.rows.map(function(r){
    const d = r.def;
    const cls = r.change != null ? dirOf(r.change) : (r.pct != null ? dirOf(r.pct) : "flat");
    const hl = r.lo != null && r.hi != null ? L(fmtInt(r.lo) + " – " + fmtInt(r.hi)) : "—";
    return "<tr><td>" + d.icon + " " + d.title + "</td><td>" + d.sub + "</td>" +
      '<td>' + L(fmtInt(r.market), "gold") + "</td>" +
      "<td>" + (r.change != null ? L(fmtSigned(Math.round(r.change), 0), cls) : "—") + "</td>" +
      "<td>" + (r.pct != null ? L(fmtPct(r.pct), cls) : "—") + "</td>" +
      "<td>" + hl + "</td>" +
      "<td>" + (r.theo != null && d.kind !== "silver" ? L(fmtInt(r.theo)) : "—") + "</td>" +
      "<td>" + (r.gap != null ? L(fmtPct(r.gap), r.gap > 0 ? "warn" : "up") : "—") + "</td>" +
      "<td>" + (r.src ? srcName[r.src] : "—") + "</td></tr>";
  }).join("");

  const pick = function(id){ return R.byId[id]; };
  const kp = function(id, note){
    const r = pick(id);
    const price = r.market != null ? r.market : r.theo;
    const cls = r.pct != null ? dirOf(r.pct) : "gold";
    return techCard(r.def.icon + " " + r.def.title + " (" + r.def.sub + ")",
      price != null ? L(fmtInt(price)) + ' <small style="font-size:12px;color:#8a93a0">تومان</small>' : "—",
      (r.pct != null ? "تغییر روز: " + L(fmtPct(r.pct), cls) + "<br>" : "") + (note || ""), cls === "flat" ? "gold" : cls);
  };
  $("iranKpis").innerHTML =
    kp("usd", R.byId.usd.src === "manual" ? "نرخ واردشده توسط شما" : "بازار آزاد") +
    kp("g18", R.byId.g18.gap != null ? "اختلاف با ارزش جهانی: " + L(fmtPct(R.byId.g18.gap), "warn") : "") +
    kp("g24", R.byId.g24.src === "calc" ? "محاسبه‌شده از قیمت ۱۸ عیار" : "") +
    kp("sekee", R.byId.sekee.gap != null ? "اختلاف با ارزش فلز: " + L(fmtPct(R.byId.sekee.gap), "warn") : "") +
    kp("s999", "بر پایه قیمت جهانی نقره و نرخ دلار");

  const ins = [];
  const sk = R.byId.sekee, g18 = R.byId.g18;
  if(sk.market != null && sk.theo != null){
    ins.push("قیمت سکه امامی " + L(fmtInt(sk.market)) + " تومان است؛ ارزش فلز طلای آن با قیمت جهانی و نرخ دلار حدود " + L(fmtInt(sk.theo)) + " تومان می‌شود. یعنی بازار حدود " + L(Math.abs(sk.gap).toFixed(1) + "%") + (sk.gap >= 0 ? " بالاتر" : " پایین‌تر") + " از ارزش ذاتی معامله می‌شود (این اختلاف شامل حباب، اجرت و ریسک است).");
  }
  if(g18.market != null && g18.theo != null){
    ins.push("طلای ۱۸ عیار " + L(Math.abs(g18.gap).toFixed(1) + "%") + (g18.gap >= 0 ? " بالاتر" : " پایین‌تر") + " از ارزش بر پایه قیمت جهانی است.");
  }
  if(g18.market != null && R.oz && R.usd){
    const implied = g18.market / (R.oz / OZ_GRAM * 0.75);
    ins.push("اگر قیمت ۱۸ عیار فقط بازتاب قیمت جهانی بود، نرخ دلارِ ضمنی " + L(fmtInt(implied)) + " تومان می‌شد؛ نرخ دلار بازار " + L(fmtInt(R.usd)) + " تومان است (اختلاف " + L(fmtPct((implied / R.usd - 1) * 100)) + ").");
  }
  if(sk.market != null && R.usd){
    ins.push("قیمت یک سکه امامی معادل " + L(Math.round(sk.market / R.usd).toLocaleString("en-US")) + " دلار است.");
  }
  if(R.oz && R.byId.g24.market != null && R.usd){
    ins.push("قیمت جهانی هر گرم طلای ۲۴ عیار حدود " + L((R.oz / OZ_GRAM).toFixed(2)) + " دلار است.");
  }
  if(!ins.length) ins.push("برای تحلیل، قیمت بازار ایران یا نرخ دلار دستی لازم است.");
  $("iranInsights").innerHTML = "<h3>تحلیل بازار طلا و سکه</h3><ul>" + ins.map(function(x){ return "<li>" + x + "</li>"; }).join("") + "</ul>";
   }
