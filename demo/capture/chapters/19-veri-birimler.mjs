// Bolum 19: Veri yonetimi — birim agaci (Etkinlik dali). Kisi: Kaan (Birim Editoru).

import { HOSTS } from "../lib.mjs";
import { btn, cls, dact, nav } from "../ui.mjs";

export const NEW_UNIT = "Sponsor ve Ödül Planı";

export default {
  id: "veri-birimler",
  title: "Veri yönetimi: birim ağacı",
  persona: "Kaan Demir",
  role: "Birim editörü",
  intro: "Kayıtların hangi işe ait olduğunu söyleyen birim ağacı, Veri yönetimi'nde tutulur. Kaan Etkinlik dalının yapısına bakıyor ve yeni bir birim ekliyor.",

  async run({ R, open }) {
    // Agac uzun: tum dal tek goruntude gorunsun.
    const { page } = await open("Kaan Demir", { height: 1500 });
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });
    // Her goruntu agacin bittigi yerde kirpilir (alt kisim bos sayfa olmasin).
    const tree = page.locator('[class*="tnode"]').first().locator("xpath=..");
    const clip = { clipTo: tree };

    await R.step(page, {
      id: "veri-ac",
      title: "Veri yönetimi'ni aç",
      text: "Kenar çubuğundan **Veri yönetimi**'ne tıkla. Burası kayıtların, etkinliklerin ve formların dayandığı **ortak listelerin** düzenlendiği yer.",
      target: nav(page, "Veri yönetimi"),
      act: () => nav(page, "Veri yönetimi").click(),
    });
    await R.step(page, {
      ...clip,
      id: "veri-kokler",
      title: "Üç kök liste",
      text: "**Birimler** serbest bir ağaçtır (türünü ve yapısını sen seçersin). **Etkinlik Türleri** ve **Etkinlik Yerleri** yönetilen listelerdir. Kökler koddan gelir (kilit simgesi), yalnız adları ve açıklamaları değişir. Her değişiklik anında uygulanır.",
      target: [cls(page, "treeBar"), page.locator('[class*="tnode"]').first().locator("xpath=..")],
      click: false,
    });

    const fold = (name) => page.getByRole("button", { name: `${name}: alt düğümleri aç`, exact: true });
    await R.step(page, {
      ...clip,
      id: "veri-birimler-ac",
      title: "Birimler'in okuna bas",
      text: "Satırdaki **ok** alt dalları açar. **Birimler**'in altında tek dal var: **Etkinlik**.",
      target: fold("Birimler"),
      act: () => fold("Birimler").click(),
    });
    await fold("Etkinlik").click();
    for (const m of ["Takvim Planlama", "Etkinlik Planlama", "SEB iletişim"]) await fold(m).click();

    await R.step(page, {
      ...clip,
      id: "veri-agac",
      title: "Etkinlik dalı: hücre → makine → görev/adım",
      text: "Her düğümün yanında **türü** yazar: **Cell** (ana hücre), **Makine** (iş kolu), **Görev** ve **Adım**. Altındaki satır kısa **açıklamadır**. Sağdaki sayı alt düğüm sayısı; renkli bağlantılar o birimde çalışan **takımlardır**.",
      target: tree,
      click: false,
    });

    // --- duzenle ------------------------------------------------------------
    const edit = page.getByRole("button", { name: "Mekan ve Yer Seçimi: düzenle" });
    await R.step(page, {
      ...clip,
      id: "veri-duzenle",
      title: "Düğümü düzenle",
      text: "Satırdaki **kalem** düğümün adını, türünü, yapısını, **üst düğümünü** (taşımak için) ve açıklamasını değiştirir. Ad en az 5, açıklama (varsa) en az 30 karakter olmalı.",
      target: edit,
      act: () => edit.click(),
    });
    await R.step(page, {
      ...clip,
      id: "veri-duzenle-form",
      title: "Düzenleme paneli satırın altında açılır",
      text: "**Tür** seçenekleri üst düğümün kuralına göre gelir (makinenin altına görev ya da adım eklenir). **Üst düğüm** listesi yalnız bu türü kabul eden dalları gösterir. Vazgeçmek için **Vazgeç**.",
      target: page.locator("li").filter({ has: edit }).locator("form"),
      click: false,
    });
    await page.locator("li").filter({ has: edit }).locator("form").getByRole("button", { name: "Vazgeç" }).click();

    // --- ekle ---------------------------------------------------------------
    const plus = page.getByRole("button", { name: "Etkinlik Planlama: alt düğüm ekle" });
    await R.step(page, {
      ...clip,
      id: "veri-ekle",
      title: "Alt düğüm ekle",
      text: "Satırdaki **+** o birimin altına yeni bir düğüm ekler. **Etkinlik Planlama**'nın altına yeni bir görev ekleyelim.",
      target: plus,
      act: () => plus.click(),
    });
    const form = page.locator("li").filter({ has: plus }).locator("form");
    await form.getByPlaceholder("alt düğüm adı").fill(NEW_UNIT);
    await form.getByPlaceholder("açıklama (isteğe bağlı)").fill("Sponsor adaylarının ve etkinlik ödüllerinin planlandığı görev.");
    await R.step(page, {
      ...clip,
      id: "veri-ekle-form",
      title: "Adı, türü ve açıklamayı gir",
      text: "**Tür** ve **Yapı** (ağaç / liste / yaprak) seçilir; **Açıklama** isteğe bağlıdır ama ekibe neyin nereye ait olduğunu anlatır. **Ekle**'ye bas.",
      target: form,
      act: () => form.getByRole("button", { name: "Ekle", exact: true }).click(),
    });
    const fresh = page.locator('[class*="tnode"]').filter({ hasText: NEW_UNIT });
    await fresh.first().waitFor();
    await R.step(page, {
      ...clip,
      id: "veri-ekle-sonuc",
      title: "Yeni birim ağaçta",
      text: "Yeni düğüm kardeşlerinin sonuna eklendi. Bu andan itibaren **Yeni kayıt** penceresinde ve kayıt sayfasında **Birim** listesinde seçilebilir.",
      target: fresh.first(),
      click: false,
    });

    // --- pasiflestir --------------------------------------------------------
    const off = page.getByRole("button", { name: `${NEW_UNIT}: pasifleştir` });
    await R.step(page, {
      ...clip,
      id: "veri-pasif",
      title: "Silme yerine pasifleştir",
      text: "Artık kullanılmayan bir birimi **silme**, **pasifleştir**. Geçmiş kayıtlar adını göstermeye devam eder; yeni kayıt ve listelerde çıkmaz. İstersen **Yeniden aç** ile geri getirirsin.",
      target: off,
      act: () => off.click(),
    });
    await R.step(page, {
      ...clip,
      id: "veri-pasif-sonuc",
      title: "Düğüm pasif",
      text: "Satır soluklaştı ve yanında **pasif** yazıyor. Kalıcı silme yalnızca “kalıcı sil” yetkisi olanlarda, düzenleme panelinin içinde ve bağlı kayıt sayısı gösterilerek yapılır.",
      target: fresh.first(),
      click: false,
    });

    // --- ara ----------------------------------------------------------------
    const search = page.getByLabel("Ağaçta ara");
    await search.fill("malzeme");
    await R.step(page, {
      ...clip,
      id: "veri-ara",
      title: "Ağaçta ara",
      text: "Arama kutusu ad ve açıklamada arar; eşleşen düğümleri ve **üstlerini** gösterir, dalları kendiliğinden açar. Aramayı silince bulduğun yerde kalırsın.",
      target: [search, page.locator('[class*="tnode"]').filter({ hasText: "Malzeme ve Kaynak Planlama" }).first()],
      click: false,
    });
    await search.fill("");
  },
};
