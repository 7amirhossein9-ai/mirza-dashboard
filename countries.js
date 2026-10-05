"use strict";
/* =========================================================
   تحلیل کشورها (بانک جهانی)
========================================================= */
const COUNTRIES = {
  IRN:"ایران", USA:"آمریکا", CHN:"چین", RUS:"روسیه", IND:"هند", JPN:"ژاپن", DEU:"آلمان", GBR:"بریتانیا", FRA:"فرانسه",
  ITA:"ایتالیا", CAN:"کانادا", BRA:"برزیل", KOR:"کره جنوبی", AUS:"استرالیا", ESP:"اسپانیا", MEX:"مکزیک", IDN:"اندونزی",
  TUR:"ترکیه", SAU:"عربستان", ARE:"امارات", QAT:"قطر", KWT:"کویت", OMN:"عمان", BHR:"بحرین", IRQ:"عراق", ISR:"اسرائیل",
  EGY:"مصر", PAK:"پاکستان", AFG:"افغانستان", AZE:"آذربایجان", ARM:"ارمنستان", GEO:"گرجستان", KAZ:"قزاقستان",
  UZB:"ازبکستان", TKM:"ترکمنستان", NLD:"هلند", CHE:"سوئیس", SWE:"سوئد", POL:"لهستان", NOR:"نروژ", SGP:"سنگاپور",
  THA:"تایلند", VNM:"ویتنام", NGA:"نیجریه", ZAF:"آفریقای جنوبی", ARG:"آرژانتین"
};
const WB_INDICATORS = [
  {id:"gdp",    code:"NY.GDP.MKTP.CD",       name:"تولید ناخالص داخلی (GDP) به دلار جاری",        kind:"usdbig", abs:true,  level:true},
  {id:"gdppc",  code:"NY.GDP.PCAP.CD",       name:"GDP سرانه (دلار)",                              kind:"usd",    abs:false, level:true},
  {id:"ppp",    code:"NY.GDP.MKTP.PP.CD",    name:"GDP بر پایه برابری قدرت خرید",                  kind:"usdbig", abs:true,  level:true},
  {id:"growth", code:"NY.GDP.MKTP.KD.ZG",    name:"رشد اقتصادی (درصد سالانه)",                     kind:"pct",    abs:false, level:false},
  {id:"infl",   code:"FP.CPI.TOTL.ZG",       name:"تورم مصرف‌کننده (درصد سالانه)",                  kind:"pct",    abs:false, level:false},
  {id:"unemp",  code:"SL.UEM.TOTL.ZS",       name:"نرخ بیکاری (درصد)",                              kind:"pct",    abs:false, level:false},
  {id:"pop",    code:"SP.POP.TOTL",          name:"جمعیت",                                          kind:"count",  abs:true,  level:true},
  {id:"debt",   code:"GC.DOD.TOTL.GD.ZS",    name:"بدهی دولت مرکزی (درصد GDP)",                    kind:"pct",    abs:false, level:false},
  {id:"trade",  code:"NE.TRD.GNFS.ZS",       name:"حجم تجارت خارجی (درصد GDP)",                    kind:"pct",    abs:false, level:false},
  {id:"mil",    code:"MS.MIL.XPND.GD.ZS",    name:"هزینه‌ی نظامی (درصد GDP)",                      kind:"pct",    abs:false, level:false},
  {id:"fdi",    code:"BX.KLT.DINV.WD.GD.ZS", name:"سرمایه‌گذاری مستقیم خارجی (درصد GDP)",          kind:"pct",    abs:false, level:false},
  {id:"gini",   code:"SI.POV.GINI",          name:"ضریب جینی (نابرابری درآمد)",                    kind:"idx",    abs:false, level:false}
];
const PALETTE = ["#e7c461","#4aa3ff","#3ac879","#ef5350","#c77dff","#ff9f43","#26c6da","#f06292","#9ccc65","#8d9bb5"];

const GOOD_UP = {gdp:true, gdppc:true, ppp:true, growth:true, trade:true, fdi:true, infl:false, unemp:false, debt:false, gini:false};
const cs = {codes:["IRN","TUR","SAU","ARE","AZE","USA","CHN","DEU"], ind:"gdp", from:2010, base:"IRN", index:false, h:5,
            reqId:0, rows:[], series:{}, years:[], axis:[], fc:null, fcErr:"", hover:null};
try{
  const sv = JSON.parse(localStorage.getItem("mirza_countries_v1") || "null");
  if(sv){
    if(Array.isArray(sv.codes) && sv.codes.length) cs.codes = sv.codes.filter(function(c){ return COUNTRIES[c]; }).slice(0, 10);
    if(WB_INDICATORS.some(function(i){ return i.id === sv.ind; })) cs.ind = sv.ind;
    if(sv.from) cs.from = sv.from;
    if(sv.base) cs.base = sv.base;
    if(sv.h != null && [0, 3, 5, 10].indexOf(sv.h) !== -1) cs.h = sv.h;
  }
}catch(e){}
function saveCountries(){
  try{ localStorage.setItem("mirza_countries_v1", JSON.stringify({codes:cs.codes, ind:cs.ind, from:cs.from, base:cs.base, h:cs.h})); }catch(e){}
}

const wbCache = {};
async function wbGet(url){
  try{
    const r = await timeoutFetch(url, 9000);
    if(r.ok) return parseWB(await r.text());
  }catch(e){}
  const r2 = await fetchSequential(url, parseWB, {max:3, ms:9000});
  return r2.value;
}
async function wbRealCountries(){
  if(wbCache.real) return wbCache.real;
  const j = await wbGet("https://api.worldbank.org/v2/country?format=json&per_page=400");
  const set = new Set();
  j[1].forEach(function(c){ if(c.region && c.region.id !== "NA") set.add(c.id); });
  wbCache.real = set;
  return set;
}
async function wbRank(ind){
  const key = "rank_" + ind.code;
  if(wbCache[key]) return wbCache[key];
  const set = await wbRealCountries();
  const j = await wbGet("https://api.worldbank.org/v2/country/all/indicator/" + ind.code + "?format=json&per_page=400&mrnev=1");
  let world = null;
  const list = [];
  j[1].forEach(function(r){
    const v = num(r.value);
    if(v == null) return;
    if(r.countryiso3code === "WLD") world = v;
    else if(set.has(r.countryiso3code)) list.push({code:r.countryiso3code, value:v});
  });
  list.sort(function(a, b){ return b.value - a.value; });
  wbCache[key] = {list:list, world:world};
  return wbCache[key];
}

/* ---------- بوم‌های نمودار کشورها ---------- */
function makeCanvas(id){ return {c:$(id), ctx:$(id).getContext("2d"), w:0, h:0}; }
function fitCanvas(o){
  const r = o.c.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  o.w = r.width; o.h = r.height;
  o.c.width = Math.round(r.width * dpr); o.c.height = Math.round(r.height * dpr);
  o.c.style.width = r.width + "px"; o.c.style.height = r.height + "px";
  o.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const cBars = makeCanvas("cBars");
const cLines = makeCanvas("cLines");
function colorOf(code){
  if(code === cs.base) return PALETTE[0];
  const others = cs.codes.filter(function(c){ return c !== cs.base; });
  return PALETTE[1 + (others.indexOf(code) % (PALETTE.length - 1))];
}
function curInd(){ return WB_INDICATORS.find(function(i){ return i.id === cs.ind; }); }

function drawMessage(o, text){
  fitCanvas(o);
  o.ctx.clearRect(0, 0, o.w, o.h);
  o.ctx.fillStyle = "#7b8491";
  o.ctx.font = "13px Vazirmatn, Tahoma, sans-serif";
  o.ctx.textAlign = "center";
  o.ctx.fillText(text, o.w / 2, o.h / 2);
}

function drawBars(){
  const ind = curInd();
  const items = cs.rows.filter(function(r){ return r.latest; }).sort(function(a, b){ return b.latest.value - a.latest.value; });
  if(!items.length){ drawMessage(cBars, "داده‌ای برای نمایش نیست"); return; }
  fitCanvas(cBars);
  const ctx = cBars.ctx, W = cBars.w, H = cBars.h;
  ctx.clearRect(0, 0, W, H);
  const padL = 92, padR = 78, padT = 10;
  const rowH = Math.min(36, (H - padT - 8) / items.length);
  const vals = items.map(function(r){ return r.latest.value; });
  const lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
  const span = hi - lo || 1;
  const plotW = W - padL - padR;
  const x0 = padL + (0 - lo) / span * plotW;
  ctx.font = "12px Vazirmatn, Tahoma, sans-serif";
  ctx.textBaseline = "middle";
  items.forEach(function(r, k){
    const y = padT + k * rowH;
    const v = r.latest.value;
    const x = padL + (v - lo) / span * plotW;
    ctx.fillStyle = colorOf(r.code);
    ctx.fillRect(Math.min(x0, x), y + 4, Math.max(2, Math.abs(x - x0)), rowH - 8);
    ctx.fillStyle = r.code === cs.base ? "#e7c461" : "#cfd3da";
    ctx.textAlign = "left";
    ctx.fillText(r.name, 8, y + rowH / 2);
    ctx.fillStyle = "#aeb4bd";
    ctx.textAlign = v >= 0 ? "left" : "right";
    ctx.fillText(fmtWBShort(ind, v), v >= 0 ? x + 6 : x - 6, y + rowH / 2);
  });
  ctx.strokeStyle = "#2a3140";
  ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, padT); ctx.lineTo(Math.round(x0) + 0.5, padT + items.length * rowH); ctx.stroke();
}

function seriesValue(code, y){
  const s = cs.series[code];
  if(!s || s[y] == null) return null;
  if(!cs.index) return s[y];
  const ys = cs.years.filter(function(yy){ return s[yy] != null; });
  if(!ys.length || !(s[ys[0]] > 0)) return null;
  return s[y] / s[ys[0]] * 100;
}

function axisYears(){ return cs.axis && cs.axis.length ? cs.axis : cs.years; }
function baseScale(){
  const s = cs.series[cs.base];
  if(!s) return null;
  const ys = cs.years.filter(function(yy){ return s[yy] != null; });
  return ys.length && s[ys[0]] > 0 ? 100 / s[ys[0]] : null;
}
function fcVal(v){
  if(v == null) return null;
  if(!cs.index) return v;
  const k = baseScale();
  return k == null ? null : v * k;
}

function drawLines(){
  const ind = curInd();
  const years = axisYears();
  if(years.length < 2){ drawMessage(cLines, "داده‌ی کافی برای نمودار روند نیست"); return; }
  fitCanvas(cLines);
  const ctx = cLines.ctx, W = cLines.w, H = cLines.h;
  ctx.clearRect(0, 0, W, H);
  const pad = {t:12, r:14, b:26, l:64};
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const fc = cs.fc;
  let lo = Infinity, hi = -Infinity;
  cs.codes.forEach(function(c){
    years.forEach(function(y){ const v = seriesValue(c, y); if(v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  });
  if(fc) fc.years.forEach(function(y, i){
    [fc.lo[i], fc.hi[i]].forEach(function(v){ const w = fcVal(v); if(w != null){ lo = Math.min(lo, w); hi = Math.max(hi, w); } });
  });
  if(!Number.isFinite(lo)){ drawMessage(cLines, "داده‌ای برای نمایش نیست"); return; }
  if(hi === lo){ hi += 1; lo -= 1; }
  const pv = (hi - lo) * 0.06; lo -= pv; hi += pv;
  const X = function(i){ return pad.l + plotW * i / (years.length - 1); };
  const Y = function(v){ return pad.t + (hi - v) / (hi - lo) * plotH; };
  ctx.font = "11px Vazirmatn, Tahoma, sans-serif";
  const tk = niceTicks(lo, hi, 5);
  ctx.textBaseline = "middle"; ctx.textAlign = "right";
  (tk.ticks || []).forEach(function(v){
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = "#171d27";
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = "#7b8491";
    ctx.fillText(cs.index ? v.toFixed(0) : fmtWBShort(ind, v), pad.l - 6, y);
  });
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const every = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(plotW / 55))));
  years.forEach(function(y, i){
    if(i % every !== 0 && i !== years.length - 1) return;
    ctx.fillStyle = fc && y > fc.lastYear ? "#b59a4f" : "#7b8491";
    ctx.fillText(String(y), X(i), H - 8);
  });

  /* ناحیه‌ی پیش‌بینی */
  if(fc){
    const i0 = years.indexOf(fc.lastYear);
    const lastActual = fcVal(fc.lastValue);
    if(i0 >= 0 && lastActual != null){
      const col = colorOf(cs.base);
      ctx.fillStyle = "rgba(231,196,97,.12)";
      ctx.beginPath(); ctx.moveTo(X(i0), Y(lastActual));
      fc.years.forEach(function(y, k){ ctx.lineTo(X(years.indexOf(y)), Y(fcVal(fc.hi[k]))); });
      for(let k = fc.years.length - 1; k >= 0; k--) ctx.lineTo(X(years.indexOf(fc.years[k])), Y(fcVal(fc.lo[k])));
      ctx.closePath(); ctx.fill();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = col; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(X(i0), Y(lastActual));
      fc.years.forEach(function(y, k){ ctx.lineTo(X(years.indexOf(y)), Y(fcVal(fc.mid[k]))); });
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = "#3a3320"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(X(i0)) + 0.5, pad.t); ctx.lineTo(Math.round(X(i0)) + 0.5, pad.t + plotH); ctx.stroke();
    }
  }

  cs.codes.forEach(function(c){
    ctx.beginPath();
    let started = false;
    years.forEach(function(y, i){
      const v = seriesValue(c, y);
      if(v == null){ started = false; return; }
      if(!started){ ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
    });
    ctx.strokeStyle = colorOf(c);
    ctx.lineWidth = c === cs.base ? 2.6 : 1.7;
    ctx.stroke();
  });
  if(cs.hover != null && cs.hover < years.length){
    const i = cs.hover;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "#5c6675"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(X(i)) + 0.5, pad.t); ctx.lineTo(Math.round(X(i)) + 0.5, pad.t + plotH); ctx.stroke();
    ctx.setLineDash([]);
    cs.codes.forEach(function(c){
      const v = seriesValue(c, years[i]);
      if(v == null) return;
      ctx.fillStyle = colorOf(c);
      ctx.beginPath(); ctx.arc(X(i), Y(v), 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }
}

function updateCLegend(){
  const ind = curInd();
  const years = axisYears();
  const i = cs.hover != null ? cs.hover : (cs.fc ? years.indexOf(cs.fc.lastYear) : years.length - 1);
  const y = years[i];
  if(y == null){ $("cLegend").innerHTML = ""; return; }
  const L = function(v){ return '<span class="ltr">' + v + "</span>"; };
  let html = '<span class="lg-date">سال ' + L(y) + "</span>" +
    cs.codes.map(function(c){
      const v = seriesValue(c, y);
      return '<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + colorOf(c) + ';margin-left:4px"></i>' +
        COUNTRIES[c] + ": <b>" + (v == null ? "—" : (cs.index ? L(v.toFixed(1)) : fmtWB(ind, v))) + "</b></span>";
    }).join("");
  if(cs.fc){
    const k = cs.fc.years.indexOf(y);
    if(k >= 0) html += '<span style="color:#b59a4f">پیش‌بینی ' + COUNTRIES[cs.base] + ": <b>" + (cs.index ? L(fcVal(cs.fc.mid[k]).toFixed(1)) : fmtWB(ind, cs.fc.mid[k])) +
      "</b> (بازه‌ی حدود ۸۰٪: " + (cs.index ? L(fcVal(cs.fc.lo[k]).toFixed(1) + " تا " + fcVal(cs.fc.hi[k]).toFixed(1)) : fmtWB(ind, cs.fc.lo[k]) + " تا " + fmtWB(ind, cs.fc.hi[k])) + ")</span>";
  }
  $("cLegend").innerHTML = html;
}

cLines.c.addEventListener("mousemove", function(e){
  const n = axisYears().length;
  if(n < 2) return;
  const r = cLines.c.getBoundingClientRect();
  const plotW = r.width - 64 - 14;
  const i = Math.round((e.clientX - r.left - 64) / plotW * (n - 1));
  cs.hover = Math.max(0, Math.min(n - 1, i));
  drawLines(); updateCLegend();
});
cLines.c.addEventListener("mouseleave", function(){ cs.hover = null; drawLines(); updateCLegend(); });

function forecastInsights(ind, rows){
  const L = function(v){ return '<span class="ltr">' + v + "</span>"; };
  const out = [];
  const base = rows.find(function(r){ return r.code === cs.base; });
  if(!base) return out;
  if(cs.fcErr){ out.push("پیش‌بینی " + base.name + ": " + cs.fcErr); return out; }
  const fc = cs.fc;
  if(!fc) return out;
  const n = fc.years.length - 1;
  const goodUp = GOOD_UP[ind.id];
  const pess = goodUp === false ? fc.hi[n] : fc.lo[n];
  const opt = goodUp === false ? fc.lo[n] : fc.hi[n];
  out.push("<b>پیش‌بینی " + base.name + " تا سال " + L(fc.years[n]) + ":</b> مقدار میانی " + fmtWB(ind, fc.mid[n]) +
    " (آخرین داده‌ی " + L(fc.lastYear) + ": " + fmtWB(ind, fc.lastValue) + "). مدل برگزیده: " + fc.model + " با خطای آزمون پس‌نگر حدود " + L(fc.mape.toFixed(1) + "%") + ".");
  out.push("سناریوی " + (goodUp == null ? "کران پایین" : "بدبینانه") + ": " + fmtWB(ind, pess) + " و سناریوی " + (goodUp == null ? "کران بالا" : "خوش‌بینانه") + ": " + fmtWB(ind, opt) +
    " (بازه‌ی حدود ۸۰٪). این بازه فقط الگوی گذشته را ادامه می‌دهد و شوک‌هایی مثل جنگ، تحریم یا تغییر سیاست را پیش‌بینی نمی‌کند.");
  return out;
}

function downloadCountriesCsv(){
  const years = axisYears();
  if(!years.length) return;
  const head = ["year"].concat(cs.codes);
  if(cs.fc) head.push(cs.base + "_forecast", cs.base + "_low", cs.base + "_high");
  const rows = [head.join(",")];
  years.forEach(function(y){
    const line = [y];
    cs.codes.forEach(function(c){ const v = cs.series[c] && cs.series[c][y]; line.push(v == null ? "" : v); });
    if(cs.fc){
      const k = cs.fc.years.indexOf(y);
      line.push(k >= 0 ? cs.fc.mid[k] : "", k >= 0 ? cs.fc.lo[k] : "", k >= 0 ? cs.fc.hi[k] : "");
    }
    rows.push(line.join(","));
  });
  const blob = new Blob(["\ufeff" + rows.join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mirza_countries_" + cs.ind + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
}

function renderCountryTable(){
  const ind = curInd();
  const baseRow = cs.rows.find(function(r){ return r.code === cs.base && r.latest; });
  const L = function(v){ return '<span class="ltr">' + v + "</span>"; };
  $("cHead").innerHTML = "<tr><th>کشور</th><th>سال آخرین داده</th><th>مقدار</th><th>رتبه‌ی جهانی</th>" +
    (ind.abs ? "<th>سهم از جهان</th>" : "") +
    "<th>" + (ind.level ? "رشد سالانه‌ی ترکیبی" : "تغییر در بازه") + "</th><th>میانگین ۵ سال اخیر</th><th>نوسان</th><th>" +
    (ind.level ? "نسبت به کشور مبنا" : "اختلاف با کشور مبنا") + "</th></tr>";
  $("cBody").innerHTML = cs.rows.map(function(r){
    if(!r.latest) return '<tr><td>' + r.name + '</td><td colspan="' + (ind.abs ? 8 : 7) + '" class="flat">داده‌ای در این بازه نیست</td></tr>';
    let rel = "—";
    if(baseRow && r.code !== cs.base){
      rel = ind.level && baseRow.latest.value > 0
        ? L((r.latest.value / baseRow.latest.value).toFixed(2) + "×")
        : L(((r.latest.value - baseRow.latest.value) > 0 ? "+" : "") + (r.latest.value - baseRow.latest.value).toFixed(2));
    }else if(r.code === cs.base) rel = "مبنا";
    return "<tr style=\"cursor:default\"><td><i style=\"display:inline-block;width:10px;height:10px;border-radius:2px;background:" + colorOf(r.code) + ";margin-left:6px\"></i>" +
      (r.code === cs.base ? "<b class=\"gold\">" + r.name + "</b>" : r.name) + "</td>" +
      "<td>" + L(r.latest.year) + "</td>" +
      "<td>" + fmtWB(ind, r.latest.value) + "</td>" +
      "<td>" + (r.rank ? L(r.rank + " از " + r.total) : "—") + "</td>" +
      (ind.abs ? "<td>" + (r.share != null ? L(r.share.toFixed(2) + "%") : "—") + "</td>" : "") +
      "<td>" + (r.chg != null ? L((ind.level ? "" : (r.chg > 0 ? "+" : "")) + r.chg.toFixed(2) + (ind.level ? "%" : "")) : "—") + "</td>" +
      "<td>" + (r.avg5 != null ? fmtWB(ind, r.avg5) : "—") + "</td>" +
      "<td>" + (r.vol != null ? L(r.vol.toFixed(2)) : "—") + "</td>" +
      "<td>" + rel + "</td></tr>";
  }).join("");
}

async function loadCountries(){
  const id = ++cs.reqId;
  const ind = curInd();
  $("cStatus").textContent = "در حال دریافت از بانک جهانی...";
  $("cBarsTitle").textContent = "مقایسه‌ی آخرین مقدار: " + ind.name;
  $("cLinesTitle").textContent = "روند " + (cs.index ? "(شاخص، سال پایه = ۱۰۰): " : ": ") + ind.name;
  if(!cs.codes.length){ drawMessage(cBars, "حداقل یک کشور انتخاب کنید"); drawMessage(cLines, ""); return; }
  const nowY = new Date().getFullYear();
  const url = "https://api.worldbank.org/v2/country/" + cs.codes.join(";") + "/indicator/" + ind.code +
    "?format=json&per_page=2000&date=" + cs.from + ":" + nowY;
  let series = null, rank = null;
  try{
    const jobs = await Promise.all([
      wbGet(url),
      wbRank(ind).catch(function(e){ console.warn("rank failed", e.message); return null; })
    ]);
    if(id !==
