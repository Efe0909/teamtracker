// Bolum 9: yeni etkinlik — ad, tur (sablon), birim, tarih. Kisi: Kaan.

import { HOSTS, workshopOffset } from "../lib.mjs";
import { btn, chip, cls, dact, dayCell, dlg, opt, pop } from "../ui.mjs";

export const NEW_EVENT = "Havya ve Lehimleme Atölyesi";

export default {
  id: "yeni-etkinlik",
  title: "Yeni etkinlik oluştur",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Ekip kasım ayında bir lehimleme atölyesi daha yapmak istiyor. Kaan etkinliği oluşturuyor; tür seçilince plan kendiliğinden geliyor.",

  async run({ R, open }) {
    // Pencere uzun: tum form tek goruntude gorunsun.
    const { page } = await open("Kaan Demir", { height: 1180 });
    await page.goto(`${HOSTS.dashboard}/events`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "yeni-etk-ac",
      title: "Yeni etkinlik düğmesine bas",
      text: "Etkinlikler sayfasında sağ üstteki **Yeni etkinlik**'e tıkla. Etkinlik hem takvimde hem kendi sayfasında hem de bir **kayıt** olarak (sohbet ve arşiv için) açılır.",
      target: btn(page, /Yeni etkinlik/),
      act: () => btn(page, /Yeni etkinlik/).click(),
    });

    const d = dlg(page, "Yeni etkinlik");
    await d.getByPlaceholder("Örn. DC araba atölyesi").fill(NEW_EVENT);
    await d.getByLabel("Açıklama").fill("Katılımcılar havya ile devre kartı lehimlemeyi öğrenip küçük bir LED devresi kuracak. Kontenjan 20 kişi.");
    await R.step(page, {
      id: "yeni-etk-ad",
      title: "Adı ve açıklamayı yaz",
      text: "**Ad** en az 5, **Açıklama** en az 30 karakter olmalı. Açıklamada *ne yapılacağını, neden ve kimin için* olduğunu söyle; OTF ve duyurular bu metne dayanır.",
      target: [d.getByPlaceholder("Örn. DC araba atölyesi"), d.getByLabel("Açıklama")],
      click: false,
    });

    await R.step(page, {
      id: "yeni-etk-tur",
      title: "Etkinlik türünü seç",
      text: "**Tür** etkinliğin hangi planla yürüyeceğini belirler. Türler **Veri yönetimi → Etkinlik Türleri** altında tanımlıdır.",
      target: chip(d, "Tür"),
      act: () => chip(d, "Tür").click(),
    });
    await R.step(page, {
      id: "yeni-etk-tur-sec",
      title: "Atölye'yi seç",
      text: "Listede ekibin tanımladığı türler var: toplantı, atölye, eğitim, saha ziyareti, konferans, yarışma, sosyal etkinlik.",
      target: opt(page, /^Atölye/),
      act: () => opt(page, /^Atölye/).click(),
    });
    await R.step(page, {
      id: "yeni-etk-sablon",
      title: "Tür seçince plan hazır gelir",
      text: "**Atölye şablonu** otomatik yüklenir: etkinliğe bağlanacak **widget'lar** (OTF formu, satın alımlar) ve **zaman çizelgesi** adımları, etkinlik gününe göre kaç gün önce yapılacaklarıyla birlikte.",
      target: cls(d, "evTemplate"),
      click: false,
    });

    await R.step(page, {
      id: "yeni-etk-birim",
      title: "Etkinliğin kaydı hangi birimde dursun?",
      text: "**Birim**, etkinliğin kendi kaydının (sohbet + arşiv) açılacağı yeri seçer. Etkinlik işleri için genelde **Etkinlik Planlama** uygundur.",
      target: chip(d, "Birim"),
      act: () => chip(d, "Birim").click(),
    });
    await R.step(page, {
      id: "yeni-etk-birim-sec",
      title: "Etkinlik Planlama'yı seç",
      text: "Birim ağacı kayıtlardaki ağaçla aynı: favoriler üstte, aranabilir, dallar açılıp kapanır.",
      target: opt(page, /^Etkinlik Planlama/).first(),
      act: () => opt(page, /^Etkinlik Planlama/).first().click(),
    });

    const when = d.getByRole("button", { name: /^Tarih:/ });
    await R.step(page, {
      id: "yeni-etk-tarih",
      title: "Tarihi seç (ya da boş bırak)",
      text: "**Tarih** boş bırakılırsa etkinlik **Havuz**'a düşer; fikir aşamasında tarih gerekmez. Tarih verince etkinlik takvimde görünür.",
      target: when,
      act: () => when.click(),
    });
    const target = workshopOffset() + 28;
    while ((await dayCell(page, target).count()) === 0) await pop(page).getByRole("button", { name: "Sonraki ay" }).click();
    await R.step(page, {
      id: "yeni-etk-takvim",
      title: "Ayı ve günü seç",
      text: "Ay okları takvimi ileri geri sürer. Cumartesi atölyeleri için kasımın uygun Cumartesi gününü seç; gün seçilince takvim kapanır.",
      target: dayCell(page, target),
      act: () => dayCell(page, target).click(),
    });

    const create = dact(d).getByRole("button", { name: "Oluştur" });
    await R.step(page, {
      id: "yeni-etk-olustur",
      title: "Oluştur",
      text: "Alanlar tamamsa **Oluştur** etkinleşir. Etkinlik, kaydı ve şablondaki adımlar tek seferde açılır; doğrudan etkinliğin sayfasına geçersin.",
      target: create,
      act: () => create.click(),
    });
    await page.waitForURL(/\/events\/[0-9a-f-]{36}/);

    await R.step(page, {
      id: "yeni-etk-sayfa",
      title: "Etkinlik hazır",
      text: "Sayfada **zaman çizelgesi** (sağ üst) ve **widget'lar** (OTF formu, satın alımlar) şablondan geldi. Adımların tarihleri etkinlik gününe göre hesaplandı: örneğin OTF son gönderim tarihi kendiliğinden görünür.",
      target: [
        { t: page.getByRole("heading", { level: 1 }), label: "Etkinlik" },
        { t: page.getByRole("complementary", { name: "Etkinlik özeti" }).locator("section").first(), label: "Zaman çizelgesi" },
      ],
      click: false,
    });

    // --- ozellikleri tamamla ------------------------------------------------
    const place = chip(page, "Yer");
    await R.step(page, {
      id: "yeni-etk-yer",
      title: "Yeri listeden seç",
      text: "Etkinlik açılınca **Özellikler**'den eksikleri tamamlarsın. **Yer** listesi **Veri yönetimi → Etkinlik Yerleri**'nden gelir; listede yoksa **Diğer… (yaz)** ile serbest metin girebilirsin.",
      target: place,
      act: () => place.click(),
    });
    await R.step(page, {
      id: "yeni-etk-yer-sec",
      title: "Maker Atölyesi'ni seç",
      text: "Ortak yerleri listeden seçmek yazım hatalarını önler; OTF formu ve takvim bu adı kullanır.",
      target: opt(page, /^Maker Atölyesi/),
      act: () => opt(page, /^Maker Atölyesi/).click(),
    });

    const time = page.getByRole("button", { name: /^Başlangıç saati:/ });
    await R.step(page, {
      id: "yeni-etk-saat",
      title: "Başlangıç saatini ekle",
      text: "Tarih verildiği için **Saat ekle** çıktı (tarihsiz etkinliğin saati olmaz). Tıkla, saati yaz, **Kaydet**'e bas.",
      target: time,
      act: async () => {
        await time.click();
        await pop(page).getByLabel("Başlangıç saati").fill("10:00");
        await pop(page).getByRole("button", { name: "Kaydet" }).click();
      },
    });

    const people = page.getByRole("button", { name: /^Beklenen kişi sayısı:/ });
    await R.step(page, {
      id: "yeni-etk-katilim",
      title: "Beklenen kişi sayısını yaz",
      text: "**Katılım**, OTF formundaki katılımcı sayısı ve takvimdeki kişi sütunu olarak kullanılır. Sayıyı yazıp **Kaydet**.",
      target: people,
      act: async () => {
        await people.click();
        await pop(page).getByLabel("Beklenen kişi sayısı").fill("20");
        await pop(page).getByRole("button", { name: "Kaydet" }).click();
      },
    });
    await R.step(page, {
      id: "yeni-etk-bitti",
      title: "Özellikler tamam",
      text: "Etkinliğin tarihi, saati, yeri ve katılımı dolu. Her değişiklik sohbet akışına ve etkinliğin kaydına yazılır; önem ve sorumluyu da aynı satırlardan değiştirebilirsin.",
      target: page.locator('[class*="propsPanel"]'),
      click: false,
    });
  },
};
