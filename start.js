"use strict";
/* =========================================================
   رویدادها و راه‌اندازی
========================================================= */
fillSelector();
buildNewsChips();

$("chartSelector").addEventListener("change", function(){
  if(this.value === "custom") return;
  selectMarket(this.value, false);
});
$("chartPeriod").addEventListener("change", function(){ chart.period = this.value; loadChart(); });
$("chartMode").addEventListener("change", function(){ chart.mode = this.value; drawChart(); });
$("optSma20").addEventListener("change", function(){ chart.sma20 = this.checked; drawChart(); });
$("optSma50").addEventListener("change", function(){ chart.sma50 = this.checked; drawChart(); });
$("optVolume").addEventListener("change", function(){ chart.volume = this.checked; drawChart(); });
$("customSymbolBtn").addEventListener("click", loadCustomSymbol);
$("customSymbol").addEventListener("keydown", function(e){ if(e.key === "Enter") loadCustomSymbol(); });
$("reloadChartBtn").addEventListener("click", loadChart);
$("csvBtn").addEventListener("click", downloadCSV);
$("refreshQuotesBtn").addEventListener("click", function(){ refreshQuotes(); });

/* کلیک روی کارت‌ها و ردیف‌های جدول */
document.addEventListener("click", function(e){
  const el = e.target.closest("[data-chart]");
  if(el) selectMarket(el.dataset.chart, true);
});
document.addEventListener("keydown", function(e){
  if((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("market-card")){
    e.preventDefault();
    selectMarket(e.target.dataset.chart, true);
  }
});

/* منوی فعال هنگام اسکرول */
const navLinks = document.querySelectorAll("[data-target]");
const sectionIds = ["home","pulse","iran","chart","news","statements","countries","markets","analysis"];
function setActive(id){
  navLinks.forEach(function(a){ a.classList.toggle("active", a.dataset.target === id); });
}
if("IntersectionObserver" in window){
  const obs = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting) setActive(en.target.id); });
  }, {rootMargin:"-30% 0px -60% 0px"});
  sectionIds.forEach(function(id){ const el = $(id); if(el) obs.observe(el); });
}

/* رویدادهای بخش‌های جدید */
buildCountryUI();
buildStatementUI();
$("cIndicator").addEventListener("change", function(){ cs.ind = this.value; saveCountries(); loadCountries(); });
$("cFrom").addEventListener("change", function(){ cs.from = parseInt(this.value, 10); saveCountries(); loadCountries(); });
$("cBase").addEventListener("change", function(){ cs.base = this.value; saveCountries(); loadCountries(); });
$("cIndex").addEventListener("change", function(){ cs.index = this.checked; drawLines(); updateCLegend(); $("cLinesTitle").textContent = "روند " + (cs.index ? "(شاخص، سال پایه = ۱۰۰): " : ": ") + curInd().name; });
$("cHorizon").value = String(cs.h);
$("cHorizon").addEventListener("change", function(){ cs.h = parseInt(this.value, 10); saveCountries(); loadCountries(); });
$("cCsv").addEventListener("click", downloadCountriesCsv);
$("cReload").addEventListener("click", function(){ wbCache.real = null; loadCountries(); });
$("manualUsdBtn").addEventListener("click", function(){
  const v = parseFloat(String($("manualUsd").value).replace(/[^\d.]/g, ""));
  if(!(v >= 1000)){ $("iranStatus").textContent = "نرخ دلار را به تومان و درست وارد کنید (مثلاً 100000)"; return; }
  manualUsd = v;
  try{ localStorage.setItem("mirza_manual_usd", String(v)); }catch(e){}
  renderIran();
});
$("iranRefreshBtn").addEventListener("click", refreshIran);
if(manualUsd) $("manualUsd").value = String(manualUsd);
if("ResizeObserver" in window){
  new ResizeObserver(function(){ drawBars(); drawLines(); }).observe($("cLinesBox"));
}

/* لوگو: چند اسم رایج امتحان می‌شود تا فایل پیدا شود */
(function initLogo(){
  const img = $("logoImg");
  const list = [LOGO_FILE, "logo.png", "Logo.png", "LOGO.png", "logo.PNG", "Logo.PNG", "logo.jpg", "logo.jpeg", "logo.webp", "logo.svg",
                "images/logo.png", "assets/logo.png", "img/logo.png"].filter(Boolean);
  let i = 0;
  function next(){
    if(i >= list.length){
      console.warn("لوگو پیدا نشد. اسم فایل را در ثابت LOGO_FILE بنویسید. امتحان‌شده:", list.join(", "));
      return;
    }
    img.src = list[i++];
  }
  img.addEventListener("load", function(){
    img.hidden = false;
    if(!LOGO_SHOW_TEXT) $("logoText").style.display = "none";
    try{
      let ic = document.querySelector('link[rel="icon"]');
      if(!ic){ ic = document.createElement("link"); ic.rel = "icon"; document.head.appendChild(ic); }
      ic.href = img.src;
    }catch(e){}
  });
  img.addEventListener("error", next);
  next();
})();

/* شروع (با فاصله‌ی زمانی تا سرویس‌ها زیر فشار نروند) */
renderQuotes();
updateQuotesStatus();
resizeCanvas();
refreshQuotes();
loadChart();
loadNews();
setTimeout(refreshIran, 1500);
setTimeout(loadCountries, 2500);
setTimeout(loadStatements, 4000);

/* به‌روزرسانی خودکار */
setInterval(refreshQuotes, 60 * 1000);
setInterval(function(){ if(chart.period === "1D" || chart.period === "5D") loadChart(); }, 5 * 60 * 1000);
setInterval(loadNews, 10 * 60 * 1000);
setInterval(refreshIran, 2 * 60 * 1000);
setInterval(loadStatements, 10 * 60 * 1000);
