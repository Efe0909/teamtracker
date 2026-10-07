// Bolum 22: Yonetim — aktivite ve kalite kapisi. Kisi: Defne (yonetici).

import { HOSTS } from "../lib.mjs";
import { tab } from "../ui.mjs";

export default {
  id: "yonetim-aktivite",
  title: "Yönetim: aktivite ve kalite kapısı",
  persona: "Defne Aksoy",
  role: "Kulüp başkanı (yönetici)",
  intro: "Dönem ortasında Defne ekibin sisteme ne kadar uğradığına ve kayıt metinlerini tartan kalite kapısının nasıl ayarlandığına bakıyor.",

  async run({ R, open }) {
    const { page } = await open("Defne Aksoy", { height: 1100 });
    await page.goto(`${HOSTS.dashboard}/admin`, { waitUntil: "networkidle" });

    const act = tab(page, "Aktivite");
    await R.step(page, {
      id: "akt-ac",
      title: "Aktivite sekmesi",
      text: "**Aktivite** kimin ne zaman uğradığını ve ne kadar iş çıkardığını gösterir. Amaç kimseyi denetlemek değil, **kimin takılıp kaldığını** ya da yardıma ihtiyaç duyduğunu görmek.",
      target: act,
      act: () => act.click(),
    });
    await R.step(page, {
      id: "akt-tablo",
      title: "Kişi başına özet",
      text: "Her satırda **son giriş**, **son hareket**, son 30 günde **aktif gün**, son 7 günde sekmenin açık kaldığı **süre** ve **katkı** (mesaj + kayıt, alan, eylem değişiklikleri) var. Başlığa tıklarsan sıralar.",
      target: page.locator("table").first(),
      click: false,
    });

    const row = page.locator("table tbody tr").nth(2);
    await R.step(page, {
      id: "akt-kisi",
      title: "Bir kişiye tıkla",
      text: "Satıra tıklayınca altta kişinin **katkı matrisi** açılır: son haftalarda gün gün katkı (koyu = çok).",
      target: row,
      act: () => row.click(),
    });
    await R.step(page, {
      id: "akt-matris",
      title: "Katkı matrisi ve seriler",
      text: "Matris GitHub'daki gibi okunur. Yanındaki satırlarda son 7/30 günlük **katkı**, **en katkılı gün**, günlük ortalama **süre** ve ardışık **seri** (gün) var. “Süre” sekmenin açık kaldığı dakikadır, “katkı” ise yapılan işlerdir.",
      target: page.locator('section[aria-label$="aktivitesi"]'),
      click: false,
    });

    const quality = tab(page, "Kalite kapısı");
    await R.step(page, {
      id: "kalite-ac",
      title: "Kalite kapısı sekmesi",
      text: "Yalnız yöneticiye görünen **Kalite kapısı**, kayıt, etkinlik ve kapanış notlarının yazı kalitesini tartan modelin sorularını tutar. Kaydedince hemen geçerli olur.",
      target: quality,
      act: () => quality.click(),
    });
    await R.step(page, {
      id: "kalite-sorular",
      title: "Üç soru ve eşik",
      text: "**Somutluk**, **Bağlam** ve kapanış notu **Gerekçe** soruları: her biri model yönergesi, “evet / hayır” ölçütü ve bir **eşik** içerir. Metin eşiğin altında kalırsa yazana **uyarı** çıkar; “Yine de gönder” ile geçilebilir.",
      target: page.locator("fieldset").first(),
      click: false,
    });
  },
};
