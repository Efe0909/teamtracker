// Bolum 3: kayit sayfasi — son tarih, eylem ekle, "top kimde", katilimci, sabitle.
// Onceki bolumde (yeni-kayit) acilan kaydi surdurur.

import { HOSTS, recordId } from "../lib.mjs";
import { btn, cls, dayCell, opt, pop } from "../ui.mjs";

export const TITLE = "Atölye için ek uzatma kablosu ve topraklı priz";

export default {
  id: "kayit-sayfasi",
  title: "Kayıt sayfası: tarih, eylem, kişi",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Kaan az önce açtığı kaydı ekibe dağıtıyor: son tarih koyuyor, eylemleri sahipleriyle ekliyor, Elif'i işe dahil ediyor.",

  async run({ R, open }) {
    recordId(TITLE);
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/tasks`, { waitUntil: "networkidle" });

    const search = page.getByPlaceholder("Başlık veya açıklamada ara…");
    await search.fill("priz");
    const link = page.getByRole("link", { name: TITLE });
    await link.waitFor();
    await R.step(page, {
      id: "kayit-bul",
      title: "Kaydı listeden bul ve aç",
      text: "Görevler'de arama kutusuna birkaç harf yaz, satırdaki başlığa tıkla. Kayıt kendi sayfasında açılır.",
      target: link,
      act: () => link.click(),
    });
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/);
    await page.evaluate(() => window.scrollTo(0, 0));

    const acts = page.locator('section[aria-labelledby="acts-h"]');
    await R.step(page, {
      id: "kayit-genel",
      title: "Kayıt sayfası beş bölümden oluşur",
      text: "Üstte **başlık ve açıklama**, altında **özellikler**, sonra **eylemler** ve **kartlar**. Sağdaki sütun kaydın kendi **sohbeti**. Tek bir iş için gereken her şey bu sayfada.",
      target: [
        { t: page.getByRole("heading", { level: 1 }).locator("xpath=../.."), label: "Başlık ve açıklama" },
        { t: cls(page, "propsPanel"), label: "Özellikler" },
        { t: acts, label: "Eylemler" },
        { t: page.locator("#cards-h").locator(".."), label: "Kartlar" },
        { t: page.getByRole("complementary", { name: "Sohbet" }), label: "Sohbet" },
      ],
      click: false,
    });

    // --- son tarih ----------------------------------------------------------
    const dueChip = page.getByRole("button", { name: /^Son tarih:/ }).first();
    await R.step(page, {
      id: "kayit-tarih",
      title: "Kayda son tarih ver",
      text: "**Son tarih** satırındaki “Tarih ekle”ye tıkla. Tarihi olmayan işin ne zaman biteceği belli olmaz; gecikme de ancak tarih varsa görünür.",
      target: dueChip,
      act: () => dueChip.click(),
    });
    await R.step(page, {
      id: "kayit-tarih-sec",
      title: "Takvimden günü seç",
      text: "Takvim Pazartesi'den başlar. Hızlı seçim için **Bugün**, **Yarın**, **+1 hafta** düğmeleri var; ok tuşlarıyla da gezilir.",
      target: dayCell(page, 4),
      act: () => dayCell(page, 4).click(),
    });
    await R.step(page, {
      id: "kayit-tarih-sonuc",
      title: "Kaydedildi — geri alınabilir",
      text: "Değişiklik hemen kaydedilir. Alttaki bildirimde **Geri al** varsa yanlış seçimi birkaç saniye içinde geri çevirebilirsin.",
      target: [dueChip, page.getByText("Kaydedildi").first()],
      click: false,
    });

    // --- eylem ekle ---------------------------------------------------------
    const form = acts.locator("form");
    const title = form.getByLabel("Eylem başlığı");
    await title.fill("Çalışma adalarındaki priz sayısını say");
    await R.step(page, {
      id: "eylem-baslik",
      title: "İşi eylemlere böl",
      text: "Kayıt büyük bir iş; **eylem** onun içindeki tek kişilik adımdır. “Yeni eylem ekle…” kutusuna yapılacağı yaz: *kim, ne yapacak?*",
      target: title,
      click: false,
    });

    const ownerBtn = form.getByRole("button", { name: /^Eylemin sahibi:/ });
    await R.step(page, {
      id: "eylem-sahip",
      title: "Eylemin sahibini seç",
      text: "Sahibi seçmezsen eylem **Havuzda** kalır: ekipten herkes “Üstlen” diyerek alabilir.",
      target: ownerBtn,
      act: () => ownerBtn.click(),
    });
    await R.step(page, {
      id: "eylem-sahip-sec",
      title: "Can Özdemir'i seç",
      text: "Sahip eylemin **top**unu tutan kişidir; eylem onun Panolar'daki **Açık eylemim** sayacına yazılır.",
      target: opt(page, /Can Özdemir/),
      act: () => opt(page, /Can Özdemir/).click(),
    });

    const dueBtn = form.getByRole("button", { name: /^Son tarih:/ });
    await R.step(page, {
      id: "eylem-tarih",
      title: "Eyleme de tarih koy",
      text: "Her eylemin kendi son tarihi olur. Tarihi geçen eylem, kaydı da **geciken** listesine düşürür.",
      target: dueBtn,
      act: () => dueBtn.click(),
    });
    await dayCell(page, 2).click();

    await R.step(page, {
      id: "eylem-ekle",
      title: "Ekle'ye bas",
      text: "Başlık, sahip ve tarih tamamsa **Ekle**. Enter tuşu da aynı işi yapar.",
      target: btn(page, /^Ekle$/),
      act: () => btn(page, /^Ekle$/).click(),
    });

    // ikinci eylem (kisa yol): ayni form, ayni kisi
    await title.fill("Eksik kablo ve priz listesini Elif'e ilet");
    await ownerBtn.click();
    await opt(page, /Can Özdemir/).click();
    await dueBtn.click();
    await dayCell(page, 3).click();
    await btn(page, /^Ekle$/).click();
    await acts.getByText("Eksik kablo ve priz listesini").waitFor();

    await R.step(page, {
      id: "eylem-liste",
      title: "Eylemler sahipleriyle listelenir",
      text: "Her satırda **durum**, başlık, **tarih** ve **sahip** var; hepsi satırın içinden değiştirilir. Başlıktaki **“2 açık”** sayacı bitmemiş eylem sayısıdır.",
      target: acts,
      click: false,
    });

    // --- top kimde ----------------------------------------------------------
    const ball = page.getByRole("button", { name: /^Top:/ });
    await R.step(page, {
      id: "top-kimde",
      title: "“Top kimde?” satırı",
      text: "Özelliklerin altındaki satır işin **şu an kimde beklediğini** söyler: açık eylemlerin sahipleri ve son hareketin zamanı. Tıklayınca son güncellemeler açılır.",
      target: ball,
      act: () => ball.click(),
    });
    await R.step(page, {
      id: "top-kimde-acik",
      title: "Son hareketler",
      text: "Yöneticiler “bu iş neden durdu?” sorusunun cevabını buradan görür: en yeni eylem ve kayıt değişiklikleri üstte.",
      target: cls(page, "ballWrap"),
      click: false,
      act: () => ball.click(),
    });

    // --- katilimci ----------------------------------------------------------
    const stackBtn = page.getByRole("button", { name: "Katılımcıları düzenle" });
    await R.step(page, {
      id: "katilimci",
      title: "Başkalarını işe dahil et",
      text: "Başlığın altındaki avatarlar kaydın **katılımcıları**. Küçük **+**'ya tıklayıp ekibi ekleyebilirsin; katılımcılar kaydı düzenleyebilir, sohbette bildirim alır.",
      target: stackBtn,
      act: () => stackBtn.click(),
    });
    await page.getByPlaceholder("Kişi ara…").fill("elif");
    const elif = pop(page).getByRole("checkbox", { name: /Elif Şahin/ });
    await R.step(page, {
      id: "katilimci-sec",
      title: "Kişiyi işaretle",
      text: "Arama kutusuna adını yaz ve kutucuğu işaretle. Kaldırmak için işareti geri al.",
      target: elif,
      act: () => elif.click(),
    });
    await page.keyboard.press("Escape");
    await R.step(page, {
      id: "katilimci-sonuc",
      title: "Elif artık katılımcı",
      text: "Avatar yığınına Elif eklendi. Sohbette birini **@ad** diye anarsan o kişi de otomatik katılımcı olur (sohbet bölümünde göreceğiz).",
      target: stackBtn,
      click: false,
    });

    // --- sabitle ------------------------------------------------------------
    const star = page.getByRole("button", { name: "Panolara sabitle" });
    await R.step(page, {
      id: "sabitle",
      title: "Sık baktığın kaydı sabitle",
      text: "Başlığın yanındaki **yıldız** kaydı Panolar'a sabitler. Takip ettiğin birkaç iş her sabah tek bakışta orada durur.",
      target: star,
      act: () => star.click(),
    });
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });
    await R.step(page, {
      id: "sabitle-sonuc",
      title: "Panolar'da “Sabitlenenler”",
      text: "Sabitlenen kayıtlar Panolar'ın en üstünde. Yıldıza bir daha basınca (“Sabitlemeyi kaldır”) listeden çıkar.",
      target: page.locator('section[aria-labelledby="pinned-h"]'),
      click: false,
    });
  },
};
