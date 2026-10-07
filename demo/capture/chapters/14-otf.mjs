// Bolum 13: OTF (etkinlik talep formu) — otomatik doldur, duzenle, gozden gecir, Word indir. Kisi: Selin.

import { HOSTS } from "../lib.mjs";
import { btn, cls, opt, pop } from "../ui.mjs";

const EVENT = "Arduino ile Akıllı Ev Atölyesi";

export default {
  id: "otf",
  title: "OTF formu: doldur, gözden geçir, gönder",
  persona: "Selin Arslan",
  role: "SEB iletişim sorumlusu",
  intro: "Üniversiteye etkinlikten en geç üç iş günü önce OTF gönderilmeli. Selin Arduino atölyesinin formunu daha önce doldurulmuş bir formdan başlatıp hazırlıyor.",

  async run({ R, open }) {
    const { page } = await open("Selin Arslan");
    await page.goto(`${HOSTS.dashboard}/events`, { waitUntil: "networkidle" });
    await page.locator("table").getByRole("link", { name: EVENT }).click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}/);

    const card = page.getByText("Etkinlik talep formu (OTF)").first().locator("xpath=ancestor::div[contains(@class,'cardHover')]");
    await card.scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "otf-baslik",
      title: "Etkinlik sayfasındaki OTF widget'ı",
      text: "**OTF** üniversitenin etkinlik talep formudur. Başlıkta **son gönderim günü** hesaplanır: etkinlikten 3 iş günü önce (hafta sonu sayılmaz). Tarih değişirse bu gün de kendiliğinden kayar.",
      target: [
        { t: card.locator('[class*="cardHead"]'), label: "Son gönderim günü" },
        { t: cls(card, "otfDownload"), label: "Dosya ve mail bilgisi" },
      ],
      click: false,
    });

    const autofill = btn(card, "Otomatik doldur");
    await R.step(page, {
      id: "otf-otomatik",
      title: "Önceki formdan başlat",
      text: "**Otomatik doldur**, etkinlikten gelmeyen alanları (amaç, danışman, ekipman talepleri, sorumlular) en son kaydedilen başka bir etkinliğin formundan kopyalar. Hazır bir kalıp olduğu için en hızlı yol bu.",
      target: autofill,
      act: () => autofill.click(),
    });
    await card.getByText("formundan kopyalandı").waitFor();
    await R.step(page, {
      id: "otf-kilit",
      title: "Kopya gözden geçirilene kadar kilitli",
      text: "Kopyalanan formun uyarısı çıktı: **Word indir** kilitli, çünkü eski etkinliğin bilgileri yeni etkinliğe karışabilir. Önce bu etkinliğe göre en az bir alanı güncelle, sonra “gözden geçirdim” de.",
      target: [cls(card, "otfWarn"), btn(card, "Word indir")],
      click: false,
    });

    // --- alanlar ------------------------------------------------------------
    await card.getByLabel("Etkinliğin amacı, içeriği").fill("Arduino ile ışık ve ısıyı kontrol eden akıllı ev maketi kurulumu: sensör okuma, röle sürme ve temel devre bilgisi.");
    await card.getByLabel("Bitiş saati").fill("14:00");
    await card.getByLabel("Danışman / Konuşmacı").fill("Can Özdemir (Teknik Atölye)");
    await card.getByLabel("Katılımcı yaş grubu").fill("18-24");
    await card.getByLabel("Kazanımlar").fill("Katılımcılar Arduino ile sensör okuyup röle sürebilir ve basit bir akıllı ev devresi kurabilir hale gelir.");
    await R.step(page, {
      id: "otf-alanlar",
      title: "Etkinliğe özel alanları güncelle",
      text: "Üstteki gri kutu etkinlikten gelir (ad, tarih, saat, yer, kişi sayısı); onlar burada değişmez. **Amaç**, **bitiş saati**, **danışman**, **yaş grubu** ve **kazanımlar**'ı bu etkinliğe göre yaz.",
      target: [
        card.getByLabel("Etkinliğin amacı, içeriği"),
        card.getByLabel("Bitiş saati"),
        card.getByLabel("Danışman / Konuşmacı"),
        card.getByLabel("Kazanımlar"),
      ],
      click: false,
    });

    // --- ekipman ------------------------------------------------------------
    const power = card.getByLabel("Elektrik adedi");
    await power.fill("8");
    await R.step(page, {
      id: "otf-ekipman",
      title: "Talep edilen hizmetleri işaretle",
      text: "Düzen, ses-görüntü, teknik, ağırlama, temizlik ve diğer hizmetler gruplar halinde. Kutuyu işaretlersen yanında **adet** kutusu çıkar: örneğin her katılımcı masası için **8 priz**.",
      target: card.locator("fieldset").filter({ hasText: "Teknik hizmetler" }),
      click: false,
    });

    // --- sorumlular ---------------------------------------------------------
    const contact3 = page.getByRole("button", { name: /^Sorumlu 3:/ });
    await R.step(page, {
      id: "otf-sorumlu",
      title: "Etkinlik sorumlularını seç",
      text: "Form en fazla **3 sorumlu** ister; telefonları kişilerin profilinden gelir. Kopyalanan formdaki iki kişi duruyor, üçüncüyü ekle.",
      target: contact3,
      act: () => contact3.click(),
    });
    await R.step(page, {
      id: "otf-sorumlu-sec",
      title: "Kaan Demir'i ekle",
      text: "Listeden kişiyi seç. **Yok** seçeneği o yuvayı boşaltır.",
      target: opt(page, /Kaan Demir/),
      act: () => opt(page, /Kaan Demir/).click(),
    });

    // --- kaydet -------------------------------------------------------------
    const save = card.getByRole("button", { name: "Kaydet", exact: true });
    await R.step(page, {
      id: "otf-kaydet",
      title: "Kaydet",
      text: "Form tek parça kaydedilir; **Kaydet**'e basmadıkça yazdıkların sunucuya gitmez (altta “Kaydedilmemiş değişiklikler indirilen dosyaya girmez” uyarısı çıkar). **Vazgeç** son kayıtlı hale döndürür.",
      target: save,
      act: () => save.click(),
    });

    const review = card.getByLabel("Formu gözden geçirdim");
    await R.step(page, {
      id: "otf-gozden",
      title: "“Formu gözden geçirdim”",
      text: "Bu etkinliğe göre bir alan güncellediğin için onay kutusu etkinleşti. İşaretle: form **gözden geçirildi** sayılır ve **Word indir** açılır.",
      target: review,
      act: () => review.click(),
    });

    const word = card.getByRole("link", { name: /Word indir/ });
    await R.step(page, {
      id: "otf-indir",
      title: "Word dosyasını indir",
      text: "**Word indir** kayıtlı formla doldurulmuş .docx dosyasını indirir. Dosyayı **kulüp mail adresinden**, mailin konusuyla birlikte SEB'e gönder; son gün: etkinlikten 3 iş günü önce.",
      target: word,
      act: async () => {
        const [dl] = await Promise.all([page.waitForEvent("download"), word.click()]);
        await dl.path();
      },
    });

    const copy = card.getByRole("button", { name: "Mail konusunu kopyala" });
    await R.step(page, {
      id: "otf-kopyala",
      title: "Dosya adını ve mail konusunu kopyala",
      text: "SEB'in beklediği **dosya adı** ve **mail konusu** hazır gelir; yanlarındaki simgeyle kopyalayıp mailine yapıştır. Etkinlik adı ya da tarihi değişirse bunlar da güncellenir.",
      target: [card.getByRole("button", { name: "Dosya adını kopyala" }), copy],
      act: () => copy.click(),
    });
  },
};
