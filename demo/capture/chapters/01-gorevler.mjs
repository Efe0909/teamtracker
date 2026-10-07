// Bolum 1: Gorevler tablosu — tara, suz, ara, sirala.

import { HOSTS } from "../lib.mjs";
import { btn, chip, nav, opt, pop, tab } from "../ui.mjs";

export default {
  id: "gorevler",
  title: "Görevler: haftayı tara",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Kaan işe önce Görevler tablosuna bakıyor: neyin sırası geldi, hangisi kimde bekliyor, hangisi gecikti?",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "gorevler-ac",
      title: "Görevler'i aç",
      text: "Kenar çubuğundan **Görevler**'e tıkla. Bütün kayıtlar tek tabloda toplanır.",
      target: nav(page, "Görevler"),
      act: () => nav(page, "Görevler").click(),
    });

    await R.step(page, {
      id: "gorevler-tablo",
      title: "Tabloyu oku",
      text: "Her satır bir kayıt. **Hata** (kırmızı) bir şeyin ters gittiğini, **Görev** (mavi) yapılacak işi gösterir. **Etkinlik** etiketi kaydın bir etkinliğin kendi kaydı olduğunu, balon simgesi mesaj sayısını söyler.",
      target: page.locator("table tbody tr").nth(1).locator("td").first(),
      click: false,
    });

    await R.step(page, {
      id: "gorevler-eylemim",
      title: "Sadece benim eylemlerim",
      text: "Üstteki sekmeler hızlı filtredir. **Açık eylemim**, sana atanmış açık eylemi olan kayıtları getirir.",
      target: tab(page, "Açık eylemim"),
      act: () => tab(page, "Açık eylemim").click(),
    });

    await R.step(page, {
      id: "gorevler-eylemim-sonuc",
      title: "Önce bunlara bak",
      text: "Liste kısaldı: Panolar'daki **Açık eylemim** sayacıyla aynı kayıtlar. Sekmeyi **Hepsi**'ne çevirerek tüm tabloya dön.",
      target: page.locator("table tbody"),
      click: false,
      act: () => tab(page, "Hepsi").click(),
    });

    await R.step(page, {
      id: "gorevler-durum",
      title: "Durum filtresini aç",
      text: "Filtre çipleri tek satırda durur. Boş çip kesikli çizgilidir; **Durum**'a tıkla.",
      target: chip(page, "Durum"),
      act: () => chip(page, "Durum").click(),
    });

    await R.step(page, {
      id: "gorevler-durum-sec",
      title: "Durumu seç",
      text: "Listeden **Beklemede**'yi seç: yalnızca bir yanıt, onay ya da malzeme bekleyen kayıtlar kalır.",
      target: opt(page, /Beklemede/),
      act: () => opt(page, /Beklemede/).click(),
    });

    await R.step(page, {
      id: "gorevler-durum-sonuc",
      title: "Filtre çipi dolu görünür",
      text: "Seçili filtre koyu çipte yazar: **Durum: Beklemede**. Sağdaki sayaç kaç kaydın açık/kapalı olduğunu söyler. Filtreler adres çubuğuna yazılır; adresi kopyalayıp ekip arkadaşına gönderebilirsin.",
      target: [chip(page, "Durum"), btn(page, "Temizle")],
      click: false,
    });
    await btn(page, "Temizle").click();

    await R.step(page, {
      id: "gorevler-birim",
      title: "Birime göre süz",
      text: "**Birim** çipi birim ağacını açar. Kayıtlar ağaçtaki yerlerine göre süzülür.",
      target: chip(page, "Birim"),
      act: () => chip(page, "Birim").click(),
    });

    await R.step(page, {
      id: "gorevler-birim-agac",
      title: "Ağaçta ara, favoriye ekle",
      text: "Üstte **Favoriler** (yıldızla işaretlediklerin), altında ağaç durur. Okla dalı aç/kapa; arama kutusu eşleşen dalları kendiliğinden açar.",
      target: pop(page),
      click: false,
    });
    await page.keyboard.type("mekan", { delay: 30 });

    await R.step(page, {
      id: "gorevler-birim-ara",
      title: "Yazdıkça daralır",
      text: "“mekan” yazınca yalnız eşleşen birim ve üstündeki dallar kalır. **Mekan ve Yer Seçimi**'ni seç.",
      target: page.getByRole("option", { name: /Mekan ve Yer Seçimi/ }).first(),
      act: () => page.getByRole("option", { name: /Mekan ve Yer Seçimi/ }).first().click(),
    });

    await R.step(page, {
      id: "gorevler-birim-sonuc",
      title: "Birim filtresi uygulandı",
      text: "Tablo yalnızca o birimdeki kayıtları gösterir. Çipin yanındaki **×** yalnız birim süzgecini kaldırır, **Temizle** hepsini.",
      target: [chip(page, "Birim"), page.locator("table tbody")],
      click: false,
    });
    await btn(page, "Temizle").click();

    const search = page.getByPlaceholder("Başlık veya açıklamada ara…");
    await search.click();
    await search.fill("malzeme");
    await R.step(page, {
      id: "gorevler-ara",
      title: "Başlıkta ve açıklamada ara",
      text: "Arama kutusu başlık ve açıklamayı tarar; yazmayı bırakınca sonuçlar gelir. Türkçe karakterlere duyarsızdır (“afis” de “afiş”i bulur).",
      target: search,
      click: false,
    });
    await search.fill("");

    await R.step(page, {
      id: "gorevler-sirala",
      title: "Sütun başlığına tıklayıp sırala",
      text: "**Son tarih** başlığına tıkla: artan, bir daha tıkla: azalan, üçüncüde sıralama kapanır. Sütun kenarından sürükleyerek genişliği de ayarlayabilirsin.",
      target: page.getByRole("button", { name: /^Son tarih/ }),
      act: () => page.getByRole("button", { name: /^Son tarih/ }).click(),
    });
    await R.step(page, {
      id: "gorevler-sirala-sonuc",
      title: "En yakın tarih üstte",
      text: "Tarihi olmayanlar sona gider. Sıralama tablo başına cihazında hatırlanır.",
      target: page.locator("table tbody tr").first(),
      click: false,
    });
  },
};
