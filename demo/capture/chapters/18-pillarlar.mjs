// Bolum 18: Pillar'lar — kesisen sorumluluk alanlari. Kisi: Kaan.

import { HOSTS } from "../lib.mjs";
import { cls, nav } from "../ui.mjs";

export default {
  id: "pillarlar",
  title: "Pillar'lar: kesişen sorumluluklar",
  persona: "Kaan Demir",
  role: "Etkinlik koordinatörü",
  intro: "Bazı işler tek bir birime sığmaz: atölye güvenliği ya da sürdürülebilirlik gibi. Kaan bu kesişen alanları Pillar'lar sayfasından izliyor.",

  async run({ R, open }) {
    const { page } = await open("Kaan Demir");
    await page.goto(`${HOSTS.dashboard}/`, { waitUntil: "networkidle" });

    await R.step(page, {
      id: "pillar-ac",
      title: "Pillar'lar'ı aç",
      text: "Kenar çubuğundan **Pillar'lar**'a tıkla. Pillar, birimlerden bağımsız bir **sorumluluk alanıdır**: bir kayıt hem bir birimde (ne işi) hem de bir pillar'da (hangi alan) durabilir.",
      target: nav(page, "Pillar'lar"),
      act: () => nav(page, "Pillar'lar").click(),
    });
    await R.step(page, {
      id: "pillar-liste",
      title: "Pillar kartları",
      text: "Her pillar'ın kendi **takımı** ve **sohbeti** vardır. Kartta açıklama, kişi sayısı ve **açık kayıt** sayısı görünür.",
      target: cls(page, "teamGrid"),
      click: false,
    });

    const card = page.locator('[class*="teamGrid"]').getByRole("link", { name: /Atölye Güvenliği/ });
    await R.step(page, {
      id: "pillar-sec",
      title: "Atölye Güvenliği'ne tıkla",
      text: "Pillar sayfası, takım sayfasına benzer: üyeler, kayıtlar ve sohbet.",
      target: card,
      act: () => card.click(),
    });
    await page.waitForURL(/\/pillars\/[0-9a-f-]{36}/);
    await R.step(page, {
      id: "pillar-sayfa",
      title: "Pillar sayfası",
      text: "**Üyeler**, bu pillar'a bağlı **kayıtlar** (birimi ne olursa olsun), ileride gösterge panelleri için ayrılmış **Göstergeler** alanı ve sağda **pillar sohbeti**. Kayıtlara pillar bağlamak için kayıt sayfasındaki **Pillar** satırı kullanılır.",
      target: [
        { t: page.locator('section[aria-labelledby="w-members"]'), label: "Üyeler" },
        { t: page.locator('section[aria-labelledby="w-records"]'), label: "Bağlı kayıtlar" },
        { t: page.getByRole("complementary", { name: /sohbet/i }), label: "Pillar sohbeti" },
      ],
      click: false,
    });
  },
};
