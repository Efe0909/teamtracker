// Bolum 15: Takimlar — liste, takim sayfasi, takim duvari, widget duzeni. Kisi: Kaan (uye).

import { HOSTS } from "../lib.mjs";
import { btn, cls, dact, dlg, nav } from "../ui.mjs";

export default {
  id: "takimlar",
  title: "Takımlar: ekibini ve duvarını gör",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Kaan takımların neye baktığını, kimlerin üye olduğunu ve açık işleri görmek için Takımlar'a geçiyor; Teknik Atölye'nin duvarına bir not bırakıyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "takim-ac",
      title: "Takımlar'ı aç",
      text: "Kenar çubuğundan **Takımlar**'a tıkla. Takım, birlikte çalışan insanlardır; ağaçtaki birimlerden bağımsızdır.",
      target: nav(page, "Takımlar"),
      act: () => nav(page, "Takımlar").click(),
    });

    const grid = cls(page, "teamGrid");
    await R.step(page, {
      id: "takim-liste",
      title: "Her takım bir kart",
      text: "Kartta takımın **adı**, **açıklaması**, çalıştığı **birimler**, **üyeleri** ve **açık kayıt** sayısı var. Üyesi olduğun takımlar önde ve **Üyesin** rozetiyle işaretli.",
      target: grid,
      click: false,
    });

    const card = grid.getByRole("link", { name: /Teknik Atölye/ });
    await R.step(page, {
      id: "takim-sec",
      title: "Takıma tıkla",
      text: "Kartın herhangi bir yerine tıkla; takımın sayfası açılır. Aynı sayfaya kenar çubuğundaki takım listesinden de ulaşılır.",
      target: card,
      act: () => card.click(),
    });
    await page.waitForURL(/\/teams\/[0-9a-f-]{36}/);

    await R.step(page, {
      id: "takim-genel",
      title: "Takım sayfasının dört bölümü",
      text: "Solda **Üyeler** (rolleriyle), **Çalıştığı birimler** ve takımın **Kayıtlar**'ı, sağda **Takım duvarı**. Her bölümün başlığına tıklarsan katlanır; katlama cihazında hatırlanır.",
      target: [
        { t: page.locator('section[aria-labelledby="w-members"]'), label: "Üyeler" },
        { t: page.locator('section[aria-labelledby="w-nodes"]'), label: "Birimler" },
        { t: page.locator('section[aria-labelledby="w-records"]'), label: "Kayıtlar" },
        { t: page.getByRole("complementary", { name: "Takım duvarı" }), label: "Takım duvarı" },
      ],
      click: false,
    });

    // --- duvar --------------------------------------------------------------
    const wall = page.getByRole("complementary", { name: "Takım duvarı" });
    const box = wall.getByLabel("Mesaj", { exact: true });
    await box.fill("Cuma 18:00'de atölye kurulumu var: uzatma kabloları ve havya istasyonları için üç gönüllü lazım. Yazan olursa kayıt masası görevinden sayarım.");
    await R.step(page, {
      id: "takim-duvar",
      title: "Takım duvarına not bırak",
      text: "**Takım duvarı** takımın ortak sohbetidir. Takıma ait duyuruları, kısa soruları buraya yaz; üyelik değişiklikleri de akışa sistem satırı olarak düşer. Duvara yalnız takım üyeleri yazar, herkes okur.",
      target: box,
      act: () => wall.getByRole("button", { name: "Gönder", exact: true }).click(),
    });
    await R.step(page, {
      id: "takim-duvar-sonuc",
      title: "Not duvarda",
      text: "Mesajın takım üyelerine bildirim olarak gider. Grup anmaları da çalışır: **@team** yazarsan takımın tamamı anılır.",
      target: wall.locator('[id^="event-"]').last(),
      click: false,
    });

    // --- duzen --------------------------------------------------------------
    const arrange = btn(page, /^Düzen$/);
    await R.step(page, {
      id: "takim-duzen",
      title: "Bölümlerin sırasını kendine göre ayarla",
      text: "Sayfa başlığındaki **Düzen** düğmesi bölümleri yukarı/aşağı taşıtır. Sıra yalnız senin cihazında geçerlidir; başkalarını etkilemez.",
      target: arrange,
      act: () => arrange.click(),
    });
    await R.step(page, {
      id: "takim-duzen-oklar",
      title: "Oklarla taşı, bitince Düzeni bitir",
      text: "Her bölümün başlığında **yukarı** ve **aşağı** okları çıktı. Bitirince **Düzeni bitir**'e bas.",
      target: [page.getByRole("button", { name: "Kayıtlar yukarı taşı" }), btn(page, /Düzeni bitir/)],
      click: false,
      act: () => btn(page, /Düzeni bitir/).click(),
    });

    // --- takim icin kayit ---------------------------------------------------
    const create = btn(page, /Kayıt aç/);
    await R.step(page, {
      id: "takim-kayit",
      title: "Takım için kayıt aç",
      text: "**Kayıt aç**, takımı hazır gelen yeni kayıt penceresini açar: takımın bütün üyeleri o kaydı düzenleyebilir.",
      target: create,
      act: () => create.click(),
    });
    const d = dlg(page, "Yeni kayıt");
    await R.step(page, {
      id: "takim-kayit-form",
      title: "Takım çipi dolu geldi",
      text: "Pencere **Yeni kayıt** penceresinin aynısı; **Takım** alanı seçili geldi. Doldurup açabilir ya da **Vazgeç** diyebilirsin.",
      target: d,
      click: false,
    });
    await dact(d).getByRole("button", { name: "Vazgeç" }).click();
  },
};
