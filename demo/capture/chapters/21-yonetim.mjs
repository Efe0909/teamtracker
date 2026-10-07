// Bolum 21: Yonetim paneli — kisi ekle, rol ver, kapsam / dal izni, roller, toplu islem. Kisi: Defne (yonetici).

import { HOSTS } from "../lib.mjs";
import { btn, cls, nav, opt, pop, tab } from "../ui.mjs";

const NEW_NAME = "Deniz Yalçın";

export default {
  id: "yonetim",
  title: "Yönetim: kim girer, neyi yapabilir",
  persona: "Defne Aksoy",
  role: "Kulüp başkanı (yönetici)",
  intro: "Ekibe yeni bir üye katılıyor. Yönetici Defne onu kullanıcı listesine ekliyor, rolünü veriyor ve yetkilerin nasıl işlediğini gösteriyor.",

  async run({ R, open }) {
    const { page } = await open("Defne Aksoy", { height: 1000 });
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "yon-ac",
      title: "Yönetim'i aç",
      text: "Kenar çubuğundaki **Yönetim** yalnızca yöneticilere ve kullanıcı yönetme yetkisi (`manage_users`) olanlara görünür. Burası kimin girebileceğini ve neyi değiştirebileceğini belirler.",
      target: nav(page, "Yönetim"),
      act: () => nav(page, "Yönetim").click(),
    });
    await R.step(page, {
      id: "yon-genel",
      title: "Üç bölüm",
      text: "**Kişiler ve roller** kullanıcıları ve yetki demetlerini, **Aktivite** kimin ne kadar uğradığını, **Kalite kapısı** (yalnız yönetici) metin kontrolü sorularını yönetir.",
      target: page.getByRole("tablist", { name: "Yönetim bölümü" }),
      click: false,
    });

    // --- kisi ekle ----------------------------------------------------------
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kullanıcı ekle" }) });
    await form.getByPlaceholder("ad@ornek.com").fill("deniz.yalcin@demo.example");
    await form.getByLabel(/^Ad/).fill(NEW_NAME);
    await R.step(page, {
      id: "yon-ekle",
      title: "Yeni kullanıcıyı ekle",
      text: "Yalnızca burada kayıtlı e-postalar giriş yapabilir (Google hesabıyla). **E-posta** ve **ad** yaz, **Kullanıcı ekle**'ye bas; kişiye davet postası otomatik hazırlanır.",
      target: form,
      act: () => form.getByRole("button", { name: "Kullanıcı ekle" }).click(),
    });
    const row = page.locator("li").filter({ hasText: "deniz.yalcin@demo.example" });
    await row.first().waitFor();
    await R.step(page, {
      id: "yon-liste",
      title: "Kullanıcı listede",
      text: "Her satırda **ad**, **e-posta**, **son görülme**, **bildirim ayarı** ve sahip olduğu **kapsamlar** var. Yeni eklenen kişi henüz hiç girmedi, kapsamı yok.",
      target: row.first(),
      click: false,
    });

    // --- duzenle ------------------------------------------------------------
    const edit = row.first().locator("summary", { hasText: "Düzenle" });
    await row.first().scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "yon-duzenle",
      title: "Düzenle'yi aç",
      text: "Satırın altındaki **Düzenle** kapsam, rol ve dal izni denetimlerini açar. Liste kapalıyken taranabilir kalsın diye denetimler gizli durur.",
      target: edit,
      act: () => edit.click(),
    });
    const roleChip = row.first().getByRole("button", { name: /^Rol ver:/ });
    await R.step(page, {
      id: "yon-rol",
      title: "Rol ver",
      text: "**Rol**, birden çok yetkiyi tek seferde veren bir demettir. Deniz tasarım takımına katılıyor: **Rol ver**'e bas.",
      target: roleChip,
      act: () => roleChip.click(),
    });
    await R.step(page, {
      id: "yon-rol-sec",
      title: "Tasarım rolünü seç",
      text: "Beş rol var: Birim Editörü, Etkinlik Koordinatörü, Liste Yöneticisi, Maliye, Tasarım. Rolün kapsamları sahiplerine **anında** yansır.",
      target: opt(page, /Tasarım/),
      act: () => opt(page, /Tasarım/).click(),
    });
    await R.step(page, {
      id: "yon-rol-sonuc",
      title: "Rol atandı",
      text: "Satırda rol rozeti göründü (✕ ile geri alınır). Kişi **Ekip** sayfasında bu rozetle görünür; rolün kapsamları üstteki rozetlerde ayrıca listelenmez.",
      target: row.first(),
      click: false,
    });

    const scope = row.first().getByRole("button", { name: /^Kapsam ver:/ });
    await R.step(page, {
      id: "yon-kapsam",
      title: "Tek tek kapsam da verilebilir",
      text: "Rolden bağımsız, doğrudan **kapsam** verebilirsin. Listedeki her kapsamın altında ne işe yaradığı yazar (örneğin `edit_deadline`: son tarih değiştirme).",
      target: scope,
      act: () => scope.click(),
    });
    await R.step(page, {
      id: "yon-kapsam-liste",
      title: "Kapsamlar ve anlamları",
      text: "**manage_events** etkinlikleri yönetir, **manage_purchases** satın alımları, **edit_nodes** birim ağacını, **manage_teams** takımları, **manage_users** kullanıcıları. Seçince kapsam hemen verilir; **Esc** ile vazgeç.",
      target: pop(page),
      click: false,
    });
    await page.keyboard.press("Escape");

    const branch = row.first().getByRole("button", { name: /^Dal izni ver:/ });
    await R.step(page, {
      id: "yon-dal",
      title: "Dal izni: yapıyı nerede değiştirebilir?",
      text: "**Dal izni**, birim ağacında bir dalı kişiye (ya da role) açar. Birim ağacını değiştirme gibi yapı yetkileri yalnızca izinli dalda ve altında geçer; kayıt düzenleme yetkisi de bu dallardaki kayıtlara uzanır.",
      target: branch,
      act: () => branch.click(),
    });
    await R.step(page, {
      id: "yon-dal-agac",
      title: "Ağaçtan dalı seç",
      text: "Birim ağacı açılır; **Etkinlik Planlama** gibi bir dal seçtiğinde kişi o dalın altındaki birimlerde yetkili olur.",
      target: pop(page),
      click: false,
    });
    await page.keyboard.press("Escape");

    const actions = row.first().locator('[class*="adminActs"]');
    await R.step(page, {
      id: "yon-hesap",
      title: "Hesabı kapat, yönetici yap",
      text: "Satırın en altında **Hesabı kapat** (giriş izni kalkar, geçmiş kayıtlarda adı durur) ve yalnızca yöneticiye görünen **Yönetici yap** düğmeleri var. Mezun olan üyelerin hesabı silinmez, kapatılır.",
      target: actions,
      click: false,
    });

    // --- toplu islem --------------------------------------------------------
    const pick = (n) => page.getByRole("checkbox", { name: `${n} seç` });
    await pick("Burak Kaya").check();
    await pick(NEW_NAME).check();
    await page.evaluate(() => document.querySelector('[role="region"][aria-label="Toplu işlemler"]')?.scrollIntoView({ block: "start" }));
    await R.step(page, {
      id: "yon-toplu",
      title: "Birden çok kişiye aynı anda işlem",
      text: "Kişilerin solundaki kutuları işaretlersen üstte **Toplu işlemler** çıkar: **Rol ver**, **Rol al**, **Hesapları kapat/aç**. Dönem sonunda mezunları tek seferde kapatmak için ideal.",
      target: page.getByRole("region", { name: "Toplu işlemler" }),
      click: false,
    });
    await btn(page, "Seçimi temizle").click();

    // --- roller -------------------------------------------------------------
    const roles = page.getByRole("heading", { name: /^Roller/ });
    await roles.scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "yon-roller",
      title: "Roller bir kapsam demetidir",
      text: "Her rolün **adı**, **rengi**, **kapsamları** ve **dal izinleri** vardır. Rolü değiştirirsen sahipleri anında etkilenir. Rol oluşturma ve silme yalnız yöneticide.",
      target: page.locator("ul").filter({ hasText: "Etkinlik Koordinatörü" }).last(),
      click: false,
    });
    const roleEdit = page.locator("li").filter({ hasText: "Etkinlik Koordinatörü" }).last().locator("summary", { hasText: "Düzenle" });
    await R.step(page, {
      id: "yon-rol-duzenle",
      title: "Rolü düzenle",
      text: "Rolün **Düzenle**'si ad, renk, kapsam kutucukları ve dal izinlerini açar. Kutucukları işaretleyip **Kaydet**'e bas.",
      target: roleEdit,
      act: () => roleEdit.click(),
    });
    await R.step(page, {
      id: "yon-rol-form",
      title: "Kapsamları işaretle",
      text: "Her kapsamın altında kısa açıklaması var; işaret sayısı başlıkta (**x / y seçili**) görünür. Vazgeçmek için paneli kapat, değişiklik kaydedilmedikçe uygulanmaz.",
      target: page.locator("li").filter({ hasText: "Etkinlik Koordinatörü" }).last().locator("form"),
      click: false,
    });
    await roleEdit.click();
  },
};
