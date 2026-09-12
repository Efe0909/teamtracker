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
