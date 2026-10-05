"use strict";
/* =========================================================
   سخنان و پست‌های مقامات آمریکایی
========================================================= */
const ST_SOURCES = [
  {key:"trump",    label:"ترامپ",              kind:"truth", url:"https://www.trumpstruth.org/feed", who:"دونالد ترامپ، رئیس‌جمهور آمریکا (پست‌های تروث سوشال)"},
  {key:"musk",     label:"ایلان ماسک",         kind:"gnews", q:'"Elon Musk" (posted OR wrote OR said) (X OR tweet)', who:"ایلان ماسک"},
  {key:"fed",      label:"فدرال رزرو",         kind:"feed",  url:"https://www.federalreserve.gov/feeds/press_all.xml", who:"بانک مرکزی آمریکا (فدرال رزرو)"},
  {key:"wh",       label:"کاخ سفید",           kind:"feed",  url:"https://www.whitehouse.gov/feed/", who:"کاخ سفید"},
  {key:"treasury", label:"وزارت خزانه‌داری",   kind:"gnews", q:'("Treasury Secretary" OR "Treasury Department") said', who:"وزارت خزانه‌داری آمریکا"},
  {key:"xposts",   label:"پست‌های ایکس مقامات", kind:"gnews", q:'("posted on X" OR "wrote on X" OR tweeted) (senator OR secretary OR governor OR "Fed official")', who:"مقام آمریکایی (از گزارش رسانه‌ها)"}
];
const REACT_ASSETS = [
  {id:"gold", y:"GC=F",     name:"طلا"},
  {id:"oil",  y:"CL=F",     name:"نفت"},
  {id:"btc",  y:"BTC-USD",  name:"بیت‌کوین"},
  {id:"dxy",  y:"DX-Y.NYB", name:"دلار"},
  {id:"spx",  y:"ES=F",     name:"آتی سهام آمریکا"}
];
const st = {key:"all", reqId:0, cache:{}};
const intra = {};
let trCache = {};
try{ trCache = JSON.parse(localStorage.getItem("mirza_tr_v1") || "{}") || {}; }catch(e){}
function saveTr(){
  try{
    const keys = Object.keys(trCache);
    if(keys.length > 160) keys.slice(0, keys.length - 160).forEach(function(k){ delete trCache[k]; });
    localStorage.setItem("mirza_tr_v1", JSON.stringify(trCache));
  }catch(e){}
}

async function translateFa(text){
  const t = String(text).slice(0, 450);
  if(trCache[t]) return trCache[t];
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=" + enc(t);
  let out = null;
  try{ const r = await timeoutFetch(url, 7000); if(r.ok) out = parseGtx(await r.text()); }catch(e){}
  if(!out){ try{ out = (await fetchSequential(url, parseGtx, {max:2, ms:7000})).value; }catch(e){} }
  if(!out){
    try{
      const r = await timeoutFetch("https://api.mymemory.translated.net/get?q=" + enc(t) + "&langpair=en|fa", 8000);
      if(r.ok){
        const j = await r.json();
        const tt = j && j.responseData && j.responseData.translatedText;
        if(tt && !/MYMEMORY WARNING/i.test(tt)) out = tt;
      }
    }catch(e){}
  }
  if(!out || !isPersianText(out)) throw new Error("ترجمه ناموفق");
  trCache[t] = out; saveTr();
  return out;
}

async function loadIntraday(){
  const now = Date.now();
  for(const a of REACT_ASSETS){
    if(intra[a.id] && now - intra[a.id].t < 10 * 60000) continue;
    try{ const d = await yahooChart(a.y, "5d", "5m"); intra[a.id] = {t:now, rows:d.rows}; }
    catch(e){ intra[a.id] = {t:now, rows:[], err:true}; }
  }
}

async function fetchStatementSource(src){
  const c = st.cache[src.key];
  if(c && Date.now() - c.t < 5 * 60000) return c.items;
  let raw;
  if(src.kind === "gnews"){
    const u = "https://news.google.com/rss/search?q=" + enc(src.q + " when:3d") + "&hl=en-US&gl=US&ceid=US:en";
    raw = (await fetchFeed(u)).value;
  }else{
    raw = (await fetchFeed(src.url)).value;
  }
  const items = [];
  raw.forEach(function(i){
    let text;
    if(src.kind === "truth") text = (i.desc || i.title || "").trim();
    else if(src.kind === "feed") text = (cleanTitle(i.title, i.source) + (i.desc ? ". " + i.desc : "")).trim();
    else text = cleanTitle(i.title, i.source);
    text = text.replace(/\s+/g, " ").trim();
    if(src.kind === "truth" && (/^RT[: ]/i.test(text) || text.length < 50 || /^https?:\/\/\S+$/.test(text))) return;
    if(text.length < 20) return;
    items.push({key:src.key, who:src.who, title:text.slice(0, 120), text:text.slice(0, 600), link:i.link, source: src.kind === "truth" ? "تروث سوشال" : (i.source || src.label), date:i.date || 0});
  });
  st.cache[src.key] = {t:Date.now(), items:items};
  return items;
}

async function collectStatements(){
  const srcs = st.key === "all" ? ST_SOURCES : ST_SOURCES.filter(function(s){ return s.key === st.key; });
  const diag = [];
  const all = [];
  const queue = srcs.slice();
  async function worker(){
    while(queue.length){
      const s = queue.shift();
      try{ (await fetchStatementSource(s)).forEach(function(i){ all.push(i); }); }
      catch(e){ (e.details || [e.message]).slice(0, 3).forEach(function(d){ diag.push(s.label + " → " + d); }); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const weekAgo = Date.now() - 7 * 86400000;
  let items = dedupeNews(all.filter(function(i){ return !i.date || i.date >= weekAgo; }))
    .sort(function(a, b){ return b.date - a.date; }).slice(0, 30);
  items.forEach(function(i){ i.an = analyzeStatement(i.text); });
  return {items:items, diag:diag};
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}

function reactionHtml(item){
  const age = Date.now() - item.date;
  if(!item.date) return "زمان انتشار مشخص نیست.";
  if(age < 30 * 60000) return "هنوز کمتر از ۳۰ دقیقه از انتشار گذشته؛ واکنش بازار بعداً محاسبه می‌شود.";
  const L = function(v, c){ return '<span class="ltr ' + c + '">' + v + "</span>"; };
  const parts = [];
  REACT_ASSETS.forEach(function(a){
    const d = intra[a.id];
    if(!d || !d.rows || !d.rows.length) return;
    const p30 = reactionPct(d.rows, item.date, 30 * 60000);
    const p60 = age >= 60 * 60000 ? reactionPct(d.rows, item.date, 60 * 60000) : null;
    if(p30 == null && p60 == null) return;
    parts.push('<span class="tag">' + a.name + " " + (p30 != null ? L(fmtPct(p30), dirOf(p30)) : "—") +
      " / " + (p60 != null ? L(fmtPct(p60), dirOf(p60)) : "—") + "</span>");
  });
  if(!parts.length) return "داده‌ی قیمت برای آن زمان در دسترس نیست (مثلاً بازار بسته بوده یا مدت زیادی گذشته).";
  return "واکنش قیمت (۳۰ دقیقه / ۶۰ دقیقه پس از انتشار): " + parts.join(" ");
}

function buildStatementCard(item){
  const a = item.an;
  const card = el("div", "st-card");
  const head = el("div", "st-head");
  head.appendChild(el("span", "st-who", item.who));
  const right = el("span", "st-time");
  const badge = el("span", "badge " + a.importance.level, a.importance.label);
  right.appendChild(badge);
  right.appendChild(document.createTextNode(" · " + (item.source || "") + " · " + relTime(item.date)));
  head.appendChild(right);
  card.appendChild(head);

  const fa = el("div", "st-fa", "در حال ترجمه...");
  card.appendChild(fa);

  const chips = el("div", "st-chips");
  a.topics.forEach(function(t){ chips.appendChild(el("span", "tag", t.fa)); });
  if(chips.children.length) card.appendChild(chips);

  const an = el("div", "st-analysis");
  const sum = el("div", null, "تحلیل میرزا: " + a.summary);
  an.appendChild(sum);
  a.topics.slice(0, 2).forEach(function(t){ an.appendChild(el("div", "small-note", "• " + t.note)); });
  const rx = el("div", "rx");
  rx.innerHTML = reactionHtml(item);
  an.appendChild(rx);
  card.appendChild(an);

  const orig = el("details", "st-orig");
  orig.appendChild(el("summary", null, "متن اصلی و لینک"));
  orig.appendChild(el("p", null, item.text));
  const link = el("a", null, "مشاهده‌ی منبع");
  link.href = safeLink(item.link); link.target = "_blank"; link.rel = "noopener noreferrer";
  link.style.color = "#e7c461";
  orig.appendChild(link);
  card.appendChild(orig);

  return {card:card, fa:fa, rx:rx};
}

async function loadStatements(){
  const id = ++st.reqId;
  const list = $("stList");
  $("stStatus").textContent = "در حال دریافت...";
  list.innerHTML = '<div class="news-loading"><div class="spinner"></div>در حال دریافت و تحلیل...</div>';
  const res = await collectStatements();
  if(id !== st.reqId) return;
  let items = res.items;
  const onlyMarket = $("stOnlyMarket").checked;
  const hidden = onlyMarket ? items.filter(function(i){ return !i.an.topics.length; }).length : 0;
  if(onlyMarket) items = items.filter(function(i){ return i.an.topics.length; });
  items = items.slice(0, 12);

  if(!items.length){
    list.innerHTML = "";
    const box = el("div", "news-loading", "مورد تازه‌ای پیدا نشد یا منابع پاسخ ندادند.");
    if(res.diag.length){
      const det = el("details"); det.appendChild(el("summary", null, "جزئیات فنی"));
      const ul = el("ul"); res.diag.slice(0, 12).forEach(function(d){ ul.appendChild(el("li", null, d)); });
      det.appendChild(ul); box.appendChild(det);
    }
    list.appendChild(box);
    $("stStatus").textContent = "بدون نتیجه";
    return;
  }

  list.innerHTML = "";
  const built = items.map(function(it){ const b = buildStatementCard(it); list.appendChild(b.card); return b; });
  $("stStatus").textContent = items.length + " مورد" + (hidden ? " · " + hidden + " مورد نامرتبط پنهان شد" : "") + " · " + faHM.format(new Date());

  /* ترجمه (۳ درخواست هم‌زمان) */
  const queue = items.map(function(it, i){ return i; });
  async function tw(){
    while(queue.length){
      const i = queue.shift();
      try{ built[i].fa.textContent = await translateFa(items[i].text); }
      catch(e){ built[i].fa.textContent = "ترجمه‌ی خودکار انجام نشد؛ متن اصلی را در بخش پایین ببینید."; }
    }
  }
  const trJob = Promise.all([tw(), tw(), tw()]);

  /* واکنش بازار */
  await loadIntraday();
  if(id !== st.reqId) return;
  items.forEach(function(it, i){ built[i].rx.innerHTML = reactionHtml(it); });
  await trJob;
}

function buildStatementUI(){
  const box = $("stChips");
  box.innerHTML = "";
  const all = [{key:"all", label:"🇺🇸 همه"}].concat(ST_SOURCES.map(function(s){ return {key:s.key, label:s.label}; }));
  all.forEach(function(s){
    const b = el("button", "chip-btn" + (s.key === st.key ? " active" : ""), s.label);
    b.type = "button";
    b.addEventListener("click", function(){
      st.key = s.key;
      Array.from(box.children).forEach(function(x){ x.classList.toggle("active", x === b); });
      loadStatements();
    });
    box.appendChild(b);
  });
  $("stOnlyMarket").addEventListener("change", loadStatements);
  $("stRefresh").addEventListener("click", function(){ st.cache = {}; loadStatements(); });
    }
