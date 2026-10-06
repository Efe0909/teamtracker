// Bolum 2: yeni kayit ac (hata ya da gorev).

import { HOSTS } from "../lib.mjs";
import { btn, chip, dlg, opt, pop } from "../ui.mjs";

export default {
  id: "yeni-kayit",
  title: "Yeni kayıt aç",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Atölye günü için ek prizler gerekiyor. Kaan bunu kayda dökerek sorumlusunu ve birimini belirliyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/tasks`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "yeni-kayit-ac",
      title: "Yeni kayıt düğmesine bas",
      text: "Görevler'de ya da Panolar'da sağ üstteki **Yeni kayıt**'a tıkla. Her üye her birimde kayıt açabilir.",
      target: btn(page, /Yeni kayıt/).first(),
      act: () => btn(page, /Yeni kayıt/).first().click(),
    });

    const d = dlg(page, "Yeni kayıt");
    await page.getByLabel("Başlık", { exact: true }).fill("Atölye için ek uzatma kablosu ve topraklı priz");
    await R.step(page, {
      id: "yeni-kayit-baslik",
      title: "Kısa ve aranabilir bir başlık yaz",
      text: "Başlık en az **5**, açıklama en az **30** karakter olmalı; sayaç altta görünür. Başlık, ekibin sonradan arayıp bulacağı şey.",
      target: page.getByLabel("Başlık", { exact: true }),
      click: false,
    });

    await page.getByLabel("Açıklama", { exact: true }).fill("Altı çalışma adasının her birine topraklı priz gerekiyor; mevcut stoktaki kablolar yetmiyor. Sayıyı netleştirip SEB'e ek talep olarak iletmeliyiz.");
    await R.step(page, {
      id: "yeni-kayit-aciklama",
      title: "Ne, neden, kim için?",
      text: "Açıklamaya işin **ne** olduğunu, **neden** gerektiğini ve **kimin** için olduğunu yaz. Kısa tutulursa kayıt açılmaz.",
      target: page.getByLabel("Açıklama", { exact: true }),
      click: false,
    });

    await R.step(page, {
      id: "yeni-kayit-tur",
      title: "Hata mı, görev mi?",
      text: "**Tür** çipinden seç: **Hata** bir şey ters gittiyse, **Görev** yapılacak bir iş içindir.",
      target: chip(page, "Tür"),
      act: () => chip(page, "Tür").click(),
    });
    await R.step(page, {
      id: "yeni-kayit-tur-sec",
      title: "Görev'i seç",
      text: "Bu bir iş: **Görev**'i seç.",
      target: opt(page, /Görev/),
      act: () => opt(page, /Görev/).click(),
    });

    await R.step(page, {
      id: "yeni-kayit-birim",
      title: "Kaydın ağaçtaki yerini seç",
      text: "**Birim** kaydın hangi işe ait olduğunu söyler. Ağaç açılır; **Favoriler**'den hızlıca seçebilirsin.",
      target: chip(page, "Birim"),
      act: () => chip(page, "Birim").click(),
    });
    await R.step(page, {
      id: "yeni-kayit-birim-sec",
      title: "Malzeme ve Kaynak Planlama",
      text: "Bu iş malzemeyle ilgili: **Malzeme ve Kaynak Planlama**'yı seç. Sıfırdan aramak için kutuya birimin adını yaz.",
      target: pop(page),
      click: false,
    });
    await opt(page, /Malzeme ve Kaynak Planlama/).first().click();

    await R.step(page, {
      id: "yeni-kayit-sorumlu",
      title: "Sorumluyu seç",
      text: "Varsayılan sorumlu kaydı açan sensin. **Sorumlu** çipinden başkasını seçebilir ya da **Sorumlusuz** açabilirsin.",
      target: chip(page, "Sorumlu"),
      act: () => chip(page, "Sorumlu").click(),
    });
    await R.step(page, {
      id: "yeni-kayit-sorumlu-sec",
      title: "Can Özdemir'e ata",
      text: "Prizleri sayacak kişi atölyeden sorumlu **Can**. Seçtiğin kişi kaydın **sorumlusu** olur; adı listelerde ve kayıt sayfasında görünür.",
      target: opt(page, /Can Özdemir/),
      act: () => opt(page, /Can Özdemir/).click(),
    });

    await chip(page, "Takım").click();
    await opt(page, /Teknik Atölye/).click();
    await chip(page, "Öncelik").click();
    await opt(page, /Yüksek/).click();
    await R.step(page, {
      id: "yeni-kayit-takim-oncelik",
      title: "Takım ve öncelik",
      text: "**Takım** çipi kaydı bir takıma bağlar: takımın üyeleri kaydı düzenleyebilir. **Öncelik** Kritik, Yüksek, Orta ya da Düşük olur.",
      target: [chip(page, "Takım"), chip(page, "Öncelik")],
      click: false,
    });

    await R.step(page, {
      id: "yeni-kayit-erisim",
      title: "Kimler görsün?",
      text: "**Erişim**: *Herkese açık* (herkes görür, tek tıkla katılır), *İzinle katılım* (sorumlu onaylar) ya da *Gizli* (içeriği yalnız katılımcılar görür).",
      target: chip(page, "Erişim"),
      act: () => chip(page, "Erişim").click(),
    });
    await R.step(page, {
      id: "yeni-kayit-erisim-sec",
      title: "Üç erişim kipi",
      text: "Çoğu iş **Herkese açık** kalır. Hassas konular için **Gizli**'yi seç. Sonradan kayıt sayfasından değiştirilir.",
      target: pop(page),
      click: false,
    });
    await page.keyboard.press("Escape");

    await page.getByRole("checkbox", { name: /Havuz kartı/ }).check();
    await R.step(page, {
      id: "yeni-kayit-kartlar",
      title: "İstersen boş kart blokları ekle",
      text: "**Kart blokları** isteğe bağlı: *Medya eki* (görseller), *Toplantı planı*, *Havuz kartı* (gönüllü topla). Kayıt açıldıktan sonra da eklenir.",
      target: page.locator("fieldset").filter({ hasText: "Kart blokları" }),
      click: false,
    });

    await R.step(page, {
      id: "yeni-kayit-gonder",
      title: "Kaydı aç",
      text: "Her şey tamamsa **Kaydı aç**'a bas. Kayıt açılır ve doğrudan kayıt sayfasına gidersin.",
      target: btn(page, "Kaydı aç"),
      act: () => btn(page, "Kaydı aç").click(),
    });
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/);
    await R.step(page, {
      id: "yeni-kayit-sayfa",
      title: "Kayıt hazır",
      text: "Yeni kayıt sayfası: üstte başlık, ortada özellikler ve eylemler, sağda sohbet. Bir sonraki bölümde bunları kullanacağız.",
      target: page.getByRole("heading", { level: 1 }),
      click: false,
    });
  },
};
