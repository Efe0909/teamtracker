// Bolum 11: etkinlik sorumlusu — onay kutusu, checkpoint tarihi, yeni adim. Kisi: Kaan.

import { HOSTS } from "../lib.mjs";
import { btn, dayCell, pop } from "../ui.mjs";
import { dayLabel } from "../lib.mjs";

const EVENT = "Arduino ile Akıllı Ev Atölyesi";

export default {
  id: "etkinlik-yonet",
  title: "Etkinlik sorumlusu: onayla ve planı düzenle",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Zeynep'in isteği Kaan'a düştü. Kaan onaylıyor, sonra planda bir adımın tarihini kaydırıp kayıt masası için yeni bir adım ekliyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/events`, { waitUntil: "networkidle" });
    await page.locator("table").getByRole("link", { name: EVENT }).click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}/);
    await page.evaluate(() => window.scrollTo(0, 0));

    const requests = page.getByRole("list", { name: "Bekleyen onay istekleri" });
    await R.step(page, {
      id: "yonet-istek",
      title: "Onay istekleri sayfanın en üstünde",
      text: "Etkinliğin sorumlusu ve etkinlik yöneticileri, bekleyen onay isteklerini sayfanın en üstünde sarı kutuda görür: **kim**, **hangi adımı**, **ne yapmak istiyor**. Bu istek **Zeynep**'ten.",
      target: requests,
      click: false,
    });
    const approve = requests.getByRole("button", { name: "Onayla" });
    await R.step(page, {
      id: "yonet-onayla",
      title: "Onayla ya da Reddet",
      text: "Duyuru gerçekten yapıldıysa **Onayla**'ya bas. Yapılmadıysa **Reddet** isteği siler, adım olduğu gibi kalır.",
      target: [approve, requests.getByRole("button", { name: "Reddet" })],
      act: () => approve.click(),
    });
    await R.step(page, {
      id: "yonet-onaylandi",
      title: "Adım tamamlandı",
      text: "Nokta doldu ve satırda **tamam** yazıyor; kutu da kayboldu. Sorumlu ve yöneticiler adıma doğrudan basıp işaretleyebilir, onay istemeden.",
      target: page.getByRole("complementary", { name: "Etkinlik özeti" }).locator("section").first(),
      click: false,
    });

    // --- checkpoint tarihi --------------------------------------------------
    const row = page.getByRole("complementary", { name: "Etkinlik özeti" }).locator("li").filter({ hasText: "Malzeme hazır" });
    const date = row.getByRole("button", { name: /^Son tarih:/ });
    await R.step(page, {
      id: "yonet-tarih",
      title: "Adımın tarihini değiştir",
      text: "Etkinlik yöneticisi adımın altındaki **tarih**e tıklayıp kaydırabilir. Varsayılan etkinlikten 7 gün önce; etkinlik tarihi değişirse varsayılan tarihler onunla birlikte kayar.",
      target: date,
      act: () => date.click(),
    });
    await R.step(page, {
      id: "yonet-tarih-sec",
      title: "Yeni günü seç",
      text: "Takvimden yeni gün seç. **Varsayılan (7 gün önce)** düğmesi özel tarihi silip hesaplanana döner.",
      target: dayCell(page, 7),
      act: () => dayCell(page, 7).click(),
    });

    // --- yeni adim ----------------------------------------------------------
    const plus = page.getByRole("button", { name: "Checkpoint ekle" });
    await R.step(page, {
      id: "yonet-adim",
      title: "Plana yeni bir adım ekle",
      text: "Zaman çizelgesinin başlığındaki **+**, şablonda olmayan bir adım eklemeni sağlar.",
      target: plus,
      act: () => plus.click(),
    });
    await pop(page).getByLabel("Checkpoint adı").fill("Kayıt masası kuruldu");
    await R.step(page, {
      id: "yonet-adim-form",
      title: "Adın adını yaz, istersen tarih seç",
      text: "Tarihi boş bırakırsan adım **etkinlikten 7 gün önce**ye düşer. **Ekle**'ye bas.",
      target: pop(page),
      act: () => pop(page).getByRole("button", { name: "Ekle" }).click(),
    });
    await R.step(page, {
      id: "yonet-adim-sonuc",
      title: "Yeni adım çizelgede",
      text: "Adım çizelgeye eklendi. Şablondan gelen adımlar gibi bu da işaretlenebilir ya da yanındaki **×** ile kaldırılabilir.",
      target: page.getByRole("complementary", { name: "Etkinlik özeti" }).locator("section").first(),
      click: false,
    });
  },
};
