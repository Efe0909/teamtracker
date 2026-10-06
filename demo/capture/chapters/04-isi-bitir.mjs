// Bolum 4: isi bitir — durum, eylem kapatma (kapanis notu), kayit kapatma kurali.
// Bolum 3'te Kaan'in Can'a atadigi iki eylemi surdurur.

import { HOSTS, recordId } from "../lib.mjs";
import { chip, dact, dlg, opt } from "../ui.mjs";
import { TITLE } from "./03-kayit-sayfasi.mjs";

const A1 = "Çalışma adalarındaki priz sayısını say";
const A2 = "Eksik kablo ve priz listesini Elif'e ilet";

export default {
  id: "isi-bitir",
  title: "İşi bitir ve kaydı kapat",
  persona: "Can Özdemir",
  role: "Atölye sorumlusu",
  intro: "Can kendisine atanan iki eylemi tek tek bitiriyor, sonra işin tamamını kapatıyor. Her kapanışta kısa bir not bırakıyor.",

  async run({ R, open }) {
    recordId(TITLE);
    const { page } = await open("Can Özdemir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    // --- bana atananlar -----------------------------------------------------
    const tile = page.getByRole("link", { name: /Açık eylemim/ });
    await R.step(page, {
      id: "bitir-panolar",
      title: "Güne “Açık eylemim” ile başla",
      text: "Panolar'daki **Açık eylemim** sayacı, sana atanmış ve bitmemiş eylemleri sayar. Kaan'ın eklediği iki eylem de bu sayıya yazıldı. Sayaca tıkla.",
      target: tile,
      act: () => tile.click(),
    });
    const row = page.getByRole("link", { name: TITLE });
    await R.step(page, {
      id: "bitir-liste",
      title: "Sana ait kayıtlar listelenir",
      text: "Liste yalnızca üzerinde açık eylemin olan kayıtları gösterir. Kaydı aç.",
      target: row,
      act: () => row.click(),
    });
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/);

    // --- durum --------------------------------------------------------------
    await R.step(page, {
      id: "bitir-durum",
      title: "İşe başlayınca durumu güncelle",
      text: "Kayıt **Açık** durumda. İşe başladığında **Durum** satırından değiştir; ekip kaydın ilerlediğini tabloda ve Panolar'da görür.",
      target: chip(page, "Durum"),
      act: () => chip(page, "Durum").click(),
    });
    await R.step(page, {
      id: "bitir-durum-sec",
      title: "Devam'ı seç",
      text: "**Açık** → **Devam** (üzerinde çalışılıyor) → **Beklemede** (başkasından yanıt, onay ya da malzeme bekleniyor) → **Kapandı**.",
      target: opt(page, /Devam/),
      act: () => opt(page, /Devam/).click(),
    });

    // --- ilk eylem ----------------------------------------------------------
    const done1 = page.getByRole("button", { name: `${A1} — bitti` });
    await R.step(page, {
      id: "bitir-eylem",
      title: "Eylemi bitir",
      text: "Eylemin sağındaki **✓** düğmesi onu bitirir. Bitirirken bir **kapanış notu** istenir: ne yapıldı, sonuç ne?",
      target: done1,
      act: () => done1.click(),
    });
    const d1 = dlg(page, "Eylemi kapat");
    await d1.getByLabel("Kapanış notu").fill("Altı çalışma adasının altısında da priz sayıldı; toplam 9 priz ve 4 uzatma kablosu eksik çıktı.");
    await R.step(page, {
      id: "bitir-eylem-not",
      title: "Kapanış notunu yaz",
      text: "Not en az **30 karakter** olmalı; sayaç altta. Sonradan “bu iş nasıl bitmişti?” diye bakan herkes bu satırı okuyacak.",
      target: d1.getByLabel("Kapanış notu"),
      click: false,
    });
    await R.step(page, {
      id: "bitir-eylem-kapat",
      title: "Kapat'a bas",
      text: "Not yeterliyse **Kapat** etkinleşir. Eylem biter, notu satırın yanında kalır.",
      target: dact(d1).getByRole("button", { name: "Kapat" }),
      act: () => dact(d1).getByRole("button", { name: "Kapat" }).click(),
    });
    const acts = page.locator('section[aria-labelledby="acts-h"]');
    await R.step(page, {
      id: "bitir-eylem-sonuc",
      title: "Eylem tamamlandı",
      text: "Biten eylem listenin altına iner ve soluklaşır; başlıkta **“1 açık · 1 bitti”** yazar. Notu eylemin yanındadır.",
      target: acts,
      click: false,
    });

    // --- kayit kapatma kurali -----------------------------------------------
    await R.step(page, {
      id: "bitir-engel",
      title: "Açık eylem varken kayıt kapanmaz",
      text: "Durum listesinde **Kapandı** soluk ve yanında **“1 açık eylem”** yazıyor. Önce kalan eylemi bitirmen gerekir; kural reddedilince değil, daha seçmeden söylenir.",
      target: chip(page, "Durum"),
      act: () => chip(page, "Durum").click(),
    });
    await R.step(page, {
      id: "bitir-engel-liste",
      title: "Kapandı seçilemiyor",
      text: "Listeyi kapat (**Esc**) ve ikinci eylemi bitir.",
      target: opt(page, /Kapandı/),
      click: false,
    });
    await page.keyboard.press("Escape");

    // ikinci eylem (kisa yol)
    await page.getByRole("button", { name: `${A2} — bitti` }).click();
    const d2 = dlg(page, "Eylemi kapat");
    await d2.getByLabel("Kapanış notu").fill("Eksik priz ve kablo listesi Elif'e e-postayla iletildi; fiyat teklifi gelince tekrar bakılacak.");
    await dact(d2).getByRole("button", { name: "Kapat" }).click();
    await d2.waitFor({ state: "hidden" });

    // --- kaydi kapat --------------------------------------------------------
    await R.step(page, {
      id: "bitir-kayit",
      title: "Şimdi kaydı kapatabilirsin",
      text: "İki eylem de bitti, başlık **“0 açık · 2 bitti”** diyor. **Durum**'u tekrar aç.",
      target: [chip(page, "Durum"), acts],
      act: () => chip(page, "Durum").click(),
    });
    await R.step(page, {
      id: "bitir-kayit-sec",
      title: "Kapandı'yı seç",
      text: "**Kapandı** artık seçilebilir. Seçince kaydın kapanış notunu soran pencere açılır.",
      target: opt(page, /Kapandı/),
      act: () => opt(page, /Kapandı/).click(),
    });
    const d3 = dlg(page, "Kaydı kapat");
    await d3.getByLabel("Kapanış notu").fill("İhtiyaç sayıldı ve listelendi; kalan alım işi Maliye takımının takibinde, bu kayıt tamamlandı.");
    await R.step(page, {
      id: "bitir-kayit-not",
      title: "Kaydın kapanış notunu yaz",
      text: "Kayıt notu, işin **sonucunu** özetler: ne yapıldı, geriye ne kaldı, kim devraldı. Yine en az 30 karakter.",
      target: d3.getByLabel("Kapanış notu"),
      click: false,
    });
    await R.step(page, {
      id: "bitir-kayit-kapat",
      title: "Kaydı kapat",
      text: "**Kapat**'a bas. Kapalı kayıt silinmez; arşivde durur, istenirse **Durum**'dan yeniden açılabilir.",
      target: dact(d3).getByRole("button", { name: "Kapat" }),
      act: () => dact(d3).getByRole("button", { name: "Kapat" }).click(),
    });
    await R.step(page, {
      id: "bitir-kayit-sonuc",
      title: "Kayıt kapandı",
      text: "Durum **Kapandı**; kapanış notu açıklamanın altında görünür. “Top kimde” satırı kalktı çünkü iş bitti. Panolar'daki ve Görevler'deki açık sayıları da bir düştü.",
      target: [page.getByText(/^Kapanış notu:/), chip(page, "Durum")],
      click: false,
    });
  },
};
