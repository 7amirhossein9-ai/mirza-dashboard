"use strict";
/* =========================================================
   نمودار (بدون هیچ کتابخانه‌ی بیرونی)
========================================================= */
const chart = {
  marketId:"gold", symbol:"GC=F", name:"طلای جهانی", unit:"دلار / اونس", dec:2,
  period:"1Y", mode:"candle", sma20:true, sma50:false, volume:true,
  rows:[], lineOnly:false, intradayData:false, source:"", note:"", meta:{},
  hover:null, hoverY:null, layout:null, reqId:0, loadedAt:0
};

const canvas = $("chartCanvas");
const ctx = canvas.getContext("2d");
let CW = 0, CH = 0;

const fDay    = new Intl.DateTimeFormat("fa-IR",{month:"short",day:"numeric",timeZone:"Asia/Tehran"});
const fDayY   = new Intl.DateTimeFormat("fa-IR",{year:"numeric",month:"short",day:"numeric",timeZone:"Asia/Tehran"});
const fMonthY = new Intl.DateTimeFormat("fa-IR",{year:"numeric",month:"short",timeZone:"Asia/Tehran"});
const fFull   = new Intl.DateTimeFormat("fa-IR",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Tehran"});

function axisLabel(t){
  const d = new Date(t);
  if(chart.intradayData){
    return chart.period === "1D" ? faHM.format(d) : fDay.format(d) + " " + faHM.format(d);
  }
  return chart.period === "5Y" ? fMonthY.format(d) : fDay.format(d);
}
function fullLabel(t){
  const d = new Date(t);
  return chart.intradayData ? fFull.format(d) : fDayY.format(d);
}

function niceTicks(lo, hi, count){
  const range = hi - lo;
  if(!(range > 0)) return [lo];
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for(let v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(v);
  return {ticks:ticks, step:step};
}

function resizeCanvas(){
  const box = $("chartBox");
  const r = box.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  CW = r.width; CH = r.height;
  canvas.width = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + "px";
  canvas.style.height = CH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}

function drawChart(){
  ctx.clearRect(0, 0, CW, CH);
  const rows = chart.rows;
  chart.layout = null;
  if(!rows.length) return;

  const font = "11px Vazirmatn, Tahoma, Arial, sans-serif";
  const pad = {t:10, r:74, b:26, l:8};
  const showVol = chart.volume && rows.some(function(r){ return r.v > 0; });
  const volH = showVol ? Math.round((CH - pad.t - pad.b) * 0.17) : 0;
  const plotW = CW - pad.l - pad.r;
  const plotH = CH - pad.t - pad.b - volH - (showVol ? 8 : 0);
  const n = rows.length;
  const step = plotW / n;
  const closes = rows.map(function(r){ return r.c; });
  const s20 = chart.sma20 ? sma(closes, 20) : null;
  const s50 = chart.sma50 ? sma(closes, 50) : null;
  const candle = chart.mode === "candle" && !chart.lineOnly;

  let lo = Infinity, hi = -Infinity;
  rows.forEach(function(r){
    lo = Math.min(lo, candle ? r.l : r.c);
    hi = Math.max(hi, candle ? r.h : r.c);
  });
  [s20, s50].forEach(function(a){
    if(!a) return;
    a.forEach(function(v){ if(v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  });
  if(hi === lo){ hi += 1; lo -= 1; }
  const padv = (hi - lo) * 0.07;
  lo -= padv; hi += padv;

  const X = function(i){ return pad.l + step * (i + 0.5); };
  const Y = function(p){ return pad.t + (hi - p) / (hi - lo) * plotH; };

  chart.layout = {pad:pad, step:step, plotW:plotW, plotH:plotH, n:n, lo:lo, hi:hi};

  ctx.font = font;
  ctx.textBaseline = "middle";

  /* شبکه و محور قیمت */
  const tk = niceTicks(lo, hi, 5);
  ctx.strokeStyle = "#171d27";
  ctx.fillStyle = "#7b8491";
  ctx.lineWidth = 1;
  ctx.textAlign = "left";
  (tk.ticks || []).forEach(function(v){
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(CW - pad.r, y); ctx.stroke();
    ctx.fillText(fmt(v, tk.step >= 1 ? 2 : Math.min(6, Math.max(2, Math.ceil(-Math.log10(tk.step)) + 1))), CW - pad.r + 6, y);
  });

  /* محور زمان */
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labelCount = Math.max(2, Math.min(7, Math.floor(plotW / 95)));
  let lastX = -999;
  for(let k = 0; k < labelCount; k++){
    const i = Math.round((n - 1) * k / (labelCount - 1));
    const x = X(i);
    if(x - lastX < 70) continue;
    lastX = x;
    ctx.strokeStyle = "#131821";
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, pad.t); ctx.lineTo(Math.round(x) + 0.5, pad.t + plotH); ctx.stroke();
    ctx.fillStyle = "#7b8491";
    ctx.fillText(axisLabel(rows[i].t), x, CH - 8);
  }
  ctx.textBaseline = "middle";

  /* حجم */
  if(showVol){
    const vmax = Math.max.apply(null, rows.map(function(r){ return r.v; })) || 1;
    const vy0 = CH - pad.b;
    rows.forEach(function(r, i){
      const h = Math.max(1, r.v / vmax * volH);
      ctx.fillStyle = r.c >= r.o ? "rgba(58,200,121,.35)" : "rgba(239,83,80,.35)";
      ctx.fillRect(X(i) - Math.max(1, step * 0.35), vy0 - h, Math.max(1, step * 0.7), h);
    });
  }

  /* ناحیه / خط / کندل */
  const up = "#3ac879", down = "#ef5350";
  if(chart.mode === "area" || (chart.mode === "candle" && chart.lineOnly)){
    const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    g.addColorStop(0, "rgba(231,196,97,.28)");
    g.addColorStop(1, "rgba(231,196,97,0)");
    ctx.beginPath();
    rows.forEach(function(r, i){ i ? ctx.lineTo(X(i), Y(r.c)) : ctx.moveTo(X(i), Y(r.c)); });
    ctx.lineTo(X(n-1), pad.t + plotH); ctx.lineTo(X(0), pad.t + plotH); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }
  if(chart.mode !== "candle" || chart.lineOnly){
    ctx.beginPath();
    rows.forEach(function(r, i){ i ? ctx.lineTo(X(i), Y(r.c)) : ctx.moveTo(X(i), Y(r.c)); });
    ctx.strokeStyle = "#e7c461"; ctx.lineWidth = 1.8; ctx.stroke();
  }else{
    const bw = Math.max(1, Math.min(14, step * 0.68));
    rows.forEach(function(r, i){
      const col = r.c >= r.o ? up : down;
      const x = X(i);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(r.h)); ctx.lineTo(Math.round(x) + 0.5, Y(r.l)); ctx.stroke();
      const yo = Y(r.o), yc = Y(r.c);
      ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    });
  }

  /* میانگین‌های متحرک */
  function line(arr, color){
    if(!arr) return;
    ctx.beginPath(); let started = false;
    arr.forEach(function(v, i){
      if(v == null) return;
      if(!started){ ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
  }
  line(s20, "#4aa3ff");
  line(s50, "#c77dff");

  /* خط آخرین قیمت */
  const lastRow = rows[n-1];
  const ly = Y(lastRow.c);
  const lastCol = lastRow.c >= rows[0].o ? up : down;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = lastCol; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, ly); ctx.lineTo(CW - pad.r, ly); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = lastCol;
  ctx.fillRect(CW - pad.r + 1, ly - 9, pad.r - 2, 18);
  ctx.fillStyle = "#08100b"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(fmt(lastRow.c, chart.dec), CW - pad.r + 5, ly);

  /* نشانگر ماوس */
  if(chart.hover != null && chart.hover >= 0 && chart.hover < n){
    const hx = X(chart.hover);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#5c6675"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, pad.t); ctx.lineTo(Math.round(hx) + 0.5, pad.t + plotH + volH + 8); ctx.stroke();
    if(chart.hoverY != null && chart.hoverY >= pad.t && chart.hoverY <= pad.t + plotH){
      ctx.beginPath(); ctx.moveTo(pad.l, chart.hoverY); ctx.lineTo(CW - pad.r, chart.hoverY); ctx.stroke();
      ctx.setLineDash([]);
      const price = hi - (chart.hoverY - pad.t) / plotH * (hi - lo);
      ctx.fillStyle = "#2a3140";
      ctx.fillRect(CW - pad.r + 1, chart.hoverY - 9, pad.r - 2, 18);
      ctx.fillStyle = "#e8e8e8"; ctx.textAlign = "left";
      ctx.fillText(fmt(price, chart.dec), CW - pad.r + 5, chart.hoverY);
    }
    ctx.setLineDash([]);
    const label = axisLabel(rows[chart.hover].t);
    const tw = ctx.measureText(label).width + 14;
    ctx.fillStyle = "#2a3140";
    ctx.fillRect(Math.min(CW - pad.r - tw, Math.max(pad.l, hx - tw / 2)), CH - pad.b + 3, tw, 18);
    ctx.fillStyle = "#e8e8e8"; ctx.textAlign = "center";
    ctx.fillText(label, Math.min(CW - pad.r - tw / 2, Math.max(pad.l + tw / 2, hx)), CH - pad.b + 12);
  }
}

function updateLegend(i){
  const el = $("legend");
  const r = chart.rows[i];
  if(!r){ el.innerHTML = ""; return; }
  const prev = i > 0 ? chart.rows[i-1].c : r.o;
  const ch = r.c - prev;
  const pct = prev ? ch / prev * 100 : null;
  const cls = dirOf(ch);
  let html = '<span class="lg-date">' + fullLabel(r.t) + "</span>";
  if(chart.lineOnly){
    html += '<span>قیمت: <b class="ltr">' + fmt(r.c, chart.dec) + "</b></span>";
  }else{
    html += '<span>باز: <b class="ltr">' + fmt(r.o, chart.dec) + "</b></span>" +
            '<span>بالا: <b class="ltr">' + fmt(r.h, chart.dec) + "</b></span>" +
            '<span>پایین: <b class="ltr">' + fmt(r.l, chart.dec) + "</b></span>" +
            '<span>بسته: <b class="ltr">' + fmt(r.c, chart.dec) + "</b></span>";
  }
  html += '<span class="' + cls + '"><b class="ltr">' + fmtSigned(ch, chart.dec) + " (" + fmtPct(pct) + ")</b></span>";
  if(r.v > 0) html += '<span>حجم: <b class="ltr">' + fmtVol(r.v) + "</b></span>";
  el.innerHTML = html;
}

function hoverAt(clientX, clientY){
  if(!chart.layout) return;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const L = chart.layout;
  let i = Math.floor((x - L.pad.l) / L.step);
  i = Math.max(0, Math.min(L.n - 1, i));
  chart.hover = i;
  chart.hoverY = y;
  drawChart();
  updateLegend(i);
}
function clearHover(){
  chart.hover = null; chart.hoverY = null;
  drawChart();
  updateLegend(chart.rows.length - 1);
}
canvas.addEventListener("mousemove", function(e){ hoverAt(e.clientX, e.clientY); });
canvas.addEventListener("mouseleave", clearHover);
canvas.addEventListener("touchstart", function(e){ if(e.touches[0]) hoverAt(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
canvas.addEventListener("touchmove", function(e){ if(e.touches[0]) hoverAt(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
canvas.addEventListener("touchend", function(){ setTimeout(clearHover, 1500); });

if("ResizeObserver" in window){
  new ResizeObserver(function(){ resizeCanvas(); }).observe($("chartBox"));
}else{
  window.addEventListener("resize", resizeCanvas);
}

/* ---------- پیام روی نمودار ---------- */
function showOverlay(kind, errs){
  const o = $("chartOverlay");
  o.classList.remove("hidden");
  if(kind === "loading"){
    o.innerHTML = '<div class="spinner"></div><div>در حال بارگذاری نمودار...</div>';
  }else{
    const list = (errs || []).map(function(e){ return "<li>" + String(e).replace(/</g, "&lt;") + "</li>"; }).join("");
    o.innerHTML = "<div>داده‌ی نمودار دریافت نشد.</div>" +
      '<button class="btn small" id="overlayRetry" type="button">تلاش مجدد</button>' +
      (list ? "<details><summary>جزئیات فنی</summary><ul>" + list + "</ul></details>" : "");
    $("overlayRetry").addEventListener("click", loadChart);
  }
}
function hideOverlay(){ $("chartOverlay").classList.add("hidden"); }

/* ---------- بارگذاری داده‌ی نمودار ---------- */
async function loadChart(){
  const id = ++chart.reqId;
  const P = PERIODS[chart.period];
  const m = MARKETS.find(function(x){ return x.id === chart.marketId; });
  const errs = [];
  let data = null;
  showOverlay("loading");
  $("chartSource").textContent = "در حال بارگذاری...";

  try{
    data = await yahooChart(chart.symbol, P.range, P.interval);
    data.source = "Yahoo Finance";
    data.intraday = P.intraday;
    if(data.rows.length < 2) throw new Error("داده‌ی کافی نیست");
  }catch(e){
    data = null;
    errs.push("Yahoo: " + (e.details ? e.details.join(" | ") : shortErr(e)));
  }
  if(id !== chart.reqId) return;

  if(!data && m && m.s){
    try{
      data = await stooqHistory(m.s, P.stooqDays);
      data.source = "Stooq";
      data.intraday = false;
      data.note = P.intraday ? "داده‌ی درون‌روزی در دسترس نبود؛ نمودار روزانه نمایش داده شد." : "";
      if(data.rows.length < 2) throw new Error("داده‌ی کافی نیست");
    }catch(e){
      data = null;
      errs.push("Stooq: " + (e.details ? e.details.join(" | ") : shortErr(e)));
    }
  }
  if(id !== chart.reqId) return;

  if(!data && m && m.cg){
    try{
      data = await coingeckoChart(m.cg, P.cg);
      data.source = "CoinGecko";
      data.intraday = P.intraday;
    }catch(e){
      data = null;
      errs.push(shortErr(e));
    }
  }
  if(id !== chart.reqId) return;

  if(!data){
    chart.rows = [];
    drawChart();
    showOverlay("error", errs);
    renderChartHeader();
    renderTech();
    $("chartSource").textContent = "ناموفق";
    return;
  }

  chart.rows = data.rows;
  chart.lineOnly = !!data.lineOnly;
  chart.intradayData = !!data.intraday;
  chart.source = data.source;
  chart.note = data.note || "";
  chart.meta = data.meta || {};
  chart.loadedAt = Date.now();
  chart.hover = null;
  hideOverlay();
  resizeCanvas();
  renderChartHeader();
  renderTech();
  updateLegend(chart.rows.length - 1);
}

function renderChartHeader(){
  const rows = chart.rows;
  $("chName").textContent = chart.name + (chart.unit ? " · " + chart.unit : "");
  if(!rows.length){
    $("chPrice").textContent = "—";
    $("chChange").innerHTML = "";
    $("chStats").innerHTML = "";
    $("chartFoot").textContent = "";
    return;
  }
  const P = PERIODS[chart.period];
  const first = rows[0], last = rows[rows.length - 1];
  const hi = Math.max.apply(null, rows.map(function(r){ return r.h; }));
  const lo = Math.min.apply(null, rows.map(function(r){ return r.l; }));
  const avg = rows.reduce(function(a, r){ return a + r.c; }, 0) / rows.length;
  const vol = rows.reduce(function(a, r){ return a + r.v; }, 0);
  const ch = last.c - first.o;
  const pct = first.o ? ch / first.o * 100 : null;
  const cls = dirOf(ch);
  const d = chart.dec;

  $("chPrice").textContent = fmt(last.c, d);
  $("chChange").innerHTML = '<span class="ltr ' + cls + '">' + arrowOf(ch) + " " + fmtSigned(ch, d) + " (" + fmtPct(pct) + ")</span> <span style=\"color:#6d7681\">در این بازه</span>";

  const chips = [
    ["بالاترین قیمت", fmt(hi, d)],
    ["پایین‌ترین قیمت", fmt(lo, d)],
    ["میانگین قیمت", fmt(avg, d)],
    ["دامنه‌ی نوسان", fmt(hi - lo, d) + " (" + (lo ? ((hi - lo) / lo * 100).toFixed(2) : "—") + "%)"],
    ["تعداد کندل", String(rows.length)],
    ["فاصله‌ی کندل‌ها", chart.source === "Stooq" ? "روزانه" : P.intLabel]
  ];
  if(vol > 0) chips.push(["مجموع حجم", fmtVol(vol)]);
  $("chStats").innerHTML = chips.map(function(c){
    const isText = c[0] === "فاصله‌ی کندل‌ها";
    return '<div class="chip">' + c[0] + "<b" + (isText ? "" : ' class="ltr"') + ">" + c[1] + "</b></div>";
  }).join("");

  $("chartSource").textContent = "منبع: " + chart.source + " · " + faHMS.format(new Date(chart.loadedAt));
  $("chartFoot").innerHTML =
    "محور افقی: زمان (به وقت تهران) &nbsp;│&nbsp; محور عمودی: قیمت" + (chart.unit ? " (" + chart.unit + ")" : "") +
    "<br>" + (chart.note ? chart.note + " " : "") +
    "با حرکت ماوس یا لمس نمودار، مقدار دقیق هر کندل بالای نمودار نشان داده می‌شود.";
}

/* ---------- انتخاب بازار ---------- */
function fillSelector(){
  const sel = $("chartSelector");
  sel.innerHTML = MARKETS.map(function(m){
    return '<option value="' + m.id + '">' + m.icon + " " + m.name + "</option>";
  }).join("") + '<option value="custom" id="customOption" hidden>نماد دلخواه</option>';
  sel.value = chart.marketId;
}

function selectMarket(id, scroll){
  const m = MARKETS.find(function(x){ return x.id === id; });
  if(!m) return;
  chart.marketId = m.id; chart.symbol = m.y; chart.name = m.name; chart.unit = m.unit; chart.dec = m.dec;
  $("chartSelector").value = m.id;
  $("symbolError").textContent = "";
  loadChart();
  if(scroll) $("chart").scrollIntoView({behavior:"smooth", block:"start"});
}

const SYMBOL_PATTERN = /^[A-Z0-9.\-=^]{1,15}$/;
function loadCustomSymbol(){
  let v = $("customSymbol").value.trim().toUpperCase().replace(/\s+/g, "");
  if(v.indexOf(":") !== -1) v = v.split(":").pop();
  if(!v){
    $("symbolError").textContent = "لطفاً نماد را وارد کنید.";
    return;
  }
  if(!SYMBOL_PATTERN.test(v)){
    $("symbolError").textContent = "قالب نماد درست نیست. نمونه‌ی درست: AAPL";
    return;
  }
  $("symbolError").textContent = "";
  chart.marketId = "custom"; chart.symbol = v; chart.name = v; chart.unit = ""; chart.dec = null;
  const opt = $("customOption");
  opt.hidden = false; opt.textContent = "نماد دلخواه: " + v;
  $("chartSelector").value = "custom";
  loadChart();
}

/* ---------- دانلود CSV ---------- */
function downloadCSV(){
  if(!chart.rows.length) return;
  const lines = ["time,open,high,low,close,volume"].concat(chart.rows.map(function(r){
    return [new Date(r.t).toISOString(), r.o, r.h, r.l, r.c, r.v].join(",");
  }));
  const blob = new Blob(["\ufeff" + lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mirza_" + chart.symbol.replace(/[^A-Z0-9]/gi, "_") + "_" + chart.period + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
}

/* =========================================================
   تحلیل فنی
========================================================= */
function techCard(title, value, note, cls, wide){
  return '<div class="tech-card' + (wide ? " tech-wide" : "") + '"><div class="tech-title">' + title + "</div>" +
    '<div class="tech-value ' + (cls || "") + '">' + value + '</div><div class="tech-note">' + note + "</div></div>";
}

function renderTech(){
  const grid = $("techGrid");
  $("techLabel").textContent = chart.name + " · " + PERIODS[chart.period].intLabel;
  const rows = chart.rows;
  if(rows.length < 20){
    grid.innerHTML = techCard("تحلیل فنی", "—", "برای محاسبه حداقل ۲۰ کندل لازم است. بازه‌ی زمانی بلندتری انتخاب کنید یا منتظر دریافت داده بمانید.", "flat", true);
    return;
  }
  const d = chart.dec;
  const closes = rows.map(function(r){ return r.c; });
  const last = closes[closes.length - 1];
  const s20 = lastValid(sma(closes, 20));
  const s50 = closes.length >= 50 ? lastValid(sma(closes, 50)) : null;
  const rs = lastValid(rsi(closes, 14));
  const mc = macd(closes, 12, 26, 9);
  const mLine = lastValid(mc.line), mSig = lastValid(mc.signal), mHist = lastValid(mc.hist);

  const rets = [];
  for(let i = 1; i < closes.length; i++){ if(closes[i-1]) rets.push(Math.log(closes[i] / closes[i-1])); }
  const vol = stdev(rets);

  const recent = rows.slice(-30);
  const support = Math.min.apply(null, recent.map(function(r){ return r.l; }));
  const resist = Math.max.apply(null, recent.map(function(r){ return r.h; }));

  let score = 0;
  const reasons = [];
  if(s20 != null){
    if(last > s20){ score++; reasons.push("قیمت بالای میانگین ۲۰ است (مثبت)"); }
    else { score--; reasons.push("قیمت زیر میانگین ۲۰ است (منفی)"); }
  }
  if(s20 != null && s50 != null){
    if(s20 > s50){ score++; reasons.push("میانگین ۲۰ بالای میانگین ۵۰ است (مثبت)"); }
    else { score--; reasons.push("میانگین ۲۰ زیر میانگین ۵۰ است (منفی)"); }
  }
  if(rs != null){
    if(rs < 30){ score++; reasons.push("اندیکاتور RSI در ناحیه‌ی اشباع فروش است (احتمال برگشت صعودی)"); }
    else if(rs > 70){ score--; reasons.push("اندیکاتور RSI در ناحیه‌ی اشباع خرید است (احتمال برگشت نزولی)"); }
    else reasons.push("اندیکاتور RSI در محدوده‌ی خنثی است");
  }
  if(mHist != null){
    if(mHist > 0){ score++; reasons.push("هیستوگرام MACD مثبت است"); }
    else { score--; reasons.push("هیستوگرام MACD منفی است"); }
  }
  const verdict = score >= 2 ? ["گرایش صعودی", "up"] : score <= -2 ? ["گرایش نزولی", "down"] : ["خنثی / بدون روند مشخص", "warn"];

  let rsiNote = "خنثی (بین ۳۰ تا ۷۰)", rsiCls = "gold";
  if(rs != null && rs >= 70){ rsiNote = "اشباع خرید (بالای ۷۰)"; rsiCls = "down"; }
  else if(rs != null && rs <= 30){ rsiNote = "اشباع فروش (زیر ۳۰)"; rsiCls = "up"; }

  const L = function(v){ return '<span class="ltr">' + v + "</span>"; };
  grid.innerHTML =
    techCard("جمع‌بندی اندیکاتورها", verdict[0], 'امتیاز: ' + L((score > 0 ? "+" : "") + score) + '<ul class="signal-list">' +
      reasons.map(function(r){ return "<li>" + r + "</li>"; }).join("") + "</ul>", verdict[1], true) +
    techCard("شاخص قدرت نسبی (RSI-14)", L(rs != null ? rs.toFixed(1) : "—"), rsiNote, rsiCls) +
    techCard("MACD (12, 26, 9)", L(mHist != null ? fmtSigned(mHist, Math.max(d || 2, 2)) : "—"),
      "خط MACD: " + L(fmt(mLine, d)) + "<br>خط سیگنال: " + L(fmt(mSig, d)), mHist > 0 ? "up" : "down") +
    techCard("میانگین متحرک ۲۰", L(fmt(s20, d)), last > s20 ? "قیمت <b class=\"up\">بالای</b> میانگین است" : "قیمت <b class=\"down\">زیر</b> میانگین است", last > s20 ? "up" : "down") +
    techCard("میانگین متحرک ۵۰", s50 != null ? L(fmt(s50, d)) : "—", s50 != null ? (last > s50 ? "قیمت <b class=\"up\">بالای</b> میانگین است" : "قیمت <b class=\"down\">زیر</b> میانگین است") : "برای محاسبه حداقل ۵۰ کندل لازم است", s50 != null ? (last > s50 ? "up" : "down") : "flat") +
    techCard("حمایت و مقاومت (۳۰ کندل اخیر)", L(fmt(support, d)) + " – " + L(fmt(resist, d)),
      "فاصله‌ی قیمت تا حمایت: " + L(((last - support) / last * 100).toFixed(2) + "%") + "<br>فاصله‌ی قیمت تا مقاومت: " + L(((resist - last) / last * 100).toFixed(2) + "%"), "gold") +
    techCard("نوسان هر کندل", L(vol != null ? (vol * 100).toFixed(2) + "%" : "—"), "انحراف معیار بازده‌ی لگاریتمی کندل‌ها", "gold") +
    techCard("قیمت فعلی", L(fmt(last, d)), "آخرین کندل: " + fullLabel(rows[rows.length - 1].t), "gold");
}
