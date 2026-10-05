"use strict";
/* =========================================================
   اخبار فارسی
========================================================= */
const NEWS_CATEGORIES = [
  {key:"latest", icon:"⚡", title:"تازه‌ترین",
   queries:["اقتصاد","بازار","دلار","طلا","نفت","بورس"],
   keywords:["اقتصاد","بازار","دلار","طلا","سکه","نفت","بورس","سهام","ارز","بانک","تورم","قیمت","تحریم","بیت کوین","نرخ","بودجه","فدرال رزرو","ترامپ"]},
  {key:"iran", icon:"🇮🇷", title:"اقتصاد ایران",
   queries:["اقتصاد ایران","تورم ایران","بانک مرکزی ایران"],
   keywords:["اقتصاد","تورم","بانک مرکزی","بودجه","یارانه","ریال","مالیات","صادرات","واردات","رشد اقتصادی","نقدینگی","بانک","وزیر اقتصاد","بازار"]},
  {key:"bourse", icon:"📈", title:"بورس ایران",
   queries:["بورس تهران","شاخص کل بورس","بازار سهام ایران"],
   keywords:["بورس","شاخص کل","سهام","فرابورس","سهامدار","بازار سرمایه","نماد","شاخص"]},
  {key:"fx", icon:"🪙", title:"طلا و ارز",
   queries:["قیمت دلار","قیمت طلا","قیمت سکه"],
   keywords:["دلار","طلا","سکه","ارز","یورو","نرخ ارز","بازار ارز","اونس","درهم","طلای"]},
  {key:"crypto", icon:"₿", title:"ارز دیجیتال",
   queries:["بیت کوین","ارز دیجیتال","اتریوم"],
   keywords:["بیت کوین","بیت‌کوین","بیتکوین","ارز دیجیتال","ارزهای دیجیتال","رمزارز","رمز ارز","اتریوم","کریپتو","بلاکچین","تتر","ماینینگ"]},
  {key:"world", icon:"🌍", title:"اقتصاد جهان",
   queries:["اقتصاد جهان","اقتصاد آمریکا","فدرال رزرو","اقتصاد چین"],
   keywords:["اقتصاد جهان","اقتصاد آمریکا","فدرال رزرو","اقتصاد چین","بانک مرکزی اروپا","تعرفه","صندوق بین‌المللی پول","بانک جهانی","تورم","رکود","آمریکا","چین","اروپا"]},
  {key:"politics", icon:"🏛", title:"سیاست و اقتصاد",
   queries:["تحریم اقتصادی ایران","سیاست اقتصادی دولت","مذاکرات هسته‌ای"],
   keywords:["تحریم","برجام","مذاکرات","دولت","مجلس","سیاست","وزیر","بودجه","فتف","اقتصاد"]},
  {key:"oil", icon:"🛢", title:"نفت و انرژی",
   queries:["قیمت نفت","اوپک","گاز و انرژی"],
   keywords:["نفت","اوپک","برنت","انرژی","گاز","بنزین","پالایشگاه","نفتی","سوخت"]},
  {key:"markets", icon:"💹", title:"بازارهای جهانی",
   queries:["وال استریت","بازارهای مالی جهان","شاخص داوجونز"],
   keywords:["وال استریت","داوجونز","نزدک","اس اند پی","بازارهای مالی","بورس نیویورک","سهام","شاخص","فدرال رزرو","اوراق"]}
];

/* خبرگزاری‌های فارسی‌زبان برای تکمیل نتایج */
const EXTRA_FEEDS = [
  {name:"بی‌بی‌سی فارسی", url:"https://feeds.bbci.co.uk/persian/rss.xml"},
  {name:"دویچه‌وله فارسی", url:"https://rss.dw.com/xml/rss-per-all"},
  {name:"یورونیوز فارسی", url:"https://parsi.euronews.com/rss"}
];

const newsList = $("newsList");
const news = {key:"latest", title:"تازه‌ترین", custom:"", reqId:0};

function stripHtml(s){
  if(!s) return "";
  const d = new DOMParser().parseFromString(s, "text/html");
  return (d.body.textContent || "").replace(/\s+/g, " ").trim();
}

function parseRSS(text){
  const xml = new DOMParser().parseFromString(text, "text/xml");
  if(xml.querySelector("parsererror")) throw new Error("فرمت RSS نامعتبر");
  const items = Array.from(xml.querySelectorAll("item")).map(function(item){
    const get = function(tag){
      const n = item.querySelector(tag);
      return n ? n.textContent.trim() : "";
    };
    const gt = function(tag){ const n = item.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ""; };
    return {title:get("title"), link:get("link"), source:get("source"), date:parseDate(get("pubDate")),
            desc:stripHtml(gt("content:encoded") || gt("description"))};
  });
  if(!items.length) throw new Error("خبری در فید نیست");
  return items;
}

function rss2jsonJob(rssUrl){
  return timeoutFetch("https://api.rss2json.com/v1/api.json?rss_url=" + enc(rssUrl), 9000)
    .then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(j){
      if(j.status !== "ok" || !j.items || !j.items.length) throw new Error("بدون خبر");
      return {via:"rss2json", value:j.items.map(function(i){
        return {title:i.title, link:i.link, source:i.author || (j.feed && j.feed.title) || "", date:parseDate(i.pubDate), desc:stripHtml(i.description || "")};
      })};
    })
    .catch(function(e){ throw new Error("rss2json: " + shortErr(e)); });
}

function fetchFeed(url){
  return fetchRace(url, parseRSS, [rss2jsonJob(url)], 9000);
}

function googleNewsUrl(q){
  return "https://news.google.com/rss/search?q=" + enc(q) + "&hl=fa&gl=IR&ceid=IR:fa";
}

function toPersian(items, defaultSource){
  return dedupeNews(items.map(function(i){
    const src = i.source || defaultSource || "";
    return {title:cleanTitle(i.title, src), link:i.link, source:src, date:i.date};
  }).filter(function(i){ return i.title && isPersianText(i.title); }));
}

async function collectNews(cat, custom){
  const diag = [];
  let items = [];
  const via = [];
  const query = custom
    ? custom
    : cat.queries.map(function(q){ return '"' + q + '"'; }).join(" OR ");

  /* ۱) گوگل‌نیوز فارسی */
  for(const q of [query + " when:1d", query + " when:7d"]){
    try{
      const r = await fetchFeed(googleNewsUrl(q));
      const fa = toPersian(r.value, "");
      if(fa.length > items.length){ items = fa; via.length = 0; via.push("گوگل‌نیوز (" + r.via + ")"); }
      if(fa.length >= 8) break;
    }catch(e){
      (e.details || [e.message]).forEach(function(d){ diag.push("گوگل‌نیوز → " + d); });
    }
  }

  /* مرتبط‌سازی با دسته */
  const kws = custom ? custom.split(/\s+/).filter(function(w){ return w.length > 1; }) : cat.keywords;
  if(items.length){
    const matched = items.filter(function(i){ return matchesKeywords(i.title, kws); });
    if(matched.length >= 4 || custom) items = matched.length ? matched : items;
  }

  /* ۲) خبرگزاری‌های فارسی؛ فقط خبرهای مرتبط */
  if(items.length < 5){
    const jobs = EXTRA_FEEDS.map(function(f){
      return fetchFeed(f.url).then(function(r){ return {f:f, r:r}; }).catch(function(e){
        (e.details || [e.message]).forEach(function(d){ diag.push(f.name + " → " + d); });
        return null;
      });
    });
    const results = await Promise.all(jobs);
    results.forEach(function(x){
      if(!x) return;
      const fa = toPersian(x.r.value, x.f.name).filter(function(i){ return matchesKeywords(i.title, kws); });
      if(fa.length){ items = items.concat(fa); via.push(x.f.name); }
    });
  }

  items = dedupeNews(items).sort(function(a, b){ return b.date - a.date; }).slice(0, 20);
  return {items:items, via:via, diag:diag};
}

const rtf = typeof Intl.RelativeTimeFormat === "function" ? new Intl.RelativeTimeFormat("fa", {numeric:"auto"}) : null;
function relTime(ms){
  if(!ms) return "";
  const diff = (ms - Date.now()) / 1000;
  const a = Math.abs(diff);
  if(!rtf) return fDayY.format(new Date(ms));
  if(a < 60) return "لحظاتی پیش";
  if(a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if(a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if(a < 7 * 86400) return rtf.format(Math.round(diff / 86400), "day");
  return fDayY.format(new Date(ms));
}

function cacheGet(key){ try{ return JSON.parse(localStorage.getItem("mirza_news_v3_" + key)); }catch(e){ return null; } }
function cacheSet(key, items){ try{ localStorage.setItem("mirza_news_v3_" + key, JSON.stringify(items)); }catch(e){} }
function safeLink(u){ return /^https?:\/\//i.test(u) ? u : "#"; }

function renderNews(items, title, note){
  newsList.innerHTML = "";
  if(note){
    const n = document.createElement("div");
    n.className = "news-note"; n.textContent = note;
    newsList.appendChild(n);
  }
  items.forEach(function(it){
    const a = document.createElement("a");
    a.className = "news-item";
    a.href = safeLink(it.link); a.target = "_blank"; a.rel = "noopener noreferrer";

    const c = document.createElement("div"); c.className = "news-category"; c.textContent = title;
    const h = document.createElement("div"); h.className = "news-title"; h.textContent = it.title;
    const meta = document.createElement("div"); meta.className = "news-meta";
    const s1 = document.createElement("span"); s1.textContent = it.source || "منبع نامشخص";
    const s2 = document.createElement("span"); s2.textContent = relTime(it.date);
    meta.append(s1, s2);

    a.append(c, h, meta);
    newsList.appendChild(a);
  });
}

function renderNewsEmpty(title, diag){
  newsList.innerHTML = "";
  const box = document.createElement("div");
  box.className = "news-loading";
  box.appendChild(document.createTextNode("خبر فارسی مرتبط با «" + title + "» پیدا نشد یا سرویس اخبار پاسخ نمی‌دهد."));
  box.appendChild(document.createElement("br"));
  const btn = document.createElement("button");
  btn.className = "btn small"; btn.type = "button"; btn.textContent = "تلاش مجدد";
  btn.addEventListener("click", function(){ loadNews(); });
  box.appendChild(btn);
  if(diag && diag.length){
    const det = document.createElement("details");
    const sum = document.createElement("summary"); sum.textContent = "جزئیات فنی";
    const ul = document.createElement("ul");
    diag.slice(0, 14).forEach(function(d){ const li = document.createElement("li"); li.textContent = d; ul.appendChild(li); });
    det.append(sum, ul); box.appendChild(det);
  }
  newsList.appendChild(box);
}

async function loadNews(){
  const id = ++news.reqId;
  const cat = NEWS_CATEGORIES.find(function(c){ return c.key === news.key; });
  const title = news.custom ? "جستجو: " + news.custom : cat.title;
  $("newsCategoryLabel").textContent = title;
  $("newsStatus").textContent = "";
  newsList.innerHTML = '<div class="news-loading"><div class="spinner"></div>در حال دریافت اخبار «' + title.replace(/</g, "&lt;") + "»...</div>";

  const cacheKey = news.custom ? "q_" + news.custom : cat.key;
  const res = await collectNews(cat, news.custom);
  if(id !== news.reqId) return;

  if(res.items.length){
    cacheSet(cacheKey, res.items);
    renderNews(res.items, news.custom ? "جستجو" : cat.title);
    $("newsStatus").textContent = res.items.length + " خبر · منبع: " + res.via.join("، ") + " · " + faHM.format(new Date());
    return;
  }
  const cached = cacheGet(cacheKey);
  if(cached && cached.length){
    renderNews(cached, news.custom ? "جستجو" : cat.title, "اتصال برقرار نشد؛ آخرین اخبار ذخیره‌شده نمایش داده می‌شود.");
    $("newsStatus").textContent = cached.length + " خبر ذخیره‌شده";
    return;
  }
  renderNewsEmpty(title, res.diag);
}

function buildNewsChips(){
  const box = $("newsChips");
  box.innerHTML = "";
  NEWS_CATEGORIES.forEach(function(c){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-btn" + (c.key === news.key && !news.custom ? " active" : "");
    b.dataset.key = c.key;
    b.textContent = c.icon + " " + c.title;
    b.addEventListener("click", function(){
      news.key = c.key; news.custom = "";
      $("newsSearchInput").value = "";
      Array.from(box.children).forEach(function(x){ x.classList.toggle("active", x === b); });
      loadNews();
    });
    box.appendChild(b);
  });
}

$("newsSearchForm").addEventListener("submit", function(e){
  e.preventDefault();
  const q = $("newsSearchInput").value.trim();
  if(!q) return;
  news.custom = q;
  Array.from($("newsChips").children).forEach(function(x){ x.classList.remove("active"); });
  loadNews();
});
