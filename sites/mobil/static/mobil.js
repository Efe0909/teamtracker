/* Mobil davranislari. Satir ici <script> yerine dosya: CSP'de
   script-src 'self' kalabilsin, 'unsafe-inline' gerekmesin. */
/* Vanilla toplam ~10 satir: service worker kaydi + akis dibine kaydirma. */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
/* Acilista basligi kesmemek icin kaydirma yok; yeni mesaj gelince dibe in. */
document.body.addEventListener("htmx:afterSwap", e => {
  if (e.target.id === "feed") window.scrollTo({ top: document.body.scrollHeight });
});
/* Gonderilen form temizlenir. hx-on= yerine burada: CSP'de 'unsafe-eval' istemiyoruz. */
document.body.addEventListener("htmx:afterRequest", e => {
  const f = e.target.closest("form");
  if (f && e.detail.successful) f.reset();
});
