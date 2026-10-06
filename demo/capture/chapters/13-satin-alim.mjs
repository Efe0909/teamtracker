// Bolum 13: satin alimlar widget'i — surec adimlari, tedarikci, yeni malzeme. Kisi: Elif (maliye).

import { HOSTS } from "../lib.mjs";
import { cls, menuItem, pickDay } from "../ui.mjs";

const EVENT = "Arduino ile Akıllı Ev Atölyesi";

export default {
  id: "satin-alim",
  title: "Satın alımlar: malzemeyi takip et",
  persona: "Elif Şahin",
  role: "Bütçe ve satın alma",
  intro: "Atölyeye iki hafta kala Elif malzeme listesini takip ediyor: hangisi onaylandı, hangisinin tedarikçisi yok, kritik olan ne bekliyor?",

  async run({ R, open }) {
    const { page } = await open("Elif Şahin");
    await page.goto(`${HOSTS.dashboard}/events`, { waitUntil: "networkidle" });
    await page.locator("table").getByRole("link", { name: EVENT }).click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}/);

    const card = page.getByText("Satın alımlar", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'cardHover')]");
    await card.scrollIntoViewIfNeeded();
    const row = (name) => card.locator("li").filter({ hasText: name }).first();

    await R.step(page, {
      id: "satin-genel",
      title: "Satın alımlar widget'ı",
      text: "Etkinliğin malzeme ve hizmet listesi burada tutulur. Her satırda **önem**, **ad**, **tür** (sarf / alet / hizmet), süreç **noktaları**, **en iyi fiyat** ve en yakın **varış tarihi** görünür. **Zaten var** işaretli malzemeler en alta iner.",
      target: card,
      click: false,
    });

    await R.step(page, {
      id: "satin-saglik",
      title: "Başlıktaki renkli nokta genel durumu söyler",
      text: "Nokta, “gerekli” diye işaretlenmiş malzemelerin onay durumunu özetler: **yeşil** hepsi onaylı, **turuncu** onay bekleyen var, **kırmızı** kritik bir malzeme bekliyor. Şu an kırmızı: röle modülü gelmeden atölye testi yapılamaz.",
      target: cls(card, "mHealth"),
      click: false,
    });

    // --- adim ilerlet -------------------------------------------------------
    const relay = row("Röle modülü");
    const dots = relay.getByRole("group").getByRole("button");
    await R.step(page, {
      id: "satin-adim",
      title: "Süreç adımlarını noktalarla ilerlet",
      text: "Her malzemenin adımları var: **Gerekli mi?** → **Tedarikçi bulundu** → **Onaylandı** (sponsorlu olanlara **Sponsor** adımı da eklenir). Röle modülü tedarikçisi bulundu: ikinci noktaya bas.",
      target: dots.nth(1),
      act: () => dots.nth(1).click(),
    });
    await R.step(page, {
      id: "satin-adim-onay",
      title: "Sipariş onaylanınca son noktaya bas",
      text: "Onay gelince üçüncü noktaya bas; önceki adımlar da tamamlanmış sayılır. Dolu bir noktaya basmak o adımı ve sonrasını geri alır.",
      target: dots.nth(2),
      act: () => dots.nth(2).click(),
    });
    await R.step(page, {
      id: "satin-adim-sonuc",
      title: "Kritik engel kalktı",
      text: "Başlıktaki nokta kırmızıdan **turuncuya** döndü: artık kritik bekleyen yok, ama onay bekleyen başka malzemeler var.",
      target: [cls(card, "mHealth"), relay],
      click: false,
    });

    // --- tedarikci ----------------------------------------------------------
    const uno = row("Arduino Uno R3");
    await R.step(page, {
      id: "satin-detay",
      title: "Satıra tıklayıp tedarikçileri gör",
      text: "Satırın solundaki oka tıklayınca tedarikçi tablosu açılır: bağlantı ya da telefon, fiyat ve varış tarihi. En ucuz teklif vurgulanır; tablo başlıklarına tıklayarak sıralayabilirsin.",
      target: uno.locator('[class*="mToggle"]'),
      act: () => uno.locator('[class*="mToggle"]').click(),
    });
    await R.step(page, {
      id: "satin-detay-tablo",
      title: "Teklifleri kıyasla",
      text: "Üç tedarikçi var; en düşük fiyatlı olan satır vurgulu. Satırın başlığındaki fiyat ve tarih bu tablodan **otomatik** hesaplanır, elle girilmez.",
      target: uno.locator('[class*="mDetail"]'),
      click: false,
    });

    const form = uno.locator("form");
    await form.getByLabel("Tedarikçi", { exact: true }).fill("https://www.robotistan.example/arduino-uno-r3");
    await form.getByLabel("Fiyat", { exact: true }).fill("4290");
    await form.getByRole("button", { name: /^Varış tarihi:/ }).click();
    await pickDay(page, 6);
    await R.step(page, {
      id: "satin-tedarikci",
      title: "Yeni teklif ekle",
      text: "Bağlantıyı (ya da telefon numarasını) yaz, fiyat ve varış tarihini gir, **+ Tedarikçi**'ye bas. Eksik tarih ya da fiyat bırakılabilir.",
      target: form,
      act: () => form.getByRole("button", { name: /Tedarikçi$/ }).click(),
    });
    await R.step(page, {
      id: "satin-tedarikci-sonuc",
      title: "En iyi fiyat güncellendi",
      text: "Yeni teklif tabloya girdi ve daha ucuz olduğu için **vurgulandı**; satır başlığındaki fiyat da 4.290,00 ₺ oldu.",
      target: [uno.locator('[class*="mDetail"]'), uno.locator('[class*="mPrice"]')],
      click: false,
    });

    // --- yeni malzeme -------------------------------------------------------
    const input = card.getByLabel("Yeni malzeme");
    await input.fill("Havya ucu seti (10 adet)");
    const addBtn = card.locator("form").last().getByRole("button", { name: /Ekle/ });
    await R.step(page, {
      id: "satin-ekle",
      title: "Listeye yeni malzeme ekle",
      text: "Listenin altındaki kutuya malzeme ya da hizmet adını yaz, **Ekle**'ye bas. Yeni malzeme ilk adımda başlar; sonra noktalarla ilerletirsin.",
      target: [input, addBtn],
      act: () => addBtn.click(),
    });
    const fresh = row("Havya ucu seti");
    await fresh.waitFor();

    const more = fresh.getByRole("button", { name: /seçenekleri$/ });
    await R.step(page, {
      id: "satin-menu",
      title: "Satırın ⋯ menüsü",
      text: "Menüde üç şey var: **Zaten var olarak işaretle** (stokta olan malzeme sona iner, süreç adımları kalkar), **Sponsorlu (adım ekle)** ve **Sil**.",
      target: more,
      act: () => more.click(),
    });
    await R.step(page, {
      id: "satin-menu-ac",
      title: "Sponsorlu malzemeye ek adım",
      text: "**Sponsorlu** seçilirse süreç dört adıma çıkar: sponsor onayı da beklenir (DHT22 sensörü gibi). Sponsor çıkarsa menüden adımı kaldırırsın.",
      target: menuItem(page, /Sponsorlu/),
      act: () => menuItem(page, /Sponsorlu/).click(),
    });
    await R.step(page, {
      id: "satin-menu-sonuc",
      title: "Dört adımlı süreç",
      text: "Satırda artık dört nokta var: Gerekli mi? → Tedarikçi bulundu → Sponsor → Onaylandı.",
      target: fresh,
      click: false,
    });
  },
};
