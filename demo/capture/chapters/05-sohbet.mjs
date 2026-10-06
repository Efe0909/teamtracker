// Bolum 5: kaydin sohbeti — gorsel ac, yanitla, @anma, gorsel gonder, hizli eylem, bildirim.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOSTS, settle } from "../lib.mjs";
import { btn, dlg, menuItem, opt, pop } from "../ui.mjs";

const TITLE = "Arduino atölyesi afiş ve duyuru görselleri";
const PLAN = fileURLToPath(new URL("../../out/assets/layout.png", import.meta.url));

export default {
  id: "sohbet",
  title: "Sohbet: konuş, an, görsel paylaş",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Afiş taslakları hakkında konuşulan kayıtta Kaan baskı teklifine yanıt veriyor, Elif'i anıyor ve yerleşim planını paylaşıyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    const row = page.locator('section[aria-labelledby="pinned-h"]').getByRole("link", { name: new RegExp(TITLE) });
    await R.step(page, {
      id: "sohbet-ac",
      title: "Sabitlediğin kaydı Panolar'dan aç",
      text: "Panolar'daki **Sabitlenenler** listesi, takip ettiğin kayıtlara tek tıkla götürür.",
      target: row,
      act: () => row.click(),
    });
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/);

    const chat = page.getByRole("complementary", { name: "Sohbet" });
    await R.step(page, {
      id: "sohbet-genel",
      title: "Her kaydın kendi sohbeti var",
      text: "Sağdaki **Sohbet** sütunu bu işe özel. Mesajlar, görseller ve sistem satırları (durum, tarih, eylem değişiklikleri) **tek akışta**, zaman sırasıyla durur. Yeni mesajlar altta.",
      target: chat,
      click: false,
    });

    // --- gorseli buyut ------------------------------------------------------
    const thumb = chat.getByRole("button", { name: /^Görseli aç/ }).last();
    await R.step(page, {
      id: "sohbet-gorsel-ac",
      title: "Görsele tıklayıp büyüt",
      text: "Sohbette paylaşılan görseller küçük görünür. Tıklayınca pencerede tam boyutu açılır.",
      target: thumb,
      act: () => thumb.click(),
    });
    await R.step(page, {
      id: "sohbet-gorsel-buyuk",
      title: "Tam boyutta incele",
      text: "Pencerede görsel büyük görünür; **Tam boyut** yeni sekmede açar. Etiketleme yetkisi olanlar buradan etiket de ekler. **Esc** ile kapat.",
      target: dlg(page),
      click: false,
    });
    await page.keyboard.press("Escape");

    // --- yanitla + anma -----------------------------------------------------
    const reply = chat.getByRole("button", { name: "Yanıtla" }).last();
    await R.step(page, {
      id: "sohbet-yanitla",
      title: "Bir mesaja yanıt ver",
      text: "Mesajın altındaki **Yanıtla**, cevabını o mesaja bağlar; kalabalık sohbette neye cevap verdiğin belli olur.",
      target: reply,
      act: () => reply.click(),
    });

    const box = chat.getByLabel("Mesaj", { exact: true });
    await box.type("@el", { delay: 40 });
    await R.step(page, {
      id: "sohbet-anma",
      title: "@ yazınca kişi önerilir",
      text: "Adın başına **@** koy: öneriler çıkar. **Enter** ya da **Tab** ilkini seçer. Anılan kişi bildirim alır ve kayda **katılımcı** olarak eklenir. Grup anmaları da var: **@all** (sohbetteki herkes), **@here** (son 10 dakikada görülenler), **@team** (kaydın takımı).",
      target: chat.getByRole("listbox", { name: "Anma önerileri" }),
      click: false,
    });
    await page.keyboard.press("Tab");
    await box.type("15 adet yeterli. Onaylarsan Mert siparişi hemen versin.", { delay: 15 });
    await R.step(page, {
      id: "sohbet-yaz",
      title: "Mesajını tamamla ve gönder",
      text: "Üstte yanıt verdiğin mesaj gri şeritte görünür (**×** ile vazgeçilir). **Enter** gönderir, **Shift+Enter** yeni satır açar; **Gönder** düğmesi de aynı işi yapar.",
      target: [chat.locator("form"), btn(page, "Gönder").last()],
      act: () => chat.getByRole("button", { name: "Gönder", exact: true }).click(),
    });
    await R.step(page, {
      id: "sohbet-sonuc",
      title: "Mesajın gitti",
      text: "Senin mesajların **mor**, başkalarınınkiler gri balonda. Anma vurgulu görünür; yanıt verdiğin mesaj balonun üstünde alıntılanır, tıklayınca ona kayar.",
      target: chat.locator('[id^="event-"]').last(),
      click: false,
    });

    // --- gorsel gonder ------------------------------------------------------
    const picker = chat.getByRole("button", { name: "Görsel ekle" });
    await R.step(page, {
      id: "sohbet-gorsel-ekle",
      title: "Görsel eklemek için resim simgesi",
      text: "Mesaj kutusunun solundaki **resim simgesi** dosya seçtirir. Bir mesaja en fazla **4 görsel** eklenir; yükleme seçer seçmez başlar.",
      target: picker,
      act: async () => {
        await chat.locator('input[type="file"]').setInputFiles({
          name: "yerlesim-plani.png", mimeType: "image/png", buffer: readFileSync(PLAN),
        });
        await chat.getByText("yerlesim-plani.png").waitFor();
        await settle(page, 300);
      },
    });
    await box.fill("Yerleşim planının güncel hali ekte; kayıt masası girişin hemen yanında.");
    await R.step(page, {
      id: "sohbet-gorsel-hazir",
      title: "Seçilen görsel mesajla gider",
      text: "Dosya adı kutunun üstünde çıkar; yanlışsa **×** ile çıkarılır. Metin yazmak zorunlu değil: yalnız görsel de gönderilebilir.",
      target: [chat.getByText("yerlesim-plani.png"), box],
      act: () => chat.getByRole("button", { name: "Gönder", exact: true }).click(),
    });
    await R.step(page, {
      id: "sohbet-gorsel-sonuc",
      title: "Görsel sohbette",
      text: "Görsel metnin **üstünde** görünür. Aynı görseli kayda kalıcı koymak istersen bir **Medya eki** kartı kullan (Kartlar bölümünde).",
      target: chat.locator('[id^="event-"]').last(),
      click: false,
    });

    // --- hizli eylem --------------------------------------------------------
    const quick = btn(page, "Hızlı eylem");
    await R.step(page, {
      id: "sohbet-hizli",
      title: "Sohbetten çıkmadan eylem aç",
      text: "Konuşurken bir iş çıktıysa **⚡ Hızlı eylem**'e bas: “kim ne yapacak?” formu pencerede açılır. Eylem, kaydın **Eylemler** listesine eklenir.",
      target: quick,
      act: () => quick.click(),
    });
    const q = dlg(page, "Hızlı eylem");
    await q.getByLabel("Eylem başlığı").fill("Baskı siparişini ver (15 adet)");
    await q.getByRole("button", { name: /^Eylemin sahibi:/ }).click();
    await opt(page, /Mert Yıldız/).click();
    await R.step(page, {
      id: "sohbet-hizli-form",
      title: "Başlığı yaz, sahibini seç",
      text: "Yeni eylem formuyla aynı alanlar: başlık, tarih, sahip. **Ekle**'ye basınca pencere kapanır, eylem listeye düşer.",
      target: q,
      act: () => q.getByRole("button", { name: "Ekle", exact: true }).click(),
    });
    await q.waitFor({ state: "hidden" });

    // --- bildirim tercihi ---------------------------------------------------
    const bell = page.getByRole("button", { name: /^Bildirim:/ });
    await R.step(page, {
      id: "sohbet-bildirim",
      title: "Bu sohbetin bildirimlerini ayarla",
      text: "Sohbetin üstündeki **zil** sadece bu kayıt için bildirim düzeyini seçtirir: **her hareket**, **yalnızca anıldığımda** ya da **sessize al**. Kalabalık bir kaydı susturmak için ideal.",
      target: bell,
      act: () => bell.click(),
    });
    await R.step(page, {
      id: "sohbet-bildirim-menu",
      title: "Düzeyi seç",
      text: "**Varsayılan**, kişisel bildirim ayarını izler (profilinden değişir). Bir düzey seçersen yalnız bu sohbet için o geçerli olur.",
      target: pop(page),
      click: false,
    });
    await page.keyboard.press("Escape");
  },
};
