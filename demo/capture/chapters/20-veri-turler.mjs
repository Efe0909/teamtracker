// Bolum 20: Veri yonetimi — etkinlik turleri (sablon: adimlar + widget'lar) ve etkinlik yerleri.
// Kisi: Kaan (Liste Yoneticisi).

import { HOSTS } from "../lib.mjs";
import { cls } from "../ui.mjs";

export default {
  id: "veri-turler",
  title: "Veri yönetimi: etkinlik türleri ve yerleri",
  persona: "Kaan Demir",
  role: "Liste yöneticisi",
  intro: "Yeni etkinlik açarken seçilen türler ve yerler de Veri yönetimi'nden gelir. Kaan atölye türünün şablonuna ve yer listesine bakıyor, eksik bir yer ekliyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir", { height: 1400 });
    await page.goto(`${HOSTS.dashboard}/outcome-tree`, { waitUntil: "networkidle" });
    const tree = page.locator('[class*="tnode"]').first().locator("xpath=..");
    const clip = { clipTo: tree };
    const fold = (name) => page.getByRole("button", { name: `${name}: alt düğümleri aç`, exact: true });
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const row = (name) => page.locator('[class*="tnode"]').filter({ has: page.locator('[class*="tname"]', { hasText: new RegExp(`^${esc(name)}$`) }) }).first();

    await R.step(page, {
      ...clip,
      id: "tur-ac",
      title: "Etkinlik Türleri'ni aç",
      text: "**Etkinlik Türleri** kökünün okuna bas: ekibin tanımladığı türler listelenir. Yeni etkinlik oluştururken **Tür** listesi buradan gelir.",
      target: fold("Etkinlik Türleri"),
      act: () => fold("Etkinlik Türleri").click(),
    });
    await R.step(page, {
      ...clip,
      id: "tur-liste",
      title: "Sekiz tür",
      text: "Her tür bir **seçenek** (option) düğümüdür: Toplantı, Atölye, Eğitim, Saha ziyareti, Konferans, Yarışma, Sosyal… Sayı, türün altındaki bölümleri gösterir. Tür düğümünü sistem atar; yalnız **ad ve açıklamayı** değiştirirsin.",
      target: tree,
      click: false,
    });

    await fold("Atölye").click();
    await R.step(page, {
      ...clip,
      id: "tur-bolum",
      title: "Her türün iki bölümü var",
      text: "**Adımlar** o türdeki etkinliğe otomatik gelecek **zaman çizelgesi adımları**nı, **Widget'lar** otomatik eklenecek **widget'ları** (OTF formu, satın alımlar) tutar. İkisi de kendiliğinden açılır, silinemez (kilit).",
      target: row("Atölye"),
      click: false,
    });

    await fold("Adımlar").click();
    await R.step(page, {
      ...clip,
      id: "tur-adimlar",
      title: "Adımlar: etkinlikten kaç gün önce?",
      text: "Her adımın yanında **gün farkı** yazar (örneğin **−21 gün** = etkinlikten 21 gün önce). Yeni bir atölye açıldığında bu adımlar kendi tarihleriyle zaman çizelgesine kopyalanır. Hazırlık en geç 7 gün önce bitmeli: daha yakın adım **uyarı simgesi** alır.",
      target: tree,
      click: false,
    });

    const add = page.getByRole("button", { name: "Adımlar: alt düğüm ekle" });
    await R.step(page, {
      ...clip,
      id: "tur-adim-ekle",
      title: "Şablona yeni adım ekle",
      text: "**Adımlar** satırındaki **+** şablona adım ekler. Eklenen adım yalnızca **bundan sonra açılan** atölyelere gelir; mevcut etkinlikler değişmez.",
      target: add,
      act: () => add.click(),
    });
    const form = page.locator("li").filter({ has: add }).locator("form");
    await form.locator("input").first().fill("Katılımcı listesi kesinleşti");
    await form.locator('input[type="number"]').fill("-8");
    await R.step(page, {
      ...clip,
      id: "tur-adim-form",
      title: "Adı ve gün farkını yaz",
      text: "**Eksi** değer etkinlikten **önce** demektir: **−8** etkinlikten 8 gün önce. Alanları doldurup **Ekle**'ye bas.",
      target: form,
      act: () => form.getByRole("button", { name: "Ekle", exact: true }).click(),
    });
    await R.step(page, {
      ...clip,
      id: "tur-adim-sonuc",
      title: "Adım şablonda",
      text: "Yeni adım listeye girdi. Yanlışlık olursa satırdaki **pasifleştir** düğmesi adımı şablondan çıkarır; silmeden geri getirilebilir.",
      target: row("Katılımcı listesi kesinleşti"),
      click: false,
    });

    // --- yerler -------------------------------------------------------------
    await fold("Etkinlik Yerleri").click();
    await R.step(page, {
      ...clip,
      id: "yer-liste",
      title: "Etkinlik Yerleri",
      text: "**Etkinlik Yerleri**, etkinlik sayfasındaki **Yer** listesidir. Düz bir listedir: her yer tek bir düğümdür. Listede olmayan bir yer için etkinlikte **Diğer… (yaz)** kullanılır; sık kullanılanları buraya ekle.",
      target: row("Etkinlik Yerleri"),
      click: false,
    });

    const plus = page.getByRole("button", { name: "Etkinlik Yerleri: alt düğüm ekle" });
    await R.step(page, {
      ...clip,
      id: "yer-ekle",
      title: "Yeni yer ekle",
      text: "**Etkinlik Yerleri** satırındaki **+**'ya bas.",
      target: plus,
      act: () => plus.click(),
    });
    const yform = page.locator("li").filter({ has: plus }).locator("form");
    await yform.locator("input").first().fill("Amfi Tiyatro (C Blok)");
    await yform.locator("textarea").fill("Yüz elli kişilik amfi; mikrofon ve projeksiyon sistemi mevcut.");
    await R.step(page, {
      ...clip,
      id: "yer-form",
      title: "Yerin adını ve açıklamasını yaz",
      text: "Yer türü sabittir (yer), **Tür** ya da **Yapı** sorulmaz. Açıklamaya kapasite, ekipman gibi bilgileri yazmak etkinlik planlayanlara yardım eder.",
      target: yform,
      act: () => yform.getByRole("button", { name: "Ekle", exact: true }).click(),
    });
    await R.step(page, {
      ...clip,
      id: "yer-sonuc",
      title: "Yeni yer listede",
      text: "Yer anında kullanıma açıldı: etkinliklerin **Yer** listesinde ve tablo aramasında çıkar. Artık kullanılmayan yer **pasifleştirilir**; eski etkinlikler adını göstermeye devam eder.",
      target: row("Amfi Tiyatro (C Blok)"),
      click: false,
    });
  },
};
