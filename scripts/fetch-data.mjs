// عکس فوری داده‌ی بازارها برای سایت میرزا (اجرا در گیت‌هاب اکشن؛ Node 20+ )
// خروجی: data/charts/<id>.json (نمودار روزانه‌ی حدود یک سال) و data/quotes.json (آخرین قیمت‌ها)
// اگر برای یک بازار هیچ منبعی جواب ندهد، فایل قبلی همان بازار دست‌نخورده می‌ماند.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT_DIR || path.join(root, "data");
const YAHOO = process.env.YAHOO_BASE || "https://query1.finance.yahoo.com";
const STOOQ = process.env.STOOQ_BASE || "https://stooq.com";
const FRANK = process.env.FRANK_BASE || "https://api.frankfurter.app";
const CG = process.env.CG_BASE || "https://api.coingecko.com";
const UA = "Mozilla/5.0 (compatible; mirza-data-bot/1.0)";

const MARKETS = vm.runInNewContext(fs.readFileSync(path.join(root, "config.js"), "utf8") + "\n;MARKETS", {});

async function getText(url, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
const num = (x) => (x == null || x === "" || !Number.isFinite(+x) ? null : +x);
const r4 = (x) => Math.round(x * 1e6) / 1e6;

async function yahoo(m) {
  const j = JSON.parse(await getText(`${YAHOO}/v8/finance/chart/${encodeURIComponent(m.y)}?range=1y&interval=1d&includePrePost=false`));
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error("yahoo: بدون داده");
  const q = res.indicators.quote[0], rows = [];
  res.timestamp.forEach((ts, i) => {
    const c = num(q.close[i]); if (c == null) return;
    rows.push([ts * 1000, r4(num(q.open[i]) ?? c), r4(num(q.high[i]) ?? c), r4(num(q.low[i]) ?? c), r4(c), Math.round(num(q.volume[i]) || 0)]);
  });
  return { source: "Yahoo Finance", lineOnly: false, rows };
}
async function stooq(m) {
  if (!m.s) throw new Error("stooq: نماد ندارد");
  const d = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const now = Date.now();
  const txt = await getText(`${STOOQ}/q/d/l/?s=${encodeURIComponent(m.s)}&i=d&d1=${d(now - 370 * 864e5)}&d2=${d(now + 864e5)}`);
  const rows = [];
  txt.trim().split(/\r?\n/).slice(1).forEach((ln) => {
    const p = ln.split(","); const t = Date.parse(p[0] + "T00:00:00Z"); const c = num(p[4]);
    if (!Number.isFinite(t) || c == null) return;
    rows.push([t, r4(num(p[1]) ?? c), r4(num(p[2]) ?? c), r4(num(p[3]) ?? c), r4(c), Math.round(num(p[5]) || 0)]);
  });
  if (rows.length < 2) throw new Error("stooq: بدون داده");
  return { source: "Stooq", lineOnly: false, rows };
}
async function frankfurter(m) {
  if (!m.fx) throw new Error("frankfurter: جفت‌ارز ندارد");
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const j = JSON.parse(await getText(`${FRANK}/${iso(Date.now() - 370 * 864e5)}..${iso(Date.now())}?from=${m.fx[0]}&to=${m.fx[1]}`));
  const rows = Object.keys(j.rates || {}).sort().map((day) => {
    const c = r4(j.rates[day][m.fx[1]]); return [Date.parse(day + "T00:00:00Z"), c, c, c, c, 0];
  });
  if (rows.length < 2) throw new Error("frankfurter: بدون داده");
  return { source: "frankfurter", lineOnly: true, rows };
}
async function coingecko(id, label) {
  const j = JSON.parse(await getText(`${CG}/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`));
  const rows = (j.prices || []).map((p) => { const c = r4(p[1]); return [p[0], c, c, c, c, 0]; });
  if (rows.length < 2) throw new Error("coingecko: بدون داده");
  return { source: label, lineOnly: true, rows };
}

async function fetchMarket(m) {
  const steps = [
    ["yahoo", () => yahoo(m)], ["stooq", () => stooq(m)], ["frankfurter", () => frankfurter(m)],
    ["coingecko", () => (m.cg ? coingecko(m.cg, "CoinGecko") : Promise.reject(new Error("cg: ندارد")))],
    ["paxg", () => (m.cgAlt ? coingecko(m.cgAlt, "CoinGecko PAXG (جایگزین طلا)") : Promise.reject(new Error("paxg: ندارد")))],
  ];
  const errs = [];
  for (const [name, fn] of steps) {
    try { const r = await fn(); if (r.rows.length >= 2) return r; } catch (e) { errs.push(name + ": " + e.message); }
  }
  throw new Error(errs.join(" | "));
}

fs.mkdirSync(path.join(OUT, "charts"), { recursive: true });
let old = {};
try { old = JSON.parse(fs.readFileSync(path.join(OUT, "quotes.json"), "utf8")).markets || {}; } catch {}
const quotes = { ...old }; let ok = 0, fail = 0;

for (const m of MARKETS) {
  try {
    const r = await fetchMarket(m);
    const body = JSON.stringify({ id: m.id, symbol: m.sym, source: r.source, lineOnly: r.lineOnly, updated: r.rows[r.rows.length - 1][0], rows: r.rows });
    fs.writeFileSync(path.join(OUT, "charts", m.id + ".json"), body);
    const n = r.rows.length, last = r.rows[n - 1], prev = n > 1 ? r.rows[n - 2][4] : null;
    quotes[m.id] = { price: last[4], prev, hi: last[2], lo: last[3], t: last[0], source: r.source };
    ok++; console.log("ok  ", m.id, r.source, n + " ردیف");
  } catch (e) { fail++; console.warn("FAIL", m.id, e.message); }
}
fs.writeFileSync(path.join(OUT, "quotes.json"), JSON.stringify({ updated: new Date().toISOString(), markets: quotes }));
console.log(`تمام شد: ${ok} موفق، ${fail} ناموفق`);
if (ok === 0) process.exit(1);   // هیچ منبعی جواب نداد؛ چیزی commit نشود
