// Bolum 8: Etkinlikler — sekmeler, suzgec, takvim rayi. Kisi: Kaan.

import { HOSTS } from "../lib.mjs";
import { chip, nav, opt, tab } from "../ui.mjs";

export default {
  id: "etkinlikler",
  title: "Etkinlikler: takvime bak",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Kaan önümüzdeki haftaların etkinlik takvimini tarıyor: ne zaman, nerede, kim sorumlu, hangisi tarihsiz bekliyor?",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "etk-ac",
      title: "Etkinlikler'i aç",
      text: "Kenar çubuğundan **Etkinlikler**'e tıkla. Toplantı, atölye, gezi, festival: kulübün tüm etkinlikleri burada planlanır.",
      target: nav(page, "Etkinlikler"),
      act: () => nav(page, "Etkinlikler").click(),
    });

    await R.step(page, {
      id: "etk-genel",
      title: "Sayfa üç parçadan oluşur",
      text: "**Sekmeler** etkinlikleri zamana böler, **tablo** her etkinliğin tarihini, durumunu, önemini, sorumlusunu ve beklenen katılımcı sayısını gösterir, sağdaki **takvim** ayı ve yaklaşan etkinlikleri özetler.",
      target: [
        { t: page.getByRole("tablist", { name: "Etkinlik sekmesi" }), label: "Sekmeler" },
        { t: page.locator("table").first(), label: "Etkinlik tablosu" },
        { t: page.getByRole("complementary", { name: "Takvim" }), label: "Takvim ve ajanda" },
      ],
      click: false,
    });

    await R.step(page, {
      id: "etk-tablo",
      title: "Tabloyu oku",
      text: "Her satır bir etkinlik: adı, **türü** (gri etiket), yeri ve bağlı kayıt sayısı. **Durum** etiketi (*Fikir, Planlanıyor, Kesin, Yapıldı, İptal*) etkinliğin ne aşamada olduğunu söyler.",
      target: page.locator("table tbody tr").nth(1),
      click: false,
    });

    const pool = tab(page, /^Havuz/);
    await R.step(page, {
      id: "etk-havuz",
      title: "Tarihi olmayanlar Havuz'da bekler",
      text: "Fikir aşamasındaki, henüz tarihi konmamış etkinlikler **Havuz** sekmesinde durur. Tarih verilince otomatik olarak **Planlanan**'a geçer.",
      target: pool,
      act: () => pool.click(),
    });
    await R.step(page, {
      id: "etk-havuz-liste",
      title: "Havuzdaki fikirler",
      text: "Tarih sütunu **“Tarih yok”** diyor. Fikri kesinleştirmek için etkinliği aç, bir tarih seç ve durumu **Planlanıyor**'a çek.",
      target: page.locator("table tbody"),
      click: false,
    });

    const past = tab(page, /^Geçmiş/);
    await R.step(page, {
      id: "etk-gecmis",
      title: "Geçmiş etkinlikler arşivde",
      text: "Tarihi geçen etkinlikler **Geçmiş**'e düşer, en yenisi üstte. Yapıldı ya da iptal edilen etkinliklerin sohbeti, kayıtları ve formları da burada durur.",
      target: past,
      act: () => past.click(),
    });
    await tab(page, /^Planlanan/).click();

    // --- suzgec -------------------------------------------------------------
    await R.step(page, {
      id: "etk-tur",
      title: "Türe göre süz",
      text: "**Tür**, **Önem** ve **Sorumlu** çipleri tabloyu daraltır; arama kutusu etkinlik adı ve yerinde arar. Tür listesi **Veri yönetimi**'nden gelir.",
      target: chip(page, "Tür"),
      act: () => chip(page, "Tür").click(),
    });
    await R.step(page, {
      id: "etk-tur-sec",
      title: "Atölye'yi seç",
      text: "Listede ekibin tanımladığı etkinlik türleri var. **Atölye**'yi seç: yalnız atölyeler kalır.",
      target: opt(page, /^Atölye/),
      act: () => opt(page, /^Atölye/).click(),
    });
    await R.step(page, {
      id: "etk-tur-sonuc",
      title: "Süzgeç çipi doldu",
      text: "Çipte **Tür: Atölye** yazar. **Temizle** tüm süzgeçleri kaldırır. Süzgeçler adres çubuğuna da yazılır; adresi paylaşınca aynı görünüm açılır.",
      target: [chip(page, "Tür"), page.locator("table tbody")],
      click: false,
    });
    await page.getByRole("button", { name: "Temizle" }).click();

    // --- takvim rayi --------------------------------------------------------
    const day = page.getByRole("complementary", { name: "Takvim" }).getByRole("link", { name: /^17/ }).first();
    await R.step(page, {
      id: "etk-takvim",
      title: "Takvimdeki noktaya tıkla",
      text: "Takvimde etkinlik olan günlerin altında **renkli nokta** var: renk önemi gösterir (kırmızı kritik, turuncu yüksek, mor orta). Güne ya da noktaya tıkla, etkinlik açılır. Ok düğmeleriyle aylar arasında gezilir.",
      target: day,
      act: () => day.click(),
    });
    await page.waitForURL(/\/events\/[0-9a-f-]{36}/);
    await R.step(page, {
      id: "etk-takvim-sonuc",
      title: "Etkinlik sayfası açıldı",
      text: "Takvimden doğrudan etkinliğin sayfasına geldik. Sonraki bölümlerde bu sayfanın parçalarını inceleyeceğiz.",
      target: page.getByRole("heading", { level: 1 }),
      click: false,
    });
  },
};
