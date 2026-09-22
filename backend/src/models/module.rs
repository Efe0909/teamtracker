//! Modul katalogu — ana sayfadaki kutular ve sol ray.
//!
//! Liste KODDA, veritabaninda tablosu yok. `user_pins.slug` bu yuzden FK
//! degil: bir modulun varligi kurulumun degil surumun ozelligi.
//!
//! `ready: false` olan modul iskele sayfaya gider ("Yakında"), `plan` orada
//! maddeler halinde cizilir — bos vaat degil, yazilacak isin listesi.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Module {
    pub slug: &'static str,
    pub icon: &'static str,
    pub name: &'static str,
    pub ready: bool,
    pub desc: &'static str,
    pub plan: &'static [&'static str],
}

/// Sira ANA SAYFADAKI siradir — hazir olanlar once.
pub const MODULES: &[Module] = &[
    Module {
        slug: "tasks", icon: "📋", name: "Görev Yöneticisi",
        ready: true,
        desc: "Tüm kayıtlar tek tabloda: özet çipleri, hızlı filtreler, boyut filtreleri. Satır kayıt sayfasına gider; eylemler orada.",
        plan: &[

        ],
    },
    Module {
        slug: "teams", icon: "👥", name: "Takımlar",
        ready: true,
        desc: "Takımlar, roller (lider/mentor/üye), takım duvarı ve \"bu takıma kayıt aç\". Takım düğümü (node_type='team') açıldığında kart kendiliğinden doğar.",
        plan: &[

        ],
    },
    Module {
        slug: "outcome-tree", icon: "🌳", name: "Veri Yönetimi",
        ready: true,
        desc: "Yapının düzenlendiği ekran: düğüm ekle, adlandır, açıklama yaz, taşı, sil.",
        plan: &[

        ],
    },
    Module {
        slug: "pivot", icon: "📊", name: "Pivot & Veri Analizi",
        ready: false,
        desc: "Kayıtları düğüm, takım, sorumlu ve zaman kırılımında çapraz say.",
        plan: &[
        "Gruplama ve sayım SQL'de; Python'a dönen satır ekranda görünen satırdır (spec/10-kararlar.md 'Sorgular').",
        "Alt ağaç kırılımı tin/tout aralık taramasıyla — recursive CTE yok.",
        "İkinci yüz: açık kayıtların hazır kırılımları (spec/60-kaynak-uyarlama.md 2.3).",
        "Bir hücreden tıklayınca aynı filtrelerle görev tablosuna geçiş."
        ],
    },
    Module {
        slug: "wds", icon: "🧭", name: "WDS Panosu",
        ready: false,
        desc: "Haftalık yön belirleme: açılan/kapanan, geciken, aktiflik — her şey rayında mı?",
        plan: &[
        "Bu hafta açılan/kapanan, geciken eylemler, kişi başına açık iş (spec/60-kaynak-uyarlama.md 2.9).",
        "Aktiflik oranı: bu hafta en az bir hareket yapan / toplam üye (spec/61 §4).",
        "\"Bu hafta öne çıkanlar\" — kapanan işler isimlerle.",
        "Rutin tamamlama matrisi rutin şeması netleşince (spec/20-sema.md açık nokta 5)."
        ],
    },
    Module {
        slug: "calendar", icon: "📅", name: "Takvim",
        ready: false,
        desc: "Son tarihler, gecikmeler ve ekip yükü ay / hafta görünümünde.",
        plan: &[
        "items.due_date ve actions.due_date üzerinden ay ve hafta görünümü.",
        "Gecikmiş kayıtlar (due_date < bugün ve status <> 'closed') ayrı vurgulanır.",
        "Bir güne tıklayınca o günün kayıtları görev tablosunda süzülür."
        ],
    },
    Module {
        slug: "definitions", icon: "📐", name: "Görev Tanımları & Şemalar",
        ready: false,
        desc: "Rol tanımları, yönetim şemaları ve adım adım iş tanımları — kimin neyi yaptığı.",
        plan: &[
        "Şemalar hiyerarşinin kendisinden türer: düğüm → sorumlu → yedek.",
        "Adım adım iş tanımları düz metin olarak düğüme bağlı sürümlenir (form-builder yok — spec/60 §4).",
        "Salt okunur görünüm herkese açık, düzenleme is_editor kapsamına bağlı."
        ],
    },
    Module {
        slug: "archive", icon: "🗂", name: "Ekip Arşivi",
        ready: false,
        desc: "Kapanmış kayıtlar, alınan kararlar ve geçmiş dönemlerin kurumsal hafızası.",
        plan: &[
        "Kapanmış kayıtlar silinmez, arşive düşer (spec/20-sema.md açık nokta 3: deleted_at).",
        "Tam metin arama tsvector üzerinden — LIKE '%…%' yok.",
        "Karar kayıtları kartın olay akışından toplanır."
        ],
    },
    Module {
        slug: "files", icon: "🗄", name: "Dosyalar / NAS",
        ready: false,
        desc: "Karta ve düğüme bağlı dosyalar; kılavuz/eğitim kütüphanesi de buraya oturur.",
        plan: &[
        "spec/20-sema.md açık nokta 1 🚧: docker + NAS yönü; saklama süresi kararı bekliyor.",
        "Faz 1'de dosya yükleme bilerek yok; yükleme kaynaklı saldırı yüzeyi de yok (README).",
        "Erişim yetkisi kartın yetkisiyle aynı yerden gelir, ikinci bir model kurulmaz."
        ],
    },
    Module {
        slug: "admin", icon: "🛡", name: "Yönetim Paneli",
        ready: true,
        desc: "Kullanıcılar, kapsamlar ve roller — dar kapsam (TODO.md madde 3). Takım üyeliği ekipler'de, yapı ve düğüm izni outcome-tree'de.",
        plan: &[

        ],
    },];

pub fn by_slug(slug: &str) -> Option<&'static Module> {
    MODULES.iter().find(|m| m.slug == slug)
}

/// Sablonun bekledigi sekil: modul + kisiye ait pin durumu + adres.
#[derive(Debug, Serialize)]
pub struct ModuleView {
    pub slug: &'static str,
    pub icon: &'static str,
    pub name: &'static str,
    pub ready: bool,
    pub desc: &'static str,
    pub plan: &'static [&'static str],
    pub href: String,
    pub pinned: bool,
}

pub fn views(pinned: &[String]) -> Vec<ModuleView> {
    MODULES.iter().map(|m| ModuleView {
        slug: m.slug, icon: m.icon, name: m.name, ready: m.ready,
        desc: m.desc, plan: m.plan,
        href: format!("/{}", m.slug),
        pinned: pinned.iter().any(|p| p == m.slug),
    }).collect()
}
