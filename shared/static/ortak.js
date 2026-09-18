/* Iki yuzun de yukledigi ORTAK davranislar.

   Buraya yalnizca ORTAK sablonlarin (shared/templates/ortak/) ihtiyaci olan
   seyler girer. Ayri ayri dashboard.js ve mobil.js'e yazilsalardi ucuncu bir
   kopya daha olurdu ve biri zamanla digerinden ayrisirdi.

   Satir ici <script> yerine dosya: CSP'de script-src 'self' kalabilsin. */

/* --- alan dialoglari (ortak/alan.html) ---------------------------------
   Dropdown yerine dialog: degisim iki adim, yanlislikla atama bitiyor.
   ACMA burada; KAPANMA cogu zaman kendiliginden oluyor — htmx parcayi
   outerHTML ile degistirince acik <dialog> DOM'dan cikiyor. Geriye yalnizca
   "Vazgec" kaliyor. */
document.body.addEventListener("click", function (e) {
  var open = e.target.closest("[data-dialog]");
  if (open) {
    var dlg = document.getElementById(open.getAttribute("data-dialog"));
    if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    return;
  }
  var close = e.target.closest("[data-dialog-close]");
  if (close) close.closest("dialog")?.close();
});

/* --- ek iptali (kompozer) ----------------------------------------------
   Dosya secildikten sonra vazgecmenin yolu YOKTU: ad gorunuyordu ama
   kaldirilamiyordu, mesaji gondermeden eki birakmak imkansizdi.
   Temizleme dugmesi ETIKETIN DISINDA duruyor — icinde olsaydi tiklamak
   dosya secicisini yeniden acardi (<label> davranisi). */
function ekTemizle(form) {
  form.querySelectorAll(".attach input[type=file]").forEach(function (inp) { inp.value = ""; });
  form.querySelectorAll(".fname").forEach(function (s) { s.textContent = ""; });
  form.querySelectorAll("[data-role=attach-clear]").forEach(function (b) { b.hidden = true; });
}

document.body.addEventListener("change", function (e) {
  var inp = e.target.closest(".attach input[type=file]");
  if (!inp) return;
  var form = inp.closest("form");
  var name = inp.files[0] ? inp.files[0].name : "";
  var span = inp.closest(".attach")?.querySelector(".fname");
  if (span) span.textContent = name;
  var clear = form?.querySelector("[data-role=attach-clear]");
  if (clear) clear.hidden = !name;
});

document.body.addEventListener("click", function (e) {
  var b = e.target.closest("[data-role=attach-clear]");
  if (!b) return;
  e.preventDefault();
  var form = b.closest("form");
  if (form) ekTemizle(form);
});

/* --- gonderilen form temizlenir -----------------------------------------
   hx-on= yerine burada: CSP'de 'unsafe-eval' istemiyoruz.
   YALNIZCA yazan formlar (POST/PATCH/DELETE): filtre cubugu da bir form ve
   hx-get ile calisiyor; GET'ler de temizlenirse her filtre degisiminden sonra
   secimler "Hepsi"ye doner — URL ve tablo dogru kalir, gorunen durum yalan
   soyler. */
document.body.addEventListener("htmx:afterRequest", function (e) {
  if ((e.detail.requestConfig?.verb || "").toLowerCase() === "get") return;
  var f = e.target.closest("form");
  if (f && e.detail.successful) { f.reset(); ekTemizle(f); }
});

/* --- mobil sohbet sayfasi (sag alt balon) ------------------------------
   Kayit ekrani artik alanlar + eylemler + kartlar; sohbet varsayilan olarak
   KAPALI ve balondan aciliyor. Yalnizca bir sinif cevirir — yerlesim CSS'te. */
document.body.addEventListener("click", function (e) {
  var b = e.target.closest("[data-sheet]");
  if (!b) return;
  var el = document.querySelector(b.getAttribute("data-sheet"));
  if (!el) return;
  el.classList.toggle("on");
  document.body.classList.toggle("sheet-on", el.classList.contains("on"));
  if (el.classList.contains("on")) {
    var feed = el.querySelector("#feed");
    if (feed) feed.scrollTop = feed.scrollHeight;
    el.querySelector("input[name=body]")?.focus();
  }
});

/* --- yanit dugmesi (ortak/mesaj.html) -----------------------------------
   Ayri bir yanit tablosu ACMAZ: govdeye yazarin @anahtarini koyup odagi
   kompozere verir. Anma zaten hedefi katilimci kumesinden her seferinde
   cozuyor (KNOW-263) — yanit o mekanizmanin kisayolu, ikinci bir gercek degil.

   Kompozer BU BALONUN yakinindan bulunur, sayfadaki ilk kutudan degil: mobilde
   sohbet ayri bir sayfa (.sheet), masaustunde sag sutun — "en yakin form"
   ikisinde de dogru cevabi veriyor, yerlesimi bilmeye gerek kalmiyor. */
document.body.addEventListener("click", function (e) {
  var b = e.target.closest("[data-reply]");
  if (!b) return;
  e.preventDefault();
  var kok = b.closest(".sheet") || b.closest(".ksag") || document;
  var kutu = kok.querySelector("input[name=body]")
          || document.querySelector("input[name=body]");
  if (!kutu || kutu.disabled) return;
  var etiket = "@" + b.getAttribute("data-reply") + " ";
  /* Ayni kisiye iki kez basmak etiketi iki kez yazmasin. */
  if (kutu.value.indexOf(etiket) === -1) {
    kutu.value = etiket + kutu.value.replace(/^\s+/, "");
  }
  kutu.focus();
  kutu.setSelectionRange(kutu.value.length, kutu.value.length);
});

/* --- tam ekran gorsel (lightbox) ----------------------------------------
   /media/{id} ham dosyayi yeni sekmede aciyordu: ciplak bir resim, geri donus
   yok, aciklama gorunmez. Katman burada kuruluyor; <a href> DURUYOR, yani JS
   calismazsa eski davranis gecerli kalir (ilerlemeli iyilestirme). */
(function () {
  var katman = null;

  function kapat() { if (katman) { katman.remove(); katman = null; } }

  document.body.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-lightbox]");
    if (!a) return;
    /* Yeni sekmede acmak isteyen kullaniciyi engelleme: ctrl/cmd/orta tik
       tarayiciya birakilir. */
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    kapat();

    katman = document.createElement("div");
    katman.className = "lightbox";
    katman.setAttribute("role", "dialog");
    katman.setAttribute("aria-modal", "true");

    var img = document.createElement("img");
    img.src = a.getAttribute("href");
    img.alt = a.querySelector("img")?.alt || "";
    katman.appendChild(img);

    var acik = a.getAttribute("data-caption");
    if (acik) {
      var p = document.createElement("p");
      p.className = "lbacik";
      p.textContent = acik;
      katman.appendChild(p);
    }

    var x = document.createElement("button");
    x.type = "button";
    x.className = "lbkapat";
    x.setAttribute("aria-label", "Kapat");
    x.textContent = "✕";
    katman.appendChild(x);

    /* Zemine ya da ✕'e tiklamak kapatir; resmin kendisine tiklamak kapatmaz —
       yakinlastirmak icin uzerinde gezinmek isteyen olur. */
    katman.addEventListener("click", function (ev) {
      if (ev.target === katman || ev.target === x) kapat();
    });
    document.body.appendChild(katman);
    x.focus();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") kapat();
  });
})();

/* --- @anma otomatik tamamlama (kompozer) --------------------------------
   Anahtarlari EZBERDEN yazmak gerekiyordu: "@ayse" mi "@ayse-yilmaz" mi,
   yanlis yazilan ad sessizce duz metin kaliyordu (mentions.resolve
   bulamadigini metinde birakir). Liste sunucudan bir kez cekilir (/mentions).

   Gruplar (@all/@here/@team) ONDE: en sik kullanilanlar ve yazimlari
   ezberlenmesi gereken tek sey degil — gorunur olmalari ipucu metnini
   gereksiz kiliyor. */
(function () {
  var sozluk = null, yukleniyor = false, kutu = null, pop = null, secili = 0, adaylar = [];

  function yukle() {
    if (sozluk || yukleniyor) return;
    yukleniyor = true;
    fetch("/mentions", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        sozluk = d.groups.concat(d.people);
        /* Sozluk gelene kadar yazilmis bir "@" varsa liste ONUN icin acilsin:
           yoksa kullanici bir tus daha basana kadar hicbir sey gormezdi. */
        if (kutu) ciz();
      })
      .catch(function () { yukleniyor = false; });   // yeniden denenebilsin
  }

  function kapat() { if (pop) { pop.remove(); pop = null; } adaylar = []; }

  /* Imlecin SOLUNDAKI yarim anahtar: "@ay" -> "ay". Bosluk ya da satir basi
     ile baslamayan @ atlanir (e-posta icindeki @ tamamlama acmasin). */
  function parca() {
    if (!kutu) return null;
    var once = kutu.value.slice(0, kutu.selectionStart);
    var m = /(^|\s)@([\w.\-]*)$/.exec(once);
    return m ? { anahtar: m[2].toLocaleLowerCase("tr"), bas: once.length - m[2].length - 1 } : null;
  }

  function ciz() {
    var p = parca();
    if (!p || !sozluk) return kapat();
    adaylar = sozluk.filter(function (k) {
      return !p.anahtar || k.handle.indexOf(p.anahtar) === 0
          || k.name.toLocaleLowerCase("tr").indexOf(p.anahtar) !== -1;
    }).slice(0, 8);
    if (!adaylar.length) return kapat();

    if (!pop) {
      pop = document.createElement("div");
      pop.className = "anmapop";
      kutu.parentNode.insertBefore(pop, kutu.nextSibling);
    }
    if (secili >= adaylar.length) secili = 0;
    pop.innerHTML = "";
    adaylar.forEach(function (k, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "anmasat" + (i === secili ? " on" : "");
      b.dataset.handle = k.handle;
      b.innerHTML = '<b>@' + k.handle + "</b>";
      var s = document.createElement("span");
      s.textContent = k.name;
      b.appendChild(s);
      if (k.color) b.style.borderLeft = "3px solid " + k.color;
      pop.appendChild(b);
    });
  }

  function sec(handle) {
    var p = parca();
    if (!p) return;
    var sonra = kutu.value.slice(kutu.selectionStart);
    kutu.value = kutu.value.slice(0, p.bas) + "@" + handle + " " + sonra;
    var yer = p.bas + handle.length + 2;
    kutu.focus();
    kutu.setSelectionRange(yer, yer);
    kapat();
  }

  document.body.addEventListener("focusin", function (e) {
    if (e.target.matches("input[name=body]")) { kutu = e.target; yukle(); }
  });

  document.body.addEventListener("input", function (e) {
    if (!e.target.matches("input[name=body]")) return;
    kutu = e.target;
    /* focusin'e ek olarak BURADA da: kutu zaten odaktaysa (yanitla dugmesi
       odagi vermis olabilir) focusin bir daha atesle­mez ve sozluk hic
       yuklenmezdi. yukle() kendi icinde tekrarsiz. */
    yukle();
    secili = 0;
    ciz();
  });

  /* keydown (keyup degil): Enter tamamlamayi secmeliyse formu GONDERMEMELI,
     iptali de preventDefault ile burada yapiliyor. */
  document.body.addEventListener("keydown", function (e) {
    if (!pop || !e.target.matches("input[name=body]")) return;
    if (e.key === "ArrowDown") { secili = (secili + 1) % adaylar.length; e.preventDefault(); ciz(); }
    else if (e.key === "ArrowUp") { secili = (secili - 1 + adaylar.length) % adaylar.length; e.preventDefault(); ciz(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); sec(adaylar[secili].handle); }
    else if (e.key === "Escape") { e.preventDefault(); kapat(); }
  });

  document.body.addEventListener("click", function (e) {
    var b = e.target.closest(".anmasat");
    if (b) { e.preventDefault(); sec(b.dataset.handle); return; }
    if (pop && !e.target.closest(".anmapop") && !e.target.matches("input[name=body]")) kapat();
  });
})();

/* --- mobil geri tusu ----------------------------------------------------
   Eskiden href="javascript:history.back()" idi ve CSP (script-src 'self')
   yuzunden HIC calismiyordu — tiklaniyor, hicbir sey olmuyordu.

   Gecmis varsa geri gidilir; yoksa (bildirimle ya da paylasilan bagliantiyla
   dogrudan acilmis sayfa) href'teki liste ekranina dusulur. Ikisi de dogru
   cevap, hangisi oldugunu yalnizca tarayici bilir. */
document.body.addEventListener("click", function (e) {
  var b = e.target.closest("[data-back]");
  if (!b) return;
  if (window.history.length > 1) { e.preventDefault(); window.history.back(); }
});
