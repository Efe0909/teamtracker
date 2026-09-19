//! Kart satiri + CardBody. data blob`u serde ile cozulur; hata Broken`a
//! duser (KNOW-280). Istege bagli alanlar #[serde(default)] — eksik gundemli
//! toplanti BOZULMAZ, bos gundemle cizilir.

use serde::Deserialize;

/// Kart blob'unun cozulmus hali.
///
/// `card_type` bir enum DEGIL `String`: taninmayan tur derleme hatasi degil,
/// `Broken` olmali (spec/21-sema-v2.md §9). Kodda kaldirilan bir tur, o turden
/// satirlari silmez — kullanici gorur ve silmeye karar verir.
#[derive(Debug)]
pub enum CardBody {
    Media(MediaCard),
    Meeting(MeetingCard),
    Pool(PoolCard),
    /// SAKLANMAZ — her cizimde hesaplanir. Sonraki bir kod degisikligi turu
    /// geri tanirsa kart kendiliginden iyilesir.
    Broken { reason: String },
}

/// Istege bagli alanlarin HEPSI `#[serde(default)]`: gundemi eksik bir
/// toplanti bos gundemle cizilir, BOZULMAZ. `Broken` gercekten cizilemeyen
/// karta saklanir — silme dugmesi yikicidir, eksik bir kartin onune konmaz.
#[derive(Debug, Deserialize)]
pub struct MeetingCard {
    pub starts_at: String,
    #[serde(default)] pub title: String,
    #[serde(default)] pub place: String,
    #[serde(default)] pub agenda: String,
}

#[derive(Debug, Deserialize)]
pub struct MediaCard {
    #[serde(default)] pub title: String,
    #[serde(default)] pub caption: String,
}

#[derive(Debug, Deserialize)]
pub struct PoolCard {
    pub title: String,
    #[serde(default)] pub detail: String,
}
