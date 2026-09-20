//! SQL CHECK kisitlarinin Rust karsiligi.
//!
//! Kural: sema ile bu dosya birlikte degisir. `sqlx::Type` + `rename_all` ile
//! veritabanindaki metin degerler birebir esleniyor; yeni bir deger eklemek
//! hem goc hem buraya bir satir demek — biri unutulursa derlenmiyor.
//!
//! Ekranda gorunen TURKCE metin burada DEGIL, sablonda: anahtar Ingilizce,
//! etiket Turkce (CLAUDE.md "Kod dili").

use serde::{Deserialize, Serialize};

macro_rules! sql_enum {
    ($(#[$m:meta])* $name:ident { $($variant:ident => $sql:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
        #[sqlx(type_name = "text")]
        pub enum $name {
            $(#[sqlx(rename = $sql)] #[serde(rename = $sql)] $variant),+
        }
    };
}

sql_enum!(
    /// `items.kind`. Ayri bir boyut mu yoksa yalniz filtre mi — spec'te acik
    /// nokta; bolunmesi gerekirse burasi da bolunur.
    RecordKind { Issue => "issue", Task => "task" }
);

sql_enum!(
    /// `items.status`. `actions.status`'tan AYRI: eylemde `pending` yok.
    /// Tek enum'a katlamak, olmayan bir gecisi mumkun gosterirdi.
    RecordStatus {
        Open => "open", InProgress => "in_progress", Pending => "pending",
        Closed => "closed", Cancelled => "cancelled",
    }
);

sql_enum!(
    ActionStatus {
        Open => "open", InProgress => "in_progress",
        Closed => "closed", Cancelled => "cancelled",
    }
);

sql_enum!(
    Priority { Critical => "critical", High => "high", Medium => "medium", Low => "low" }
);

sql_enum!(
    /// `nodes.node_type`. `UNIT_TYPES` = bu kumeden `Team` ve `Pillar` cikarilmis
    /// hali — kayit onlara `unit_id` ile baglanmaz (spec/21-sema-v2.md §10).
    /// Buradaki `Task`, `RecordKind::Task` ile AYNI SEY DEGIL: biri agacta
    /// yapisal bir seviye, digeri kaydin turu.
    NodeType {
        Cell => "cell", Machine => "machine", Pillar => "pillar", Team => "team",
        Task => "task", Step => "step", Operational => "operational", Generic => "generic",
    }
);

impl NodeType {
    /// Ekranda gorunen TURKCE etiket. Anahtar Ingilizce, etiket Turkce
    /// (CLAUDE.md "Kod dili").
    pub fn label(self) -> &'static str {
        match self {
            NodeType::Cell => "Cell",               // IWS hucresi / operasyonel birim
            NodeType::Machine => "Makine",          // atomik fonksiyonel birim
            NodeType::Pillar => "Pillar",           // IWS pillar'i
            NodeType::Team => "Takım",              // Takimlar sayfasinda kart uretir
            NodeType::Task => "Görev",
            NodeType::Step => "Adım",
            NodeType::Operational => "Operational", // davranis YOK — IWS kabi
            NodeType::Generic => "Genel",           // davranis YOK — notr yer tutucu
        }
    }

    pub const ALL: &'static [NodeType] = &[
        NodeType::Cell, NodeType::Machine, NodeType::Pillar, NodeType::Team,
        NodeType::Task, NodeType::Step, NodeType::Operational, NodeType::Generic,
    ];

    pub fn is_root_only(self) -> bool {
        Self::ROOT_ONLY.contains(&self)
    }

    /// Yalniz KOKTE durabilen turler.
    pub const ROOT_ONLY: &'static [NodeType] = &[NodeType::Cell];

    /// `records.unit_id` bunlardan birini gosterebilir. Takim ve pillar HARIC:
    /// kayit onlara ayri alanlarla (`team_id`, `pillar_id`) baglanir, birim
    /// listesinde gorunmeleri kullaniciya "buraya da atayabilirim" dedirtir.
    pub fn is_unit(self) -> bool {
        !matches!(self, NodeType::Team | NodeType::Pillar)
    }
}

sql_enum!(
    /// `team_members.role` — takim ICINDEKI konum. `roles` tablosu (yetki
    /// demeti) ile AYNI SEY DEGIL; ayni kelime, farkli kavram.
    TeamRole { Lead => "lead", Mentor => "mentor", Member => "member" }
);

sql_enum!(
    /// `users.notify_level`. Kademeler push gonderiminde TEK kapida uygulanir.
    NotifyLevel { All => "all", Mentions => "mentions", None => "none" }
);

sql_enum!(
    /// Karta katilim cevabi. Bu enum sqlx DEGIL serde tarafindan kullaniliyor:
    /// katilim kart blob'unda duruyor, ayri tablo yok (KNOW-281).
    /// Havuz kartinda yalniz `Yes` anlamli — `Maybe`/`No` cizilmez.
    SignupAnswer { Yes => "yes", Maybe => "maybe", No => "no" }
);
