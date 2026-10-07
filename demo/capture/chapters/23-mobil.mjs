// Bolum 23: mobil uygulama (app.) — telefon boyutu. Kisi: Kaan, atolye gunu sahada.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOSTS, settle } from "../lib.mjs";
import { cls, dlg, menuItem } from "../ui.mjs";

const PHOTO = fileURLToPath(new URL("../../out/assets/layout.png", import.meta.url));
const EVENT = "Arduino ile Akıllı Ev Atölyesi";

export default {
  id: "mobil",
  title: "Mobil uygulama: sahada telefonla",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Atölyeye iki gün kala Kaan sahada, telefonuyla çalışıyor: eylemlerine bakıyor, etkinliğin adımlarını işaretliyor, sohbete yazıyor ve fotoğraf paylaşıyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir", { host: "app", mobile: true });
    await page.goto(`${HOSTS.app}/`, { waitUntil: "networkidle" });
    const tabs = page.getByRole("navigation", { name: "Sekmeler" });

    await R.step(page, {
      id: "mobil-eylemler",
      title: "Telefonda ilk sayfa: Eylemler",
      text: "**app.** adresi (ya da ana ekrana eklediğin uygulama) doğrudan **Eylemler**'i açar: sana atanmış, bitmemiş eylemler; bu haftakiler üstte. Altta dört sekme ve ortada **+** düğmesi var; sekmelerdeki kırmızı sayı bekleyen iş sayısıdır.",
      target: [
        { t: page.locator("a[href^='/record/']:visible").first(), label: "Eylem kartı" },
        { t: tabs, label: "Sekmeler" },
      ],
      click: false,
    });

    const owned = page.getByText(/Sahibi olduğum açık kayıtlar/);
    await R.step(page, {
      id: "mobil-sahip",
      title: "Sahibi olduğun kayıtlar",
      text: "En üstteki **Sahibi olduğum açık kayıtlar** başlığına dokununca kayıtlar açılır. Eylemin olmasa bile sorumlusu olduğun işleri buradan görürsün.",
      target: owned,
      act: () => owned.click(),
    });
    const rec = page.getByRole("link", { name: new RegExp(EVENT) }).first();
    await R.step(page, {
      id: "mobil-kayit-sec",
      title: "Etkinliğin kaydını aç",
      text: "Liste kısa kayıt kartlarıdır: tür, önem ve başlık. Etkinliğin kendi kaydı (**Etkinlik** etiketli) etkinliğin sohbetini ve adımlarını taşır; dokunup aç.",
      target: rec,
      act: () => rec.click(),
    });
    await page.waitForURL(/\/record\/[0-9a-f-]{36}/);

    const strip = cls(page, "eventStrip");
    await R.step(page, {
      id: "mobil-kayit",
      title: "Etkinlik şeridi",
      text: "Etkinlik kayıtlarında başlığın altında bir **şerit** çıkar: durum, tarih, yer ve **ilerleme çubuğu** (tamamlanan adım / toplam). Altında kaydın alanları, eylemleri ve kartları masaüstüyle aynı.",
      target: strip,
      click: false,
    });
    const steps = strip.getByRole("button", { name: /adım$/ });
    await R.step(page, {
      id: "mobil-adimlar",
      title: "Adım sayısına dokun",
      text: "**x/y adım** düğmesi etkinliğin zaman çizelgesini açar. Sahada bir iş bitince buradan işaretlersin; sorumlu ve etkinlik yöneticisi doğrudan işaretler, diğerleri onay ister.",
      target: steps,
      act: () => steps.click(),
    });
    const otf = page.getByRole("button", { name: "OTF gönderildi: tamamlandı olarak işaretle" });
    await R.step(page, {
      id: "mobil-adim-isaretle",
      title: "OTF gönderildi'yi işaretle",
      text: "SEB'e OTF mailini az önce attın: adımın kutusuna dokun. Kutu dolar, ilerleme çubuğu uzar; değişiklik etkinliğin sohbetine de yazılır.",
      target: otf,
      act: () => otf.click(),
    });
    await R.step(page, {
      id: "mobil-adim-sonuc",
      title: "Adım tamamlandı",
      text: "İşaretlenen adım üstü çizili ve dolu görünür, sayaç bir arttı. Yanlışsa aynı kutuya tekrar dokunarak geri alabilirsin.",
      target: strip,
      click: false,
    });

    // --- sohbet -------------------------------------------------------------
    const chatFab = page.getByRole("button", { name: /^Sohbeti aç/ });
    await R.step(page, {
      id: "mobil-sohbet-ac",
      title: "Sağ alttaki balon: sohbet",
      text: "Kaydın sohbeti masaüstündeki gibi sağda değil, **sağ alttaki balonda**. Üzerindeki sayı mesaj sayısıdır; dokununca sohbet tam ekran açılır.",
      target: chatFab,
      act: () => chatFab.click(),
    });
    const sheet = page.getByRole("dialog");
    const box = sheet.getByLabel("Mesaj", { exact: true });
    await box.fill("OTF'yi SEB'e gönderdik, onay gelince buraya yazarım. Cumartesi için herkes 09:30'da atölyede olsun.");
    await R.step(page, {
      id: "mobil-sohbet-yaz",
      title: "Mesajını yaz ve gönder",
      text: "Mesaj kutusu masaüstündekiyle aynı: **@** ile kişi anabilir, resim simgesiyle görsel ekleyebilir, **⚡ Hızlı eylem** ile eylem açabilirsin. Telefonda **Enter** satır atlar; **Gönder** düğmesi gönderir.",
      target: box,
      act: () => sheet.getByRole("button", { name: "Gönder", exact: true }).click(),
    });
    await R.step(page, {
      id: "mobil-sohbet-sonuc",
      title: "Mesaj gitti",
      text: "Mesajın mor balonda; üstte adımı işaretlediğin sistem satırı da akışta. Sol üstteki **×** ile sohbeti kapatıp kayda dönersin.",
      target: sheet,
      click: false,
    });
    await sheet.getByRole("button", { name: "Kapat" }).click();

    // --- ekle menusu --------------------------------------------------------
    const plus = tabs.getByRole("button", { name: "Ekle", exact: true });
    await R.step(page, {
      id: "mobil-ekle",
      title: "Ortadaki + düğmesi",
      text: "**+** üç işi tek dokunuşa indirir: **Arama**, **Yeni kayıt** ve **Fotoğraf çek / seç**.",
      target: plus,
      act: () => plus.click(),
    });
    await R.step(page, {
      id: "mobil-ekle-menu",
      title: "Fotoğraf çek / seç",
      text: "Sahada bir şey gördün mü (örneğin kurulumun son hali): **Fotoğraf çek / seç**'e dokun; kamera açılır ya da galeriden seçersin.",
      target: menuItem(page, /Fotoğraf çek/),
      click: false,
    });
    // Menu ogesine dokunmak gizli dosya kutusunu tetikler: gercek akis, dosya secici olayiyla.
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuItem(page, /Fotoğraf çek/).click()]);
    await chooser.setFiles({ name: "kurulum.png", mimeType: "image/png", buffer: readFileSync(PHOTO) });
    const flow = dlg(page, "Fotoğraf gönder");
    await flow.waitFor();
    await flow.getByLabel("Açıklama").fill("Salon yerleşimi kuruldu, kayıt masası girişin solunda.");
    await R.step(page, {
      id: "mobil-foto",
      title: "Önizleme ve açıklama",
      text: "Seçtiğin fotoğrafın **önizlemesi** gelir; istersen **açıklama** yaz. Aşağı kaydırınca fotoğrafı göndereceğin konuşmalar listelenir.",
      target: [flow.getByRole("img", { name: "Gönderilecek fotoğraf" }), flow.getByLabel("Açıklama")],
      click: false,
    });
    const target = flow.getByRole("checkbox", { name: new RegExp(EVENT) });
    await target.check();
    await R.step(page, {
      id: "mobil-foto-hedef",
      title: "Hangi sohbetlere gitsin?",
      text: "Kayıt sohbetlerini ve takım duvarlarını işaretle; **Gönder** fotoğrafı her birine ayrı gönderir. Biri başarısız olursa yalnızca o tekrar denenir.",
      target: target,
      act: () => flow.getByRole("button", { name: "Gönder", exact: true }).click(),
    });
    await flow.waitFor({ state: "hidden" });
    await settle(page, 700);

    // --- sekmeler -----------------------------------------------------------
    const chats = tabs.getByRole("link", { name: /Konuşmalar/ });
    await R.step(page, {
      id: "mobil-konusmalar-ac",
      title: "Konuşmalar sekmesi",
      text: "**Konuşmalar** yazabildiğin bütün sohbetleri son mesaja göre sıralar: kayıt sohbetleri ve takım duvarları tek listede.",
      target: chats,
      act: () => chats.click(),
    });
    await R.step(page, {
      id: "mobil-konusmalar",
      title: "Tek gelen kutusu",
      text: "Her satırda sohbetin adı, son mesaj ve türü (**Kayıt** ya da **Takım**) var. Dokununca ilgili kaydın ya da takımın sohbeti açılır.",
      target: page.locator("a[href*='#chat']").first(),
      click: false,
    });

    const notes = tabs.getByRole("link", { name: /Bildirim/ });
    await R.step(page, {
      id: "mobil-bildirim-ac",
      title: "Bildirim sekmesi",
      text: "**Bildirim** seni anan, sana eylem atayan ya da kayıtlarında olay olan kişileri toplar; kırmızı sayı okunmamışları gösterir.",
      target: notes,
      act: () => notes.click(),
    });
    await R.step(page, {
      id: "mobil-bildirim",
      title: "Bildirim listesi",
      text: "Okunmamışlar vurgulu. Satıra dokununca olayın geçtiği kayda gidersin. En üstteki **Bildirim ayarları** anlık bildirimi (telefona düşen) açıp kapatır.",
      target: page.locator("main, [class*='app']").first(),
      click: false,
    });

    const teams = tabs.getByRole("link", { name: /Takımlar/ });
    await R.step(page, {
      id: "mobil-takimlar-ac",
      title: "Takımlar sekmesi",
      text: "**Takımlar** takımlarını ve üyelerini gösterir; ekip arkadaşını aramak gerektiğinde telefon simgesi hazır.",
      target: teams,
      act: () => teams.click(),
    });
    const team = page.getByRole("link", { name: /Teknik Atölye/ }).first();
    await R.step(page, {
      id: "mobil-takimlar",
      title: "Takım kartları",
      text: "Kartta açıklama, üye ve açık kayıt sayısı var. Dokunup takım sayfasını aç.",
      target: team,
      act: () => team.click(),
    });
    await page.waitForURL(/\/team\/[0-9a-f-]{36}/);
    const members = page.getByText(/^Üyeler \(/);
    await members.click();
    await R.step(page, {
      id: "mobil-takim",
      title: "Üyeler ve telefon",
      text: "**Üyeler** açılınca her kişinin rolü ve **telefon simgesi** görünür; simgeye dokunmak numarayı arar. Takım duvarına da sağ alttaki balondan yazılır.",
      target: members.locator("xpath=ancestor::details"),
      click: false,
    });

    // --- arama --------------------------------------------------------------
    await tabs.getByRole("button", { name: "Ekle", exact: true }).click();
    await menuItem(page, "Arama").click();
    const searchBox = page.getByRole("searchbox").or(page.getByRole("textbox")).first();
    await searchBox.fill("arduino");
    await settle(page, 600);
    await R.step(page, {
      id: "mobil-arama",
      title: "Arama",
      text: "**+ → Arama** kayıt ve eylem başlıklarında arar; yazdıkça sonuçlar gelir. Sonuca dokununca kayıt açılır.",
      target: searchBox,
      click: false,
    });

    // --- hesap --------------------------------------------------------------
    const account = page.getByRole("button", { name: "Hesap menüsü" });
    await R.step(page, {
      id: "mobil-hesap",
      title: "Hesap menüsü",
      text: "Sağ üstteki avatar **Profilim**, **Bildirimler**, **Tema** (açık / koyu / sistem) ve **Çıkış yap**'ı açar; masaüstündeki menünün aynısı.",
      target: account,
      act: () => account.click(),
    });
    await R.step(page, {
      id: "mobil-hesap-menu",
      title: "Menü açık",
      text: "Profil bilgilerini ve bildirim tercihlerini telefonda da güncelleyebilirsin; telefona anlık bildirim bu menüden açılır.",
      target: page.getByRole("menu"),
      click: false,
    });
    await page.keyboard.press("Escape");
  },
};
