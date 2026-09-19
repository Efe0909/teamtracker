//! Satir tipleri ve alan adi enum'lari.
//!
//! ## ORM yok — esleme kodu da yok
//!
//! `sqlx::query_as!` sutunlari struct alanlarina KENDISI esliyor ve bunu
//! derleme zamaninda gercek veritabanina bakarak dogruluyor. Elle yazilmis
//! "row -> object" katmani YOK; olsaydi hem tekrar hem de sessizce bayatlayan
//! bir kopya olurdu. `models/` tip tanimlarini tutar, esleme kodunu degil.
//!
//! ## Burada ne durur, ne durmaz
//!
//! **Durur** — birden fazla yerin paylastigi tipler:
//!   - tablo satirlari (`Item`, `Node`, `User`, ...)
//!   - alan adi enum'lari (`enums.rs`)
//!   - kart blob tipleri (`card.rs`) — bunlar serde, sqlx degil
//!
//! **Durmaz** — TEK sorgunun kullandigi tipler. Tablo listesinin sayac'li
//! satiri ya da `chat_feed` view'inin satiri hicbir tablonun karsiligi degil;
//! onlar o sorguyu yazan dosyada durur.
//!
//! Olcut tek soru: **birden fazla yer bu tipi kullaniyor mu?** Hayirsa
//! `models/`'e girmez. Aksi halde burasi hangisinin tasiyici oldugu
//! anlasilmayan bir cop tenekesine doner.
//!
//! ## CHECK kisiti -> enum
//!
//! SQL'deki her `check (x in (...))` burada bir enum'a karsilik gelir
//! (`enums.rs`). Kazanc: kisit ile kod BIRBIRINDEN AYRILAMAZ — Python'da
//! `"acik"` yazip kacabiliyordun, burada derlenmiyor.
//!
//! IKI ISTISNA, ikisi de bilincli:
//!   - `item_cards.card_type` — CHECK'i dustu (spec/21-sema-v2.md §3).
//!     Taninmayan tur BROKEN olarak cizilmeli, derleme hatasi vermemeli.
//!   - `activity.verb` — serbest anahtar, sablon cevirir.
//! Ikisi de `String` kalir.

pub mod action;
pub mod activity;
pub mod attachment;
pub mod card;
pub mod enums;
pub mod item;
pub mod message;
pub mod node;
pub mod team;
pub mod user;
