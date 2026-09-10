/* Mobil davranislari. Satir ici <script> yerine dosya: CSP'de
   script-src 'self' kalabilsin, 'unsafe-inline' gerekmesin. */
/* Vanilla toplam ~10 satir: service worker kaydi + akis dibine kaydirma. */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
/* Acilista basligi kesmemek icin kaydirma yok; yeni mesaj gelince dibe in. */
document.body.addEventListener("htmx:afterSwap", e => {
  if (e.target.id === "feed") window.scrollTo({ top: document.body.scrollHeight });
});
/* Gonderilen form temizlenir. hx-on= yerine burada: CSP'de 'unsafe-eval' istemiyoruz.
   YALNIZCA yazan formlar (POST): filtre cubugu da bir form ve hx-get ile calisiyor,
   GET'ler de temizlenirse her filtre degisiminden sonra secimler "Hepsi"ye doner —
   URL ve tablo dogru kalir, gorunen durum yalan soyler. */
document.body.addEventListener("htmx:afterRequest", e => {
  if ((e.detail.requestConfig?.verb || '').toLowerCase() === 'get') return;
  const f = e.target.closest("form");
  if (f && e.detail.successful) {
    f.reset();
    f.querySelectorAll(".fname").forEach(s => { s.textContent = ""; });
  }
});
/* Ek dosya secilince ad, atasi kilibin (.attach) icindeki .fname'de gorunur —
   "takildi mi?" hicbir zaman soru olmasin. hx-on= degil, burada: yukarida. */
document.body.addEventListener("change", e => {
  const inp = e.target.closest(".attach input[type=file]");
  if (!inp) return;
  const span = inp.closest(".attach")?.querySelector(".fname");
  if (span) span.textContent = inp.files[0]?.name || "";
});

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
