// Bolum 6: kart bloklari kurmak — havuz karti, oylama, toplanti plani duzenleme, kart duzeni.

import { HOSTS, recordId } from "../lib.mjs";
import { btn, dact, dlg, menuItem } from "../ui.mjs";

const TITLE = "Atölye günü vardiya çizelgesi";

export default {
  id: "kartlar",
  title: "Kartlar: havuz, oylama, toplantı",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Atölye günü için vardiya çizelgesi kaydında Kaan gönüllü toplamak ve ekibe bir şey sormak istiyor. Bunun için kayda kart ekliyor.",

  async run({ R, open }) {
    const id = recordId(TITLE);
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/tasks/${id}`, { waitUntil: "networkidle" });
    const cardsHead = page.locator("#cards-h").locator("..");
    await cardsHead.scrollIntoViewIfNeeded();
    const add = btn(page, /Kart ekle/);

    await R.step(page, {
      id: "kart-bolum",
      title: "Kartlar: kayda eklenen küçük araçlar",
      text: "Kayıt sayfasının **Kartlar** bölümü, yazıdan fazlası gereken işler için. Bu kayıtta zaten bir **Medya eki** (yerleşim planı) ve bir **Toplantı planı** var. Yeni kart için **Kart ekle**'ye bas.",
      target: [cardsHead],
      act: () => add.click(),
    });
    await R.step(page, {
      id: "kart-menu",
      title: "Dört kart türü",
      text: "**Medya eki** görselleri kayıtla birlikte tutar, **Toplantı planı** zaman ve yer bilgisi ile katılım sorar, **Oylama** ekipten tek soruda görüş toplar, **Havuz kartı** gönüllü arar. Kaan **Havuz kartı**'nı seçiyor.",
      target: page.getByRole("menu"),
      click: false,
    });
    await menuItem(page, "Havuz kartı").click();

    // --- havuz karti --------------------------------------------------------
    const edit = page.getByRole("button", { name: "Kartı düzenle" }).last();
    await edit.scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "kart-havuz-bos",
      title: "Kart boş doğar, sen doldurursun",
      text: "Yeni kartta yalnızca türün ipucu görünür. Kartın sağ üstündeki **kalem**e basıp başlık ve ayrıntıları gir.",
      target: edit,
      act: () => edit.click(),
    });
    const d = dlg(page, "Havuz kartı düzenle");
    await d.getByLabel("Başlık", { exact: true }).fill("Atölye günü kurulum ekibi");
    await d.getByLabel("Kişi sayısı").fill("4");
    await d.getByLabel("Ne yapılacak").fill("Cuma 18:00'de masaları plana göre dizecek, uzatma kablolarını çalışma adalarına çekecek.");
    await R.step(page, {
      id: "kart-havuz-form",
      title: "Kaç kişi lazım, ne yapılacak?",
      text: "**Kişi sayısı** hedefi, **Ne yapılacak** gönüllünün işini anlatır. Atama yok: isteyen kendisi “Bu işi alıyorum” der.",
      target: d,
      act: () => dact(d).getByRole("button", { name: "Kaydet" }).click(),
    });
    await d.waitFor({ state: "hidden" });
    await R.step(page, {
      id: "kart-havuz-sonuc",
      title: "Gönüllü kartı hazır",
      text: "Kart, ne kadar kişi gerektiğini yazar; kimler üstlendikçe adları altına eklenir. Bu kartı ekibe sohbetten **@all** ile duyurabilirsin.",
      target: page.getByText("Atölye günü kurulum ekibi").last().locator("xpath=ancestor::div[contains(@class,'cardHover')]"),
      click: false,
    });

    // --- oylama -------------------------------------------------------------
    await add.click();
    await R.step(page, {
      id: "kart-oylama-sec",
      title: "Ekibe bir şey sormak için Oylama",
      text: "Aynı menüden **Oylama**'yı seç. Sorunu ve seçenekleri yazacağın bir pencere açılır.",
      target: menuItem(page, "Oylama"),
      act: () => menuItem(page, "Oylama").click(),
    });
    const pd = dlg(page, "Oylama ekle");
    await pd.getByLabel("Soru", { exact: true }).fill("Atölye sonrası ikram ne olsun?");
    await pd.getByLabel("Seçenek 1", { exact: true }).fill("Çay ve poğaça");
    await pd.getByLabel("Seçenek 2", { exact: true }).fill("Pizza");
    await pd.getByRole("button", { name: /Seçenek ekle/ }).click();
    await pd.getByLabel("Seçenek 3", { exact: true }).fill("Meyve ve kuruyemiş");
    await pd.getByRole("checkbox", { name: /Diğer/ }).check();
    await R.step(page, {
      id: "kart-oylama-form",
      title: "Soruyu ve seçenekleri yaz",
      text: "**Seçenek ekle** ile en fazla 10 seçenek ekleyebilirsin. **“Diğer” seçeneği** işaretliyse kişi kendi cevabını yazar, ayrı sekmede toplanır. Altta *medya*, *sayaç* ve *çoklu seçim* opsiyonları var (yalnız oluştururken seçilir).",
      target: pd,
      act: () => dact(pd).getByRole("button", { name: "Kaydet" }).click(),
    });
    await pd.waitFor({ state: "hidden" });
    await R.step(page, {
      id: "kart-oylama-sonuc",
      title: "Oylama açıldı",
      text: "Seçenekler yan yana listelenir; her seçeneğin yanında oy sayısı ve oran çubuğu var. Kimin neye oy verdiği görünmez, yalnızca sayılar.",
      target: page.getByText("Atölye sonrası ikram ne olsun?").locator("xpath=ancestor::div[contains(@class,'cardHover')]"),
      click: false,
    });

    // --- toplanti plani duzenle --------------------------------------------
    const meeting = page.getByText("Atölye günü kısa toplantısı").locator("xpath=ancestor::div[contains(@class,'cardHover')]");
    const editMeeting = meeting.getByRole("button", { name: "Kartı düzenle" });
    await meeting.scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "kart-toplanti",
      title: "Toplantı planı kartı",
      text: "Toplantı kartı **ne zaman, nerede, bağlantı ve gündem** bilgisini tutar; altındaki üç düğme (**Katılıyorum**, **Belki**, **Katılamıyorum**) herkesin cevabını toplar. Kalemle düzenle.",
      target: meeting,
      act: () => editMeeting.click(),
    });
    const md = dlg(page, "Toplantı planı düzenle");
    await R.step(page, {
      id: "kart-toplanti-form",
      title: "Tarih ve saati takvimden seç",
      text: "**Ne zaman** alanı gün + saat ister. **Yer** ve **Gündem** serbest metin; **Bağlantı**'ya çevrimiçi toplantı adresini yapıştır.",
      target: md,
      click: false,
    });
    await dact(md).getByRole("button", { name: "Vazgeç" }).click();

    // --- kart duzeni --------------------------------------------------------
    const layout = btn(page, /Düzeni düzenle/);
    await R.step(page, {
      id: "kart-duzen",
      title: "Kartların sırasını kendine göre ayarla",
      text: "Birden çok kart varsa **Düzeni düzenle** sırayı değiştirtir. Sıra **sana özeldir**: başkalarının ekranını etkilemez.",
      target: layout,
      act: () => layout.click(),
    });
    await R.step(page, {
      id: "kart-duzen-oklar",
      title: "Yukarı / aşağı oklarını kullan",
      text: "Her kartta **yukarı** ve **aşağı** okları çıkar. Bitince **Düzeni bitir**'e bas. Kartın başlığındaki ok kartı katlar; katlanan kartlar cihazında hatırlanır.",
      target: [page.getByRole("button", { name: "Yukarı taşı" }).first(), btn(page, /Düzeni bitir/)],
      click: false,
      act: () => btn(page, /Düzeni bitir/).click(),
    });
  },
};
