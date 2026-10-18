/* =========================================================
   سرور ثبت‌نام و حضور آنلاین سایت میرزا (Cloudflare Worker + پایگاه داده‌ی D1)
   - ثبت‌نام: ایمیل، نام کاربری، رمز (فقط به‌صورت رمزنگاری‌شده ذخیره می‌شود) و آدمک
   - کد فعال‌سازی: مدیر سایت برای هر نفر می‌سازد و خودش می‌فرستد
   - حضور: هر کاربر آنلاین در تالار یک آدم است
   راه‌اندازی: فایل server/README-fa.md
   اتصال‌های لازم در کلودفلر:  D1 با نام متغیر DB   و   متغیر محرمانه‌ی ADMIN_KEY
========================================================= */
const AVATARS = ["m_suit", "m_casual", "t_qajar", "t_bakhtiari", "t_bazaari", "f_blazer", "f_manteau", "f_scarf", "t_chador", "t_floral", "t_lori"];
const ORIGINS = ["https://mirzainfo.ir", "https://www.mirzainfo.ir", "https://7amirhossein9-ai.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const SESSION_DAYS = 30, CODE_DAYS = 7, ONLINE_MS = 25000;
/* تعداد دور رمزنگاری: برای سقف زمان پردازش طرح رایگان کلودفلر (۱۰ میلی‌ثانیه) کم‌تر از معمول است (۱۰ هزار)؛ در طرح پولی می‌توانید ۱۰۰۰۰۰ بگذارید */
const ITER = 10000;

let schemaReady = false;
async function ensureSchema(db){
  if(schemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_lc TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, avatar TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', code TEXT, code_exp INTEGER, code_tries INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (th TEXT PRIMARY KEY, uid INTEGER NOT NULL, exp INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS presence (uid INTEGER PRIMARY KEY, x REAL, z REAL, yaw REAL, mv INTEGER, t INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)")
  ]);
  schemaReady = true;
}

const te = new TextEncoder();
function b64(buf){ let s = ""; const a = new Uint8Array(buf); for(let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
function unb64(s){ const r = atob(s), a = new Uint8Array(r.length); for(let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
function hex(buf){ return Array.from(new Uint8Array(buf)).map(function(x){ return x.toString(16).padStart(2, "0"); }).join(""); }
async function sha256(s){ return hex(await crypto.subtle.digest("SHA-256", te.encode(s))); }
async function pbkdf2(pw, salt, iter){
  iter = iter || ITER;
  const key = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return iter + "$" + b64(await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:salt, iterations:iter}, key, 256));
}
function safeEq(a, b){ if(a.length !== b.length) return false; let r = 0; for(let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

function corsFor(req){
  const o = req.headers.get("origin"), h = {"vary": "Origin"};
  if(o && ORIGINS.indexOf(o) >= 0){
    h["access-control-allow-origin"] = o;
    h["access-control-allow-headers"] = "content-type, authorization, x-admin-key";
    h["access-control-allow-methods"] = "GET, POST, OPTIONS";
    h["access-control-max-age"] = "86400";
  }
  return h;
}
function json(req, data, status){
  return new Response(JSON.stringify(data), {status:status || 200, headers:Object.assign({"content-type":"application/json; charset=utf-8", "cache-control":"no-store"}, corsFor(req))});
}
function fail(req, msg, status, extra){ return json(req, Object.assign({ok:false, error:msg}, extra || {}), status || 400); }

function cleanName(n){
  n = String(n || "").replace(/\s+/g, " ").trim();
  if(n.length < 3 || n.length > 20) return null;
  if(!/^[؀-ۿa-zA-Z0-9_ .\-‌]+$/.test(n)) return null;
  return n;
}
function cleanEmail(e){
  e = String(e || "").trim().toLowerCase();
  if(e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}
function pubUser(u){ return {id:u.id, name:u.name, email:u.email, avatar:u.avatar, status:u.status}; }

async function limited(db, key, max, windowMs){
  const now = Date.now();
  const r = await db.prepare("SELECT n, t FROM rl WHERE k = ?").bind(key).first();
  if(!r || now - r.t > windowMs){
    await db.prepare("INSERT INTO rl (k, n, t) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, t = excluded.t").bind(key, now).run();
    return false;
  }
  if(r.n >= max) return true;
  await db.prepare("UPDATE rl SET n = n + 1 WHERE k = ?").bind(key).run();
  return false;
}
async function newSession(db, uid){
  const tok = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare("INSERT INTO sessions (th, uid, exp) VALUES (?, ?, ?)").bind(await sha256(tok), uid, Date.now() + SESSION_DAYS * 86400000).run();
  await db.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(Date.now(), uid).run();
  return tok;
}
async function authUser(db, req){
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer ([a-f0-9]{64})$/.exec(h);
  if(!m) return null;
  const row = await db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.uid WHERE s.th = ? AND s.exp > ? AND u.status = 'active'").bind(await sha256(m[1]), Date.now()).first();
  return row || null;
}
function isAdmin(req, env){
  const k = req.headers.get("x-admin-key") || "";
  return !!env.ADMIN_KEY && env.ADMIN_KEY.length >= 8 && safeEq(k, env.ADMIN_KEY);
}

async function body(req){ try{ const t = await req.text(); if(t.length > 4000) return {}; return JSON.parse(t) || {}; }catch(e){ return {}; } }

async function checkPassword(db, user, password){
  const it = parseInt(String(user.hash).split("$")[0], 10) || ITER;
  const h = await pbkdf2(password, unb64(user.salt), it);
  return safeEq(h, user.hash);
}
async function loginCommon(req, db, email, password, ip){
  if(await limited(db, "login:" + ip, 40, 600000)) return {err:fail(req, "تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کنید.", 429)};
  const u = email ? await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
  if(!u){ await pbkdf2(String(password), new Uint8Array(16)); return {err:fail(req, "ایمیل یا رمز اشتباه است.", 401)}; }
  if(u.lock_until > Date.now()) return {err:fail(req, "به‌خاطر چند رمز اشتباه، حساب چند دقیقه قفل شد.", 429)};
  if(!(await checkPassword(db, u, String(password)))){
    const f = u.fails + 1;
    await db.prepare("UPDATE users SET fails = ?, lock_until = ? WHERE id = ?").bind(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 600000 : 0, u.id).run();
    return {err:fail(req, "ایمیل یا رمز اشتباه است.", 401)};
  }
  if(u.fails) await db.prepare("UPDATE users SET fails = 0, lock_until = 0 WHERE id = ?").bind(u.id).run();
  return {user:u};
}

async function handle(req, env){
  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  if(req.method === "OPTIONS") return new Response(null, {status:204, headers:corsFor(req)});
  if(path === "/" || path === "/ping") return json(req, {ok:true, service:"mirza-auth"});
  if(!env.DB) return fail(req, "پایگاه داده‌ی D1 به Worker وصل نشده است (نام متغیر باید DB باشد).", 500);
  const db = env.DB;
  await ensureSchema(db);
  const ip = req.headers.get("cf-connecting-ip") || "0";

  /* ---------- عمومی ---------- */
  if(path === "/register" && req.method === "POST"){
    const b = await body(req);
    const email = cleanEmail(b.email), name = cleanName(b.name), pw = String(b.password || ""), av = String(b.avatar || "");
    if(!email) return fail(req, "ایمیل درست نیست.");
    if(!name) return fail(req, "نام کاربری باید ۳ تا ۲۰ نویسه (حروف فارسی یا انگلیسی، عدد، فاصله، _ یا -) باشد.");
    if(pw.length < 8 || pw.length > 100) return fail(req, "رمز باید دست‌کم ۸ نویسه باشد.");
    if(AVATARS.indexOf(av) < 0) return fail(req, "آدمک انتخاب‌شده معتبر نیست.");
    if(await limited(db, "reg:" + ip, 8, 3600000)) return fail(req, "ثبت‌نام‌های پیاپی؛ کمی بعد دوباره امتحان کنید.", 429);
    const ex = await db.prepare("SELECT email, name_lc FROM users WHERE email = ? OR name_lc = ?").bind(email, name.toLowerCase()).first();
    if(ex) return fail(req, ex.email === email ? "این ایمیل قبلاً ثبت شده است؛ وارد شوید." : "این نام کاربری قبلاً گرفته شده است؛ نام دیگری انتخاب کنید.", 409);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(pw, salt);
    await db.prepare("INSERT INTO users (email, name, name_lc, salt, hash, avatar, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").bind(email, name, name.toLowerCase(), b64(salt), hash, av, Date.now()).run();
    return json(req, {ok:true, status:"pending"});
  }
  if(path === "/activate" && req.method === "POST"){
    const b = await body(req);
    const email = cleanEmail(b.email), code = String(b.code || "").replace(/\D/g, "");
    const r = await loginCommon(req, db, email, b.password || "", ip);
    if(r.err) return r.err;
    const u = r.user;
    if(u.status === "active") return json(req, {ok:true, token:await newSession(db, u.id), user:pubUser(u)});
    if(!u.code || u.code_exp < Date.now()) return fail(req, "برای این ایمیل کد فعالی وجود ندارد یا مهلتش تمام شده؛ از مدیر سایت کد تازه بخواهید.", 403);
    if(u.code_tries >= 6) return fail(req, "تعداد تلاش برای کد تمام شد؛ از مدیر سایت کد تازه بخواهید.", 403);
    if(!safeEq(code, u.code)){
      await db.prepare("UPDATE users SET code_tries = code_tries + 1 WHERE id = ?").bind(u.id).run();
      return fail(req, "کد اشتباه است.", 403);
    }
    await db.prepare("UPDATE users SET status = 'active', code = NULL, code_exp = NULL, code_tries = 0 WHERE id = ?").bind(u.id).run();
    u.status = "active";
    return json(req, {ok:true, token:await newSession(db, u.id), user:pubUser(u)});
  }
  if(path === "/login" && req.method === "POST"){
    const b = await body(req);
    const r = await loginCommon(req, db, cleanEmail(b.email), b.password || "", ip);
    if(r.err) return r.err;
    const u = r.user;
    if(u.status !== "active") return fail(req, "حساب شما هنوز فعال نشده است؛ کد فعال‌سازی را وارد کنید.", 403, {needActivation:true});
    return json(req, {ok:true, token:await newSession(db, u.id), user:pubUser(u)});
  }

  /* ---------- نیازمند ورود ---------- */
  if(path === "/me" || path === "/logout" || path === "/avatar" || path === "/sync" || path === "/leave"){
    const u = await authUser(db, req);
    if(!u) return fail(req, "نشست شما معتبر نیست؛ دوباره وارد شوید.", 401);
    if(path === "/me") return json(req, {ok:true, user:pubUser(u)});
    if(path === "/logout"){
      const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("authorization") || "");
      await db.prepare("DELETE FROM sessions WHERE th = ?").bind(await sha256(m[1])).run();
      await db.prepare("DELETE FROM presence WHERE uid = ?").bind(u.id).run();
      return json(req, {ok:true});
    }
    if(path === "/leave"){
      await db.prepare("DELETE FROM presence WHERE uid = ?").bind(u.id).run();
      return json(req, {ok:true});
    }
    if(path === "/avatar" && req.method === "POST"){
      const b = await body(req), av = String(b.avatar || "");
      if(AVATARS.indexOf(av) < 0) return fail(req, "آدمک معتبر نیست.");
      await db.prepare("UPDATE users SET avatar = ? WHERE id = ?").bind(av, u.id).run();
      return json(req, {ok:true});
    }
    if(path === "/sync" && req.method === "POST"){
      const b = await body(req), now = Date.now();
      if(typeof b.x === "number" && typeof b.z === "number" && isFinite(b.x) && isFinite(b.z)){
        const yaw = typeof b.yaw === "number" && isFinite(b.yaw) ? b.yaw : 0;
        await db.prepare("INSERT INTO presence (uid, x, z, yaw, mv, t) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET x = excluded.x, z = excluded.z, yaw = excluded.yaw, mv = excluded.mv, t = excluded.t").bind(u.id, Math.max(-60, Math.min(60, b.x)), Math.max(-200, Math.min(200, b.z)), yaw, b.mv ? 1 : 0, now).run();
      }else if(b.hb){
        await db.prepare("UPDATE presence SET t = ? WHERE uid = ?").bind(now, u.id).run();
      }
      const rows = await db.prepare("SELECT u.name, u.avatar, p.x, p.z, p.yaw, p.mv FROM presence p JOIN users u ON u.id = p.uid WHERE p.t > ? AND p.uid != ? AND u.status = 'active' ORDER BY p.t DESC LIMIT 60").bind(now - ONLINE_MS, u.id).all();
      return json(req, {ok:true, now:now, players:rows.results || []});
    }
  }

  /* ---------- مدیر ---------- */
  if(path.indexOf("/admin/") === 0){
    if(!isAdmin(req, env)) return fail(req, "کلید مدیر درست نیست.", 401);
    if(path === "/admin/users"){
      const rows = await db.prepare("SELECT u.id, u.email, u.name, u.avatar, u.status, u.code, u.code_exp, u.created_at, u.last_login, (SELECT t FROM presence WHERE uid = u.id) AS seen FROM users u ORDER BY u.id DESC LIMIT 2000").all();
      return json(req, {ok:true, now:Date.now(), users:rows.results || []});
    }
    if(path === "/admin/code" && req.method === "POST"){
      const b = await body(req), id = parseInt(b.id, 10);
      if(!id) return fail(req, "شناسه‌ی کاربر درست نیست.");
      const n = new Uint32Array(1); crypto.getRandomValues(n);
      const code = String(100000 + (n[0] % 900000));
      const r = await db.prepare("UPDATE users SET code = ?, code_exp = ?, code_tries = 0 WHERE id = ? AND status = 'pending'").bind(code, Date.now() + CODE_DAYS * 86400000, id).run();
      if(!r.meta || !r.meta.changes) return fail(req, "این کاربر پیدا نشد یا قبلاً فعال شده است.", 404);
      return json(req, {ok:true, code:code});
    }
    if(path === "/admin/delete" && req.method === "POST"){
      const b = await body(req), id = parseInt(b.id, 10);
      if(!id) return fail(req, "شناسه‌ی کاربر درست نیست.");
      await db.batch([db.prepare("DELETE FROM sessions WHERE uid = ?").bind(id), db.prepare("DELETE FROM presence WHERE uid = ?").bind(id), db.prepare("DELETE FROM users WHERE id = ?").bind(id)]);
      return json(req, {ok:true});
    }
    if(path === "/admin/activate" && req.method === "POST"){
      const b = await body(req), id = parseInt(b.id, 10);
      if(!id) return fail(req, "شناسه‌ی کاربر درست نیست.");
      await db.prepare("UPDATE users SET status = 'active', code = NULL, code_exp = NULL WHERE id = ?").bind(id).run();
      return json(req, {ok:true});
    }
  }
  return fail(req, "آدرس پیدا نشد.", 404);
}

export default {
  async fetch(req, env){
    try{ return await handle(req, env); }
    catch(e){ return new Response(JSON.stringify({ok:false, error:"خطای سرور: " + (e && e.message || e)}), {status:500, headers:Object.assign({"content-type":"application/json; charset=utf-8"}, corsFor(req))}); }
  }
};
