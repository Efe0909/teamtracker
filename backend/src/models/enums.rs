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
    /// `nodes.node_type`. Takim ve pillar agactan CIKTI (spec/22): agac yalniz
    /// yapi, her aktif dugum birimdir.
    /// Buradaki `Task`, `RecordKind::Task` ile AYNI SEY DEGIL: biri agacta
    /// yapisal bir seviye, digeri kaydin turu.
    /// Hangi turun nerede olabilecegini KOK SEMASI soyler (src/refdata.rs,
    /// spec/74): Birimler'de cell/machine/task/step/generic, Etkinlik
    /// Turleri'nde option/checkpoint/widget, Etkinlik Yerleri'nde location,
    /// Etkinlik Kazanimlari'nda outcome.
    /// `operational` = kodun yarattigi slot (kokler + otomatik slotlar).
    NodeType {
        Cell => "cell", Machine => "machine",
        Task => "task", Step => "step", Operational => "operational", Generic => "generic",
        // `option` Rust'ta Choice: `Option` adi derive kodundaki std Option'u golgeler.
        Choice => "option", Checkpoint => "checkpoint", Widget => "widget", Location => "location",
        Outcome => "outcome",
    }
);

sql_enum!(
    /// `nodes.shape`: cocuklara izin. leaf = cocuk yok; list = butun cocuklar
    /// ayni turde (cocuklarin kendi alt agaci olabilir); tree = serbest.
    Shape { Leaf => "leaf", List => "list", Tree => "tree" }
);

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

sql_enum!(
    /// `events.status`. Kesin/yapildi tarih ister (sema check'i).
    EventStatus {
        Idea => "idea", Planning => "planning", Confirmed => "confirmed",
        Done => "done", Cancelled => "cancelled",
    }
);

sql_enum!(
    /// `event_widgets.widget_type`. Yalniz alanlari TANIMLI turler; yeni tur =
    /// kendi tablosu + bilesen + buraya bir satir, ayni gocte.
    WidgetType { Supplies => "supplies", Record => "record", Otf => "otf" }
);

sql_enum!(
    /// `materials.type`. Hizmet de satin alimdir (lazer kesim gibi).
    MaterialType { Consumable => "consumable", Equipment => "equipment", Service => "service" }
);
