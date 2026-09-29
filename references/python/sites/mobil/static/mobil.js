/* Mobil davranislari. Satir ici <script> yerine dosya: CSP'de
   script-src 'self' kalabilsin, 'unsafe-inline' gerekmesin. */
/* Vanilla toplam ~10 satir: service worker kaydi + akis dibine kaydirma. */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
/* Acilista basligi kesmemek icin kaydirma yok; yeni mesaj gelince dibe in. */
document.body.addEventListener("htmx:afterSwap", e => {
  if (e.target.id === "feed") window.scrollTo({ top: document.body.scrollHeight });
});
/* Form temizleme ve ek iliştirme ORTAK: shared/static/ortak.js. */

/* --- web push abonelıgı (spec/40-push.md) ------------------------------
 *
 * Otomatik degil, OTOMATIGE EN YAKIN: izin zaten verilmisse sessizce abone
 * olunur, kullaniciya hicbir sey sorulmaz. Verilmemisse tek dokunusluk bir
 * dugme cikar — tarayici izin penceresini yalnizca kullanici hareketinden
 * sonra aciyor, bu sunucudan atlatilamaz.
 *
 * iOS ek sart: uygulama once ANA EKRANA EKLENMELI. Safari sekmesinde
 * Notification API'si yok; dugmeyi orada gostermek "calismiyor" hissi
 * yaratir, o yuzden hic gostermiyoruz.
 */
(async function push() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission === "denied") return;          // kullanici kapatmis

  const keys = await fetch("/vapid")
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!keys) return;                                          // push kurulmamis (503)

  const registration = await navigator.serviceWorker.ready;

  async function subscribe() {
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,                                  // tarayici sart kosuyor
      applicationServerKey: b64ToBytes(keys.publicKey),
    });
    // Sunucuya HER acilista yollanir: abonelik tarayicida dururken sunucudaki
    // satir silinmis olabilir (olu diye budanmis, veritabani sifirlanmis).
    // Upsert oldugu icin tekrar gondermek zararsiz.
    await fetch("/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify(subscription),
    });
  }

  if (Notification.permission === "granted") { subscribe().catch(() => {}); return; }

  // Izin yok: kullanici hareketi bekleyen kucuk bir dugme.
  const d = document.createElement("button");
  d.className = "pushbtn";
  d.textContent = "Bildirimleri aç";
  d.addEventListener("click", async () => {
    d.disabled = true;
    if (await Notification.requestPermission() === "granted") {
      await subscribe().catch(() => {});
      d.remove();
    } else { d.remove(); }                                    // reddettiyse israr etme
  });
  document.body.appendChild(d);

  function csrfToken() {
    try { return JSON.parse(document.body.getAttribute("hx-headers"))["X-CSRF-Token"]; }
    catch (_) { return ""; }
  }
  /* applicationServerKey ham bayt ister; anahtar b64url metin olarak geliyor. */
  function b64ToBytes(s) {
    const padded = (s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  }
})();

// --- etiket sozlugu: datalist'i TEK SEFER doldur --------------------------
// Her balon icin degil, ilk odaklanmada bir kez: sozluk sayfa omru boyunca
// degismiyor. hx-on= yok (CSP unsafe-eval istemiyor) — delege dinleyici.
(function () {
  var loaded = false;
  document.body.addEventListener("focusin", function (e) {
    if (loaded || !e.target.closest(".tag-add input")) return;
    loaded = true;
    fetch("/tags", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var dl = document.getElementById("tag-list");
        if (!d || !dl) return;
        dl.innerHTML = "";
        d.tags.forEach(function (t) {
          var o = document.createElement("option");
          o.value = t.name;
          dl.appendChild(o);
        });
      })
      .catch(function () { loaded = false; });   // yeniden denenebilsin
  });
})();

/* Yazma istegi BASARISIZ olunca kullanici GORSUN.

   htmx 4xx/5xx'te hicbir sey swap etmez (responseHandling varsayilani) ve
   sunucunun mesaji JSON govdede kalirdi: kullanici "Gonder"e basiyor, hicbir
   sey olmuyordu — ne mesaj gidiyor ne bir uyari cikiyor (issue #23; yayinda
   medya dizini yazilamadigi icin her ekli mesaj 500 aliyordu).

   Bicim JS icinde: iki sitenin CSS'ine ayni kurallari kopyalamamak icin. */
function ekipUyari(text) {
  var el = document.getElementById("uyari-serit");
  if (!el) {
    el = document.createElement("div");
    el.id = "uyari-serit";
    el.setAttribute("role", "alert");
    el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
      "z-index:9999;max-width:min(92vw,440px);padding:11px 15px;border-radius:10px;" +
      "background:#e5484d;color:#fff;font:500 13px/1.45 system-ui,sans-serif;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer";
    el.addEventListener("click", function () { el.remove(); });
    document.body.appendChild(el);
  }
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.remove(); }, 7000);
}

document.body.addEventListener("htmx:responseError", function (e) {
  var x = e.detail.xhr, msg = "";
  try { msg = (JSON.parse(x.responseText) || {}).detail || ""; } catch (_) { /* JSON degil */ }
  if (!msg) msg = x.status === 413 ? "Dosya çok büyük." : "İşlem başarısız (HTTP " + x.status + ").";
  ekipUyari(msg);
});

/* Ag koptu / sunucuya ulasilamadi: responseError bu durumda ATESLENMEZ. */
document.body.addEventListener("htmx:sendError", function () {
  ekipUyari("Sunucuya ulaşılamadı. Bağlantını kontrol et.");
});
