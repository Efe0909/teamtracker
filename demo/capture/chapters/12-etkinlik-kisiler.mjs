// Bolum 12: etkinlige kisi, takim ve kayit baglamak — widget'lar, etkinlik sohbeti. Kisi: Kaan.
// Bolum 9'da acilan "Havya ve Lehimleme Atolyesi"ni surdurur.

import { HOSTS, recordId, sql } from "../lib.mjs";
import { NEW_EVENT } from "./09-yeni-etkinlik.mjs";
import { btn, chip, dlg, dact, menuItem, opt } from "../ui.mjs";

export default {
  id: "etkinlik-kisiler",
  title: "Etkinliğe kişi, takım ve kayıt bağla",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Havya atölyesinin planı oturdu. Kaan şimdi ekibi kuruyor: eğitmeni ekliyor, takımları bağlıyor ve işleri kayıtlara bölüyor.",

  async run({ R, open }) {
    const eventId = sql(`select id from events where title = '${NEW_EVENT}'`);
    if (eventId === "") throw new Error(`"${NEW_EVENT}" etkinligi yok (once yeni-etkinlik bolumu)`);
    const { page } = await open("Kaan Demir", { height: 1000 });
    await page.goto(`${HOSTS.dashboard}/events/${eventId}`, { waitUntil: "networkidle" });

    const side = page.getByRole("complementary", { name: "Etkinlik özeti" });

    // --- kisiler ------------------------------------------------------------
    const addPerson = side.getByRole("button", { name: /^Kişi ekle:/ });
    await R.step(page, {
      id: "kisi-ekle",
      title: "Etkinliğe kişi ekle",
      text: "Sağ sütundaki **Kişiler**'in **+** düğmesi ekibi etkinliğe katar. Eklenen kişi etkinliği düzenleyebilir, etkinlik sohbetinde bildirim alır.",
      target: addPerson,
      act: () => addPerson.click(),
    });
    await page.keyboard.type("can", { delay: 40 });
    await R.step(page, {
      id: "kisi-sec",
      title: "Kişiyi ara ve seç",
      text: "Yazdıkça liste daralır. **Can Özdemir**'i seç; zaten ekli olanlar listede çıkmaz.",
      target: opt(page, /Can Özdemir/),
      act: () => opt(page, /Can Özdemir/).click(),
    });
    await R.step(page, {
      id: "kisi-sonuc",
      title: "Can etkinlikte",
      text: "Kişi listeye girdi. Yanındaki **balon** simgesi o kişiyle etkinlik sohbetinde yazışmayı başlatır (özel mesaj yok, sohbet kayıtta yapılır); **×** kişiyi etkinlikten çıkarır.",
      target: side.getByRole("listitem").filter({ hasText: "Can Özdemir" }),
      click: false,
    });

    // --- takimlar -----------------------------------------------------------
    const addTeam = side.getByRole("button", { name: /^Takım ekle:/ });
    await R.step(page, {
      id: "takim-ekle",
      title: "Takımları bağla",
      text: "**Takımlar** bölümünün **+**'sı etkinliği bir ya da birkaç takıma bağlar: onlar için ayrı iş kaydı açabilirsin.",
      target: addTeam,
      act: () => addTeam.click(),
    });
    await R.step(page, {
      id: "takim-sec",
      title: "Teknik Atölye'yi seç",
      text: "Takım listesi **Takımlar** sayfasındakiyle aynı. Atölye için eğitmenin takımı olan **Teknik Atölye**'yi bağla.",
      target: opt(page, /Teknik Atölye/),
      act: () => opt(page, /Teknik Atölye/).click(),
    });

    const addRecord = side.getByRole("button", { name: "Kayıt", exact: true });
    await R.step(page, {
      id: "takim-kayit",
      title: "Takım için iş kaydı aç",
      text: "Bağlı takımın yanındaki **+ Kayıt**, takımı hazır gelen yeni bir kayıt formu açar. Oluşan kayıt etkinliğe otomatik bağlanır.",
      target: addRecord,
      act: () => addRecord.click(),
    });
    const d = dlg(page, "Yeni kayıt");
    await d.getByLabel("Başlık", { exact: true }).fill("Havya istasyonlarını ve havalandırmayı hazırla");
    await d.getByLabel("Açıklama", { exact: true }).fill("Yirmi katılımcı için havya istasyonları kurulacak; duman emici ve yeterli priz olduğundan emin olunmalı.");
    await chip(d, "Birim").click();
    await opt(page, /^Etkinlik Öncesi Hazırlık/).first().click();
    await R.step(page, {
      id: "takim-kayit-form",
      title: "Formda takım zaten seçili",
      text: "Pencere takımı (**Teknik Atölye**) doldurmuş geldi. Başlığı ve açıklamayı yaz, **Birim**'i seç, **Kaydı aç**'a bas.",
      target: d,
      act: () => dact(d).getByRole("button", { name: "Kaydı aç" }).click(),
    });
    await d.waitFor({ state: "hidden" });
    await R.step(page, {
      id: "takim-kayit-sonuc",
      title: "Kayıt widget olarak bağlandı",
      text: "**Widget'lar** altında yeni bir **Kayıt** kartı çıktı: kaydın durumu, eylemleri ve sahipleri etkinlik sayfasından izlenir. Başlığa tıklarsan kaydın kendi sayfasına gidersin.",
      target: page.getByRole("link", { name: "Havya istasyonlarını ve havalandırmayı hazırla" }).locator("xpath=ancestor::div[contains(@class,'cardHover')]"),
      click: false,
    });

    // --- var olan kaydi bagla ----------------------------------------------
    const addWidget = btn(page, /Widget ekle/);
    await R.step(page, {
      id: "widget-ekle",
      title: "Başka bir widget ekle",
      text: "**Widget ekle** menüsünde **Kayıt** (var olan ya da yeni bir kaydı bağlar) ve eksikse **OTF formu** ile **Satın alımlar** bulunur. Diğer widget'lar için *Etkinlik widget'larını düzenle* yetkisi gerekir.",
      target: addWidget,
      act: () => addWidget.click(),
    });
    await R.step(page, {
      id: "widget-menu",
      title: "Kayıt'ı seç",
      text: "**Kayıt** bir yer tutucu açar; ya yeni kayıt açarsın ya da mevcut bir kaydı seçersin.",
      target: menuItem(page, /^Kayıt/),
      act: () => menuItem(page, /^Kayıt/).click(),
    });
    const pick = page.getByRole("button", { name: /^Var olan kaydı bağla/ });
    await R.step(page, {
      id: "widget-var-olan",
      title: "Var olanı ekle",
      text: "Etkinliğe bağlı olmayan kayıtlar arasında arama yaparak bağla. Örneğin vardiya çizelgesi birçok etkinliğe lazımdır; bir kayıt birden çok etkinliğe bağlanabilir.",
      target: pick,
      act: () => pick.click(),
    });
    await page.keyboard.type("vardiya", { delay: 40 });
    await R.step(page, {
      id: "widget-var-olan-sec",
      title: "Kaydı seç",
      text: "Listede kayıt adı ve türü görünür. Seçince kart etkinliğe bağlanır; **×** yalnız bağlantıyı kaldırır, kayıt silinmez.",
      target: opt(page, /Atölye günü vardiya çizelgesi/),
      act: () => opt(page, /Atölye günü vardiya çizelgesi/).click(),
    });

    // --- etkinlik sohbeti ---------------------------------------------------
    const sw = page.getByRole("link", { name: "Etkinliğin kaydına geç (sohbet ve arşiv)" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await R.step(page, {
      id: "etkinlik-sohbet",
      title: "Etkinliğin sohbeti kaydında",
      text: "Başlığın yanındaki **takvim | balon** düğmesi etkinlik sayfası ile etkinliğin **kaydı** arasında geçiş yapar. Sohbet ve arşiv kayıttadır; ikisi aynı etkinliğin iki yüzü.",
      target: sw,
      act: () => sw.click(),
    });
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/);
    await R.step(page, {
      id: "etkinlik-sohbet-sayfa",
      title: "Etkinlik kaydı",
      text: "Burada etkinliğin sohbeti, eylemleri ve eklenen görseller durur. Etkinlik değişiklikleri (tarih, yer, kişi) sohbet akışına sistem satırı olarak düşer. Aynı düğmeyle etkinlik sayfasına dönülür.",
      target: [page.getByRole("heading", { level: 1 }), page.getByRole("complementary", { name: "Sohbet" })],
      click: false,
    });
  },
};
