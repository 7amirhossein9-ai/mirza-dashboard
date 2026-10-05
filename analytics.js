"use strict";
/* =========================================================
   توابع تحلیلی (بدون وابستگی به صفحه)
========================================================= */
/* PURE2:START */
const OZ_GRAM = 31.1035;

/* ---------- نبض بازار ---------- */
function computePulse(q, markets){
  const g = function(id){ return q[id] && Number.isFinite(q[id].price) ? q[id] : null; };
  const out = {score:0, factors:[], ratios:{}, movers:null, vix:null, tnx:null};
  const weights = [
    ["sp500", 1, "شاخص اس‌اندپی ۵۰۰"], ["nasdaq", 1, "شاخص نزدک"], ["vix", -1, "شاخص ترس"],
    ["btc", 0.5, "بیت‌کوین"], ["gold", -0.5, "طلای جهانی"], ["dxy", -0.5, "شاخص دلار"]
  ];
  weights.forEach(function(w){
    const x = g(w[0]);
    if(!x || x.pct == null) return;
    const s = Math.sign(x.pct) * w[1];
    out.score += s;
    out.factors.push({name:w[2], pct:x.pct, effect:s});
  });
  out.label = out.factors.length < 3 ? "داده‌ی کافی نیست"
    : out.score >= 1.5 ? "گرایش ریسک‌پذیر"
    : out.score <= -1.5 ? "گرایش ریسک‌گریز" : "متعادل";
  out.cls = out.score >= 1.5 ? "up" : out.score <= -1.5 ? "down" : "warn";
  const gold = g("gold"), silver = g("silver"), oil = g("oil"), btc = g("btc");
  if(gold && silver) out.ratios.gs = gold.price / silver.price;
  if(gold && oil) out.ratios.go = gold.price / oil.price;
  if(btc && gold) out.ratios.bg = btc.price / gold.price;
  out.vix = g("vix") ? g("vix").price : null;
  out.tnx = g("tnx") ? g("tnx").price : null;
  const list = markets.filter(function(m){
    return m.id !== "vix" && m.id !== "tnx" && q[m.id] && q[m.id].pct != null;
  });
  if(list.length >= 2){
    const sorted = list.slice().sort(function(a, b){ return q[b.id].pct - q[a.id].pct; });
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    out.movers = {top:{name:top.name, pct:q[top.id].pct}, bottom:{name:bottom.name, pct:q[bottom.id].pct}};
  }
  return out;
}

/* ---------- بازار ایران ---------- */
function tgNum(v){
  if(v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function parseTgju(text){
  const j = JSON.parse(text);
  const cur = j && (j.current || j);
  if(!cur || typeof cur !== "object" || (!cur.price_dollar_rl && !cur.geram18)) throw new Error("ساختار پاسخ ناشناخته");
  return cur;
}
function tgItem(cur, key, rial){
  const o = cur && cur[key];
  if(!o) return null;
  const raw = tgNum(o.p);
  if(raw == null || raw <= 0) return null;
  const k = rial ? 10 : 1;
  const dir = o.dt === "low" ? -1 : o.dt === "high" ? 1 : 0;
  const d = tgNum(o.d), dp = tgNum(o.dp), h = tgNum(o.h), l = tgNum(o.l);
  return {
    price: raw / k,
    change: d != null ? dir * d / k : null,
    pct: dp != null ? dir * dp : null,
    hi: h != null && h > 0 ? h / k : null,
    lo: l != null && l > 0 ? l / k : null,
    t: o.t || ""
  };
}
function intrinsicToman(ounceUsd, usdToman, pureGrams){
  if(!(ounceUsd > 0) || !(usdToman > 0) || !(pureGrams > 0)) return null;
  return ounceUsd / OZ_GRAM * pureGrams * usdToman;
}
function buildIranRows(defs, cur, manualUsd, ozFallback, silverOz){
  const usdItem = cur ? tgItem(cur, "price_dollar_rl", true) : null;
  const usd = usdItem ? usdItem.price : (manualUsd > 0 ? manualUsd : null);
  const onsItem = cur ? tgItem(cur, "ons", false) : null;
  const oz = onsItem ? onsItem.price : (ozFallback > 0 ? ozFallback : null);
  const rows = defs.map(function(d){
    const r = {id:d.id, def:d, market:null, change:null, pct:null, hi:null, lo:null, t:"", theo:null, gap:null, src:""};
    if(d.key && cur){
      const it = tgItem(cur, d.key, true);
      if(it){ r.market = it.price; r.change = it.change; r.pct = it.pct; r.hi = it.hi; r.lo = it.lo; r.t = it.t; r.src = "tgju"; }
    }
    return r;
  });
  const byId = {};
  rows.forEach(function(r){ byId[r.id] = r; });
  if(byId.g24 && byId.g24.market == null && byId.g18 && byId.g18.market != null){
    byId.g24.market = byId.g18.market / 0.75;
    byId.g24.src = "calc";
  }
  rows.forEach(function(r){
    const d = r.def;
    if(d.pure && oz && usd) r.theo = intrinsicToman(oz, usd, d.pure);
    if(d.kind === "silver" && silverOz && usd){
      r.theo = silverOz / OZ_GRAM * d.purity * usd;
      r.market = r.theo;
      r.src = "calc";
    }
    if(d.id === "usd" && r.market == null && usd){ r.market = usd; r.src = "manual"; }
    if(r.market != null && r.theo != null && d.kind !== "silver") r.gap = (r.market / r.theo - 1) * 100;
  });
  return {rows:rows, usd:usd, oz:oz, byId:byId};
}

/* ---------- کشورها (بانک جهانی) ---------- */
function parseWB(text){
  const j = JSON.parse(text);
  if(!Array.isArray(j) || j.length < 2 || !Array.isArray(j[1])){
    const m = j && j[0] && j[0].message && j[0].message[0] && j[0].message[0].value;
    throw new Error(m || "داده‌ای از بانک جهانی دریافت نشد");
  }
  return j;
}
function wbSeries(rows){
  const map = {};
  rows.forEach(function(r){
    const c = r.countryiso3code || (r.country && r.country.id);
    if(!c) return;
    const y = parseInt(r.date, 10);
    const v = num(r.value);
    if(!map[c]) map[c] = {};
    if(v != null && Number.isFinite(y)) map[c][y] = v;
  });
  return map;
}
function cagr(a, b, years){
  if(!(a > 0) || !(b > 0) || !(years > 0)) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}
function computeCountryRows(ind, codes, seriesMap, rankInfo, from, names){
  return codes.map(function(code){
    const s = seriesMap[code] || {};
    const years = Object.keys(s).map(Number).filter(function(y){ return y >= from; }).sort(function(a, b){ return a - b; });
    const row = {code:code, name:names[code] || code, latest:null, first:null, chg:null, avg5:null, vol:null, rank:null, total:null, share:null};
    if(!years.length) return row;
    const ly = years[years.length - 1], fy = years[0];
    row.latest = {year:ly, value:s[ly]};
    row.first = {year:fy, value:s[fy]};
    if(ind.level){
      row.chg = cagr(s[fy], s[ly], ly - fy);
      const yoy = [];
      for(let i = 1; i < years.length; i++){
        const a = s[years[i-1]], b = s[years[i]];
        if(a > 0 && b > 0 && years[i] - years[i-1] === 1) yoy.push((b / a - 1) * 100);
      }
      row.vol = stdev(yoy);
    }else{
      row.chg = s[ly] - s[fy];
      row.vol = stdev(years.map(function(y){ return s[y]; }));
    }
    const last5 = years.filter(function(y){ return y > ly - 5; }).map(function(y){ return s[y]; });
    row.avg5 = last5.length ? last5.reduce(function(a, b){ return a + b; }, 0) / last5.length : null;
    if(rankInfo && rankInfo.list){
      const idx = rankInfo.list.findIndex(function(x){ return x.code === code; });
      if(idx >= 0) row.rank = idx + 1;
      row.total = rankInfo.list.length;
      if(ind.abs && rankInfo.world) row.share = row.latest.value / rankInfo.world * 100;
    }
    return row;
  });
}
function fmtWB(ind, v){
  if(v == null || !Number.isFinite(v)) return "—";
  const L = function(s){ return '<span class="ltr">' + s + "</span>"; };
  const a = Math.abs(v);
  if(ind.kind === "usdbig"){
    if(a >= 1e12) return L((v / 1e12).toFixed(2)) + " تریلیون دلار";
    if(a >= 1e9) return L((v / 1e9).toFixed(1)) + " میلیارد دلار";
    return L((v / 1e6).toFixed(1)) + " میلیون دلار";
  }
  if(ind.kind === "usd") return L(Math.round(v).toLocaleString("en-US")) + " دلار";
  if(ind.kind === "count"){
    if(a >= 1e9) return L((v / 1e9).toFixed(2)) + " میلیارد نفر";
    if(a >= 1e6) return L((v / 1e6).toFixed(1)) + " میلیون نفر";
    return L(Math.round(v).toLocaleString("en-US")) + " نفر";
  }
  if(ind.kind === "pct") return L(v.toFixed(2) + "%");
  return L(v.toFixed(1));
}
function fmtWBShort(ind, v){
  if(v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if(ind.kind === "usdbig"){
    if(a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
    if(a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
    return "$" + (v / 1e6).toFixed(0) + "M";
  }
  if(ind.kind === "usd") return "$" + Math.round(v).toLocaleString("en-US");
  if(ind.kind === "count"){
    if(a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if(a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    return Math.round(v).toLocaleString("en-US");
  }
  if(ind.kind === "pct") return v.toFixed(1) + "%";
  return v.toFixed(1);
}
function buildInsights(ind, rows, baseCode){
  const L = function(s){ return '<span class="ltr">' + s + "</span>"; };
  const out = [];
  const ok = rows.filter(function(r){ return r.latest; });
  if(ok.length < 2){ out.push("برای تحلیل، حداقل دو کشور با داده‌ی معتبر لازم است."); return out; }
  const sorted = ok.slice().sort(function(a, b){ return b.latest.value - a.latest.value; });
  const hi = sorted[0], lo = sorted[sorted.length - 1];
  out.push("بیشترین مقدار: <b>" + hi.name + "</b> (" + fmtWB(ind, hi.latest.value) + ") و کمترین: <b>" + lo.name + "</b> (" + fmtWB(ind, lo.latest.value) + ")." +
    (ind.level && lo.latest.value > 0 ? " نسبت بیشترین به کمترین حدود " + L((hi.latest.value / lo.latest.value).toFixed(1)) + " برابر است." : ""));

  const base = ok.find(function(r){ return r.code === baseCode; });
  if(base){
    let s = "<b>" + base.name + "</b>";
    if(base.rank) s += " با مقدار " + fmtWB(ind, base.latest.value) + " (داده‌ی سال " + L(base.latest.year) + ") در رتبه‌ی " + L(base.rank) + " از " + L(base.total) + " کشور جهان قرار دارد";
    else s += " آخرین مقدار: " + fmtWB(ind, base.latest.value) + " (سال " + L(base.latest.year) + ")";
    if(base.share != null) s += " و سهمش از کل جهان حدود " + L(base.share.toFixed(2) + "%") + " است";
    out.push(s + ".");

    if(ind.level){
      const others = ok.filter(function(r){ return r.code !== baseCode && r.latest.value > 0; });
      const bigger = others.filter(function(r){ return r.latest.value > base.latest.value; }).sort(function(a, b){ return a.latest.value - b.latest.value; });
      const smaller = others.filter(function(r){ return r.latest.value <= base.latest.value; }).sort(function(a, b){ return b.latest.value - a.latest.value; });
      if(bigger.length) out.push("نزدیک‌ترین کشور بزرگ‌تر از " + base.name + " در این فهرست <b>" + bigger[0].name + "</b> است؛ مقدارش " + L((bigger[0].latest.value / base.latest.value).toFixed(2)) + " برابر مقدار " + base.name + " است.");
      if(smaller.length) out.push("نزدیک‌ترین کشور کوچک‌تر <b>" + smaller[0].name + "</b> است؛ مقدار " + base.name + " حدود " + L((base.latest.value / smaller[0].latest.value).toFixed(2)) + " برابر آن است.");
    }else{
      const avgOthers = ok.filter(function(r){ return r.code !== baseCode; }).reduce(function(a, r, _, arr){ return a + r.latest.value / arr.length; }, 0);
      out.push("میانگین بقیه‌ی کشورهای انتخاب‌شده " + fmtWB(ind, avgOthers) + " است و " + base.name + " " + (base.latest.value > avgOthers ? "بالاتر" : "پایین‌تر") + " از این میانگین قرار دارد (اختلاف " + L(Math.abs(base.latest.value - avgOthers).toFixed(2)) + " واحد).");
    }
  }

  const chgList = ok.filter(function(r){ return r.chg != null; }).sort(function(a, b){ return b.chg - a.chg; });
  if(chgList.length >= 2){
    const f = chgList[0], s = chgList[chgList.length - 1];
    if(ind.level){
      out.push("رشد سالانه‌ی ترکیبی در بازه: سریع‌ترین <b>" + f.name + "</b> (" + L(f.chg.toFixed(2) + "%") + ") و کندترین <b>" + s.name + "</b> (" + L(s.chg.toFixed(2) + "%") + ").");
    }else{
      out.push("تغییر در بازه (نقطه‌ی درصدی): بیشترین افزایش <b>" + f.name + "</b> (" + L((f.chg > 0 ? "+" : "") + f.chg.toFixed(2)) + ") و بیشترین کاهش <b>" + s.name + "</b> (" + L((s.chg > 0 ? "+" : "") + s.chg.toFixed(2)) + ").");
    }
  }
  const volList = ok.filter(function(r){ return r.vol != null; }).sort(function(a, b){ return a.vol - b.vol; });
  if(volList.length >= 2){
    out.push("باثبات‌ترین روند: <b>" + volList[0].name + "</b> و پرنوسان‌ترین: <b>" + volList[volList.length - 1].name + "</b> (بر پایه‌ی انحراف معیار تغییرات سالانه).");
  }
  if(ind.level && base && base.chg != null){
    let n = 0;
    ok.forEach(function(r){
      if(n >= 3 || r.code === baseCode || r.chg == null) return;
      if(base.latest.value < r.latest.value && base.chg > r.chg){
        const yrs = Math.log(r.latest.value / base.latest.value) / Math.log((1 + base.chg / 100) / (1 + r.chg / 100));
        if(Number.isFinite(yrs) && yrs > 0 && yrs <= 100){
          out.push("اگر نرخ‌های رشد ترکیبی این بازه ثابت بماند، " + base.name + " حدود " + L(Math.ceil(yrs)) + " سال دیگر به " + r.name + " می‌رسد. این فقط یک برآورد ریاضی است و پیش‌بینی نیست.");
          n++;
        }
      }
    });
  }
  const miss = rows.filter(function(r){ return !r.latest; }).map(function(r){ return r.name; });
  if(miss.length) out.push("برای این کشورها داده‌ای در بازه‌ی انتخابی نبود: " + miss.join("، ") + ".");
  return out;
}

/* ---------- تحلیل قاعده‌محور سخنان ---------- */
const ASSET_FA = {gold:"طلا", oil:"نفت", btc:"بیت‌کوین", dxy:"دلار آمریکا", spx:"سهام آمریکا"};
const TOPICS = [
  {id:"tariff", fa:"تعرفه و تجارت", re:/\b(tariffs?|trade war|trade deal|duties|import tax|embargo|export controls?)\b/i,
   impact:{spx:-1, gold:1, dxy:1, oil:-0.5}, note:"سخن از تعرفه و محدودیت تجاری معمولاً نگرانی از کندی رشد و ریسک‌گریزی را بالا می‌برد."},
  {id:"easing", fa:"کاهش نرخ بهره", re:/\b(rate cuts?|cuts? (in )?(interest )?rates?|cutting rates|lower(ing)? (interest )?rates?|easing|dovish)\b/i,
   impact:{gold:1, spx:1, btc:1, dxy:-1}, note:"نشانه‌ی سیاست پولی منبسط‌تر است؛ معمولاً به نفع طلا، سهام و رمزارز و به ضرر دلار تمام می‌شود."},
  {id:"tight", fa:"افزایش نرخ بهره", re:/\b(rate hikes?|raise(s|d)? (interest )?rates?|higher rates|tightening|hawkish)\b/i,
   impact:{gold:-1, spx:-1, btc:-1, dxy:1}, note:"نشانه‌ی سیاست پولی انقباضی است؛ معمولاً دلار را تقویت و دارایی‌های پرریسک و طلا را تحت فشار می‌گذارد."},
  {id:"fed", fa:"فدرال رزرو و سیاست پولی", re:/\b(federal reserve|the fed|fomc|powell|monetary policy|interest rates?)\b/i,
   impact:{}, note:"موضوع سیاست پولی است؛ جهت اثر به جزئیات متن بستگی دارد."},
  {id:"mideast", fa:"خاورمیانه، ایران و تحریم", re:/\b(iran|iranian|sanctions?|israel|gaza|hormuz|houthis?|hezbollah|missiles?|middle east)\b/i,
   impact:{oil:1, gold:1, spx:-0.5}, note:"تنش ژئوپلیتیک در خاورمیانه معمولاً قیمت نفت و طلا را بالا می‌برد."},
  {id:"war", fa:"جنگ و امنیت", re:/\b(war|attack(s|ed)?|strikes?|military|troops|nuclear|invasion|bomb(ing|s)?)\b/i,
   impact:{gold:0.5, oil:0.5, spx:-0.5}, note:"خبرهای نظامی معمولاً تقاضا برای دارایی‌های امن را بالا می‌برد."},
  {id:"peace", fa:"آتش‌بس و توافق صلح", re:/\b(ceasefire|peace deal|peace talks|truce|peace agreement)\b/i,
   impact:{oil:-0.5, gold:-0.5, spx:0.5}, note:"کاهش تنش معمولاً حق ریسک ژئوپلیتیک را کم می‌کند."},
  {id:"oil", fa:"نفت و انرژی", re:/\b(oil|crude|opec|drill(ing)?|natural gas|lng|gasoline|energy prices?|pipelines?|refiner(y|ies))\b/i,
   impact:{}, note:"موضوع انرژی است و قیمت نفت به آن حساس است."},
  {id:"china", fa:"چین", re:/\b(china|chinese|beijing|xi jinping|yuan|taiwan)\b/i,
   impact:{spx:-0.25}, note:"مناقشه یا مذاکره با چین روی تجارت جهانی و بازار سهام اثر می‌گذارد."},
  {id:"russia", fa:"روسیه و اوکراین", re:/\b(russia|russian|ukraine|putin|zelensky|nato|kremlin)\b/i,
   impact:{oil:0.5, gold:0.5}, note:"تحولات روسیه و اوکراین روی انرژی و دارایی‌های امن اثر دارد."},
  {id:"crypto", fa:"رمزارز", re:/\b(bitcoin|btc|crypto(currency|currencies)?|stablecoins?|digital assets?|ethereum|blockchain)\b/i,
   impact:{btc:0.5}, note:"موضوع رمزارز است و قیمت بیت‌کوین به آن حساس است."},
  {id:"dollar", fa:"دلار و ارز", re:/\b(dollar|currency|devalu(e|ation)|dxy|reserve currency|brics)\b/i,
   impact:{}, note:"درباره‌ی ارزش دلار یا نظام ارزی است."},
  {id:"economy", fa:"اقتصاد کلان", re:/\b(inflation|cpi|jobs report|unemployment|recession|gdp|economy|economic growth|deficit|debt ceiling)\b/i,
   impact:{}, note:"درباره‌ی وضعیت کلی اقتصاد است."},
  {id:"stocks", fa:"بازار سهام", re:/\b(stock market|dow jones|nasdaq|s&p|wall street|record high|market crash)\b/i,
   impact:{}, note:"مستقیماً به بازار سهام مربوط است."},
  {id:"tax", fa:"مالیات و بودجه", re:/\b(taxes|tax cuts?|tax bill|stimulus|spending bill|government shutdown|budget)\b/i,
   impact:{spx:0.25}, note:"سیاست مالی و بودجه‌ای است."}
];
const POS_RE = /\b(great|strong|winning|win|deal|agreement|growth|boom|record|success(ful)?|prosper(ity)?|peace|historic|best|surge|rally|approved?|support(s|ed)?|invest(ment|ments)?|lower prices|tax cuts?)\b/gi;
const NEG_RE = /\b(war|attacks?|crash|ban(ned)?|threat(s|en|ened)?|collapse|crisis|fail(s|ed|ure)?|terrible|disaster|worst|sanctions?|tariffs?|hikes?|recession|default|shutdown|kill(s|ed)?|bomb(s|ing)?|destroy(ed)?|penalt(y|ies)|fines?)\b/gi;
const STRONG_RE = /\b(tariffs?|sanctions?|ban|war|emergency|executive order|nuclear|default|embargo|invasion|shutdown)\b/gi;

function analyzeStatement(text){
  const t = String(text || "");
  const topics = [];
  const impacts = {gold:0, oil:0, btc:0, dxy:0, spx:0};
  TOPICS.forEach(function(tp){
    if(!tp.re.test(t)) return;
    let factor = 1, note = tp.note;
    if(tp.id === "tariff" && /\b(pause[sd]?|pausing|delay(ed)?|suspend(ed)?|exempt(ion|ed)?|reduc(e|ed|ing)|lower(ed|ing)?|roll(ed)? back|scrap(ped)?|trade deal|agreement)\b/i.test(t)){
      factor = -0.5;
      note = "سخن از توافق، تعلیق یا کاهش تعرفه است؛ معمولاً تنش تجاری را کم می‌کند و بازار سهام را حمایت می‌کند.";
    }
    topics.push({id:tp.id, fa:tp.fa, note:note});
    Object.keys(tp.impact).forEach(function(k){ impacts[k] += tp.impact[k] * factor; });
  });
  const pos = (t.match(POS_RE) || []).length;
  const neg = (t.match(NEG_RE) || []).length;
  const score = pos - neg;
  const tone = {score:score, label: score >= 2 ? "مثبت" : score <= -2 ? "منفی" : "خنثی یا مختلط"};
  const strong = (t.match(STRONG_RE) || []).length;
  const hasNum = /\b\d+(\.\d+)?\s?(%|percent|billion|trillion|million)\b/i.test(t) ? 1 : 0;
  const imp = topics.length + strong * 2 + hasNum;
  const importance = {score:imp, level: imp >= 5 ? "high" : imp >= 3 ? "mid" : "low", label: imp >= 5 ? "اهمیت بازاری: بالا" : imp >= 3 ? "اهمیت بازاری: متوسط" : "اهمیت بازاری: کم"};
  const up = [], down = [];
  Object.keys(impacts).forEach(function(k){
    if(impacts[k] >= 0.5) up.push(ASSET_FA[k]);
    else if(impacts[k] <= -0.5) down.push(ASSET_FA[k]);
  });
  const maxAbs = Math.max.apply(null, Object.keys(impacts).map(function(k){ return Math.abs(impacts[k]); }));
  const confidence = maxAbs >= 2 ? "متوسط" : "ضعیف";
  const parts = [];
  parts.push(topics.length ? "محورهای متن: " + topics.slice(0, 3).map(function(x){ return x.fa; }).join("، ") + "." : "موضوع مشخص بازاری در متن شناسایی نشد.");
  parts.push("لحن واژگان متن: " + tone.label + ".");
  if(up.length) parts.push("احتمال فشار صعودی کوتاه‌مدت روی: " + up.join("، ") + ".");
  if(down.length) parts.push("احتمال فشار نزولی کوتاه‌مدت روی: " + down.join("، ") + ".");
  if(up.length || down.length) parts.push("سطح اطمینان این برآورد: " + confidence + ".");
  return {topics:topics, tone:tone, impacts:impacts, importance:importance, up:up, down:down, confidence:confidence, summary:parts.join(" ")};
}

/* واکنش قیمت پس از زمان انتشار: بازدهی بسته‌شدن کندل‌های ۵ دقیقه‌ای */
function reactionPct(rows, t, delta){
  const BAR = 5 * 60000, TOL = 20 * 60000;
  function closeAt(x){
    for(let i = rows.length - 1; i >= 0; i--){
      const end = rows[i].t + BAR;
      if(end <= x) return x - end > TOL ? null : rows[i].c;
    }
    return null;
  }
  const a = closeAt(t), b = closeAt(t + delta);
  if(a == null || b == null || !(a > 0)) return null;
  return (b / a - 1) * 100;
}
function parseGtx(text){
  const j = JSON.parse(text);
  if(!Array.isArray(j) || !Array.isArray(j[0])) throw new Error("پاسخ ترجمه نامعتبر");
  const s = j[0].map(function(x){ return (x && x[0]) || ""; }).join("");
  if(!s.trim()) throw new Error("ترجمه‌ی خالی");
  return s;
}
/* PURE2:END */

/* PURE3:START */
/* ---------- پیش‌بینی ساده‌ی سری سالانه با آزمون پس‌نگر ---------- */
function fcContiguous(map, from){
  const ys = Object.keys(map).map(Number).filter(function(y){ return y >= from; }).sort(function(a, b){ return a - b; });
  if(ys.length < 2) return null;
  const years = [], vals = [];
  for(let i = 0; i < ys.length; i++){
    if(i > 0){
      const gap = ys[i] - ys[i-1];
      if(gap > 4){ years.length = 0; vals.length = 0; }
      else for(let k = 1; k < gap; k++){
        years.push(ys[i-1] + k);
        vals.push(map[ys[i-1]] + (map[ys[i]] - map[ys[i-1]]) * k / gap);
      }
    }
    years.push(ys[i]); vals.push(map[ys[i]]);
  }
  return {years:years, vals:vals};
}
function fcLinear(vals, h){
  const n = Math.min(8, vals.length), y = vals.slice(-n);
  const mx = (n - 1) / 2, my = y.reduce(function(a, b){ return a + b; }, 0) / n;
  let num_ = 0, den = 0;
  for(let i = 0; i < n; i++){ num_ += (i - mx) * (y[i] - my); den += (i - mx) * (i - mx); }
  const slope = den ? num_ / den : 0;
  const out = [];
  for(let k = 1; k <= h; k++) out.push(my + slope * (n - 1 + k - mx));
  return out;
}
function fcDamped(vals, h){
  const a = 0.5, b = 0.3, phi = 0.85;
  let lvl = vals[0], tr = vals.length > 1 ? vals[1] - vals[0] : 0;
  for(let i = 1; i < vals.length; i++){
    const prev = lvl;
    lvl = a * vals[i] + (1 - a) * (prev + phi * tr);
    tr = b * (lvl - prev) + (1 - b) * phi * tr;
  }
  const out = [];
  let acc = 0;
  for(let k = 1; k <= h; k++){ acc += Math.pow(phi, k); out.push(lvl + acc * tr); }
  return out;
}
function fcNaive(vals, h){
  const out = [];
  for(let k = 0; k < h; k++) out.push(vals[vals.length - 1]);
  return out;
}
function forecastSeries(map, from, h, nonNegative){
  const s = fcContiguous(map, from);
  if(!s || s.vals.length < 8) return {error:"برای پیش‌بینی حداقل ۸ سال داده‌ی پیوسته لازم است."};
  const models = [
    {id:"naive",  name:"ثابت‌ماندن مقدار آخر",       f:fcNaive},
    {id:"linear", name:"روند خطی",                   f:fcLinear},
    {id:"damped", name:"هموارسازی نمایی با روند میرا", f:fcDamped}
  ];
  const m = Math.min(3, Math.floor(s.vals.length / 4));
  const train = s.vals.slice(0, s.vals.length - m), test = s.vals.slice(-m);
  let best = null;
  models.forEach(function(md){
    const pred = md.f(train, m);
    let mape = 0, se = 0;
    for(let i = 0; i < m; i++){
      mape += Math.abs(pred[i] - test[i]) / Math.max(1e-9, Math.abs(test[i]));
      se += (pred[i] - test[i]) * (pred[i] - test[i]);
    }
    md.mape = mape / m * 100;
    md.rmse = Math.sqrt(se / m);
    if(!best || md.mape < best.mape) best = md;
  });
  const fc = best.f(s.vals, h);
  const lastY = s.years[s.years.length - 1];
  const years = [], lo = [], hi = [], mid = [];
  for(let k = 1; k <= h; k++){
    const band = 1.28 * best.rmse * Math.sqrt(k);
    let v = fc[k-1], l = v - band, u = v + band;
    if(nonNegative){ v = Math.max(0, v); l = Math.max(0, l); u = Math.max(0, u); }
    years.push(lastY + k); mid.push(v); lo.push(l); hi.push(u);
  }
  return {model:best.name, mape:best.mape, years:years, mid:mid, lo:lo, hi:hi, lastYear:lastY, lastValue:s.vals[s.vals.length - 1]};
}
/* PURE3:END */
