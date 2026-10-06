// Demo gorselleri: afis (iki surum), butce tablosu, salon yerlesimi. HTML -> PNG (Chromium).
// Gercek fotograf yok; hepsi kurgusal cizim. Kullanim: node demo/seed/make_images.mjs <cikti-dizini>

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
function load() {
  for (const p of ["playwright", join(execSync("npm root -g").toString().trim(), "playwright")]) {
    try { return require(p); } catch { /* sonrakini dene */ }
  }
  throw new Error("playwright bulunamadi (npm i -g playwright)");
}
const { chromium } = load();

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const DAY = arg("day", "17 Ekim"), WEEKDAY = arg("weekday", "Cumartesi");
const out = process.argv[2];
if (!out) throw new Error("cikti dizini gerekli");
mkdirSync(out, { recursive: true });

const base = `<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
</style>`;

const posterV1 = `${base}<body style="width:794px;height:1123px;background:linear-gradient(160deg,#0d1b3d 0%,#1b2f6b 55%,#2d1b69 100%);color:#fff;position:relative;overflow:hidden">
  <div style="position:absolute;right:-120px;top:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,#36d6b5 0%,rgba(54,214,181,0) 70%);opacity:.55"></div>
  <div style="position:absolute;left:-160px;bottom:-140px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,#ff9d4d 0%,rgba(255,157,77,0) 70%);opacity:.45"></div>
  <div style="position:absolute;inset:56px 56px 0 56px">
    <div style="display:inline-block;padding:8px 16px;border:2px solid #36d6b5;border-radius:999px;font-weight:700;letter-spacing:.14em;font-size:15px;color:#36d6b5">MAKER KULÜBÜ · ATÖLYE SERİSİ</div>
    <h1 style="margin-top:56px;font-size:84px;line-height:.98;font-weight:900;letter-spacing:-.03em">ARDUINO<br>İLE <span style="color:#36d6b5">AKILLI</span><br>EV</h1>
    <p style="margin-top:28px;font-size:26px;line-height:1.35;max-width:560px;color:#dbe4ff">Sensörler, röleler ve kendi akıllı ev maketin. Sıfırdan başla, günün sonunda çalışan bir devre götür.</p>
    <svg viewBox="0 0 700 220" style="margin-top:36px;width:100%">
      <rect x="30" y="40" width="250" height="150" rx="14" fill="#0b8a8a" stroke="#36d6b5" stroke-width="3"/>
      <circle cx="70" cy="80" r="16" fill="#0d1b3d"/><circle cx="70" cy="150" r="16" fill="#0d1b3d"/>
      <rect x="120" y="70" width="110" height="60" rx="6" fill="#101a35"/>
      <g stroke="#ff9d4d" stroke-width="4" fill="none"><path d="M280 90 H380 V60 H520"/><path d="M280 140 H400 V160 H520"/></g>
      <circle cx="540" cy="60" r="22" fill="#ffd166"/><rect x="520" y="140" width="60" height="42" rx="8" fill="#ef476f"/>
      <g fill="#36d6b5"><circle cx="610" cy="60" r="7"/><circle cx="640" cy="60" r="7"/><circle cx="670" cy="60" r="7"/></g>
    </svg>
  </div>
  <div style="position:absolute;left:56px;right:56px;bottom:56px;display:flex;gap:20px">
    <div style="flex:1;background:rgba(255,255,255,.1);border-radius:18px;padding:22px 24px"><div style="font-size:14px;letter-spacing:.12em;color:#9fb3ff">NE ZAMAN</div><div style="font-size:30px;font-weight:800;margin-top:6px">${DAY}<br>${WEEKDAY}</div><div style="font-size:20px;margin-top:6px;color:#dbe4ff">10:00 – 14:00</div></div>
    <div style="flex:1;background:rgba(255,255,255,.1);border-radius:18px;padding:22px 24px"><div style="font-size:14px;letter-spacing:.12em;color:#9fb3ff">NEREDE</div><div style="font-size:30px;font-weight:800;margin-top:6px">Maker<br>Atölyesi</div><div style="font-size:20px;margin-top:6px;color:#dbe4ff">B Blok · −1. kat</div></div>
    <div style="flex:1;background:#36d6b5;color:#0d1b3d;border-radius:18px;padding:22px 24px"><div style="font-size:14px;letter-spacing:.12em;font-weight:700">KONTENJAN</div><div style="font-size:54px;font-weight:900;margin-top:2px">30</div><div style="font-size:18px;font-weight:700">Kayıt: ornek.example/kayit</div></div>
  </div>
</body>`;

const posterV2 = `${base}<body style="width:794px;height:1123px;background:#fff6e9;color:#1d1a16;position:relative;overflow:hidden">
  <div style="position:absolute;left:0;top:0;width:100%;height:470px;background:#ff7a1a;clip-path:polygon(0 0,100% 0,100% 72%,0 100%)"></div>
  <div style="position:absolute;inset:56px">
    <div style="font-weight:800;letter-spacing:.14em;font-size:15px;color:#fff">MAKER KULÜBÜ · ATÖLYE SERİSİ</div>
    <h1 style="margin-top:34px;font-size:80px;line-height:.98;font-weight:900;letter-spacing:-.03em;color:#fff">Akıllı<br>evini<br>kendin kur.</h1>
    <div style="margin-top:210px;display:flex;gap:14px;flex-wrap:wrap">
      <span style="background:#1d1a16;color:#fff;padding:12px 20px;border-radius:12px;font-size:22px;font-weight:800">Arduino</span>
      <span style="background:#1d1a16;color:#fff;padding:12px 20px;border-radius:12px;font-size:22px;font-weight:800">Sensörler</span>
      <span style="background:#1d1a16;color:#fff;padding:12px 20px;border-radius:12px;font-size:22px;font-weight:800">Röle</span>
      <span style="background:#1d1a16;color:#fff;padding:12px 20px;border-radius:12px;font-size:22px;font-weight:800">Lehim yok, kablo çok</span>
    </div>
    <p style="margin-top:28px;font-size:26px;line-height:1.4;max-width:600px">Dört saatlik uygulamalı atölyede ışığı, ısıyı ve kapıyı kontrol eden bir devre kurup eve götür.</p>
    <div style="position:absolute;left:0;right:0;bottom:0;border-top:3px solid #1d1a16;padding-top:22px;display:flex;justify-content:space-between;align-items:flex-end">
      <div><div style="font-size:44px;font-weight:900">${DAY} · ${WEEKDAY.slice(0, 3)}</div><div style="font-size:24px;margin-top:4px">10:00 – 14:00 · Maker Atölyesi (B Blok)</div></div>
      <div style="text-align:right"><div style="font-size:15px;letter-spacing:.12em;font-weight:700">KAYIT</div><div style="font-size:24px;font-weight:800">ornek.example/kayit</div><div style="font-size:16px;margin-top:2px">30 kişilik kontenjan</div></div>
    </div>
  </div>
</body>`;

const rows = [
  ["Arduino Uno R3 × 30", "145,00 ₺", "4.350,00 ₺"],
  ["Breadboard + jumper seti × 30", "62,00 ₺", "1.860,00 ₺"],
  ["DHT22 sıcaklık sensörü × 30", "58,00 ₺", "1.740,00 ₺"],
  ["Röle modülü (5V) × 30", "34,00 ₺", "1.020,00 ₺"],
  ["Lehim teli, flux, havya ucu", "—", "420,00 ₺"],
  ["Lazer kesim sensör tutucu paneller", "—", "900,00 ₺"],
  ["Sertifika baskısı × 35", "9,00 ₺", "315,00 ₺"],
];
const budget = `${base}<body style="width:1000px;background:#fff;padding:36px 40px;color:#1b1f2a">
  <div style="display:flex;justify-content:space-between;align-items:baseline"><h1 style="font-size:30px;font-weight:800">Arduino Atölyesi · Bütçe Taslağı</h1><span style="color:#6b7280;font-size:16px">v2 · Elif Şahin</span></div>
  <table style="width:100%;border-collapse:collapse;margin-top:22px;font-size:20px">
    <tr style="background:#f1f3f9;color:#4b5563;text-align:left;font-size:15px;letter-spacing:.06em"><th style="padding:12px 14px">KALEM</th><th style="padding:12px 14px;text-align:right">BİRİM</th><th style="padding:12px 14px;text-align:right">TOPLAM</th></tr>
    ${rows.map((r, i) => `<tr style="border-bottom:1px solid #e5e7eb;${i % 2 ? "background:#fafbff" : ""}"><td style="padding:13px 14px">${r[0]}</td><td style="padding:13px 14px;text-align:right;color:#6b7280">${r[1]}</td><td style="padding:13px 14px;text-align:right;font-weight:700">${r[2]}</td></tr>`).join("")}
    <tr><td style="padding:16px 14px;font-weight:800;font-size:22px" colspan="2">Genel toplam</td><td style="padding:16px 14px;text-align:right;font-weight:900;font-size:24px;color:#0b7a55">10.605,00 ₺</td></tr>
  </table>
  <p style="margin-top:14px;color:#6b7280;font-size:16px">Sponsor katkısı (DHT22 ve röle) onaylanırsa net bütçe ≈ 7.845,00 ₺.</p>
</body>`;

const tables = [
  [210, 150], [210, 360], [210, 570], [640, 150], [640, 360], [640, 570],
].map(([x, y]) => `<div style="position:absolute;left:${x}px;top:${y}px;width:300px;height:140px;background:#fff;border:3px solid #5b6b8c;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:10px">${"<i style='width:34px;height:34px;border-radius:50%;background:#cfe0ff;border:2px solid #5b8cff'></i>".repeat(5)}</div>`).join("");
const layout = `${base}<body style="width:1200px;height:800px;background:#eef2f9;position:relative;color:#1b1f2a">
  <div style="position:absolute;inset:24px;border:6px solid #1b1f2a;border-radius:10px;background:#f8faff"></div>
  <div style="position:absolute;left:48px;top:40px;font-size:26px;font-weight:800">Maker Atölyesi — atölye günü yerleşim planı</div>
  <div style="position:absolute;left:48px;top:84px;font-size:17px;color:#566074">6 çalışma adası × 5 kişi = 30 katılımcı · giriş solda</div>
  ${tables}
  <div style="position:absolute;left:24px;top:230px;width:12px;height:110px;background:#f5b041;border-radius:6px"></div><div style="position:absolute;left:44px;top:276px;font-size:15px;font-weight:700;color:#8a5a00">GİRİŞ</div>
  <div style="position:absolute;right:50px;top:120px;width:130px;height:560px;background:#e6efe9;border:3px dashed #2f9e6b;border-radius:10px;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font-weight:800;color:#1f7a50;letter-spacing:.2em">MALZEME & LEHİM TEZGÂHI</div>
  <div style="position:absolute;left:48px;bottom:44px;width:120px;height:60px;background:#ffe9c7;border:3px solid #e0a040;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#8a5a00">KAYIT MASASI</div>
</body>`;

const jobs = [
  ["poster-v1.png", posterV1, 794, 1123],
  ["poster-v2.png", posterV2, 794, 1123],
  ["budget.png", budget, 1000, 560],
  ["layout.png", layout, 1200, 800],
];
const browser = await chromium.launch();
for (const [name, html, w, h] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: join(out, name), fullPage: name === "budget.png" });
  await page.close();
  console.log("  yazildi:", name);
}
await browser.close();
