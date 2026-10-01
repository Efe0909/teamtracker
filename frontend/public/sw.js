/* EkipTakip service worker: yalniz web push. Onbellek/offline YOK (Vite ciktisi
 * hash'li, kabuk cache'i bayat surum riski tasir). Sunucu yuku: backend
 * api/notify.rs fanout — {title, body, url, tag}; icerik metni tasimaz. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = { title: "EkipTakip", body: "Yeni bir hareket var.", url: "/" };
  try { d = Object.assign(d, e.data ? e.data.json() : {}); } catch (_) { /* duz metin */ }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: d.url }, tag: d.tag, // ayni tag birbirini gunceller, yigilmaz
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (w.url.includes(url) && "focus" in w) return w.focus();
    return self.clients.openWindow(url);
  }));
});
