/* EkipTakip service worker.
 *
 * Iki isi var:
 *   1. Ana ekrana eklenen uygulamanin kabugu (offline'da bos beyaz sayfa yerine mesaj).
 *   2. Web push girisi — Faz 3'te sunucu tarafi baglanacak (02-push-handoff.md).
 *      VAPID anahtarlari .env'de kalir, buraya gomulmez.
 */
const CACHE = "ekiptakip-v1";
const SHELL = ["/static/app.css", "/static/mobile.css", "/static/htmx.min.js", "/static/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

/* Sayfa istekleri: once ag, kopmussa onbellek. Veri bayat gosterilmez —
   sunucu erisilemiyorsa acikca soyleriz. */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => new Response(
      "<meta charset=utf-8><style>body{font:15px -apple-system,sans-serif;color:#7d75a0;" +
      "background:#f4f1fb;padding:48px 24px;text-align:center}</style>" +
      "<p>Bağlantı yok.<br>Sunucuya ulaşınca bu sayfa kendine gelir.</p>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

/* --- Faz 3: web push -------------------------------------------------- */

self.addEventListener("push", (e) => {
  let d = { title: "EkipTakip", body: "Yeni bir hareket var.", url: "/m/bildirimler" };
  try { d = Object.assign(d, e.data ? e.data.json() : {}); } catch (_) { /* duz metin */ }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "/static/icon-192.png", badge: "/static/icon-192.png",
    data: { url: d.url }, tag: d.tag,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/m";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (w.url.includes(url) && "focus" in w) return w.focus();
    return self.clients.openWindow(url);
  }));
});
