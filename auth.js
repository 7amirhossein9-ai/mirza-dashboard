"use strict";
/* =========================================================
   ورود، ثبت‌نام و حضور آنلاین در تالار
   اگر API_BASE در config.js خالی باشد، همه‌چیز خاموش است و تالار مثل قبل آزاد باز می‌شود.
========================================================= */
(function(){
const API = (typeof API_BASE === "string" ? API_BASE : "").replace(/\/+$/, "");
const CONTACT = typeof ADMIN_CONTACT === "string" ? ADMIN_CONTACT : "";
const AVATARS = [
  {id:"m_suit", ic:"🧑‍💼", t:"آقا، کت‌وشلوار"},
  {id:"m_casual", ic:"🧔", t:"آقا، لباس روزمره"},
  {id:"t_qajar", ic:"🎩", t:"آقا، قبای قاجاری"},
  {id:"t_bakhtiari", ic:"🏔", t:"آقا، بختیاری"},
  {id:"t_bazaari", ic:"👳", t:"آقا، بازاری با عبا"},
  {id:"f_blazer", ic:"👩‍💼", t:"خانم، کت و دامن"},
  {id:"f_manteau", ic:"👩", t:"خانم، مانتو"},
  {id:"f_scarf", ic:"🧕", t:"خانم، مانتو و روسری"},
  {id:"t_chador", ic:"🖤", t:"خانم، چادر مشکی"},
  {id:"t_floral", ic:"🌸", t:"خانم، چادر گل‌دار"},
  {id:"t_lori", ic:"🌈", t:"خانم، لباس لری"}
];
const KEY = "mirza_tok", UKEY = "mirza_user";
let token = null, user = null, afterLogin = null;
try{ token = localStorage.getItem(KEY); user = JSON.parse(localStorage.getItem(UKEY) || "null"); }catch(e){}
if(!token) user = null;

function $(id){ return document.getElementById(id); }
function el(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }

async function api(path, opt){
  opt = opt || {};
  const ctl = new AbortController(), to = setTimeout(function(){ ctl.abort(); }, opt.timeout || 15000);
  const headers = {"content-type":"application/json"};
  if(token) headers.authorization = "Bearer " + token;
  try{
    const res = await fetch(API + path, {method:opt.body ? "POST" : "GET", headers:headers, body:opt.body ? JSON.stringify(opt.body) : undefined, signal:ctl.signal});
    let j = null; try{ j = await res.json(); }catch(e){}
    if(!j) return {ok:false, error:"پاسخ سرور خوانده نشد (کد " + res.status + ")."};
    j.status = res.status; return j;
  }catch(e){
    return {ok:false, error:"ارتباط با سرور برقرار نشد؛ اینترنت را بررسی کنید.", net:true};
  }finally{ clearTimeout(to); }
}
function save(t, u){
  token = t; user = u;
  try{ if(t){ localStorage.setItem(KEY, t); localStorage.setItem(UKEY, JSON.stringify(u)); } else { localStorage.removeItem(KEY); localStorage.removeItem(UKEY); } }catch(e){}
}

/* ---------- پنجره‌ی ورود ---------- */
let modal = null, tab = "login", pickedAv = "m_suit";
function build(){
  modal = el("div", "auth"); modal.id = "authModal"; modal.hidden = true;
  const card = el("div", "auth-card");
  const close = el("button", "auth-x", "✕"); close.type = "button"; close.setAttribute("aria-label", "بستن");
  close.addEventListener("click", hide);
  const h = el("h2", "auth-h", "ورود به تالار میرزا");
  const sub = el("p", "auth-sub", "برای قدم زدن در تالار و دیده شدن به‌عنوان یک آدم، وارد شوید یا ثبت‌نام کنید.");
  const tabs = el("div", "auth-tabs");
  [["login", "ورود"], ["signup", "ثبت‌نام"], ["activate", "کد فعال‌سازی"]].forEach(function(t){
    const b = el("button", "auth-tab", t[1]); b.type = "button"; b.dataset.tab = t[0];
    b.addEventListener("click", function(){ setTab(t[0]); });
    tabs.appendChild(b);
  });
  const msg = el("div", "auth-msg"); msg.id = "authMsg"; msg.setAttribute("role", "status");
  const form = el("form", "auth-form"); form.id = "authForm"; form.setAttribute("novalidate", "");
  form.addEventListener("submit", function(ev){ ev.preventDefault(); submit(); });
  card.appendChild(close); card.appendChild(h); card.appendChild(sub); card.appendChild(tabs); card.appendChild(msg); card.appendChild(form);
  modal.appendChild(card);
  modal.addEventListener("mousedown", function(ev){ if(ev.target === modal) hide(); });
  document.body.appendChild(modal);
}
function field(name, label, type, opts){
  opts = opts || {};
  const w = el("label", "auth-f"); w.appendChild(el("span", "", label));
  const i = document.createElement("input"); i.name = name; i.type = type; i.autocomplete = opts.ac || "off"; i.required = true;
  if(opts.ltr) i.dir = "ltr"; if(opts.inputmode) i.inputMode = opts.inputmode; if(opts.max) i.maxLength = opts.max; if(opts.ph) i.placeholder = opts.ph;
  w.appendChild(i); return w;
}
function avatarGrid(selected, onPick){
  const g = el("div", "auth-avs"); pickedAv = selected || pickedAv;
  AVATARS.forEach(function(a){
    const b = el("button", "auth-av" + (a.id === pickedAv ? " on" : "")); b.type = "button"; b.dataset.id = a.id;
    b.appendChild(el("span", "ic", a.ic)); b.appendChild(el("span", "tx", a.t));
    b.addEventListener("click", function(){ pickedAv = a.id; Array.prototype.forEach.call(g.children, function(c){ c.classList.toggle("on", c === b); }); if(onPick) onPick(a.id); });
    g.appendChild(b);
  });
  return g;
}
function setMsg(text, kind){ const m = $("authMsg"); if(!m) return; m.textContent = text || ""; m.className = "auth-msg" + (text ? " show " + (kind || "") : ""); }
function setTab(t, keep){
  tab = t;
  Array.prototype.forEach.call(modal.querySelectorAll(".auth-tab"), function(b){ b.classList.toggle("on", b.dataset.tab === t); });
  const f = $("authForm"), prevEmail = f.elements.email ? f.elements.email.value : "";
  f.textContent = "";
  f.appendChild(field("email", "ایمیل", "email", {ltr:true, ac:"email", ph:"name@example.com"}));
  if(t === "signup"){
    f.appendChild(field("name", "نام کاربری (بالای سر آدمک شما نوشته می‌شود)", "text", {max:20, ac:"nickname"}));
    f.appendChild(field("password", "رمز (دست‌کم ۸ نویسه)", "password", {ltr:true, ac:"new-password"}));
    f.appendChild(el("div", "auth-lab", "آدمک خود را انتخاب کنید"));
    f.appendChild(avatarGrid(pickedAv));
  }else if(t === "login"){
    f.appendChild(field("password", "رمز", "password", {ltr:true, ac:"current-password"}));
  }else{
    f.appendChild(field("password", "رمزی که هنگام ثبت‌نام گذاشتید", "password", {ltr:true, ac:"current-password"}));
    f.appendChild(field("code", "کد فعال‌سازی (شش رقم)", "text", {ltr:true, inputmode:"numeric", max:8, ph:"123456"}));
  }
  const go = el("button", "btn big auth-go", t === "login" ? "ورود" : t === "signup" ? "ثبت‌نام" : "فعال‌سازی و ورود"); go.type = "submit"; go.id = "authGo";
  f.appendChild(go);
  if(prevEmail) f.elements.email.value = prevEmail;
  if(!keep) setMsg("");
  const note = el("p", "auth-note");
  if(t === "signup") note.textContent = "پس از ثبت‌نام، مدیر سایت یک کد فعال‌سازی برای شما می‌فرستد. فقط یک بار آن را وارد می‌کنید.";
  else if(t === "activate") note.textContent = CONTACT ? "کد را از مدیر سایت بگیرید: " + CONTACT : "کد را مدیر سایت برای شما می‌فرستد.";
  else note.textContent = "اگر تازه ثبت‌نام کرده‌اید و کد گرفته‌اید، از تب «کد فعال‌سازی» استفاده کنید.";
  f.appendChild(note);
  const first = f.querySelector("input"); if(first && !("ontouchstart" in window)) setTimeout(function(){ first.focus(); }, 30);
}
async function submit(){
  const f = $("authForm"), v = function(n){ return f.elements[n] ? f.elements[n].value.trim() : ""; };
  const btn = $("authGo"); if(btn.disabled) return;
  const email = v("email"), pw = f.elements.password ? f.elements.password.value : "";
  if(!email || !pw){ setMsg("ایمیل و رمز را کامل وارد کنید.", "err"); return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = "لطفاً صبر کنید…"; setMsg("");
  let r;
  try{
    if(tab === "signup"){
      r = await api("/register", {body:{email:email, name:v("name"), password:pw, avatar:pickedAv}});
      if(r.ok){ setTab("activate"); const ef = $("authForm").elements.email; ef.value = email; setMsg("ثبت‌نام انجام شد. مدیر سایت کد فعال‌سازی را برای شما می‌فرستد؛ بعد از دریافت، رمز و کد را همین‌جا وارد کنید." + (CONTACT ? " تماس: " + CONTACT : ""), "ok"); return; }
    }else if(tab === "login"){
      r = await api("/login", {body:{email:email, password:pw}});
      if(!r.ok && r.needActivation){ setTab("activate"); $("authForm").elements.email.value = email; setMsg(r.error, "err"); return; }
    }else{
      r = await api("/activate", {body:{email:email, password:pw, code:v("code")}});
    }
    if(r.ok && r.token){ save(r.token, r.user); const cb = afterLogin; hide(); mountChip(); if(cb) cb(); return; }
    setMsg(r.error || "خطای ناشناخته.", "err");
  }finally{ btn.disabled = false; btn.textContent = old; }
}
function show(cb, startTab){
  if(!modal) build();
  afterLogin = cb || null;
  modal.hidden = false; document.body.classList.add("auth-open");
  setTab(startTab || "login");
}
function hide(){ if(modal) modal.hidden = true; document.body.classList.remove("auth-open"); afterLogin = null; }

/* ---------- دسترسی برای تالار ---------- */
function isIn(){ return !!(token && user); }
function need(cb){
  if(!API){ cb(); return; }
  if(isIn()){
    cb();
    api("/me").then(function(r){ if(r.status === 401){ logout(true); } else if(r.ok){ user = r.user; try{ localStorage.setItem(UKEY, JSON.stringify(user)); }catch(e){} } });
    return;
  }
  show(cb);
}
async function logout(silent){
  if(token){ try{ await api("/logout", {body:{}, timeout:5000}); }catch(e){} }
  save(null, null); online.stop();
  const c = $("hallUser"); if(c && c.parentNode) c.parentNode.removeChild(c);
  if(window.MirzaHall && MirzaHall.isOpen && MirzaHall.isOpen()){ MirzaHall.close(); }
  if(silent) show(null, "login");
}

/* ---------- نوار کاربر داخل تالار ---------- */
function mountChip(){
  const top = document.querySelector(".hall-top"); if(!top || !user) return;
  let c = $("hallUser"); if(c) c.parentNode.removeChild(c);
  c = el("div", "hall-user"); c.id = "hallUser";
  c.appendChild(el("span", "hall-user-n", "👤 " + user.name));
  const ch = el("button", "btn small secondary", "تغییر آدمک"); ch.type = "button";
  ch.addEventListener("click", function(){ openAvatarPicker(); });
  const out = el("button", "btn small secondary", "خروج از حساب"); out.type = "button";
  out.addEventListener("click", function(){ logout(false); });
  c.appendChild(ch); c.appendChild(out);
  top.insertBefore(c, top.firstChild);
}
function openAvatarPicker(){
  if(!modal) build();
  modal.hidden = false; document.body.classList.add("auth-open");
  Array.prototype.forEach.call(modal.querySelectorAll(".auth-tab"), function(b){ b.hidden = true; });
  const f = $("authForm"); f.textContent = ""; setMsg("");
  pickedAv = user.avatar;
  f.appendChild(el("div", "auth-lab", "آدمک جدیدتان را انتخاب کنید"));
  f.appendChild(avatarGrid(pickedAv));
  const go = el("button", "btn big auth-go", "ذخیره"); go.type = "submit"; go.id = "authGo"; f.appendChild(go);
  const done = function(){ Array.prototype.forEach.call(modal.querySelectorAll(".auth-tab"), function(b){ b.hidden = false; }); };
  f.onsubmit = async function(ev){
    ev.preventDefault(); go.disabled = true;
    const r = await api("/avatar", {body:{avatar:pickedAv}});
    go.disabled = false;
    if(r.ok){ user.avatar = pickedAv; try{ localStorage.setItem(UKEY, JSON.stringify(user)); }catch(e){} f.onsubmit = null; done(); hide(); }
    else setMsg(r.error || "ذخیره نشد.", "err");
  };
  modal.querySelector(".auth-x").addEventListener("click", function once(){ done(); f.onsubmit = null; modal.querySelector(".auth-x").removeEventListener("click", once); });
}

/* ---------- حضور آنلاین ---------- */
const online = {
  timer:null, lastSent:0, lastPose:null, busy:false,
  start:function(){
    if(!API || !isIn() || online.timer) return;
    online.lastSent = 0; online.lastPose = null;
    online.tick(); online.timer = setInterval(online.tick, 1800);
  },
  stop:function(){
    if(online.timer && isIn()){ api("/leave", {body:{}, timeout:4000}); }
    clearInterval(online.timer); online.timer = null;
    if(window.MirzaCrowd && MirzaCrowd.clearRemotes) MirzaCrowd.clearRemotes();
  },
  tick:async function(){
    if(online.busy || document.hidden || !isIn() || !window.MirzaHall || !MirzaHall.getPose) return;
    online.busy = true;
    try{
      const p = MirzaHall.getPose(), now = Date.now(), lp = online.lastPose;
      const moved = lp ? Math.hypot(p.x - lp.x, p.z - lp.z) : 99, turned = lp ? Math.abs(p.yaw - lp.yaw) : 99;
      const body = {};
      if(!lp || moved > 0.12 || turned > 0.12 || now - online.lastSent > 9000){
        body.x = +p.x.toFixed(2); body.z = +p.z.toFixed(2); body.yaw = +p.yaw.toFixed(2); body.mv = moved > 0.12 ? 1 : 0;
        online.lastPose = p; online.lastSent = now;
      }
      const r = await api("/sync", {body:body, timeout:8000});
      if(r.status === 401){ online.stop(); logout(true); return; }
      if(r.ok && window.MirzaCrowd && MirzaCrowd.setRemotes) MirzaCrowd.setRemotes(r.players || []);
    }finally{ online.busy = false; }
  }
};

window.MirzaAuth = {
  enabled:!!API, need:need, show:show, isIn:isIn, logout:logout, mountChip:mountChip, online:online,
  user:function(){ return user; }
};
})();
