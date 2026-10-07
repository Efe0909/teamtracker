// Bolum 7: kartlara cevap vermek — toplanti katilimi, oy, gonullu havuzu. Kisi: Selin.

import { HOSTS, recordId } from "../lib.mjs";
import { btn } from "../ui.mjs";

/** Kartin kendi kutusu: basligindan yukari dogru `cardHover` sinifli kap. */
const cardOf = (page, title) => page.getByText(title, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'cardHover')]");

export default {
  id: "kartlara-katil",
  title: "Kartlara cevap ver: toplantı, oy, gönüllülük",
  persona: "Selin Arslan",
  role: "SEB iletişim sorumlusu",
  intro: "Selin'e üç kayıtta üç şey soruluyor: toplantıya gelecek mi, forma hangi soruların konacağını düşünüyor, kayıt masasında gönüllü olur mu?",

  async run({ R, open }) {
    const { page } = await open("Selin Arslan");

    // --- toplanti katilimi --------------------------------------------------
    await page.goto(`${HOSTS.dashboard}/tasks/${recordId("Güz dönemi etkinlik takvimi taslağı")}`, { waitUntil: "networkidle" });
    const meeting = cardOf(page, "Takvim toplantısı");
    await meeting.scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "katil-toplanti",
      title: "Toplantıya katılacak mısın?",
      text: "**Toplantı planı** kartında zaman, yer ve gündem yazar. Altındaki üç düğmeden biriyle yanıt ver; yanıtlar herkese görünür ve kimin gelip gelmediği tek bakışta anlaşılır.",
      target: [meeting.getByRole("button", { name: "Katılıyorum" })],
      act: () => meeting.getByRole("button", { name: "Katılıyorum" }).click(),
    });
    await R.step(page, {
      id: "katil-toplanti-sonuc",
      title: "Yanıtın kayıtlı",
      text: "Seçtiğin düğme mor dolu görünür, adın **Katılıyorum** satırına eklenir. Yanıtı değiştirmek için başka düğmeye bas; aynı düğmeye bir daha basarsan yanıtın geri çekilir.",
      target: meeting,
      click: false,
    });

    // --- oylama -------------------------------------------------------------
    await page.goto(`${HOSTS.dashboard}/tasks/${recordId("Arduino atölyesi kayıt formunu hazırla")}`, { waitUntil: "networkidle" });
    const poll = cardOf(page, "Kayıt formunda hangi sorular olsun?");
    await poll.scrollIntoViewIfNeeded();
    const o1 = poll.getByRole("button", { name: /Bölüm ve sınıf/ });
    await R.step(page, {
      id: "katil-oy",
      title: "Oylamada seçeneklere bas",
      text: "**Oylama** kartında seçenek düğmesine basmak oy vermektir. Bu soruda birden çok seçenek işaretlenebilir: aklındaki her soruya bas.",
      target: o1,
      act: async () => {
        await o1.click();
        await poll.getByRole("button", { name: /Dizüstü getirecek mi/ }).click();
      },
    });
    await R.step(page, {
      id: "katil-oy-sonuc",
      title: "Oyun sayıldı",
      text: "İşaretlediklerin dolu görünür; sağdaki sayı o seçeneğe verilen oy, çubuk toplamdaki oranı gösterir. Oyunu değiştirmek ya da geri çekmek için seçeneğe tekrar bas.",
      target: poll,
      click: false,
    });

    // --- havuz --------------------------------------------------------------
    await page.goto(`${HOSTS.dashboard}/tasks/${recordId("Kayıt masası ve yönlendirme tabelaları")}`, { waitUntil: "networkidle" });
    const pool = cardOf(page, "Kayıt masasında karşılama");
    await pool.scrollIntoViewIfNeeded();
    await R.step(page, {
      id: "katil-havuz",
      title: "Gönüllü olmak için işi üstlen",
      text: "**Havuz kartı** atama yapmadan gönüllü arar: “**3 kişi lazım**”. İsteyen **Bu işi alıyorum**'a basar; adı kartın altında listelenir.",
      target: pool.getByRole("button", { name: "Bu işi alıyorum" }),
      act: () => pool.getByRole("button", { name: "Bu işi alıyorum" }).click(),
    });
    await R.step(page, {
      id: "katil-havuz-sonuc",
      title: "Havuz doldu",
      text: "Üç gönüllü tamam: istenen kişi sayısına ulaşıldı. Fikrini değiştirirsen aynı düğmeye tekrar basıp işi bırakabilirsin.",
      target: pool,
      click: false,
    });
  },
};
