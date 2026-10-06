// Bolum 16: takim kurmak ve uye eklemek (`manage_teams`). Kisi: Ayse.

import { HOSTS } from "../lib.mjs";
import { btn, chip, dact, dlg, nav, opt } from "../ui.mjs";

export default {
  id: "takim-yonet",
  title: "Takım kur, üye ve birim ekle",
  persona: "Ayşe Çelik",
  role: "Takım yöneticisi",
  intro: "Ekip sponsor görüşmeleri için yeni bir takım kuruyor. Takım yönetme yetkisi olan Ayşe takımı açıyor, üyeleri rolleriyle ekliyor ve çalıştığı birimi bağlıyor.",

  async run({ R, open }) {
    const { page } = await open("Ayşe Çelik");
    await page.goto(`${HOSTS.dashboard}/teams`, { waitUntil: "networkidle" });

    const create = btn(page, /Yeni takım/);
    await R.step(page, {
      id: "ty-yeni",
      title: "Yeni takım düğmesi",
      text: "**Yeni takım** düğmesi yalnız takım yönetme yetkisi (`manage_teams`) olanlara ve yöneticilere görünür. Diğer üyeler takımları görür ama kuramaz.",
      target: create,
      act: () => create.click(),
    });
    const d = dlg(page, "Yeni takım");
    await d.getByLabel("Ad", { exact: true }).fill("Sponsorluk");
    await d.getByLabel("Açıklama").fill("Sponsor adaylarını bulur, teklif mektuplarını hazırlar ve görüşmeleri takip eder.");
    await d.getByRole("radiogroup", { name: "Renk" }).getByRole("radio").nth(4).click();
    await R.step(page, {
      id: "ty-form",
      title: "Ad, açıklama ve renk",
      text: "**Ad** en az 5, **açıklama** (isteğe bağlı) en az 30 karakter olmalı. **Renk**, takımın kenar çubuğundaki noktasını ve kartını boyar.",
      target: d,
      act: () => dact(d).getByRole("button", { name: "Oluştur" }).click(),
    });
    await page.waitForURL(/\/teams\/[0-9a-f-]{36}/);

    const members = page.locator('section[aria-labelledby="w-members"]');
    await R.step(page, {
      id: "ty-sayfa",
      title: "Takım kuruldu, henüz üyesi yok",
      text: "Takımın sayfası açıldı. Duvarda **“Sponsorluk” takımını kurdu** satırı var. Şimdi üye ekleyelim: **Üyeler** kutusunun üstüne gelince çıkan **kalem** simgesine bas.",
      target: members,
      hover: members,
      click: false,
    });

    const pencil = members.getByRole("button", { name: "Üyeler düzenle" });
    await R.step(page, {
      id: "ty-kalem",
      title: "Kutuyu düzenleme moduna al",
      text: "Her kutunun kalemi o kutuyu **düzenleme moduna** alır: ekleme ve çıkarma denetimleri yalnız bu modda görünür, böylece yanlışlıkla bir şey silinmez.",
      target: pencil,
      hover: members,
      act: () => pencil.click(),
    });

    const person = members.getByRole("button", { name: /^Eklenecek kişi:/ });
    await R.step(page, {
      id: "ty-kisi",
      title: "Kişiyi seç",
      text: "**Kişi ekle…** listesinden takıma katılacak kişiyi seç; arama kutusu kişi çoğalınca işine yarar.",
      target: person,
      act: () => person.click(),
    });
    await R.step(page, {
      id: "ty-kisi-sec",
      title: "Elif Şahin'i seç",
      text: "Elif bütçe ve sponsor katkılarına bakıyor; takımın lideri olsun.",
      target: opt(page, /Elif Şahin/),
      act: () => opt(page, /Elif Şahin/).click(),
    });

    const role = members.getByRole("button", { name: /^Rol:/ });
    await R.step(page, {
      id: "ty-rol",
      title: "Rolünü seç",
      text: "Takımda üç rol var: **Lider**, **Mentor** ve **Üye**. Rol yalnız bilgilendirme içindir; kayıt yetkisi vermez (kayıt yetkisi takım üyeliğinden gelir).",
      target: role,
      act: () => role.click(),
    });
    await R.step(page, {
      id: "ty-rol-sec",
      title: "Lider'i seç",
      text: "Rolü seçince liste kapanır; **Ekle** ile üyeliği kaydet.",
      target: opt(page, /^Lider/),
      act: () => opt(page, /^Lider/).click(),
    });
    await R.step(page, {
      id: "ty-ekle",
      title: "Ekle'ye bas",
      text: "Kişi takıma eklenir; duvara da “Elif Şahin kişisini takıma ekledi (Lider)” satırı düşer.",
      target: members.getByRole("button", { name: "Ekle", exact: true }),
      act: () => members.getByRole("button", { name: "Ekle", exact: true }).click(),
    });
    await R.step(page, {
      id: "ty-uyeler",
      title: "Üye listesi",
      text: "Düzenleme modunda her satırda rol seçici ve **×** (takımdan çıkar) var. Bitince sağ üstteki **Bitti**'ye bas.",
      target: members,
      click: false,
      act: () => members.getByRole("button", { name: "Bitti" }).click(),
    });

    // --- birim --------------------------------------------------------------
    const nodes = page.locator('section[aria-labelledby="w-nodes"]');
    const nodePencil = nodes.getByRole("button", { name: "Çalıştığı birimler düzenle" });
    await R.step(page, {
      id: "ty-birim",
      title: "Takımın çalıştığı birimi bağla",
      text: "**Çalıştığı birimler** kutusu, takımı birim ağacının bir dalına bağlar (bir takım birden çok birimde çalışabilir). Bağlanan birim takım kartında ve Veri yönetimi'nde görünür; kayıtlar etkilenmez.",
      target: nodePencil,
      hover: nodes,
      act: () => nodePencil.click(),
    });
    const link = nodes.getByRole("button", { name: /^Birime bağla:/ });
    await R.step(page, {
      id: "ty-birim-ac",
      title: "Birime bağla…",
      text: "Birim ağacı açılır; aramayla bulup seç.",
      target: link,
      act: () => link.click(),
    });
    await page.keyboard.type("malzeme", { delay: 40 });
    await R.step(page, {
      id: "ty-birim-sec",
      title: "Malzeme ve Kaynak Planlama",
      text: "Sponsorluk işleri malzeme ve kaynak planıyla ilgili: o birimi seç. Bağlantı hemen kurulur.",
      target: opt(page, /Malzeme ve Kaynak Planlama/).first(),
      act: () => opt(page, /Malzeme ve Kaynak Planlama/).first().click(),
    });
    await R.step(page, {
      id: "ty-sonuc",
      title: "Takım hazır",
      text: "Takımın üyesi ve birimi var; artık kayıtlar bu takıma atanabilir, duvar da kullanıma hazır.",
      target: [members, nodes],
      click: false,
    });
  },
};
