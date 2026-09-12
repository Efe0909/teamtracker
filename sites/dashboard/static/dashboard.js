/* Masaustu davranislari. Satir ici <script> yerine dosya: CSP'de
   script-src 'self' kalabilsin, 'unsafe-inline' gerekmesin. */
/* Vanilla toplam ~15 satir: ray vurgusu, akis kaydirma, kayit formu acma. */
document.body.addEventListener('click', e => {
  const b = e.target.closest('.rbtn[data-mode]');
  if (b) { document.querySelectorAll('.rbtn').forEach(x => x.classList.remove('on')); b.classList.add('on'); }
  const r = e.target.closest('.rec');
  if (r) { document.querySelectorAll('.rec').forEach(x => x.classList.remove('on')); r.classList.add('on'); }
  const t = e.target.closest('[data-toggle]');
  if (t) document.querySelector(t.dataset.toggle)?.classList.toggle('on');
});
/* Form temizleme ve ek iliştirme ORTAK: shared/static/ortak.js. */
function feedBottom(){ const f = document.getElementById('feed'); if (f) f.scrollTop = f.scrollHeight; }
document.body.addEventListener('htmx:afterSwap', feedBottom);
window.addEventListener('load', feedBottom);
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
// (ayni parca mobil.js'te de var: iki yuz ayni sozlugu okuyor)

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
