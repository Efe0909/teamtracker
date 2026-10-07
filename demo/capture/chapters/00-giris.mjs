// Bolum 0: giris ve Panolar (ana sayfa). Kisi: Kaan, etkinlik koordinatoru.

import { HOSTS, settle, weekday } from "../lib.mjs";

export default {
  id: "giris",
  title: "Giriş ve Panolar",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: `${weekday()} sabahı. Kaan, haftaya başlamadan önce EkipTakip'e girip önünde ne olduğuna bakıyor.`,

  async run({ R, browser, open }) {
    // 1) Giris sayfasi — yayindaki gibi "Google ile devam et" (demo'da kullanici listesi var;
    //    /api/me cevabi yayindakine cevrilir).
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: "tr-TR", timezoneId: "UTC" });
    const ap = await anon.newPage();
    await ap.route("**/api/me", (r) => r.fulfill({ json: { user: null, auth: "google", csrf: null } }));
    await ap.goto(`${HOSTS.apex}/welcome`, { waitUntil: "networkidle" });
    await R.step(ap, {
      id: "giris-sayfasi",
      title: "Giriş sayfasını aç",
      text: "Ekibin adresine git. **Masaüstü paneli**ni seç ve **Google ile devam et**'e bas. Yalnızca ekibe davet edilmiş e-postalar girebilir.",
      tip: "Telefonda **Mobil uygulama**'yı seç; aynı hesapla çalışır.",
      target: [ap.locator("fieldset.dest"), ap.getByRole("link", { name: /Google ile devam et/ })],
      click: true,
    });
    await anon.close();

    // 2) Panolar
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });
    await R.step(page, {
      id: "panolar",
      title: "Panolar: günün özeti",
      text: "Giriş yapınca **Panolar** açılır. Üstteki dört sayaç sana ve ekibe ait işi özetler: **açık eylemlerin**, **geciken kayıtlar**, **atanmamış** işler ve toplam **açık kayıt**.",
      target: page.locator('[class*="stats"]').first(),
      click: false,
    });

    await R.step(page, {
      id: "panolar-kenar",
      title: "Kenar çubuğu: tüm modüller",
      text: "Soldaki çubuktan **Görevler**, **Etkinlikler**, **Takımlar**, **Ekip**, **Pillar'lar** ve **Veri yönetimi**'ne geçersin. Takımların ve pillar'ların kısayolları altta; **üye** rozeti hangilerinde olduğunu gösterir.",
      target: page.getByRole("navigation", { name: "Ana gezinme" }),
      click: false,
    });

    await R.step(page, {
      id: "panolar-geciken",
      title: "Geciken kayıtlara git",
      text: "Kırmızı sayaç bir şey gecikmiş demek. **Geciken kayıt** kutusuna tıkla; liste doğrudan o filtreyle açılır.",
      target: page.getByRole("link", { name: /Geciken kayıt/ }),
      act: async () => { await page.getByRole("link", { name: /Geciken kayıt/ }).click(); },
    });

    await R.step(page, {
      id: "geciken-liste",
      title: "Gecikenler tek listede",
      text: "Son tarihi geçmiş kayıtlar (ve gecikmiş eylemi olanlar) burada. Gecikme yalnız renkle değil **“1 gün gecikti”** yazısıyla da belirtilir.",
      target: page.locator("table tbody tr").first(),
      click: false,
    });

    // 3) Komut paleti
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });
    await R.step(page, {
      id: "palet-ac",
      title: "Her yere ⌘K ile git",
      text: "Herhangi bir sayfada **⌘K** (Windows'ta **Ctrl+K**) komut paletini açar. Kayıt, etkinlik, takım ve sayfa aramak için tek kutu.",
      target: page.getByRole("button", { name: /Ara ya da git/ }),
      act: async () => { await page.keyboard.press("Control+k"); },
    });
    await page.keyboard.type("arduino", { delay: 40 });
    await settle(page, 500);
    await R.step(page, {
      id: "palet-sonuc",
      title: "Aradığını yazarak bul",
      text: "“arduino” yazınca eşleşen kayıtlar ve etkinlikler listelenir. **Enter** ile açılır, **Esc** ile kapanır.",
      target: page.getByRole("dialog").first(),
      click: false,
    });
    await page.keyboard.press("Escape");
  },
};
