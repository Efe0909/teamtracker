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

/* --- veri yonetimi agaci: katlama + akilli arama -------------------------
 *
 * NEDEN ISTEMCIDE: satirlarin hepsi zaten DOM'da (duz liste, Euler turu
 * sirasinda) ve hiyerarsi data-id/data-parent'ta duruyor. Her ok tiklamasi
 * icin sunucuya gitmek ayni agaci ikinci kez kurmak olurdu; TreeIndex zaten
 * surec belleginde, bir de tarayicida kopyasini tutmuyoruz — yalnizca ust
 * baglantisini okuyup gorunurluk hesapliyoruz.
 *
 * DURUM SWAP'I ASAR: agac her dugum degisikliginden sonra htmx ile bastan
 * ciziliyor (hx-target="#agac"). Acik dallar bu yuzden DOM'da degil burada,
 * modul kapsaminda bir kumede duruyor — yoksa her kaydetmeden sonra agac
 * kokune katlanir ve kullanici yerini kaybederdi.
 */
(function () {
  var acik = new Set();          // acik (expanded) dugum kimlikleri
  var arama = "";

  function satirlar() { return document.querySelectorAll("#agac .tnode"); }

  /* Kokten bu dugume kadar butun ustleri — gorunurluk kararinin girdisi. */
  function ustler(el, ustOf) {
    var yol = [], p = el.dataset.parent;
    while (p && ustOf[p]) { yol.push(p); p = ustOf[p].dataset.parent; }
    return yol;
  }

  function ciz() {
    var hepsi = satirlar();
    if (!hepsi.length) return;
    var ustOf = {};
    hepsi.forEach(function (el) { ustOf[el.dataset.id] = el; });

    /* Arama varken kume ESLESENLER + onlarin butun ustleri: bir dal yalnizca
       icinde eslesme varsa acilir ("akilli fold"). Aramasiz halde kural daha
       basit — yalniz kokler, gerisi kullanicinin actigi kadar. */
    var gorunur = null;
    if (arama) {
      gorunur = new Set();
      hepsi.forEach(function (el) {
        if ((el.dataset.name || "").toLocaleLowerCase("tr").indexOf(arama) === -1) return;
        gorunur.add(el.dataset.id);
        ustler(el, ustOf).forEach(function (id) { gorunur.add(id); acik.add(id); });
      });
    }

    var bulundu = 0;
    hepsi.forEach(function (el) {
      var id = el.dataset.id;
      /* Butun ustleri acik olmayan satir cizilmez — tek bir kapali ata
         altindaki her sey kapanir, derinlik farketmez. */
      var kapaliAta = ustler(el, ustOf).some(function (p) { return !acik.has(p); });
      var goster = gorunur ? gorunur.has(id) && !kapaliAta : !kapaliAta;
      el.hidden = !goster;
      if (goster) bulundu++;

      var ok = el.querySelector(":scope > .trow > .tkol[data-fold]");
      if (ok) {
        var a = acik.has(id);
        ok.textContent = a ? "▾" : "▸";
        ok.setAttribute("aria-expanded", a ? "true" : "false");
      }
    });

    var bos = document.querySelector("#agac .tbos");
    if (bos) bos.hidden = !(arama && bulundu === 0);
  }

  document.body.addEventListener("click", function (e) {
    var ok = e.target.closest("#agac .tkol[data-fold]");
    if (!ok) return;
    e.preventDefault();
    var id = ok.closest(".tnode").dataset.id;
    if (acik.has(id)) acik.delete(id); else acik.add(id);
    ciz();
  });

  document.body.addEventListener("input", function (e) {
    if (!e.target.closest("#agac-ara")) return;
    arama = e.target.value.trim().toLocaleLowerCase("tr");
    ciz();
  });

  /* "Hepsini ac / kapat": derin bir yapida tek tek tiklamak iskence. */
  document.body.addEventListener("click", function (e) {
    var b = e.target.closest("[data-tree-all]");
    if (!b) return;
    if (b.dataset.treeAll === "open") {
      satirlar().forEach(function (el) { acik.add(el.dataset.id); });
    } else {
      acik.clear();
    }
    ciz();
  });

  /* Agac her yazmadan sonra bastan ciziliyor: durumu yeni DOM'a yeniden uygula. */
  document.body.addEventListener("htmx:afterSwap", function (e) {
    if (e.target.id === "agac" || e.target.querySelector?.("#agac")) ciz();
  });
  document.addEventListener("DOMContentLoaded", ciz);
})();

/* --- tablo satir secimi --------------------------------------------------
 * Kutular bir uca BAGLI DEGIL: toplu islem henuz tanimlanmadi. Burada olan
 * tek sey secimi gorunur kilmak (kac satir) ve "hepsini sec" kutusunu satir
 * kutularina bagli tutmak. Toplu islem geldiginde eklenecek yer .secserit,
 * kolonun kendisi degil.
 *
 * Durum DOM'da (checked), ayri bir kumede degil: tablo htmx ile bastan
 * ciziliyor ve secim o tazelemeden sagkalmamali — filtre degisince ekranda
 * olmayan satirlar "secili" kalirsa toplu islem gormedigin satiri vurur.
 */
(function () {
  function say() {
    var tablo = document.getElementById("sonuc");
    if (!tablo) return;
    var kutular = tablo.querySelectorAll("[data-sec]");
    var secili = tablo.querySelectorAll("[data-sec]:checked").length;
    var serit = tablo.querySelector(".secserit");
    if (serit) {
      serit.hidden = secili === 0;
      serit.querySelector(".secsay").textContent = secili;
    }
    var hepsi = tablo.querySelector("[data-sec-all]");
    if (hepsi) {
      hepsi.checked = secili > 0 && secili === kutular.length;
      hepsi.indeterminate = secili > 0 && secili < kutular.length;
    }
  }

  document.body.addEventListener("change", function (e) {
    if (e.target.matches("[data-sec-all]")) {
      document.querySelectorAll("#sonuc [data-sec]").forEach(function (k) {
        k.checked = e.target.checked;
      });
      say();
    } else if (e.target.matches("[data-sec]")) {
      say();
    }
  });

  document.body.addEventListener("click", function (e) {
    if (!e.target.closest("[data-sec-clear]")) return;
    document.querySelectorAll("#sonuc [data-sec],#sonuc [data-sec-all]").forEach(function (k) {
      k.checked = false;
    });
    say();
  });

  document.body.addEventListener("htmx:afterSwap", say);
})();
