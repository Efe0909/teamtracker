// Bolum 17: Ekip dizini, profil ve bildirim ayarlari. Kisi: Kaan.

import { HOSTS } from "../lib.mjs";
import { cls, dlg, menuItem, nav } from "../ui.mjs";

export default {
  id: "ekip-profil",
  title: "Ekip, profil ve bildirimler",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Kaan bir ekip arkadaşının telefonuna ihtiyaç duyuyor, sonra kendi profilini ve bildirim tercihlerini gözden geçiriyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "ekip-ac",
      title: "Ekip'i aç",
      text: "Kenar çubuğundan **Ekip**'e tıkla: kulübün herkesi tek sayfada.",
      target: nav(page, "Ekip"),
      act: () => nav(page, "Ekip").click(),
    });
    await R.step(page, {
      id: "ekip-liste",
      title: "Herkesin profil kartı",
      text: "Kartta **ad**, **takma ad**, **rol rozetleri** (yetki demetleri), **telefon**, **doğum günü** (yıl gösterilmez) ve üye olduğu **takımlar** var. Doğum günü olanın yanında pasta simgesi ve **“bugün!”** yazar.",
      target: cls(page, "peopleGrid"),
      click: false,
    });

    const search = page.getByLabel("Kişi ara");
    await search.fill("mert");
    await R.step(page, {
      id: "ekip-ara",
      title: "Adla, takma adla ya da telefonla ara",
      text: "Arama kutusu ad, takma ad ve telefon numarasında arar. Telefon numarasına tıklamak aramayı başlatır (telefonda).",
      target: search,
      click: false,
    });
    await search.fill("");

    // --- profilim -----------------------------------------------------------
    const me = page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: /Kaan Demir/ });
    await R.step(page, {
      id: "profil-menu",
      title: "Kendi bilgilerin sol-alttaki menüde",
      text: "Sol altta adına tıkla: **Profilim**, **Bildirimler**, **Tema** (açık / koyu / sistem) ve **Çıkış yap**.",
      target: me,
      act: () => me.click(),
    });
    await R.step(page, {
      id: "profil-menu-ac",
      title: "Profilim'i seç",
      text: "Bilgilerini herkes kendi girer: başkasının profilini yalnız yöneticiler düzenleyebilir.",
      target: menuItem(page, "Profilim"),
      act: () => menuItem(page, "Profilim").click(),
    });
    const d = dlg(page, "Profilim");
    await R.step(page, {
      id: "profil-form",
      title: "Fotoğraf, takma ad, telefon, doğum günü",
      text: "**Telefon** zorunlu (ekip arkadaşların sana ulaşabilsin); biçimi kendiliğinden düzenlenir. **Takma ad** sohbette adının altında görünür, **doğum günü** Ekip sayfasında ve bugünse Panolar'da çıkar.",
      target: d,
      click: false,
    });
    await page.keyboard.press("Escape");

    // --- bildirimler --------------------------------------------------------
    await me.click();
    await R.step(page, {
      id: "bildirim-menu",
      title: "Bildirimler",
      text: "Menüden **Bildirimler**'i seç: hangi hareketlerde haber alacağını sen belirlersin.",
      target: menuItem(page, "Bildirimler"),
      act: () => menuItem(page, "Bildirimler").click(),
    });
    const nd = dlg(page, "Bildirimler");
    await R.step(page, {
      id: "bildirim-ayar",
      title: "Varsayılan bildirim düzeyi",
      text: "**Her hareket**, **yalnızca anıldığımda** ya da **sessize al**. **Sessiz saat** yalnız anlık bildirimi susturur, liste yine dolar. **Bu cihaz** bölümünden telefonda ya da tarayıcıda anlık bildirim açılır; bir sohbette farklı düzey için o sohbetin zil simgesini kullan.",
      target: nd,
      click: false,
    });
    await page.keyboard.press("Escape");
  },
};
