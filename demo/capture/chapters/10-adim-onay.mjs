// Bolum 10: etkinlik sayfasi — zaman cizelgesi ve onay istegi. Kisi: Zeynep (onaylayici degil).

import { HOSTS } from "../lib.mjs";

const EVENT = "Arduino ile Akıllı Ev Atölyesi";

export default {
  id: "adim-onay",
  title: "Zaman çizelgesi: adımı bitir, onay iste",
  persona: "Zeynep Koç",
  role: "Duyuru ve sosyal medya",
  intro: "Zeynep Arduino atölyesinin duyurusunu yaptı. Etkinliğin zaman çizelgesinde bu adımı tamamlandı olarak işaretlemek istiyor; ama onaylayıcı o değil.",

  async run({ R, open }) {
    const { page } = await open("Zeynep Koç");
    await page.goto(`${HOSTS.dashboard}/events`, { waitUntil: "networkidle" });

    const row = page.locator("table").getByRole("link", { name: EVENT });
    await R.step(page, {
      id: "onay-ac",
      title: "Etkinliği listeden aç",
      text: "Etkinlikler tablosunda satırın herhangi bir yerine (ya da başlığına) tıkla; etkinliğin sayfası açılır.",
      target: row,
      act: () => row.click(),
    });
    await page.waitForURL(/\/events\/[0-9a-f-]{36}/);

    const timeline = page.getByRole("complementary", { name: "Etkinlik özeti" }).locator("section").first();
    await R.step(page, {
      id: "onay-cizelge",
      title: "Sağ üstte etkinliğin zaman çizelgesi",
      text: "Etkinliğe giden yol adımlara bölünmüş. **Dolu nokta** yapılmış adım, **halkalı nokta** sıradaki, **kesikli nokta** sonraki adımlar. Tarihler etkinlik gününe göre türden gelir.",
      target: timeline,
      click: false,
    });

    const dot = page.getByRole("button", { name: "Duyuru yapıldı: tamamlandı olarak işaretle" });
    await R.step(page, {
      id: "onay-nokta",
      title: "Adımı bitirince noktaya bas",
      text: "Duyuru yayınlandı: **Duyuru yapıldı** noktasına tıkla. Etkinliğin sahibi ya da etkinlik yöneticisi değilsen adım hemen işaretlenmez, **onay istenir**.",
      target: dot,
      act: () => dot.click(),
    });
    await R.step(page, {
      id: "onay-bekliyor",
      title: "Onay istendi",
      text: "Alttaki bildirim “**Onay istendi**” diyor, adımın yanında **onay bekliyor** yazıyor. Onay isteği etkinliğin sorumlusuna (ve etkinlik yöneticilerine) görünür; onaylayınca nokta dolar.",
      target: [page.getByText("onay bekliyor"), page.getByText("Onay istendi").first()],
      click: false,
    });
  },
};
