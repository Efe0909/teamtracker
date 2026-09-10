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
/* Gonderilen form temizlenir. hx-on= yerine burada: CSP'de 'unsafe-eval' istemiyoruz.
   YALNIZCA yazan formlar (POST): filtre cubugu da bir form ve hx-get ile calisiyor,
   GET'ler de temizlenirse her filtre degisiminden sonra secimler "Hepsi"ye doner —
   URL ve tablo dogru kalir, gorunen durum yalan soyler. */
document.body.addEventListener('htmx:afterRequest', e => {
  if ((e.detail.requestConfig?.verb || '').toLowerCase() === 'get') return;
  const f = e.target.closest('form');
  if (f && e.detail.successful) {
    f.reset();
    f.querySelectorAll('.fname').forEach(s => { s.textContent = ''; });
  }
});
/* Ek dosya secilince ad, atas kilibin (.attach) icindeki .fname'de gorunur —
   "takildi mi?" hicbir zaman soru olmasin. hx-on= degil, burada: yukarida. */
document.body.addEventListener('change', e => {
  const inp = e.target.closest('.attach input[type=file]');
  if (!inp) return;
  const span = inp.closest('.attach')?.querySelector('.fname');
  if (span) span.textContent = inp.files[0]?.name || '';
});
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
