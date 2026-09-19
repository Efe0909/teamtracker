//! Router kurulumu, Host yonlendirme, ara katman sirasi.
//!
//! ## Host ayrimi
//!
//! Host basliginin ILK ETIKETI karar verir (KNOW-79):
//!   app.<alan>       -> mobil yuz, KOKTE — yol oneki YOK, `/m` diye bir sey yok
//!   dashboard.<alan> -> masaustu yuz
//!   bilinmeyen       -> tek-alan-adi moduna duser
//!
//! Yol yeniden yazan katman YOK; mobil rotalar kokte tanimli, ayrim host
//! guard'iyla yapiliyor — Python'daki `mobile_only` / `desktop_only`
//! bagimliliklarinin karsiligi.
//!
//! `/login` ve `/login/callback` HER IKI hostta da acik kalmali: mobil alan
//! adinda giris imkansizlasir (KNOW-25).
//!
//! ## Python'a gore bir iyilesme
//!
//! FastAPI rotalari KAYIT SIRASINA gore esliyordu, o yuzden dashboard'un
//! `/{slug}` yakalayicisi mobilin `/search`'unu yutabiliyordu ve kayit sirasi
//! onemliydi. axum'un router'i statik segmenti dinamik olana TERCIH EDER —
//! `/search` her zaman `/{slug}`'dan once eslesir, sira onemli degil.

use axum::Router;

use crate::state::AppState;

pub mod actions;
pub mod attachments;
pub mod auth;
pub mod cards;
pub mod chat;
pub mod dashboard;
pub mod items;
pub mod mobile;
pub mod nodes;
pub mod shared;
pub mod teams;
pub mod users;

/// Hangi yuzeyin istegi — Host basliginin ilk etiketinden cozulur.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Surface {
    Dashboard,
    Mobile,
    /// Bilinmeyen host: tek-alan-adi modu, ikisi de acik.
    Single,
}

pub fn router() -> Router<AppState> {
    Router::new()
        // Kimlik: her iki hostta acik (KNOW-25).
        .merge(auth::router())
        // Iki sitenin de kullandigi uclar (KNOW-265).
        .merge(shared::router())
        .merge(items::router())
        .merge(actions::router())
        .merge(cards::router())
        .merge(chat::router())
        .merge(attachments::router())
        // Yuzeye ozel — host guard'i kendi modulunde.
        .merge(dashboard::router())
        .merge(teams::router())
        .merge(nodes::router())
        .merge(users::router())
        .merge(mobile::router())
}
