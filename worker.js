/* =========================================================
   Cloudflare Worker: سرویس واسط شخصی و رایگان برای سایت میرزا
   نصب (حدود ۵ دقیقه):
   ۱) به dash.cloudflare.com بروید و ثبت‌نام (رایگان) کنید.
   ۲) Workers & Pages  ←  Create  ←  Create Worker  ←  Deploy
   ۳) Edit code را بزنید، همه‌ی محتوای پیش‌فرض را پاک و این فایل را جایگزین کنید، Deploy.
   ۴) آدرس Worker را کپی کنید، مثلاً  https://mirza-proxy.myname.workers.dev
   ۵) در فایل config.js این خط را به این شکل بنویسید (انتهای آدرس /?url= باشد):
        const MY_PROXY = "https://mirza-proxy.myname.workers.dev/?url=";
   فقط به دامنه‌های فهرست‌شده‌ی پایین اجازه می‌دهد، پس برای دیگران «پروکسی باز» نیست.
========================================================= */
const ALLOWED = [
  "query1.finance.yahoo.com", "query2.finance.yahoo.com", "stooq.com",
  "news.google.com", "feeds.bbci.co.uk", "rss.dw.com", "parsi.euronews.com",
  "www.federalreserve.gov", "www.whitehouse.gov", "www.trumpstruth.org",
  "call1.tgju.org", "call5.tgju.org", "api.worldbank.org", "translate.googleapis.com"
];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get("url");
    if (!target) return new Response("missing ?url=", { status: 400, headers: CORS });

    let t;
    try { t = new URL(target); } catch (e) { return new Response("bad url", { status: 400, headers: CORS }); }
    if (t.protocol !== "https:" || ALLOWED.indexOf(t.hostname) === -1) {
      return new Response("host not allowed: " + t.hostname, { status: 403, headers: CORS });
    }

    try {
      const upstream = await fetch(t.toString(), {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; MirzaProxy/1.0)",
          "accept": "application/json, text/xml, application/xml, text/csv, */*"
        },
        cf: { cacheTtl: 45, cacheEverything: true }
      });
      const headers = new Headers(CORS);
      headers.set("content-type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
      headers.set("cache-control", "public, max-age=45");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (e) {
      return new Response("upstream error: " + e.message, { status: 502, headers: CORS });
    }
  }
};
