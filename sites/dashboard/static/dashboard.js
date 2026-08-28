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
/* Gonderilen form temizlenir. hx-on= yerine burada: CSP'de 'unsafe-eval' istemiyoruz. */
document.body.addEventListener('htmx:afterRequest', e => {
  const f = e.target.closest('form');
  if (f && e.detail.successful) f.reset();
});
function feedBottom(){ const f = document.getElementById('feed'); if (f) f.scrollTop = f.scrollHeight; }
document.body.addEventListener('htmx:afterSwap', feedBottom);
window.addEventListener('load', feedBottom);
